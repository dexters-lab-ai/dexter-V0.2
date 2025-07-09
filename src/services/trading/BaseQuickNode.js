import { getDefaultProvider, ethers } from "ethers";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { config } from "../../core/config.js";
dotenv.config();

const defaultConfig = {
  baseEndpoint: config.baseEndpoint,
  aggregatorEndpoint: config.baseAggregatorEndpoint || null
};

const ERC20_ABI = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)"
];

const ROUTER_ADDRESS = {
  ethereum: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  base: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24"
};

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// -----------------------------
// Exported Providers
// -----------------------------
// Declare and export a provider for the Base network.
export const baseProvider = getDefaultProvider(defaultConfig.baseEndpoint);

// If you also have Ethereum and Avalanche providers in your config,
// you can declare them similarly:
// export const ethProvider = new ethers.providers.JsonRpcProvider(config.ethEndpoint);
// export const avaxProvider = new ethers.providers.JsonRpcProvider(config.avaxEndpoint);

function getTruncatedAddress(address) {
  const str = address.toString();
  return str.length > 10 ? `${str.substring(0, 4)}...${str.substring(str.length - 4)}` : str;
}

function buildBaseExplorerLink(address, type = "token") {
  return type === "token"
    ? `[**${getTruncatedAddress(address)}**](https://basescan.org/token/${address})`
    : `[**${getTruncatedAddress(address)}**](https://basescan.org/address/${address})`;
}

const tokenDecimalsCache = {};

/**
 * Returns the decimals for a given token.
 * If tokenAddress is "BASE_NATIVE", returns 18.
 */
export async function getTokenDecimals(tokenAddress, provider) {
  if (tokenAddress === "BASE_NATIVE") return 18;
  if (tokenDecimalsCache[tokenAddress] !== undefined) return tokenDecimalsCache[tokenAddress];
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
  const formatted = ethers.utils.formatUnits(amount, decimals);
  const num = parseFloat(formatted);
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 6 });
}

/**
 * Helper Function:
 * Fetches a list of all ERC‑20 token contract addresses for which the wallet has ever been involved 
 * in a Transfer event (either as sender or receiver) using standard JSON‑RPC getLogs.
 */
export async function fetchERC20TokenList(wallet, provider) {
  const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
  const paddedAddress = ethers.utils.hexZeroPad(wallet.address, 32);

  const receivedFilter = {
    topics: [
      transferEventSignature,
      null,
      paddedAddress
    ],
    fromBlock: 0,
    toBlock: "latest"
  };

  const sentFilter = {
    topics: [
      transferEventSignature,
      paddedAddress,
      null
    ],
    fromBlock: 0,
    toBlock: "latest"
  };

  const [receivedLogs, sentLogs] = await Promise.all([
    provider.getLogs(receivedFilter),
    provider.getLogs(sentFilter)
  ]);

  const tokenSet = new Set();
  for (const log of [...receivedLogs, ...sentLogs]) {
    tokenSet.add(log.address);
  }
  return Array.from(tokenSet);
}

/**
 * Retrieves the native BASE (ETH) balance and all ERC‑20 token balances for the wallet.
 * If no tokenList is provided, it first uses `fetchERC20TokenList` to obtain the list of ERC‑20 token addresses.
 * Each token’s balance is formatted to a human‑readable string.
 */
export async function getDetailedFormattedBalancesBASE(wallet, tokenList = []) {
  // Use the exported baseProvider if available.
  const provider = baseProvider;

  if (!tokenList || tokenList.length === 0) {
    tokenList = await fetchERC20TokenList(wallet, provider);
  }

  const result = [];

  const nativeBalanceRaw = await provider.getBalance(wallet.address);
  const nativeFormatted = await formatTokenAmount(nativeBalanceRaw, "BASE_NATIVE", provider);
  result.push({
    symbol: `[**ETH**](https://basescan.org/address/${wallet.address})`,
    address: "BASE_NATIVE",
    balance: nativeFormatted
  });

  for (const tokenAddress of tokenList) {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
      const rawBalance = await contract.balanceOf(wallet.address);
      const formattedBalance = await formatTokenAmount(rawBalance, tokenAddress, provider);
      result.push({
        symbol: buildBaseExplorerLink(tokenAddress, "token"),
        address: tokenAddress,
        balance: formattedBalance
      });
    } catch (error) {
      console.error(`Error fetching balance for token ${tokenAddress}:`, error);
    }
  }
  return result;
}

/**
 * Sends a formatted swap quote message to the user.
 */
export async function sendQuoteDetails(bot, provider, userId, quote, inputToken, outputToken) {
  if (!inputToken || !outputToken) throw new Error("Invalid token addresses for quote details.");
  const formattedInput = await formatTokenAmount(quote.inAmount, inputToken, provider);
  const formattedOutput = await formatTokenAmount(quote.outAmount, outputToken, provider);
  const message =
    `Swap Quote Details:
• Input Amount: ${formattedInput}
• Expected Output: ${formattedOutput}
• Static Slippage: ${quote.slippageBps} bps
• Dynamic Slippage Range: ${quote.dynamicSlippage ? `${quote.dynamicSlippage.minBps}-${quote.dynamicSlippage.maxBps} bps` : 'N/A'}`;
  await bot.sendMessage(userId, message, { parse_mode: "Markdown" });
}

export async function getAllERC20TokenTransactionsBASE(walletAddress, options = {}) {
  const provider = baseProvider;
  // If a tokenList is not provided in options, get it using fetchERC20TokenList.
  let tokenList = options.tokenList;
  if (!tokenList || tokenList.length === 0) {
    tokenList = await fetchERC20TokenList({ address: walletAddress }, provider);
  }

  const aggregatedTransfers = [];
  const transferEventSignature = ethers.id("Transfer(address,address,uint256)");
  const fromBlock = options.fromBlock || "0x0";
  const toBlock = options.toBlock || "latest";
  const erc20Interface = new ethers.utils.Interface(ERC20_ABI);

  for (const tokenAddress of tokenList) {
    try {
      const paddedAddress = ethers.utils.hexZeroPad(walletAddress, 32);
      const filterFrom = {
        address: tokenAddress,
        topics: [transferEventSignature, paddedAddress],
        fromBlock: fromBlock,
        toBlock: toBlock
      };
      const logsFrom = await provider.getLogs(filterFrom);

      const filterTo = {
        address: tokenAddress,
        topics: [transferEventSignature, null, paddedAddress],
        fromBlock: fromBlock,
        toBlock: toBlock
      };
      const logsTo = await provider.getLogs(filterTo);

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
          token: tokenAddress
        };
      });
      aggregatedTransfers.push(...transfers);
    } catch (error) {
      console.error(`Error fetching transactions for token ${tokenAddress}:`, error);
    }
  }
  return aggregatedTransfers;
}

async function retryOperation(operation, retries = 5, delay = 1000) {
  try {
    return await operation();
  } catch (error) {
    if (retries <= 0) throw error;
    await sleep(delay);
    return retryOperation(operation, retries - 1, delay * 2);
  }
}

export class BaseQuickNode {
  constructor(bot) {
    this.bot = bot;
    this.provider = baseProvider; // Use the exported provider.
    this.logFilePath = path.join(process.cwd(), "history", "baseSwapLogs.json");
  }

  async refreshBalances(wallet, tokenList = []) {
    const nativeBalance = await this.provider.getBalance(wallet.address);
    const result = { BASE_NATIVE: nativeBalance.toString() };
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

  async getQuote({ inputToken, outputToken, amount, network = "base", action = "buy", walletAddress, options = {} }) {
    if (!inputToken || !outputToken) throw new Error("Missing inputToken or outputToken for quote.");
    if (!walletAddress) throw new Error("Missing walletAddress for quote.");
    
    const provider = this.provider;
    const valueInWei = ethers.parseEther(amount.toString());
    
    if (!config.uniswap.routerAbi) throw new Error("Uniswap router ABI is not configured.");
    if (!config.uniswap.wethBase && network === "base") throw new Error("WETH address for Base is not configured.");
    
    const expectedOut = ethers.BigNumber.from(valueInWei).mul(2);
    const slippageBps = options.slippage || 50;
    const slippageFactor = ethers.BigNumber.from(10000 - slippageBps);
    const amountOutMin = expectedOut.mul(slippageFactor).div(10000);
    const routerAddress = ROUTER_ADDRESS[network] || "0xDummyRouterAddress";
    
    const routerContract = new ethers.Contract(routerAddress, config.uniswap.routerAbi, provider);
    const deadline = Math.floor(Date.now() / 1000) + (options.deadlineSeconds || 1200);
    let txRequest;
    if (action === "buy") {
      txRequest = await routerContract.populateTransaction.swapExactETHForTokens(
        amountOutMin.toString(),
        [config.uniswap.wethBase, outputToken],
        walletAddress,
        deadline,
        { value: valueInWei.toString() }
      );
    } else if (action === "sell") {
      const inputDecimals = inputToken === "BASE_NATIVE" ? 18 : await getTokenDecimals(inputToken, provider);
      const amountInUnits = ethers.parseUnits(amount.toString(), inputDecimals);
      txRequest = await routerContract.populateTransaction.swapExactTokensForETH(
        amountInUnits.toString(),
        amountOutMin.toString(),
        [inputToken, config.uniswap.wethBase],
        walletAddress,
        deadline
      );
    } else {
      throw new Error("Invalid action. Must be 'buy' or 'sell'.");
    }
    
    console.log("Quote:", {
      inAmount: amount,
      outAmount: ethers.utils.formatUnits(expectedOut, await getTokenDecimals(outputToken, provider)),
      slippageBps,
      dynamicSlippage: { minBps: slippageBps, maxBps: slippageBps * 20 },
      to: txRequest.to,
      data: txRequest.data,
      value: txRequest.value
    });
    
    return {
      inAmount: amount,
      outAmount: ethers.utils.formatUnits(expectedOut, await getTokenDecimals(outputToken, provider)),
      slippageBps,
      dynamicSlippage: { minBps: slippageBps, maxBps: slippageBps * 20 },
      to: txRequest.to,
      data: txRequest.data,
      value: txRequest.value
    };
  }  

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

  async startBaseSwap({ wallet, inputToken, outputToken, amount, userId, tokenList = [] }) {
    if (!inputToken || !outputToken) throw new Error("Invalid swap parameters: inputToken or outputToken is undefined.");
    await retryOperation(() => this.bot.sendMessage(userId, "Fetching Swap Quote...", { parse_mode: "Markdown" }));
    const quote = await retryOperation(() =>
      this.getQuote({ inputToken, outputToken, amount: amount.toString(), network: "base", action: "buy", walletAddress: wallet.address })
    );
    await retryOperation(() => sendQuoteDetails(this.bot, this.provider, userId, quote, inputToken, outputToken));
    await retryOperation(() => this.bot.sendMessage(userId, "Executing Swap Transaction...", { parse_mode: "Markdown" }));
    const swapResult = await this.executeSwap({ route: quote, wallet });
    const detailedBalances = await getDetailedFormattedBalancesBASE.call(this, wallet, tokenList);
    const balanceMsg = detailedBalances.map(entry => `${entry.symbol}: ${entry.balance}`).join("\n\n");
    await retryOperation(() =>
      this.bot.sendMessage(userId, `Updated Balances:\n\n${balanceMsg}`, { parse_mode: "Markdown" })
    );
    const formattedIn = await formatTokenAmount(amount, inputToken, this.provider);
    const formattedOut = await formatTokenAmount(quote.outAmount, outputToken, this.provider);
    await retryOperation(() =>
      this.bot.sendMessage(
        userId,
        `Swap Successful!\n\nFrom: [${getTruncatedAddress(inputToken)}](https://basescan.org/token/${inputToken})\n` +
          `Amount Sent: ${formattedIn}\n` +
          `To: [${getTruncatedAddress(outputToken)}](https://basescan.org/token/${outputToken})\n` +
          `Amount Received: ${formattedOut}\n\n` +
          `[View Transaction](https://basescan.org/tx/${swapResult.txId})`,
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
  }

  async logSwap(logArgs) {
    try {
      const dirPath = path.join(process.cwd(), "history");
      if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
      const filePath = path.join(dirPath, "baseSwapLogs.json");
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
}
