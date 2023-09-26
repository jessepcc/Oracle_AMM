import { useState, useEffect } from "react";
import Web3 from "web3";
import {
    ChainState,
    TokenConfig,
    numberToTokenQty,
    tokenQtyToNumber,
} from "./utils";
import OracleSwapAbi from "./abi/OracleSwapAbi.json";
import { BigNumber } from "ethers";
import { CONFIG } from "./App";

export function RemoveLiquidity(props: {
    web3: Web3 | undefined;
    chainState: ChainState | undefined;
    account: string | null;
    baseToken: TokenConfig;
    quoteToken: TokenConfig;
    swapContractAddress: string;
}) {
    const [qty, setQty] = useState<string>("0");

    const walletLPBalance = props.chainState?.poolLPBalance
        ? tokenQtyToNumber(
              props.chainState.poolLPBalance,
              props.baseToken.decimals
          )
        : 0;

    const totalBaseBalance = props.chainState?.poolBaseBalance
        ? tokenQtyToNumber(
              props.chainState.poolBaseBalance,
              props.baseToken.decimals
          )
        : 0;

    const totalQuoteBalance = props.chainState?.poolQuoteBalance
        ? tokenQtyToNumber(
              props.chainState.poolQuoteBalance,
              props.baseToken.decimals
          )
        : 0;

    const poolSupply = props.chainState?.poolSupply
        ? tokenQtyToNumber(
              props.chainState.poolSupply,
              props.baseToken.decimals
          )
        : 0;

    if (
        walletLPBalance === 0 ||
        totalBaseBalance === 0 ||
        totalQuoteBalance === 0 ||
        poolSupply === 0
    ) {
        return <div>Pool is empty</div>;
    }

    return (
        <div>
            <div>{`Current ${walletLPBalance.toFixed(6)}`}</div>
            Remove{" "}
            <input
                type="text"
                name="removeLiquidity"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
            />
            <button onClick={() => setQty(String(walletLPBalance))}>max</button>
            <div>Estimated amount to be received:</div>
            <table>
                <tbody>
                    <tr>
                        <td>{CONFIG.baseToken.name}</td>
                        <td>
                            {Number.parseFloat(qty)
                                ? (
                                      (totalBaseBalance *
                                          Number.parseFloat(qty)) /
                                      poolSupply
                                  ).toFixed(6)
                                : "-"}
                        </td>
                    </tr>

                    <tr>
                        <td>{CONFIG.quoteToken.name}</td>
                        <td>
                            {Number.parseFloat(qty)
                                ? (
                                      (totalQuoteBalance *
                                          Number.parseFloat(qty)) /
                                      poolSupply
                                  ).toFixed(6)
                                : "-"}
                        </td>
                    </tr>
                </tbody>
            </table>
            <div className="swap-steps">
                <button
                    onClick={() =>
                        removeLiquidity(
                            props.web3!,
                            props.swapContractAddress,
                            props.account!,
                            numberToTokenQty(qty, props.baseToken.decimals)
                        )
                    }
                >
                    Remove Liquidity
                </button>
            </div>
        </div>
    );
}
async function removeLiquidity(
    web3: Web3,
    swapContractAddress: string,
    sender: string,
    qty: BigNumber
) {
    const swapContract = new web3.eth.Contract(
        OracleSwapAbi as any,
        swapContractAddress
    );

    await swapContract.methods.removeLiquidity(qty).send({
        from: sender,
    });
}
