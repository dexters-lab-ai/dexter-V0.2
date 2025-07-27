/**
 * URL Scraper Utility for SENTINEL API
 * Extracts crypto-related content from URLs for analysis
 */

import axios from 'axios';
import * as cheerio from 'cheerio';
import { logger } from '../../../utils/logger.js';
import { isContractAddress } from './nlpHelper.js';
import config from '../../../config/index.js';

/**
 * Scrapes a URL and extracts relevant content
 * 
 * @param {string} url - URL to scrape
 * @returns {Promise<Object>} Extracted data from URL
 */
export async function scrapeUrl(url) {
  try {
    // Use direct axios call for simple pages
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 10000
    });
    
    const html = response.data;
    return extractDataFromHtml(html, url);
  } catch (error) {
    logger.error(`Error scraping URL ${url}: ${error.message}`);
    
    // Fallback to Apify for more complex sites if available
    if (config.apifyApiKey) {
      return scrapeWithApify(url);
    }
    
    throw new Error(`Failed to scrape URL: ${error.message}`);
  }
}

/**
 * Extract data from HTML content
 * 
 * @param {string} html - HTML content
 * @param {string} url - Source URL
 * @returns {Object} Extracted data
 */
function extractDataFromHtml(html, url) {
  try {
    const $ = cheerio.load(html);
    const result = {
      title: $('title').text().trim(),
      description: $('meta[name="description"]').attr('content') || '',
      url: url,
      contractAddresses: [],
      tokenSymbols: [],
      textContent: '',
      categories: detectContentCategory($, url)
    };
    
    // Extract main content text
    result.textContent = $('body').text()
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .trim()
      .substring(0, 5000); // Limit to 5000 chars
    
    // Find contract addresses
    result.contractAddresses = extractContractAddresses($, html);
    
    // Extract token symbols from common patterns like $BTC or #ETH
    const symbolRegex = /[$#]([A-Za-z0-9]{2,10})\b/g;
    let match;
    while ((match = symbolRegex.exec(html)) !== null) {
      const symbol = match[1].toUpperCase();
      if (!result.tokenSymbols.includes(symbol)) {
        result.tokenSymbols.push(symbol);
      }
    }
    
    return result;
  } catch (error) {
    logger.error(`Error parsing HTML: ${error.message}`);
    return {
      title: '',
      description: '',
      url: url,
      contractAddresses: [],
      tokenSymbols: [],
      textContent: '',
      categories: []
    };
  }
}

/**
 * Extract contract addresses from HTML content
 * 
 * @param {CheerioStatic} $ - Cheerio instance
 * @param {string} html - Raw HTML content
 * @returns {Array} Extracted contract addresses
 */
function extractContractAddresses($, html) {
  const addresses = new Set();
  
  // Extract from href attributes that often contain addresses
  $('a[href]').each((i, el) => {
    const href = $(el).attr('href');
    extractAddressesFromText(href).forEach(addr => addresses.add(addr));
  });
  
  // Extract from data attributes
  $('[data-address]').each((i, el) => {
    const address = $(el).attr('data-address');
    if (isContractAddress(address)) {
      addresses.add(address);
    }
  });
  
  // Extract from text content
  extractAddressesFromText(html).forEach(addr => addresses.add(addr));
  
  return Array.from(addresses);
}

/**
 * Extract contract addresses from text
 * 
 * @param {string} text - Text to search for addresses
 * @returns {Array} Extracted contract addresses
 */
function extractAddressesFromText(text) {
  if (!text) return [];
  
  const addresses = [];
  
  // EVM addresses (0x...)
  const evmMatches = text.match(/0x[a-fA-F0-9]{40}/g);
  if (evmMatches) {
    evmMatches.forEach(addr => {
      if (isContractAddress(addr) && !addresses.includes(addr)) {
        addresses.push(addr);
      }
    });
  }
  
  // Solana addresses
  const solanaRegex = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;
  const solanaMatches = text.match(solanaRegex);
  if (solanaMatches) {
    solanaMatches.forEach(addr => {
      // Additional validation for Solana addresses to reduce false positives
      if (addr.length >= 32 && addr.length <= 44 && !addresses.includes(addr)) {
        addresses.push(addr);
      }
    });
  }
  
  return addresses;
}

/**
 * Detect the category of content (e.g., DEX, token page, blog, etc.)
 * 
 * @param {CheerioStatic} $ - Cheerio instance
 * @param {string} url - URL being scraped
 * @returns {Array} Categories detected
 */
function detectContentCategory($, url) {
  const categories = [];
  const lowercaseUrl = url.toLowerCase();
  const pageText = $('body').text().toLowerCase();
  
  // Common DEXes
  if (lowercaseUrl.includes('uniswap') || 
      lowercaseUrl.includes('pancakeswap') || 
      lowercaseUrl.includes('dextools') || 
      lowercaseUrl.includes('sushiswap')) {
    categories.push('DEX');
  }
  
  // Explorers
  if (lowercaseUrl.includes('etherscan') || 
      lowercaseUrl.includes('bscscan') || 
      lowercaseUrl.includes('polygonscan') || 
      lowercaseUrl.includes('solscan')) {
    categories.push('EXPLORER');
  }
  
  // Content analysis
  if ((pageText.includes('market cap') || pageText.includes('trading volume')) && 
      (pageText.includes('token') || pageText.includes('crypto'))) {
    categories.push('TOKEN_INFO');
  }
  
  // Social content
  if (lowercaseUrl.includes('twitter.com') || 
      lowercaseUrl.includes('t.me') || 
      lowercaseUrl.includes('discord')) {
    categories.push('SOCIAL');
  }
  
  return categories;
}

/**
 * Use Apify's web scraper for complex sites
 * 
 * @param {string} url - URL to scrape
 * @returns {Promise<Object>} Extracted data
 */
async function scrapeWithApify(url) {
  try {
    const response = await axios.post(
      'https://api.apify.com/v2/actor-tasks/crawlee~web-scraper/run-sync',
      {
        startUrls: [{ url: url }],
        pseudoUrls: [],
        linkSelector: 'a',
        pageFunction: `
          ({ request, body, contentType, $ }) => {
            return {
              url: request.url,
              title: $('title').text(),
              description: $('meta[name="description"]').attr('content'),
              text: $('body').text()
            }
          }
        `,
        maxRequestRetries: 1,
        maxPagesPerCrawl: 1
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apifyApiKey}`
        }
      }
    );
    
    if (response.data && response.data.data && response.data.data.length > 0) {
      const page = response.data.data[0];
      
      return {
        title: page.title || '',
        description: page.description || '',
        url: url,
        contractAddresses: extractAddressesFromText(page.text || ''),
        tokenSymbols: [],
        textContent: (page.text || '').substring(0, 5000),
        categories: []
      };
    } else {
      throw new Error('No data returned from Apify');
    }
  } catch (error) {
    logger.error(`Error using Apify for URL ${url}: ${error.message}`);
    throw new Error(`Failed to scrape with Apify: ${error.message}`);
  }
}
