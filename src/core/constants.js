// Network Constants
export const NETWORKS = {
  SONIC: 'sonic',
  ETHEREUM: 'ethereum',
  BASE: 'base',
  SOLANA: 'solana',
  AVALANCHE: 'avalanche',
  POLYGON: 'polygon',
  BSC: 'binance',
  ARBITRUM: 'arbitrum',
  OPTIMISM: 'optimism',
  FANTOM: 'fantom',
  LINEAR: 'linear',
  CYBER: 'cyber',
  BERACHAIN: 'berachain',
  NOVA: 'nova',
  ZKEVM: 'zkevm',
  SCROLL: 'scroll',
  CELO: 'celo',
  WORLDCHAIN: 'worldchain',
  MANTLE: 'mantle',
  ZKSYNC: 'zksync',
  OMNI: 'omni',
};

export const NETWORK_DISPLAY_NAMES = {
  [NETWORKS.SONIC]: 'Sonic',
  [NETWORKS.ETHEREUM]: 'Ethereum',
  [NETWORKS.BASE]: 'Base',
  [NETWORKS.SOLANA]: 'Solana',
  [NETWORKS.AVALANCHE]: 'Avalanche',
  [NETWORKS.POLYGON]: 'Polygon',
  [NETWORKS.BSC]: 'Binance Smart Chain',
  [NETWORKS.ARBITRUM]: 'Arbitrum',
  [NETWORKS.OPTIMISM]: 'Optimism',
  [NETWORKS.FANTOM]: 'Fantom',
  [NETWORKS.LINEAR]: 'Linea',
  [NETWORKS.CYBER]: 'Cyber',
  [NETWORKS.BERACHAIN]: 'Berachain',
  [NETWORKS.NOVA]: 'Nova',
  [NETWORKS.ZKEVM]: 'ZK-EVM',
  [NETWORKS.SCROLL]: 'Scroll',
  [NETWORKS.CELO]: 'Celo',
  [NETWORKS.WORLDCHAIN]: 'Worldchain',
  [NETWORKS.MANTLE]: 'Mantle',
  [NETWORKS.ZKSYNC]: 'ZkSync',
  [NETWORKS.OMNI]: 'Omni',
};

// User States
export const USER_STATES = {
  AWAITING_REGISTRATION: 'AWAITING_REGISTRATION',
  WAITING_MEME_INPUT: 'WAITING_MEME_INPUT',
  WAITING_MEME_VOICE: 'WAITING_MEME_VOICE',
  WAITING_INVESTMENT_INPUT: 'WAITING_INVESTMENT_INPUT',
  WAITING_INVESTMENT_VOICE: 'WAITING_INVESTMENT_VOICE',
  WAITING_LOAN_ANALYSIS: 'WAITING_LOAN_ANALYSIS',
  WAITING_SCAN_INPUT: 'WAITING_SCAN_INPUT',
  WAITING_PRICE_ALERT: 'WAITING_PRICE_ALERT',
  WAITING_TP_INPUT: 'WAITING_TP_INPUT',
  WAITING_SL_INPUT: 'WAITING_SL_INPUT',
  WAITING_TRANSFER_ADDRESS: 'WAITING_TRANSFER_ADDRESS',
  WAITING_TRANSFER_AMOUNT: 'WAITING_TRANSFER_AMOUNT',
  WAITING_EVENT_VOICE: 'WAITING_EVENT_VOICE',
  MAIN_MENU: 'MAIN_MENU',
  // New wallet-related states
  WAITING_SEND_ADDRESS: 'WAITING_SEND_ADDRESS',
  WAITING_SEND_AMOUNT: 'WAITING_SEND_AMOUNT',
  WAITING_SWAP_AMOUNT: 'WAITING_SWAP_AMOUNT',
  WAITING_SWAP_CONFIRMATION: 'WAITING_SWAP_CONFIRMATION',
  WAITING_SWAP_DIRECTION: 'WAITING_SWAP_DIRECTION'
};

// Error Messages
export const ERROR_MESSAGES = {
  GENERAL_ERROR: '❌ An error occurred. Please try again.',
  NETWORK_ERROR: '❌ Network error. Please check your connection.',
  WALLET_NOT_FOUND: '❌ Wallet not found. Please check your settings.',
  INSUFFICIENT_FUNDS: '❌ Insufficient funds for this operation.',
  INVALID_ADDRESS: '❌ Invalid address format.',
  API_ERROR: '❌ Service temporarily unavailable.',
  NOT_CONFIGURED: '❌ Please configure your settings first.'
};

// Welcome Messages
export const WELCOME_MESSAGES = {
  NEW_USER: `*🧠 Say "Hello" to bother him*\n\n` +
           `*{username}*, ready to trench? 🌳🕳️\n\n` +
           `_Dont be shy to combine complex tasks..._ 🤖\n\n` +
           `🗯️ Need help? Ask him anything.`,
           
  RETURNING_USER: `*👨‍🔬 Welcome Back {username}!* \n\n` +
                 `Ready for the trenches? 🌳🕳️\n\n` +
                 `_Let's find gems..._ 💎\n\n` +
                 `🗯️ Need help? Ask him anything ffs!.`
};

// Registration Messages
export const REGISTRATION_MESSAGES = {
  PROMPT: `*🆕 First Time?*\n\n` +
        `🧫 Let's setup some wallets to access full features\n\n` +
        `• Secure wallet creation\n` +
        `• Multi-chain trenching\n` +
        `• AI-powered operations\n` +
        `• And much more...\n\n` +
        `Ready to experiment? 🚀`,

  SUCCESS: `*👨‍🔬 Welcome Lad!!\n\n` +
          `*{username}*, your wallets are ready.\n\n` +
          `_Let's start by asking Dexter to check Twitter trench chatter..._ 💎\n\n` +
          `Type /help or simply ask the agent what it can do.`
};

// Database Constants
export const DB_POOL_SIZE = 50;
export const DB_IDLE_TIMEOUT = 5000;
export const DB_CONNECT_TIMEOUT = 60000;

// Canvas Dimensions
export const CANVAS_DIMENSIONS = {
  WIDTH: 800,
  HEIGHT: 1250
};