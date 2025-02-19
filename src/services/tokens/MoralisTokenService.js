import Moralis from 'moralis';
import axios from 'axios';
import cacheManager from './cacheMoralis.js';

// --------------------
// EVM Chain Mapping
// --------------------
export const evmChainMapping = {
  solana: "mainnet",
  ethereum: "0x1",
  sepolia: "0xaa36a7",
  holesky: "0x4268",
  polygon: "0x89",
  polygon_amoy: "0x13882",
  bsc: "0x38",
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

const convertChain = (chain) => evmChainMapping[chain.toLowerCase()] || chain;

// --------------------
// Axios with Resiliency
// --------------------

// Create an axios instance with default headers and a timeout.
const axiosInstance = axios.create({
  headers: {
    accept: 'application/json',
    'X-API-Key': process.env.MORALIS_API_KEY
  },
  timeout: 60000, // 60 seconds timeout
});

// Function to perform an axios GET with exponential backoff and retries.
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

// Replace the universalFetch with an axios‑based implementation.
async function universalFetch(url) {
  const response = await axiosRequestWithRetry(url);
  return response.data;
}

// --------------------
// Caching Wrapper
// --------------------

// Wraps an async function so that it first checks (and later sets) the cache.
// Each cached value is stored for 1 minute.
function cacheWrapper(fn, cacheKeyGenerator) {
  return async function (...args) {
    const cacheKey = cacheKeyGenerator(...args);
    const cachedValue = await cacheManager.get(cacheKey);
    if (cachedValue !== null) {
      return cachedValue;
    }
    const result = await fn(...args);
    await cacheManager.set(cacheKey, result, 60000); // cache for 60,000 ms = 1 minute
    return result;
  };
}

// --------------------
// API Functions
// --------------------

// 1. Returns token price details.
async function _getTokenPrice(chain, tokenAddress) {
  if (chain.toLowerCase() === 'solana') {
    const response = await Moralis.SolApi.token.getTokenPrice({
      network: 'mainnet',
      address: tokenAddress
    });
    return { source: 'Moralis SolApi (Token Price)', data: response.raw };
  } else {
    const evmChain = convertChain(chain);
    const response = await Moralis.EvmApi.token.getTokenPrice({
      chain: evmChain,
      address: tokenAddress
    });
    return { source: 'Moralis EvmApi (Token Price)', data: response.raw };
  }
}

export const getTokenPrice = cacheWrapper(
  _getTokenPrice,
  (chain, tokenAddress) => `getTokenPrice:${chain.toLowerCase()}:${tokenAddress}`
);

// 2. Searches tokens by query (Solana support removed).
async function _searchTokens(query, chains = 'solana') {
  const chainParam = chains.toLowerCase() === 'solana' ? chains : convertChain(chains);
  const url = `https://deep-index.moralis.io/api/v2.2/tokens/search?query=${encodeURIComponent(
    query
  )}&chains=${encodeURIComponent(chainParam)}`;
  const data = await universalFetch(url);
  return { source: 'Moralis Deep-Index Discovery (Token Search)', data };
}

export const searchTokens = cacheWrapper(
  _searchTokens,
  (query, chains = 'solana') => `searchTokens:${query}:${chains}`
);

// 3. Returns EVM token info using deep-index discovery.
async function _getEVMTokenInfo(chain, tokenAddress) {
  const evmChain = convertChain(chain);
  const url = `https://deep-index.moralis.io/api/v2.2/discovery/token?chain=${encodeURIComponent(
    evmChain
  )}&token_address=${encodeURIComponent(tokenAddress)}`;
  const data = await universalFetch(url);
  return { source: 'Moralis Deep-Index Discovery (EVM Token Info)', data };
}

export const getEVMTokenInfo = cacheWrapper(
  _getEVMTokenInfo,
  (chain, tokenAddress) => `getEVMTokenInfo:${chain.toLowerCase()}:${tokenAddress}`
);

// 4. Returns token snipers info for both Solana and EVM.
async function _getTokenSnipers(chain, pairAddress, blocksAfterCreation = 1000) {
  if (chain.toLowerCase() === 'solana') {
    const url = `https://solana-gateway.moralis.io/token/mainnet/pairs/${pairAddress}/snipers?blocksAfterCreation=${blocksAfterCreation}`;
    const data = await universalFetch(url);
    return {
      source: 'Moralis Solana Gateway (Token Snipers)',
      data: processSnipers(data),
    };
  } else {
    const evmChain = convertChain(chain);
    const url = `https://deep-index.moralis.io/api/v2.2/pairs/${pairAddress}/snipers?chain=${encodeURIComponent(
      evmChain
    )}&blocksAfterCreation=${blocksAfterCreation}`;
    const data = await universalFetch(url);
    return {
      source: 'Moralis Deep-Index (Token Snipers)',
      data: processSnipers(data),
    };
  }
}

// Helper function to process snipers
function processSnipers(snipersResponse) {
  // Check if snipersResponse is an object and contains the expected array
  if (!snipersResponse || typeof snipersResponse !== "object" || !Array.isArray(snipersResponse.result)) {
    console.warn("⚠️ Snipers response does not contain a valid array under 'result'. Returning empty list.");
    return [];
  }

  const snipers = snipersResponse.result; // Extract the actual snipers list
  const processedSnipers = [];

  for (let i = 0; i < snipers.length && processedSnipers.length < 20; i++) {
    const snipe = snipers[i];

    processedSnipers.push({
      walletAddress: `https://solscan.io/account/${snipe.walletAddress}`,
      snipedTransactions: Array.isArray(snipe.snipedTransactions)
        ? snipe.snipedTransactions.slice(0, 3) // Keep max 3 buys
        : [],
      sellTransactions: Array.isArray(snipe.sellTransactions)
        ? snipe.sellTransactions.slice(0, 3) // Keep max 3 sells
        : [],
      totalSellTransactions: snipe.totalSellTransactions ?? 0,
      totalSnipedTransactions: snipe.totalSnipedTransactions ?? 0,
      totalTokensSniped: snipe.totalTokensSniped ?? 0,
      totalSnipedUsd: snipe.totalSnipedUsd ?? 0,
      totalTokensSold: snipe.totalTokensSold ?? 0,
      totalSoldUsd: snipe.totalSoldUsd ?? 0,
      currentBalance: snipe.currentBalance ?? 0,
      currentBalanceUsdValue: snipe.currentBalanceUsdValue ?? 0,
      realizedProfitPercentage: snipe.realizedProfitPercentage ?? 0,
      realizedProfitUsd: snipe.realizedProfitUsd ?? 0,
    });
  }

  console.log("✅✅✅ Processed Snipers:", JSON.stringify(processedSnipers, null, 2));
  return processedSnipers;
}

export const getTokenSnipers = cacheWrapper(
  _getTokenSnipers,
  (chain, pairAddress, blocksAfterCreation = 1000) =>
    `getTokenSnipers:${chain.toLowerCase()}:${pairAddress}:${blocksAfterCreation}`
);

// 5. Returns Solana token info using deep-index discovery.
async function _getSolanaTokenInfo(tokenAddress) {
  const url = `https://deep-index.moralis.io/api/v2.2/discovery/token?chain=mainnet&token_address=${tokenAddress}`;
  const data = await universalFetch(url);
  return { source: 'Moralis Deep-Index Discovery (Solana Token Info)', data };
}

export const getSolanaTokenInfo = cacheWrapper(
  _getSolanaTokenInfo,
  (tokenAddress) => `getSolanaTokenInfo:${tokenAddress}`
);

// 6. Returns a clean list of token pair addresses for a given token on Solana or EVM.
async function _getTokenPairAddress(chain, tokenAddress) {
  let url;
  if (chain.toLowerCase() === 'solana') {
    // Use the Solana Gateway endpoint for token pairs.
    url = `https://solana-gateway.moralis.io/token/mainnet/${tokenAddress}/pairs`;
  } else {
    // For EVM, map the chain (e.g., "ethereum", "sepolia", etc.) using convertChain.
    const evmChain = convertChain(chain);
    // Use the Deep-Index endpoint for ERC20 token pairs.
    url = `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/pairs?chain=${encodeURIComponent(evmChain)}`;
  }
  
  const data = await universalFetch(url);
  
  // Clean the response to return only the pair addresses.
  let pairsArray = [];
  if (data && Array.isArray(data.pairs)) {
    if (chain.toLowerCase() === 'solana') {
      // For Solana the key is "pairAddress".
      pairsArray = data.pairs.map(pair => pair.pairAddress);
    } else {
      // For EVM the key is "pair_address".
      pairsArray = data.pairs.map(pair => pair.pair_address);
    }
  }
  return pairsArray;
}

export const getTokenPairAddress = cacheWrapper(
  _getTokenPairAddress,
  (chain, tokenAddress) => `getTokenPairAddress:${chain.toLowerCase()}:${tokenAddress}`
);

// 7. Returns historical token holders data for a given token over the last 7 days.
//    You only need to pass the token wallet (address) and optionally the chain (default is 'eth').
async function _getTokenHolders(tokenAddress, chain = 'solana', timeFrame = '7d') {
  console.log("🔍 Starting _getTokenHolders for:", { chain, tokenAddress, timeFrame });

  // Calculate the date range: last 7 days.
  const now = new Date();
  const toDate = now.toISOString().split('T')[0]; // YYYY-MM-DD format
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromDate = sevenDaysAgo.toISOString().split('T')[0];

  let url;
  let pairAddressObj, pairAddress = null;

  if (chain.toLowerCase() === 'solana') {
      try {
          pairAddressObj = await getTokenPairAddress(chain, tokenAddress);
          pairAddress = pairAddressObj[0];// Try the first one
          console.log(`🔗 Pair Addresses fetched: ${pairAddress}`);
      } catch (error) {
          console.warn(`⚠️ Error fetching pair address for ${tokenAddress}: ${error.message}`);
          return { error: "Failed to get pair address." };
      }

      // Validate pairAddress before making API request
      if (!pairAddress || typeof pairAddress !== "string") {
          console.warn("⚠️ Invalid or missing pair address:", pairAddress);
          return { error: "Invalid pair address. Cannot fetch token holders." };
      }

      // Construct the API request URL
      url = `https://solana-gateway.moralis.io/token/mainnet/pairs/${pairAddress}/stats`;
  } else {
      const evmChain = convertChain(chain);
      url = `https://deep-index.moralis.io/api/v2.2/erc20/${tokenAddress}/holders/historical?chain=${encodeURIComponent(evmChain)}&fromDate=${encodeURIComponent(fromDate)}&toDate=${encodeURIComponent(toDate)}&timeFrame=${encodeURIComponent(timeFrame)}`;
  }

  console.log("🌐 Final API URL:", url);

  try {
      const data = await universalFetch(url);
      console.log("✅ Token Holders Data Received:", JSON.stringify(data, null, 2));
      return data;
  } catch (error) {
      console.error("❌ Error fetching token holders:", error);
      return { error: `Failed to fetch holders: ${error.message}` };
  }
}

export const getTokenHolders = cacheWrapper(
  _getTokenHolders,
  (wallet, chain = 'solana', timeFrame = '7d') =>
      `getTokenHolders:${chain.toLowerCase()}:${wallet}:7d:${timeFrame}`
);


// 8. Returns only the token symbol for a given token address on EVM or Solana.
//    If the token symbol cannot be retrieved, returns null.
async function _getTokenSymbol(chain, tokenAddress) {
  let url;
  if (chain.toLowerCase() === 'solana') {
    // For Solana, call the metadata endpoint.
    url = `https://solana-gateway.moralis.io/token/mainnet/${tokenAddress}/metadata`;
    try {
      const data = await universalFetch(url);
      // Expected field is "symbol" in the Solana response.
      return data && data.symbol ? data.symbol : null;
    } catch (error) {
      console.error(`Error fetching Solana token metadata for ${tokenAddress}:`, error);
      return null;
    }
  } else {
    // For EVM chains, convert the chain and call the Deep-Index discovery endpoint.
    const evmChain = convertChain(chain);
    url = `https://deep-index.moralis.io/api/v2.2/discovery/token?chain=${encodeURIComponent(evmChain)}&token_address=${encodeURIComponent(tokenAddress)}`;
    try {
      const data = await universalFetch(url);
      // Expected response is an array; get the token_symbol from the first object.
      if (Array.isArray(data) && data.length > 0 && data[0].token_symbol) {
        return data[0].token_symbol;
      }
      return null;
    } catch (error) {
      console.error(`Error fetching EVM token metadata for ${tokenAddress}:`, error);
      return null;
    }
  }
}

export const getTokenSymbol = cacheWrapper(
  _getTokenSymbol,
  (chain, tokenAddress) => `getTokenSymbol:${chain.toLowerCase()}:${tokenAddress}`
);



