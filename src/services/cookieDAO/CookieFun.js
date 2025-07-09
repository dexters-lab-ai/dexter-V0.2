import axios from 'axios';
import { config } from '../../core/config.js';
import CookieCache from '../../models/Cookie.js';
import logger from './logger.js'; 

// Cache durations in milliseconds.
const FIVE_MINUTES = 5 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

class CookieFun {
  constructor() {
    if (CookieFun.instance) {
      return CookieFun.instance;
    }

    // Set the base URL and headers. If an API key is provided, include it.
    const headers = {};
    if (config.cookieFunAPIKey) {
      headers['x-api-key'] = config.cookieFunAPIKey;
    }

    // Create an axios instance for our API.
    this.axiosInstance = axios.create({
      baseURL: 'https://api.cookie.fun',
      headers,
      timeout: 60000, // 1 min timeout
    });

    // Set up an in-memory cache: Map<cacheKey, { data, timestamp }>
    this.cache = new Map();

    CookieFun.instance = this;
    return this;
  }

  /**
   * Returns the singleton instance of the CookieFun API client.
   * @returns {CookieFun}
   */
  static getInstance() {
    if (!CookieFun.instance) {
      CookieFun.instance = new CookieFun();
    }
    return CookieFun.instance;
  }

  /**
   * Internal helper to fetch data with exponential backoff on 429 errors.
   * @param {Function} fetchFn - An async function that performs the axios request.
   * @param {number} [maxRetries=3] - Maximum number of retries.
   * @returns {Promise<Object>} The fetched data.
   */
  async _fetchWithRetries(fetchFn, maxRetries = 3) {
    let attempt = 0;
    let delay = 1000; // Start with a 1-second delay
    while (attempt < maxRetries) {
      try {
        const response = await fetchFn();
        return response;
      } catch (error) {
        if (error.response && error.response.status === 429) {
          logger.warn(`Rate limit hit. Retrying in ${delay} ms... (attempt ${attempt + 1})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
          attempt++;
        } else {
          throw error;
        }
      }
    }
    throw new Error("Max retries reached while fetching data from Cookie.fun API");
  }

  /**
   * Generic caching wrapper that uses in-memory caching (5 minutes) and persistent caching (per day).
   * For persistent caching, if no document exists for the current day (based on the date key),
   * a new document is created.
   *
   * @param {string} endpointName - A unique name for the endpoint (e.g., "getAgentByTwitterUsername").
   * @param {string} queryKey - Unique key for the query (e.g., "cookiedotfun__7Days").
   * @param {Function} fetchFunction - Async function that performs the API call and returns data.
   * @returns {Promise<Object>} The fetched data.
   */
  async _getCached(endpointName, queryKey, fetchFunction) {
    const now = Date.now();

    // Check in-memory cache first.
    const cacheEntry = this.cache.get(queryKey);
    if (cacheEntry && (now - cacheEntry.timestamp) < FIVE_MINUTES) {
      logger.info(`Returning in-memory cached result for key: ${queryKey}`);
      return cacheEntry.data;
    }

    // Not in cache or stale: fetch new data (with retries on rate limiting)
    const data = await this._fetchWithRetries(fetchFunction);

    // Update in-memory cache.
    this.cache.set(queryKey, { data, timestamp: now });
    logger.info(`Updated in-memory cache for key: ${queryKey}`);

    // Update persistent cache in MongoDB:
    // Use today's date (YYYY-MM-DD) as part of the persistent key.
    const today = new Date().toISOString().slice(0, 10); // e.g., "2025-02-06"
    const persistentKey = `${queryKey}__${today}`;
    try {
      const existing = await CookieCache.findOne({ endpoint: endpointName, queryKey: persistentKey });
      if (!existing) {
        // Create a new persistent document if none exists.
        await CookieCache.create({
          endpoint: endpointName,
          queryKey: persistentKey,
          data,
          createdAt: new Date()
        });
        logger.info(`Created persistent cache document for key: ${persistentKey}`);
      }
      // If a document already exists for today, we do nothing to preserve the first snapshot.
    } catch (dbError) {
      logger.error(`Persistent cache error for key ${persistentKey}: ${dbError.message}`);
    }

    return data;
  }

  /**
   * Get agent details by Twitter username.
   * @param {string} twitterUsername - Twitter username (case-insensitive).
   * @param {string} [interval='_7Days'] - Interval (e.g., "_3Days" or "_7Days").
   * @returns {Promise<Object>}
   */
  async getAgentByTwitterUsername(twitterUsername, interval = '_7Days') {
    const endpointName = "getAgentByTwitterUsername";
    const queryKey = `${twitterUsername.toLowerCase()}__${interval}`;
    return this._getCached(endpointName, queryKey, async () => {
      const response = await this.axiosInstance.get(
        `/v2/agents/twitterUsername/${encodeURIComponent(twitterUsername)}`,
        { params: { interval } }
      );
      return response.data;
    });
  }

  /**
   * Get agent details by contract address.
   * @param {string} contractAddress - Contract address (case-insensitive).
   * @param {string} [interval='_3Days'] - Interval (e.g., "_3Days" or "_7Days").
   * @returns {Promise<Object>}
   */
  async getAgentByContractAddress(contractAddress, interval = '_7Days') {
    const endpointName = "getAgentByContractAddress";
    const queryKey = `${contractAddress.toLowerCase()}__${interval}`;
    return this._getCached(endpointName, queryKey, async () => {
      const response = await this.axiosInstance.get(
        `/v2/agents/contractAddress/${encodeURIComponent(contractAddress)}`,
        { params: { interval } }
      );
      return response.data;
    });
  }

  /**
   * Get a paged list of agents.
   * @param {string} [interval='_7Days'] - Interval.
   * @param {number} [page=1] - Page number (starting at 1).
   * @param {number} [pageSize=25] - Number of agents per page.
   * @returns {Promise<Object>}
   */
  async getAgentsPaged(interval = '_7Days', page = 1, pageSize = 10) {
    const endpointName = "getAgentsPaged";
    const queryKey = `${interval}__${page}__${pageSize}`;
    return this._getCached(endpointName, queryKey, async () => {
      const response = await this.axiosInstance.get('/v2/agents/agentsPaged', {
        params: { interval, page, pageSize }
      });
      return response.data;
    });
  }

  /**
   * Search tweets by query and a dynamic date range covering the last 7 days.
   * @param {string} searchQuery - The search term.
   * @param {string} [from=null] - Optional override for start date (YYYY-MM-DD). If null, calculated as 7 days ago.
   * @param {string} [to=null] - Optional override for end date (YYYY-MM-DD). If null, calculated as today.
   * @returns {Promise<Object>}
   */
  async searchTweets(searchQuery, from = null, to = null) {
    // Dynamically calculate date range if not provided.
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fromDate = from || sevenDaysAgo.toISOString().slice(0, 10); // e.g., "2025-02-01"
    const toDate = to || now.toISOString().slice(0, 10);              // e.g., "2025-02-08"

    const endpointName = "searchTweets";
    const queryKey = `${searchQuery.toLowerCase()}__${fromDate}__${toDate}`;
    return this._getCached(endpointName, queryKey, async () => {
      const response = await this.axiosInstance.get(
        `/v1/hackathon/search/${encodeURIComponent(searchQuery)}`,
        { params: { from: fromDate, to: toDate } }
      );
      return response.data;
    });
  }

  /**
   * Get sentiment shift data for a given symbol, cashtag, or token address.
   * This method aggregates data from multiple endpoints:
   *   - getAgentsPaged (25 results)
   *   - searchTweets (last 7 days)
   *   - getAgentByContractAddress
   *   - getAgentByTwitterUsername
   *
   * It returns an object containing:
   *   - current: the current (in-memory or freshly fetched) results.
   *   - persistent: the persistent snapshot from MongoDB for the last 7 days period.
   *
   * @param {string} queryStr - The symbol, cashtag, or token address.
   * @param {string} [interval='_7Days'] - Interval for agent endpoints.
   * @returns {Promise<Object>}
   */
  async checkSentimentShift(queryStr, interval = '_7Days') {
    // Dynamically compute the date range for the last 7 days.
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const fromDate = sevenDaysAgo.toISOString().slice(0, 10);
    const toDate = now.toISOString().slice(0, 10);

    const currentResults = {
      agentsPaged: await this.getAgentsPaged(interval, 1, 5),
      searchTweets: await this.searchTweets(queryStr, fromDate, toDate),
      agentByContract: await this.getAgentByContractAddress(queryStr, interval),
      agentByTwitter: await this.getAgentByTwitterUsername(queryStr, interval),
    };

    // For persistent cache, use the same date range. We'll use the "to" date as key.
    const dateKey = toDate; // This represents "today"
    const fetchPersistent = async (endpointName, baseKey) => {
      const persistentKey = `${baseKey}__${dateKey}`;
      try {
        const doc = await CookieCache.findOne({ endpoint: endpointName, queryKey: persistentKey });
        return doc ? doc.data : null;
      } catch (error) {
        logger.error(`Error fetching persistent cache for key ${persistentKey}: ${error.message}`);
        return null;
      }
    };

    const persistentResults = {
      agentsPaged: await fetchPersistent("getAgentsPaged", `${interval}__1__25`),
      searchTweets: await fetchPersistent("searchTweets", `${queryStr.toLowerCase()}__${fromDate}__${toDate}`),
      agentByContract: await fetchPersistent("getAgentByContractAddress", `${queryStr.toLowerCase()}__${interval}`),
      agentByTwitter: await fetchPersistent("getAgentByTwitterUsername", `${queryStr.toLowerCase()}__${interval}`),
    };

    return {
      current: currentResults,
      persistent: persistentResults,
    };
  }

  /**
   * Check API key authorization and quota status.
   * @returns {Promise<Object>}
   */
  async checkAuthorization() {
    const endpointName = "checkAuthorization";
    const queryKey = "authorization";
    return this._getCached(endpointName, queryKey, async () => {
      const response = await this.axiosInstance.get('/authorization');
      return response.data;
    });
  }
}

export default CookieFun.getInstance();
