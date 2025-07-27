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

// Path handling for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Search cache to store results (simple in-memory storage for demo)
const searchCache = new Map();

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
    // For token symbol, need to find contract address first
    let tokenAddress = tokenIdentifier;
    let symbol = null;
    
    // If token identifier is not a contract address, try to search for it using symbol
    if (tokenIdentifier.length < 30) {
      logger.debug(`Token identifier appears to be a symbol: ${tokenIdentifier}`);
      symbol = tokenIdentifier;
      
      // Use the dexscreener singleton service to resolve the symbol to address
      
      try {
        // Search for token by symbol
        const tokensBySymbol = await dexscreener.getTokenInfoBySymbol(tokenIdentifier);
        logger.debug(`DexScreener returned ${tokensBySymbol.length} results for symbol ${tokenIdentifier}`);
        
        // Filter for Solana tokens only
        const solanaTokens = tokensBySymbol.filter(token => token.chainId === 'solana' || (token.baseToken && token.baseToken.chainId === 'solana'));
        logger.debug(`Found ${solanaTokens.length} Solana tokens for symbol ${tokenIdentifier}`);
        
        // If Solana results found, use the first Solana result's address
        if (solanaTokens && solanaTokens.length > 0) {
          // Extract the token address from the first Solana result
          tokenAddress = solanaTokens[0].baseToken?.address;
          logger.info(`Resolved symbol ${tokenIdentifier} to Solana address ${tokenAddress}`);
          
          if (!tokenAddress) {
            logger.warn(`Failed to extract Solana address for symbol ${tokenIdentifier}`);
            return {
              message: `Could not resolve symbol ${tokenIdentifier} to a Solana address`,
              symbol: tokenIdentifier
            };
          }
        } else {
          logger.warn(`No results found for symbol ${tokenIdentifier}`);
          return {
            message: `No tokens found for symbol ${tokenIdentifier}`,
            symbol: tokenIdentifier
          };
        }
      } catch (symbolError) {
        logger.error(`Error resolving symbol to address: ${symbolError.message}`);
        return {
          message: `Error resolving symbol ${tokenIdentifier}: ${symbolError.message}`,
          symbol: tokenIdentifier,
          error: symbolError.message
        };
      }
    }
    
    // Get token info from DexTools
    const tokenInfo = await dextools.getTokenInfo(network, tokenAddress);
    
    // If we started with a symbol, add it to the result
    if (symbol) {
      tokenInfo.originalSymbol = symbol;
    }
    
    return tokenInfo;
  } catch (error) {
    console.error('Error fetching token info:', error);
    throw error;
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
