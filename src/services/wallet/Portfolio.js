import Moralis from 'moralis';
import { ethers } from 'ethers';
import { providers } from '../trading/providers/ProviderList.js';
import { config } from '../../core/config.js';
import axios from 'axios';
import { getPriceCoinGecko } from '../coingecko/CoinGecko.js';

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

// ERC20 Token ABI - for interacting with token contracts
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function totalSupply() view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 value)"
];

// ERC20 Transfer event signature
const TRANSFER_EVENT_SIGNATURE = "Transfer(address,address,uint256)";
const TRANSFER_EVENT_TOPIC = ethers.id(TRANSFER_EVENT_SIGNATURE);

// Interface for decoding ERC20 Transfer events
const TRANSFER_INTERFACE = new ethers.Interface([
  "event Transfer(address indexed from, address indexed to, uint256 value)"
]);

// Common token addresses for major networks - for quick balance checks
const COMMON_TOKENS = {
  ethereum: [
    { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', decimals: 6 },
    { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', symbol: 'USDT', decimals: 6 },
    { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', symbol: 'WBTC', decimals: 8 },
    { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', symbol: 'DAI', decimals: 18 },
    { address: '0x514910771AF9Ca656af840dff83E8264EcF986CA', symbol: 'LINK', decimals: 18 },
  ],
  polygon: [
    { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', symbol: 'USDC', decimals: 6 },
    { address: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', symbol: 'USDT', decimals: 6 },
    { address: '0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6', symbol: 'WBTC', decimals: 8 },
    { address: '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', symbol: 'DAI', decimals: 18 },
  ],
  arbitrum: [
    { address: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8', symbol: 'USDC', decimals: 6 },
    { address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', symbol: 'USDT', decimals: 6 },
    { address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', symbol: 'WBTC', decimals: 8 },
  ],
  optimism: [
    { address: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607', symbol: 'USDC', decimals: 6 },
    { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', decimals: 6 },
    { address: '0x68f180fcCe6836688e9084f035309E29Bf0A2095', symbol: 'WBTC', decimals: 8 },
  ],
  base: [
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
  ],
  binance: [
    { address: '0x55d398326f99059fF775485246999027B3197955', symbol: 'USDT', decimals: 18 },
    { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', symbol: 'USDC', decimals: 18 },
    { address: '0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3', symbol: 'DAI', decimals: 18 },
  ],
};

/**
 * Gets a price feed for tokens in USD
 * @param {string} chain - The blockchain name
 * @param {Array} tokenAddresses - Array of token addresses
 * @returns {Object} Token prices keyed by address
 */
async function getTokenPrices(chain, tokenAddresses) {
  try {
    // Process each token address individually
    const promises = tokenAddresses.map(async (address) => {
      try {
        const price = await getPriceCoinGecko(address);
        return { [address.toLowerCase()]: { usd: price } };
      } catch (error) {
        console.error(`Failed to get price for ${address}:`, error.message);
        return { [address.toLowerCase()]: { usd: 0 } };
      }
    });
    
    // Wait for all price requests to complete
    const priceResults = await Promise.all(promises);
    
    // Combine all results into a single object
    return priceResults.reduce((acc, curr) => ({ ...acc, ...curr }), {});
  } catch (error) {
    console.error('Error fetching token prices:', error);
    // Return empty object as fallback
    return {};
  }
}

/**
 * Maps chain names to CoinGecko IDs
 */
function getCoingeckoChainId(chain) {
  const mapping = {
    sonic: 'sonic',
    ethereum: 'ethereum',
    polygon: 'polygon-pos',
    avalanche: 'avalanche',
    arbitrum: 'arbitrum-one',
    optimism: 'optimistic-ethereum',
    base: 'base',
    bsc: 'binance-smart-chain',
    binance: 'binance-smart-chain',
    fantom: 'fantom',
    zksync: 'zksync-era',
    linea: 'linea',
    linear: 'linea', // Alias for linea
    mantle: 'mantle',
    celo: 'celo',
    scroll: 'scroll',
    cyber: 'echelon', // Cyber is known as Echelon in CoinGecko
    zkevm: 'polygon-zkevm',
    nova: 'arbitrum-nova',
    berachain: 'berachain',
    worldchain: 'worldcoin',
    omni: 'omni',
  };
  
  return mapping[chain.toLowerCase()] || 'ethereum';
}

/**
 * Gets the wallet's native token balance
 * @param {string} chain - The blockchain name
 * @param {string} walletAddress - The wallet address to query
 * @returns {Promise<Object>} Native token balance data
 */
async function getNativeTokenBalance(chain, walletAddress) {
  try {
    const provider = providers[chain];
    if (!provider) {
      throw new Error(`Provider not found for chain: ${chain}`);
    }

    // Get native balance in wei/smallest unit
    const balance = await provider.getBalance(walletAddress);
    
    // Get native token symbol and name
    const symbol = getChainNativeSymbol(chain);
    
    // Most EVM chains use 18 decimals
    const decimals = 18;
    const formattedBalance = ethers.utils.formatUnits(balance, decimals);

    // Get price of native token using its wrapped version
    let priceUsd = 0;
    try {
      // Use wrapped token addresses for native tokens
      const WRAPPED_NATIVE_TOKENS = {
        "sonic": "0x039e2fB66102314Ce7b64Ce5Ce3E5183bc94aD38", //wS
        "ethereum": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", // WETH
        "polygon": "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270", // WMATIC
        "avalanche": "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7", // WAVAX
        "binance": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
        "bsc": "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c", // WBNB
        "fantom": "0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83", // WFTM
        "arbitrum": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", // WETH on Arbitrum
        "optimism": "0x4200000000000000000000000000000000000006", // WETH on Optimism
        "base": "0x4200000000000000000000000000000000000006", // WETH on Base
        "zksync": "0x5aea5775959fbc2557cc8789bc1bf90a239d9a91", // WETH on zkSync
        "linea": "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f", // WETH on Linea
        "linear": "0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f", // WETH on Linear
        "mantle": "0x78c1b0c915c4faa5fffa6cabf0219da63d7f4cb8", // WMNT on Mantle
        "scroll": "0x5300000000000000000000000000000000000004", // WETH on Scroll
        "celo": "0x471ece3750da237f93b8e339c536989b8978a438", // CELO Wrapped Native
        "zkevm": "0x4f9a0e7fd2bf6067db6994cf12e4495df938e6e9", // WETH on zkEVM
        "nova": "0x722e8bdd2ce80a4422e880164f2079488e115365", // WETH on Nova
        "berachain": "0x5806e416da447b267cea759358cf22cf4f8d2132", // WBERA
        "worldchain": "0xbf78e6cd9c5ee875eb871b2bc374255bc0b10744", // WWRLD (placeholder, update accordingly)
        "omni": "0xbf78e6cd9c5ee875eb871b2bc374255bc0b10744", // WOMNI (placeholder, update accordingly)
        // Add others as needed
      };
      
      const wrappedNativeAddress = WRAPPED_NATIVE_TOKENS[chain.toLowerCase()];
      if (wrappedNativeAddress) {
        priceUsd = await getPriceCoinGecko(wrappedNativeAddress);
      } else {
        console.warn(`No wrapped native token address found for chain: ${chain}`);
      }
    } catch (error) {
      console.error(`Failed to get price for ${symbol}:`, error.message);
    }

    return {
      type: 'native',
      symbol,
      name: getNativeTokenName(chain),
      balance: formattedBalance,
      balanceRaw: balance.toString(),
      balanceUsd: priceUsd * parseFloat(formattedBalance),
      priceUsd,
      decimals: 18, // Most EVM chains use 18 decimals for native token
      chainId: getChainId(chain),
    };
  } catch (error) {
    console.error("Error getting native token balance:", error);
    return {
      type: 'native',
      symbol: getChainNativeSymbol(chain),
      name: getNativeTokenName(chain),
      balance: "0",
      balanceRaw: "0",
      balanceUsd: 0,
      priceUsd: 0,
      decimals: 18,
      chainId: getChainId(chain),
    };
  }
}

/**
 * Returns the native token symbol for a given chain
 */
function getChainNativeSymbol(chain) {
  const symbols = {
    sonic: 'S',
    ethereum: 'ETH',
    polygon: 'MATIC',
    avalanche: 'AVAX',
    binance: 'BNB',
    bsc: 'BNB',
    fantom: 'FTM',
    arbitrum: 'ETH',
    optimism: 'ETH',
    base: 'ETH',
    zksync: 'ETH',
    linea: 'ETH',
    linear: 'ETH',
    mantle: 'MNT',
    scroll: 'ETH',
    celo: 'CELO',
    cyber: 'CYBER',
    zkevm: 'ETH',
    nova: 'ETH',
    berachain: 'BERA',
    worldchain: 'WRLD',
    omni: 'OMNI',
  };
  return symbols[chain.toLowerCase()] || 'ETH';
}

/**
 * Returns the native token name for a given chain
 */
function getNativeTokenName(chain) {
  const names = {
    sonic: 'Sonic',
    ethereum: 'ETH',
    polygon: 'ETH',
    avalanche: 'Avax',
    binance: 'BNB',
    bsc: 'BNB',
    fantom: 'FTM',
    arbitrum: 'ETH',
    optimism: 'ETH',
    base: 'ETH',
    zksync: 'ETH',
    linea: 'ETH',
    linear: 'ETH',
    mantle: 'Mantle',
    scroll: 'ETH',
    celo: 'Celo',
    cyber: 'Cyber',
    zkevm: 'ETH',
    nova: 'ETH',
    berachain: 'Bera',
    worldchain: 'Worldcoin',
    omni: 'Omni',
  };
  return names[chain.toLowerCase()] || 'Ethereum';
}

/**
 * Returns the chain ID for a given chain
 */
function getChainId(chain) {
  const ids = {
    sonic: 146,
    ethereum: 1,
    polygon: 137,
    avalanche: 43114,
    binance: 56,
    bsc: 56,
    fantom: 250,
    arbitrum: 42161,
    optimism: 10,
    base: 8453,
    zksync: 324,
    linea: 59144,
    linear: 59144,
    mantle: 5000,
    scroll: 534352,
    celo: 42220,
    zkevm: 1101,
    nova: 42170,
  };
  return ids[chain.toLowerCase()] || 1;
}

/**
 * Fetches token balances for specified ERC20 tokens
 * @param {string} chain - The blockchain name
 * @param {string} walletAddress - The wallet address to query
 * @param {array} tokenAddresses - Array of token addresses to check
 * @returns {Promise<Array>} Array of token balances
 */
async function getERC20TokenBalances(chain, walletAddress, tokenAddresses = []) {
  try {
    const provider = providers[chain.toLowerCase()];
    if (!provider) {
      throw new Error(`Provider not found for chain: ${chain}`);
    }

    // If no token addresses provided, use common tokens for this chain
    if (tokenAddresses.length === 0 && COMMON_TOKENS[chain.toLowerCase()]) {
      tokenAddresses = COMMON_TOKENS[chain.toLowerCase()].map(t => t.address);
    }

    // Create array of promises to fetch all token balances in parallel
    const tokenPromises = tokenAddresses.map(async (tokenAddress) => {
      try {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        
        // Get balance, decimals, symbol, and name
        const [balance, decimals, symbol, name] = await Promise.all([
          tokenContract.balanceOf(walletAddress),
          tokenContract.decimals().catch(() => 18), // Default to 18 if decimals() fails
          tokenContract.symbol().catch(() => 'UNKNOWN'), // Default if symbol() fails
          tokenContract.name().catch(() => 'Unknown Token') // Default if name() fails
        ]);

        // If balance is zero, don't include this token
        if (balance.isZero()) {
          return null;
        }

        // Format balance with proper decimals
        const formattedBalance = ethers.formatUnits(balance, decimals);
        
        return {
          type: 'erc20',
          tokenAddress,
          symbol,
          name,
          decimals,
          balance: formattedBalance,
          balanceRaw: balance.toString(),
          chainId: getChainId(chain),
        };
      } catch (error) {
        console.error(`Error fetching token ${tokenAddress}:`, error);
        return null;
      }
    });

    // Wait for all promises to resolve
    const results = await Promise.all(tokenPromises);
    
    // Filter out null values (failed fetches or zero balances)
    return results.filter(result => result !== null);
  } catch (error) {
    console.error(`Error getting token balances for ${chain}:`, error);
    throw error;
  }
}

/**
 * Discovers ERC20 tokens held by a wallet by scanning transfer events
 * @param {string} chain - The blockchain name
 * @param {string} walletAddress - The wallet address to query
 * @param {Object} options - Options like blocksToScan, fromBlock, etc.
 * @returns {Promise<Array>} Array of discovered token addresses
 */
async function discoverERC20Tokens(chain, walletAddress, options = {}) {
  try {
    const provider = providers[chain.toLowerCase()];
    if (!provider) {
      throw new Error(`Provider not found for chain: ${chain}`);
    }

    const normalizedAddress = walletAddress.toLowerCase();
    const discoveredTokens = new Set();
    
    // Determine scan range
    const currentBlock = await provider.getBlockNumber();
    const blocksToScan = options.blocksToScan || 100000; // Default scan 100k blocks (roughly 2 weeks)
    const fromBlock = options.fromBlock || Math.max(0, currentBlock - blocksToScan);
    const toBlock = currentBlock;
    
    console.log(`Scanning for token transfers from block ${fromBlock} to ${toBlock}`);
    
    // Create topic filters for Transfer events to/from this wallet
    const filter = {
      topics: [
        TRANSFER_EVENT_TOPIC,
        null, // Any from address
        null  // Any to address
      ],
      fromBlock,
      toBlock
    };
    
    // Get all Transfer events
    const logs = await provider.getLogs(filter);
    console.log(`Found ${logs.length} Transfer events`);
    
    // Process logs in batches to avoid rate limiting
    const batchSize = 100;
    for (let i = 0; i < logs.length; i += batchSize) {
      const batch = logs.slice(i, i + batchSize);
      
      for (const log of batch) {
        try {
          // Decode the Transfer event
          const decodedLog = TRANSFER_INTERFACE.parseLog({
            topics: log.topics,
            data: log.data
          });
          
          if (!decodedLog) continue;
          
          const { from, to } = decodedLog.args;
          
          // Only consider transfers to/from our wallet
          if (from.toLowerCase() === normalizedAddress || 
              to.toLowerCase() === normalizedAddress) {
            discoveredTokens.add(log.address);
          }
        } catch (error) {
          // Skip invalid logs
          continue;
        }
      }
    }
    
    console.log(`Discovered ${discoveredTokens.size} potential tokens`);
    return Array.from(discoveredTokens);
  } catch (error) {
    console.error("Error discovering tokens:", error);
    return [];
  }
}

/**
 * Fetches full portfolio balance data for a wallet, including auto-discovery of tokens.
 * @param {string} chain - Chain name in lowercase.
 * @param {string} walletAddress - The wallet address.
 * @param {Object} options - Additional options.
 * @returns {Object} The complete portfolio data.
 */
export async function getWalletPortfolioEVM(chain, walletAddress, options = {}) {
  try {
    const normalizedChain = chain.toLowerCase();
    const provider = providers[normalizedChain];
    
    if (!provider) {
      return { success: false, error: `Chain "${chain}" is not supported.` };
    }

    // Get native token balance (ETH, MATIC, etc.)
    const nativeBalance = await getNativeTokenBalance(normalizedChain, walletAddress);
    
    // Initialize token list with known tokens
    let tokenAddresses = [];
    
    if (options.tokenAddresses) {
      // Use provided token addresses
      tokenAddresses = options.tokenAddresses;
    } else if (COMMON_TOKENS[normalizedChain]) {
      // Start with common tokens for this chain
      tokenAddresses = COMMON_TOKENS[normalizedChain].map(t => t.address);
    }
    
    // Auto-discover tokens if requested
    if (options.discoverTokens === true) {
      console.log("Auto-discovering tokens...");
      const discoveredTokens = await discoverERC20Tokens(normalizedChain, walletAddress, {
        blocksToScan: options.blocksToScan || 100000
      });
      
      // Merge with existing token list, removing duplicates
      tokenAddresses = [...new Set([...tokenAddresses, ...discoveredTokens])];
      console.log(`Combined token list has ${tokenAddresses.length} tokens`);
    }
    
    // Get ERC20 token balances
    const tokenBalances = await getERC20TokenBalances(normalizedChain, walletAddress, tokenAddresses);
    
    // Get USD values if requested
    let tokensWithPrices = tokenBalances;
    if (options.includePrices) {
      // Get addresses of tokens with non-zero balances
      const tokenAddressesWithBalance = tokenBalances.map(token => token.tokenAddress);
      
      if (tokenAddressesWithBalance.length > 0) {
        const prices = await getTokenPrices(normalizedChain, tokenAddressesWithBalance);
        
        tokensWithPrices = tokenBalances.map(token => {
          const priceUsd = prices[token.tokenAddress.toLowerCase()]?.usd || 0;
          const balanceUsd = priceUsd * parseFloat(token.balance);
          
          return {
            ...token,
            priceUsd,
            balanceUsd
          };
        });
      }
    }
    
    // Calculate total portfolio value
    const totalBalanceUsd = [nativeBalance, ...tokensWithPrices]
      .reduce((sum, token) => sum + (token.balanceUsd || 0), 0);
    
    return {
      success: true,
      data: {
        nativeBalance,
        tokenBalances: tokensWithPrices,
        totalItems: 1 + tokensWithPrices.length,
        totalBalanceUsd: totalBalanceUsd || 0
      }
    };
  } catch (error) {
    console.error("Error fetching portfolio data:", error);
    return { 
      success: false, 
      error: error.message || "An error occurred while fetching portfolio data."
    };
  }
}

/**
 * Gets recent transactions for a wallet with enhanced detection of token transfers
 * @param {string} chain - The blockchain name
 * @param {string} walletAddress - The wallet address to query
 * @param {Object} options - Options like limit, offset, etc.
 * @returns {Promise<Object>} Formatted transaction data
 */
export async function getWalletTransactionsEVM(chain, walletAddress, options = {}) {
  try {
    const normalizedChain = chain.toLowerCase();
    const provider = providers[normalizedChain];
    
    if (!provider) {
      return { success: false, error: `Chain "${chain}" is not supported.` };
    }

    const limit = options.limit || 10;
    const normalizedAddress = walletAddress.toLowerCase();
    
    // Get current block number
    const currentBlock = await provider.getBlockNumber();
    
    // Determine scan range
    const blocksToScan = options.blocksToScan || Math.min(limit * 10, 1000);
    const fromBlock = options.fromBlock || Math.max(0, currentBlock - blocksToScan);
    
    // Find transactions: first by scanning blocks directly
    let transactions = [];
    let blockNumber = currentBlock;
    
    while (transactions.length < limit && blockNumber >= fromBlock) {
      try {
        const block = await provider.getBlock(blockNumber, true);
        
        if (!block || !block.transactions) {
          blockNumber--;
          continue;
        }
        
        // Find transactions involving our wallet
        const relevantTxs = block.transactions.filter(tx => 
          (tx.from && tx.from.toLowerCase() === normalizedAddress) || 
          (tx.to && tx.to.toLowerCase() === normalizedAddress)
        );
        
        // Process each transaction
        for (const tx of relevantTxs) {
          if (transactions.length >= limit) break;
          
          try {
            // Get transaction receipt for more details
            const receipt = await provider.getTransactionReceipt(tx.hash);
            if (!receipt) continue;
            
            // Format the transaction
            const formattedTx = await formatEvmTransaction(tx, receipt, walletAddress, normalizedChain, provider);
            transactions.push(formattedTx);
          } catch (error) {
            console.error(`Error processing transaction ${tx.hash}:`, error.message);
          }
        }
        
        blockNumber--;
      } catch (error) {
        console.error(`Error processing block ${blockNumber}:`, error.message);
        blockNumber--;
      }
    }
    
    // Additionally, scan for token transfer events directly
    if (transactions.length < limit) {
      try {
        const transferEvents = await findTokenTransferEvents(
          normalizedChain, 
          walletAddress, 
          { 
            fromBlock,
            toBlock: currentBlock,
            limit: limit - transactions.length
          }
        );
        
        // Merge with regular transactions, avoiding duplicates
        const txHashes = new Set(transactions.map(tx => tx.transactionHash));
        
        for (const event of transferEvents) {
          if (!txHashes.has(event.transactionHash)) {
            transactions.push(event);
            txHashes.add(event.transactionHash);
            
            if (transactions.length >= limit) break;
          }
        }
      } catch (error) {
        console.error("Error finding token transfers:", error);
      }
    }
    
    // Sort by block number, newest first
    transactions.sort((a, b) => b.blockNumber - a.blockNumber);
    
    return {
      success: true,
      data: transactions.slice(0, limit),
      count: Math.min(transactions.length, limit)
    };
  } catch (error) {
    console.error("Error fetching wallet transactions:", error);
    return {
      success: false,
      error: error.message || "Error fetching wallet transactions.",
      details: error.stack
    };
  }
}

/**
 * Finds token transfer events for a wallet
 * @param {string} chain - The blockchain name
 * @param {string} walletAddress - The wallet address to query
 * @param {Object} options - Options like fromBlock, toBlock, limit
 * @returns {Promise<Array>} Formatted token transfer events
 */
async function findTokenTransferEvents(chain, walletAddress, options = {}) {
  try {
    const provider = providers[chain.toLowerCase()];
    if (!provider) {
      throw new Error(`Provider not found for chain: ${chain}`);
    }
    
    const normalizedAddress = walletAddress.toLowerCase();
    const fromBlock = options.fromBlock || 0;
    const toBlock = options.toBlock || await provider.getBlockNumber();
    const limit = options.limit || 10;
    
    // Create filters for Transfer events
    // First, filter for transfers FROM this wallet
    const filterFrom = {
      topics: [
        TRANSFER_EVENT_TOPIC,
        ethers.zeroPadValue(ethers.getAddress(walletAddress), 32), // from = wallet
        null // to = any
      ],
      fromBlock,
      toBlock
    };
    
    // Second, filter for transfers TO this wallet
    const filterTo = {
      topics: [
        TRANSFER_EVENT_TOPIC,
        null, // from = any
        ethers.zeroPadValue(ethers.getAddress(walletAddress), 32) // to = wallet
      ],
      fromBlock,
      toBlock
    };
    
    // Get logs for both filters
    const [logsFrom, logsTo] = await Promise.all([
      provider.getLogs(filterFrom),
      provider.getLogs(filterTo)
    ]);
    
    // Combine logs and sort by block number (descending)
    const allLogs = [...logsFrom, ...logsTo].sort((a, b) => b.blockNumber - a.blockNumber);
    
    // Process logs up to the limit
    const events = [];
    const processedTxs = new Set();
    
    for (const log of allLogs) {
      if (events.length >= limit) break;
      
      // Skip duplicate transactions
      if (processedTxs.has(log.transactionHash)) continue;
      processedTxs.add(log.transactionHash);
      
      try {
        // Decode the log
        const decodedLog = TRANSFER_INTERFACE.parseLog({
          topics: log.topics,
          data: log.data
        });
        
        if (!decodedLog) continue;
        
        const { from, to, value } = decodedLog.args;
        const tokenAddress = log.address;
        
        // Determine if this wallet is sender or receiver
        const isSender = from.toLowerCase() === normalizedAddress;
        
        // Get token details
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        let symbol, decimals, name;
        
        try {
          [symbol, decimals, name] = await Promise.all([
            tokenContract.symbol().catch(() => 'UNKNOWN'),
            tokenContract.decimals().catch(() => 18),
            tokenContract.name().catch(() => 'Unknown Token')
          ]);
        } catch (error) {
          symbol = 'UNKNOWN';
          decimals = 18;
          name = 'Unknown Token';
        }
        
        // Get transaction and block information
        const tx = await provider.getTransaction(log.transactionHash);
        const block = await provider.getBlock(log.blockNumber);
        const timestamp = block ? new Date(block.timestamp * 1000).toISOString() : null;
        
        // Format the token transfer event
        const formattedEvent = {
          transactionHash: log.transactionHash,
          blockNumber: log.blockNumber,
          blockTimestamp: timestamp,
          time: timestamp ? new Date(timestamp).toLocaleString() : "Unknown",
          transactionType: isSender ? "token_send" : "token_receive",
          direction: isSender ? "send" : "receive",
          exchange: {
            name: "Token Transfer",
            address: isSender ? to : from,
            logo: null
          },
          bought: isSender ? {} : {
            symbol,
            name,
            amount: ethers.formatUnits(value, decimals),
            valueUsd: 0,
            tokenAddress
          },
          sold: isSender ? {
            symbol,
            name,
            amount: ethers.formatUnits(value, decimals),
            valueUsd: 0,
            tokenAddress
          } : {},
          totalValueUsd: 0,
          gas: tx ? {
            used: "unknown", // Would need receipt
            price: tx.gasPrice ? tx.gasPrice.toString() : "unknown",
            fee: "unknown" // Would need receipt
          } : {
            used: "unknown",
            price: "unknown",
            fee: "unknown"
          },
          category: "token_transfer",
          summary: `${isSender ? "Sent" : "Received"} ${ethers.formatUnits(value, decimals)} ${symbol}`
        };
        
        events.push(formattedEvent);
      } catch (error) {
        console.error(`Error processing log:`, error.message);
      }
    }
    
    return events;
  } catch (error) {
    console.error("Error finding token transfers:", error);
    return [];
  }
}

/**
 * Formats an EVM transaction into a standard structure
 * @param {Object} tx - Transaction object from ethers
 * @param {Object} receipt - Transaction receipt
 * @param {string} walletAddress - The wallet address being queried
 * @param {string} chain - The chain name
 * @param {Object} provider - The ethers provider
 * @returns {Object} Formatted transaction
 */
async function formatEvmTransaction(tx, receipt, walletAddress, chain, provider) {
  // Determine if this wallet is sender or receiver
  const isSender = tx.from.toLowerCase() === walletAddress.toLowerCase();
  const direction = isSender ? "send" : "receive";
  
  // Get block timestamp
  const block = await provider.getBlock(receipt.blockNumber);
  const timestamp = block ? new Date(block.timestamp * 1000).toISOString() : null;
  
  // Determine transaction type
  let transactionType = "unknown";
  let value = "0";
  
  if (tx.value && !tx.value.isZero()) {
    transactionType = isSender ? "send" : "receive";
    value = ethers.formatEther(tx.value);
  }
  
  // Check if it's a contract interaction
  if (tx.data && tx.data !== "0x") {
    if (transactionType === "unknown") {
      transactionType = "contract";
    }
  }
  
  // Default values for bought/sold
  let bought = { symbol: "N/A", amount: "0", valueUsd: 0 };
  let sold = { symbol: "N/A", amount: "0", valueUsd: 0 };
  
  // Populate bought/sold based on transaction
  if (transactionType === "send") {
    sold = {
      symbol: getChainNativeSymbol(chain),
      amount: value,
      valueUsd: 0,
      tokenAddress: null
    };
  } else if (transactionType === "receive") {
    bought = {
      symbol: getChainNativeSymbol(chain),
      amount: value,
      valueUsd: 0,
      tokenAddress: null
    };
  }
  
  // Calculate gas fee
  const gasUsed = receipt.gasUsed || ethers.getBigInt(0);
  const gasPrice = tx.gasPrice || ethers.getBigInt(0);
  const gasFee = gasUsed * gasPrice;
  
  return {
    transactionHash: tx.hash,
    blockNumber: receipt.blockNumber,
    blockTimestamp: timestamp,
    time: timestamp ? new Date(timestamp).toLocaleString() : "Unknown",
    transactionType,
    direction,
    exchange: {
      name: "Unknown", // Would need a contract-to-name mapping service
      address: tx.to,
      logo: null
    },
    bought,
    sold,
    totalValueUsd: 0, // Would need price data
    gas: {
      used: gasUsed.toString(),
      price: gasPrice.toString(),
      fee: ethers.formatEther(gasFee)
    },
    category: transactionType,
    summary: `${direction === "send" ? "Sent" : "Received"} ${transactionType === "contract" ? "contract interaction" : value + " " + getChainNativeSymbol(chain)}`
  };
}

/**
 * For a more advanced implementation, you could add token transfer detection
 * by parsing logs for ERC20 Transfer events. This function is a starting point.
 */
function detectTokenTransfers(receipt, walletAddress) {
  if (!receipt.logs) return [];
  
  // ERC20 Transfer event topic
  const transferTopic = ethers.id("Transfer(address,address,uint256)");
  
  // Find logs that match the Transfer event
  const transferLogs = receipt.logs.filter(log => 
    log.topics[0] === transferTopic && 
    (
      // From wallet (index 1)
      (log.topics[1] && ethers.dataSlice(log.topics[1], 12).toLowerCase() === walletAddress.toLowerCase()) ||
      // To wallet (index 2)
      (log.topics[2] && ethers.dataSlice(log.topics[2], 12).toLowerCase() === walletAddress.toLowerCase())
    )
  );
  
  // This is just a stub - a full implementation would decode these logs
  // and add token transfer information to the transaction
  return transferLogs;
}



























// --------------------
// Shared Axios Setup
// --------------------

const MORALIS_API_KEY = config.moralisAPIKey;
const axiosInstanceMoralis = axios.create({
  headers: {
    accept: 'application/json',
    'X-API-Key': MORALIS_API_KEY,
  },
  timeout: 60000, // 60 seconds timeout
});

// Axios request with exponential backoff retries.
async function axiosRequestWithRetryMoralis(url, config = {}, retries = 3, backoff = 300) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await axiosInstanceMoralis.get(url, config);
    } catch (error) {
      if (attempt === retries - 1) {
        throw error;
      }
      const delay = backoff * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
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
  // Sonic Mainnet
  "sonic": "0x146",
  "sonic mainnet": "0x146",

  // Ethereum Mainnet
  "ethereum": "0x1",
  "mainnet": "0x1",
  "eth": "0x1",
  "ethereum mainnet": "0x1",

  // Ethereum Sepolia
  "sepolia": "0xaa36a7",
  "ethereum sepolia": "0xaa36a7",

  // Ethereum Holesky
  "holesky": "0x4268",
  "ethereum holesky": "0x4268",

  // Polygon
  "polygon": "0x89",
  "polygon mainnet": "0x89",

  // Polygon Amoy
  "polygon amoy": "0x13882",

  // Binance Smart Chain Mainnet
  "bsc": "0x38",
  "binance": "0x38",
  "binance smart chain": "0x38",
  "bsc mainnet": "0x38",

  // Binance Smart Chain Testnet
  "bsc testnet": "0x61",
  "binance smart chain testnet": "0x61",

  // Arbitrum
  "arbitrum": "0xa4b1",
  "arbitrum mainnet": "0xa4b1",

  // Arbitrum Sepolia
  "arbitrum sepolia": "0x66eee",

  // Base
  "base": "0x2105",
  "base mainnet": "0x2105",

  // Base Sepolia
  "base sepolia": "0x14a34",

  // Optimism
  "optimism": "0x0a",
  "optimism mainnet": "0x0a",

  // Optimism Sepolia
  "optimism sepolia": "0xaa37dc",

  // Linea
  "linea": "0xe708",
  "linea mainnet": "0xe708",

  // Linea Sepolia
  "linea sepolia": "0xe705",

  // Avalanche
  "avalanche": "0xa86a",
  "avalanche mainnet": "0xa86a",

  // Fantom
  "fantom": "0xfa",
  "fantom mainnet": "0xfa",

  // Fantom Testnet
  "fantom testnet": "0xfa2",

  // Cronos
  "cronos": "0x19",
  "cronos mainnet": "0x19",

  // Gnosis (xDai)
  "gnosis": "0x64",
  "xdai": "0x64",
  "gnosis mainnet": "0x64",

  // Gnosis Chiado (Testnet)
  "gnosis chiado": "0x27d8",
  "chiado": "0x27d8",
  "gnosis testnet": "0x27d8",

  // Chiliz
  "chiliz": "0x15b38",
  "chiliz mainnet": "0x15b38",

  // Chiliz Testnet
  "chiliz testnet": "0x15b32",

  // Moonbeam
  "moonbeam": "0x504",
  "moonbeam mainnet": "0x504",

  // Moonriver
  "moonriver": "0x505",
  "moonriver testnet": "0x505",

  // Moonbase
  "moonbase": "0x507",
  "moonbase testnet": "0x507",

  // Blast
  "blast": "0x13e31",
  "blast mainnet": "0x13e31",

  // Blast Sepolia
  "blast sepolia": "0xa0c71fd",

  // zkSync
  "zksync": "0x144",
  "zksync mainnet": "0x144",

  // zkSync Sepolia
  "zksync sepolia": "0x12c",

  // Mantle
  "mantle": "0x1388",
  "mantle mainnet": "0x1388",

  // Mantle Sepolia
  "mantle sepolia": "0x138b",

  // opBNB
  "opbnb": "0xcc",
  "opbnb mainnet": "0xcc",

  // Polygon zkEVM
  "polygon zkevm": "0x44d",
  "polygon zkevm mainnet": "0x44d",

  // Polygon zkEVM Cardona
  "polygon zkevm cardona": "0x98a",
  "polygon zkevm cardona testnet": "0x98a",

  // Zetachain
  "zetachain": "0x1b58",
  "zetachain mainnet": "0x1b58",

  // Zetachain Testnet
  "zetachain testnet": "0x1b59",

  // Flow
  "flow": "0x2eb",
  "flow mainnet": "0x2eb",

  // Flow Testnet
  "flow testnet": "0x221",

  // Ronin
  "ronin": "0x7e4",
  "ronin mainnet": "0x7e4",

  // Ronin Testnet (Saigon)
  "ronin testnet": "0x7e5",

  // Lisk
  "lisk": "0x46f",
  "lisk mainnet": "0x46f",

  // Lisk Sepolia Testnet
  "lisk testnet": "0x106a",

  // Pulsechain
  "pulsechain": "0x171",
  "pulsechain mainnet": "0x171"
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
/**
 * Fetches portfolio data for a wallet with fallback to native implementation for EVM chains
 * @param {string} chain - Chain name (e.g., 'ethereum', 'solana')
 * @param {string} walletAddress - The wallet address to query
 * @returns {Promise<Object>} Portfolio data in standardized format
 */
export async function getPortfolioData(chain, wallet) {
  try {
    const normalizedChain = chain.toLowerCase();
    const walletAddress = await Promise.resolve(wallet);
    if (normalizedChain === "solana") {
      // For Solana, use the SolApi with retry logic.
      const response = await retryOperation(() =>
        Moralis.SolApi.account.getPortfolio({
          network: "mainnet", // Adjust if needed.
          address: walletAddress,
        })
      );
      console.log("Solana Portfolio:", response.result);
      return response.result;
    } else {
      // For EVM chains, try Moralis API first
      try {
        // Get the corresponding hex chain ID
        const hexChainId = moralisChainMapping[normalizedChain];
        if (!hexChainId) {
          throw new Error(`Chain "${chain}" is not supported by Moralis.`);
        }
        
        console.log("[EVM] Trying with:", JSON.stringify(hexChainId, null, 2), " and walletAddress ", walletAddress);
        const response = await retryOperation(() =>
          Moralis.EvmApi.wallets.getWalletTokenBalancesPrice({
            chain: hexChainId,
            address: walletAddress,
          })
        );
        
        console.log("[EVM] Portfolio from Moralis:", JSON.stringify(response.result, null, 2));
        return response.result;
      } catch (moralisError) {
        console.warn(`Moralis API failed for ${chain}, falling back to native implementation:`, moralisError.message);
        
        // Fallback to native implementation for EVM chains
        const portfolioResult = await getWalletPortfolioEVM(normalizedChain, walletAddress, {
          includePrices: true,
          discoverTokens: true
        });
        
        if (!portfolioResult.success) {
          throw new Error(portfolioResult.error || "Failed to fetch portfolio data");
        }
        
        // Transform the result to match Moralis format for consistency
        const transformedData = transformPortfolioData(portfolioResult.data, normalizedChain);
        console.log("[EVM] Portfolio from fallback:", JSON.stringify(transformedData, null, 2));
        
        return transformedData;
      }
    }
  } catch (error) {
    console.error("Error fetching portfolio data:", error);
    return { error: error.message || "An error occurred while fetching portfolio data." };
  }
}

/**
 * Transforms native portfolio data format to match Moralis API format
 * @param {Object} nativeData - Data from getWalletPortfolioEVM
 * @param {string} chain - Chain name
 * @returns {Object} Data in Moralis-compatible format
 */
function transformPortfolioData(nativeData, chain) {
  // Extract token balances and format them to match Moralis API structure
  const tokens = nativeData.tokenBalances.map(token => ({
    token_address: token.tokenAddress,
    name: token.name,
    symbol: token.symbol,
    logo: null, // Moralis provides logos, we don't have them in native implementation
    thumbnail: null,
    decimals: token.decimals,
    balance: token.balanceRaw,
    possible_spam: false, // We don't have spam detection in native implementation
    verified: true, // Assuming all tokens in our list are verified
    usd_price: token.priceUsd || 0,
    usd_value: token.balanceUsd || 0,
    formatted_balance: token.balance
  }));
  
  // Add native token to the tokens list
  tokens.unshift({
    token_address: "0x0000000000000000000000000000000000000000", // ETH and other native tokens
    name: getNativeTokenName(chain),
    symbol: nativeData.nativeBalance.symbol,
    logo: null,
    thumbnail: null,
    decimals: 18,
    balance: nativeData.nativeBalance.balanceRaw || "0",
    possible_spam: false,
    verified: true,
    usd_price: nativeData.nativeBalance.priceUsd || 0,
    usd_value: nativeData.nativeBalance.balanceUsd || 0,
    formatted_balance: nativeData.nativeBalance.balance || "0"
  });
  
  return {
    total_balance: {
      usd_value: nativeData.totalBalanceUsd || 0
    },
    tokens
  };
}

/**
 * Retrieves and formats wallet transactions for both Solana and EVM chains
 * @param {string} chain - The blockchain name (e.g., "ethereum", "solana")
 * @param {string} walletAddress - The wallet address to query
 * @returns {Promise<Object>} Formatted transaction data or error
 */
export async function getWalletTransactions(chain, walletAddress) {
  try {
    // Normalize chain name
    const normalizedChain = chain.toLowerCase();
    
    // Initialize Moralis if not already initialized
    if (!Moralis.Core.isStarted) {
      await Moralis.start({
        apiKey: process.env.MORALIS_API_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJub25jZSI6IjQxZDFhNDc4LThmZTMtNDdlYS05OTAzLWRhMjNlY2QzZmI5MSIsIm9yZ0lkIjoiNDMwNjk3IiwidXNlcklkIjoiNDQzMDM2IiwidHlwZUlkIjoiMDJjYjIyMGQtN2Q0Zi00N2ZlLTliNTItNTgxODBiMGJkNTg1IiwidHlwZSI6IlBST0pFQ1QiLCJpYXQiOjE3MzkyNjQ4OTYsImV4cCI6NDg5NTAyNDg5Nn0.Cql9oerOsisBIIC2tWju5pktT3Zc6xxMXdgXBucBOCM"
      });
    }
    
    let transactions;
    
    // Handle different chain types
    if (normalizedChain === "solana") {
      // Use Solana API endpoint via axiosRequestWithRetry
      const url = `https://solana-gateway.moralis.io/account/mainnet/${walletAddress}/swaps?order=DESC`;
      const response = await axiosRequestWithRetryMoralis(url);
      // Correction: use response.data.result since axios returns data inside the 'data' property
      transactions = response.data.result;
    } else {
      // Use EVM chain API      
      const hexChainId = moralisChainMapping[chain.toLowerCase()];
      if (!hexChainId) {
        return { success: false, error: `Chain "${chain}" is not supported.` };
      }
      
      // Use Moralis EvmApi for EVM chains      
      const response = await retryOperation(() =>
        Moralis.EvmApi.wallets.getWalletHistory({
          chain: hexChainId,
          address: walletAddress,
          order: "DESC"
        })
      );
      
      transactions = response.data.result;
    }
    
    // Validate transactions
    if (!transactions || transactions.length === 0) {
      return { success: true, data: [], message: "No transactions found." };
    }
    
    // Format transactions based on chain type
    const formattedTransactions = normalizedChain === "solana" 
      ? formatSolanaTransactions(transactions)
      : formatEvmTransactions(transactions);
    
    return { 
      success: true, 
      data: formattedTransactions,
      count: formattedTransactions.length
    };
  } catch (error) {
    console.error("Error fetching wallet transactions:", error);
    return { 
      success: false, 
      error: error.message || "Error fetching wallet transactions.", 
      details: error.stack
    };
  }
}

/**
 * Format Solana transactions into a standard structure
 * @param {Array} transactions - Array of Solana transactions
 * @returns {Array} Formatted transactions
 */
function formatSolanaTransactions(transactions) {
  return transactions.map(tx => ({
    transactionHash: tx.transactionHash,
    blockTimestamp: tx.blockTimestamp,
    time: new Date(tx.blockTimestamp).toLocaleString(),
    transactionType: tx.transactionType, // buy/sell
    subCategory: tx.subCategory, // accumulation/sellAll
    exchange: {
      name: tx.exchangeName,
      address: tx.exchangeAddress,
      logo: tx.exchangeLogo
    },
    pair: {
      label: tx.pairLabel,
      address: tx.pairAddress
    },
    bought: {
      symbol: tx.bought?.symbol || "N/A",
      amount: tx.bought?.amount || "0",
      priceUsd: tx.bought?.usdPrice || 0,
      valueUsd: tx.bought?.usdAmount || 0,
      logo: tx.bought?.logo || null,
      tokenAddress: tx.bought?.address || null
    },
    sold: {
      symbol: tx.sold?.symbol || "N/A",
      amount: tx.sold?.amount || "0",
      priceUsd: tx.sold?.usdPrice || 0,
      valueUsd: tx.sold?.usdAmount || 0,
      logo: tx.sold?.logo || null,
      tokenAddress: tx.sold?.address || null
    },
    totalValueUsd: tx.totalValueUsd || 0,
    baseQuotePrice: tx.baseQuotePrice
  }));
}

/**
 * Format EVM transactions into a standard structure
 * @param {Array} transactions - Array of EVM transactions
 * @returns {Array} Formatted transactions
 */
function formatEvmTransactions(transactions) {
  return transactions.map(tx => {
    // Determine transaction type based on available data
    let transactionType = "unknown";
    
    if (tx.nft_transfers?.length > 0) {
      transactionType = "nft";
    } else if (tx.erc20_transfers?.length > 0) {
      transactionType = "token";
    } else if (tx.native_transfers?.length > 0) {
      if (tx.native_transfers.some(t => t.direction === "receive")) {
        transactionType = "receive";
      } else {
        transactionType = "send";
      }
    } else if (tx.category === "token swap") {
      transactionType = "swap";
    } else if (tx.category === "approve") {
      transactionType = "approve";
    } else if (tx.category === "airdrop") {
      transactionType = "airdrop";
    }
    
    // Determine symbols and amounts based on transaction type
    let bought = { symbol: "N/A", amount: "0", valueUsd: 0 };
    let sold = { symbol: "N/A", amount: "0", valueUsd: 0 };
    
    if (tx.category === "token swap" && tx.erc20_transfers?.length > 0) {
      // For token swaps, identify bought/sold tokens
      const sentToken = tx.erc20_transfers.find(t => t.direction === "send");
      const receivedToken = tx.erc20_transfers.find(t => t.direction === "receive");
      
      if (sentToken) {
        sold = {
          symbol: sentToken.token_symbol || "Unknown",
          amount: sentToken.value_formatted || sentToken.value,
          valueUsd: 0, // EVM data doesn't always include USD value
          tokenAddress: sentToken.address,
          logo: sentToken.token_logo
        };
      }
      
      if (receivedToken) {
        bought = {
          symbol: receivedToken.token_symbol || "Unknown",
          amount: receivedToken.value_formatted || receivedToken.value,
          valueUsd: 0,
          tokenAddress: receivedToken.address,
          logo: receivedToken.token_logo
        };
      }
    } else if (tx.native_transfers?.length > 0) {
      // For native transfers (ETH, etc.)
      const transfer = tx.native_transfers[0];
      if (transfer.direction === "receive") {
        bought = {
          symbol: transfer.token_symbol || "ETH",
          amount: transfer.value_formatted || transfer.value,
          valueUsd: 0,
          tokenAddress: null,
          logo: transfer.token_logo
        };
      } else {
        sold = {
          symbol: transfer.token_symbol || "ETH",
          amount: transfer.value_formatted || transfer.value,
          valueUsd: 0,
          tokenAddress: null,
          logo: transfer.token_logo
        };
      }
    } else if (tx.nft_transfers?.length > 0) {
      // For NFT transfers
      const nft = tx.nft_transfers[0];
      if (nft.direction === "receive") {
        bought = {
          symbol: `NFT #${nft.token_id}`,
          amount: nft.amount || "1",
          valueUsd: 0,
          tokenAddress: nft.token_address,
          logo: null
        };
      } else {
        sold = {
          symbol: `NFT #${nft.token_id}`,
          amount: nft.amount || "1",
          valueUsd: 0,
          tokenAddress: nft.token_address,
          logo: null
        };
      }
    }
    
    return {
      transactionHash: tx.hash,
      blockTimestamp: tx.block_timestamp,
      time: new Date(tx.block_timestamp).toLocaleString(),
      transactionType: transactionType,
      exchange: {
        name: tx.to_address_entity || "Unknown",
        address: tx.to_address || null,
        logo: tx.to_address_entity_logo || null
      },
      bought,
      sold,
      totalValueUsd: 0, // EVM data often doesn't include this
      gas: {
        used: tx.receipt_gas_used,
        price: tx.gas_price,
        fee: tx.transaction_fee
      },
      category: tx.category || "unknown",
      summary: tx.summary || ""
    };
  });
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
        return { error: `Moralis balance API: Chain "${chain}" is not linked.` };
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
    return { error: error.message || "Error fetching wallet PNL" };
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