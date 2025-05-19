const { ethers } = require('ethers');

async function main() {
    try {
        const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');
        console.log('Connecting to Hardhat node...');
        
        const network = await provider.getNetwork();
        console.log('Connected to network:', network);
        
        const blockNumber = await provider.getBlockNumber();
        console.log('Current block number:', blockNumber);
        
        const accounts = await provider.listAccounts();
        console.log('Available accounts:', accounts);
        
        const balance = await provider.getBalance(accounts[0]);
        console.log('First account balance:', ethers.formatEther(balance), 'ETH');
    } catch (error) {
        console.error('Error:', error);
    }
}

main(); 