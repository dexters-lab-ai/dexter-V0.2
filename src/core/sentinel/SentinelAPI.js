import { dextools, getTokenInfo } from '../../services/dextools/index.js';
import { getTokenPrice, getTokenSnipers, getTokenHolders, getTokenPairAddress } from '../../services/tokens/MoralisTokenService.js';
import { twitterService } from '../../services/twitter/index.js';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { logger } from '../../utils/logger.js';
import { dexscreener } from '../../services/dexscreener/index.js';
import { v4 as uuidv4 } from 'uuid';
import { detectQueryIntent, extractTokens, isContractAddress, isUrl } from './utils/nlpHelper.js';
import { scrapeUrl } from './utils/urlScraper.js';
import { geminiService } from '../../services/ai/geminiService.js';
import { networkScraper } from '../../services/fireCrawl/fireCrawl.js';

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
      .replace('<!-- SENTINEL_JS_PLACEHOLDER -->', `<script type="module">${jsContent}</script>`);
    
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
  const searchId = `search_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

  try {
    // 1. Set initial status in cache for frontend polling
    searchCache.set(searchId, {
      id: searchId,
      query,
      status: 'processing',
      results: {},
      summary: 'AI is analyzing your query...',
      timestamp: new Date().toISOString(),
    });

    // 2. Asynchronously trigger the AI orchestrator. We don't await this.
    // The frontend will poll getSearchStatus for completion.
    handleTextQuery(query, searchId).catch(err => {
      logger.error(`Unhandled exception in handleTextQuery for searchId ${searchId}:`, err);
      // Update cache to reflect the critical failure
      searchCache.set(searchId, {
        id: searchId,
        query,
        status: 'error',
        error: 'A critical error occurred in the AI handler.'
      });
    });

    // 3. Return the searchId immediately to the client.
    return { searchId };

  } catch (error) {
    logger.error(`Critical error during search initiation for query "${query}":`, error);
    // Attempt to update cache with error, though it might fail if searchId wasn't set
    searchCache.set(searchId, {
        id: searchId,
        query,
        status: 'error',
        error: 'Failed to initiate the search process.'
    });
    // Re-throw to be handled by the route controller
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
async function handleTextQuery(query, searchId) {
  logger.info(`[AI] Handling text query for searchId: ${searchId}`);
  const aggregatedResults = {};

  // 1. Define the Tool-Call Handler
  const onToolCall = async (toolName, args) => {
    logger.info(`[AI] Gemini requested tool: ${toolName}`, args);
    switch (toolName) {
      case 'sentinel_search':
        // For sentinel_search, we can reuse handleContractQuery's logic.
        // We'll call it and merge the results.
        const tokenData = await handleContractQuery(args.token, searchId, true);
        Object.assign(aggregatedResults, tokenData);
        return tokenData; // Return result to Gemini

      case 'sentinel_url_analyzer':
        const urlData = await handleUrlQuery(args.url, searchId, true);
        Object.assign(aggregatedResults, urlData);
        return urlData;

      case 'google_search':
        // Implement a simple handler for Google search using our scraper
        try {
          const searchResult = await networkScraper.scrapeUrl(`https://www.google.com/search?q=${encodeURIComponent(args.query)}`);
          const googleResult = { google_search: searchResult.data.content };
          Object.assign(aggregatedResults, googleResult);
          return googleResult;
        } catch (e) {
          logger.error(`[AI] Google Search tool failed: ${e.message}`);
          return { error: e.message };
        }

      default:
        logger.warn(`[AI] Unknown tool requested: ${toolName}`);
        return { error: `Tool ${toolName} not found.` };
    }
  };

  // 2. Call Gemini with Streaming and Tool Handling
  try {
    const finalResponse = await geminiService.streamTextContent(query, [], null, onToolCall);

    // 3. Finalize and Cache Results
    const finalData = {
      id: searchId,
      query,
      status: 'complete',
      results: aggregatedResults,
      summary: finalResponse.text, // The final summary from the AI
      toolCalls: finalResponse.toolCalls
    };

    searchCache.set(searchId, finalData);
    logger.info(`[AI] Search complete and cached for searchId: ${searchId}`);

  } catch (error) {
    logger.error(`[AI] Error in handleTextQuery during Gemini interaction: ${error.message}`);
    searchCache.set(searchId, {
      id: searchId,
      query,
      status: 'error',
      error: 'Failed to process AI query.'
    });
  }
}

async function handleContractQuery(contractAddress, searchId, isAiTriggered = false) {
  const results = {}; // Use a clean object for results
  try {
    logger.debug(`Processing contract query for: ${contractAddress}`);
    const toolPromises = [];

    // Run all tool fetches in parallel for speed
    toolPromises.push(fetchTokenInfo(contractAddress, 'solana').catch(e => ({ error: 'tokenInfo', message: e.message })));
    toolPromises.push(fetchTokenMetadata(contractAddress, 'solana').catch(e => ({ error: 'tokenMetadata', message: e.message })));
    toolPromises.push(fetchTokenSecurity(contractAddress, 'solana').catch(e => ({ error: 'securityAnalysis', message: e.message })));

    const [tokenInfo, tokenMetadata, securityAnalysis] = await Promise.all(toolPromises);

    results.tokenInfo = tokenInfo;
    results.tokenMetadata = tokenMetadata;
    results.securityAnalysis = securityAnalysis;

    // Fetch social data only if we have a valid token symbol
    if (tokenInfo && tokenInfo.symbol) {
      try {
        const symbol = String(tokenInfo.symbol);
        results.socialData = await fetchTokenTweets(symbol).catch(e => ({ error: 'socialData', message: e.message }));
      } catch (e) {
        results.socialData = { error: 'socialData', message: 'Invalid token symbol for social fetch.' };
      }
    }

    // If this is a direct, non-AI call, manage the cache and return the full object.
    if (!isAiTriggered) {
      const finalData = { id: searchId, query: contractAddress, status: 'complete', results };
      searchCache.set(searchId, finalData);
    }

    // Return just the results data. The AI orchestrator will handle the rest.
    return results;

  } catch (error) {
    logger.error(`Error handling contract query: ${error.message}`);
    const errorResult = { error: 'Failed to process contract query.' };

    // If it's a direct call, update the cache with the error status.
    if (!isAiTriggered) {
      searchCache.set(searchId, { id: searchId, query: contractAddress, status: 'error', ...errorResult });
    }
    
    return errorResult;
  }
}

async function handleUrlQuery(url, searchId, isAiTriggered = false) {
  const results = {}; // Clean object for results
  try {
    logger.info(`Scraping URL: ${url}`);
    const scrapedData = await networkScraper.scrapeProvidedUrl(url);

    if (scrapedData && scrapedData.content) {
      results.scrapedContent = scrapedData;
    } else {
      results.error = 'Failed to scrape content from the URL.';
      if (isAiTriggered) {
        return results;
      }
    }

    // If this is a direct, non-AI call, manage the cache and summarize.
    if (!isAiTriggered) {
      if (results.scrapedContent) {
        results.summary = await geminiService.generateContent(`Please summarize the following content: ${results.scrapedContent.content}`);
      }
      const finalData = { id: searchId, query: url, status: 'complete', results };
      searchCache.set(searchId, finalData);
    }

    // Return just the results data. The AI orchestrator will handle the rest.
    return results;

  } catch (error) {
    logger.error(`Error handling URL query: ${error.message}`);
    const errorResult = { error: `Error processing URL: ${error.message}` };

    if (!isAiTriggered) {
      searchCache.set(searchId, { id: searchId, query: url, status: 'error', ...errorResult });
    }

    return errorResult;
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
        
        // Validate that we received an array
        if (!Array.isArray(tokensBySymbol)) {
          logger.error(`DexScreener returned non-array data in fetchTokenMetadata:`, typeof tokensBySymbol);
          return {
            error: `Invalid data structure returned from DexScreener for symbol ${tokenIdentifier}`
          };
        }
        
        logger.debug(`DexScreener returned ${tokensBySymbol.length} results for symbol ${tokenIdentifier}`);
        
        // Filter for Solana tokens only - CRITICAL FIX
        const solanaTokens = tokensBySymbol.filter(token => {
          try {
            const chainId = token.chainId || token.chain || (token.baseToken && token.baseToken.chainId);
            return chainId === 'solana' || chainId === 'sol';
          } catch (filterError) {
            logger.warn(`Error filtering token in fetchTokenMetadata:`, filterError);
            return false;
          }
        });
        
        logger.debug(`Found ${solanaTokens.length} Solana tokens for symbol ${tokenIdentifier}`);
        
        // If Solana results found, use the first Solana result's address
        if (solanaTokens && solanaTokens.length > 0) {
          // Extract the token address from the first Solana result
          const firstSolanaToken = solanaTokens[0];
          tokenAddress = firstSolanaToken.baseToken?.address || firstSolanaToken.tokenAddress || firstSolanaToken.address;
          logger.info(`In fetchTokenMetadata: Resolved symbol ${tokenIdentifier} to Solana address ${tokenAddress}`);
          
          if (!tokenAddress) {
            logger.warn(`Failed to extract Solana address for symbol ${tokenIdentifier}`);
            return {
              error: `Could not extract Solana address from token data for symbol ${tokenIdentifier}`
            };
          }
        } else {
          logger.warn(`No Solana tokens found for symbol ${tokenIdentifier}`);
          return {
            error: `No Solana tokens found for symbol ${tokenIdentifier}. Try using a Solana contract address instead.`
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
 * Generate AI summary of search results
 */
async function generateAISummary(query, results) {
  try {

    
    // Prepare context for AI analysis
    const context = {
      query: query,
      hasTokenInfo: !!results.tokenInfo && !results.tokenInfo.error,
      hasTokenMetadata: !!results.tokenMetadata,
      hasSocialData: !!results.socialData && !results.socialData.error,
      hasSecurityAnalysis: !!results.securityAnalysis
    };
    
    // Build summary data for AI analysis (not full results)
    let summaryData = `User Query: "${query}"\n\n`;
    
    if (context.hasTokenMetadata) {
      const { holders, price } = results.tokenMetadata;
      if (holders && price?.data) {
        summaryData += `Token: ${holders.tokenName} (${holders.tokenSymbol})\n`;
        summaryData += `Price: $${price.data.usdPrice || holders.currentUsdPrice}\n`;
        summaryData += `24h Change: ${price.data.usdPrice24hrPercentChange || holders.pricePercentChange?.['24h']}%\n`;
        summaryData += `Holders: ${holders.totalHolders}\n`;
        summaryData += `Market Cap: $${holders.marketCap}\n\n`;
      }
    }
    
    if (context.hasSocialData && results.socialData.tweets?.length > 0) {
      summaryData += `Social Activity: Found ${results.socialData.tweets.length} recent tweets\n`;
      const sentiments = results.socialData.tweets.map(t => t.sentiment).filter(s => s && s !== 'NA');
      if (sentiments.length > 0) {
        const sentimentCounts = sentiments.reduce((acc, s) => {
          acc[s] = (acc[s] || 0) + 1;
          return acc;
        }, {});
        summaryData += `Sentiment Analysis: ${JSON.stringify(sentimentCounts)}\n\n`;
      }
    }
    
    if (context.hasSecurityAnalysis) {
      summaryData += `Security Analysis: Available\n\n`;
    }
    
    // AI prompt for analysis
    const prompt = `You are SENTINEL AI, an expert DeFi analyst. Analyze the following token data and provide a concise, insightful summary for a crypto investor.

${summaryData}

Provide a brief analysis covering:
1. Token overview and key metrics
2. Price performance and trends
3. Social sentiment (if available)
4. Investment considerations or risks
5. Overall verdict/recommendation

Keep your response under 300 words and focus on actionable insights.`;
    
    const aiResponse = await geminiService.generateText(prompt);
    
    return {
      summary: aiResponse,
      context: context,
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    logger.error('Error generating AI summary:', error);
    throw error;
  }
}

/**
 * Fetch token-related tweets
 */
async function fetchTokenTweets(tokenIdentifier) {
  try {
    // Validate that tokenIdentifier is a string or convert it
    if (tokenIdentifier === null || tokenIdentifier === undefined) {
      throw new Error('Token identifier is null or undefined');
    }
    
    // Ensure tokenIdentifier is a string
    const symbolStr = String(tokenIdentifier).trim();
    if (symbolStr === '') {
      throw new Error('Token identifier is empty');
    }
    
    logger.info(`Fetching tweets for token: ${symbolStr}`);
    
    let symbol = symbolStr;
    
    // If this is a contract address, try to get the symbol first
    if (isContractAddress(symbolStr)) {
      try {
        const contractInfo = await dexService.getEvmTokenInfo(symbolStr);
        if (contractInfo && contractInfo.symbol) {
          symbol = String(contractInfo.symbol);
          logger.info(`Resolved contract to symbol: ${symbol}`);
        }
      } catch (error) {
        logger.warn(`Could not resolve contract address to symbol: ${error.message}`);
        // Continue with the original identifier
      }
    }
    
    // Search for tweets with multiple approaches
    const searchTerms = [];
    
    // Add cashtag version
    if (!symbol.startsWith('$')) {
      searchTerms.push(`$${symbol}`);
    } else {
      searchTerms.push(symbol);
    }
    
    // Add hashtag version
    const hashtagVersion = symbol.startsWith('$') ? `#${symbol.slice(1)}` : `#${symbol}`;
    searchTerms.push(hashtagVersion);
    
    // Add plain symbol
    const plainSymbol = symbol.startsWith('$') ? symbol.slice(1) : symbol;
    searchTerms.push(plainSymbol);
    
    // Try searching with the primary cashtag first
    const primaryTerm = searchTerms[0];
    logger.info(`Searching for tweets with term: ${primaryTerm}`);
    
    const tweets = await twitterService.searchTweetsByCashtagAPI(primaryTerm);
    
    return {
      searchTerm: primaryTerm,
      alternativeTerms: searchTerms.slice(1),
      tweets: tweets || [],
      tokenSymbol: plainSymbol
    };
  } catch (error) {
    logger.error('Error fetching token tweets:', error);
    
    // Return a clean error message for the frontend instead of throwing
    let cleanErrorMessage = 'Unable to fetch social data';
    
    if (error.message.includes('Actor with this name was not found')) {
      cleanErrorMessage = 'Twitter data service temporarily unavailable';
    } else if (error.message.includes('rate limit')) {
      cleanErrorMessage = 'Twitter API rate limit reached. Please try again later';
    } else if (error.message.includes('network') || error.message.includes('timeout')) {
      cleanErrorMessage = 'Network error while fetching social data';
    }
    
    return {
      error: true,
      message: cleanErrorMessage,
      searchTerm: symbol,
      tweets: [],
      tokenSymbol: symbol
    };
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
    const searchData = searchCache.get(searchId);

    if (!searchData) {
      // If no search data is found after a reasonable time, it's an error.
      return {
        id: searchId,
        status: 'error',
        error: 'Search process not found or timed out. Please try again.',
      };
    }

    // The cache now holds the complete, real-time status.
    // Simply return the cached data.
    return searchData;

  } catch (error) {
    logger.error(`Critical error in getSearchStatus for searchId ${searchId}:`, error);
    return {
      id: searchId,
      status: 'error',
      error: 'A server error occurred while fetching search status.',
    };
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
