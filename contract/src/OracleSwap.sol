// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "pyth-sdk-solidity/IPyth.sol";
import "pyth-sdk-solidity/PythStructs.sol";
import "openzeppelin-contracts/contracts/token/ERC20/ERC20.sol";
import "openzeppelin-contracts/contracts/access/Ownable.sol";

// Example oracle AMM powered by Pyth price feeds.
//
// The contract holds a pool of two ERC-20 tokens, the BASE and the QUOTE, and allows users to swap tokens
// for the pair BASE/QUOTE. For example, the base could be WETH and the quote could be USDC, in which case you can
// buy WETH for USDC and vice versa. The pool offers to swap between the tokens at the current Pyth exchange rate for
// BASE/QUOTE, which is computed from the BASE/USD price feed and the QUOTE/USD price feed.
//
// This contract only implements the swap functionality. It does not implement any pool balancing logic (e.g., skewing the
// price to reflect an unbalanced pool) or depositing / withdrawing funds. When deployed, the contract needs to be sent
// some quantity of both the base and quote token in order to function properly (using the ERC20 transfer function to
// the contract's address).
contract OracleSwap is Ownable {
    event Transfer(address from, address to, uint amountUsd, uint amountWei);

    IPyth pyth;

    bytes32 baseTokenPriceId;
    bytes32 quoteTokenPriceId;

    ERC20 public baseToken;
    ERC20 public quoteToken;

    mapping(address => uint) public LiquidityTokenBalance;

    uint feePercentage = 3; // 0.3%

    // totol liquidity token supply
    uint public totalLiquidityTokenSupply;

    uint public baseReserve;
    uint public quoteReserve;

    constructor(
        address _pyth,
        bytes32 _baseTokenPriceId,
        bytes32 _quoteTokenPriceId,
        address _baseToken,
        address _quoteToken
    ) {
        pyth = IPyth(_pyth);
        baseTokenPriceId = _baseTokenPriceId;
        quoteTokenPriceId = _quoteTokenPriceId;
        baseToken = ERC20(_baseToken);
        quoteToken = ERC20(_quoteToken);
    }

    function setFeePercentage(uint newFeePercentage) external onlyOwner {
        require(newFeePercentage > 0, "Fee percentage must be greater than 0");
        feePercentage = newFeePercentage;
    }

    // Buy or sell a quantity of the base token. `size` represents the quantity of the base token with the same number
    // of decimals as expected by its ERC-20 implementation. If `isBuy` is true, the contract will send the caller
    // `size` base tokens; if false, `size` base tokens will be transferred from the caller to the contract. Some
    // number of quote tokens will be transferred in the opposite direction; the exact number will be determined by
    // the current pyth price. The transaction will fail if either the pool or the sender does not have enough of the
    // requisite tokens for these transfers.
    //
    // `pythUpdateData` is the binary pyth price update data (retrieved from Pyth's price
    // service); this data should contain a price update for both the base and quote price feeds.
    // See the frontend code for an example of how to retrieve this data and pass it to this function.
    function swap(
        bool isBuy,
        uint size,
        bytes[] calldata pythUpdateData
    ) external payable {
        require(size > 0, "Size must be greater than 0");
        require(pythUpdateData.length == 2, "Invalid pyth update data");
        uint updateFee = pyth.getUpdateFee(pythUpdateData);
        pyth.updatePriceFeeds{value: updateFee}(pythUpdateData);

        PythStructs.Price memory currentBasePrice = pyth.getPrice(
            baseTokenPriceId
        );
        PythStructs.Price memory currentQuotePrice = pyth.getPrice(
            quoteTokenPriceId
        );

        // Note: this code does all arithmetic with 18 decimal points. This approach should be fine for most
        // price feeds, which typically have ~8 decimals. You can check the exponent on the price feed to ensure
        // this doesn't lose precision.
        uint256 basePrice = convertToUint(currentBasePrice, 18);
        uint256 quotePrice = convertToUint(currentQuotePrice, 18);

        // This computation loses precision. The infinite-precision result is between [quoteSize, quoteSize + 1]
        // We need to round this result in favor of the contract.
        uint256 quoteSize = (size * basePrice) / quotePrice;

        uint fee = isBuy
            ? (size * feePercentage) / 1000
            : (quoteSize * feePercentage) / 1000;

        if (isBuy) {
            // (Round up)
            quoteSize += 1;
            quoteToken.transferFrom(msg.sender, address(this), quoteSize);
            baseToken.transfer(msg.sender, size - fee);
        } else {
            baseToken.transferFrom(msg.sender, address(this), size);
            quoteToken.transfer(msg.sender, quoteSize - fee);
        }
        _update(baseBalance(), quoteBalance());
    }

    function _mint(address _to, uint _amount) private {
        LiquidityTokenBalance[_to] += _amount;
        totalLiquidityTokenSupply += _amount;
    }

    function _burn(address _from, uint _amount) private {
        LiquidityTokenBalance[_from] -= _amount;
        totalLiquidityTokenSupply -= _amount;
    }

    function _update(uint _baseReserve, uint _quoteReserve) private {
        baseReserve = _baseReserve;
        quoteReserve = _quoteReserve;
    }

    // TODO: we should probably move something like this into the solidity sdk
    function convertToUint(
        PythStructs.Price memory price,
        uint8 targetDecimals
    ) private pure returns (uint256) {
        if (price.price < 0 || price.expo > 0 || price.expo < -255) {
            revert();
        }

        uint8 priceDecimals = uint8(uint32(-1 * price.expo));

        if (targetDecimals >= priceDecimals) {
            return
                uint(uint64(price.price)) *
                10 ** uint32(targetDecimals - priceDecimals);
        } else {
            return
                uint(uint64(price.price)) /
                10 ** uint32(priceDecimals - targetDecimals);
        }
    }

    // Get the number of base tokens in the pool
    function baseBalance() public view returns (uint256) {
        return baseToken.balanceOf(address(this));
    }

    // Get the number of quote tokens in the pool
    function quoteBalance() public view returns (uint256) {
        return quoteToken.balanceOf(address(this));
    }

    // Get liquidity token balance of the caller
    function getLiquidityTokenBalance() public view returns (uint256) {
        return LiquidityTokenBalance[msg.sender];
    }

    function getTotalLiquidityTokenSupply() public view returns (uint256) {
        return totalLiquidityTokenSupply;
    }

    // add liquidity to pool
    function addLiquidity(
        uint baseAmount,
        uint quoteAmount
    ) external returns (uint liquidityTokenAmount) {
        // TODO: check price

        if (totalLiquidityTokenSupply == 0) {
            liquidityTokenAmount = _sqrt(baseAmount * quoteAmount);
        } else {
            liquidityTokenAmount = _min(
                (baseAmount * totalLiquidityTokenSupply) / baseReserve,
                (quoteAmount * totalLiquidityTokenSupply) / quoteReserve
            );
        }

        baseToken.transferFrom(msg.sender, address(this), baseAmount);
        quoteToken.transferFrom(msg.sender, address(this), quoteAmount);

        _mint(msg.sender, liquidityTokenAmount);
        _update(baseBalance(), quoteBalance());
    }

    // remove liquidity from pool
    function removeLiquidity(
        uint amount
    ) external returns (uint baseAmount, uint quoteAmount) {
        uint liquidityTokenSupply = totalLiquidityTokenSupply;

        require(liquidityTokenSupply > 0, "Insufficent liquidity");
        require(
            amount <= getLiquidityTokenBalance(),
            "Insufficent liquidity token"
        );

        uint baseReserveAmount = baseBalance();
        uint quoteReserveAmount = quoteBalance();

        baseAmount = (amount * baseReserveAmount) / liquidityTokenSupply;
        quoteAmount = (amount * quoteReserveAmount) / liquidityTokenSupply;

        require(baseAmount > 0 && quoteAmount > 0, "Invalid token amount");

        _burn(msg.sender, amount);
        baseToken.transfer(msg.sender, baseAmount);
        quoteToken.transfer(msg.sender, quoteAmount);
    }

    // Send all tokens in the oracle AMM pool to the caller of this method.
    // (This function is for demo purposes only. You wouldn't include this on a real contract.)
    function withdrawAll() external {
        baseToken.transfer(msg.sender, baseToken.balanceOf(address(this)));
        quoteToken.transfer(msg.sender, quoteToken.balanceOf(address(this)));
    }

    // Reinitialize the parameters of this contract.
    // (This function is for demo purposes only. You wouldn't include this on a real contract.)
    function reinitialize(
        bytes32 _baseTokenPriceId,
        bytes32 _quoteTokenPriceId,
        address _baseToken,
        address _quoteToken
    ) external {
        baseTokenPriceId = _baseTokenPriceId;
        quoteTokenPriceId = _quoteTokenPriceId;
        baseToken = ERC20(_baseToken);
        quoteToken = ERC20(_quoteToken);
    }

    function _sqrt(uint y) internal pure returns (uint z) {
        if (y > 3) {
            z = y;
            uint x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _min(uint x, uint y) internal pure returns (uint z) {
        z = x < y ? x : y;
    }

    receive() external payable {}
}
