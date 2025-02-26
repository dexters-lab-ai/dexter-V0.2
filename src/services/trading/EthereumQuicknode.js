import { bot } from "../../core/bot.js";
import { ethers } from "ethers";
import dotenv from "dotenv";
import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { config } from "../../core/config.js";
import { getSwapTransaction } from "./paraswapHelper.js";
import { providers } from "./providers/ProviderList.js";

dotenv.config();

// -------------------------------------------------
// Helper: Sleep and Exponential Backoff Retry
// -------------------------------------------------
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
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
// ERC20 ABI for standard ERC20 functions
// -------------------------------------------------
const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)"
];

// -------------------------------------------------
// Helper: Truncate Address and Build Explorer Link
// -------------------------------------------------
function getTruncatedAddress(address) {
  const str = address.toString();
  return str.length > 10 ? `${str.substring(0, 4)}...${str.substring(str.length - 4)}` : str;
}

function buildExplorerUrl(network, txId) {
  const explorerMap = {
    ethereum: "https://etherscan.io/tx/",
    avalanche: "https://snowtrace.io/tx/",
    base: "https://basescan.org/tx/",
    linear: "https://lineascan.build/tx/",       // Linea mainnet explorer
    cyber: "https://cyberscan.io/tx/",           // (Verify: may change)
    fantom: "https://ftmscan.com/tx/",
    arbitrum: "https://arbiscan.io/tx/",
    berachain: "https://berascan.com/tx/",       // Berachain explorer
    nova: "https://nova-explorer.optimism.io/tx/", // Optimism Nova explorer
    optimism: "https://optimistic.etherscan.io/tx/",
    zkevm: "https://zkevm.polygonscan.com/tx/",
    scroll: "https://blockscout.scroll.io/tx/",  // Scroll explorer (using Blockscout)
    polygon: "https://polygonscan.com/tx/",
    bsc: "https://bscscan.com/tx/",
    celo: "https://celoscan.io/tx/",
    worldchain: "https://worldchainscan.io/tx/", // (Verify: may change)
    mantle: "https://explorer.mantle.xyz/tx/",
    zksync: "https://zkscan.io/tx/",
    omni: "https://omniscan.io/tx/"              // (Verify: may change)
  };  
  const baseUrl = explorerMap[network.toLowerCase()] || "https://etherscan.io/tx/";
  return `${baseUrl}${txId}`;
}

// -------------------------------------------------
// Token Helpers (using dynamic axios instance)
// -------------------------------------------------
async function getTokenDecimals(tokenAddress, axiosInstance, provider) {
  if (tokenAddress === "ETH") return 18; // interpret "ETH" as native
  try {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "qn_getTokenMetadataByContractAddress",
      params: [{ contract: tokenAddress }]
    };
    const response = await retryOperation(() => axiosInstance.post("", payload));
    const metadata = response.data;
    let decimals;
    if (metadata && metadata.result && metadata.result.decimals !== undefined) {
      decimals = metadata.result.decimals;
    } else if (metadata && metadata.decimals !== undefined) {
      decimals = metadata.decimals;
    } else {
      throw new Error("Token metadata missing decimals");
    }
    return decimals;
  } catch (error) {
    console.error(`Error fetching metadata for token ${tokenAddress}:`, error);
    throw error;
  }
}

async function formatTokenAmount(amount, tokenAddress, axiosInstance, provider) {
  const decimals = await getTokenDecimals(tokenAddress, axiosInstance, provider);
  try {
    const formatted = ethers.utils.formatUnits(amount, decimals);
    const num = parseFloat(formatted);
    return num.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  } catch (error) {
    console.error("Error formatting token amount:", error);
    return "0";
  }
}

async function sendQuoteDetails(bot, axiosInstance, provider, userId, quote, inputToken, outputToken) {
  try {
    const formattedInput = await formatTokenAmount(quote.inAmount, inputToken, axiosInstance, provider);
    const formattedOutput = await formatTokenAmount(quote.outAmount, outputToken, axiosInstance, provider);
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

// -------------------------------------------------
// Exported: Detailed Formatted Balances for ETH (dynamic)
// -------------------------------------------------
export async function getDetailedFormattedBalancesETH(wallet, tokenList = [], provider) {
  // For ETH, we use the ETH endpoint from config.
  const axiosInstance = axios.create({
    baseURL: config.etherEndpoint,
    headers: { "Content-Type": "application/json" }
  });

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
  
  // Query QuickNode for token balances
  const rpcResponse = await rpcCall("qn_getWalletTokenBalance", [{
    wallet: wallet.address,
  }]);

  const formattedBalances = [];

  // Native ETH
  const ethRaw = await provider.getBalance(wallet.address);
  const ethFormatted = await formatTokenAmount(ethRaw, "ETH", axiosInstance, provider);
  formattedBalances.push({
    symbol: `[**ETH**](https://etherscan.io/address/${wallet.address})`,
    address: "ETH",
    balance: ethFormatted,
  });

  // ERC-20 tokens
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
}

// -------------------------------------------------
// Helper: Get dynamic network resources
// -------------------------------------------------
function getNetworkResources(network) {
  const networkKey = network.toLowerCase();
  const provider = providers[networkKey];
  if (!provider) throw new Error(`No provider configured for network: ${network}`);
  const endpointKey = `${networkKey}Endpoint`;
  const endpoint = config[endpointKey];
  if (!endpoint) throw new Error(`No endpoint configured in config for network: ${network}`);
  const axiosInstance = axios.create({
    baseURL: endpoint,
    headers: { "Content-Type": "application/json" }
  });
  return { provider, endpoint, axiosInstance };
}

/**
 * Retrieves all ERC20 token transactions for a given wallet address using QuickNode’s RPC method "qn_getWalletTokenTransactions".
 * This function is for Ethereum only. Adjust for other networks if needed.
 */
export async function getAllERC20TokenTransactionsETH(walletAddress, options = {}) {
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
  const page = options.page || 2;
  const perPage = options.perPage || 20;
  const fromBlock = options.fromBlock || "0x0";
  const toBlock = options.toBlock || "latest";

  // For parsing logs
  const erc20Interface = new ethers.utils.Interface(ERC20_ABI);

  for (const token of tokens) {
    try {
      const rpcTxResponse = await rpcCall("qn_getWalletTokenTransactions", [{
        address: walletAddress,
        contract: token.address,
        page: page,
        perPage: perPage,
        fromBlock: options.fromBlock,
        toBlock: options.toBlock,
      }]);
      let transfers = [];
      if (rpcTxResponse && rpcTxResponse.transfers && Array.isArray(rpcTxResponse.transfers)) {
        transfers = rpcTxResponse.transfers;
      } else if (rpcTxResponse && rpcTxResponse.result && Array.isArray(rpcTxResponse.result.transfers)) {
        transfers = rpcTxResponse.result.transfers;
      }
      transfers = transfers.map(transfer => ({
        ...transfer,
        token: token
      }));
      aggregatedTransfers.push(...transfers);
    } catch (error) {
      console.error(`Error fetching transactions for token ${token.address}:`, error);
    }
  }
  return aggregatedTransfers;
}

// -------------------------------------------------
// EvmQuickNode Class (bot instance stored, but network is passed in to each method)
// -------------------------------------------------
export class EvmQuickNode {
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * Refresh balances for a given list of tokens on an EVM chain.
   */
  async refreshBalances({ network, wallet, tokenList = [] }) {
    const { provider } = getNetworkResources(network);
    const rawBalance = await provider.getBalance(wallet.address);
    const result = { [network.toLowerCase() === "ethereum" ? "ETH" : "NATIVE"]: rawBalance.toString() };

    for (const tokenAddress of tokenList) {
      try {
        const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        const balance = await contract.balanceOf(wallet.address);
        result[tokenAddress] = balance.toString();
      } catch (error) {
        console.error(`Error fetching balance for token ${tokenAddress}:`, error);
      }
    }
    return result;
  }

  /**
   * Builds a swap transaction route from Paraswap, given input/output tokens + amount.
   */
  async getQuote({ network, inputToken, outputToken, amount, walletAddress, action = "buy", options = {} }) {
    if (!inputToken || !outputToken) throw new Error("Missing token addresses for quote.");
    if (!walletAddress) throw new Error("Missing wallet address for quote.");

    const { provider, axiosInstance } = getNetworkResources(network);

    // Convert 'amount' to base units by using the token's decimals
    // For "ETH", we assume 18 decimals by default
    let decimals;
    if (typeof inputToken.decimals === "number") {
      decimals = inputToken.decimals;
    } else {
      decimals = inputToken === "ETH"
        ? 18
        : await getTokenDecimals(inputToken, axiosInstance, provider);
    }
    const valueBN = ethers.BigNumber.from(10).pow(decimals).mul(ethers.BigNumber.from(amount));

    // Map network to chain ID for Paraswap
    const networkIds = {
      ethereum: 1,          // Ethereum Mainnet
      avalanche: 43114,     // Avalanche C-Chain
      base: 8453,           // Base (Coinbase’s network, as configured)
      linear: 59144,        // Linea (formerly Linear) Mainnet (chain ID may vary)
      cyber: 7560 ,         // Cyber network 
      fantom: 250,          // Fantom Opera
      arbitrum: 42161,      // Arbitrum One
      berachain: 32520,     // Berachain (example value; verify with official docs)
      nova: 42170,          // Optimism Nova
      optimism: 10,         // Optimism
      zkevm: 1101,          // Polygon zkEVM (chain ID as per Polygon docs)
      scroll: 534353,       // Scroll Mainnet (or testnet, as applicable)
      polygon: 137,         // Polygon (Matic) Mainnet
      bsc: 56,              // Binance Smart Chain
      celo: 42220,          // Celo Mainnet
      worldchain: 480,        // Worldchain
      mantle: 5000,         // Mantle Mainnet (verify with official docs)
      zksync: 324,          // ZkSync Era Mainnet
      omni: 166               // Omni
    };    
    const networkID = networkIds[network.toLowerCase()] || 1;

    const txRequest = await getSwapTransaction({
      srcToken: inputToken,
      destToken: outputToken,
      srcAmount: valueBN.toString(),
      networkID,
      slippage: options.slippage,
      partner: options.partner,
      userAddress: walletAddress,
      receiver: options.receiver,
    });
    return txRequest;
  }

  /**
   * Executes a pre-built swap transaction route by sending/waiting for receipt.
   */
  async executeSwap({ route, wallet }) {
    if (!route || !route.to || !route.data) {
      throw new Error("Invalid route object for swap execution.");
    }
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
   * High-level method to do an EVM swap via Paraswap, plus some user messaging/logging.
   */
  async startEVMSwap({ network, wallet, inputToken, outputToken, amount, userId, tokenList = [] }) {
    const { provider, axiosInstance } = getNetworkResources(network);

    await this.bot.sendMessage(
      userId,
      `🔄 **Fetching Swap Quote on ${network.toUpperCase()}...**\n\nRetrieving best rates for swapping tokens...`,
      { parse_mode: "Markdown" }
    );
    console.log(`🔄 Fetching swap quote from Paraswap API on ${network}...`);

    // 1) Build route
    const quote = await retryOperation(() =>
      this.getQuote({
        network,
        inputToken,
        outputToken,
        amount: amount.toString(),
        walletAddress: wallet.address,
        action: "buy"
      })
    );

    // 2) Show quote details
    await retryOperation(() => sendQuoteDetails(this.bot, axiosInstance, provider, userId, quote, inputToken, outputToken));

    // 3) Execute swap
    await this.bot.sendMessage(
      userId,
      `⚡ **Executing Swap Transaction on ${network.toUpperCase()}...**\n\nProcessing your swap...`,
      { parse_mode: "Markdown" }
    );
    console.log(`🔄 Executing swap transaction on ${network}...`);
    const swapResult = await this.executeSwap({ route: quote, wallet });
    console.log("✅ Swap executed:", swapResult);

    // 4) Show updated balances
    const detailedBalances = await getDetailedFormattedBalancesETH(wallet, [], provider);
    const balanceMsg = detailedBalances.map(entry => `${entry.symbol}: ${entry.balance}`).join("\n\n");
    await retryOperation(() =>
      this.bot.sendMessage(userId, `🏦 **Updated Balances on ${network.toUpperCase()}:**\n\n${balanceMsg}`, { parse_mode: "Markdown" })
    );

    // 5) Summaries
    const formattedIn = await formatTokenAmount(amount, inputToken, axiosInstance, provider);
    const formattedOut = await formatTokenAmount(quote.outAmount, outputToken, axiosInstance, provider);
    await retryOperation(() =>
      this.bot.sendMessage(
        userId,
        `🎉 **Swap Successful on ${network.toUpperCase()}!**\n\n` +
          `🔹 **From:** [${getTruncatedAddress(inputToken)}](https://etherscan.io/token/${inputToken})\n` +
          `💰 **Amount Sent:** ${formattedIn}\n` +
          `🔹 **To:** [${getTruncatedAddress(outputToken)}](https://etherscan.io/token/${outputToken})\n` +
          `💎 **Amount Received:** ${formattedOut}\n\n` +
          `[View Transaction](${buildExplorerUrl(network, swapResult.txId)})`,
        { parse_mode: "Markdown" }
      )
    );

    // 6) Log the swap
    await retryOperation(() =>
      this.logSwap({
        network,
        logArgs: {
          inputToken,
          inAmount: amount,
          outputToken,
          outAmount: quote.outAmount,
          txId: swapResult.txId,
          timestamp: new Date().toISOString()
        }
      })
    );

    return swapResult;
  }

  /**
   * (NEW) Send a native (e.g. ETH) transfer.
   * 
   * @param {object} params
   *  - network: string 
   *  - wallet: ethers.Wallet (signer)
   *  - to: string (recipient address)
   *  - amount: string (human-readable, e.g. "0.5")
   * @returns receipt object
   */
  async sendEvmNativeTransfer({ network, wallet, to, amount }) {
    if (!network || !wallet || !to || !amount) {
      throw new Error("Missing required parameters for native transfer.");
    }
    // Parse human-readable (like "0.5") into BN
    const parsedValue = ethers.utils.parseEther(amount);

    // Send transaction
    const txObj = { to, value: parsedValue };
    const txResponse = await retryOperation(() => wallet.sendTransaction(txObj));
    const receipt = await retryOperation(() => txResponse.wait());

    if (receipt.status !== 1) {
      throw new Error("Native transfer transaction failed in receipt");
    }
    return receipt;
  }

  /**
   * (NEW) Send an ERC-20 token transfer.
   * 
   * @param {object} params
   *  - network: string
   *  - wallet: ethers.Wallet (signer)
   *  - tokenAddress: string (ERC-20 contract)
   *  - to: string (recipient address)
   *  - amount: string (human-readable, e.g. "100")
   * @returns receipt object
   */
  async sendEvmTokenTransfer({ network, wallet, tokenAddress, to, amount }) {
    if (!network || !wallet || !tokenAddress || !to || !amount) {
      throw new Error("Missing required parameters for token transfer.");
    }
    const { provider, axiosInstance } = getNetworkResources(network);

    // 1) Get token decimals
    const decimals = await getTokenDecimals(tokenAddress, axiosInstance, provider);

    // 2) Parse the amount to raw base units
    const rawAmount = ethers.utils.parseUnits(amount, decimals);

    // 3) Transfer
    const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, wallet);
    const txResponse = await retryOperation(() => erc20.transfer(to, rawAmount));
    const receipt = await retryOperation(() => txResponse.wait());

    if (receipt.status !== 1) {
      throw new Error("ERC-20 transfer failed in receipt");
    }
    return receipt;
  }

  /**
   * Logs swap activity to a JSON file on disk.
   */
  async logSwap({ network, logArgs }) {
    try {
      const dirPath = path.join(process.cwd(), "history");
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      const filePath = path.join(dirPath, `${network}SwapLogs.json`);
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

// -------------------------------------------------
// Export a singleton EvmQuickNode with the bot
// -------------------------------------------------
export const evmQuickNode = new EvmQuickNode(bot);
