# Flash Loan Arbitrage Bot

A simplified arbitrage bot that checks for opportunities across multiple DEXes and executes flash loan arbitrage trades.

## Updates

### New Features
- **Custom Profit Recipient**: You can now specify which address will receive the profits from arbitrage trades
- **Price Validation**: Added validation to filter out abnormal prices, especially for the WETH/DAI pair in Uniswap V3 0.01% pool
- **Enhanced Logging**: Better transaction result logging with detailed profit confirmation
- **Simplified Deployment**: Single script to deploy the contract and set the profit recipient
- **Live Quoter Results**: Real-time price quotes from exchanges to find profitable arbitrage opportunities
- **Multi-Network Support**: Deploy to mainnet, testnets, or local networks with the same scripts

## Setup

### Prerequisites
- Node.js
- Hardhat
- Ethereum wallet with ETH for gas
- Access to RPC endpoints

### Installation
1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. Copy `.env.example` to `.env` and configure your environment variables:
```bash
cp .env.example .env
```

4. Update the `.env` file with your values:
```
# RPC URLs for different networks
MAINNET_RPC_URL=https://mainnet.infura.io/v3/your_infura_key
SEPOLIA_RPC_URL=https://sepolia.infura.io/v3/your_infura_key
INFURA_API_KEY=your_infura_api_key

# Local network
RPC_URL=http://127.0.0.1:8545

# Private key for deployment - use a real funded key for mainnet/testnet deployments
PRIVATE_KEY=your_private_key_here

# Etherscan API key for contract verification
ETHERSCAN_API_KEY=your_etherscan_api_key

# Contract addresses - will be filled after deployment
ARBITRAGE_CONTRACT_ADDRESS=

# DEX addresses - already filled with mainnet addresses
AAVE_POOL_PROVIDER_ADDRESS=0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e
UNISWAP_V2_ROUTER_ADDRESS=0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D
UNISWAP_V3_ROUTER_ADDRESS=0xE592427A0AEce92De3Edee1F18E0157C05861564
SUSHISWAP_ROUTER_ADDRESS=0xd9e1cE17f2641f24aE83637ab66a2cca9C378B9F
BALANCER_VAULT_ADDRESS=0xBA12222222228d8Ba445958a75a0704d566BF2C8
```

## Network Deployment Options

The project supports deployment to multiple networks:

1. **Local Hardhat Node** (default): For development and testing
2. **Localhost**: For a persistent local node
3. **Ethereum Mainnet**: For production deployment
4. **Sepolia Testnet**: For testing with test ETH before mainnet deployment

### Deployment to Different Networks

#### Using the Hardhat Deployment Script

You can deploy to any configured network using the `--network` flag:

```bash
# Deploy to local Hardhat node (default)
npx hardhat run scripts/deploy.js

# Deploy to localhost network
npx hardhat run scripts/deploy.js --network localhost

# Deploy to Sepolia testnet
npx hardhat run scripts/deploy.js --network sepolia

# Deploy to Ethereum mainnet (production)
npx hardhat run scripts/deploy.js --network mainnet
```

#### Using the Direct Deployment Script

For the direct deployment script, update the RPC_URL in your .env file:

```bash
# For localhost
RPC_URL=http://127.0.0.1:8545

# For Sepolia testnet
RPC_URL=https://sepolia.infura.io/v3/your_infura_key

# For Ethereum mainnet
RPC_URL=https://mainnet.infura.io/v3/your_infura_key
```

Then run:

```bash
node scripts/deploy-direct.js
```

### Important Considerations for Mainnet/Testnet Deployment

1. **Use a Properly Funded Account**:
   - Replace the default private key with your own wallet's private key
   - Ensure the wallet has sufficient ETH for gas fees (higher for mainnet)

2. **Configure API Keys**:
   - Use your own Infura/Alchemy API keys
   - Set your Etherscan API key for contract verification

3. **Contract Verification**:
   - The deployment script will attempt to verify the contract on Etherscan
   - This only works on real networks (mainnet/testnet), not on local networks

4. **Gas Settings**:
   - The deployment scripts double the gas price for faster confirmation
   - You can adjust this in the scripts if needed for mainnet deployment

## Complete Guide to Running the Bot

### Step 1: Environment Setup

1. Ensure your `.env` file is properly configured with:
   - Your private key
   - RPC URL (mainnet fork or real mainnet)
   - API keys if using Infura/Alchemy for forking

2. Verify all DEX router addresses are correct for your target network

### Step 2: Start a Forked Network (for testing)

Start a local Hardhat node that forks from mainnet:

```bash
npx hardhat node --fork https://mainnet.infura.io/v3/YOUR_INFURA_KEY
```

For production use, set your `.env` file with a real mainnet RPC URL.

### Step 3: Deploy the Arbitrage Contract

Compile the contracts first:

```bash
npx hardhat compile
```

Deploy the contract using the direct deployment script:

```bash
npx hardhat run scripts/deploy-direct.js --network localhost
```

This will:
1. Deploy the Arbitrage contract
2. Set the profit recipient to your wallet address (from your PRIVATE_KEY)
3. Output the new contract address to the console
4. Automatically update your `.env` file with the contract address

Verify the contract address has been updated in your `.env` file.

### Step 4: Run the Arbitrage Bot

Launch the bot with:

```bash
node arbitrageBot.js
```

The bot will:
1. Initialize with settings from your `.env` file
2. Connect to the blockchain network
3. Load the Arbitrage contract
4. Begin checking for arbitrage opportunities
5. Execute trades when profitable opportunities are found
6. Log all activities and results

### Step 5: Monitor the Logs

The bot logs all activities to the console and to the log file specified in your `.env` file.

To watch the log file in real-time:

```bash
# On Linux/Mac
tail -f arbitrage.log

# On Windows PowerShell
Get-Content arbitrage.log -Wait
```

The logs will show:
- Route checking between different exchanges
- Price differences found
- Profitable opportunities with expected profit
- Transaction execution results
- Any errors or issues encountered

### Troubleshooting

#### Deployment Issues
1. **Compile errors**: Make sure you've run `npx hardhat compile` before deployment
2. **Network connection**: Verify your RPC_URL is accessible and responding
3. **Gas errors**: Ensure your wallet has enough ETH for deployment
4. **Contract verification**: If the contract address isn't updated in your `.env`, manually update it

#### Bot Execution Issues
1. **Contract connection**: Verify the ARBITRAGE_CONTRACT_ADDRESS in your `.env` is correct
2. **Pricing anomalies**: The bot has validation to filter out abnormal prices
3. **Transaction failures**: Check logs for details on why transactions are reverting
4. **Profit threshold**: You may need to adjust slippage settings if opportunities are being missed

#### Performance Optimization
1. **Adjust slippage**: Lower values (0.1-0.3%) for more conservative trades, higher (0.5-1%) for more opportunities
2. **Network congestion**: During high gas periods, increase your gas price for faster execution
3. **Token pairs**: Focus on high-liquidity pairs for more stable arbitrage opportunities

## License
MIT
