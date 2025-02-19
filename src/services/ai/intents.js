export const TRADING_INTENTS = {
  // Capability intents
  LIST_CAPABILITIES: 'LIST_CAPABILITIES',
  SHOW_CAPABILITY: 'SHOW_CAPABILITY',
  DISCUSS_FEATURE: 'DISCUSS_FEATURE',
  
  // System intents
  SYSTEM_METRICS: 'SYSTEM_METRICS',
  USER_DATA: 'USER_DATA',
  INTERNET_SEARCH: 'INTERNET_SEARCH',

  // Address Book Intents
  SAVE_ADDRESS: 'SAVE_ADDRESS',
  GET_ADDRESS: 'GET_ADDRESS',
  LIST_ADDRESSES: 'LIST_ADDRESSES',
  UPDATE_ADDRESS: 'UPDATE_ADDRESS',
  DELETE_ADDRESS: 'DELETE_ADDRESS',
  SEARCH_ADDRESSES: 'SEARCH_ADDRESSES',
  
  // Chat History & Context
  CHAT_HISTORY: 'CHAT_HISTORY',
  CHAT_SUMMARY: 'CHAT_SUMMARY',
  CONTEXT_RECALL: 'CONTEXT_RECALL',
  CONTEXT_REFERENCE: 'CONTEXT_REFERENCE',

  // Enhanced shopping intents
  PRODUCT_SEARCH: 'PRODUCT_SEARCH',
  TOKEN_TRADE: 'TOKEN_TRADE',
  AMBIGUOUS_SEARCH: 'AMBIGUOUS_SEARCH',

  // Market Analysis
  TRENDING_CHECK: 'TRENDING_CHECK',
  TOKEN_SCAN: 'TOKEN_SCAN',
  MARKET_ANALYSIS: 'MARKET_ANALYSIS',
  KOL_CHECK: 'KOL_CHECK',
  GEMS_TODAY: 'GEMS_TODAY',
  INTERNET_SEARCH: 'INTERNET_SEARCH',

  // Trading Actions
  QUICK_TRADE: 'QUICK_TRADE',
  PRICE_CHECK: 'PRICE_CHECK',
  SWAP_TOKEN: 'SWAP_TOKEN',
  SEND_TOKEN: 'SEND_TOKEN',
  APPROVE_TOKEN: 'APPROVE_TOKEN',
  REVOKE_APPROVAL: 'REVOKE_APPROVAL',
  
  // Automated Trading
  PRICE_ALERT: 'PRICE_ALERT',
  TIMED_ORDER: 'TIMED_ORDER',
  FLIPPER_MODE: 'FLIPPER_MODE',
  FLIPPER_CONFIG: 'FLIPPER_CONFIG',
  FLIPPER_STATUS: 'FLIPPER_STATUS',
  
  // Portfolio Management
  PORTFOLIO_VIEW: 'PORTFOLIO_VIEW',
  POSITION_MANAGE: 'POSITION_MANAGE',
  GAS_ESTIMATE: 'GAS_ESTIMATE',
  
  // Monitoring
  ALERT_MONITOR: 'ALERT_MONITOR',
  TRADE_HISTORY: 'TRADE_HISTORY',

  // Butler Commands
  BUTLER_REMINDER: 'BUTLER_REMINDER',
  BUTLER_MONITOR: 'BUTLER_MONITOR', 
  BUTLER_REPORT: 'BUTLER_REPORT',

  // Payments & Shopping
  SOLANA_PAY: 'SOLANA_PAY',
  SHOPIFY_SEARCH: 'SHOPIFY_SEARCH',
  SHOPIFY_BUY: 'SHOPIFY_BUY',
  PRODUCT_SEARCH: 'PRODUCT_SEARCH',

  // AI Guidelines & Strategies
  SAVE_GUIDELINE: 'SAVE_GUIDELINE',
  GET_GUIDELINES: 'GET_GUIDELINES',
  SAVE_STRATEGY: 'SAVE_STRATEGY',
  GET_STRATEGIES: 'GET_STRATEGIES',

  // KOL Monitoring
  KOL_MONITOR_SETUP: 'KOL_MONITOR_SETUP',
  KOL_MONITOR_LIST: 'KOL_MONITOR_LIST', 
  KOL_MONITOR_STOP: 'KOL_MONITOR_STOP',
  
  // Multi-target Orders
  MULTI_TARGET_ORDER: 'MULTI_TARGET_ORDER',
  MULTI_TARGET_STATUS: 'MULTI_TARGET_STATUS',
  MULTI_TARGET_CANCEL: 'MULTI_TARGET_CANCEL',

  // Greeting intent
  CHAT: 'CHAT',
  GREETING: 'GREETING',
};

export const INTENT_SAMPLES = {
  [TRADING_INTENTS.PRICE_ALERT]: {
    patterns: ['alert me', 'set alert', 'price alert', 'notify me'],
    examples: [
      'Set a price alert for $BOK when it doubles in value.',
      'Notify me when $ETH drops below $1500.',
      'I want an alert when Bitcoin hits $30,000.'
    ],
  },
  [TRADING_INTENTS.INTERNET_SEARCH]: {
    patterns: ['search for', 'find', 'look up', 'google'],
    examples: [
      'Search the internet for Ethereum price predictions.',
      'Look up the latest news on $DOGE.',
      'Find information about Solana blockchain upgrades.'
    ],
  },
  [TRADING_INTENTS.SWAP_TOKEN]: {
    patterns: ['swap', 'exchange', 'convert', 'trade'],
    examples: [
      'Swap 1 ETH for USDT.',
      'Convert 50 USDT to SOL.',
      'Exchange $BTC for $BNB worth $100.',
    ],
  },
  [TRADING_INTENTS.TIMED_ORDER]: {
    patterns: ['schedule trade', 'buy at', 'sell at', 'set order'],
    examples: [
      'Schedule a buy order for 1 ETH when the price drops to $1200.',
      'Set an order to sell $DOGE at $0.5.',
      'Buy $ADA if it dips below $1 by tomorrow.',
    ],
  },
  [TRADING_INTENTS.MARKET_ANALYSIS]: {
    patterns: ['analyze market', 'market overview', 'token trends'],
    examples: [
      'Give me a market analysis for Solana.',
      'What are the current token trends for Ethereum?',
      'Check market overview for top crypto tokens.'
    ],
  },
  // Add more intents as needed
};


export const INTENT_PATTERNS = {
  [TRADING_INTENTS.LIST_CAPABILITIES]: [
    'what can you do',
    'list capabilities',
    'show features',
    'your abilities',
    'what are you capable of'
  ],

  [TRADING_INTENTS.SHOW_CAPABILITY]: [
    'show me',
    'demonstrate',
    'showcase',
    'example of',
    'do a demo'
  ],

  [TRADING_INTENTS.DISCUSS_FEATURE]: [
    'tell me about your',
    'explain feature',
    'how does your',
    'details about',
    'how do you work',
    'your features',
    'your functions'
  ],

  [TRADING_INTENTS.SYSTEM_METRICS]: [
    'system status',
    'health check',
    'performance',
    'metrics'
  ],

  [TRADING_INTENTS.USER_DATA]: [
    'my data',
    'my profile',
    'my settings',
    'my stats'
  ],

  [TRADING_INTENTS.INTERNET_SEARCH]: [
    'search for',
    'find info about',
    'look up',
    'search the web'
  ],

  [TRADING_INTENTS.CHAT_HISTORY]: [
    'show chat history',
    'show conversation',
    'what did we discuss',
    'previous messages',
    'our chat',
    'chat log'
  ],

  [TRADING_INTENTS.CHAT_SUMMARY]: [
    'summarize chat',
    'summarize conversation',
    'recap our chat',
    'what have we talked about',
    'conversation summary'
  ],

  // Address Book Patterns
  [TRADING_INTENTS.SAVE_ADDRESS]: [
    'save address',
    'store address',
    'remember address',
    'add address',
    'save token',
    'save wallet'
  ],

  [TRADING_INTENTS.GET_ADDRESS]: [
    'get address',
    'show address',
    'find address',
    'lookup address'
  ],

  [TRADING_INTENTS.LIST_ADDRESSES]: [
    'list addresses',
    'show addresses',
    'my addresses',
    'saved addresses'
  ],

  [TRADING_INTENTS.UPDATE_ADDRESS]: [
    'update address',
    'change address',
    'edit address',
    'modify address'
  ],

  [TRADING_INTENTS.DELETE_ADDRESS]: [
    'delete address',
    'remove address',
    'forget address'
  ],

  [TRADING_INTENTS.SEARCH_ADDRESSES]: [
    'search addresses',
    'find addresses',
    'lookup addresses'
  ],

  [TRADING_INTENTS.CONTEXT_RECALL]: [
    'remember',
    'recall',
    'what did I say about',
    'find in chat',
    'search chat'
  ],

  [TRADING_INTENTS.CONTEXT_REFERENCE]: [
    'that product',
    'this token',
    'the one we discussed',
    'from earlier',
    'previously mentioned'
  ],

  [TRADING_INTENTS.PRODUCT_SEARCH]: [
    'shop',
    'buy product',
    'purchase',
    'shopping',
    'store',
    'merch',
    'merchandise'
  ],

  [TRADING_INTENTS.TOKEN_TRADE]: [
    'trade token',
    'swap token',
    'buy token',
    'sell token',
    'exchange'
  ],

  [TRADING_INTENTS.TRENDING_CHECK]: [
    'what\'s trending',
    'show trending tokens',
    'top tokens',
    'trending now',
    'hot tokens'
  ],

  [TRADING_INTENTS.TOKEN_SCAN]: [
    'analyze',
    'dyor',
    'scan',
    'research',
    'scan token',
    'analyze token',
    'check token',
    'token info',
    'token details'
  ],

  [TRADING_INTENTS.KOL_CHECK]: [
    'check kol',
    'show tweets',
    'twitter check',
    'kol mentions',
    'influencer posts'
  ],

  [TRADING_INTENTS.QUICK_TRADE]: [
    'buy',
    'sell',
    'swap',
    'trade now',
    'execute trade'
  ],

  [TRADING_INTENTS.PRICE_CHECK]: [
    'price of',
    'token price',
    'how much is',
    'current price',
    'check price'
  ],

  [TRADING_INTENTS.PRICE_ALERT]: [
    'alert me',
    'notify when',
    'set alert',
    'price alert',
    'when price'
  ],

  [TRADING_INTENTS.TIMED_ORDER]: [
    'schedule trade',
    'set order',
    'trade at',
    'buy at',
    'sell at'
  ],

  [TRADING_INTENTS.FLIPPER_MODE]: [
    'start flipper',
    'run flipper',
    'enable flipper',
    'stop flipper',
    'flipper mode'
  ],

  [TRADING_INTENTS.PORTFOLIO_VIEW]: [
    'show positions',
    'view portfolio',
    'my trades',
    'open positions',
    'active trades'
  ],

  [TRADING_INTENTS.POSITION_MANAGE]: [
    'close position',
    'update stop loss',
    'change take profit',
    'modify position',
    'adjust trade'
  ],

  [TRADING_INTENTS.ALERT_MONITOR]: [
    'show alerts',
    'check orders',
    'pending trades',
    'active alerts',
    'scheduled orders'
  ],

  [TRADING_INTENTS.TRADE_HISTORY]: [
    'trade history',
    'past trades',
    'closed positions',
    'trading performance',
    'profit loss'
  ],

  [TRADING_INTENTS.GEMS_TODAY]: [
    'what to ape',
    'analyze',
    'scout',
    'discover',
    'show gems',
    'gems today',
    'trending gems',
    'show me gems',
    'hot gems',
    'new gems',
    'social gems',
    'best gems today',
    'what gems are trending',
    'scan for gems'
  ],

  [TRADING_INTENTS.INTERNET_SEARCH]: [
    'search for',
    'google',
    'search the net',
    'web search',
    'web2',
    'find information about',
    'look up',
    'research',
    'what is',
    'tell me about',
    'search the web for',
    'find news about'
  ],

  // Recent additions during V.skin2
  // Trading Action Patterns
  [TRADING_INTENTS.SWAP_TOKEN]: [
    'swap',
    'exchange',
    'trade',
    'convert'
  ],

  [TRADING_INTENTS.SEND_TOKEN]: [
    'send',
    'transfer',
    'move tokens',
    'send funds'
  ],

  [TRADING_INTENTS.APPROVE_TOKEN]: [
    'approve',
    'allow',
    'enable trading',
    'give permission'
  ],

  // Flipper Mode Patterns
  [TRADING_INTENTS.FLIPPER_MODE]: [
    'start flipper',
    'stop flipper',
    'enable flipper',
    'disable flipper'
  ],

  [TRADING_INTENTS.FLIPPER_CONFIG]: [
    'configure flipper',
    'set flipper',
    'change flipper settings',
    'update flipper'
  ],

  // Butler Patterns
  [TRADING_INTENTS.BUTLER_REMINDER]: [
    'remind me',
    'set reminder',
    'notify me',
    'alert me later'
  ],

  [TRADING_INTENTS.BUTLER_MONITOR]: [
    'monitor token',
    'watch price',
    'track token',
    'follow price'
  ],

  // Payment Patterns
  [TRADING_INTENTS.SOLANA_PAY]: [
    'pay with solana',
    'solana payment',
    'create payment',
    'generate qr'
  ],

  [TRADING_INTENTS.SHOPIFY_SEARCH]: [
    'shop online',
    'shopping',
    'shop',
    'gifts',
    'goods',
    'spoil',
    'shopify',
    'non crypto purchase',
    'search shop',
    'find products',
    'search store',
    'browse items'
  ],

  // AI Guidelines Patterns
  [TRADING_INTENTS.SAVE_GUIDELINE]: [
    'save guideline',
    'store instruction',
    'remember this rule',
    'add guideline'
  ],

  [TRADING_INTENTS.SAVE_STRATEGY]: [
    'save strategy',
    'store strategy',
    'remember strategy',
    'add trading plan'
  ],

  // KOL X Copy Trading
  [TRADING_INTENTS.KOL_MONITOR_SETUP]: [
    'monitor kol',
    'track trader',
    'follow trader',
    'copy trades from',
    'monitor twitter',
    'copy kol',
    'auto copy'
  ],

  [TRADING_INTENTS.KOL_MONITOR_LIST]: [
    'list kol',
    'show monitored',
    'tracked traders',
    'active monitors'
  ],

  [TRADING_INTENTS.KOL_MONITOR_STOP]: [
    'stop monitoring',
    'stop tracking',
    'remove kol',
    'unfollow trader'
  ],

  // Multi Target Orders
  [TRADING_INTENTS.MULTI_TARGET_ORDER]: [
    'sell at multiple',
    'multi target',
    'split sell',
    'sell portions',
    'staged exit',
    'sell % at'
  ],

  [TRADING_INTENTS.MULTI_TARGET_STATUS]: [
    'multi target status',
    'check splits',
    'target progress'
  ],

  [TRADING_INTENTS.MULTI_TARGET_CANCEL]: [
    'cancel split',
    'stop multi target',
    'cancel targets'
  ],

  //Greeting Patterns
  [TRADING_INTENTS.CHAT]: [
    'hey katz',
    'hi katz',
    'hello katz',
    'sup katz',
    'yo katz'
  ],

  [TRADING_INTENTS.GREETING]: [
    'gm',
    'good morning',
    'good evening',
    'good night'
  ],
};
