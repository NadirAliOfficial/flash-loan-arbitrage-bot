// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function slot0() external view returns (
        uint160 sqrtPriceX96,
        int24 tick,
        uint16 observationIndex,
        uint16 observationCardinality,
        uint16 observationCardinalityNext,
        uint8 feeProtocol,
        bool unlocked
    );
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IERC20 {
    function decimals() external view returns (uint8);
}

contract QuoterV2Interface {
    IUniswapV3Factory public immutable factory;
    
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        uint256 amountIn;
        uint160 sqrtPriceLimitX96;
    }
    
    struct QuoteResult {
        uint256 amountOut;
        uint160 sqrtPriceX96After;
        int24 tickAfter;
    }
    
    constructor(address _factory) {
        factory = IUniswapV3Factory(_factory);
    }
    
    function quoteExactInputSingle(QuoteExactInputSingleParams memory params) 
        external 
        view 
        returns (QuoteResult memory result) 
    {
        // Get pool address
        address poolAddress = factory.getPool(
            params.tokenIn, 
            params.tokenOut, 
            params.fee
        );
        
        require(poolAddress != address(0), "Pool does not exist");
        
        IUniswapV3Pool pool = IUniswapV3Pool(poolAddress);
        
        // Get current price from pool
        (uint160 sqrtPriceX96, int24 tick, , , , , ) = pool.slot0();
        
        // Determine token order
        address token0 = pool.token0();
        bool isToken0In = params.tokenIn == token0;
        
        // Get token decimals 
        uint8 decimalsIn = IERC20(params.tokenIn).decimals();
        uint8 decimalsOut = IERC20(params.tokenOut).decimals();
        
        // Calculate price from tick
        // tick = log(1.0001, sqrt(price))
        // price = 1.0001^(2*tick)
        int256 tickValue = tick;
        
        // Convert to price represented as Q64.96
        uint256 price;
        
        if (isToken0In) {
            // If tokenIn is token0, then we need to invert the price
            // price is how much of token1 you get for 1 of token0
            price = calculatePrice(tickValue);
        } else {
            // If tokenIn is token1, then the price is how much of token0 you get for 1 of token1
            // We need to invert it
            price = calculateInversePrice(tickValue);
        }
        
        // Apply fee
        uint256 feeAmount = (params.amountIn * params.fee) / 1000000;
        uint256 amountInAfterFee = params.amountIn - feeAmount;
        
        // Calculate output amount based on price and decimals adjustment
        uint256 amountOut;
        
        if (decimalsIn == decimalsOut) {
            // Same decimals, straightforward multiplication
            amountOut = (amountInAfterFee * price) / (1 << 96);
        } else if (decimalsIn > decimalsOut) {
            // Input has more decimals, we need to scale down the output
            uint256 decimalAdjustment = 10**(decimalsIn - decimalsOut);
            amountOut = (amountInAfterFee * price) / (decimalAdjustment * (1 << 96));
        } else {
            // Output has more decimals, we need to scale up the output
            uint256 decimalAdjustment = 10**(decimalsOut - decimalsIn);
            amountOut = (amountInAfterFee * price * decimalAdjustment) / (1 << 96);
        }
        
        // Populate result
        result.amountOut = amountOut;
        result.sqrtPriceX96After = sqrtPriceX96; // We don't simulate the price impact
        result.tickAfter = tick;             // We don't simulate the price impact
        
        return result;
    }
    
    // Helper function to calculate price from tick
    // price = 1.0001^(2*tick)
    // We approximate this using a fixed precision method
    function calculatePrice(int256 tick) internal pure returns (uint256) {
        // For demo purposes, we're using a simplified approximation
        // In a real implementation, you'd use a more precise algorithm
        if (tick < 0) {
            return (1 << 96) / uint256(int256(1 << 96) * (-tick) / 100000);
        } else {
            return uint256(int256(1 << 96) * tick / 100000);
        }
    }
    
    // Helper function to calculate 1/price from tick
    function calculateInversePrice(int256 tick) internal pure returns (uint256) {
        // For demo purposes, we're using a simplified approximation
        // In a real implementation, you'd use a more precise algorithm
        if (tick < 0) {
            return uint256(int256(1 << 96) * (-tick) / 100000);
        } else {
            return (1 << 96) / uint256(int256(1 << 96) * tick / 100000);
        }
    }
} 