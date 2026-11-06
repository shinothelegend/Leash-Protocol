import { network } from "hardhat";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main() {
  console.log("=== Testing PolicyVault Security Patch (Hardhat 3) ===");
  const { ethers } = await network.create();
  const [owner, agent, vendor, recipient, attacker] = await ethers.getSigners();

  // 1. Deploy MockV3Aggregator with 1 HBAR = $0.10 (10,000,000 in 8 decimals)
  const mockFeed = await ethers.deployContract("MockV3Aggregator", [10_000_000n]);
  await mockFeed.waitForDeployment();
  const feedAddress = await mockFeed.getAddress();
  console.log("✓ MockV3Aggregator deployed at:", feedAddress);

  // 2. Test Constructor Validations
  const VaultFactory = await ethers.getContractFactory("PolicyVault");
  try {
    await (await VaultFactory.deploy(ethers.ZeroAddress, feedAddress, 500n, 100n)).waitForDeployment();
    assert(false, "Should have reverted with zero agent");
  } catch (e: any) {
    assert(e.message.includes("zero agent"), "Expected 'zero agent' error");
    console.log("✓ Constructor zero-address agent check passed");
  }

  try {
    await (await VaultFactory.deploy(agent.address, ethers.ZeroAddress, 500n, 100n)).waitForDeployment();
    assert(false, "Should have reverted with zero price feed");
  } catch (e: any) {
    assert(e.message.includes("zero price feed"), "Expected 'zero price feed' error");
    console.log("✓ Constructor zero-address price feed check passed");
  }

  // 3. Deploy PolicyVault: dailyCap = $5.00 (500 cents), perTxCap = $1.00 (100 cents)
  const dailyCap = 500n;
  const perTxCap = 100n;
  const vault = await ethers.deployContract("PolicyVault", [
    agent.address,
    feedAddress,
    dailyCap,
    perTxCap,
  ]);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("✓ PolicyVault deployed at:", vaultAddress);

  // Check fixed UTC dayStart anchor
  const block = await ethers.provider.getBlock("latest");
  const expectedDayStart = (BigInt(block!.timestamp) / 86400n) * 86400n;
  const actualDayStart = await vault.dayStart();
  assert(actualDayStart === expectedDayStart, "dayStart must match fixed UTC grid");
  console.log(`✓ Fixed UTC grid dayStart anchored correctly: ${actualDayStart}`);

  // Fund Vault with 200 ETH/HBAR
  await owner.sendTransaction({
    to: vaultAddress,
    value: ethers.parseEther("200"),
  });
  console.log("✓ Vault funded with 200 ETH/HBAR");

  // 4. Test Vendor Not Allowlisted -> Escalates
  // 5 HBAR @ $0.10 = $0.50 = 50 cents (within caps)
  const req0Tx = await vault.connect(agent).requestPayment(vendor.address, ethers.parseEther("5"), "Test Vendor Not Allowed");
  await req0Tx.wait();
  let p0 = await vault.payments(0);
  assert(p0[3] === 2n || p0.status === 2n, "Expected status Escalated (2) for non-allowlisted vendor");
  console.log("✓ Non-allowlisted vendor correctly escalated");

  // Allowlist vendor
  await (await vault.connect(owner).setVendorAllowed(vendor.address, true)).wait();
  console.log("✓ Vendor allowlisted");

  // 5. Test In-Policy Payment Approval & Balance Transfer
  // 5 HBAR @ $0.10 = 50 cents (<= 100 cents perTxCap, <= 500 cents dailyCap)
  const vendorBalBefore = await ethers.provider.getBalance(vendor.address);
  const req1Tx = await vault.connect(agent).requestPayment(vendor.address, ethers.parseEther("5"), "In-Policy Inference");
  await req1Tx.wait();
  let p1 = await vault.payments(1);
  const p1Status = p1[3] !== undefined ? p1[3] : p1.status;
  const p1UsdCents = p1[2] !== undefined ? p1[2] : p1.amountUsdCents;
  assert(p1Status === 1n, "Expected status Approved (1)");
  assert(p1UsdCents === 50n, "Expected 50 cents USD");
  const vendorBalAfter = await ethers.provider.getBalance(vendor.address);
  assert(vendorBalAfter - vendorBalBefore === ethers.parseEther("5"), "Vendor must receive transfer immediately");
  const spentToday = await vault.spentTodayUsdCents();
  assert(spentToday === 50n, "spentTodayUsdCents should be 50");
  console.log("✓ In-policy payment auto-approved and transferred successfully");

  // 6. Test Exceeds Per-Tx Cap -> Escalates
  // 15 HBAR @ $0.10 = $1.50 = 150 cents (> 100 cents perTxCap)
  const req2Tx = await vault.connect(agent).requestPayment(vendor.address, ethers.parseEther("15"), "Large Model Training");
  await req2Tx.wait();
  let p2 = await vault.payments(2);
  const p2Status = p2[3] !== undefined ? p2[3] : p2.status;
  const p2UsdCents = p2[2] !== undefined ? p2[2] : p2.amountUsdCents;
  assert(p2Status === 2n, "Expected status Escalated (2) for exceeding per-tx cap");
  assert(p2UsdCents === 150n, "Expected 150 cents USD");
  console.log("✓ Per-tx cap breach correctly escalated");

  // 7. Test Dust Escalation (< 1 cent accounting resolution)
  // 1 wei @ $0.10 rounds down to 0 cents
  const reqDustTx = await vault.connect(agent).requestPayment(vendor.address, 1n, "Microdust attack");
  await reqDustTx.wait();
  let pDust = await vault.payments(3);
  const pDustStatus = pDust[3] !== undefined ? pDust[3] : pDust.status;
  const pDustUsdCents = pDust[2] !== undefined ? pDust[2] : pDust.amountUsdCents;
  assert(pDustStatus === 2n, "Expected dust payment to escalate");
  assert(pDustUsdCents === 0n, "Dust should calculate 0 cents");
  console.log("✓ Dust protection: sub-cent transaction escalated rather than slipping past caps as 0");

  // 8. Test Owner Release of Escalated Payment (Payment #2)
  const vendorBalBeforeRelease = await ethers.provider.getBalance(vendor.address);
  const releaseTx = await vault.connect(owner).releasePayment(2);
  await releaseTx.wait();
  let p2After = await vault.payments(2);
  const p2AfterStatus = p2After[3] !== undefined ? p2After[3] : p2After.status;
  assert(p2AfterStatus === 4n, "Expected status Released (4)");
  const vendorBalAfterRelease = await ethers.provider.getBalance(vendor.address);
  assert(vendorBalAfterRelease - vendorBalBeforeRelease === ethers.parseEther("15"), "Vendor should receive released funds");
  const spentAfterRelease = await vault.spentTodayUsdCents();
  assert(spentAfterRelease === 200n, "spentToday should be 50 + 150 = 200 cents");
  console.log("✓ Escalation released by owner, funds transferred, and spend attributed to daily budget");

  // 9. Test Owner Rejection of Escalated Payment (Payment #0)
  const rejectTx = await vault.connect(owner).rejectPayment(0, "Unauthorized unallowlisted vendor");
  await rejectTx.wait();
  let p0After = await vault.payments(0);
  const p0AfterStatus = p0After[3] !== undefined ? p0After[3] : p0After.status;
  assert(p0AfterStatus === 3n, "Expected status Rejected (3)");
  console.log("✓ Escalation successfully rejected by owner with reason");

  // 10. Test Rate Limiting (minPaymentInterval)
  await (await vault.connect(owner).setMinPaymentInterval(60)).wait(); // 60s
  try {
    // Attempt second payment immediately
    await vault.connect(agent).requestPayment(vendor.address, ethers.parseEther("1"), "Fast payment");
    assert(false, "Should have been rate limited");
  } catch (e: any) {
    assert(e.message.includes("payment rate limited"), "Expected 'payment rate limited' error");
    console.log("✓ Rate limiting (minPaymentInterval) strictly enforced");
  }
  // Disable rate limit for remainder
  await (await vault.connect(owner).setMinPaymentInterval(0)).wait();

  // 11. Test Exceeds Daily Cap -> Escalates
  // spentToday is currently 200 cents. dailyCap is 500 cents.
  // 35 HBAR @ $0.10 = $3.50 = 350 cents. 200 + 350 = 550 cents (> 500 cents dailyCap)
  // Let's set perTxCap to 1000 cents first
  await (await vault.connect(owner).setPolicy(500n, 1000n)).wait();
  console.log("Debug: spentToday before daily cap test:", await vault.spentTodayUsdCents());
  const reqDailyTx = await vault.connect(agent).requestPayment(vendor.address, ethers.parseEther("35"), "Daily Cap Overflow");
  await reqDailyTx.wait();
  const countAfterDaily = await vault.paymentsCount();
  let pDaily = await vault.payments(countAfterDaily - 1n);
  console.log("Debug pDaily:", pDaily);
  const pDailyStatus = pDaily[3] !== undefined ? pDaily[3] : pDaily.status;
  assert(pDailyStatus === 2n, "Expected status Escalated (2) for daily cap exceed");
  console.log("✓ Daily cap breach correctly escalated");

  // 12. Test Emergency Sweep
  const recipientBalBefore = await ethers.provider.getBalance(recipient.address);
  const sweepTx = await vault.connect(owner).sweepTo(recipient.address, ethers.parseEther("10"));
  await sweepTx.wait();
  const recipientBalAfter = await ethers.provider.getBalance(recipient.address);
  assert(recipientBalAfter - recipientBalBefore === ethers.parseEther("10"), "Recipient received emergency swept funds");
  console.log("✓ Emergency sweepTo executed successfully by owner");

  // Verify non-owner cannot sweep
  try {
    await vault.connect(attacker).sweepTo(attacker.address, ethers.parseEther("1"));
    assert(false, "Non-owner should not be able to sweep");
  } catch (e: any) {
    assert(e.message.includes("not owner"), "Expected 'not owner' revert");
    console.log("✓ Unauthorized sweep blocked");
  }

  // 13. Test Stale / Invalid Price Feed
  await (await mockFeed.updateAnswer(0)).wait();
  const reqZeroPrice = await vault.connect(agent).requestPayment(vendor.address, ethers.parseEther("1"), "Zero Price");
  await reqZeroPrice.wait();
  const countAfterZero = await vault.paymentsCount();
  let pZero = await vault.payments(countAfterZero - 1n);
  const pZeroStatus = pZero[3] !== undefined ? pZero[3] : pZero.status;
  assert(pZeroStatus === 2n, "Expected escalation on invalid price");
  console.log("✓ Invalid/stale price feed escalates rather than approving blindly");

  // 14. Test Fixed UTC Day Rollover
  console.log("Advancing time past UTC day boundary (86,400s)...");
  await ethers.provider.send("evm_increaseTime", [86400]);
  await ethers.provider.send("evm_mine", []);
  
  // spentToday before was 200 cents. After rollover, spentToday should reset to 0!
  // Request an in-policy payment: 5 HBAR @ $0.10 = 50 cents
  // Note: reset price back to positive first
  await (await mockFeed.updateAnswer(10_000_000n)).wait();
  const reqRolloverTx = await vault.connect(agent).requestPayment(vendor.address, ethers.parseEther("5"), "Day Rollover Test");
  const receiptRollover = await reqRolloverTx.wait();
  
  // Find DayRollover event in logs
  const rolloverEvent = receiptRollover.logs.find((log: any) => {
    try {
      const parsed = vault.interface.parseLog(log);
      return parsed?.name === "DayRollover";
    } catch {
      return false;
    }
  });
  assert(rolloverEvent !== undefined, "DayRollover event must be emitted when dayStart rolls over");
  const spentTodayAfterRollover = await vault.spentTodayUsdCents();
  assert(spentTodayAfterRollover === 50n, "spentTodayUsdCents should have reset to 0 and now be 50");
  console.log("✓ Fixed UTC DayRollover event emitted and spentTodayUsdCents properly reset");

  // 15. Test Escalation TTL Expiry
  // Create an escalated payment
  await (await vault.connect(owner).setPolicy(500n, 100n)).wait(); // perTxCap back to 100 cents
  const reqExpireTx = await vault.connect(agent).requestPayment(vendor.address, ethers.parseEther("15"), "To Be Expired");
  await reqExpireTx.wait();
  const countAfterExpire = await vault.paymentsCount();
  const expirePaymentId = countAfterExpire - 1n;
  
  // Advance time past ESCALATION_TTL (2 days = 172,800s)
  await ethers.provider.send("evm_increaseTime", [172801]);
  await ethers.provider.send("evm_mine", []);

  try {
    await vault.connect(owner).releasePayment(expirePaymentId);
    assert(false, "Should have reverted with escalation expired");
  } catch (e: any) {
    assert(e.message.includes("escalation expired"), "Expected 'escalation expired' revert");
    console.log("✓ ESCALATION_TTL (2 days) expiry verified: expired payments cannot be released");
  }

  console.log("\n========================================================");
  console.log("🎉 ALL 15 TEST CASES PASSED FOR THE POLICYVAULT PATCH!");
  console.log("========================================================");
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
