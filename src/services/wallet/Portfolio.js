import Moralis from 'moralis';
import axios from 'axios';
import { config } from '../../core/config.js';

// --------------------
// Shared Axios Setup
// --------------------

const MORALIS_API_KEY = config.moralisAPIKey;
const axiosInstance = axios.create({
  headers: {
    accept: 'application/json',
    'X-API-Key': MORALIS_API_KEY,
  },
  timeout: 60000, // 60 seconds timeout
});

// Axios request with exponential backoff retries.
async function axiosRequestWithRetry(url, config = {}, retries = 3, backoff = 300) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await axiosInstance.get(url, config);
    } catch (error) {
      if (attempt === retries - 1) {
        throw error;
      }
      const delay = backoff * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

// Helper to perform a GET request and return the data.
async function universalFetch(url) {
  const response = await axiosRequestWithRetry(url);
  return response.data;
}

// --------------------
// Helper Functions
// --------------------
/**
 * Retries an asynchronous operation with exponential backoff.
 * @param {Function} operation - An async function to perform.
 * @param {number} attempts - Number of retry attempts.
 * @param {number} delay - Initial delay in ms.
 * @returns {Promise<any>} - The result of the operation.
 */
async function retryOperation(operation, attempts = 3, delay = 1000) {
  let currentDelay = delay;
  for (let i = 0; i < attempts; i++) {
    try {
      return await operation();
    } catch (error) {
      if (i === attempts - 1) {
        throw error;
      }
      console.warn(`Attempt ${i + 1} failed. Retrying in ${currentDelay} ms...`);
      await new Promise(resolve => setTimeout(resolve, currentDelay));
      currentDelay *= 2;
    }
  }
}

// Mapping natural chain names to their EVM hex IDs.
const moralisChainMapping = {
  solana: "mainnet",
  ethereum: "0x1",
  sepolia: "0xaa36a7",
  holesky: "0x4268",
  polygon: "0x89",
  polygon_amoy: "0x13882",
  binance: "0x38",
  bsc_testnet: "0x61",
  arbitrum: "0xa4b1",
  base: "0x2105",
  base_sepolia: "0x14a34",
  optimism: "0xa",
  linea: "0xe708",
  linea_sepolia: "0xe705",
  avalanche: "0xa86a",
  fantom: "0xfa",
  cronos: "0x19",
  gnosis: "0x64",
  gnosis_chiado: "0x27d8",
  chiliz: "0x15b38",
  chiliz_testnet: "0x15b32",
  moonbeam: "0x504",
  moonriver: "0x505",
  moonbase: "0x507",
  flow: "0x2eb",
  flow_testnet: "0x221",
  ronin: "0x7e4",
  ronin_saigon: "0x7e5",
  lisk: "0x46f",
  lisk_sepolia: "0x106a",
  pulsechain: "0x171"
};

/**
 * Fetches full portfolio balance data for a given wallet.
 *
 * For Solana, it uses Moralis.SolApi.account.getPortfolio.
 * For EVM chains, it maps the natural chain name (e.g., "ethereum", "avalanche", "base") 
 * to its hex ID and uses Moralis.EvmApi.wallets.getWalletTokenBalancesPrice.
 *
 * @param {string} chain - Natural chain name in lowercase ("solana", "ethereum", etc.).
 * @param {string} walletAddress - The wallet address (for EVM, a full hex string; for Solana, a base58 public key).
 * @returns {Object} The portfolio data (balances, tokens, etc.) as returned by Moralis.
 */
export async function getPortfolioData(chain, walletAddress) {
  try {
    if (chain.toLowerCase() === "solana") {
      // For Solana, use the SolApi with retry logic.
      const response = await retryOperation(() =>
        Moralis.SolApi.account.getPortfolio({
          network: "mainnet", // Adjust if needed.
          address: walletAddress
        })
      );
      console.log("Solana Portfolio:", response.result);
      return response.result;
    } else {
      // For EVM chains, get the corresponding hex chain ID.
      const hexChainId = moralisChainMapping[chain.toLowerCase()];
      if (!hexChainId) {
        throw new Error(`Chain "${chain}" is not supported.`);
      }
      const response = await retryOperation(() =>
        Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
          chain: hexChainId,
          address: walletAddress
        })
      );
      
      console.log("[EVM] Portfolio:", JSON.stringify(response.result, null, 2));
      return response.result;
    }
  } catch (error) {
    console.error("Error fetching portfolio data:", error);
    throw error;
  }
}

/**
 * Fetches wallet transaction history (or token swaps history for Solana) for a given wallet.
 *
 * For EVM chains, it maps the natural chain name to its hex ID and uses 
 * Moralis.EvmApi.wallets.getWalletHistory.
 *
 * For Solana, it uses Moralis.SolApi.account.getTokenSwaps to fetch token swaps history.
 *
 * @param {string} chain - Natural chain name in lowercase ("solana", "ethereum", etc.).
 * @param {string} walletAddress - The wallet address as a string.
 * @returns {Object} The transaction history data.
 */
export async function getWalletTransactions(chain, walletAddress) {
  try {
    let url;

    if (chain.toLowerCase() === "solana") {
      url = `https://solana-gateway.moralis.io/account/mainnet/${walletAddress}/swaps?order=DESC`;
    } else {
      const hexChainId = moralisChainMapping[chain.toLowerCase()];
      if (!hexChainId) {
        throw new Error(`Chain "${chain}" is not supported.`);
      }
      url = `https://deep-index.moralis.io/api/v2.2/wallets/${walletAddress}/swaps?chain=${hexChainId}&order=DESC`;
    }

    const response = await axiosRequestWithRetry(url);
    const transactions = response.data.result;

    if (!transactions || transactions.length === 0) {
      return [];
    }

    // Extract relevant transaction details.
    const formattedTransactions = transactions.map(tx => {
      const baseTx = {
        transactionHash: tx.transactionHash,
        symbolBought: tx.bought?.symbol || "N/A",
        amountBought: tx.bought?.amount || "N/A",
        valueBoughtUSD: tx.bought?.usdAmount || "N/A",
        symbolSold: tx.sold?.symbol || "N/A",
        amountSold: tx.sold?.amount || "N/A",
        valueSoldUSD: tx.sold?.usdAmount || "N/A",
        time: new Date(tx.blockTimestamp).toLocaleString(),
        totalValueUsd: tx.totalValueUsd,
      };
    
      if (chain.toLowerCase() === "solana") {
        baseTx.priceBoughtUSD = tx.bought?.usdPrice || "N/A";
        baseTx.priceSoldUSD = tx.sold?.usdPrice || "N/A";
      }
    
      return baseTx;
    });    

    return formattedTransactions;
  } catch (error) {
    console.error("Error fetching wallet transactions:", error);
    throw error;
  }
}

// --------------------
// getWalletNetWorth Function
// --------------------
/**
 * Fetches the net worth (in USD) for a wallet.
 *
 * For Solana, it calls a Solana endpoint using axios.
 * For EVM chains, it uses Moralis.EvmApi.wallets.getWalletNetWorth with spam and unverified contracts excluded.
 *
 * @param {string} chain - Natural chain name in lowercase ("solana", "ethereum", etc.).
 * @param {string} walletAddress - The wallet address as a string.
 * @returns {Object} The net worth data (total net worth and per-chain breakdown).
 */
export async function getWalletNetWorth(chain, walletAddress) {
  try {
    if (chain.toLowerCase() === "solana") {
      // SOLANA CALL via Moralis SDK
      const response = await Moralis.SolApi.account.getPortfolio({
        network: "mainnet",
        address: walletAddress,
      });
      console.log("Solana Portfolio Data:", response.raw);
      return response.raw; // structure { nativeBalance, nfts, tokens, ... }
    } else {
      // EVM CALL
      // Use Moralis.EvmApi.wallets.getWalletNetWorth
      const response = await retryOperation(() =>
        Moralis.EvmApi.wallets.getWalletNetWorth({
          address: walletAddress,
          excludeSpam: true,
          excludeUnverifiedContracts: true,
        })
      );
      console.log("EVM Wallet Net Worth (USD):", response.raw);
      return response.raw;
    }
  } catch (error) {
    console.error("Error fetching wallet net worth:", error);
    throw error;
  }
}

// --------------------
// getWalletPNL Function
// --------------------
/**
 * Fetches the profit and loss (PNL) summary for a given wallet.
 *
 * For EVM chains, it calls Moralis.EvmApi.wallets.getWalletProfitabilitySummary.
 * For Solana, since a dedicated PNL endpoint isn’t available, it returns the portfolio data
 * using the Solana endpoint.
 *
 * @param {string} chain - The natural chain name in lowercase ("solana", "ethereum", etc.).
 * @param {string} walletAddress - The wallet address as a string.
 * @returns {Object} The PNL summary data.
 */
export async function getWalletPNL(chain, walletAddress) {
  try {
    if (chain.toLowerCase() === "solana") {
      
      // SOLANA CALL via Moralis SDK
      const response = await Moralis.SolApi.account.getPortfolio({
        network: "mainnet",
        address: walletAddress,
      });
      console.log("Solana Portfolio Data:", response.raw);
      return response.raw; // structure { nativeBalance, nfts, tokens, ... }
    } else {
      // For EVM chains, use the profitability summary endpoint.
      const hexChainId = moralisChainMapping[chain.toLowerCase()];
      if (!hexChainId) {
        throw new Error(`Chain "${chain}" is not supported for getWalletPNL.`);
      }
      const response = await retryOperation(() =>
        Moralis.EvmApi.wallets.getWalletProfitabilitySummary({
          chain: hexChainId,
          address: walletAddress
        })
      );
      console.log("EVM Wallet PNL:", response.raw);
      return response.raw;
    }
  } catch (error) {
    console.error("Error fetching wallet PNL:", error);
    throw error;
  }
}

async function fallbackWalletTransactions(chain, walletAddress, options) {
  if (chain.toLowerCase() === "solana") {
    const response = await Moralis.SolApi.account.getTokenSwaps({
      network: "mainnet",
      address: walletAddress
    });
    return response.raw;
  } else {
    const hexChainId = moralisChainMapping[chain.toLowerCase()];
    if (!hexChainId) throw new Error(`Chain "${chain}" is not supported for fallback.`);
    const response = await Moralis.EvmApi.wallets.getWalletHistory({
      chain: hexChainId,
      order: "DESC",
      address: walletAddress
    });
    return response.raw;
  }
}