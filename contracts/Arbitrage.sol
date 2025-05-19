// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {FlashLoanSimpleReceiverBase} from "@aave/core-v3/contracts/flashloan/base/FlashLoanSimpleReceiverBase.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import "hardhat/console.sol";

interface IUniswapV2Router02 {
    function swapExactTokensForTokens(
        uint amountIn, 
        uint amountOutMin, 
        address[] calldata path, 
        address to, 
        uint deadline
    ) external returns (uint[] memory amounts);
}

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

interface IBalancerVault {
    enum SwapKind { GIVEN_IN, GIVEN_OUT }

    struct SingleSwap {
        bytes32 poolId;
        SwapKind kind;
        address assetIn;
        address assetOut;
        uint256 amount;
        bytes userData;
    }

    struct FundManagement {
        address sender;
        bool fromInternalBalance;
        address payable recipient;
        bool toInternalBalance;
    }

    function swap(
        SingleSwap memory singleSwap,
        FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external payable returns (uint256);
}

interface ICurvePool {
    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external payable returns (uint256);
}

interface IDODOPool {
    function sellBase(address to, uint256 amount, bytes calldata data) external returns (uint256);
    function sellQuote(address to, uint256 amount, bytes calldata data) external returns (uint256);
}

contract Arbitrage is FlashLoanSimpleReceiverBase, Ownable {
    // DEX Routers and Interfaces
    IUniswapV2Router02 public immutable uniswapV2Router;
    IUniswapV3Router public immutable uniswapV3Router;
    IUniswapV2Router02 public immutable sushiswapRouter;
    IBalancerVault public immutable balancerVault;
    IPool public immutable aavePool;

    // Constants
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public slippageTolerance = 200; // 2% default slippage tolerance
    
    // New state variable for the profit recipient
    address public profitRecipient;

    enum DEX {
        UNISWAP_V2,
        UNISWAP_V3,
        SUSHISWAP,
        BALANCER,
        CURVE,
        DODO
    }

    struct SwapParams {
        DEX dex;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOutMin;
        bytes32 poolId;        // For Balancer
        uint24 fee;           // For Uniswap V3
        int128 i;             // For Curve
        int128 j;             // For Curve
        bytes extraData;      // For additional parameters
    }

    constructor(
        address _provider,
        address _uniV2Router,
        address _uniV3Router,
        address _sushiRouter,
        address _balancerVault
    ) FlashLoanSimpleReceiverBase(IPoolAddressesProvider(_provider)) Ownable() {
        uniswapV2Router = IUniswapV2Router02(_uniV2Router);
        uniswapV3Router = IUniswapV3Router(_uniV3Router);
        sushiswapRouter = IUniswapV2Router02(_sushiRouter);
        balancerVault = IBalancerVault(_balancerVault);
        aavePool = IPool(IPoolAddressesProvider(_provider).getPool());
        
        // Initialize profit recipient to owner by default
        profitRecipient = owner();
    }

    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external override returns (bool) {
        require(msg.sender == address(POOL), "Callback only from POOL");
        
        // Decode the swap parameters
        (SwapParams memory firstSwap, SwapParams memory secondSwap, address recipient) = abi.decode(
            params, 
            (SwapParams, SwapParams, address)
        );
        
        // Use provided recipient or fallback to default profit recipient
        address actualRecipient = recipient != address(0) ? recipient : profitRecipient;
        
        // Log recipient for debugging
        console.log("Profit recipient:", actualRecipient);
        
        // Execute first swap
        uint256 amountReceived = executeSwap(firstSwap);
        
        // Calculate required amount for repayment
        uint256 requiredAmount = amount + premium;
        
        // Execute second swap
        uint256 finalAmount = executeSwap(secondSwap);
        require(finalAmount >= requiredAmount, "Insufficient return amount");
        
        // Approve flash loan repayment
        IERC20(asset).approve(address(POOL), requiredAmount);
        
        // Transfer profit to the recipient
        if (finalAmount > requiredAmount) {
            uint256 profit = finalAmount - requiredAmount;
            console.log("Sending profit to recipient: ", profit);
            IERC20(asset).transfer(actualRecipient, profit);
        }
        
        return true;
    }

    function executeSwap(SwapParams memory params) internal returns (uint256) {
        // Debug info
        console.log("=== Executing Swap ===");
        console.log("DEX index:", uint(params.dex));
        console.log("Token In:", params.tokenIn);
        console.log("Token Out:", params.tokenOut);
        console.log("Amount In:", params.amountIn);
        console.log("Amount Out Min:", params.amountOutMin);
        
        // For Uniswap V3, log fee
        if (params.dex == DEX.UNISWAP_V3) {
            console.log("UniswapV3 Fee Tier:", params.fee);
            // Ensure fee is a valid value
            require(params.fee == 100 || params.fee == 500 || params.fee == 3000 || params.fee == 10000, "Invalid Uniswap V3 fee tier");
        }
        
        // Approve token spending
        IERC20(params.tokenIn).approve(getRouterAddress(params.dex), params.amountIn);
        console.log("Approved spending of tokens");
        
        uint256 amountOut;
        
        if (params.dex == DEX.UNISWAP_V2 || params.dex == DEX.SUSHISWAP) {
            console.log("Using Uniswap V2/Sushiswap router");
            address[] memory path = new address[](2);
            path[0] = params.tokenIn;
            path[1] = params.tokenOut;
            
            IUniswapV2Router02 router = params.dex == DEX.UNISWAP_V2 ? uniswapV2Router : sushiswapRouter;
            console.log("Router address:", address(router));
            
            try router.swapExactTokensForTokens(
                params.amountIn,
                params.amountOutMin,
                path,
                address(this),
                block.timestamp + 300
            ) returns (uint[] memory amounts) {
                amountOut = amounts[1];
                console.log("V2 Swap Success! Amount Out:", amountOut);
            } catch Error(string memory reason) {
                console.log("V2 Swap Failed! Reason:", reason);
                revert(reason);
            } catch {
                console.log("V2 Swap Failed with no reason!");
                revert("V2 swap failed with no reason");
            }
        }
        else if (params.dex == DEX.UNISWAP_V3) {
            console.log("Using Uniswap V3 router");
            console.log("V3 Router address:", address(uniswapV3Router));
            
            // Debug fee parameter
            console.log("Creating V3 params with fee:", params.fee);
            
            // Check if the fee is one of the valid Uniswap V3 fee tiers
            uint24 feeTier;
            if (params.fee == 100) {
                feeTier = 100;
            } else if (params.fee == 500) {
                feeTier = 500;
            } else if (params.fee == 3000) {
                feeTier = 3000;
            } else if (params.fee == 10000) {
                feeTier = 10000;
            } else {
                console.log("Invalid fee tier, using default 3000");
                feeTier = 3000;
            }
            
            console.log("Final V3 fee tier:", feeTier);
            
            IUniswapV3Router.ExactInputSingleParams memory uniV3Params = IUniswapV3Router.ExactInputSingleParams({
                tokenIn: params.tokenIn,
                tokenOut: params.tokenOut,
                fee: feeTier,
                recipient: address(this),
                deadline: block.timestamp + 300,
                amountIn: params.amountIn,
                amountOutMinimum: params.amountOutMin,
                sqrtPriceLimitX96: 0
            });
            
            console.log("V3 params configured, attempting swap...");
            console.log("V3 params - tokenIn:", uniV3Params.tokenIn);
            console.log("V3 params - tokenOut:", uniV3Params.tokenOut);
            console.log("V3 params - fee:", uniV3Params.fee);
            console.log("V3 params - amountIn:", uniV3Params.amountIn);
            console.log("V3 params - amountOutMinimum:", uniV3Params.amountOutMinimum);
            
            try uniswapV3Router.exactInputSingle(uniV3Params) returns (uint256 result) {
                amountOut = result;
                console.log("V3 Swap Success! Amount Out:", amountOut);
            } catch Error(string memory reason) {
                console.log("V3 Swap Failed! Reason:", reason);
                revert(reason);
            } catch {
                console.log("V3 Swap Failed with no reason!");
                revert("V3 swap failed with no reason");
            }
        }
        else if (params.dex == DEX.BALANCER) {
            console.log("Using Balancer router");
            
            IBalancerVault.SingleSwap memory singleSwap = IBalancerVault.SingleSwap({
                poolId: params.poolId,
                kind: IBalancerVault.SwapKind.GIVEN_IN,
                assetIn: params.tokenIn,
                assetOut: params.tokenOut,
                amount: params.amountIn,
                userData: ""
            });

            IBalancerVault.FundManagement memory funds = IBalancerVault.FundManagement({
                sender: address(this),
                fromInternalBalance: false,
                recipient: payable(address(this)),
                toInternalBalance: false
            });

            try balancerVault.swap(
                singleSwap,
                funds,
                params.amountOutMin,
                block.timestamp + 300
            ) returns (uint256 result) {
                amountOut = result;
                console.log("Balancer Swap Success! Amount Out:", amountOut);
            } catch Error(string memory reason) {
                console.log("Balancer Swap Failed! Reason:", reason);
                revert(reason);
            } catch {
                console.log("Balancer Swap Failed with no reason!");
                revert("Balancer swap failed with no reason");
            }
        }
        else if (params.dex == DEX.CURVE) {
            console.log("Using Curve pool");
            
            ICurvePool pool = ICurvePool(address(uint160(uint256(params.poolId))));
            console.log("Curve pool address:", address(pool));
            
            try pool.exchange(
                params.i,
                params.j,
                params.amountIn,
                params.amountOutMin
            ) returns (uint256 result) {
                amountOut = result;
                console.log("Curve Swap Success! Amount Out:", amountOut);
            } catch Error(string memory reason) {
                console.log("Curve Swap Failed! Reason:", reason);
                revert(reason);
            } catch {
                console.log("Curve Swap Failed with no reason!");
                revert("Curve swap failed with no reason");
            }
        }
        else if (params.dex == DEX.DODO) {
            console.log("Using DODO pool");
            
            IDODOPool pool = IDODOPool(address(uint160(uint256(params.poolId))));
            console.log("DODO pool address:", address(pool));
            
            try pool.sellBase(address(this), params.amountIn, params.extraData) returns (uint256 result) {
                amountOut = result;
                console.log("DODO Swap Success! Amount Out:", amountOut);
            } catch Error(string memory reason) {
                console.log("DODO Swap Failed! Reason:", reason);
                revert(reason);
            } catch {
                console.log("DODO Swap Failed with no reason!");
                revert("DODO swap failed with no reason");
            }
        }
        
        console.log("Final amount out:", amountOut);
        console.log("Minimum required:", params.amountOutMin);
        
        if (amountOut < params.amountOutMin) {
            console.log("INSUFFICIENT OUTPUT: Got", amountOut, "but needed", params.amountOutMin);
            revert("Insufficient output amount");
        }
        
        return amountOut;
    }

    function getRouterAddress(DEX dex) internal view returns (address) {
        if (dex == DEX.UNISWAP_V2) return address(uniswapV2Router);
        if (dex == DEX.UNISWAP_V3) return address(uniswapV3Router);
        if (dex == DEX.SUSHISWAP) return address(sushiswapRouter);
        if (dex == DEX.BALANCER) return address(balancerVault);
        revert("Unsupported DEX");
    }

    function executeArbitrage(
        address asset,
        uint256 amount,
        SwapParams calldata firstSwap,
        SwapParams calldata secondSwap,
        address recipient
    ) external onlyOwner {
        // This function sends all profits directly to the recipient address
        bytes memory params = abi.encode(firstSwap, secondSwap, recipient);
        aavePool.flashLoanSimple(address(this), asset, amount, params, 0);
    }
    
    // Function to update the default profit recipient
    function setProfitRecipient(address _profitRecipient) external onlyOwner {
        require(_profitRecipient != address(0), "Cannot set zero address");
        profitRecipient = _profitRecipient;
    }

    function setSlippageTolerance(uint256 _slippageTolerance) external onlyOwner {
        require(_slippageTolerance < BASIS_POINTS, "Invalid slippage tolerance");
        slippageTolerance = _slippageTolerance;
    }

    receive() external payable {}
}
