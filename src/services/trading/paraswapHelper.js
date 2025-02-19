import axios from "axios";
import BigNumber from "bignumber.js";

// Base API URL for Paraswap
const API_URL = "https://api.paraswap.io";
// Default partner – replace with your actual partner name if needed.
const PARTNER = "chucknorrisv6";
// Default slippage percentage (1%)
const DEFAULT_SLIPPAGE = 1; // 1%

// Helper: Sleep for ms milliseconds
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Exponential Backoff Retry
async function retryOperation(operation, retries = 5, delay = 1000) {
  try {
    return await operation();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retryOperation(operation, retries - 1, delay * 2);
  }
}

/**
 * getRate
 * Fetches the optimal price route from Paraswap via its REST API.
 *
 * @param {object} params - Contains:
 *   - srcToken: { address, decimals }
 *   - destToken: { address, decimals }
 *   - srcAmount: string (amount in base units)
 *   - partner: optional string (default: PARTNER)
 * @returns {object} priceRoute (should include at least destAmount)
 */
async function getRate({ srcToken, destToken, srcAmount, partner = PARTNER }) {
  const queryParams = {
    srcToken: srcToken.address,
    destToken: destToken.address,
    srcDecimals: srcToken.decimals.toString(),
    destDecimals: destToken.decimals.toString(),
    amount: srcAmount,
    side: "SELL", // SELL side: selling srcToken for destToken
    network: "1", // Ethereum Mainnet
    partner,
    version: "6",
  };

  const searchString = new URLSearchParams(queryParams).toString();
  const pricesURL = `${API_URL}/prices/?${searchString}`;
  console.log("Paraswap GET Price URL:", pricesURL);

  const response = await retryOperation(() => axios.get(pricesURL));
  if (response.data && response.data.priceRoute) {
    return response.data.priceRoute;
  }
  throw new Error("Failed to get price route from Paraswap");
}

/**
 * buildSwap
 * Builds the swap transaction by calling Paraswap’s transactions endpoint.
 *
 * @param {object} params - Contains:
 *   - srcToken: { address, decimals }
 *   - destToken: { address, decimals }
 *   - srcAmount: string (in base units)
 *   - minAmount: string (in base units) – minimum acceptable destination amount (after slippage)
 *   - priceRoute: object returned by getRate
 *   - userAddress: string – the user's Ethereum address
 *   - receiver: optional receiver address (defaults to userAddress)
 *   - partner: optional string
 * @returns {object} Transaction parameters (e.g., { to, data, value, ... })
 */
async function buildSwap({ srcToken, destToken, srcAmount, minAmount, priceRoute, userAddress, receiver, partner }) {
  const txURL = `${API_URL}/transactions/1`; // "1" indicates Ethereum Mainnet
  const txConfig = {
    srcToken: srcToken.address,
    srcDecimals: srcToken.decimals,
    destToken: destToken.address,
    destDecimals: destToken.decimals,
    srcAmount,
    destAmount: minAmount,
    priceRoute,
    userAddress,
    partner: partner || PARTNER,
    receiver: receiver || userAddress,
  };

  const response = await retryOperation(() => axios.post(txURL, txConfig));
  if (response.data) {
    return response.data;
  }
  throw new Error("Failed to build swap transaction via Paraswap");
}

/**
 * getSwapTransaction
 * Combines the Paraswap steps: converts the human‑readable srcAmount to base units,
 * fetches the optimal price route, computes the minimum acceptable destination amount (considering slippage),
 * and builds the swap transaction.
 *
 * @param {object} params - Contains:
 *   - srcToken: { address, decimals, symbol }
 *   - destToken: { address, decimals, symbol }
 *   - srcAmount: string (human-readable, e.g., "1")
 *   - networkID: number (should be 1 for Ethereum Mainnet)
 *   - slippage: optional number (percentage, default DEFAULT_SLIPPAGE)
 *   - partner: optional string
 *   - userAddress: string
 *   - receiver: optional string
 * @returns {object} Transaction parameters as built by Paraswap.
 */
export async function getSwapTransaction({
  srcToken,
  destToken,
  srcAmount,
  networkID,
  slippage = DEFAULT_SLIPPAGE,
  partner,
  userAddress,
  receiver,
}) {
  try {
    const srcAmountBN = new BigNumber(srcAmount).multipliedBy(10 ** srcToken.decimals);
    const srcAmountInUnits = srcAmountBN.toFixed(0);

    const priceRoute = await getRate({
      srcToken,
      destToken,
      srcAmount: srcAmountInUnits,
      partner,
    });

    const minAmountBN = new BigNumber(priceRoute.destAmount).multipliedBy(1 - slippage / 100);
    const minAmount = minAmountBN.toFixed(0);

    const transactionRequest = await buildSwap({
      srcToken,
      destToken,
      srcAmount: srcAmountInUnits,
      minAmount,
      priceRoute,
      userAddress,
      receiver,
      partner,
    });
    console.log("Paraswap Transaction Request:", transactionRequest);
    return transactionRequest;
  } catch (error) {
    const err = error.response?.data || error.message || error;
    console.error("Error building Paraswap transaction:", err);
    throw new Error(err);
  }
}
