import axios from 'axios';
import { config } from '../../core/config.js';
import { ErrorHandler } from '../../core/errors/index.js';

class BraveSearchService {
  constructor() {
    this.axios = axios.create({
      baseURL: 'https://api.search.brave.com/res/v1',
      headers: {
        'X-Subscription-Token': config.braveApiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip'
      },
      timeout: 8000, // 8s timeout to prevent hanging requests
    });

    this.maxRetries = 3; // Number of retries on failure
  }

  /**
   * Perform a search query using Brave Search API with automatic retries.
   * @param {string} query - The search term.
   * @returns {Promise<Object>} - Object with `news`, `video`, `relatedTopics`.
   */
  async search(query) {
    if (!query || typeof query !== 'string') {
      return { error: 'Invalid query. Must be a non-empty string.' };
    }

    console.log(`🔍 Querying Brave Search API: "${query}"`);

    return this._retryRequest(() => this._fetchSearchResults(query));
  }

  /**
   * Fetches search results from Brave API.
   * @param {string} query - The search term.
   * @returns {Promise<Object>} - Formatted results.
   */
  async _fetchSearchResults(query) {
    try {
      const response = await this.axios.get('/web/search', { params: { q: query } });
      const data = response.data || {};

      if (!data.web && !data.videos) {
        console.warn('⚠️ No search results found.');
        return { message: 'No relevant search results found.' };
      }

      // Extracting first available news article
      const newsResult = data.web?.results?.[0] || null;
      const formattedNews = newsResult
        ? {
            title: newsResult.title || 'No title available',
            description: newsResult.description || 'No description available',
            url: newsResult.url || 'No URL available'
          }
        : null;

      // Extracting first available video result
      const videoResult = data.videos?.results?.[0] || null;
      const formattedVideo = videoResult
        ? {
            title: videoResult.title || 'No title available',
            description: videoResult.description || 'No description available',
            url: videoResult.url || 'No URL available'
          }
        : null;

      // Extracting related searches (if any)
      const relatedTopics = data.relatedSearches?.map(topic => topic.text) || [];

      console.log('✅ Search completed successfully.');
      return { news: formattedNews, video: formattedVideo, relatedTopics };
    } catch (error) {
      return this._handleError(error);
    }
  }

  /**
   * Retries a failed API request up to `maxRetries` times.
   * Uses **exponential backoff** to avoid overwhelming the API.
   * @param {Function} requestFn - The function that makes the request.
   * @returns {Promise<Object>} - The result of the API call.
   */
  async _retryRequest(requestFn) {
    let attempt = 0;
    while (attempt < this.maxRetries) {
      try {
        return await requestFn();
      } catch (error) {
        attempt++;
        const waitTime = 500 * (2 ** attempt); // Exponential backoff (500ms, 1000ms, 2000ms)
        console.warn(`⚠️ Retry attempt ${attempt}/${this.maxRetries} failed. Retrying in ${waitTime}ms...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    console.error(`❌ All ${this.maxRetries} retries failed.`);
    return { error: 'Failed to retrieve search results after multiple attempts. Please try again later.' };
  }

  /**
   * Handles all possible request errors and prevents crashes.
   * @param {Object} error - Axios or network error.
   * @returns {Object} - Formatted error message.
   */
  _handleError(error) {
    let errorMessage = 'Unknown error occurred. Please try again.';

    if (axios.isAxiosError(error)) {
      if (error.response) {
        console.error('❌ API Response Error:', JSON.stringify(error.response.data, null, 2));
        errorMessage = `Brave API responded with an error: ${error.response.status} ${error.response.statusText}`;
      } else if (error.request) {
        console.error('❌ No response received from Brave API.');
        errorMessage = 'Brave API did not respond. Please check your network.';
      } else {
        console.error('❌ Request setup error:', error.message);
        errorMessage = `Request error: ${error.message}`;
      }
    } else {
      console.error('❌ Non-Axios error occurred:', error.message);
    }

    ErrorHandler.handle(error);
    return { error: errorMessage };
  }
}

export const braveSearch = new BraveSearchService();
