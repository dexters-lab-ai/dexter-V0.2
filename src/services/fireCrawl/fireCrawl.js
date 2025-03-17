import FirecrawlApp from '@mendable/firecrawl-js';
import { config } from '../../core/config.js';

class NetworkScraper {
  constructor() {
    this.apiKey = config.firecrawlApiKey;
    this.app = new FirecrawlApp({ apiKey: this.apiKey });
    // Fixed list of 10 dexscreener URLs (adjust these URLs as needed)
    this.fixedUrls = [
      'https://dexscreener.com/sonic',
      'https://dexscreener.com/solana',
      'https://dexscreener.com/polygon',
      'https://dexscreener.com/bsc',
      'https://dexscreener.com/avalanche',
      'https://dexscreener.com/ethereum',
      'https://dexscreener.com/arbitrum',
      'https://dexscreener.com/optimism',
      'https://dexscreener.com/berachain',
      'https://dexscreener.com/worldchain'
    ];
  }

  /**
   * Scrape a fixed list of 10 dexscreener URLs for trending tokens.
   * Returns an array of results with markdown and metadata.
   */
  async networkScrap() {
    try {
      const scrapePromises = this.fixedUrls.map(async (url) => {
        const result = await this.app.scrapeUrl(url, 
          {
            "formats":["markdown"],
            "onlyMainContent":true,
            "waitFor":0,
            "mobile":false,
            "skipTlsVerification":false,
            "timeout":30000,
            "location":{"country":"US"},
            "blockAds":true,
            "excludeTags":["script"],
            "removeBase64Images":true,
            "proxy":"stealth"
          });  
        if (result.success) {
          const filtered = extractDescriptionAndContent(result);
          return { url, ...filtered };
        } else {
          return { url, error: result.error };
        }
      });
      const results = await Promise.all(scrapePromises);
      return { success: true, results };
    } catch (error) {
      console.error("Error in networkScrap:", error);
      return { success: false, error: error.message };
    }
  }  

  /**
   * Scrape a provided on Dexscreener and return the trending list content in markdown and HTML.
   * @param {string} url - The network to scrape.
   */
  async trendingNetworkScrap(network) {
    
    const chain = network.toLowerCase();
    let url = `https://dexscreener.com/${chain}`;
    try {
      const rawResult = await this.app.scrapeUrl(url,
        {
          "formats":["markdown"],
          "onlyMainContent":true,
          "waitFor":0,
          "mobile":false,
          "skipTlsVerification":false,
          "timeout":30000,
          "location":{"country":"US"},
          "blockAds":true,
         // "excludeTags":["script"],
         // "removeBase64Images":true,
          "proxy":"basic"
        });  

        const options = {
          method: 'POST',
          headers: {
            Authorization: 'Bearer fc-6001b7ba789342de8e9ad2e6d096dce6',
            'Content-Type': 'application/json'
          },
          body: '{"formats":["markdown"],"onlyMainContent":true,"waitFor":0,"mobile":false,"skipTlsVerification":true,"timeout":30000,"location":{"country":"US"},"blockAds":false,"url":"https://dexscreener.com/sonic","excludeTags":[],"removeBase64Images":false,"proxy":"basic"}'
        };
        
        fetch('https://api.firecrawl.dev/v1/scrape', options)
          .then(response => response.json())
          .then(response => console.log(response))
          .catch(err => console.error(err));
       
      const result = this.extractDescriptionAndContent(rawResult);
      
      console.log("Raw RESULT FROM URL:", rawResult);
      console.log("Filtred RESULT FROM URL:", result);
      
      return { success: true, result };
    } catch (error) {
      console.error("Error in scrapeProvidedUrl:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Scrape a provided URL and return the content in markdown and HTML.
   * @param {string} url - The URL to scrape.
   */
  /**
 * Helper function to sanitize a URL.
 * - Trims whitespace.
 * - Adds "https://" if missing.
 * - Removes "www." from the hostname.
 * - Validates that the hostname contains a dot.
 * @param {string} url - The input URL.
 * @returns {string} The sanitized URL.
 * @throws {Error} If the URL is invalid.
 */
  sanitizeUrl(input) {
    // If input is an object with a 'url' property, use that.
    let url = typeof input === 'string' ? input : input.url;
    if (typeof url !== 'string') {
      throw new Error("No valid URL found in input.");
    }
  
    // Remove leading/trailing whitespace
    url = url.trim();
  
    // If the URL does not start with "http://" or "https://", add "https://"
    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url;
    }
  
    try {
      const parsed = new URL(url);
      // Remove 'www.' prefix if present
      if (parsed.hostname.startsWith('www.')) {
        parsed.hostname = parsed.hostname.slice(4);
      }
      // Ensure the hostname has at least one dot for a valid top-level domain
      if (!parsed.hostname.includes('.')) {
        throw new Error('URL must have a valid top-level domain.');
      }
      return parsed.toString();
    } catch (error) {
      throw new Error(`Invalid URL provided: ${url}`);
    }
  }

  /**
   * Scrape a provided URL and return the content in markdown and HTML formats.
   * Ensures that the URL is sanitized to meet Firecrawl API requirements.
   * @param {string} url - The URL to scrape.
   * @returns {Promise<object>} The result object.
   */
  async scrapeProvidedUrl(url) {
    console.log("Original URL:", url);
    try {
      // Sanitize URL before scraping
      const sanitizedUrl = this.sanitizeUrl(url);
      console.log("Sanitized URL:", sanitizedUrl);

      const rawResult = await this.app.scrapeUrl(sanitizedUrl,
      {
        "formats":["markdown"],
        "onlyMainContent":true,
        "waitFor":0,
        "mobile":false,
        "skipTlsVerification":false,
        "timeout":30000,
        "location":{"country":"US"},
        "blockAds":true,
        "excludeTags":["script"],
        "removeBase64Images":true,
        "proxy":"stealth"
      });    
        
      const result = this.extractDescriptionAndContent(rawResult);
      
      console.log("Raw RESULT FROM URL:", rawResult);
      console.log("Filtred RESULT FROM URL:", result);
      return result;
    } catch (error) {
      console.error("Error in scrapeProvidedUrl:", error);
      return error.message;
    }
  }

  /**
   * Extracts only the crucial fields (description and content) from a FireCrawl result.
   *
   * If firecrawlResult.data exists, use that; otherwise, assume the top-level object holds the fields.
   *
   * @param {object} firecrawlResult - The raw result from FireCrawl.
   * @returns {object|null} An object with the description and content, or null if data is missing.
   */
  extractDescriptionAndContent(firecrawlResult) {
    if (!firecrawlResult || !firecrawlResult.success) {
      return null;
    }
    // Use firecrawlResult.data if it exists, otherwise use firecrawlResult directly
    const data = firecrawlResult.data || firecrawlResult;
    const { markdown, metadata } = data;
    return {
      description: metadata?.description || "",
      content: markdown || ""
    };
  }

}

export const networkScraper = new NetworkScraper();
