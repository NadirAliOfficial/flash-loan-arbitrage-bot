// cli.js

const fs = require("fs");
const { ethers } = require("ethers");
const readline = require("readline");
require("dotenv").config();

// Load the FlashLoanArbitrage ABI from a JSON file.
const flashLoanAbi = JSON.parse(fs.readFileSync("./abis/FlashLoanArbitrage.json", "utf8"));

// Setup provider and wallet from environment variables.
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Create the contract instance.
const contractAddress = process.env.CONTRACT_ADDRESS;
const flashLoanContract = new ethers.Contract(contractAddress, flashLoanAbi, wallet);

// Utility function to prompt for user input.
function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    })
  );
}

// Main function to interact with the smart contract.
async function main() {
  // Prompt for inputs
  const asset = await askQuestion("Enter asset token address: ");
  const amountStr = await askQuestion("Enter flash loan amount (in ether): ");
  const swapToken = await askQuestion("Enter swap token address: ");
  const buyOnUniInput = await askQuestion("Should buy on Uniswap first? (true/false): ");

  // Process inputs
  const buyOnUni = buyOnUniInput.toLowerCase() === "true";
  const flashLoanAmount = ethers.utils.parseEther(amountStr);
  const path = [asset, swapToken];

  console.log("\nRequesting flash loan arbitrage with the following parameters:");
  console.log(" Asset Token:         ", asset);
  console.log(" Loan Amount (wei):   ", flashLoanAmount.toString());
  console.log(" Swap Token:          ", swapToken);
  console.log(" Buy on Uniswap first:", buyOnUni, "\n");

  try {
    // Call the flash loan function on the contract.
    const tx = await flashLoanContract.requestFlashLoan(asset, flashLoanAmount, path, buyOnUni);
    console.log("Transaction submitted. TX hash:", tx.hash);

    // Wait for confirmation.
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block", receipt.blockNumber);
    console.log("Flash loan arbitrage executed successfully.");
  } catch (error) {
    console.error("Error executing flash loan arbitrage:", error);
  }
}

main();
