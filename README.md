# Leash — Autonomous Hardware-Verified Spending Firewall

**Leash** is an autonomous AI spending firewall built on the **Hedera network**. It combines **x402 protocol** micro-settlements, **Chainlink Data Feeds**, and the **Ledger Device Management Kit (DMK)** to enable AI agents to execute sub-dollar payments autonomously while enforcing hard, hardware-verified guardrails on high-value transactions.

Built for **ETHGlobal ETHOnline 2026**.

---

## 🚀 Live On-Chain Deployments

- **PolicyVault Smart Contract (Hedera Testnet):** [`0xD5BBD98D03Fa1B1DdD2D944E251cbE02F5eedcdC`](https://hashscan.io/testnet/contract/0xD5BBD98D03Fa1B1DdD2D944E251cbE02F5eedcdC)
- **Verified x402 Settlement Transaction:** [`0.0.7162784@1789114603.955176995`](https://hashscan.io/testnet/transaction/0.0.7162784-1789114603-955176995)

---

## 🏛️ System Architecture

Leash operates across four core security pillars:

### 1. Smart Contract Policy Enforcement (`PolicyVault.sol`)
- Deployed on Hedera Testnet via Hardhat & Solidity.
- Enforces strict per-transaction and daily USD spending limits for registered AI agents.
- **Price Feed Oracle:** Integrates Chainlink Data Feeds (`MockV3Aggregator` on testnet) to peg spending limits dynamically to USD value rather than volatile token units.

### 2. Autonomous Agent Integration (`Hedera Agent Kit`)
- Powered by `@hashgraph/hedera-agent-kit` and LangChain.
- Allows AI agents to execute automated micro-transactions using the `x402` payment protocol standard seamlessly.

### 3. Hardware Escalation Layer (`Ledger DMK`)
- Intercepts any transaction exceeding the agent's pre-approved USD threshold.
- Halts execution and escalates the request to the Web Dashboard, requiring physical confirmation via `@ledgerhq/device-management-kit` or connected browser wallet signing.

### 4. Reputation Oracle & Monitoring (`The Graph & Dashboard`)
- Tracks agent transaction history and computes real-time trust metrics.
- Utilizes on-chain fallback logic to read policy statuses and pending escalations directly from the Hedera contract.

---

## ⚙️ Quick Start & Setup

### Prerequisites
- Node.js 18+ & npm
- A Hedera Testnet Account ID and Private Key ([Hedera Portal](https://portal.hedera.com))

### 1. Installation
```bash
npm install
```

### 2. Environment Configuration
Create a `.env` file in the root directory:
```env
HEDERA_ACCOUNT_ID="0.0.xxxx"
HEDERA_PRIVATE_KEY="302e020100..."
CHAINLINK_HBAR_USD_FEED="0x..."
OPENAI_API_KEY="sk-..."
```

### 3. Launch Web Dashboard
```bash
cd web
npm run dev
```

### 4. Execute Autonomous Agent
```bash
npm run agent
```

---

## 📜 License

MIT License. Built with 💪&❤️ for ETHGlobal ETHOnline 2026.
