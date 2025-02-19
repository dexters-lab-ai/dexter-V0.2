import { getDefaultProvider, ethers } from "ethers";
import dotenv from "dotenv";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { config } from "../../core/config.js";
dotenv.config();

const defaultConfig = {
  ethereumEndpoint: config.etherEndpoint, 
  aggregatorEndpoint: config.ethereumAggregatorEndpoint || null, // Optional aggregator endpoint
};

// -------------------------------------------------
// Exported Ethereum Provider
// -------------------------------------------------
export const ethProvider = getDefaultProvider(defaultConfig.ethereumEndpoint);

// -------------------------------------------------
// Axios instance for JSON-RPC calls
// -------------------------------------------------
const axiosInstance = axios.create({
  baseURL: defaultConfig.ethereumEndpoint,
  headers: { "Content-Type": "application/json" }
});

// -------------------------------------------------
// Helper: Sleep for ms milliseconds
// -------------------------------------------------
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// -------------------------------------------------
// Helper: Exponential Backoff Retry
// -------------------------------------------------
async function retryOperation(operation, retries = 5, delay = 1000) {
  try {
    return await operation();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retryOperation(operation, retries - 1, delay * 2);
  }
}

// -------------------------------------------------
// Helper: JSON-RPC Call using Axios
// -------------------------------------------------
async function rpcCall(method, params) {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params
  };
  const response = await retryOperation(() => axiosInstance.post("", payload));
  return response.data;
}

// -------------------------------------------------
// ERC20 ABI for standard ERC20 functions
// -------------------------------------------------
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)"
];

// -------------------------------------------------
// Helper: Truncate Address and Build Etherscan Link
// -------------------------------------------------
function getTruncatedAddress(address) {
  const str = address.toString();
  return str.length > 10 ? `${str.substring(0, 4)}...${str.substring(str.length - 4)}` : str;
}

function buildEtherscanLink(address, type = "token") {
  // For tokens: https://etherscan.io/token/<address>
  // For addresses: https://etherscan.io/address/<address>
  if (type === "token") {
    return `[**${getTruncatedAddress(address)}**](https://etherscan.io/token/${address})`;
  } else {
    return `[**${getTruncatedAddress(address)}**](https://etherscan.io/address/${address})`;
  }
}

// -------------------------------------------------
// Token Helpers for Ethereum (ERC20)
// -------------------------------------------------
const tokenDecimalsCache = {};

/**
 * Retrieves token metadata using QuickNode’s RPC method "qn_getTokenMetadataByContractAddress"
 * and returns the token decimals. For native ETH, returns 18.
 */
async function getTokenDecimals(tokenAddress, provider) {
  if (tokenAddress === "ETH") return 18;
  if (tokenDecimalsCache[tokenAddress] !== undefined) {
    return tokenDecimalsCache[tokenAddress];
  }
  try {
    const metadata = await rpcCall("qn_getTokenMetadataByContractAddress", [{
      contract: tokenAddress
    }]);
    // Expected structure: { result: { address, name, symbol, decimals, ... } }
    let decimals;
    if (metadata && metadata.result && metadata.result.decimals !== undefined) {
      decimals = metadata.result.decimals;
    } else if (metadata && metadata.decimals !== undefined) {
      decimals = metadata.decimals;
    } else {
      throw new Error("Token metadata missing decimals");
    }
    tokenDecimalsCache[tokenAddress] = decimals;
    return decimals;
  } catch (error) {
    console.error(`Error fetching metadata for token ${tokenAddress}:`, error);
    throw error;
  }
}

/**
 * Formats a raw token amount into a human‑readable string using its decimals.
 */
async function formatTokenAmount(amount, tokenAddress, provider) {
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

/**
 * Retrieves detailed formatted token balances using QuickNode’s RPC method "qn_getWalletTokenBalance".
 * Returns an array of objects with the shape:
 *   { symbol, address, balance }
 * The native ETH balance is always included at the top.
 */
async function getDetailedFormattedBalances(wallet, provider, tokenList = []) {
  try {
    // Call QuickNode RPC to get all token balances for the wallet.
    const rpcResponse = await rpcCall("qn_getWalletTokenBalance", [{
      wallet: wallet.address,
    }]);
    const formattedBalances = [];
    // Add native ETH balance.
    const ethRaw = await provider.getBalance(wallet.address);
    const ethFormatted = await formatTokenAmount(ethRaw, "ETH", provider);
    formattedBalances.push({
      symbol: `[**ETH**](https://etherscan.io/address/${wallet.address})`,
      address: "ETH",
      balance: ethFormatted,
    });
    // Process tokens returned by the RPC call.
    if (rpcResponse && rpcResponse.result && Array.isArray(rpcResponse.result)) {
      for (const token of rpcResponse.result) {
        let formattedBalance;
        try {
          formattedBalance = ethers.utils.formatUnits(token.totalBalance, token.decimals);
          formattedBalance = parseFloat(formattedBalance).toLocaleString("en-US", {
            minimumFractionDigits: 0,
            maximumFractionDigits: 6,
          });
        } catch (err) {
          formattedBalance = "0";
        }
        formattedBalances.push({
          symbol: `[**${token.symbol}**](https://etherscan.io/token/${token.address})`,
          address: token.address,
          balance: formattedBalance,
        });
      }
    }
    return formattedBalances;
  } catch (error) {
    console.error("Error fetching token balances using QuickNode RPC:", error);
    throw error;
  }
}

/**
 * Sends a formatted swap quote message to the user.
 */
async function sendQuoteDetails(bot, provider, userId, quote, inputToken, outputToken) {
  try {
    const formattedInput = await formatTokenAmount(quote.inAmount, inputToken, provider);
    const formattedOutput = await formatTokenAmount(quote.outAmount, outputToken, provider);
    const message = `📜 **Swap Quote Details:**\n\n` +
      `• **Input Amount:** ${formattedInput}\n\n` +
      `• **Expected Output:** ${formattedOutput}\n\n` +
      `• **Static Slippage:** ${quote.slippageBps} bps\n\n` +
      `• **Dynamic Slippage Range:** ${quote.dynamicSlippage ? `${quote.dynamicSlippage.minBps}-${quote.dynamicSlippage.maxBps} bps` : "N/A"}`;
    await bot.sendMessage(userId, message, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Error sending quote details:", error.message);
  }
}

/**
 * Retrieves all ERC20 token transactions for a given wallet address using QuickNode’s RPC method "qn_getWalletTokenTransactions".
 * This function is used for Ethereum only.
 *
 * It first calls "qn_getWalletTokenBalance" to get a list of tokens held by the wallet, then iterates over each token
 * and calls "qn_getWalletTokenTransactions" (with pagination options) to fetch transfer events.
 *
 * @param {string} walletAddress - The wallet address to query.
 * @param {Object} options - Optional parameters:
 *   - page {number} (default: 1)
 *   - perPage {number} (default: 10)
 *   - fromBlock {string} (optional)
 *   - toBlock {string} (optional)
 * @returns {Array} An aggregated list of transfer objects.
 */
export async function getAllERC20TokenTransactionsETH(walletAddress, options = {}) {
  const provider = ethProvider;
  
  let balanceResponse;
  try {
    balanceResponse = await rpcCall("qn_getWalletTokenBalance", [{
      wallet: walletAddress,
    }]);
  } catch (error) {
    console.error("Error fetching wallet token balances:", error);
    throw error;
  }
  
  const tokens = (balanceResponse && balanceResponse.result && Array.isArray(balanceResponse.result))
    ? balanceResponse.result
    : [];
  
  const aggregatedTransfers = [];
  const page = options.page || 1;
  const perPage = options.perPage || 10;
  const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
  const fromBlock = options.fromBlock || "0x0";
  const toBlock = options.toBlock || "latest";
  const erc20Interface = new ethers.utils.Interface(ERC20_ABI);
  
  for (const token of tokens) {
    try {
      const paddedAddress = ethers.utils.hexZeroPad(walletAddress, 32);
      const filterFrom = {
        address: token.address,
        topics: [transferEventSignature, paddedAddress],
        fromBlock: fromBlock,
        toBlock: toBlock
      };
      const logsFrom = await ethProvider.getLogs(filterFrom);
  
      const filterTo = {
        address: token.address,
        topics: [transferEventSignature, null, paddedAddress],
        fromBlock: fromBlock,
        toBlock: toBlock
      };
      const logsTo = await ethProvider.getLogs(filterTo);
  
      const allLogs = logsFrom.concat(logsTo);
      const transfers = allLogs.map(log => {
        const decoded = erc20Interface.decodeEventLog("Transfer", log.data, log.topics);
        return {
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.logIndex,
          from: decoded.from,
          to: decoded.to,
          value: decoded.value.toString(),
          token: token.address
        };
      });
      aggregatedTransfers.push(...transfers);
    } catch (error) {
      console.error(`Error fetching transactions for token ${token.address}:`, error);
    }
  }
  return aggregatedTransfers;
}

// -------------------------------------------------
// EthereumQuickNode Class
// -------------------------------------------------
export class EthereumQuickNode {
  constructor(bot) {
    this.bot = bot;
    this.provider = ethProvider; // Use the exported provider.
    this.logFilePath = path.join(process.cwd(), "history", "ethereumSwapLogs.json");
  }

  /**
   * Refreshes raw balances for the given wallet.
   * tokenList is an array of ERC20 token addresses.
   * (Uses traditional contract calls for tokens provided manually.)
   */
  async refreshBalances(wallet, tokenList = []) {
    const ethBalance = await this.provider.getBalance(wallet.address);
    const result = {
      ETH: ethBalance.toString() // raw balance in wei
    };
    for (const tokenAddress of tokenList) {
      try {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
        const balance = await contract.balanceOf(wallet.address);
        result[tokenAddress] = balance.toString();
      } catch (error) {
        console.error(`Error fetching balance for token ${tokenAddress}:`, error);
      }
    }
    return result;
  }

  /**
   * Retrieves a swap quote using live on‑chain data from the Uniswap V2 router (or TraderJoe, if configured).
   *
   * For "buy": Swaps ETH for tokens using swapExactETHForTokens.
   * For "sell": Swaps tokens for ETH using swapExactTokensForETH.
   *
   * Expects:
   *  - inputToken: For "buy", should be "ETH"; for "sell", the ERC20 token address.
   *  - outputToken: For "buy", the ERC20 token address; for "sell", "ETH".
   *  - amount: The input amount as a string (in ETH or token units).
   *  - walletAddress: The user's wallet address.
   *  - action: "buy" or "sell" (default "buy").
   *  - options: Optional settings (e.g., { slippage, deadlineSeconds }).
   */
  async getQuote({ inputToken, outputToken, amount, walletAddress, action = "buy", options = {} }) {
    if (!inputToken || !outputToken) throw new Error("Missing inputToken or outputToken for quote.");
    if (!walletAddress) throw new Error("Missing wallet address for quote.");
    
    const provider = this.provider;
    const valueInWei = ethers.parseEther(amount.toString());
    
    if (!config.uniswap.routerAbi) throw new Error("Uniswap router ABI is not configured.");
    if (!config.uniswap.wethEthereum) throw new Error("WETH address for Ethereum is not configured.");
    
    const routerAddress = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"; // Uniswap V2 router on Ethereum
    const routerContract = new ethers.Contract(routerAddress, config.uniswap.routerAbi, provider);
    const deadline = Math.floor(Date.now() / 1000) + (options.deadlineSeconds || 1200);
    const slippageBps = options.slippage || 50;
    
    if (action === "buy") {
      const valueInWei = ethers.utils.parseEther(amount.toString());
      const amountsOut = await routerContract.getAmountsOut(valueInWei, [config.uniswap.wethEthereum, outputToken]);
      const expectedOut = amountsOut[amountsOut.length - 1];
      const slippageFactor = ethers.BigNumber.from(10000 - slippageBps);
      const amountOutMin = expectedOut.mul(slippageFactor).div(10000);
      const txRequest = await routerContract.populateTransaction.swapExactETHForTokens(
        amountOutMin.toString(),
        [config.uniswap.wethEthereum, outputToken],
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
      const inputDecimals = await getTokenDecimals(inputToken, provider);
      const amountInUnits = ethers.utils.parseUnits(amount.toString(), inputDecimals);
      const amountsOut = await routerContract.getAmountsOut(amountInUnits, [inputToken, config.uniswap.wethEthereum]);
      const expectedOut = amountsOut[amountsOut.length - 1];
      const slippageFactor = ethers.BigNumber.from(10000 - slippageBps);
      const amountOutMin = expectedOut.mul(slippageFactor).div(10000);
      const txRequest = await routerContract.populateTransaction.swapExactTokensForETH(
        amountInUnits.toString(),
        amountOutMin.toString(),
        [inputToken, config.uniswap.wethEthereum],
        walletAddress,
        deadline
      );
      return {
        inAmount: amount,
        outAmount: ethers.utils.formatUnits(expectedOut, 18), // ETH has 18 decimals.
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
   * Expects a route object with:
   *  - to: the DEX router address,
   *  - data: the transaction data (hex string),
   *  - value: the amount of ETH to send (if needed).
   */
  async executeSwap({ route, wallet }) {
    if (!route || !route.to || !route.data) throw new Error("Invalid route object for swap execution.");
    const tx = {
      to: route.to,
      data: route.data,
      value: ethers.BigNumber.from(route.value || "0")
    };
    const response = await retryOperation(() => wallet.sendTransaction(tx));
    const receipt = await retryOperation(() => response.wait());
    if (receipt.status !== 1) throw new Error("Transaction failed in receipt");
    return { txId: response.hash, receipt };
  }

  /**
   * Starts the Ethereum swap process.
   * This method:
   *  - Fetches a quote,
   *  - Sends the formatted quote details to the user,
   *  - Executes the swap,
   *  - Fetches updated token balances using QuickNode RPC,
   *  - Sends a success message with formatted balances,
   *  - Logs the swap.
   * tokenList is an array of ERC20 token addresses (optional).
   */
  async startEthereumSwap({ wallet, inputToken, outputToken, amount, userId, tokenList = [] }) {
    try {
      await this.bot.sendMessage(
        userId,
        `🔄 **Fetching Swap Quote...**\n\nRetrieving best rates for swapping tokens on Ethereum...`,
        { parse_mode: "Markdown" }
      );
      console.log("🔄 Fetching swap quote from Paraswap...");
      const quote = await retryOperation(() =>
        this.getQuote({ inputToken, outputToken, amount: amount.toString(), walletAddress: wallet.address, action: "buy" })
      );
      
      await retryOperation(() => sendQuoteDetails(this.bot, this.provider, userId, quote, inputToken, outputToken));
      
      await this.bot.sendMessage(
        userId,
        `⚡ **Executing Swap Transaction...**\n\nProcessing your swap on Ethereum...`,
        { parse_mode: "Markdown" }
      );
      console.log("🔄 Executing swap transaction...");
      const swapResult = await this.executeSwap({ route: quote, wallet });
      console.log("✅ Swap executed:", swapResult);
      
      const detailedBalances = await getDetailedFormattedBalances(wallet, this.provider, tokenList);
      const balanceMsg = detailedBalances.map(entry => `${entry.symbol}: ${entry.balance}`).join("\n\n");
      await retryOperation(() =>
        this.bot.sendMessage(userId, `🏦 **Updated Balances:**\n\n${balanceMsg}`, { parse_mode: "Markdown" })
      );
      
      const formattedIn = await formatTokenAmount(amount, inputToken, this.provider);
      const formattedOut = await formatTokenAmount(quote.outAmount, outputToken, this.provider);
      await retryOperation(() =>
        this.bot.sendMessage(
          userId,
          `🎉 **Swap Successful!**\n\n` +
            `🔹 **From:** [${getTruncatedAddress(inputToken)}](https://etherscan.io/token/${inputToken})\n` +
            `💰 **Amount Sent:** ${formattedIn}\n` +
            `🔹 **To:** [${getTruncatedAddress(outputToken)}](https://etherscan.io/token/${outputToken})\n` +
            `💎 **Amount Received:** ${formattedOut}\n\n` +
            `[View Transaction](https://etherscan.io/tx/${swapResult.txId})`,
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
      console.error("❌ Error during Ethereum swap execution:", error.message);
      await this.bot.sendMessage(
        userId,
        `🚨 **Swap Failed!**\n\n❌ Error: ${error.message}\n\n⚠️ Please check your balance or try again later.`,
        { parse_mode: "Markdown" }
      );
      throw new Error("Failed to complete token swap.");
    }
  }

  /**
   * Logs the swap details to a file.
   */
  async logSwap(logArgs) {
    try {
      const dirPath = path.join(process.cwd(), "history");
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      const filePath = path.join(dirPath, "ethereumSwapLogs.json");
      const data = { ...logArgs };
      if (fs.existsSync(filePath)) {
        let fileData = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (Array.isArray(fileData)) {
          fileData.push(data);
        } else {
          console.warn("Unexpected log file format. Resetting log file.");
          fileData = [data];
        }
        fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
      } else {
        fs.writeFileSync(filePath, JSON.stringify([data], null, 2));
      }
    } catch (error) {
      console.error("Error logging swap:", error);
    }
  }
}
