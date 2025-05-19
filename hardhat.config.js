require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      },
      viaIR: true  // Enable IR-based code generator
    }
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.MAINNET_RPC_URL || "https://eth.llamarpc.com",
        blockNumber: 18500000 // Use a specific block number for consistent testing
      },
      chainId: 1, // To make it compatible with mainnet
      mining: {
        auto: true,
        interval: 5000 // Mine a new block every 5 seconds
      }
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      gas: "auto",
      gasPrice: "auto",
      gasMultiplier: 1.2
    },
    // Actual Ethereum mainnet
    mainnet: {
      url: process.env.MAINNET_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      gasMultiplier: 1.2
    },
    // Sepolia testnet
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: [process.env.PRIVATE_KEY],
      gasMultiplier: 1.2
    },
  },
  mocha: {
    timeout: 100000
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  }
};
