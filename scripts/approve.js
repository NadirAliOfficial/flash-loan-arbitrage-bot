const hre = require("hardhat");
const { parseEther, formatEther } = require("ethers");

async function main() {
  console.log("Starting WETH approval process...");
  
  // Load environment
  require('dotenv').config();
  
  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("\nDeployer account:", deployer.address);
  
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", formatEther(balance), "ETH");
  
  // Contract addresses
  const WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
  const ARBITRAGE_CONTRACT_ADDRESS = "0xFE92134da38df8c399A90a540f20187D19216E05";
  
  // Create WETH contract instance
  const wethContract = new hre.ethers.Contract(
    WETH_ADDRESS,
    [
      "function balanceOf(address owner) view returns (uint256)",
      "function approve(address spender, uint256 amount) returns (bool)",
      "function allowance(address owner, address spender) view returns (uint256)",
      "function deposit() payable",
      "function transfer(address to, uint amount) returns (bool)"
    ],
    deployer
  );
  
  // Check initial allowance
  const initialAllowance = await wethContract.allowance(deployer.address, ARBITRAGE_CONTRACT_ADDRESS);
  console.log("\nInitial WETH allowance:", formatEther(initialAllowance));
  
  // Deposit some ETH to WETH if needed
  const wethBalance = await wethContract.balanceOf(deployer.address);
  console.log("Current WETH balance:", formatEther(wethBalance));
  
  if (wethBalance < parseEther("5")) {
    console.log("\nDepositing 5 ETH to WETH...");
    const depositAmount = parseEther("5");
    const depositTx = await wethContract.deposit({ value: depositAmount });
    await depositTx.wait();
    
    const newWethBalance = await wethContract.balanceOf(deployer.address);
    console.log("New WETH balance:", formatEther(newWethBalance));
  }
  
  // Approve WETH spending
  console.log("\nApproving WETH for Arbitrage contract...");
  const MAX_UINT256 = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  const approveTx = await wethContract.approve(ARBITRAGE_CONTRACT_ADDRESS, MAX_UINT256);
  
  console.log("Approval transaction sent:", approveTx.hash);
  console.log("Waiting for confirmation...");
  
  const receipt = await approveTx.wait();
  console.log("Approval transaction confirmed in block:", receipt.blockNumber);
  
  // Check new allowance
  const newAllowance = await wethContract.allowance(deployer.address, ARBITRAGE_CONTRACT_ADDRESS);
  console.log("\nNew WETH allowance:", formatEther(newAllowance));
  
  // Optionally transfer some WETH directly to the contract
  const transferAmount = parseEther("1");
  console.log(`\nTransferring ${formatEther(transferAmount)} WETH directly to contract...`);
  const transferTx = await wethContract.transfer(ARBITRAGE_CONTRACT_ADDRESS, transferAmount);
  await transferTx.wait();
  console.log("Transfer completed");
  
  const contractBalance = await wethContract.balanceOf(ARBITRAGE_CONTRACT_ADDRESS);
  console.log("Contract WETH balance:", formatEther(contractBalance));
  
  // Print the contract address to make sure it's correct
  console.log(`Using Arbitrage contract address: ${ARBITRAGE_CONTRACT_ADDRESS}`);
  
  console.log("\nSetup complete!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 