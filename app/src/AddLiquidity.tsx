import { useState, useEffect } from "react";
import Web3 from "web3";
import {
    ChainState,
    TokenConfig,
    numberToTokenQty,
    tokenQtyToNumber,
} from "./utils";
import { approveToken, getApprovedQuantity } from "./erc20";
import OracleSwapAbi from "./abi/OracleSwapAbi.json";
import { BigNumber } from "ethers";
import { CONFIG } from "./App";

export function AddLiquidity(props: {
    web3: Web3 | undefined;
    chainState: ChainState | undefined;
    account: string | null;
    approxPrice: number | undefined;
    baseToken: TokenConfig;
    quoteToken: TokenConfig;
    priceServiceUrl: string;
    pythContractAddress: string;
    swapContractAddress: string;
}) {
    const [base, setBase] = useState<string>("0");
    const [quote, setQuote] = useState<string>("0");

    const [baseAuthorizedQty, setBaseAuthorizedQty] = useState<BigNumber>(
        BigNumber.from("0")
    );
    const [quoteAuthorizedQty, setQuoteAuthorizedQty] = useState<BigNumber>(
        BigNumber.from("0")
    );
    const [isAuthorized, setIsAuthorized] = useState<boolean>(false);

    const numberRegex = /^\d*\.?\d*$/;

    function handleBaseQtyChange(qty: string) {
        setBase(qty);
        if (!numberRegex.test(qty) || !qty) return;

        const baseQty =
            qty !== "0"
                ? numberToTokenQty(qty, props.baseToken.decimals)
                : undefined;

        if (props.approxPrice !== undefined && baseQty !== undefined) {
            const quoteQty =
                tokenQtyToNumber(baseQty, props.baseToken.decimals) *
                props.approxPrice;
            setQuote(String(quoteQty.toFixed(3)));
        }
    }

    function handleQuoteQtyChange(qty: string) {
        setQuote(qty);
        if (!numberRegex.test(qty) || !qty) return;
        const quoteQty =
            qty !== "0"
                ? numberToTokenQty(qty, props.quoteToken.decimals)
                : undefined;

        if (props.approxPrice !== undefined && quoteQty !== undefined) {
            const baseQty =
                tokenQtyToNumber(quoteQty, props.baseToken.decimals) *
                props.approxPrice;
            setBase(String(baseQty.toFixed(3)));
        }
    }

    async function approveTokens() {
        const approveBase = approveToken(
            props.web3!,
            props.baseToken.erc20Address,
            props.account!,
            props.swapContractAddress
        );

        const approveQuote = approveToken(
            props.web3!,
            props.quoteToken.erc20Address,
            props.account!,
            props.swapContractAddress
        );

        await Promise.all([approveBase, approveQuote]);
    }

    useEffect(() => {
        async function helper() {
            if (props.web3 !== undefined && props.account !== null) {
                setBaseAuthorizedQty(
                    await getApprovedQuantity(
                        props.web3!,
                        props.baseToken.erc20Address,
                        props.account!,
                        props.swapContractAddress
                    )
                );

                setQuoteAuthorizedQty(
                    await getApprovedQuantity(
                        props.web3!,
                        props.quoteToken.erc20Address,
                        props.account!,
                        props.swapContractAddress
                    )
                );
            } else {
                setBaseAuthorizedQty(BigNumber.from("0"));
                setQuoteAuthorizedQty(BigNumber.from("0"));
            }
        }

        helper();
        const interval = setInterval(helper, 3000);

        return () => {
            clearInterval(interval);
        };
    }, [
        props.web3,
        props.account,
        props.swapContractAddress,
        props.baseToken,
        props.quoteToken,
    ]);

    useEffect(() => {
        if (
            !props.baseToken ||
            !props.quoteToken ||
            !base ||
            !quote ||
            base === "0" ||
            quote === "0"
        )
            return;
        if (
            baseAuthorizedQty.gte(
                numberToTokenQty(base, props.baseToken.decimals)
            ) &&
            quoteAuthorizedQty.gte(
                numberToTokenQty(quote, props.quoteToken.decimals)
            )
        ) {
            setIsAuthorized(true);
        } else {
            setIsAuthorized(false);
        }
    }, [
        baseAuthorizedQty,
        quoteAuthorizedQty,
        base,
        quote,
        props.baseToken,
        props.quoteToken,
    ]);

    const walletBaseBalance = props.chainState?.accountBaseBalance
        ? tokenQtyToNumber(
              props.chainState?.accountBaseBalance,
              CONFIG.baseToken.decimals
          ).toString()
        : undefined;
    const walletQuoteBalance = props.chainState?.accountQuoteBalance
        ? tokenQtyToNumber(
              props.chainState?.accountQuoteBalance,
              CONFIG.quoteToken.decimals
          ).toString()
        : undefined;

    return (
        <div>
            <div className="grid-wrapper">
                {props.baseToken.name}
                <input
                    name="addLiquidityBase"
                    type="text"
                    value={base}
                    onChange={(event) =>
                        handleBaseQtyChange(event.target.value)
                    }
                    disabled={props.approxPrice === undefined}
                />

                {walletBaseBalance ? (
                    <button
                        onClick={() => handleBaseQtyChange(walletBaseBalance)}
                    >
                        all in
                    </button>
                ) : null}
            </div>
            <div className="grid-wrapper">
                {props.quoteToken.name}
                <input
                    name="addLiquidityQuote"
                    type="text"
                    value={quote}
                    onChange={(event) =>
                        handleQuoteQtyChange(event.target.value)
                    }
                    disabled={props.approxPrice === undefined}
                />

                {walletQuoteBalance ? (
                    <button
                        onClick={() => handleBaseQtyChange(walletQuoteBalance)}
                    >
                        all in
                    </button>
                ) : null}
            </div>
            <div className="swap-steps">
                1.
                <button onClick={() => approveTokens()} disabled={isAuthorized}>
                    Approve
                </button>
                2.
                <button
                    onClick={async () =>
                        await sendAppLiquidityTx(
                            props.web3!,
                            props.swapContractAddress,
                            props.account!,
                            numberToTokenQty(base, props.baseToken.decimals),
                            numberToTokenQty(quote, props.quoteToken.decimals)
                        )
                    }
                    disabled={!isAuthorized}
                >
                    Add Liquidity
                </button>
            </div>
        </div>
    );
}

async function sendAppLiquidityTx(
    web3: Web3,
    swapContractAddress: string,
    sender: string,
    qtyBase: BigNumber,
    qtyQuote: BigNumber
) {
    const swapContract = new web3.eth.Contract(
        OracleSwapAbi as any,
        swapContractAddress
    );

    if (!swapContract || !sender || !qtyBase || !qtyQuote) return;

    await swapContract.methods
        .addLiquidity(qtyBase, qtyQuote)
        .send({ from: sender });
}
