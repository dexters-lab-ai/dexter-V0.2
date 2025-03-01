import { TRADING_INTENTS } from '../intents.js';
import { networkState } from '../../networkState.js';
import { tokenInfoService } from '../../tokens/TokenInfoService.js';

// Parameter validation functions
const validators = {
  // Network validation
  network: (value) => ['ethereum', 'base', 'solana', 'avalanche'].includes(value?.toLowerCase()),

  // Token validation
  token: async (value, network) => {
    if (!value) return false;
    const tokenInfo = await tokenInfoService.validateToken(network, value);
    return !!tokenInfo;
  },

  // Amount validation
  amount: (value) => !isNaN(value) && parseFloat(value) > 0,

  // Action validation
  action: (value) => ['buy', 'sell', 'transfer', 'approve'].includes(value?.toLowerCase()),

  // Address validation  
  address: (value) => /^0x[0-9a-fA-F]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value),

  // Price validation
  price: (value) => !isNaN(value) && parseFloat(value) > 0,

  // Time validation
  time: (value) => !isNaN(Date.parse(value)),

  // Email validation
  email: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),

  // URL validation
  url: (value) => {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }
};

// Parameter configuration for each intent
export const parameterConfig = new Map([
  // Token Trading
  [TRADING_INTENTS.TOKEN_TRADE, {
    required: ['action', 'token', 'amount'],
    optional: ['slippage', 'deadline', 'network'],
    validation: {
      action: validators.action,
      token: validators.token,
      amount: validators.amount,
      slippage: (value) => !isNaN(value) && value >= 0.1 && value <= 50,
      network: validators.network
    }
  }],

  // Token Analysis
  [TRADING_INTENTS.TOKEN_SCAN, {
    required: ['tokenAddress'],
    optional: ['network'],
    validation: {
      tokenAddress: validators.token,
      network: validators.network
    }
  }],

  // Price Alerts
  [TRADING_INTENTS.PRICE_ALERT, {
    required: ['tokenAddress', 'targetPrice', 'condition'],
    optional: ['network', 'swapAction'],
    validation: {
      tokenAddress: validators.token,
      targetPrice: validators.price,
      condition: (value) => ['above', 'below'].includes(value),
      network: validators.network,
      swapAction: (value) => !value || (value.type && value.amount)
    }
  }],

  // Timed Orders
  [TRADING_INTENTS.TIMED_ORDER, {
    required: ['tokenAddress', 'action', 'amount', 'executeAt'],
    optional: ['network', 'slippage'],
    validation: {
      tokenAddress: validators.token,
      action: validators.action,
      amount: validators.amount,
      executeAt: validators.time,
      network: validators.network,
      slippage: (value) => !isNaN(value) && value >= 0.1 && value <= 50
    }
  }],

  // Flipper Mode
  [TRADING_INTENTS.FLIPPER_MODE, {
    required: ['walletAddress'],
    optional: ['maxPositions', 'profitTarget', 'stopLoss', 'timeLimit'],
    validation: {
      walletAddress: validators.address,
      maxPositions: (value) => !isNaN(value) && value > 0,
      profitTarget: (value) => !isNaN(value) && value > 0,
      stopLoss: (value) => !isNaN(value) && value > 0,
      timeLimit: (value) => !isNaN(value) && value > 0
    }
  }],

  // Multi-Target Orders
  [TRADING_INTENTS.MULTI_TARGET_ORDER, {
    required: ['token', 'targets'],
    optional: ['stopLoss', 'timeLimit', 'network'],
    validation: {
      token: validators.token,
      targets: (value) => Array.isArray(value) && value.length > 0,
      stopLoss: validators.price,
      timeLimit: validators.time,
      network: validators.network
    }
  }],

  // Token Scanning
  [TRADING_INTENTS.TOKEN_SCAN, {
    required: ['token'],
    optional: ['network', 'detailed'],
    validation: {
      token: validators.token,
      network: validators.network
    }
  }],

  // Market Analysis
  [TRADING_INTENTS.MARKET_ANALYSIS, {
    required: ['network'],
    optional: ['timeframe', 'limit'],
    validation: {
      network: validators.network,
      timeframe: (value) => ['1h', '24h', '7d'].includes(value),
      limit: (value) => !isNaN(value) && value > 0 && value <= 100
    }
  }],

  // KOL Monitoring
  [TRADING_INTENTS.KOL_MONITOR_SETUP, {
    required: ['handle', 'amount'],
    optional: ['network', 'maxPositions'],
    validation: {
      handle: (value) => /^@?[a-zA-Z0-9_]{1,15}$/.test(value),
      amount: validators.amount,
      network: validators.network,
      maxPositions: (value) => !isNaN(value) && value > 0
    }
  }],

  // Address Book
  [TRADING_INTENTS.SAVE_ADDRESS, {
    required: ['address', 'keyword'],
    optional: ['network', 'type'],
    validation: {
      address: validators.address,
      keyword: (value) => /^[a-zA-Z0-9-_]{3,30}$/.test(value),
      network: validators.network,
      type: (value) => ['wallet', 'token', 'contract'].includes(value)
    }
  }],

  // Solana Pay
  [TRADING_INTENTS.SOLANA_PAY, {
    required: ['amount', 'recipient'],
    optional: ['reference', 'label', 'message'],
    validation: {
      amount: validators.amount,
      recipient: (value) => validators.address(value, 'solana'),
      reference: (value) => validators.address(value, 'solana')
    }
  }],

  // Shopify Integration
  [TRADING_INTENTS.SHOPIFY_SEARCH, {
    required: ['query'],
    optional: ['limit', 'sort'],
    validation: {
      query: (value) => typeof value === 'string' && value.length >= 2,
      limit: (value) => !isNaN(value) && value > 0 && value <= 50
    }
  }]
]);

// Helper functions
function buildSystemPrompt() {
return `You are KATZ, an AI assistant analyzing user messages for:
            1. Intent classification
            2. Parameter extraction based on intent requirements
            3. Context awareness
            4. Action determination

            Available Intents and Required Parameters:
            ${Array.from(this.intentParameters.entries()).map(([intent, config]) => `
            ${intent}:
            Required: ${config.required.join(', ') || 'none'}
            Optional: ${config.optional.join(', ') || 'none'}
            `).join('\n')}

            Return JSON with:
            {
            "intent": string,
            "confidence": number,
            "parameters": {
                // All required and any optional parameters for the intent
            },
            "requiresContext": boolean,
            "suggestedFlow": string|null
            }`;
}

export function validateParameters(intent, parameters) {
    const config = parameterConfig.get(intent);
    if (!config) return true;
  
    // Check required parameters
    const missing = config.required.filter(param => !parameters[param]);
    if (missing.length > 0) {
      throw new Error(`Missing required parameters for ${intent}: ${missing.join(', ')}`);
    }
  
    // Validate parameter values
    for (const [param, value] of Object.entries(parameters)) {
      const validator = config.validation[param];
      if (validator && !validator(value)) {
        throw new Error(`Invalid value for parameter ${param}`);
      }
    }
  
    return true;
  }
  
  export function getParameterConfig(intent) {
    return parameterConfig.get(intent) || { required: [], optional: [] };
  }
  
  export function formatParameters(intent, parameters) {
    const config = parameterConfig.get(intent);
    if (!config) return parameters;
  
    const formatted = {};
    
    // Include only defined parameters
    [...config.required, ...config.optional].forEach(param => {
      if (parameters[param] !== undefined) {
        formatted[param] = parameters[param];
      }
    });
  
    return formatted;
  }