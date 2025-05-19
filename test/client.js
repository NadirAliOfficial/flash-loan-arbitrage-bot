// cli.js

const fs = require("fs");
const { ethers } = require("ethers");
const readline = require("readline");
require("dotenv").config();

// Load the FlashLoanArbitrage ABI from artifacts
const artifactPath = "artifacts/contracts/Arbitrage.sol/Arbitrage.json";
const arbitrageArtifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const flashLoanAbi = arbitrageArtifact.abi;

// Setup provider and wallet from environment variables
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Token addresses and symbols
const TOKENS = {
    WBTC: {
        address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
        symbol: "WBTC",
        decimals: 8
    },
    WETH: {
        address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        symbol: "WETH",
        decimals: 18
    },
    USDC: {
        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        symbol: "USDC",
        decimals: 6
    },
    USDT: {
        address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
        symbol: "USDT",
        decimals: 6
    },
    DAI: {
        address: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
        symbol: "DAI",
        decimals: 18
    }
};

// DEX names for logging
const DEX_NAMES = ['UNISWAP', 'SUSHISWAP', 'BALANCER'];

// Create the contract instance
if (!process.env.CONTRACT_ADDRESS) {
    throw new Error("Please set CONTRACT_ADDRESS in your .env file");
}
const contractAddress = process.env.CONTRACT_ADDRESS;
console.log("Using contract at address:", contractAddress);
console.log("Connected with wallet address:", wallet.address);

// Debug: Print available functions from ABI
console.log("\nAvailable contract functions:");
flashLoanAbi
    .filter(item => item.type === "function")
    .forEach(func => console.log(`- ${func.name}`));

const flashLoanContract = new ethers.Contract(contractAddress, flashLoanAbi, wallet);

// ERC20 ABI for token interactions
const ERC20_ABI = [
    "function balanceOf(address owner) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function approve(address spender, uint256 amount) returns (bool)",
    "function symbol() view returns (string)"
];

async function getTokenSymbol(address) {
    for (const [symbol, data] of Object.entries(TOKENS)) {
        if (data.address.toLowerCase() === address.toLowerCase()) {
            return symbol;
        }
    }
    const token = new ethers.Contract(address, ERC20_ABI, provider);
    return await token.symbol();
}

async function formatAmount(amount, tokenAddress) {
    let decimals;
    for (const data of Object.values(TOKENS)) {
        if (data.address.toLowerCase() === tokenAddress.toLowerCase()) {
            decimals = data.decimals;
            break;
        }
    }
    if (!decimals) {
        const token = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        decimals = await token.decimals();
    }
    return ethers.formatUnits(amount, decimals);
}

async function checkTokenAllowance(tokenAddress, amount) {
    const token = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    
    // Check token balance
    const balance = await token.balanceOf(wallet.address);
    const decimals = await token.decimals();
    console.log(`Token balance: ${ethers.formatUnits(balance, decimals)}`);
    
    // Approve contract to spend tokens if needed
    try {
        const tx = await token.approve(contractAddress, amount);
        await tx.wait();
        console.log("Token approval successful");
    } catch (error) {
        console.error("Error approving token:", error);
        throw error;
    }
}

async function monitorArbitrageOpportunities() {
    console.log("\nStarting arbitrage opportunity monitoring...");
    console.log("Monitoring the following tokens:");
    for (const [symbol, data] of Object.entries(TOKENS)) {
        console.log(`${symbol}: ${data.address}`);
    }

    // Create array of token addresses for contract call
    const tokenAddresses = Object.values(TOKENS).map(token => token.address);

    while (true) {
        try {
            console.log("\nChecking for arbitrage opportunities...");
            console.log("Timestamp:", new Date().toISOString());

            // Debug: Log the input parameters
            console.log("Calling findArbitrageOpportunities with tokens:", tokenAddresses);

            // Get all opportunities with error handling
            let opportunities;
            try {
                opportunities = await flashLoanContract.findArbitrageOpportunities(tokenAddresses);
                console.log("Raw response:", opportunities);
            } catch (error) {
                if (error.code === 'BAD_DATA') {
                    console.log("Contract call succeeded but returned empty data. No opportunities found.");
                    opportunities = [];
                } else {
                    throw error;
                }
            }

            if (!opportunities || opportunities.length === 0) {
                console.log("No profitable opportunities found");
            } else {
                console.log(`Found ${opportunities.length} potential opportunities:`);
                
                for (let i = 0; i < opportunities.length; i++) {
                    const opp = opportunities[i];
                    
                    // Format amounts and get symbols
                    const tokenInSymbol = await getTokenSymbol(opp.tokenIn);
                    const tokenOutSymbol = await getTokenSymbol(opp.tokenOut);
                    const amountIn = await formatAmount(opp.amountIn, opp.tokenIn);
                    const profit = opp.expectedProfit.toString() / 100; // Convert basis points to percentage

                    console.log(`\nOpportunity ${i + 1}:`);
                    console.log(`Pair: ${tokenInSymbol}/${tokenOutSymbol}`);
                    console.log(`Amount In: ${amountIn} ${tokenInSymbol}`);
                    console.log(`Expected Profit: ${profit}%`);
                    console.log(`Source DEX: ${DEX_NAMES[opp.sourceDex]}`);
                    console.log(`Target DEX: ${DEX_NAMES[opp.targetDex]}`);
                    console.log(`Source Price: ${ethers.formatUnits(opp.sourcePrice, 18)}`);
                    console.log(`Target Price: ${ethers.formatUnits(opp.targetPrice, 18)}`);
                    
                    // If profit is significant, execute the arbitrage
                    if (profit >= 1.0) { // Only execute if profit is >= 1%
                        console.log("\nExecuting high-profit opportunity...");
                        try {
                            await checkTokenAllowance(opp.tokenIn, opp.amountIn);
                            const tx = await flashLoanContract.executeArbitrage(opp, {
                                gasLimit: 1000000
                            });
                            console.log("Transaction submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("Transaction confirmed in block", receipt.blockNumber);
                            console.log("Gas used:", receipt.gasUsed.toString());
                        } catch (error) {
                            console.error("Error executing arbitrage:");
                            if (error.reason) {
                                console.error("Reason:", error.reason);
                            } else {
                                console.error(error);
                            }
                        }
                    }
                }
            }

            // Wait before next check
            await new Promise(resolve => setTimeout(resolve, 5000)); // 5 second delay
  } catch (error) {
            console.error("Error monitoring opportunities:");
            console.error(error);
            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second delay on error
        }
    }
}

// Start monitoring
monitorArbitrageOpportunities().catch(console.error);
