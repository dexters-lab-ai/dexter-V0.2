// src/services/dexscreener/index.js
import axios from 'axios';
import { cacheService } from '../cache/CacheService.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { rateLimiter } from '../../core/rate-limiting/RateLimiter.js';

const BASE_URL = 'https://api.dexscreener.com';
const CACHE_DURATION = 600000; // 1 hour
const RATE_LIMIT = {
  windowMs: 60000,
  maxRequests: 60
};

class DexScreenerService {
  constructor() {
    this.api = axios.create({
      baseURL: BASE_URL,
      timeout: 30000,
      headers: {
        'Accept': 'application/json'
      }
    });
    
    // Add response interceptor for error handling
    this.api.interceptors.response.use(
      response => response,
      error => this.handleApiError(error)
    );
  }

  async fetchWithCache(endpoint, params = {}, cacheKey) {
    // Check rate limits first
    const isLimited = await rateLimiter.isRateLimited('dexscreener', endpoint);
    if (isLimited) {
      throw new Error('Rate limit exceeded');
    }

    // Check cache
    const cached = await cacheService.get(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.api.get(endpoint, { params });
      const data = response.data;

      // Cache valid responses
      await cacheService.set(cacheKey, data, CACHE_DURATION);
      return data;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // Proper endpoint implementations based on docs
  async getPairsByChainAndPair(chainId, pairId) {
    return this.fetchWithCache(
      `/pairs/${chainId}/${pairId}`,
      {},
      `dexscreener:pairs:${chainId}:${pairId}`
    );
  }

  async searchPairs(query) {
    return this.fetchWithCache(
      `/search/pairs`,
      { query },
      `dexscreener:search:${query}`
    );
  }

  async getTokenPairs(tokenAddresses) {
    if (!Array.isArray(tokenAddresses)) {
      tokenAddresses = [tokenAddresses];
    }
    return this.fetchWithCache(
      `/tokens/${tokenAddresses.join(',')}`,
      {},
      `dexscreener:tokens:${tokenAddresses.join('-')}`
    );
  }

  // Improved error handling
  async handleApiError(error) {
    const errorData = {
      status: error.response?.status,
      message: error.response?.data?.error || error.message,
      endpoint: error.config?.url
    };

    // Log error
    console.error('DexScreener API error:', errorData);

    // Handle specific error cases
    switch (errorData.status) {
      case 429:
        throw new Error('DexScreener rate limit exceeded');
      case 404:
        throw new Error('Pair or token not found');
      default:
        throw new Error(`DexScreener API error: ${errorData.message}`);
    }
  }

  // Proper result formatting
  formatPairData(pair) {
    if (!pair) return null;
  
    // Extract socials (Twitter and Telegram only)
    const socials = (pair.info?.socials || []).reduce((acc, social) => {
      if (social.type === "twitter") acc.twitter = social.url;
      if (social.type === "telegram") acc.telegram = social.url;
      return acc;
    }, {});
  
    // Extract website
    const website = (pair.info?.websites || []).find(site => site.label === "Website")?.url;
  
    // Format creation date
    const createdAt = pair.pairCreatedAt
      ? new Date(pair.pairCreatedAt).toLocaleString()
      : "Unknown";
  
    // Safely extract buys and sells for the last 24 hours
    const buys24h = pair.txns?.h24?.buys || 0;
    const sells24h = pair.txns?.h24?.sells || 0;
  
    // Safely access liquidity metrics
    const liquidityUsd = pair.liquidity?.usd || 0;
    const liquidityBase = pair.liquidity?.base || 0;
    const liquidityQuote = pair.liquidity?.quote || 0;
  
    // Safely access price metrics
    const priceUsd = pair.priceUsd || "N/A";
    const priceChange = pair.priceChange || {};
  
    // Safely access market metrics
    const marketCap = pair.marketCap || "N/A";
    const fdv = pair.fdv || "N/A";
  
    // Extract images
    const imageUrl = pair.info?.imageUrl || null;
    const headerImage = pair.info?.header || null;
  
    return {
      chainId: pair.chainId,
      dexId: pair.dexId,
      pairAddress: pair.pairAddress,
      baseToken: {
        address: pair.baseToken.address,
        name: pair.baseToken.name,
        symbol: pair.baseToken.symbol,
      },
      price: {
        usd: priceUsd,
        change: priceChange,
      },
      marketMetrics: {
        marketCap: marketCap,
        fdv: fdv,
      },
      liquidity: {
        usd: liquidityUsd,
        base: liquidityBase,
        quote: liquidityQuote,
      },
      volume: {
        h24: pair.volume?.h24 || 0,
      },
      transactions: {
        buys24h: buys24h,
        sells24h: sells24h,
      },
      socials: {
        twitter: socials.twitter || null,
        telegram: socials.telegram || null,
      },
      website: website || null,
      images: {
        thumbnail: imageUrl,
        header: headerImage,
      },
      pairUrl: pair.url,
      pairCreatedAt: createdAt,
    };
  }

  formatBoostedData(pair) {
    const { 
      url, 
      tokenAddress, 
      description = "No description available.", 
      links = [], 
      totalAmount, 
      amount 
    } = pair;
  
    // Extract key links
    const website = links.find((link) => link.type === "website")?.url || null;
    const twitter = links.find((link) => link.type === "twitter")?.url || null;
    const telegram = links.find((link) => link.type === "telegram")?.url || null;
  
    // Truncate description to 32 characters
    const truncatedDescription = description.length > 32 
      ? description.slice(0, 32).trim() + "..." 
      : description;
  
    // Extract symbol using regex or fallback to "SYMBOL"
    const symbol = this.extractSymbol(description);
  
    // Return formatted pair data without unnecessary fields
    return {
      url,
      tokenAddress,
      description: truncatedDescription,
      symbol,
      links: {
        website,
        twitter,
        telegram,
      },
      totalAmount: totalAmount || 0,
      amount: amount || 0,
    };
  }  
  
  // Helper to extract symbol
  extractSymbol(description) {
    const cashtagMatch = description.match(/\$[A-Za-z0-9]+/); // Look for $CASHTAG
    if (cashtagMatch) return cashtagMatch[0].slice(1); // Remove the "$"
  
    const hashtagMatch = description.match(/#[A-Za-z0-9]+/); // Look for #HASHTAG
    if (hashtagMatch) return hashtagMatch[0].slice(1); // Remove the "#"
  
    const capsMatch = description.match(/\b[A-Z]{2,}\b/); // Look for ALL CAPS words
    if (capsMatch) return capsMatch[0]; // Return the first all-caps word
  
    return "SYMBOL"; // Fallback if no matches found
  }
  
  // More Queries
  async getTokenInfoBySymbol(query) {
    try{
      const rawResponse = await this.fetchWithCache(
        `/latest/dex/search?q=${query}`,
        {},
        `dexscreener:tokenInfo:${query}`
      );

      console.log(rawResponse);
    
      // Format each pair in the response
      const formattedPairs = rawResponse.pairs?.map(this.formatPairData) || [];
    
      // If no pairs, return empty array
      if (!formattedPairs.length) return [];
    
      // Select the "main" LP based on the highest liquidity or other metric
      const mainPair = formattedPairs.reduce((best, current) => {
        return current.liquidity.usd > (best?.liquidity.usd || 0) ? current : best;
      }, null);
    
      return mainPair ? [mainPair] : [];
    } catch {
      return {baseToken:{symbol:"NONE"}}
    }
    
  }  
  
  async getTokenInfoByAddress(query) {
    try {
      const rawResponse = await this.fetchWithCache(
        `/latest/dex/search?q=${query}`,
        {},
        `dexscreener:tokenInfo:${query}`
      );
    
      // Format each pair in the response
      const formattedPairs = rawResponse.pairs?.map(this.formatPairData) || [];      
  
      console.log('Dexscreener Token Info by address:', JSON.stringify(rawResponse, null, 2));
    
      // If no pairs, return empty array
      if (!formattedPairs.length) return [];
    
      // Select the "main" LP based on the highest liquidity
      const mainPair = formattedPairs.reduce((best, current) => {
        return current.liquidity.usd > (best?.liquidity.usd || 0) ? current : best;
      }, null);
    
      return mainPair ? [mainPair] : [];
    } catch {
      return {baseToken:{symbol:"NONE"}}
    }
  }

  async getTokenInfoByAddressBig(query) {
    try {
      const rawResponse = await this.fetchWithCache(
        `/latest/dex/search?q=${query}`,
        {},
        `dexscreener:tokenInfo:${query}`
      );
    
      // Format each pair in the response
      const formattedPairs = rawResponse.pairs?.map(this.formatPairData) || [];      
  
      console.log('Dexscreener Token Info by address:', JSON.stringify(rawResponse, null, 2));
    
      // If no pairs, return empty array
      if (!formattedPairs.length) return [];
    
      // Select the "main" LP based on the highest liquidity
      const mainPair = formattedPairs.reduce((best, current) => {
        return current.liquidity.usd > (best?.liquidity.usd || 0) ? current : best;
      }, null);
    
      return rawResponse || {};
    } catch {
      return {baseToken:{symbol:"NONE"}}
    }
  }

  async getTokenPriceByAddress(query) {
    try {
      const rawResponse = await this.fetchWithCache(
        `/latest/dex/search?q=${query}`,
        {},
        `dexscreener:tokenInfo:${query}`
      );
    
      //console.log('Dexscreener Token Price by address:', JSON.stringify(rawResponse, null, 2));
      
      if (rawResponse?.pairs?.length > 0) {
        const tokenData = rawResponse.pairs[0];
        const priceUsd = parseFloat(tokenData.priceUsd);
        console.log('==== PRICE USD ====:', JSON.stringify(priceUsd, null, 2));
        if (!isNaN(priceUsd) && priceUsd > 0) {
          console.log(`✅ Found price on DexScreener for ${query}: $${priceUsd}`);
          return priceUsd;
        }
      }
    } catch (error) {
      console.error('Error fetching token price:', error);
      return 0;
    }
  }  

  async getBoostedPairs() {
    try {
        // Fetch the latest boosted pairs data with caching
        const rawResponse = await this.fetchWithCache(
            '/token-boosts/latest/v1',
            {},
            'dexscreener:boosted'
        );

        //console.log('Boosted token data:', JSON.stringify(rawResponse, null, 2));

        // Ensure rawResponse is an array
        if (!Array.isArray(rawResponse)) {
            console.warn("'Boosted token data' is not an array.");
            return [];
        }

        // Format each boosted pair using the updated formatBoostedData function
        const formattedPairs = rawResponse.map((item) => {
            try {
                const formatted = this.formatBoostedData(item);
                //console.log("Formatted pair:", formatted);
                return formatted;
            } catch (error) {
                console.error("Error formatting pair:", item, error);
                return null; // Skip this pair if formatting fails
            }
        }).filter(Boolean); // Remove any null entries
        
        // Check if there are any valid formatted pairs
        if (formattedPairs.length === 0) {
            console.warn("No valid formatted pairs found after processing.");
            return [];
        }

        // Deduplicate based on tokenAddress
        const uniquePairsMap = new Map();
        formattedPairs.forEach(pair => {
            if (!uniquePairsMap.has(pair.tokenAddress)) {
                uniquePairsMap.set(pair.tokenAddress, pair);
            }
        });
        const uniquePairs = Array.from(uniquePairsMap.values());

        if (uniquePairs.length === 0) {
            console.warn("No unique formatted pairs found after deduplication.");
            return [];
        }

        // Return all unique formatted pairs
        return uniquePairs;
    } catch (error) {
        console.error("Error in getBoostedPairs:", error);
        return [];
    }
  }   
  
  async getPairsByToken(tokenAddresses) {
    if (!Array.isArray(tokenAddresses)) {
      tokenAddresses = [tokenAddresses];
    }
  
    const rawResponse = await this.fetchWithCache(
      `/dex/tokens/${tokenAddresses.join(',')}`,
      {},
      `dexscreener:tokens:${tokenAddresses.join('-')}`
    );
  
    // Format each pair in the response
    const formattedPairs = rawResponse.pairs?.map(this.formatPairData) || [];
  
    // If no pairs, return empty array
    if (!formattedPairs.length) return [];
  
    // Select the "main" LP based on the highest liquidity
    const mainPair = formattedPairs.reduce((best, current) => {
      return current.liquidity.usd > (best?.liquidity.usd || 0) ? current : best;
    }, null);
  
    return mainPair ? [mainPair] : [];
  }  

}

export const dexscreener = new DexScreenerService();
