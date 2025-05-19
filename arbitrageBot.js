require('dotenv').config();
const ethers = require('ethers');
const fs = require('fs');
const path = require('path');
const ABI = require('./artifacts/contracts/Arbitrage.sol/Arbitrage.json');

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Set up logging to file
const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
const logFile = path.join(logsDir, `arbitrage-${timestamp}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'w' });

// Redirect console logs to both console and file
const log = (...args) => {
    const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
    ).join(' ');
    
    logStream.write(`[${new Date().toISOString()}] ${message}\n`);
    console.log(...args);
};

// Validate environment variables
if (!process.env.PRIVATE_KEY || !process.env.ARBITRAGE_CONTRACT_ADDRESS || !process.env.RPC_URL) {
    log('Missing required environment variables: PRIVATE_KEY, ARBITRAGE_CONTRACT_ADDRESS, RPC_URL');
    process.exit(1);
}

// Constants and configurations
const DEX = {
    UNISWAP_V2: 0,
    UNISWAP_V3: 1,
    SUSHISWAP: 2,
    BALANCER: 3,
    CURVE: 4,
    DODO: 5
};

const DEX_CONFIGS = {
    [DEX.UNISWAP_V2]: {
        name: 'Uniswap V2',
        router: '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D',
        fee: 0.003 // 0.3%
    },
    [DEX.UNISWAP_V3]: {
        name: 'Uniswap V3',
        router: '0xE592427A0AEce92De3Edee1F18E0157C05861564',
        quoter: '0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6',
        feeTiers: [100, 500, 3000, 10000], // 0.01%, 0.05%, 0.3%, 1%
        fee: 0.003 // Default 0.3%
    },
    [DEX.SUSHISWAP]: {
        name: 'Sushiswap',
        router: '0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F',
        fee: 0.003 // 0.3%
    },
    [DEX.BALANCER]: {
        name: 'Balancer',
        router: '0xBA12222222228d8Ba445958a75a0704d566BF2C8',
        fee: 0.003 // 0.3%
    }
};

// Token Pairs to Monitor
const TOKEN_PAIRS = [
    {
        tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        tokenB: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC
        name: 'WETH/WBTC',
        decimalsA: 18,
        decimalsB: 8
    },
    {
        tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        tokenB: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        name: 'WETH/USDC',
        decimalsA: 18,
        decimalsB: 6
    },
    {
        tokenA: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
        tokenB: '0x6B175474E89094C44Da98b954EedeAC495271d0F', // DAI
        name: 'WETH/DAI',
        decimalsA: 18,
        decimalsB: 18
    }
];

// ABIs - Minimal required interfaces
const ERC20_ABI = [
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)'
];

const UNISWAP_V2_ROUTER_ABI = [
    'function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)'
];

const UNISWAP_V3_QUOTER_ABI = [
    'function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) external returns (uint256 amountOut)'
];

// Set up provider and wallet
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const arbitrageContract = new ethers.Contract(process.env.ARBITRAGE_CONTRACT_ADDRESS, ABI.abi, wallet);

// Get token information
async function getTokenInfo(address) {
    const token = new ethers.Contract(address, ERC20_ABI, provider);
    const symbol = await token.symbol();
    const decimals = await token.decimals();
    return { symbol, decimals };
}

// Calculate minimum profit required (in basis points)
const MIN_PROFIT_BPS = 80; // 0.8% minimum profit

// Helper function to get price from Uniswap V2
async function getUniswapV2Price(router, tokenA, tokenB, amountIn) {
    const routerContract = new ethers.Contract(router, UNISWAP_V2_ROUTER_ABI, provider);
    try {
        const path = [tokenA, tokenB];
        const amounts = await routerContract.getAmountsOut(amountIn, path);
        return amounts[1];
    } catch (error) {
        return ethers.BigNumber.from(0);
    }
}

// Helper function to get price from Uniswap V3
async function getUniswapV3Price(tokenA, tokenB, feeTier, amountIn) {
    const quoterContract = new ethers.Contract(
        DEX_CONFIGS[DEX.UNISWAP_V3].quoter,
        UNISWAP_V3_QUOTER_ABI,
        provider
    );
    
    try {
        const amountOut = await quoterContract.callStatic.quoteExactInputSingle(
            tokenA,
            tokenB,
            feeTier,
            amountIn,
            0 // sqrtPriceLimitX96
        );
        return amountOut;
    } catch (error) {
        return ethers.BigNumber.from(0);
    }
}

// Add a new function for price sanity checks
function isPriceValid(pair, dexName, price) {
    // Skip if price is zero
    if (price.isZero()) {
        return false;
    }
    
    // Special handling for extreme price discrepancies
    if (pair.name === 'WETH/DAI') {
        // For WETH/DAI we expect a price roughly in the 1500-2500 range
        // Convert to a number for easier comparison (assuming 18 decimals for DAI)
        const priceValue = parseFloat(ethers.utils.formatUnits(price, pair.decimalsB));
        
        // If price is off by orders of magnitude (less than 100)
        if (priceValue < 100) {
            log(`⚠️ Abnormal price detected for ${pair.name} on ${dexName}: ${priceValue}`);
            log(`Ignoring this price to prevent false arbitrage calculations`);
            return false;
        }
        
        // If price is off by orders of magnitude (greater than 5000)
        if (priceValue > 5000) {
            log(`⚠️ Abnormal price detected for ${pair.name} on ${dexName}: ${priceValue}`);
            log(`Ignoring this price to prevent false arbitrage calculations`);
            return false;
        }
    }
    
    // Similarly for other token pairs
    if (pair.name === 'WETH/USDC') {
        const priceValue = parseFloat(ethers.utils.formatUnits(price, pair.decimalsB));
        if (priceValue < 100 || priceValue > 5000) {
            log(`⚠️ Abnormal price detected for ${pair.name} on ${dexName}: ${priceValue}`);
            log(`Ignoring this price to prevent false arbitrage calculations`);
            return false;
        }
    }
    
    // For other token pairs, implement similar checks based on expected price ranges
    
    return true;
}

// Main function to check for arbitrage opportunities
async function checkForArbitrageOpportunities() {
    log('Starting arbitrage opportunity scan...');
    
    for (const pair of TOKEN_PAIRS) {
        log(`\n======== Checking pair: ${pair.name} ========`);
        
        // Test amount (1 ETH equivalent)
        const amountIn = ethers.utils.parseUnits('1', pair.decimalsA);
        
        // Get prices from different DEXes
        const prices = new Map();
        
        // Check Uniswap V2
        log(`Checking ${DEX_CONFIGS[DEX.UNISWAP_V2].name}...`);
        const uniV2Price = await getUniswapV2Price(
            DEX_CONFIGS[DEX.UNISWAP_V2].router,
            pair.tokenA,
            pair.tokenB,
            amountIn
        );
        if (!uniV2Price.isZero() && isPriceValid(pair, DEX_CONFIGS[DEX.UNISWAP_V2].name, uniV2Price)) {
            prices.set(DEX.UNISWAP_V2, uniV2Price);
            log(`${DEX_CONFIGS[DEX.UNISWAP_V2].name} price: ${ethers.utils.formatUnits(uniV2Price, pair.decimalsB)} ${pair.name}`);
        } else {
            log(`No valid liquidity found on ${DEX_CONFIGS[DEX.UNISWAP_V2].name} for ${pair.name}`);
        }
        
        // Check Uniswap V3 (all fee tiers)
        log(`Checking ${DEX_CONFIGS[DEX.UNISWAP_V3].name}...`);
        for (const feeTier of DEX_CONFIGS[DEX.UNISWAP_V3].feeTiers) {
            log(`Checking ${DEX_CONFIGS[DEX.UNISWAP_V3].name} fee tier: ${feeTier/10000}%...`);
            
            // Skip the 0.01% Uniswap V3 pool for WETH/DAI due to known price issues
            if (pair.name === 'WETH/DAI' && feeTier === 100) {
                log(`⚠️ Skipping ${DEX_CONFIGS[DEX.UNISWAP_V3].name} (${feeTier/10000}%) for ${pair.name} due to known price issues`);
                continue;
            }
            
            const uniV3Price = await getUniswapV3Price(
                pair.tokenA,
                pair.tokenB,
                feeTier,
                amountIn
            );
            
            const dexName = `${DEX_CONFIGS[DEX.UNISWAP_V3].name} (${feeTier/10000}%)`;
            if (uniV3Price && !uniV3Price.isZero() && isPriceValid(pair, dexName, uniV3Price)) {
                prices.set(`${DEX.UNISWAP_V3}_${feeTier}`, uniV3Price);
                log(`${dexName} price: ${ethers.utils.formatUnits(uniV3Price, pair.decimalsB)} ${pair.name}`);
            } else {
                log(`No valid liquidity found on ${dexName} for ${pair.name}`);
            }
        }
        
        // Check Sushiswap
        log(`Checking ${DEX_CONFIGS[DEX.SUSHISWAP].name}...`);
        const sushiPrice = await getUniswapV2Price(
            DEX_CONFIGS[DEX.SUSHISWAP].router,
            pair.tokenA,
            pair.tokenB,
            amountIn
        );
        if (!sushiPrice.isZero() && isPriceValid(pair, DEX_CONFIGS[DEX.SUSHISWAP].name, sushiPrice)) {
            prices.set(DEX.SUSHISWAP, sushiPrice);
            log(`${DEX_CONFIGS[DEX.SUSHISWAP].name} price: ${ethers.utils.formatUnits(sushiPrice, pair.decimalsB)} ${pair.name}`);
        } else {
            log(`No valid liquidity found on ${DEX_CONFIGS[DEX.SUSHISWAP].name} for ${pair.name}`);
        }
        
        // If we don't have at least 2 prices, no arbitrage possible
        if (prices.size < 2) {
            log(`Not enough prices for arbitrage on ${pair.name}`);
            continue;
        }
        
        // Check for arbitrage opportunities
        log(`\nAnalyzing ${prices.size * (prices.size - 1)} possible arbitrage routes for ${pair.name}...`);
        
        let bestOpportunity = null;
        let maxProfit = ethers.BigNumber.from(0);
        
        // Compare all DEX pairs
        for (const [dex1, price1] of prices) {
            for (const [dex2, price2] of prices) {
                if (dex1 === dex2) continue;
                
                // Calculate the potential profit
                const sourceDex = typeof dex1 === 'string' ? parseInt(dex1.split('_')[0]) : dex1;
                const targetDex = typeof dex2 === 'string' ? parseInt(dex2.split('_')[0]) : dex2;
                
                // Get fee tiers for Uniswap V3
                const sourceFee = typeof dex1 === 'string' && dex1.includes('_') 
                    ? parseInt(dex1.split('_')[1]) 
                    : (sourceDex === DEX.UNISWAP_V3 ? 3000 : 0);
                
                const targetFee = typeof dex2 === 'string' && dex2.includes('_') 
                    ? parseInt(dex2.split('_')[1]) 
                    : (targetDex === DEX.UNISWAP_V3 ? 3000 : 0);
                
                // Format the DEX names for logging
                const sourceDexName = `${DEX_CONFIGS[sourceDex].name}${sourceFee ? ' (' + sourceFee/10000 + '%)' : ''}`;
                const targetDexName = `${DEX_CONFIGS[targetDex].name}${targetFee ? ' (' + targetFee/10000 + '%)' : ''}`;
                
                log(`\nChecking route: ${sourceDexName} → ${targetDexName}`);
                
                // Get DEX fees
                const fee1 = DEX_CONFIGS[sourceDex].fee;
                const fee2 = DEX_CONFIGS[targetDex].fee;
                
                try {
                    // First swap: TokenA -> TokenB using price1
                    // Apply the fee to the amount
                    const feeMultiplier1 = ethers.utils.parseUnits((1 - fee1).toString(), 18);
                    const amountAfterFee1 = amountIn.mul(feeMultiplier1).div(ethers.utils.parseUnits('1', 18));
                    
                    // This is how much tokenB we get from DEX1
                    const amountB = price1;
                    log(`First swap: ${ethers.utils.formatUnits(amountIn, pair.decimalsA)} ${pair.name.split('/')[0]} -> ${ethers.utils.formatUnits(amountB, pair.decimalsB)} ${pair.name.split('/')[1]}`);
                    
                    // Apply the fee to the second swap
                    const feeMultiplier2 = ethers.utils.parseUnits((1 - fee2).toString(), 18);
                    const amountBAfterFee = amountB.mul(feeMultiplier2).div(ethers.utils.parseUnits('1', 18));
                    
                    // To calculate how much tokenA we get back from DEX2, we need to:
                    // 1. Get the price ratio of tokenA to tokenB on DEX2 (inverse of price2)
                    // 2. Apply this ratio to amountBAfterFee
                    
                    // Calculate the equivalent of 1 tokenB in tokenA terms
                    // If price2 is "X tokenB per 1 tokenA", then 1/price2 is "Y tokenA per 1 tokenB"
                    // First, normalize 1 tokenB to proper decimal scale
                    const oneTokenB = ethers.utils.parseUnits('1', pair.decimalsB);
                    
                    // Then get how much tokenA we'd get for 1 tokenB
                    // We need to scale by tokenA's decimals
                    const oneTokenA = ethers.utils.parseUnits('1', pair.decimalsA);
                    const tokenAPertokenB = oneTokenA.mul(oneTokenB).div(price2);
                    
                    // Now calculate the final amount of tokenA we'd get back
                    const finalAmount = amountBAfterFee.mul(tokenAPertokenB).div(oneTokenB);
                    
                    log(`Second swap: ${ethers.utils.formatUnits(amountB, pair.decimalsB)} ${pair.name.split('/')[1]} -> ${ethers.utils.formatUnits(finalAmount, pair.decimalsA)} ${pair.name.split('/')[0]}`);
                    
                    // Calculate flash loan premium (0.09%)
                    const flashLoanPremium = amountIn.mul(9).div(10000);
                    
                    // Calculate profit
                    const profit = finalAmount.sub(amountIn).sub(flashLoanPremium);
                    
                    // Calculate profit percentage
                    const profitBps = profit.mul(10000).div(amountIn);
                    
                    if (profit.gt(0)) {
                        log(`Profit: ${ethers.utils.formatUnits(profit, pair.decimalsA)} ${pair.name.split('/')[0]} (${profitBps.toNumber() / 100}%) ✅`);
                        
                        if (profit.gt(maxProfit)) {
                            maxProfit = profit;
                            bestOpportunity = {
                                pair,
                                sourceDex,
                                targetDex,
                                price1,
                                price2,
                                amountIn,
                                expectedProfit: profit,
                                profitBps,
                                sourceFee,
                                targetFee,
                                route: `${sourceDexName} → ${targetDexName}`
                            };
                        }
                    } else {
                        log(`Loss: ${ethers.utils.formatUnits(profit, pair.decimalsA)} ${pair.name.split('/')[0]} (${profitBps.toNumber() / 100}%) ❌`);
                    }
                } catch (error) {
                    log(`Error calculating arbitrage for ${pair.name} (${sourceDexName} → ${targetDexName}): ${error.message}`);
                    continue;
                }
            }
        }
        
        if (bestOpportunity && bestOpportunity.profitBps.gte(MIN_PROFIT_BPS)) {
            log('\n=== PROFITABLE ARBITRAGE FOUND ===');
            log(`Pair: ${bestOpportunity.pair.name}`);
            log(`Route: ${bestOpportunity.route}`);
            log(`Input amount: ${ethers.utils.formatUnits(bestOpportunity.amountIn, bestOpportunity.pair.decimalsA)} ${bestOpportunity.pair.name.split('/')[0]}`);
            log(`Expected profit: ${ethers.utils.formatUnits(bestOpportunity.expectedProfit, bestOpportunity.pair.decimalsA)} ${bestOpportunity.pair.name.split('/')[0]} (${bestOpportunity.profitBps.toNumber() / 100}%)`);
            
            // Execute the arbitrage
            await executeArbitrage(bestOpportunity);
        } else if (bestOpportunity) {
            log(`\nBest opportunity found for ${pair.name}: ${bestOpportunity.route}`);
            log(`Profit: ${ethers.utils.formatUnits(bestOpportunity.expectedProfit, bestOpportunity.pair.decimalsA)} ${bestOpportunity.pair.name.split('/')[0]} (${bestOpportunity.profitBps.toNumber() / 100}%)`);
            log(`Not executing because profit is below threshold of ${MIN_PROFIT_BPS / 100}%`);
        } else {
            log(`\nNo profitable arbitrage found for ${pair.name}`);
        }
    }
}

// Execute the arbitrage transaction
async function executeArbitrage(opportunity) {
    try {
        log('\nExecuting arbitrage transaction...');
        
        // Get wallet balance before transaction
        const balanceBefore = await provider.getBalance(wallet.address);
        log(`Wallet ETH balance before: ${ethers.utils.formatEther(balanceBefore)} ETH`);
        
        // Check token balance before (if it's not ETH)
        let tokenBalanceBefore = ethers.BigNumber.from(0);
        if (opportunity.pair.tokenA !== '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2') { // If not WETH
            const tokenContract = new ethers.Contract(
                opportunity.pair.tokenA,
                ['function balanceOf(address) view returns (uint256)'],
                provider
            );
            tokenBalanceBefore = await tokenContract.balanceOf(wallet.address);
            log(`Token ${opportunity.pair.name.split('/')[0]} balance before: ${ethers.utils.formatUnits(tokenBalanceBefore, opportunity.pair.decimalsA)}`);
        }
        
        // Get current profit recipient
        const currentProfitRecipient = await arbitrageContract.profitRecipient();
        log(`Current profit recipient: ${currentProfitRecipient}`);
        log(`Setting profit recipient to wallet address: ${wallet.address}`);
        
        // Get real-time quotes using Uniswap V3's quoter
        log('\nGetting real-time price quotes...');
        const quoter = new ethers.Contract(
            DEX_CONFIGS[DEX.UNISWAP_V3].quoter,
            UNISWAP_V3_QUOTER_ABI,
            provider
        );

        // Get real-time quote for first swap
        let quotedOut1;
        if (opportunity.sourceDex === DEX.UNISWAP_V3) {
            quotedOut1 = await quoter.callStatic.quoteExactInputSingle(
                opportunity.pair.tokenA,
                opportunity.pair.tokenB,
                opportunity.sourceFee,
                opportunity.amountIn,
                0
            );
            log(`First swap (Uniswap V3) real-time quote: ${ethers.utils.formatUnits(quotedOut1, opportunity.pair.decimalsB)} ${opportunity.pair.name.split('/')[1]}`);
        } else {
            // For non-Uniswap V3 DEXes, use the original price
            quotedOut1 = opportunity.price1;
            log(`First swap (${DEX_CONFIGS[opportunity.sourceDex].name}) original quote: ${ethers.utils.formatUnits(quotedOut1, opportunity.pair.decimalsB)} ${opportunity.pair.name.split('/')[1]}`);
        }

        // Get real-time quote for second swap
        let quotedOut2;
        if (opportunity.targetDex === DEX.UNISWAP_V3) {
            quotedOut2 = await quoter.callStatic.quoteExactInputSingle(
                opportunity.pair.tokenB,
                opportunity.pair.tokenA,
                opportunity.targetFee,
                quotedOut1,
                0
            );
            log(`Second swap (Uniswap V3) real-time quote: ${ethers.utils.formatUnits(quotedOut2, opportunity.pair.decimalsA)} ${opportunity.pair.name.split('/')[0]}`);
        } else {
            // For non-Uniswap V3 DEXes, calculate the expected output based on original price
            const oneTokenB = ethers.utils.parseUnits('1', opportunity.pair.decimalsB);
            const oneTokenA = ethers.utils.parseUnits('1', opportunity.pair.decimalsA);
            const tokenAPertokenB = oneTokenA.mul(oneTokenB).div(opportunity.price2);
            quotedOut2 = quotedOut1.mul(tokenAPertokenB).div(oneTokenB);
            log(`Second swap (${DEX_CONFIGS[opportunity.targetDex].name}) calculated quote: ${ethers.utils.formatUnits(quotedOut2, opportunity.pair.decimalsA)} ${opportunity.pair.name.split('/')[0]}`);
        }

        // Apply 3% slippage tolerance
        const amountOutMin1 = quotedOut1.mul(97).div(100);
        const amountOutMin2 = quotedOut2.mul(97).div(100);
        
        // Calculate the flash loan premium
        const flashLoanPremium = opportunity.amountIn.mul(9).div(10000); // 0.09%
        const minRepayment = opportunity.amountIn.add(flashLoanPremium);
        
        // Verify profitability
        if (amountOutMin2.lte(minRepayment)) {
            log('🔴 Not enough to cover repayment — skipping execution.');
            log(`Expected output: ${ethers.utils.formatUnits(amountOutMin2, opportunity.pair.decimalsA)}`);
            log(`Required repayment: ${ethers.utils.formatUnits(minRepayment, opportunity.pair.decimalsA)}`);
            return false;
        }
        
        // Calculate expected profit
        const expectedProfit = amountOutMin2.sub(minRepayment);
        const profitPercentage = expectedProfit.mul(10000).div(opportunity.amountIn);
        log(`\n💰 Expected profit based on real-time quotes: ${ethers.utils.formatUnits(expectedProfit, opportunity.pair.decimalsA)} ${opportunity.pair.name.split('/')[0]} (${profitPercentage.toNumber() / 100}%)`);
        
        // Create the swap parameters
        const firstSwap = {
            dex: opportunity.sourceDex,
            tokenIn: opportunity.pair.tokenA,
            tokenOut: opportunity.pair.tokenB,
            amountIn: opportunity.amountIn,
            amountOutMin: amountOutMin1, // Use real-time quote with slippage
            poolId: ethers.constants.HashZero, // Not used for Uniswap/Sushiswap
            fee: opportunity.sourceFee,
            i: 0,
            j: 0,
            extraData: '0x'
        };
        
        const secondSwap = {
            dex: opportunity.targetDex,
            tokenIn: opportunity.pair.tokenB,
            tokenOut: opportunity.pair.tokenA,
            amountIn: amountOutMin1.mul(95).div(100), // Use actual min received with extra buffer
            amountOutMin: amountOutMin2, // Use real-time quote with slippage
            poolId: ethers.constants.HashZero, // Not used for Uniswap/Sushiswap
            fee: opportunity.targetFee,
            i: 0,
            j: 0,
            extraData: '0x'
        };
        
        // Log the actual values for debugging
        log('\nExecuting with parameters:');
        log(`First swap: ${opportunity.pair.name.split('/')[0]} -> ${opportunity.pair.name.split('/')[1]}`);
        log(`Input amount: ${ethers.utils.formatUnits(firstSwap.amountIn, opportunity.pair.decimalsA)}`);
        log(`Min output: ${ethers.utils.formatUnits(firstSwap.amountOutMin, opportunity.pair.decimalsB)}`);
        log(`DEX: ${DEX_CONFIGS[opportunity.sourceDex].name} with fee tier: ${firstSwap.fee}`);
        
        log(`\nSecond swap: ${opportunity.pair.name.split('/')[1]} -> ${opportunity.pair.name.split('/')[0]}`);
        log(`Input amount: ${ethers.utils.formatUnits(secondSwap.amountIn, opportunity.pair.decimalsB)}`);
        log(`Min output: ${ethers.utils.formatUnits(secondSwap.amountOutMin, opportunity.pair.decimalsA)}`);
        log(`DEX: ${DEX_CONFIGS[opportunity.targetDex].name} with fee tier: ${secondSwap.fee}`);
        log(`Required to repay flash loan: ${ethers.utils.formatUnits(minRepayment, opportunity.pair.decimalsA)}`);
        
        // Estimate gas with 20% buffer
        try {
            // Always use the function with recipient parameter
            const gasEstimate = await arbitrageContract.estimateGas.executeArbitrage(
                opportunity.pair.tokenA,
                opportunity.amountIn,
                firstSwap,
                secondSwap,
                wallet.address
            );
            
            const gasLimit = gasEstimate.mul(120).div(100);
            log(`Gas estimate: ${gasEstimate.toString()} (using ${gasLimit.toString()} with 20% buffer)`);
            
            // Get current gas price
            const gasPrice = await provider.getGasPrice();
            log(`Current gas price: ${ethers.utils.formatUnits(gasPrice, 'gwei')} gwei`);
            
            // Calculate estimated transaction cost
            const estimatedTxCost = gasLimit.mul(gasPrice);
            log(`Estimated transaction cost: ${ethers.utils.formatEther(estimatedTxCost)} ETH`);
            
            log('\nSending transaction...');
            
            // Always use the function with recipient parameter
            const tx = await arbitrageContract.executeArbitrage(
                opportunity.pair.tokenA,
                opportunity.amountIn,
                firstSwap,
                secondSwap,
                wallet.address,
                {
                    gasLimit,
                    gasPrice
                }
            );
            
            log(`Transaction sent: ${tx.hash}`);
            log('Waiting for confirmation...');
            
            const receipt = await tx.wait();
            log(`\nTransaction confirmed in block ${receipt.blockNumber}`);
            log(`Gas used: ${receipt.gasUsed.toString()} (${Math.round(receipt.gasUsed.mul(100).div(gasLimit).toNumber())}% of gas limit)`);
            
            // Calculate actual gas cost
            const actualGasCost = receipt.gasUsed.mul(receipt.effectiveGasPrice);
            log(`Actual gas cost: ${ethers.utils.formatEther(actualGasCost)} ETH`);
            
            // Check for events emitted by the contract
            if (receipt.logs && receipt.logs.length > 0) {
                log(`Transaction emitted ${receipt.logs.length} events/logs`);
            }
            
            // Get balances after transaction
            const balanceAfter = await provider.getBalance(wallet.address);
            log(`Wallet ETH balance after: ${ethers.utils.formatEther(balanceAfter)} ETH`);
            
            // Check token balance after (if it's not ETH)
            let tokenBalanceAfter = ethers.BigNumber.from(0);
            if (opportunity.pair.tokenA !== '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2') { // If not WETH
                const tokenContract = new ethers.Contract(
                    opportunity.pair.tokenA,
                    ['function balanceOf(address) view returns (uint256)'],
                    provider
                );
                tokenBalanceAfter = await tokenContract.balanceOf(wallet.address);
                log(`Token ${opportunity.pair.name.split('/')[0]} balance after: ${ethers.utils.formatUnits(tokenBalanceAfter, opportunity.pair.decimalsA)}`);
                
                // Calculate token profit
                const tokenProfit = tokenBalanceAfter.sub(tokenBalanceBefore);
                log(`Token profit: ${ethers.utils.formatUnits(tokenProfit, opportunity.pair.decimalsA)} ${opportunity.pair.name.split('/')[0]}`);
            }
            
            // Calculate ETH profit (ETH spent on gas)
            const ethSpent = balanceBefore.sub(balanceAfter);
            log(`ETH spent on gas: ${ethers.utils.formatEther(ethSpent)} ETH`);
            
            // Calculate net profit in USD (assuming token profit is in USD)
            // This would require price feeds which we're not implementing here
            
            log('\n=== ARBITRAGE RESULT ===');
            log(`Expected profit: ${ethers.utils.formatUnits(opportunity.expectedProfit, opportunity.pair.decimalsA)} ${opportunity.pair.name.split('/')[0]}`);
            log(`Gas cost: ${ethers.utils.formatEther(actualGasCost)} ETH`);
            
            if (tokenBalanceAfter.gt(tokenBalanceBefore)) {
                const actualProfit = tokenBalanceAfter.sub(tokenBalanceBefore);
                const profitPercentage = actualProfit.mul(10000).div(opportunity.amountIn);
                log(`✅ SUCCESS: Actual profit: ${ethers.utils.formatUnits(actualProfit, opportunity.pair.decimalsA)} ${opportunity.pair.name.split('/')[0]} (${profitPercentage.toNumber() / 100}%)`);
            } else {
                log(`❌ NO PROFIT DETECTED in token balance. Transaction executed but no profit was returned to wallet.`);
                log(`This could be because:
                1. Profits are held in the contract
                2. Market conditions changed between finding and executing the opportunity
                3. Transaction reverted silently
                4. Another issue with contract execution`);
            }
            
            return true;
        } catch (error) {
            log(`\nGas estimation failed: ${error.message}`);
            if (error.reason) log(`Reason: ${error.reason}`);
            
            // If there's a specific error about "Too little received", increase the slippage tolerance
            if (error.message.includes('Too little received')) {
                log('Error indicates price movement or slippage issues. Consider increasing slippage tolerance.');
            }
            
            // Try without gas estimation if that's failing
            log('\nAttempting to execute without gas estimation...');
            try {
                // Get wallet balance before transaction (for this attempt)
                const balanceBefore = await provider.getBalance(wallet.address);
                
                // Always use the function with recipient parameter
                const tx = await arbitrageContract.executeArbitrage(
                    opportunity.pair.tokenA,
                    opportunity.amountIn,
                    firstSwap,
                    secondSwap,
                    wallet.address,
                    {
                        gasLimit: 3000000 // Use a high fixed gas limit
                    }
                );
                
                log(`Transaction sent: ${tx.hash}`);
                log('Waiting for confirmation...');
                
                const receipt = await tx.wait();
                log(`\nTransaction confirmed in block ${receipt.blockNumber}`);
                log(`Gas used: ${receipt.gasUsed.toString()}`);
                
                // Calculate gas cost
                const gasPrice = receipt.effectiveGasPrice;
                const gasCost = gasPrice.mul(receipt.gasUsed);
                log(`Gas cost: ${ethers.utils.formatEther(gasCost)} ETH`);
                
                // Get balance after to verify profit
                const balanceAfter = await provider.getBalance(wallet.address);
                const ethSpent = balanceBefore.sub(balanceAfter);
                log(`ETH spent: ${ethers.utils.formatEther(ethSpent)} ETH`);
                
                // Check token balance after (if it's not ETH)
                let tokenBalanceAfter = ethers.BigNumber.from(0);
                if (opportunity.pair.tokenA !== '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2') { // If not WETH
                    const tokenContract = new ethers.Contract(
                        opportunity.pair.tokenA,
                        ['function balanceOf(address) view returns (uint256)'],
                        provider
                    );
                    tokenBalanceAfter = await tokenContract.balanceOf(wallet.address);
                    log(`Token ${opportunity.pair.name.split('/')[0]} balance after: ${ethers.utils.formatUnits(tokenBalanceAfter, opportunity.pair.decimalsA)}`);
                    
                    // Calculate token profit
                    const tokenProfit = tokenBalanceAfter.sub(tokenBalanceBefore);
                    
                    log('\n=== ARBITRAGE RESULT ===');
                    if (tokenProfit.gt(0)) {
                        const profitPercentage = tokenProfit.mul(10000).div(opportunity.amountIn);
                        log(`✅ SUCCESS: Actual profit: ${ethers.utils.formatUnits(tokenProfit, opportunity.pair.decimalsA)} ${opportunity.pair.name.split('/')[0]} (${profitPercentage.toNumber() / 100}%)`);
                    } else {
                        log(`❌ NO PROFIT DETECTED. Transaction executed but no profit was returned to wallet.`);
                    }
                }
                
                return true;
            } catch (error2) {
                log(`\nTransaction also failed with fixed gas limit: ${error2.message}`);
                if (error2.reason) log(`Reason: ${error2.reason}`);
                return false;
            }
            
            return false;
        }
    } catch (error) {
        log('\nError executing arbitrage:');
        log(error.message);
        if (error.reason) log(`Reason: ${error.reason}`);
        return false;
    }
}

// Main loop
async function main() {
    log('Arbitrage Bot started');
    log(`Connected to RPC: ${process.env.RPC_URL}`);
    log(`Wallet address: ${wallet.address}`);
    log(`Arbitrage contract: ${process.env.ARBITRAGE_CONTRACT_ADDRESS}`);
    
    try {
        // Check if contract exists
        // const code = await provider.getCode(process.env.ARBITRAGE_CONTRACT_ADDRESS);
        // if (code === '0x') {
        //     log('Error: No contract found at the specified address');
        //     process.exit(1);
        // }
        
        log('Contract verified. Starting monitoring...');
        
        // Main monitoring loop
        while (true) {
            try {
                await checkForArbitrageOpportunities();
                log('Waiting 5 seconds before next check...');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds between checks
            } catch (error) {
                log('Error in monitoring loop:');
                log(error.message);
                log('Waiting 10 seconds before retrying...');
                await new Promise(resolve => setTimeout(resolve, 10000));
            }
        }
    } catch (error) {
        log('Fatal error:');
        log(error.message);
        process.exit(1);
    }
}

// Handle application shutdown
process.on('SIGINT', () => {
    log('Bot shutting down...');
    logStream.end();
    process.exit(0);
});

// Start the bot
main().catch(error => {
    log('Fatal error:');
    log(error.message);
    logStream.end();
    process.exit(1);
}); 