import { dextools } from '../../services/dextools/index.js';
import { getTokenPrice, getTokenSnipers, getTokenHolders, getTokenPairAddress } from '../../services/tokens/MoralisTokenService.js';
import { twitterService } from '../../services/twitter/index.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';
import { getTokenInfo } from '../../services/dextools/index.js';
import { dexscreener } from '../../services/dexscreener/index.js';
// MoralisTokenService functions already imported above
// twitterService already imported above
import { v4 as uuidv4 } from 'uuid';
import { detectQueryIntent, extractTokens, isContractAddress, isUrl } from './utils/nlpHelper.js';
import { scrapeUrl } from './utils/urlScraper.js';
import { geminiService } from '../../services/ai/geminiService.js';

// Path handling for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Search cache to store results (simple in-memory storage for demo)
const searchCache = new Map();

// Saved results storage (persistent storage for search history)
// Changed from Map to Object of Maps to support multi-user wallet-based storage
const savedResults = {
  // Format: { [walletAddress]: Map<searchId, searchData> }
};

// User message history limit
const USER_MESSAGE_HISTORY_LIMIT = 100;

/**
 * Save search result to persistent storage
 * @param {string} id - Search ID
 * @param {Object} data - Search data including results and query info
 * @param {string} walletAddress - User's wallet address
 */
export async function saveSearchResult(id, data, walletAddress) {
  try {
    if (!walletAddress) {
      throw new Error('Wallet address is required to save search results');
    }

    // Store results with timestamp and wallet address
    const savedData = {
      id,
      results: data.results,
      query: data.query,
      type: data.type,
      timestamp: Date.now(),
      walletAddress
    };
    
    // Initialize user's storage if it doesn't exist
    if (!savedResults[walletAddress]) {
      savedResults[walletAddress] = new Map();
    }
    
    // Get the user's map and add the new search result
    const userResults = savedResults[walletAddress];
    userResults.set(id, savedData);
    
    // Prune history if it exceeds the limit
    if (userResults.size > USER_MESSAGE_HISTORY_LIMIT) {
      // Get oldest entries and remove them
      const entries = Array.from(userResults.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      
      // Remove oldest entries until we're under the limit
      const entriesToRemove = entries.slice(0, entries.length - USER_MESSAGE_HISTORY_LIMIT);
      for (const [entryId] of entriesToRemove) {
        userResults.delete(entryId);
      }
      
      logger.info(`Pruned ${entriesToRemove.length} old search entries for wallet ${walletAddress}`);
    }
    
    logger.info(`Saved search result with ID: ${id} for wallet: ${walletAddress}`);
    return { success: true, id, walletAddress };
  } catch (error) {
    logger.error(`Error saving search result: ${error.message}`);
    throw error;
  }
}

/**
 * Retrieve a saved search result by ID
 * @param {string} id - Search ID
 * @param {string} walletAddress - User's wallet address
 * @returns {Object|null} - The saved search data or null if not found
 */
export async function getSavedResult(id, walletAddress) {
  try {
    if (!walletAddress) {
      throw new Error('Wallet address is required to retrieve search results');
    }
    
    // Check if the user has any saved results
    if (!savedResults[walletAddress]) {
      logger.warn(`No search history found for wallet: ${walletAddress}`);
      return null;
    }
    
    // Get the user's map of search results
    const userResults = savedResults[walletAddress];
    
    // Check if the specific search ID exists for this user
    if (!userResults.has(id)) {
      logger.warn(`Search result not found for ID: ${id} and wallet: ${walletAddress}`);
      return null;
    }
    
    const savedData = userResults.get(id);
    logger.info(`Retrieved saved search result with ID: ${id} for wallet: ${walletAddress}`);
    return savedData;
  } catch (error) {
    logger.error(`Error retrieving saved search result: ${error.message}`);
    throw error;
  }
}

/**
 * Get all search history for a specific wallet address
 * @param {string} walletAddress - User's wallet address
 * @returns {Array} - Array of search results, sorted by timestamp (newest first)
 */
export async function getUserSearchHistory(walletAddress) {
  try {
    if (!walletAddress) {
      throw new Error('Wallet address is required to retrieve search history');
    }
    
    // Check if the user has any saved results
    if (!savedResults[walletAddress] || savedResults[walletAddress].size === 0) {
      logger.info(`No search history found for wallet: ${walletAddress}`);
      return [];
    }
    
    // Get all search results for this user and convert to array
    const userResults = savedResults[walletAddress];
    const resultsArray = Array.from(userResults.values());
    
    // Sort by timestamp (newest first)
    resultsArray.sort((a, b) => b.timestamp - a.timestamp);
    
    // Only return the most recent results up to the limit
    const limitedResults = resultsArray.slice(0, USER_MESSAGE_HISTORY_LIMIT);
    
    logger.info(`Retrieved ${limitedResults.length} search history items for wallet: ${walletAddress}`);
    return limitedResults;
  } catch (error) {
    logger.error(`Error retrieving search history: ${error.message}`);
    throw error;
  }
}

/**
 * Main function to render the SENTINEL page
 * Loads HTML, CSS, and JavaScript from separate files
 */
export async function renderSentinelPage() {
  try {
    // Load HTML template
    const htmlPath = path.join(__dirname, 'templates', 'sentinel.html');
    const cssPath = path.join(__dirname, 'templates', 'sentinel.css');
    const jsPath = path.join(__dirname, 'templates', 'sentinel.js');
    
    // Read all template files
    const [htmlTemplate, cssContent, jsContent] = await Promise.all([
      fs.readFile(htmlPath, 'utf8'),
      fs.readFile(cssPath, 'utf8'),
      fs.readFile(jsPath, 'utf8'),
    ]);
    
    // Inject CSS and JS into HTML template
    const fullHtml = htmlTemplate
      .replace('<!-- SENTINEL_CSS_PLACEHOLDER -->', `<style>${cssContent}</style>`)
      .replace('<!-- SENTINEL_JS_PLACEHOLDER -->', `<script>${jsContent}</script>`);
    
    return fullHtml;
  } catch (error) {
    console.error('Error rendering SENTINEL page:', error);
    throw new Error(`Failed to render SENTINEL page: ${error.message}`);
  }
}

/**
 * Main search function for SENTINEL
 * Handles different input types and distributes to appropriate handlers
 */
export async function searchSentinel(query, type = 'auto') {
  try {
    // Generate a unique search ID
    const searchId = `search_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    
    // Determine the query type if auto
    if (type === 'auto') {
      type = determineQueryType(query);
    }
    
    // Start search process based on type
    let results;
    switch (type) {
      case 'text':
        results = await handleTextQuery(query);
        break;
      case 'contract':
        results = await handleContractQuery(query);
        break;
      case 'url':
        results = await handleUrlQuery(query);
        break;
      default:
        throw new Error('Invalid query type');
    }
    
    // Cache the results
    const searchResult = {
      id: searchId,
      timestamp: new Date().toISOString(),
      query,
      type,
      results
    };
    
    searchCache.set(searchId, searchResult);
    return searchResult;
  } catch (error) {
    console.error('Error in searchSentinel:', error);
    throw error;
  }
}

/**
 * Determine the type of query (text, contract address, or URL)
 */
function determineQueryType(query) {
  // Check if query is a URL using our utility
  if (isUrl(query)) {
    return 'url';
  }
  
  // Check if query is a contract address using our utility
  if (isContractAddress(query)) {
    return 'contract';
  }
  
  // Default to text query
  return 'text';
}

/**
 * Handle natural language text queries
 * Analyzes the text and determines which tools to use
 */
async function handleTextQuery(query) {
  try {
    // Use our NLP utility to detect intent and extract entities
    const { intents, entities } = detectQueryIntent(query);
    logger.debug(`Detected intents: ${JSON.stringify(intents)}, entities: ${JSON.stringify(entities)}`);
    
    // Extract token symbols from the query
    const tokenSymbols = entities.tokens.length > 0 ? entities.tokens : extractTokens(query);
    const token = tokenSymbols[0] || ''; // Use first token if available
    
    if (!token) {
      throw new Error('Could not identify a token in the query');
    }
    
    // Execute tool calls based on detected intents
    const results = {};
    
    // Always fetch basic token info
    try {
      results.tokenInfo = await fetchTokenInfo(token, 'solana');
    } catch (error) {
      logger.error(`Error fetching token info: ${error.message}`);
    }
    
    // Based on specific intents, fetch additional data
    if (intents.includes('HOLDERS') || intents.includes('TOKEN_INFO')) {
      try {
        results.tokenMetadata = await fetchTokenMetadata(token, 'solana');
      } catch (error) {
        logger.error(`Error fetching token metadata: ${error.message}`);
      }
    }
    
    if (intents.includes('SECURITY')) {
      try {
        results.securityAnalysis = await fetchTokenSecurity(token, 'solana');
      } catch (error) {
        logger.error(`Error fetching security analysis: ${error.message}`);
      }
    }
    
    if (intents.includes('SOCIAL')) {
      try {
        results.socialData = await fetchTokenTweets(token);
      } catch (error) {
        logger.error(`Error fetching social data: ${error.message}`);
      }
    }
    
    return results;
  } catch (error) {
    logger.error(`Error processing text query: ${error.message}`);
    throw error;
  }
}

/**
 * Analyze a natural language query to determine intents
 * This is a simple implementation that could be replaced with an AI model
 */
function analyzeQuery(query) {
  const lowercaseQuery = query.toLowerCase();
  const intents = {
    tokenInfo: false,
    tokenMetadata: false,
    tokenSecurity: false,
    tokenTweets: false,
    token: null
  };
  
  // Simple keyword matching
  if (lowercaseQuery.includes('price') || lowercaseQuery.includes('info') || lowercaseQuery.includes('token')) {
    intents.tokenInfo = true;
  }
  
  if (lowercaseQuery.includes('metadata') || lowercaseQuery.includes('holders') || lowercaseQuery.includes('snipers')) {
    intents.tokenMetadata = true;
  }
  
  if (lowercaseQuery.includes('security') || lowercaseQuery.includes('safety') || lowercaseQuery.includes('risk')) {
    intents.tokenSecurity = true;
  }
  
  if (lowercaseQuery.includes('tweet') || lowercaseQuery.includes('twitter') || lowercaseQuery.includes('social')) {
    intents.tokenTweets = true;
  }
  
  // Extract potential token from query (simplified)
  const tokenMatch = lowercaseQuery.match(/\b[a-z0-9]{2,10}\b/);
  if (tokenMatch) {
    intents.token = tokenMatch[0];
  }
  
  // If no specific intents found, return all
  if (!intents.tokenInfo && !intents.tokenMetadata && !intents.tokenSecurity && !intents.tokenTweets) {
    intents.tokenInfo = true;
    intents.tokenMetadata = true;
    intents.tokenSecurity = true;
    intents.tokenTweets = true;
  }
  
  return intents;
}

/**
 * Handle contract address queries
 * Fetches comprehensive information about the token using multiple tools
 */
async function handleContractQuery(contractAddress) {
  try {
    logger.debug(`Processing contract query: ${contractAddress}`);
    
    // Initialize results object
    const results = {};
    
    // Fetch basic token info
    try {
      results.tokenInfo = await fetchTokenInfo(contractAddress, 'solana');
    } catch (error) {
      logger.error(`Error fetching token info: ${error.message}`);
    }
    
    // Fetch token metadata (price, holders, pair data)
    try {
      results.tokenMetadata = await fetchTokenMetadata(contractAddress, 'solana');
    } catch (error) {
      logger.error(`Error fetching token metadata: ${error.message}`);
    }
    
    // Fetch security analysis
    try {
      results.securityAnalysis = await fetchTokenSecurity(contractAddress, 'solana');
    } catch (error) {
      logger.error(`Error fetching security analysis: ${error.message}`);
    }
    
    // Fetch social data if we have a token symbol from the token info
    if (results.tokenInfo && results.tokenInfo.symbol) {
      try {
        results.socialData = await fetchTokenTweets(results.tokenInfo.symbol);
      } catch (error) {
        logger.error(`Error fetching social data: ${error.message}`);
      }
    }
    
    return results;
  } catch (error) {
    console.error('Error handling contract query:', error);
    throw error;
  }
}

/**
 * Handle URL queries
 * Fetches and scrapes website data using our URL scraper
 */
async function handleUrlQuery(url) {
  try {
    logger.debug(`Processing URL query: ${url}`);
    
    // Use our URL scraper to extract content
    const scrapedData = await scrapeUrl(url);
    logger.debug(`Scraped data from URL: ${JSON.stringify(scrapedData)}`);
    
    const results = {
      url,
      content: scrapedData.content,
      tokens: [],
      contracts: []
    };
    
    // Extract tokens and contract addresses
    if (scrapedData.tokens && scrapedData.tokens.length > 0) {
      results.tokens = scrapedData.tokens;
      
      // Get token info for the first token found
      const token = scrapedData.tokens[0];
      try {
        results.tokenInfo = await fetchTokenInfo(token, 'solana');
      } catch (error) {
        logger.error(`Error fetching token info: ${error.message}`);
      }
    }
    
    if (scrapedData.contractAddresses && scrapedData.contractAddresses.length > 0) {
      results.contracts = scrapedData.contractAddresses;
      
      // Get contract info for the first contract found
      const contract = scrapedData.contractAddresses[0];
      try {
        results.contractData = await handleContractQuery(contract);
      } catch (error) {
        logger.error(`Error fetching contract data: ${error.message}`);
      }
      
      // Get token security data for the first contract found
      try {
        results.securityAnalysis = await fetchTokenSecurity(contract, 'solana');
      } catch (error) {
        logger.error(`Error fetching security analysis: ${error.message}`);
      }
    }
    
    // Get social sentiment for detected tokens
    if (results.tokens.length > 0) {
      try {
        results.socialData = await fetchTokenTweets(results.tokens[0]);
      } catch (error) {
        logger.error(`Error fetching social data: ${error.message}`);
      }
    }
    
    return results;
  } catch (error) {
    logger.error(`Error handling URL query: ${error.message}`);
    throw error;
  }
}

/**
 * Fetch token info from DexTools
 */
async function fetchTokenInfo(tokenIdentifier, network) {
  try {
    logger.info(`🔍 Fetching token info for: ${tokenIdentifier} on ${network}`);
    
    // For token symbol, need to find contract address first
    let tokenAddress = tokenIdentifier;
    let symbol = null;
    
    // If token identifier is not a contract address, try to search for it using symbol
    if (tokenIdentifier.length < 30) {
      logger.debug(`Token identifier appears to be a symbol: ${tokenIdentifier}`);
      symbol = tokenIdentifier;
      
      try {
        // Search for token by symbol using DexScreener
        const tokensBySymbol = await dexscreener.getTokenInfoBySymbol(tokenIdentifier);
        
        // Validate that we received an array
        if (!Array.isArray(tokensBySymbol)) {
          logger.error(`DexScreener returned non-array data:`, typeof tokensBySymbol, tokensBySymbol);
          return {
            error: `Invalid data structure returned from DexScreener for symbol ${tokenIdentifier}`,
            symbol: tokenIdentifier,
            message: 'Data structure mismatch - expected array'
          };
        }
        
        logger.debug(`DexScreener returned ${tokensBySymbol.length} results for symbol ${tokenIdentifier}`);
        
        // Filter for Solana tokens only
        const solanaTokens = tokensBySymbol.filter(token => {
          try {
            // Check multiple possible chain identifiers
            const chainId = token.chainId || token.chain || (token.baseToken && token.baseToken.chainId);
            return chainId === 'solana' || chainId === 'sol';
          } catch (filterError) {
            logger.warn(`Error filtering token:`, filterError);
            return false;
          }
        });
        
        logger.debug(`Found ${solanaTokens.length} Solana tokens for symbol ${tokenIdentifier}`);
        
        // If Solana results found, use the first Solana result's address
        if (solanaTokens && solanaTokens.length > 0) {
          // Extract the token address from the first Solana result
          const firstToken = solanaTokens[0];
          tokenAddress = firstToken.baseToken?.address || firstToken.tokenAddress || firstToken.address;
          
          logger.info(`Resolved symbol ${tokenIdentifier} to Solana address ${tokenAddress}`);
          
          if (!tokenAddress) {
            logger.warn(`Failed to extract Solana address for symbol ${tokenIdentifier}`);
            return {
              error: `Could not extract address from token data for symbol ${tokenIdentifier}`,
              symbol: tokenIdentifier,
              tokenData: firstToken
            };
          }
        } else {
          logger.warn(`No Solana tokens found for symbol ${tokenIdentifier}`);
          return {
            error: `No Solana tokens found for symbol ${tokenIdentifier}`,
            symbol: tokenIdentifier,
            totalResults: tokensBySymbol.length,
            message: 'Try searching with a contract address instead'
          };
        }
      } catch (symbolError) {
        logger.error(`Error resolving symbol to address: ${symbolError.message}`);
        return {
          error: `Error resolving symbol ${tokenIdentifier}: ${symbolError.message}`,
          symbol: tokenIdentifier,
          details: symbolError.message
        };
      }
    }
    
    // Get token info from DexTools
    try {
      logger.debug(`Fetching DexTools data for address: ${tokenAddress}`);
      const tokenInfo = await dextools.getTokenInfo(network, tokenAddress);
      
      // If we started with a symbol, add it to the result
      if (symbol) {
        tokenInfo.originalSymbol = symbol;
        tokenInfo.resolvedAddress = tokenAddress;
      }
      
      logger.info(`✅ Successfully fetched token info for ${tokenIdentifier}`);
      return tokenInfo;
      
    } catch (dextoolsError) {
      logger.error(`Error fetching from DexTools: ${dextoolsError.message}`);
      return {
        error: `Error fetching token data from DexTools: ${dextoolsError.message}`,
        tokenAddress,
        symbol,
        details: dextoolsError.message
      };
    }
    
  } catch (error) {
    logger.error(`Error in fetchTokenInfo: ${error.message}`);
    return {
      error: `Failed to fetch token info for ${tokenIdentifier}: ${error.message}`,
      tokenIdentifier,
      details: error.message
    };
  }
}

/**
 * Fetch token metadata from Moralis
 */
async function fetchTokenMetadata(tokenIdentifier, network) {
  try {
    // First, check if this is a symbol that needs to be resolved to an address
    let tokenAddress = tokenIdentifier;
    
    // If this looks like a symbol and not an address, try to resolve it first
    if (tokenIdentifier.length < 30) {
      logger.debug(`Token identifier in fetchTokenMetadata appears to be a symbol: ${tokenIdentifier}`);
      
      try {
        // Search for token by symbol
        const tokensBySymbol = await dexscreener.getTokenInfoBySymbol(tokenIdentifier);
        logger.debug(`DexScreener returned ${tokensBySymbol.length} results for symbol ${tokenIdentifier}`);
        
        // If results found, use the first result's address
        if (tokensBySymbol && tokensBySymbol.length > 0) {
          // Extract the token address from the first result
          tokenAddress = tokensBySymbol[0].baseToken?.address;
          logger.info(`In fetchTokenMetadata: Resolved symbol ${tokenIdentifier} to address ${tokenAddress}`);
          
          if (!tokenAddress) {
            logger.warn(`Failed to extract address for symbol ${tokenIdentifier}`);
            return {
              error: `Could not resolve symbol ${tokenIdentifier} to an address`
            };
          }
        } else {
          logger.warn(`No results found for symbol ${tokenIdentifier}`);
          return {
            error: `No tokens found for symbol ${tokenIdentifier}`
          };
        }
      } catch (symbolError) {
        logger.error(`Error resolving symbol to address in metadata: ${symbolError.message}`);
        return {
          error: `Error resolving symbol ${tokenIdentifier}: ${symbolError.message}`
        };
      }
    }
    
    // Get token price using the resolved address
    const price = await getTokenPrice(network, tokenAddress);
    
    // Get token holders
    const holders = await getTokenHolders(tokenAddress, network);
    
    // Get token pair address
    const pairAddress = await getTokenPairAddress(network, tokenAddress);
    
    // Get token snipers (if pair address available)
    let snipers = null;
    if (pairAddress && pairAddress.length > 0) {
      snipers = await getTokenSnipers(network, pairAddress[0]);
    }
    
    return {
      price,
      holders,
      pairAddress,
      snipers
    };
  } catch (error) {
    console.error('Error fetching token metadata:', error);
    throw error;
  }
}

/**
 * Fetch token security information
 * This is a placeholder - would integrate with a token security service
 */
async function fetchTokenSecurity(tokenIdentifier, network) {
  try {
    // Placeholder for token security assessment
    return {
      message: 'Token security assessment not implemented yet',
      token: tokenIdentifier,
      network
    };
  } catch (error) {
    console.error('Error fetching token security:', error);
    throw error;
  }
}

/**
 * Fetch token-related tweets
 */
async function fetchTokenTweets(tokenIdentifier) {
  try {
    // If token identifier is a contract address, try to get the symbol
    let symbol = tokenIdentifier;
    
    if (tokenIdentifier.length > 30) {
      // This would get the token symbol from the contract address
      // For now, we'll use a placeholder
      symbol = 'UNKNOWN';
    }
    
    // Search for tweets with the token as cashtag
    const cashtag = `$${symbol}`;
    const tweets = await twitterService.searchTweetsByCashtagAPI(cashtag);
    
    return tweets;
  } catch (error) {
    console.error('Error fetching token tweets:', error);
    throw error;
  }
}

/**
 * Get raw data for a previous search by ID
 */
export async function getSentinelRawData(searchId) {
  const searchData = searchCache.get(searchId);
  
  if (!searchData) {
    throw new Error('Search data not found');
  }
  
  return searchData;
}

/**
 * Save search results with optional notes
 */
export async function saveSentinelResults(searchId, notes = '') {
  const searchData = searchCache.get(searchId);
  
  if (!searchData) {
    throw new Error('Search data not found');
  }
  
  // In a real implementation, this would save to a database
  const savedData = {
    ...searchData,
    notes,
    saved: true,
    savedAt: new Date().toISOString()
  };
  
  // Update cache
  searchCache.set(searchId, savedData);
  
  return {
    message: 'Search results saved successfully',
    id: searchId
  };
}

/**
 * Get the current status of a search by ID
 * This supports the frontend polling mechanism
 */
export async function getSearchStatus(searchId) {
  try {
    // Check if the search exists in cache
    const searchData = searchCache.get(searchId);
    
    if (!searchData) {
      throw new Error('Search data not found');
    }
    
    // In a real production system, this would check an actual job queue or database
    // For now, we'll simulate the search being complete since we're not doing async processing
    
    return {
      id: searchId,
      status: 'complete', // 'processing' or 'complete' or 'error'
      progress: 100,      // 0-100
      toolStatus: {
        tokenInfo: 'complete',
        tokenMetadata: 'complete', 
        securityAnalysis: 'complete',
        socialData: 'complete'
      },
      results: searchData.results // Only included when status is 'complete'
    };
  } catch (error) {
    logger.error(`Error getting search status: ${error.message}`);
    throw error;
  }
}

/**
 * Process voice input using Gemini API
 * @param {string} audioBase64 - Base64 encoded audio data
 * @returns {Object} - Processed voice data including transcribed text
 */
export async function processVoiceInput(audioBase64) {
  try {
    logger.info('Processing voice input with Gemini API');
    
    if (!audioBase64) {
      throw new Error('No audio data provided');
    }
    
    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    
    // Track response chunks for debugging
    let transcribedText = '';
    
    // Process with Gemini audio model
    await geminiService.processAudioStream(
      audioBuffer,
      // Text chunk handler
      (textChunk) => {
        logger.debug(`Received text chunk: ${textChunk}`);
        transcribedText += textChunk;
      },
      // Audio chunk handler (we don't need to handle audio response here)
      null
    );
    
    logger.info(`Voice transcription complete: "${transcribedText}"`);
    
    return {
      success: true,
      text: transcribedText.trim(),
      timestamp: Date.now()
    };
  } catch (error) {
    logger.error(`Error processing voice input: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}
