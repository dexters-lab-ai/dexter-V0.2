// src/services/coingecko/CoinGecko.js
import axios from 'axios';
import cacheManager from '../tokens/cacheMoralis.js';
import { config } from '../../core/config.js';

const axiosInstance = axios.create({
  headers: {
    accept: 'application/json',
    'x-cg-pro-api-key': config.coingeckoAPIKey
  },
  timeout: 60000,
});

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

async function universalFetch(url, config = {}) {
  const response = await axiosRequestWithRetry(url, config);
  return response.data;
}

function cacheWrapperOneHour(fn, cacheKeyGenerator) {
  return async function (...args) {
    const cacheKey = cacheKeyGenerator(...args);
    const cachedValue = await cacheManager.get(cacheKey);
    if (cachedValue !== null) {
      return cachedValue;
    }
    const result = await fn(...args);
    await cacheManager.set(cacheKey, result, 3600000);
    return result;
  };
}

/**
 * Fetches full token info from CoinGecko.
 * Note: Adjusts network name (e.g. using "ethereum" instead of "eth") for valid requests.
 */
async function _getFullTokenInfoCoinGecko(tokenAddress, network) {
  // Use network name from input – defaulting to "ethereum" if provided as "eth"
  const networkParam = network.toLowerCase() === 'eth' || network.toLowerCase() === 'ethereum'
    ? 'ethereum'
    : network.toLowerCase();
  const url = `https://pro-api.coingecko.com/api/v3/onchain/networks/${networkParam}/tokens/${tokenAddress}/info`;
  const data = await universalFetch(url);
  return data.data;
}

export const getFullTokenInfoCoinGecko = cacheWrapperOneHour(
  _getFullTokenInfoCoinGecko,
  (tokenAddress, network) => `getFullTokenInfoCoinGecko:${tokenAddress}:${network}`
);

/**
 * (Optional) Get LP info from CoinGecko.
 */
async function _getLPInfoCoinGecko(pairAddress, network) {
  const networkParam = network.toLowerCase() === 'eth' || network.toLowerCase() === 'ethereum'
    ? 'ethereum'
    : network.toLowerCase();
  const url = `https://api.coingecko.com/api/v3/onchain/networks/${networkParam}/pools/${pairAddress}`;
  const data = await universalFetch(url);
  return data.data.attributes; // adjust according to the returned structure
}

export const getLPInfoCoinGecko = cacheWrapperOneHour(
  _getLPInfoCoinGecko,
  (pairAddress, network) => `getLPInfoCoinGecko:${pairAddress}:${network}`
);

// (Keep existing exports for searchCoin and getPriceCoinGecko)
export const searchCoin = cacheWrapperOneHour(_searchCoin, (query) => `searchCoin:${query}`);

async function _searchCoin(query) {
  console.log('Searching CoinGecko for:', query);
  const url = `https://api.coingecko.com/api/v3/search?query=${query}`;
  const data = await universalFetch(url);
  return { source: 'CoinGecko Search API', data };
}

// Also export the price function as needed
async function _getPriceCoinGecko(contractAddress) {
  const lowerAddress = contractAddress.toLowerCase();
  const platform = contractAddress.startsWith("0x") ? "ethereum" : "solana";
  const url = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${lowerAddress}&vs_currencies=usd`;
  const result = await universalFetch(url);
  const tokenData = result[lowerAddress];
  if (!tokenData || typeof tokenData.usd === 'undefined') {
    throw new Error(`No price data found for contract: ${contractAddress}`);
  }
  return tokenData.usd;
}

export const getPriceCoinGecko = cacheWrapperOneHour(
  _getPriceCoinGecko,
  (contractAddress) => `getPriceCoinGecko:${contractAddress}`
);
