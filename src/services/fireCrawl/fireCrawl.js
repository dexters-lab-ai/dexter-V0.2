import FirecrawlApp from '@mendable/firecrawl-js';
import { config } from '../../core/config.js';

class TrendingNetworkScraper {
  constructor() {
    this.apiKey = config.firecrawlApiKey;
    this.app = new FirecrawlApp({ apiKey: this.apiKey });
    // Fixed list of 10 dexscreener URLs (adjust these URLs as needed)
    this.fixedUrls = [
      'https://www.dexscreener.com/solana',
      'https://www.dexscreener.com/ethereum',
      'https://www.dexscreener.com/polygon',
      'https://www.dexscreener.com/bsc',
      'https://www.dexscreener.com/avalanche',
      'https://www.dexscreener.com/fantom',
      'https://www.dexscreener.com/arbitrum',
      'https://www.dexscreener.com/optimism',
      'https://www.dexscreener.com/celo',
      'https://www.dexscreener.com/worldchain'
    ];
  }

  /**
   * Scrape a fixed list of 10 dexscreener URLs for trending tokens.
   * Returns an array of results with markdown and metadata.
   */
  async trendingNetworkScrap() {
    try {
      const scrapePromises = this.fixedUrls.map(async (url) => {
        const result = await this.app.scrapeUrl(url, { formats: ['markdown'] });
        if (result.success) {
          return { url, markdown: result.data.markdown, metadata: result.data.metadata };
        } else {
          return { url, error: result.error };
        }
      });
      const results = await Promise.all(scrapePromises);
      return { success: true, results };
    } catch (error) {
      console.error("Error in trendingNetworkScrap:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Scrape a provided URL and return the content in markdown and HTML.
   * @param {string} url - The URL to scrape.
   */
  async scrapeProvidedUrl(url) {
    try {
      const result = await this.app.scrapeUrl(url, { formats: ['markdown', 'html'] });
      if (result.success) {
        return { success: true, data: result.data };
      } else {
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error("Error in scrapeProvidedUrl:", error);
      return { success: false, error: error.message };
    }
  }
}

export const trendingNetworkScraper = new TrendingNetworkScraper();
