# Flash Loan Arbitrage Bot

A Solidity smart contract framework for performing flash loan-based arbitrage between decentralized exchanges. Built using Hardhat and OpenZeppelin.

## 🚀 Features
- Flash loan integration (Aave v2)
- Atomic arbitrage execution logic
- Reentrancy protection
- Easily deployable and testable with Hardhat

## 📦 Tech Stack
- Solidity ^0.8.x
- Hardhat
- Aave Flash Loan Interfaces
- OpenZeppelin Contracts

## 🛠 How to Run

```bash
# Install dependencies
npm install

# Compile contracts
npx hardhat compile

# Start a local testnet
npx hardhat node

# Deploy to local network
npx hardhat run scripts/deploy.js --network localhost
```

## 📂 Structure
- `contracts/Arbitrage.sol` – Core smart contract
- `scripts/deploy.js` – Deployment script
- `test/` – Test cases (optional)
