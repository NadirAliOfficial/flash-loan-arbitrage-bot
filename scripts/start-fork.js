const hre = require("hardhat");

async function main() {
  console.log("Starting Hardhat node with mainnet fork...");
  
  await hre.run("node", {
    fork: process.env.MAINNET_RPC_URL,
    blockNumber: 19140000 // This should match the block number in your hardhat.config.js
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  }); 