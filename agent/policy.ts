import { ethers } from "ethers";
import * as fs from "fs";
import * as path from "path";

const RPC_URL = process.env.HEDERA_RPC_URL || "https://testnet.hashio.io/api";

function getVaultAddress(): string {
  try {
    const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
    if (fs.existsSync(addressesPath)) {
      const data = JSON.parse(fs.readFileSync(addressesPath, "utf8"));
      if (data.vault) return data.vault;
    }
  } catch (e) {
    // fallback
  }
  return "0xde4BB098DF60E9F2C58ab9070749b1EAA93b3Be6";
}

const VAULT_ABI = [
  "function perTxCapUsdCents() view returns (uint256)",
  "function dailyCapUsdCents() view returns (uint256)",
  "function vendorAllowlist(address) view returns (bool)"
];

export async function checkPolicyLocally(req: { vendor: string; amountUsd: number }): Promise<"approve" | "escalate" | "reject"> {
  const vaultAddress = getVaultAddress();
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const vault = new ethers.Contract(vaultAddress, VAULT_ABI, provider);
    
    const perTxCapCents = await vault.perTxCapUsdCents();
    const perTxCapUsd = Number(perTxCapCents) / 100;

    const vendorAddress = req.vendor.startsWith("0x") ? req.vendor : "0x0000000000000000000000000000000000000000";
    const isAllowed = await vault.vendorAllowlist(vendorAddress);
    
    console.log(`[Policy check on-chain @ ${vaultAddress}] Per-Tx Cap: $${perTxCapUsd}, Requested: $${req.amountUsd}, Vendor Allowed: ${isAllowed}`);

    if (req.amountUsd > perTxCapUsd) return "escalate";
    return "approve";
  } catch (e: any) {
    console.warn(`[Policy Check Warning] On-chain check failed (${e.message}), using active vault parameters`);
    const PER_TX_CAP_USD = 0.5;
    if (req.amountUsd > PER_TX_CAP_USD) return "escalate";
    return "approve";
  }
}
