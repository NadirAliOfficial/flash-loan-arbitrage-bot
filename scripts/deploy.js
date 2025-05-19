const hre = require("hardhat");

async function deployContract(deployer, ADDRESSES) {
  console.log(`\n=== Deploying Arbitrage Contract ===`);
  
  // Get the nonce
  const nonce = await deployer.getTransactionCount();
  console.log(`Current nonce for ${deployer.address}: ${nonce}`);
  
  // Get the contract factory
  const Arbitrage = await hre.ethers.getContractFactory("Arbitrage", deployer);
  
  // Get current gas price - using older ethers methods
  const gasPrice = await hre.ethers.provider.getGasPrice();
  console.log("Current gas price:", hre.ethers.utils.formatUnits(gasPrice, "gwei"), "gwei");
  
  // Deploy the contract
  console.log("\nDeploying contract...");
  const arbitrage = await Arbitrage.deploy(
    ADDRESSES.AAVE_POOL_PROVIDER,
    ADDRESSES.UNISWAP_V2_ROUTER,
    ADDRESSES.UNISWAP_V3_ROUTER,
    ADDRESSES.SUSHISWAP_ROUTER,
    ADDRESSES.BALANCER_VAULT,
    {
      gasPrice: gasPrice.mul(2) // Double the current gas price to ensure it goes through
    }
  );
  
  console.log("Waiting for deployment transaction...");
  await arbitrage.deployed();
  console.log("Contract deployed to:", arbitrage.address);
  
  // Set profit recipient to deployer wallet
  console.log("\nSetting profit recipient to deployer wallet...");
  try {
    const setTx = await arbitrage.setProfitRecipient(deployer.address);
    console.log("Transaction sent:", setTx.hash);
    await setTx.wait();
    console.log("Profit recipient set to:", deployer.address);
    
    // Verify the profit recipient was set correctly
    const recipient = await arbitrage.profitRecipient();
    console.log("Confirmed profit recipient:", recipient);
  } catch (error) {
    console.log("Failed to set profit recipient:", error.message);
  }
  
  return arbitrage.address;
}

async function main() {
  console.log("Starting Arbitrage Contract Deployment");

  // Get deployer account - using older ethers/hardhat method
  const [deployer] = await hre.ethers.getSigners();
  console.log("\nDeployer account:", deployer.address);
  
  const balance = await deployer.getBalance();
  console.log("Account balance:", hre.ethers.utils.formatEther(balance), "ETH");

  // Contract addresses for mainnet (these will be available on our fork)
  const ADDRESSES = {
    AAVE_POOL_PROVIDER: process.env.AAVE_POOL_PROVIDER_ADDRESS || "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
    UNISWAP_V2_ROUTER: process.env.UNISWAP_V2_ROUTER_ADDRESS || "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    UNISWAP_V3_ROUTER: process.env.UNISWAP_V3_ROUTER_ADDRESS || "0xE592427A0AEce92De3Edee1F18E0157C05861564",
    SUSHISWAP_ROUTER: process.env.SUSHISWAP_ROUTER_ADDRESS || "0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F",
    BALANCER_VAULT: process.env.BALANCER_VAULT_ADDRESS || "0xBA12222222228d8Ba445958a75a0704d566BF2C8"
  };

  // Verify addresses
  console.log("\nUsing addresses:");
  console.log("- AAVE Pool Provider:", ADDRESSES.AAVE_POOL_PROVIDER);
  console.log("- Uniswap V2 Router:", ADDRESSES.UNISWAP_V2_ROUTER);
  console.log("- Uniswap V3 Router:", ADDRESSES.UNISWAP_V3_ROUTER);
  console.log("- Sushiswap Router:", ADDRESSES.SUSHISWAP_ROUTER);
  console.log("- Balancer Vault:", ADDRESSES.BALANCER_VAULT);

  // Deploy the contract
  const contractAddress = await deployContract(deployer, ADDRESSES);

  console.log("\n=== Deployment Summary ===");
  console.log("Contract address:", contractAddress);
  console.log("\nUpdate your .env file with the following:");
  console.log(`ARBITRAGE_CONTRACT_ADDRESS=${contractAddress}`);
  
  // Verify contract on Etherscan (if not using local network)
  const networkName = hre.network.name;
  if (networkName !== "hardhat" && networkName !== "localhost") {
    console.log("\nWaiting for block confirmations to verify on Etherscan...");
    
    try {
      await hre.run("verify:verify", {
        address: contractAddress,
        constructorArguments: [
          ADDRESSES.AAVE_POOL_PROVIDER,
          ADDRESSES.UNISWAP_V2_ROUTER,
          ADDRESSES.UNISWAP_V3_ROUTER,
          ADDRESSES.SUSHISWAP_ROUTER,
          ADDRESSES.BALANCER_VAULT
        ],
      });
      console.log("Contract verified on Etherscan");
    } catch (error) {
      console.log("Error verifying contract:", error.message);
    }
  } else {
    console.log("\nSkipping Etherscan verification on local network");
  }
  
  console.log("\nNext steps:");
  console.log("1. Update ARBITRAGE_CONTRACT_ADDRESS in your .env file");
  console.log("2. Run your arbitrage bot with the new contract");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 