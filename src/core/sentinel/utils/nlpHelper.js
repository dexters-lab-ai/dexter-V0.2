/**
 * NLP Helper for SENTINEL API
 * Provides natural language processing utilities to identify user intent
 * and extract relevant entities from queries
 */

import { logger } from '../../../utils/logger.js';

/**
 * Basic patterns to identify query intent
 */
const INTENT_PATTERNS = {
  TOKEN_INFO: [
    /price\s+(?:for|of)\s+([$]?\w+)/i,
    /how\s+much\s+is\s+([$]?\w+)/i,
    /([$]?\w+)\s+price/i,
    /token\s+info/i,
    /info\s+(?:on|about)\s+([$]?\w+)/i,
    /(?:market\s+cap|supply|volume)\s+(?:for|of)\s+([$]?\w+)/i,
    /worth\s+of\s+([$]?\w+)/i
  ],
  SECURITY: [
    /(?:is|analyze)\s+(?:it|token|contract|address)?\s*(?:safe|secure|risk|scam)/i,
    /security\s+(?:analysis|check|audit|score)/i,
    /(?:risk|safety)\s+(?:assessment|analysis|score)/i,
    /(?:rug\s*pull|honeypot)\s+(?:potential|risk|check|analysis)/i,
    /contract\s+(?:safety|analysis|audit|check)/i
  ],
  SOCIAL: [
    /(?:latest|recent)\s+(?:tweets|posts|discussions)\s+(?:about|on|for)\s+([$]?\w+)/i,
    /what(?:'s|s|)\s+(?:people|twitter|everyone)\s+saying\s+about\s+([$]?\w+)/i,
    /sentiment\s+(?:analysis|for|of)\s+([$]?\w+)/i,
    /([$]?\w+)\s+(?:tweets|mentions|sentiment)/i,
    /social\s+(?:data|sentiment|analysis|mentions)/i
  ],
  HOLDERS: [
    /(?:holder|holding|distribution)\s+(?:of|for|about)\s+([$]?\w+)/i,
    /who\s+(?:holds|owns|is holding)\s+([$]?\w+)/i,
    /([$]?\w+)\s+(?:holders|whales|distribution)/i,
    /top\s+(?:wallets|holders|accounts|whales)/i,
    /whale\s+(?:analysis|accounts|monitoring)/i
  ],
};

/**
 * Identifies the intent from a text query
 * 
 * @param {string} query - User query text
 * @returns {Object} Object with detected intents and extracted entities
 */
export function detectQueryIntent(query) {
  if (!query) return { intents: [] };
  
  const result = {
    intents: [],
    entities: {
      tokens: extractTokens(query)
    }
  };

  // Check for each intent pattern
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(query)) {
        if (!result.intents.includes(intent)) {
          result.intents.push(intent);
        }
      }
    }
  }
  
  // If no specific intent is detected, default to TOKEN_INFO
  if (result.intents.length === 0 && result.entities.tokens.length > 0) {
    result.intents.push('TOKEN_INFO');
  }
  
  // Log the detected intent
  logger.debug(`SENTINEL NLP: Detected intents: ${result.intents.join(', ')} with entities: ${JSON.stringify(result.entities)}`);
  
  return result;
}

/**
 * Extracts token symbols or cashtags from a query
 * 
 * @param {string} query - User query text
 * @returns {Array} Array of extracted tokens
 */
export function extractTokens(query) {
  const tokens = [];
  
  // Extract cashtags ($XXX)
  const cashtags = query.match(/\$([a-zA-Z0-9]+)/g);
  if (cashtags) {
    cashtags.forEach(tag => {
      const symbol = tag.substring(1).toUpperCase();
      if (!tokens.includes(symbol)) tokens.push(symbol);
    });
  }
  
  // Extract token names based on common contexts
  const tokenContexts = [
    /(?:about|for|of|on|is)\s+([A-Za-z0-9]+)(?:\s|$)/g,
    /([A-Za-z0-9]{3,5})\s+(?:price|token|crypto|coin)/gi
  ];
  
  tokenContexts.forEach(context => {
    let match;
    while ((match = context.exec(query)) !== null) {
      const potentialToken = match[1].toUpperCase();
      // Filter out common words
      if (potentialToken.length >= 3 && !isCommonWord(potentialToken) && !tokens.includes(potentialToken)) {
        tokens.push(potentialToken);
      }
    }
  });
  
  return tokens;
}

/**
 * Checks if a word is a common English word to avoid false positives
 * 
 * @param {string} word - Word to check
 * @returns {boolean} True if it's a common word
 */
function isCommonWord(word) {
  const commonWords = ['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'ANY', 'CAN', 'HAD', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HOW', 'MAN', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO', 'BOY', 'DID', 'ITS', 'LET', 'PUT', 'SAY', 'TOO', 'USE'];
  return commonWords.includes(word);
}

/**
 * Determines if a string is likely a contract address
 * 
 * @param {string} str - String to check
 * @returns {boolean} True if the string matches contract address pattern
 */
export function isContractAddress(str) {
  // EVM-style contract address (0x followed by 40 hex characters)
  if (/^0x[a-fA-F0-9]{40}$/i.test(str)) return true;
  
  // Solana-style contract address (base58 encoding, typically 32-44 chars)
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(str)) return true;
  
  return false;
}

/**
 * Determines if a string is a URL
 * 
 * @param {string} str - String to check
 * @returns {boolean} True if the string is a valid URL
 */
export function isUrl(str) {
  try {
    new URL(str);
    return true;
  } catch (e) {
    return false;
  }
}
