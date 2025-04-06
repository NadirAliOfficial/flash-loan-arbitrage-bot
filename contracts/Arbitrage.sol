// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import "@aave/core-v3/contracts/interfaces/IPool.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn, 
        uint amountOutMin, 
        address[] calldata path, 
        address to, 
        uint deadline
    ) external returns (uint[] memory amounts);
    
    function getAmountsOut(
        uint amountIn, 
        address[] calldata path
    ) external view returns (uint[] memory amounts);
}

contract FlashLoanArbitrage is FlashLoanSimpleReceiverBase {
    address payable public owner;
    IUniswapV2Router02 public uniswapRouter;
    IUniswapV2Router02 public sushiswapRouter;

    /**
     * @notice Initializes the contract with Aave provider and DEX router addresses.
     * @param _provider Address of the Aave PoolAddressesProvider.
     * @param _uniRouter Address of the Uniswap router.
     * @param _sushiRouter Address of the SushiSwap router.
     */
    constructor(
        address _provider,
        address _uniRouter,
        address _sushiRouter
    ) FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_provider)) {
        owner = payable(msg.sender);
        uniswapRouter = IUniswapV2Router02(_uniRouter);
        sushiswapRouter = IUniswapV2Router02(_sushiRouter);
    }

    /**
     * @notice This function is called by Aave after the flash loan is sent.
     * @param asset The address of the borrowed asset.
     * @param amount The amount borrowed.
     * @param premium The fee for the flash loan.
     * @param initiator The initiator of the flash loan (unused here).
     * @param params Encoded parameters: a swap path and a boolean flag (buyOnUni).
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address, // initiator (unused)
        bytes calldata params
    ) external override returns (bool) {
        // Decode parameters: 
        //   - path: [asset, token] (token to swap to)
        //   - buyOnUni: if true, swap on Uniswap first; else on SushiSwap.
        (address[] memory path, bool buyOnUni) = abi.decode(params, (address[], bool));
        require(path.length == 2, "Invalid swap path");

        uint deadline = block.timestamp + 120; // Deadline for swaps

        if (buyOnUni) {
            // Swap asset for token on Uniswap.
            IERC20(asset).approve(address(uniswapRouter), amount);
            uniswapRouter.swapExactTokensForTokens(amount, 0, path, address(this), deadline);

            // Swap token back to asset on SushiSwap.
            uint256 tokenBalance = IERC20(path[1]).balanceOf(address(this));
            IERC20(path[1]).approve(address(sushiswapRouter), tokenBalance);
            address;
            reversePath[0] = path[1];
            reversePath[1] = asset;
            sushiswapRouter.swapExactTokensForTokens(tokenBalance, 0, reversePath, address(this), deadline);
        } else {
            // Swap asset for token on SushiSwap.
            IERC20(asset).approve(address(sushiswapRouter), amount);
            sushiswapRouter.swapExactTokensForTokens(amount, 0, path, address(this), deadline);

            // Swap token back to asset on Uniswap.
            uint256 tokenBalance = IERC20(path[1]).balanceOf(address(this));
            IERC20(path[1]).approve(address(uniswapRouter), tokenBalance);
            address;
            reversePath[0] = path[1];
            reversePath[1] = asset;
            uniswapRouter.swapExactTokensForTokens(tokenBalance, 0, reversePath, address(this), deadline);
        }

        // Repay the flash loan: total owed = principal + fee.
        uint256 totalOwed = amount + premium;
        IERC20(asset).approve(address(POOL), totalOwed);

        // Transfer any remaining profit to the owner.
        uint256 remainingBalance = IERC20(asset).balanceOf(address(this));
        if (remainingBalance > totalOwed) {
            IERC20(asset).transfer(owner, remainingBalance - totalOwed);
        }

        return true;
    }

    /**
     * @notice Initiates a flash loan.
     * @param asset The token address to borrow.
     * @param amount The amount to borrow.
     * @param path An array containing two addresses: [asset, token] for the swap.
     * @param buyOnUni Boolean flag: if true, swap on Uniswap first; if false, swap on SushiSwap first.
     */
    function requestFlashLoan(
        address asset,
        uint256 amount,
        address[] calldata path,
        bool buyOnUni
    ) external {
        require(msg.sender == owner, "Only owner can execute");
        // Encode the swap parameters to pass to executeOperation.
        bytes memory params = abi.encode(path, buyOnUni);
        POOL.flashLoanSimple(address(this), asset, amount, params, 0);
    }

    // Fallback function to accept ETH if needed.
    receive() external payable {}
}
