const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlashLoanArbitrage", function () {
  let owner, addr1;
  let flashLoanArb, mockPool, tokenA, tokenB, mockUni, mockSushi;

  beforeEach(async function () {
    [owner, addr1] = await ethers.getSigners();

    // Deploy Mock Tokens (e.g., TokenA and TokenB)
    const MockToken = await ethers.getContractFactory("MockToken");
    tokenA = await MockToken.deploy("Token A", "TKA", ethers.parseEther("1000000"));
    await tokenA.deployed();
    tokenB = await MockToken.deploy("Token B", "TKB", ethers.parseEther("1000000"));
    await tokenB.deployed();

    // Deploy Mock DEX contracts to simulate Uniswap and SushiSwap.
    const MockDEX = await ethers.getContractFactory("MockDEX");
    // Set profitMultiplier to 102 (2% profit) for simulation.
    mockUni = await MockDEX.deploy(tokenA.address, tokenB.address, 102);
    await mockUni.deployed();
    mockSushi = await MockDEX.deploy(tokenA.address, tokenB.address, 102);
    await mockSushi.deployed();

    // Deploy the MockPool to simulate Aave flash loans.
    const MockPool = await ethers.getContractFactory("MockPool");
    mockPool = await MockPool.deploy();
    await mockPool.deployed();

    // Deploy the FlashLoanArbitrage contract using the mock addresses.
    const FlashLoanArbitrage = await ethers.getContractFactory("FlashLoanArbitrage");
    flashLoanArb = await FlashLoanArbitrage.deploy(
      mockPool.address,
      mockUni.address,
      mockSushi.address
    );
    await flashLoanArb.deployed();

    // Transfer some tokens to the FlashLoanArbitrage contract if needed.
    await tokenA.transfer(flashLoanArb.address, ethers.parseEther("1000"));
  });

  it("Should execute arbitrage and transfer profit to owner", async function () {
    // Define the flash loan amount (e.g., 100 TokenA)
    const flashLoanAmount = ethers.parseEther("100");
    // Define the swap path: from tokenA to tokenB.
    const path = [tokenA.address, tokenB.address];

    // Simulate premium as 1% (calculated inside MockPool).
    // Encode swap parameters: path and flag (true = buy on Uniswap first).
    const params = ethers.defaultAbiCoder.encode(["address[]", "bool"], [path, true]);

    // For simulation, manually transfer the flash loan amount into the contract.
    await tokenA.transfer(flashLoanArb.address, flashLoanAmount);

    // Call executeOperation manually (as if called by the flash loan pool).
    await flashLoanArb.connect(owner).executeOperation(
      tokenA.address,
      flashLoanAmount,
      flashLoanAmount.div(100), // premium (1%)
      owner.address,
      params
    );

    // Check that profit was transferred to the owner.
    const ownerBalance = await tokenA.balanceOf(owner.address);
    expect(ownerBalance).to.be.gt(0);
  });
});
