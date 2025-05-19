// SPDX-License-Identifier: MIT
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');
require('dotenv').config();

// Import contract artifacts directly
const arbitrageArtifact = require('../artifacts/contracts/Arbitrage.sol/Arbitrage.json');

async function main() {
  console.log("Deploying Arbitrage Contract (Direct Method)");

  // Load environment variables
  const {
    PRIVATE_KEY,
    RPC_URL,
    AAVE_POOL_PROVIDER_ADDRESS,
    UNISWAP_V2_ROUTER_ADDRESS,
    UNISWAP_V3_ROUTER_ADDRESS,
    SUSHISWAP_ROUTER_ADDRESS,
    BALANCER_VAULT_ADDRESS
  } = process.env;

  // Check for required environment variables
  if (!PRIVATE_KEY || !RPC_URL) {
    console.error("Missing required environment variables (PRIVATE_KEY, RPC_URL)");
    process.exit(1);
  }

  // Set up provider and wallet
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  console.log("Using wallet address:", wallet.address);

  // Check balance
  const balance = await provider.getBalance(wallet.address);
  console.log("Account balance:", ethers.utils.formatEther(balance), "ETH");

  // Contract addresses
  const ADDRESSES = {
    AAVE_POOL_PROVIDER: AAVE_POOL_PROVIDER_ADDRESS || "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    UNISWAP_V2_ROUTER: UNISWAP_V2_ROUTER_ADDRESS || "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    UNISWAP_V3_ROUTER: UNISWAP_V3_ROUTER_ADDRESS || "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    SUSHISWAP_ROUTER: SUSHISWAP_ROUTER_ADDRESS || "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
    BALANCER_VAULT: BALANCER_VAULT_ADDRESS || "0xBA12222222228d8Ba445958a75a0704d566BF2C8"
  };

  // Verify addresses
  console.log("\nUsing addresses:");
  console.log("- AAVE Pool Provider:", ADDRESSES.AAVE_POOL_PROVIDER);
  console.log("- Uniswap V2 Router:", ADDRESSES.UNISWAP_V2_ROUTER);
  console.log("- Uniswap V3 Router:", ADDRESSES.UNISWAP_V3_ROUTER);
  console.log("- Sushiswap Router:", ADDRESSES.SUSHISWAP_ROUTER);
  console.log("- Balancer Vault:", ADDRESSES.BALANCER_VAULT);

  // Create deployment transaction
  console.log("\nCreating contract factory...");
  
  try {
    // Create contract factory
    const factory = new ethers.ContractFactory(
      arbitrageArtifact.abi,
      arbitrageArtifact.bytecode,
      wallet
    );

    // Get current gas price
    const gasPrice = await provider.getGasPrice();
    console.log("Current gas price:", ethers.utils.formatUnits(gasPrice, "gwei"), "gwei");

    // Deploy contract with parameters
    console.log("Deploying contract...");
    const arbitrageContract = await factory.deploy(
      ADDRESSES.AAVE_POOL_PROVIDER,
      ADDRESSES.UNISWAP_V2_ROUTER,
      ADDRESSES.UNISWAP_V3_ROUTER,
      ADDRESSES.SUSHISWAP_ROUTER,
      ADDRESSES.BALANCER_VAULT,
      {
        gasPrice: gasPrice.mul(2) // Double gas price for faster confirmation
      }
    );

    console.log("Waiting for deployment transaction...");
    console.log("Transaction hash:", arbitrageContract.deployTransaction.hash);
    
    await arbitrageContract.deployed();
    console.log("\nContract deployed successfully to:", arbitrageContract.address);

    // Set profit recipient
    console.log("\nSetting profit recipient to wallet address...");
    const setTx = await arbitrageContract.setProfitRecipient(wallet.address);
    console.log("Transaction hash:", setTx.hash);
    
    await setTx.wait();
    console.log("Profit recipient set to:", wallet.address);

    // Verify the setting
    const recipient = await arbitrageContract.profitRecipient();
    console.log("Confirmed profit recipient:", recipient);

    // Save the contract address to .env if needed
    console.log("\n=== Deployment Summary ===");
    console.log("Contract address:", arbitrageContract.address);
    console.log("\nUpdate your .env file with the following:");
    console.log(`ARBITRAGE_CONTRACT_ADDRESS=${arbitrageContract.address}`);

    // Try to automatically update .env file
    try {
      const envPath = path.resolve(process.cwd(), '.env');
      if (fs.existsSync(envPath)) {
        let envContent = fs.readFileSync(envPath, 'utf8');
        
        if (envContent.includes('ARBITRAGE_CONTRACT_ADDRESS=')) {
          // Replace existing value
          envContent = envContent.replace(
            /ARBITRAGE_CONTRACT_ADDRESS=.*/,
            `ARBITRAGE_CONTRACT_ADDRESS=${arbitrageContract.address}`
          );
        } else {
          // Add new value
          envContent += `\nARBITRAGE_CONTRACT_ADDRESS=${arbitrageContract.address}\n`;
        }
        
        fs.writeFileSync(envPath, envContent);
        console.log("Successfully updated .env file with contract address!");
      }
    } catch (error) {
      console.log("Could not automatically update .env file:", error.message);
      console.log("Please manually update the ARBITRAGE_CONTRACT_ADDRESS value.");
    }

    console.log("\nNext steps:");
    console.log("1. Ensure ARBITRAGE_CONTRACT_ADDRESS is in your .env file");
    console.log("2. Run your arbitrage bot with the new contract");
    
    return arbitrageContract.address;
  } catch (error) {
    console.error("Error during deployment:", error);
    console.error(error.message);
    if (error.code === 'INSUFFICIENT_FUNDS') {
      console.error("\nNot enough funds in wallet to deploy contract!");
      console.error("Make sure your wallet has enough ETH for deployment and gas fees.");
    }
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  }); 