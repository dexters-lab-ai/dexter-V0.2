import { getDefaultProvider, ethers } from "ethers";
import dotenv from "dotenv";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { config } from "../../core/config.js";
dotenv.config();

const defaultConfig = {
  avalancheEndpoint: config.avaxEndpoint,
};

// -------------------------------------------------
// Exported Ethereum Provider
// -------------------------------------------------
export const avaxProvider = getDefaultProvider(defaultConfig.avalancheEndpoint);

// -----------------------------------------
// Axios instance for AvaCloud Data API
// -----------------------------------------
const axiosInstance = axios.create({
  baseURL: "https://glacier-api.avax.network/v1",
  headers: {
    "Content-Type": "application/json",
    "x-glacier-api-key": config.avacloudAPIKey
  }
});

// -----------------------------------------
// ERC20 ABI for basic ERC20 functions (fallback use only)
// -----------------------------------------
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)"
];

// -----------------------------------------
// TraderJoe Router Setup for Production Quoting
// -----------------------------------------
const TRADERJOE_ROUTER_ADDRESS = config.traderjoeRouter || "0x60aE616a2155Ee3d9A68541Ba4544862310933d4";
// TraderJoe uses the same router ABI as Uniswap V2:
const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] calldata path) external view returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapTokensForExactTokens(uint amountOut, uint amountInMax, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];
// WAVAX address on Avalanche Mainnet:
const WAVAX = config.wavax || "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";

// -----------------------------------------
// Helper: Sleep for ms milliseconds
// -----------------------------------------
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// -----------------------------------------
// Helper: Exponential Backoff Retry
// -----------------------------------------
async function retryOperation(operation, retries = 5, delay = 1000) {
  try {
    return await operation();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retryOperation(operation, retries - 1, delay * 2);
  }
}

// -----------------------------------------
// Helper: Truncate Address & Build Explorer Link
// -----------------------------------------
function getTruncatedAddress(address) {
  const str = address.toString();
  return str.length > 10 ? `${str.substring(0, 4)}...${str.substring(str.length - 4)}` : str;
}

function buildSnowtraceLink(tokenAddress) {
  return `[**${getTruncatedAddress(tokenAddress)}**](https://snowtrace.io/token/${tokenAddress})`;
}

// -----------------------------------------
// Token Helpers for Avalanche
// -----------------------------------------

const tokenDecimalsCache = {};

/**
 * Returns the decimals for a given token.
 * For native AVAX, returns 18.
 */
export async function getTokenDecimals(tokenAddress, provider) {
  if (tokenAddress === "AVAX") return 18;
  if (tokenDecimalsCache[tokenAddress] !== undefined) return tokenDecimalsCache[tokenAddress];
  // Fallback to an on-chain call:
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const decimals = await contract.decimals();
  tokenDecimalsCache[tokenAddress] = decimals;
  return decimals;
}

/**
 * Formats a token amount (in base units) into a human‑readable string.
 */
export async function formatTokenAmount(amount, tokenAddress, provider) {
  const decimals = await getTokenDecimals(tokenAddress, provider);
  try {
    const formatted = ethers.utils.formatUnits(amount, decimals);
    const num = parseFloat(formatted);
    return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  } catch (error) {
    console.error("Error formatting token amount:", error);
    return "0";
  }
}

// -----------------------------------------
// Data API Functions
// -----------------------------------------
async function dataApiPost(endpoint, body) {
  return await retryOperation(async () => {
    const response = await axiosInstance.post(endpoint, body);
    return response.data;
  });
}

/**
 * getBlockHeight
 * Fetches the latest block from the Data API and returns its block number.
 */
export async function getBlockHeight() {
  const result = await dataApiPost("/evm/blocks/getLatestBlocks", { pageSize: 1 });
  if (result && result.result && result.result.blocks && result.result.blocks.length > 0) {
    return result.result.blocks[0].blockNumber;
  }
  throw new Error("Failed to fetch latest block height");
}

/**
 * listErc20Balances
 * Fetches the ERC‑20 token balances for a given address at a specific block height.
 */
export async function listErc20Balances(address, blockNumber) {
  const result = await dataApiPost("/evm/balances/listErc20Balances", {
    address: address,
    blockNumber: blockNumber,
    pageSize: 20
  });
  const balances = [];
  if (result && result.result && Array.isArray(result.result.erc20TokenBalances)) {
    for (const page of result.result.erc20TokenBalances) {
      balances.push(...(Array.isArray(page) ? page : [page]));
    }
  }
  return balances;
}

/**
 * listRecentTransactions
 * Fetches recent transactions for a given address between start and end blocks.
 */
export async function listRecentTransactions(address) {
  const blockHeight = await getBlockHeight();
  const result = await dataApiPost("/evm/transactions/listTransactions", {
    address: address,
    pageSize: 40,
    startBlock: (Number(blockHeight) - 100000).toString(),
    endBlock: blockHeight.toString(),
    sortOrder: "desc"
  });
  return result && result.result && result.result.transactions ? result.result.transactions : [];
}

/**
 * getDetailedFormattedBalancesAVAX
 * Uses the Data API (avm.getAllBalances) to fetch all asset balances for the wallet,
 * then formats them for display.
 */
export async function getDetailedFormattedBalancesAVAX(wallet) {
  const provider = avaxProvider;
  // Get native AVAX balance via provider:
  const nativeBalanceRaw = await provider.getBalance(wallet.address);
  const nativeFormatted = await formatTokenAmount(nativeBalanceRaw, "AVAX", provider);
  const result = [{
    symbol: `[**AVAX**](https://snowtrace.io/address/${wallet.address})`,
    address: "AVAX",
    balance: nativeFormatted
  }];
  const blockNumber = await getBlockHeight();
  const erc20Balances = await listErc20Balances(wallet.address, blockNumber);
  for (const token of erc20Balances) {
    result.push({
      symbol: token.symbol
        ? `[**${token.symbol}**](https://snowtrace.io/token/${token.tokenAddress})`
        : buildSnowtraceLink(token.tokenAddress),
      address: token.tokenAddress,
      balance: ethers.utils.formatUnits(token.balance, token.decimals || 18)
    });
  }
  return result;
}

/**
 * getAllERC20TokenTransactions
 * Retrieves all asset transactions for a given wallet address using the official Avalanche X-Chain method "avm.getAddressTxs".
 *
 * For each asset held by the wallet (obtained via avm.getAllBalances), this function calls avm.getAddressTxs.
 * It aggregates the returned transaction IDs along with asset info.
 *
 * @param {string} walletAddress - The wallet address to query.
 * @param {object} options - Optional parameters:
 *    - pageSize: number (default: 20)
 *    - assetIDs: array of asset IDs to query (if not provided, all assets are used)
 * @returns {Array} An array of objects: { asset, txIDs, cursor }
 */
export async function getAllERC20TokenTransactionsAVAX(walletAddress, options = {}) {
  // Get asset list from avm.getAllBalances if not provided.
  let assetList = options.assetIDs;
  if (!assetList || assetList.length === 0) {
    try {
      const allBalances = await dataApiPost("/avm/getAllBalances", { address: walletAddress });
      assetList = (allBalances && allBalances.result && Array.isArray(allBalances.result.balances))
        ? allBalances.result.balances.map(bal => bal.asset)
        : [];
    } catch (error) {
      console.error("Error fetching assets via avm.getAllBalances:", error);
      assetList = [];
    }
  }
  const aggregatedResults = [];
  const pageSize = options.pageSize || 20;
  for (const assetID of assetList) {
    try {
      const params = {
        address: walletAddress,
        assetID: assetID,
        pageSize: pageSize
      };
      if (options.cursor) {
        params.cursor = options.cursor;
      }
      const response = await dataApiPost("/avm/getAddressTxs", params);
      if (response && response.result) {
        aggregatedResults.push({
          asset: assetID,
          txIDs: response.result.txIDs,
          cursor: response.result.cursor
        });
      }
    } catch (error) {
      console.error(`Error fetching transactions for asset ${assetID}:`, error);
    }
  }
  return aggregatedResults;
}

/**
 * Sends a formatted swap quote message to the user.
 */
export async function sendQuoteDetails(bot, provider, userId, quote, inputToken, outputToken) {
  if (!inputToken || !outputToken) throw new Error("Invalid token addresses for quote details.");
  const formattedInput = await formatTokenAmount(quote.inAmount, inputToken, provider);
  const formattedOutput = await formatTokenAmount(quote.outAmount, outputToken, provider);
  const message =
    `Swap Quote Details:\n` +
    `• Input Amount: ${formattedInput}\n` +
    `• Expected Output: ${formattedOutput}\n` +
    `• Static Slippage: ${quote.slippageBps} bps\n` +
    `• Dynamic Slippage Range: ${quote.dynamicSlippage ? `${quote.dynamicSlippage.minBps}-${quote.dynamicSlippage.maxBps} bps` : "N/A"}`;
  await bot.sendMessage(userId, message, { parse_mode: "Markdown" });
}

// -----------------------------------------
// AvalancheQuickNode Class
// -----------------------------------------
export class AvalancheQuickNode {
  constructor(bot) {
    this.bot = bot;
    this.provider = new ethers.providers.JsonRpcProvider(defaultConfig.avalancheEndpoint);
    this.logFilePath = path.join(process.cwd(), "history", "avalancheSwapLogs.json");
  }

  /**
   * refreshBalances
   * Retrieves the native AVAX balance via the provider and ERC‑20 balances via the Data API.
   * Returns an object mapping asset IDs to balances.
   */
  async refreshBalances(wallet) {
    try {
      const provider = this.provider;
      const nativeBalance = await provider.getBalance(wallet.address);
      const blockNumber = await getBlockHeight();
      const erc20Balances = await listErc20Balances(wallet.address, blockNumber);
      const result = { AVAX: nativeBalance.toString() };
      for (const token of erc20Balances) {
        result[token.tokenAddress] = token.balance;
      }
      return result;
    } catch (error) {
      console.error("Error refreshing balances:", error);
      throw error;
    }
  }

  /**
   * getQuote
   * Retrieves a production-level quote using TraderJoe as our preferred router.
   * For a "buy": swaps AVAX for an ERC20 token using swapExactAVAXForTokens.
   * For a "sell": swaps an ERC20 token for AVAX using swapExactTokensForAVAX.
   *
   * Returns an object with inAmount, outAmount, slippageBps, dynamicSlippage, and route details.
   */
  async getQuote({ inputToken, outputToken, amount, walletAddress, action = "buy", options = {} }) {
    if (!inputToken || !outputToken) throw new Error("Missing token addresses for quote.");
    if (!walletAddress) throw new Error("Missing wallet address for quote.");

    const provider = this.provider;
    const deadline = Math.floor(Date.now() / 1000) + (options.deadlineSeconds || 1200);
    const slippageBps = options.slippage || 50;
    // Use TraderJoe router and WAVAX on Avalanche
    const routerAddress = TRADERJOE_ROUTER_ADDRESS;
    const routerContract = new ethers.Contract(routerAddress, ROUTER_ABI, provider);

    if (action === "buy") {
      // For buying, inputToken should be "AVAX"
      const valueInWei = ethers.utils.parseEther(amount.toString());
      const amountsOut = await routerContract.getAmountsOut(valueInWei, [WAVAX, outputToken]);
      const expectedOut = amountsOut[amountsOut.length - 1];
      const slippageFactor = ethers.BigNumber.from(10000 - slippageBps);
      const amountOutMin = expectedOut.mul(slippageFactor).div(10000);
      const txRequest = await routerContract.populateTransaction.swapExactAVAXForTokens(
        amountOutMin.toString(),
        [WAVAX, outputToken],
        walletAddress,
        deadline,
        { value: valueInWei.toString() }
      );
      return {
        inAmount: amount,
        outAmount: ethers.utils.formatUnits(expectedOut, await getTokenDecimals(outputToken, provider)),
        slippageBps,
        dynamicSlippage: { minBps: slippageBps, maxBps: slippageBps * 20 },
        to: txRequest.to,
        data: txRequest.data,
        value: txRequest.value
      };
    } else if (action === "sell") {
      // For selling, outputToken should be "AVAX"
      const inputDecimals = await getTokenDecimals(inputToken, provider);
      const amountInUnits = ethers.utils.parseUnits(amount.toString(), inputDecimals);
      const amountsOut = await routerContract.getAmountsOut(amountInUnits, [inputToken, WAVAX]);
      const expectedOut = amountsOut[amountsOut.length - 1];
      const slippageFactor = ethers.BigNumber.from(10000 - slippageBps);
      const amountOutMin = expectedOut.mul(slippageFactor).div(10000);
      const txRequest = await routerContract.populateTransaction.swapExactTokensForAVAX(
        amountInUnits.toString(),
        amountOutMin.toString(),
        [inputToken, WAVAX],
        walletAddress,
        deadline
      );
      return {
        inAmount: amount,
        outAmount: ethers.utils.formatUnits(expectedOut, 18),
        slippageBps,
        dynamicSlippage: { minBps: slippageBps, maxBps: slippageBps * 20 },
        to: txRequest.to,
        data: txRequest.data,
        value: txRequest.value
      };
    } else {
      throw new Error("Invalid action. Must be 'buy' or 'sell'.");
    }
  }

  /**
   * Executes the swap transaction.
   * Issues the signed transaction via avm.issueTx.
   */
  async executeSwap({ route, wallet }) {
    try {
      const params = { tx: route.tx, encoding: "hex" };
      const response = await this.provider.send("avm.issueTx", params);
      console.log("Transaction issued. TxID:", response.result.txID);
      return { txId: response.result.txID, rawResponse: response };
    } catch (error) {
      console.error("Error during Avalanche swap execution:", error);
      throw error;
    }
  }

  /**
   * startAvalancheSwap
   * Performs the full swap process:
   *  - Fetches a quote via TraderJoe,
   *  - Sends formatted quote details,
   *  - Executes the swap transaction,
   *  - Refreshes balances via the Data API,
   *  - Sends a success message and logs the swap.
   */
  async startAvalancheSwap({ wallet, inputToken, outputToken, amount, userId }) {
    try {
      await retryOperation(() =>
        this.bot.sendMessage(userId, "🔄 Fetching Swap Quote...\nRetrieving best rates for swapping tokens...", { parse_mode: "Markdown" })
      );
      console.log("🔄 Fetching swap quote from TraderJoe...");
      const quote = await retryOperation(() =>
        this.getQuote({ inputToken, outputToken, amount: amount.toString(), walletAddress: wallet.address })
      );
      await retryOperation(() => sendQuoteDetails(this.bot, this.provider, userId, quote, inputToken, outputToken));
      await retryOperation(() =>
        this.bot.sendMessage(userId, "⚡ Executing Swap Transaction...\nProcessing your swap...", { parse_mode: "Markdown" })
      );
      console.log("🔄 Executing swap transaction...");
      // In production, the signed transaction (route.tx) must be built off-chain.
      // Here, we simulate with a placeholder.
      const route = { tx: "0x" + "dummy_signed_tx_hex_based_on_quote" };
      const swapResult = await this.executeSwap({ route, wallet });
      console.log("✅ Swap executed:", swapResult);
      
      const detailedBalances = await getDetailedFormattedBalancesAVAX(wallet);
      const balanceMsg = detailedBalances.map(entry => `${entry.symbol}: ${entry.balance}`).join("\n\n");
      await retryOperation(() =>
        this.bot.sendMessage(userId, `🏦 Updated Balances:\n\n${balanceMsg}`, { parse_mode: "Markdown" })
      );
      
      const formattedIn = await formatTokenAmount(amount, inputToken, this.provider);
      const formattedOut = await formatTokenAmount(quote.outAmount, outputToken, this.provider);
      await retryOperation(() =>
        this.bot.sendMessage(
          userId,
          `🎉 Swap Successful!\n\n` +
            `🔹 From: [${getTruncatedAddress(inputToken)}](https://snowtrace.io/token/${inputToken})\n` +
            `💰 Amount Sent: ${formattedIn}\n` +
            `🔹 To: [${getTruncatedAddress(outputToken)}](https://snowtrace.io/token/${outputToken})\n` +
            `💎 Amount Received: ${formattedOut}\n\n` +
            `🔗 [View Transaction](https://snowtrace.io/tx/${swapResult.txId})`,
          { parse_mode: "Markdown" }
        )
      );
      await this.logSwap({
        inputToken,
        inAmount: amount,
        outputToken,
        outAmount: quote.outAmount,
        txId: swapResult.txId,
        timestamp: new Date().toISOString()
      });
      return swapResult;
    } catch (error) {
      console.error("❌ Error during Avalanche swap execution:", error.message);
      await this.bot.sendMessage(userId, `🚨 Swap Failed!\n❌ Error: ${error.message}\n⚠️ Please check your balance or try again later.`, { parse_mode: "Markdown" });
      throw new Error("Failed to complete token swap.");
    }
  }

  async logSwap(logArgs) {
    try {
      const dirPath = path.join(process.cwd(), "history");
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      const filePath = path.join(dirPath, "avalancheSwapLogs.json");
      let fileData = [];
      if (fs.existsSync(filePath)) {
        fileData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (!Array.isArray(fileData)) fileData = [];
      }
      fileData.push(logArgs);
      fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
    } catch (error) {
      console.error("Error logging swap:", error);
    }
  }

  // Optional: Expose Data API helper methods as class methods.
  async getBlockHeight() {
    return await getBlockHeight();
  }
  async listErc20Balances(address, blockNumber) {
    return await listErc20Balances(address, blockNumber);
  }
  async listRecentTransactions(address) {
    return await listRecentTransactions(address);
  }
}