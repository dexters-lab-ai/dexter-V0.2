import axios from 'axios';
import cacheManager from '../tokens/cacheMoralis.js';
import { config } from '../../core/config.js';

// --------------------
// Axios Instance & Retry Logic
// --------------------
const axiosInstance = axios.create({
  headers: {
    accept: 'application/json',
    'x-cg-pro-api-key': config.coingeckoAPIKey
  },
  timeout: 60000, // 60 seconds timeout
});

// Performs an axios GET request with exponential backoff retries.
async function axiosRequestWithRetry(url, config = {}, retries = 3, backoff = 300) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await axiosInstance.get(url, config);
    } catch (error) {
      if (attempt === retries - 1) {
        throw error;
      }
      const delay = backoff * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// A universal fetch function based on axios.
async function universalFetch(url, config = {}) {
  const response = await axiosRequestWithRetry(url, config);
  return response.data;
}

// --------------------
// One-Hour Caching Wrapper
// --------------------
function cacheWrapperOneHour(fn, cacheKeyGenerator) {
  return async function (...args) {
    const cacheKey = cacheKeyGenerator(...args);
    const cachedValue = await cacheManager.get(cacheKey);
    if (cachedValue !== null) {
      return cachedValue;
    }
    const result = await fn(...args);
    await cacheManager.set(cacheKey, result, 3600000); // Cache for 1 hour (3,600,000 ms)
    return result;
  };
}

// --------------------
// CoinGecko Search Function
// --------------------
/**
 * _searchCoin
 * -----------
 * Searches CoinGecko for coins matching the provided query.
 */
async function _searchCoin(query) {
  console.log(' searching for.....', query)
  const url = `https://api.coingecko.com/api/v3/search?query=${query}`;
  const data = await universalFetch(url);
  return { source: 'CoinGecko Search API', data };
}

// Export the cached search function. The cache key is built using the query.
export const searchCoin = cacheWrapperOneHour(_searchCoin, (query) => `searchCoin:${query}`);


/**
 * _getPriceCoinGecko
 * ------------------
 * Fetches the token price (in USD) for the given contract address.
 * The response structure is:
 * {
 *   "0xabc...": { usd: 123.45 }
 * }
 *
 * Note: The contract address is converted to lowercase since CoinGecko returns keys in lowercase.
 */
async function _getPriceCoinGecko(contractAddress) {
  const lowerAddress = contractAddress.toLowerCase();
  
  // Determine which platform to query based on the address format.
  // If the address doesn't start with '0x', assume it's for Solana.
  const platform = contractAddress.startsWith("0x") ? "ethereum" : "solana";
  
  const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${lowerAddress}&vs_currencies=usd`;
  const result = await universalFetch(url);
  const tokenData = result[lowerAddress];
  
  if (!tokenData || typeof tokenData.usd === 'undefined') {
    throw new Error(`No price data found for contract: ${contractAddress}`);
  }
  return tokenData.usd;
}

// Export the cached price function. The cache key is built using the contract address.
export const getPriceCoinGecko = cacheWrapperOneHour(
  _getPriceCoinGecko,
  (contractAddress) => `getPriceCoinGecko:${contractAddress}`
);
