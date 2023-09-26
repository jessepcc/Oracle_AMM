// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.0;

import "forge-std/Test.sol";
import "forge-std/Vm.sol";
import "../src/OracleSwap.sol";
import "pyth-sdk-solidity/MockPyth.sol";
import "openzeppelin-contracts/contracts/mocks/ERC20Mock.sol";

contract OracleSwapTest is Test {
    MockPyth public mockPyth;

    bytes32 constant BASE_PRICE_ID =
        0x000000000000000000000000000000000000000000000000000000000000abcd;
    bytes32 constant QUOTE_PRICE_ID =
        0x0000000000000000000000000000000000000000000000000000000000001234;

    ERC20Mock baseToken;
    address payable constant BASE_TOKEN_MINT =
        payable(0x0000000000000000000000000000000000000011);
    ERC20Mock quoteToken;
    address payable constant QUOTE_TOKEN_MINT =
        payable(0x0000000000000000000000000000000000000022);

    OracleSwap public swap;

    address payable constant DUMMY_TO =
        payable(0x0000000000000000000000000000000000000055);

    uint256 MAX_INT = 2 ** 256 - 1;

    function setUp() public {
        // Creating a mock of Pyth contract with 60 seconds validTimePeriod (for staleness)
        // and 1 wei fee for updating the price.
        mockPyth = new MockPyth(60, 1);

        baseToken = new ERC20Mock(
            "Foo token",
            "FOO",
            BASE_TOKEN_MINT,
            1000 * 10 ** 18
        );
        quoteToken = new ERC20Mock(
            "Bar token",
            "BAR",
            QUOTE_TOKEN_MINT,
            1000 * 10 ** 18
        );

        swap = new OracleSwap(
            address(mockPyth),
            BASE_PRICE_ID,
            QUOTE_PRICE_ID,
            address(baseToken),
            address(quoteToken)
        );
    }

    function setupTokens(
        uint senderBaseQty,
        uint senderQuoteQty,
        uint poolBaseQty,
        uint poolQuoteQty
    ) private {
        baseToken.mint(address(this), senderBaseQty);
        quoteToken.mint(address(this), senderQuoteQty);

        baseToken.mint(address(swap), poolBaseQty);
        quoteToken.mint(address(swap), poolQuoteQty);
    }

    function doSwap(
        address from,
        int32 basePrice,
        int32 quotePrice,
        bool isBuy,
        uint size
    ) private {
        bytes[] memory updateData = new bytes[](2);

        // This is a dummy update data for Eth. It shows the price as $1000 +- $10 (with -5 exponent).
        updateData[0] = mockPyth.createPriceFeedUpdateData(
            BASE_PRICE_ID,
            basePrice * 100000,
            10 * 100000,
            -5,
            basePrice * 100000,
            10 * 100000,
            uint64(block.timestamp)
        );
        updateData[1] = mockPyth.createPriceFeedUpdateData(
            QUOTE_PRICE_ID,
            quotePrice * 100000,
            10 * 100000,
            -5,
            quotePrice * 100000,
            10 * 100000,
            uint64(block.timestamp)
        );

        // Make sure the contract has enough funds to update the pyth feeds
        uint value = mockPyth.getUpdateFee(updateData);

        vm.startPrank(from);
        vm.deal(from, value);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.swap{value: value}(isBuy, size, updateData);
        vm.stopPrank();
    }

    function testSwapBuyBase() public {
        setupTokens(20e18, 20e18, 20e18, 20e18);
        // base price, quote price, isBuy, size
        doSwap(address(this), 10, 1, true, 1e18);
        // base:quote = 10:1
        // base: 20 + 1 - fee = 21
        // quote: 20 - 10 = 10
        uint amountAfterFee = (1e18 * (997)) / 1000 + 20e18;
        assertEq(baseToken.balanceOf(address(this)), amountAfterFee);
        assertEq(quoteToken.balanceOf(address(this)), 10e18 - 1);
    }

    function testSwapSellBase() public {
        setupTokens(20e18, 20e18, 20e18, 20e18);
        // base price, quote price, isBuy, size
        doSwap(address(this), 10, 1, false, 1e18);
        // base:quote = 10:1
        // base: 20 - 1 = 19
        // quote: 20 + 10 - fee = 20
        uint amountAfterFee = (10e18 * (997)) / 1000 + 20e18;
        assertEq(baseToken.balanceOf(address(this)), 19e18);
        assertEq(quoteToken.balanceOf(address(this)), amountAfterFee);
    }

    function testWithdraw() public {
        setupTokens(10e18, 10e18, 10e18, 10e18);

        swap.withdrawAll();

        assertEq(baseToken.balanceOf(address(this)), 20e18);
        assertEq(quoteToken.balanceOf(address(this)), 20e18);
        assertEq(baseToken.balanceOf(address(swap)), 0);
        assertEq(quoteToken.balanceOf(address(swap)), 0);
    }

    function testAddLiquidity() public {
        setupTokens(10e18, 10e18, 0, 0);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(10e18, 10e18);
        assertEq(baseToken.balanceOf(address(this)), 0);
        assertEq(quoteToken.balanceOf(address(this)), 0);
        assertEq(swap.getLiquidityTokenBalance(), 10e18);
    }

    function testWithdrawLiquidity() public {
        setupTokens(10e18, 10e18, 0, 0);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(10e18, 10e18);

        swap.removeLiquidity(10e18);
        assertEq(baseToken.balanceOf(address(this)), 10e18);
        assertEq(quoteToken.balanceOf(address(this)), 10e18);
        assertEq(swap.getLiquidityTokenBalance(), 0);
    }

    function testSwapBuyBaseWithLiquidity() public {
        setupTokens(30e18, 30e18, 0, 0);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);

        swap.addLiquidity(20e18, 20e18);

        address someOne = vm.addr(1);
        quoteToken.mint(address(someOne), 20e18);

        // base price, quote price, isBuy, size
        doSwap(someOne, 10, 1, true, 1e18);
        // price base:quote = 10:1 -> buying 1e18 of base
        // base: 1 - fee
        // quote: 20 - 10 = 10

        uint amountAfterFee = (1e18 * (997)) / 1000;

        assertEq(baseToken.balanceOf(address(someOne)), amountAfterFee);
        assertEq(quoteToken.balanceOf(address(someOne)), 10e18 - 1);

        assertEq(
            baseToken.balanceOf(address(swap)),
            20e18 - 1e18 + (1e18 * 3) / 1000
        );
        assertEq(quoteToken.balanceOf(address(swap)), 20e18 + 10e18 + 1);
    }

    function testSwapSellBaseWithLiquidity() public {
        setupTokens(30e18, 30e18, 0, 0);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);

        swap.addLiquidity(20e18, 20e18);

        address someOne = vm.addr(1);
        baseToken.mint(address(someOne), 1e18);

        // base price, quote price, isBuy, size
        doSwap(someOne, 10, 1, false, 1e18);
        // price base:quote = 10:1 -> buying 1e18 of base
        uint amountAfterFee = (10e18 * (997)) / 1000;

        assertEq(baseToken.balanceOf(address(someOne)), 0);
        assertEq(quoteToken.balanceOf(address(someOne)), amountAfterFee);

        assertEq(baseToken.balanceOf(address(swap)), 20e18 + 1e18);
        assertEq(
            quoteToken.balanceOf(address(swap)),
            20e18 - 10e18 + (10e18 * 3) / 1000
        );
    }

    function testWithdrawLiquidityWithFee() public {
        setupTokens(20e18, 20e18, 0, 0);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(20e18, 20e18);

        address someOne = vm.addr(1);
        quoteToken.mint(address(someOne), 20e18);

        // someOne swap quote for base
        doSwap(someOne, 10, 1, true, 1e18);
        // base:quote = 10:1
        // base: 20 + 1 - fee = 21
        // quote: 20 - 10 = 10

        assertEq(
            baseToken.balanceOf(address(swap)),
            20e18 - 1e18 + (1e18 * 3) / 1000
        );
        assertEq(quoteToken.balanceOf(address(swap)), 20e18 + 10e18 + 1);
        assertEq(swap.getLiquidityTokenBalance(), 20e18);

        swap.removeLiquidity(20e18);
        assertEq(quoteToken.balanceOf(address(swap)), 0);
        assertEq(quoteToken.balanceOf(address(swap)), 0);
        assertEq(quoteToken.balanceOf(address(this)), 20e18 + 10e18 + 1);
        assertEq(
            baseToken.balanceOf(address(this)),
            20e18 - 1e18 + (1e18 * 3) / 1000
        );
        assertEq(swap.getLiquidityTokenBalance(), 0);
    }

    function testWithdrawLiquidityWithFeeAfterMultipleSwap() public {
        setupTokens(20e18, 20e18, 0, 0);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(20e18, 20e18);

        address someOne = vm.addr(1);
        quoteToken.mint(address(someOne), 20e18);
        doSwap(someOne, 10, 1, true, 1e18);

        address someTwo = vm.addr(2);
        baseToken.mint(address(someTwo), 20e18);
        doSwap(someTwo, 10, 1, false, 1e18);

        address someThree = vm.addr(3);
        quoteToken.mint(address(someThree), 20e18);
        doSwap(someThree, 10, 1, true, 1e18);

        /**
         * After SwapOne
         * base: 19 + F_a | quote: 30 + 1
         *
         * After SwapTwo
         * base: 20 + F_a | quote: 20 + F_b + 1
         *
         * After SwapThree
         * base: 19 + F_a + F_c | quote: 30 + F_b + 2
         */

        swap.removeLiquidity(20e18);
        assertEq(swap.getLiquidityTokenBalance(), 0);

        uint feeSwapOne = (1e18 * (3)) / 1000;
        uint feeSwapTwo = (10e18 * (3)) / 1000;
        uint feeSwapThree = (1e18 * (3)) / 1000;

        assertEq(
            baseToken.balanceOf(address(this)),
            19e18 + feeSwapOne + feeSwapThree
        );
        assertEq(quoteToken.balanceOf(address(this)), 30e18 + feeSwapTwo + 2);
    }

    function testMultipleLP() public {
        setupTokens(20e18, 20e18, 0, 0);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(20e18, 20e18);

        address someOne = vm.addr(1);
        baseToken.mint(address(someOne), 20e18);
        quoteToken.mint(address(someOne), 20e18);
        vm.startPrank(someOne);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(20e18, 20e18);
        vm.stopPrank();

        assertEq(swap.getLiquidityTokenBalance(), 20e18);
        vm.prank(someOne);
        assertEq(swap.getLiquidityTokenBalance(), 20e18);
    }

    function testWithdrawPartialLiquidity() public {
        setupTokens(20e18, 20e18, 0, 0);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(20e18, 20e18);

        address someOne = vm.addr(1);
        baseToken.mint(address(someOne), 20e18);
        quoteToken.mint(address(someOne), 20e18);
        vm.startPrank(someOne);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(20e18, 20e18);
        vm.stopPrank();

        swap.removeLiquidity(20e18);
        assertEq(swap.getLiquidityTokenBalance(), 0);
        vm.prank(someOne);
        assertEq(swap.getLiquidityTokenBalance(), 20e18);
    }

    function testPartialWithdrawLiquidityWithFee() public {
        setupTokens(20e18, 20e18, 0, 0);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(20e18, 20e18);

        address someOne = vm.addr(1);
        baseToken.mint(address(someOne), 20e18);
        quoteToken.mint(address(someOne), 20e18);
        vm.startPrank(someOne);
        baseToken.approve(address(swap), MAX_INT);
        quoteToken.approve(address(swap), MAX_INT);
        swap.addLiquidity(20e18, 20e18);
        vm.stopPrank();

        address someTwo = vm.addr(2);
        quoteToken.mint(address(someTwo), 20e18);
        doSwap(someTwo, 10, 1, true, 1e18);

        console.log(baseToken.balanceOf(address(swap)));
        console.log(quoteToken.balanceOf(address(swap)));
        swap.removeLiquidity(20e18);
        assertEq(swap.getLiquidityTokenBalance(), 0);

        uint feeSwap = (1e18 * (3)) / 1000;

        assertEq(baseToken.balanceOf(address(this)), 39e18 / 2 + feeSwap / 2);
        assertEq(quoteToken.balanceOf(address(this)), 25e18);

        vm.prank(someOne);
        assertEq(swap.getLiquidityTokenBalance(), 20e18);
    }

    // function testUnwrapBaseTokenNoPoolBalance() public {
    //     setupTokens(10e18, 10e18, 10e18, 10e18);
    //     baseToken.approve(address(swap), MAX_INT);
    //     swap.wrapBaseToken(5e18);
    //     deal(address(baseToken), address(swap), 0);
    //     vm.expectRevert(bytes("Insufficient pool balance"));
    //     swap.unwrapBaseToken(5e18);
    // }

    receive() external payable {}
}
