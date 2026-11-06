import { NextResponse } from 'next/server';
import { ethers } from 'ethers';
import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';

export async function POST(req: Request) {
  try {
    const rootDir = path.join(process.cwd(), '..');
    dotenv.config({ path: path.join(rootDir, '.env') });

    const { amountUsd } = await req.json();

    if (!amountUsd) {
      return NextResponse.json({ error: 'amountUsd is required' }, { status: 400 });
    }

    const provider = new ethers.JsonRpcProvider(process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api");
    const wallet = new ethers.Wallet(process.env.HEDERA_PRIVATE_KEY!, provider);

    const addressesPath = path.join(rootDir, "deployed-addresses.json");
    const artifactPath = path.join(rootDir, "artifacts/contracts/PolicyVault.sol/PolicyVault.json");
    
    if (!fs.existsSync(addressesPath)) {
        return NextResponse.json({ error: 'Contract not deployed' }, { status: 500 });
    }

    const addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
    const vaultAddress = addresses.vault;
    const vaultArtifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    const vault = new ethers.Contract(vaultAddress, vaultArtifact.abi, wallet);

    // Hardcode vendor for demo purposes (same one allowlisted in test script)
    const vendor = "0x00000000000000000000000000000000009fb03c";
    
    // Ensure vendor is allowlisted
    try {
        const isAllowed = await vault.vendorAllowlist(vendor);
        if (!isAllowed) {
            const allowTx = await vault.setVendorAllowed(vendor, true);
            await allowTx.wait();
        }
    } catch(e) {
        console.error("Allowlist check failed", e);
    }

    // Convert USD to HBAR (approx 1 HBAR = $0.15, so 1 HBAR = 15 cents)
    // To send exactly the requested amountUsd, we can just use a fixed amount of HBAR for the demo.
    // The smart contract uses a mock price feed anyway.
    // Let's just use ethers.parseEther("0.1") for small ($0.01) and parseEther("5.0") for over-cap ($0.75).
    const amountWei = amountUsd < 0.5 ? ethers.parseEther("0.1") : ethers.parseEther("5.0");

    console.log(`Requesting payment of ${ethers.formatEther(amountWei)} HBAR...`);
    const reqTx = await vault.requestPayment(vendor, amountWei, `x402 Payment ($${amountUsd})`);
    
    // Wait for the transaction to be mined
    await reqTx.wait();
    
    // Determine if it was escalated by checking the last payment's status
    const paymentsCount = await vault.paymentsCount();
    const paymentId = Number(paymentsCount) - 1;
    const p = await vault.payments(paymentId);
    
    // status: 1 = Approved, 2 = Escalated, 3 = Rejected, 4 = Released
    const isEscalated = Number(p[3]) === 2;

    return NextResponse.json({
      success: true,
      stdout: isEscalated ? "Escalated and held for Ledger approval" : "Settled on-chain",
      isEscalated,
      isBlocked: Number(p[3]) === 3,
      txHash: reqTx.hash
    });
  } catch (error: any) {
    console.error("Payment trigger error:", error);
    return NextResponse.json({ error: error.message || 'Payment failed' }, { status: 500 });
  }
}
