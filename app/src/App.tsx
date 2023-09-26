import React, { useEffect, useState } from "react";
import "./App.css";
import {
    EvmPriceServiceConnection,
    HexString,
    Price,
    PriceFeed,
} from "@pythnetwork/pyth-evm-js";
import { useMetaMask } from "metamask-react";
import Web3 from "web3";
import { ChainState, ExchangeRateMeta, tokenQtyToNumber } from "./utils";

import { OrderEntry } from "./OrderEntry";
import { PriceText } from "./PriceText";
import { MintButton } from "./MintButton";
import { AddLiquidity } from "./AddLiquidity";
import { RemoveLiquidity } from "./RemoveLiquidity";

import { getBalance } from "./erc20";
import { getWalletLPBalance, getTotalLiquidityTokenSupply } from "./LP";

export const CONFIG = {
    // Each token is configured with its ERC20 contract address and Pyth Price Feed ID.
    // You can find the list of price feed ids at https://pyth.network/developers/price-feed-ids
    // Note that feeds have different ids on testnet / mainnet.
    baseToken: {
        name: process.env.REACT_APP_BASE_TOKEN_NAME ?? "BASE_TOKEN",
        erc20Address: process.env.REACT_APP_BASE_TOKEN_ERC20_ADDRESS ?? "",
        pythPriceFeedId: process.env.REACT_APP_BASE_TOKEN_PYTH_ADDRESS ?? "",
        decimals: process.env.REACT_APP_BASE_TOKEN_DECIMALS
            ? parseInt(process.env.REACT_APP_BASE_TOKEN_DECIMALS)
            : 18,
    },
    quoteToken: {
        name: process.env.REACT_APP_QUOTE_TOKEN_NAME ?? "QUOTE_TOKEN",
        erc20Address: process.env.REACT_APP_QUOTE_TOKEN_ERC20_ADDRESS ?? "",
        pythPriceFeedId: process.env.REACT_APP_QUOTE_TOKEN_PYTH_ADDRESS ?? "",
        decimals: process.env.REACT_APP_QUOTE_TOKEN_DECIMALS
            ? parseInt(process.env.REACT_APP_QUOTE_TOKEN_DECIMALS)
            : 18,
    },
    swapContractAddress: process.env.REACT_APP_SWAP_ADDERESS ?? "",
    pythContractAddress: process.env.REACT_APP_PYTH_ADDRESS ?? "",
    priceServiceUrl: process.env.REACT_APP_PYTH_SERVICE_URL ?? "",
    mintQty: 100,
};

function App() {
    const { status, connect, account, ethereum } = useMetaMask();

    const [web3, setWeb3] = useState<Web3 | undefined>(undefined);

    useEffect(() => {
        if (status === "connected") {
            setWeb3(new Web3(ethereum));
        }
    }, [status, ethereum]);

    const [chainState, setChainState] = useState<ChainState | undefined>(
        undefined
    );

    useEffect(() => {
        async function refreshChainState() {
            if (web3 !== undefined && account !== null) {
                setChainState({
                    accountBaseBalance: await getBalance(
                        web3,
                        CONFIG.baseToken.erc20Address,
                        account
                    ),
                    accountQuoteBalance: await getBalance(
                        web3,
                        CONFIG.quoteToken.erc20Address,
                        account
                    ),
                    poolBaseBalance: await getBalance(
                        web3,
                        CONFIG.baseToken.erc20Address,
                        CONFIG.swapContractAddress
                    ),
                    poolQuoteBalance: await getBalance(
                        web3,
                        CONFIG.quoteToken.erc20Address,
                        CONFIG.swapContractAddress
                    ),
                    poolLPBalance: await getWalletLPBalance(
                        web3,
                        account,
                        CONFIG.swapContractAddress ?? undefined
                    ),
                    poolSupply: await getTotalLiquidityTokenSupply(
                        web3,
                        CONFIG.swapContractAddress ?? undefined
                    ),
                });
            } else {
                setChainState(undefined);
            }
        }

        const interval = setInterval(refreshChainState, 3000);

        return () => {
            clearInterval(interval);
        };
    }, [web3, account]);

    const [pythOffChainPrice, setPythOffChainPrice] = useState<
        Record<HexString, Price>
    >({});

    // Subscribe to offchain prices. These are the prices that a typical frontend will want to show.
    useEffect(() => {
        // The Pyth price service client is used to retrieve the current Pyth prices and the price update data that
        // needs to be posted on-chain with each transaction.
        const pythPriceService = new EvmPriceServiceConnection(
            CONFIG.priceServiceUrl,
            {
                logger: {
                    error: console.error,
                    warn: console.warn,
                    info: () => undefined,
                    debug: () => undefined,
                    trace: () => undefined,
                },
            }
        );

        pythPriceService.subscribePriceFeedUpdates(
            [
                CONFIG.baseToken.pythPriceFeedId,
                CONFIG.quoteToken.pythPriceFeedId,
            ],
            (priceFeed: PriceFeed) => {
                const price = priceFeed.getPriceUnchecked(); // Fine to use unchecked (not checking for staleness) because this must be a recent price given that it comes from a websocket subscription.
                setPythOffChainPrice((prev) => ({
                    ...prev,
                    [priceFeed.id]: price,
                }));
            }
        );
    }, []);

    const [exchangeRateMeta, setExchangeRateMeta] = useState<
        ExchangeRateMeta | undefined
    >(undefined);

    useEffect(() => {
        let basePrice = pythOffChainPrice[CONFIG.baseToken.pythPriceFeedId];
        let quotePrice = pythOffChainPrice[CONFIG.quoteToken.pythPriceFeedId];

        if (basePrice !== undefined && quotePrice !== undefined) {
            const exchangeRate =
                basePrice.getPriceAsNumberUnchecked() /
                quotePrice.getPriceAsNumberUnchecked();
            const lastUpdatedTime = new Date(
                Math.max(basePrice.publishTime, quotePrice.publishTime) * 1000
            );
            setExchangeRateMeta({ rate: exchangeRate, lastUpdatedTime });
        } else {
            setExchangeRateMeta(undefined);
        }
    }, [pythOffChainPrice]);

    const [time, setTime] = useState<Date>(new Date());

    useEffect(() => {
        const interval = setInterval(() => setTime(new Date()), 1000);
        return () => {
            clearInterval(interval);
        };
    }, []);

    const [isBuy, setIsBuy] = useState<boolean>(true);
    const [isAdd, setIsAdd] = useState<boolean>(true);

    if (status === "unavailable") return <div>MetaMask not available :(</div>;

    return (
        <div className="App">
            <div className="control-panel">
                <h2>
                    CPMM + Pyth Demo
                    {/* github logo */}
                </h2>
                {process.env.REACT_APP_CONTRACT_NETWORK ? (
                    <small>{`Deployed on ${process.env.REACT_APP_CONTRACT_NETWORK}`}</small>
                ) : null}
                <h3>Control Panel</h3>

                <div>
                    {status === "connected" ? (
                        <label>
                            Connected Wallet: <br /> {account}
                        </label>
                    ) : (
                        <button
                            onClick={async () => {
                                connect();
                            }}
                        >
                            {" "}
                            Connect Wallet{" "}
                        </button>
                    )}
                </div>

                <div>
                    <h3>Wallet Balances</h3>
                    {chainState !== undefined ? (
                        <div>
                            <p>
                                {tokenQtyToNumber(
                                    chainState.accountBaseBalance,
                                    CONFIG.baseToken.decimals
                                )}{" "}
                                {CONFIG.baseToken.name}
                                <MintButton
                                    web3={web3!}
                                    sender={account!}
                                    erc20Address={CONFIG.baseToken.erc20Address}
                                    destination={account!}
                                    qty={CONFIG.mintQty}
                                    decimals={CONFIG.baseToken.decimals}
                                />
                            </p>
                            <p>
                                {tokenQtyToNumber(
                                    chainState.accountQuoteBalance,
                                    CONFIG.quoteToken.decimals
                                )}{" "}
                                {CONFIG.quoteToken.name}
                                <MintButton
                                    web3={web3!}
                                    sender={account!}
                                    erc20Address={
                                        CONFIG.quoteToken.erc20Address
                                    }
                                    destination={account!}
                                    qty={CONFIG.mintQty}
                                    decimals={CONFIG.quoteToken.decimals}
                                />
                            </p>
                        </div>
                    ) : (
                        <p>loading...</p>
                    )}
                </div>

                <h3>AMM Balances</h3>
                <div>
                    <p>Contract address: {CONFIG.swapContractAddress}</p>
                    {chainState !== undefined ? (
                        <div>
                            <p>
                                {tokenQtyToNumber(
                                    chainState.poolBaseBalance,
                                    CONFIG.baseToken.decimals
                                )}{" "}
                                {CONFIG.baseToken.name}
                                <MintButton
                                    web3={web3!}
                                    sender={account!}
                                    erc20Address={CONFIG.baseToken.erc20Address}
                                    destination={CONFIG.swapContractAddress}
                                    qty={CONFIG.mintQty}
                                    decimals={CONFIG.baseToken.decimals}
                                />
                            </p>
                            <p>
                                {tokenQtyToNumber(
                                    chainState.poolQuoteBalance,
                                    CONFIG.quoteToken.decimals
                                )}{" "}
                                {CONFIG.quoteToken.name}
                                <MintButton
                                    web3={web3!}
                                    sender={account!}
                                    erc20Address={
                                        CONFIG.quoteToken.erc20Address
                                    }
                                    destination={CONFIG.swapContractAddress}
                                    qty={CONFIG.mintQty}
                                    decimals={CONFIG.quoteToken.decimals}
                                />
                            </p>
                        </div>
                    ) : (
                        <p>loading...</p>
                    )}
                </div>

                <h3>
                    Wallet {CONFIG.baseToken.name}-{CONFIG.quoteToken.name} Pool
                    Token
                </h3>
                <div>
                    {chainState !== undefined ? (
                        <div>
                            {chainState?.poolLPBalance !== undefined ? (
                                <div>
                                    Wallet:{" "}
                                    {tokenQtyToNumber(
                                        chainState?.poolLPBalance,
                                        CONFIG.baseToken.decimals
                                    )}
                                </div>
                            ) : null}
                            {chainState?.poolSupply !== undefined ? (
                                <div>
                                    Total:{" "}
                                    {tokenQtyToNumber(
                                        chainState?.poolSupply,
                                        CONFIG.baseToken.decimals
                                    )}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <div>loading...</div>
                    )}
                </div>
                {process.env.REACT_APP_GHURL ? (
                    <div className="foot">
                        <a
                            href={process.env.REACT_APP_GHURL}
                            target="_parent"
                            referrerPolicy="no-referrer"
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                x="0px"
                                y="0px"
                                width="35"
                                height="35"
                                viewBox="0,0,256,256"
                            >
                                <g
                                    fill="#ffffff"
                                    fillRule="nonzero"
                                    stroke="none"
                                    strokeWidth="1"
                                    strokeLinecap="butt"
                                    strokeLinejoin="miter"
                                    strokeMiterlimit="10"
                                    strokeDasharray=""
                                    strokeDashoffset="0"
                                    fontFamily="none"
                                    fontWeight="none"
                                    fontSize="none"
                                    textAnchor="none"
                                >
                                    <g transform="scale(8.53333,8.53333)">
                                        <path d="M15,3c-6.627,0 -12,5.373 -12,12c0,5.623 3.872,10.328 9.092,11.63c-0.056,-0.162 -0.092,-0.35 -0.092,-0.583v-2.051c-0.487,0 -1.303,0 -1.508,0c-0.821,0 -1.551,-0.353 -1.905,-1.009c-0.393,-0.729 -0.461,-1.844 -1.435,-2.526c-0.289,-0.227 -0.069,-0.486 0.264,-0.451c0.615,0.174 1.125,0.596 1.605,1.222c0.478,0.627 0.703,0.769 1.596,0.769c0.433,0 1.081,-0.025 1.691,-0.121c0.328,-0.833 0.895,-1.6 1.588,-1.962c-3.996,-0.411 -5.903,-2.399 -5.903,-5.098c0,-1.162 0.495,-2.286 1.336,-3.233c-0.276,-0.94 -0.623,-2.857 0.106,-3.587c1.798,0 2.885,1.166 3.146,1.481c0.896,-0.307 1.88,-0.481 2.914,-0.481c1.036,0 2.024,0.174 2.922,0.483c0.258,-0.313 1.346,-1.483 3.148,-1.483c0.732,0.731 0.381,2.656 0.102,3.594c0.836,0.945 1.328,2.066 1.328,3.226c0,2.697 -1.904,4.684 -5.894,5.097c1.098,0.573 1.899,2.183 1.899,3.396v2.734c0,0.104 -0.023,0.179 -0.035,0.268c4.676,-1.639 8.035,-6.079 8.035,-11.315c0,-6.627 -5.373,-12 -12,-12z"></path>
                                    </g>
                                </g>
                            </svg>
                        </a>
                    </div>
                ) : null}
            </div>

            <div className={"main"}>
                <h2>
                    {CONFIG.baseToken.name} to {CONFIG.quoteToken.name}
                </h2>
                <PriceText
                    price={pythOffChainPrice}
                    currentTime={time}
                    rate={exchangeRateMeta}
                    baseToken={CONFIG.baseToken}
                    quoteToken={CONFIG.quoteToken}
                />
                <h3>
                    Liquidity {CONFIG.baseToken.name}-{CONFIG.quoteToken.name}
                </h3>
                <div className="tab-header">
                    <div
                        className={`tab-item ${isAdd ? "active" : ""}`}
                        onClick={() => setIsAdd(true)}
                    >
                        Add Liquidity
                    </div>
                    <div
                        className={`tab-item ${!isAdd ? "active" : ""}`}
                        onClick={() => setIsAdd(false)}
                    >
                        Remove Liquidity
                    </div>
                </div>
                <div className="tab-content">
                    {isAdd ? (
                        <AddLiquidity
                            web3={web3}
                            chainState={chainState}
                            account={account}
                            approxPrice={exchangeRateMeta?.rate}
                            baseToken={CONFIG.baseToken}
                            quoteToken={CONFIG.quoteToken}
                            priceServiceUrl={CONFIG.priceServiceUrl}
                            pythContractAddress={CONFIG.pythContractAddress}
                            swapContractAddress={CONFIG.swapContractAddress}
                        />
                    ) : (
                        <RemoveLiquidity
                            web3={web3}
                            chainState={chainState}
                            account={account}
                            baseToken={CONFIG.baseToken}
                            quoteToken={CONFIG.quoteToken}
                            swapContractAddress={CONFIG.swapContractAddress}
                        />
                    )}
                </div>

                <h3>
                    Swap between {CONFIG.baseToken.name} and{" "}
                    {CONFIG.quoteToken.name}
                </h3>

                <div className="tab-header">
                    <div
                        className={`tab-item ${isBuy ? "active" : ""}`}
                        onClick={() => setIsBuy(true)}
                    >
                        Buy
                    </div>
                    <div
                        className={`tab-item ${!isBuy ? "active" : ""}`}
                        onClick={() => setIsBuy(false)}
                    >
                        Sell
                    </div>
                </div>
                <div className="tab-content">
                    <OrderEntry
                        web3={web3}
                        account={account}
                        isBuy={isBuy}
                        approxPrice={exchangeRateMeta?.rate}
                        baseToken={CONFIG.baseToken}
                        quoteToken={CONFIG.quoteToken}
                        priceServiceUrl={CONFIG.priceServiceUrl}
                        pythContractAddress={CONFIG.pythContractAddress}
                        swapContractAddress={CONFIG.swapContractAddress}
                    />
                </div>
            </div>
        </div>
    );
}

export default App;
