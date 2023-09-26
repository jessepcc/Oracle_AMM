import Web3 from "web3";
import OracleSwapAbi from "./abi/OracleSwapAbi.json";
import { BigNumber } from "ethers";

export async function getWalletLPBalance(
    web3: Web3,
    account: string,
    swapContractAddress: string
): Promise<BigNumber> {
    const swapContract = new web3.eth.Contract(
        OracleSwapAbi as any,
        swapContractAddress
    );
    return BigNumber.from(
        await swapContract.methods
            .getLiquidityTokenBalance()
            .call({ from: account! })
    );
}

export async function getTotalLiquidityTokenSupply(
    web3: Web3,
    swapContractAddress: string
): Promise<BigNumber> {
    const swapContract = new web3.eth.Contract(
        OracleSwapAbi as any,
        swapContractAddress
    );
    return BigNumber.from(
        await swapContract.methods.getTotalLiquidityTokenSupply().call()
    );
}
