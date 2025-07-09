import dotenv from 'dotenv';
import { validateConfig } from '../utils/validation.js';

dotenv.config();

// Generate a default encryption key if none provided
const DEFAULT_ENCRYPTION_KEY = Buffer.from('d3xt3r41l4b53cr3tk3yf0rw4ll3t53cur1ty2025', 'utf-8')
  .toString('base64')
  .slice(0, 32);

// Validate encryption key
const ENCRYPTION_KEY = process.env.MONGO_ENCRYPTION_KEY || DEFAULT_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || Buffer.from(ENCRYPTION_KEY, 'base64').length !== 32) {
  console.warn('⚠️ Using default encryption key. For production, set MONGO_ENCRYPTION_KEY in .env');
}

class Config {
  constructor() {
    this.ADMIN_USERNAME = process.env.ADMIN_USERNAME;
    this.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    this.ADMIN_PORT = process.env.ADMIN_PORT || 3090;
    // Basic Application Settings
    this.botToken = process.env.BOT_TOKEN;
    this.ngrokAuthToken= process.env.NGROK_AUTH_TOKEN;
    this.ngrokHostname= process.env.NGROK_HOSTNAME;
    this.googleClientID= process.env.GOOGLE_CLIENT_ID;
    this.googleClientSecret= process.env.GOOGLE_CLIENT_SECRET;
    this.googleClientRedirect= process.env.GOOGLE_CLIENT_REDIRECT;
    this.port= process.env.PORT || 3000;
    this.ngrokPort= process.env.NGROK_PORT || 3001;
    this.dashboardPort= process.env.DASHBOARD_PORT || 4000;
    this.deepseekApiKey = process.env.DEEP_SEEK_API_KEY;
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.smartContractAddress = process.env.SMART_CONTRACT_ADDRESS;
    this.mongoUri = process.env.MONGO_URI;
    this.mongoEncryptionKey = ENCRYPTION_KEY;
    this.alchemyApiKey = process.env.ALCHEMY_API_KEY || 'ip7ONCr6sDycSojM_PZoWawrVM_2c0RW';
    this.solanaApiKey = process.env.SOLANA_API_KEY || 'ip7ONCr6sDycSojM_PZoWawrVM_2c0RW';
    this.apifyApiKey = process.env.APIFY_API_KEY;
    this.apifyCookieToken = process.env.APIFY_COOKIE_KEY;
    this.braveApiKey  = process.env.BRAVE_API_KEY;
    this.bitrefillApiKey = process.env.BITREFILL_API_KEY;
    this.cookieFunAPIKey = process.env.COOKIEDAO_API_KEY;
    this.avacloudAPIKey = process.env.AVACLOUD_API_KEY;
    this.moralisAPIKey = process.env.MORALIS_API_KEY;
    this.coingeckoAPIKey = process.env.COINGECKO_API_KEY;
    this.wormholeKey = process.env.WORMHOLE_KEY;
    this.firecrawlApiKey = process.env.FIRECRAWL_API_KEY;

    // Node-Redis v4 style: If you need a dedicated client
    this.redisClient = {
      username: 'default',
      password: process.env.REDIS_PASSWORD || '47bWEON2casF7oHOXKhHBWIiXinKhS7m',
      socket: {
        host: process.env.REDIS_HOST || 'redis-18078.c244.us-east-1-2.ec2.redns.redis-cloud.com',
        port: parseInt(process.env.REDIS_PORT, 10) || 18078
      },
      // Optional advanced v4 options...
      retryStrategy: (times) => Math.min(times * 50, 10000),
      // etc.
    };

    // Bull v3 style: host/port/password only
    // We must remove or nullify any node-redis v4 fields like `enableReadyCheck` or `maxRetriesPerRequest`.
    this.bullRedis = {
      host: process.env.REDIS_HOST || 'redis-18078.c244.us-east-1-2.ec2.redns.redis-cloud.com',
      port: parseInt(process.env.REDIS_PORT, 10) || 18078,
      password: process.env.REDIS_PASSWORD || '47bWEON2casF7oHOXKhHBWIiXinKhS7m',
      // Critical to avoid the "not permitted" error
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    };

    // Blockchains Endpoints for direct usage (if needed)
    this.sonicEndpoint = process.env.SONIC_ENDPOINT;
    this.solanaEndpoint = process.env.QUICKNODE_SOLANA_ENDPOINT;
    this.baseEndpoint = process.env.QUICKNODE_BASE_RPC;
    this.avaxEndpoint = process.env.QUICKNODE_AVAX_RPC;
    this.ethereumEndpoint = process.env.QUICKNODE_ETH_RPC;
    this.linearEndpoint = process.env.QUICKNODE_LINEAR_ENDPOINT;
    this.cyberEndpoint = process.env.QUICKNODE_CYBER_ENDPOINT;
    this.fantomEndpoint = process.env.QUICKNODE_FANTOM_ENDPOINT;
    this.arbitrumEndpoint = process.env.QUICKNODE_ARBITRUM_ENDPOINT;
    this.berachainEndpoint = process.env.QUICKNODE_BERACHAIN_ENDPOINT;
    this.novaEndpoint = process.env.QUICKNODE_NOVA_ENDPOINT;
    this.optimismEndpoint = process.env.QUICKNODE_OPTIMISM_ENDPOINT;
    this.zkevmEndpoint = process.env.QUICKNODE_ZKEVM_ENDPOINT;
    this.scrollEndpoint = process.env.QUICKNODE_SCROLL_ENDPOINT;
    this.polygonEndpoint = process.env.QUICKNODE_POLYGON_ENDPOINT;
    this.bscEndpoint = process.env.QUICKNODE_BINANCE_ENDPOINT;
    this.celoEndpoint = process.env.QUICKNODE_CELO_ENDPOINT;
    this.worldchainEndpoint = process.env.QUICKNODE_WORLDCHAIN_ENDPOINT;
    this.mantleEndpoint = process.env.QUICKNODE_MANTLE_QUICKNODE;
    this.zksyncEndpoint = process.env.QUICKNODE_ZKSYNC_QUICKNODE;
    this.omniEndpoint = process.env.QUICKNODE_OMIN_QUICKNODE;

    // ElevenLabs Configuration
    this.elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;

    // Google Cloud Speech-to-Text Configuration
    this.googleApiKeyFile = process.env.GOOGLE_API_KEY_FILE; // JSON key file path
    this.googleVertexAIKeyFile = process.env.GOOGLE_VERTEXAI_KEY_FILE;

    // Google but OAuth
    this.googleClientID = process.env.GOOGLE_CLIENT_ID;
    this.googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.googleClientRedirect = process.env.GOOGLE_REDIRECT_URI;

    // Twilio
    this.twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
    this.twilioSID = process.env.TWILIO_SID;
    this.twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;

    // QuickNode Configuration (if needed)
    this.quickNode = {
      apiKey: process.env.QUICKNODE_API_KEY,
      evmEndpoint: process.env.QUICKNODE_EVM_ENDPOINT || 'https://lingering-red-liquid.base-mainnet.quiknode.pro/a2a21741d8c9370d63a0789ab9eb93f926e11764',
      solanaEndpoint: process.env.QUICKNODE_SOLANA_ENDPOINT || 'https://dimensional-alpha-energy.solana-mainnet.quiknode.pro/db09e49b74164019f4d6c12f0ab62859f578694f',
      avalancheEndpoint: process.env.QUICKNODE_AVAX_RPC || 'https://lingering-red-liquid.avalanche-mainnet.quiknode.pro/a2a21741d8c9370d63a0789ab9eb93f926e11764/ext/bc/C/rpc/',
    };

    // Jupiter v6 API & Solana    
    this.solanaEndpoint = process.env.QUICKNODE_SOLANA_ENDPOINT ?? "https://api.mainnet-beta.solana.com";
    this.jupiterEndpoint = process.env.JUPITER_PUBLIC_RPC ?? "https://public.jupiterapi.com";
    this.jupiterPriceRPC = process.env.JUPITER_PRICE_RPC;
    this.jupiterQuoteRPC = process.env.JUPITER_QUOTE_RPC;

    // Dextools Configuration
    this.dextoolsBaseUrl = process.env.DEXTOOLS_BASE_URL;
    this.dextoolsApiKey = process.env.DEXTOOLS_API_KEY;

    // Redis Cloud Configuration
    this.redis = {
      username: 'default',
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: 'redis-18078.c244.us-east-1-2.ec2.redns.redis-cloud.com',
        port: 18078
      },
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      maxReconnectAttempts: 10,
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      }
    };

    // -------------------------------------------------------------------------
    // Network Configurations – Extended to Cover All Supported Networks
    // -------------------------------------------------------------------------
    this.networks = {
      sonic: {
        rpcUrl: process.env.SONIC_ENDPOINT,
        name: 'sonic-mainnet',
        chainId: 146,
        fallbackRpcUrls: this.parseFallbackUrls(process.env.SONIC_ENDPOINT),
      },
      ethereum: {        
        rpcUrl: process.env.ETHEREUM_RPC_URL,
        alchemyApiKey: process.env.ALCHEMY_API_KEY,
        fallbackRpcUrls: this.parseFallbackUrls(process.env.ETHEREUM_FALLBACK_RPC_URLS),
        chainId: 1,
        name: 'eth-mainnet',
      },
      base: {        
        rpcUrl: process.env.BASE_RPC_URL,
        alchemyApiKey: process.env.ALCHEMY_API_KEY,
        fallbackRpcUrls: this.parseFallbackUrls(process.env.BASE_FALLBACK_RPC_URLS),
        chainId: 8453,
        name: 'base-mainnet',
      },
      solana: {
        name: 'Solana',
        rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      },
      avalanche: {
        name: 'Avalanche',
        rpcUrl: process.env.QUICKNODE_AVAX_RPC, // C-Chain interactions
        host: process.env.AVALANCHE_HOST || 'api.avax.network',
        port: Number(process.env.AVALANCHE_PORT) || 443,
        protocol: process.env.AVALANCHE_PROTOCOL || 'https',
        chainId: Number(process.env.AVALANCHE_CHAIN_ID) || 43114,
        pchainEndpoint: process.env.AVALANCHE_PCHAIN_ENDPOINT || 'https://docs-demo.avalanche-mainnet.quiknode.pro/ext/bc/P'
      },
      polygon: {
        name: 'Polygon',
        rpcUrl: process.env.POLYGON_RPC_URL || process.env.QUICKNODE_POLYGON_ENDPOINT,
        chainId: 137,
      },
      bsc: {
        name: 'Binance Smart Chain',
        rpcUrl: process.env.BSC_RPC_URL || process.env.QUICKNODE_BINANCE_ENDPOINT,
        chainId: 56,
      },
      arbitrum: {
        name: 'Arbitrum',
        rpcUrl: process.env.ARBITRUM_RPC_URL || process.env.QUICKNODE_EVM_ENDPOINT,
        chainId: 42161,
      },
      optimism: {
        name: 'Optimism',
        rpcUrl: process.env.OPTIMISM_RPC_URL || process.env.QUICKNODE_OPTIMISM_ENDPOINT,
        chainId: 10,
      },
      fantom: {
        name: 'Fantom',
        rpcUrl: process.env.FANTOM_RPC_URL || process.env.QUICKNODE_FANTOM_ENDPOINT,
        chainId: 250,
      },
      linear: {
        name: 'Linea',
        rpcUrl: process.env.LINEAR_RPC_URL || process.env.QUICKNODE_LINEAR_ENDPOINT,
        chainId: process.env.LINEAR_CHAIN_ID ? Number(process.env.LINEAR_CHAIN_ID) : 59144,
      },
      cyber: {
        name: 'Cyber',
        rpcUrl: process.env.CYBER_RPC_URL || process.env.QUICKNODE_CYBER_ENDPOINT,
        chainId: process.env.CYBER_CHAIN_ID ? Number(process.env.CYBER_CHAIN_ID) : 0,
      },
      berachain: {
        name: 'Berachain',
        rpcUrl: process.env.BERACHAIN_RPC_URL || process.env.QUICKNODE_BERACHAIN_ENDPOINT,
        chainId: process.env.BERACHAIN_CHAIN_ID ? Number(process.env.BERACHAIN_CHAIN_ID) : 32520,
      },
      nova: {
        name: 'Nova',
        rpcUrl: process.env.NOVA_RPC_URL || process.env.QUICKNODE_NOVA_ENDPOINT,
        chainId: process.env.NOVA_CHAIN_ID ? Number(process.env.NOVA_CHAIN_ID) : 42170,
      },
      zkevm: {
        name: 'ZK-EVM',
        rpcUrl: process.env.ZKEVM_RPC_URL || process.env.QUICKNODE_ZKEVM_ENDPOINT,
        chainId: process.env.ZKEVM_CHAIN_ID ? Number(process.env.ZKEVM_CHAIN_ID) : 1101,
      },
      scroll: {
        name: 'Scroll',
        rpcUrl: process.env.SCROLL_RPC_URL || process.env.QUICKNODE_SCROLL_ENDPOINT,
        chainId: process.env.SCROLL_CHAIN_ID ? Number(process.env.SCROLL_CHAIN_ID) : 534353,
      },
      celo: {
        name: 'Celo',
        rpcUrl: process.env.CELO_RPC_URL || process.env.QUICKNODE_CELO_ENDPOINT,
        chainId: process.env.CELO_CHAIN_ID ? Number(process.env.CELO_CHAIN_ID) : 42220,
      },
      worldchain: {
        name: 'Worldchain',
        rpcUrl: process.env.WORLDCHAIN_RPC_URL || process.env.QUICKNODE_WORLDCHAIN_ENDPOINT,
        chainId: process.env.WORLDCHAIN_CHAIN_ID ? Number(process.env.WORLDCHAIN_CHAIN_ID) : 0,
      },
      mantle: {
        name: 'Mantle',
        rpcUrl: process.env.MANTLE_RPC_URL || process.env.QUICKNODE_MANTLE_QUICKNODE,
        chainId: process.env.MANTLE_CHAIN_ID ? Number(process.env.MANTLE_CHAIN_ID) : 5000,
      },
      zksync: {
        name: 'ZkSync',
        rpcUrl: process.env.ZKSYNC_RPC_URL || process.env.QUICKNODE_ZKSYNC_QUICKNODE,
        chainId: process.env.ZKSYNC_CHAIN_ID ? Number(process.env.ZKSYNC_CHAIN_ID) : 324,
      },
      omni: {
        name: 'Omni',
        rpcUrl: process.env.OMNI_RPC_URL || process.env.QUICKNODE_OMIN_QUICKNODE,
        chainId: process.env.OMNI_CHAIN_ID ? Number(process.env.OMNI_CHAIN_ID) : 0,
      },
    };

    this.cacheSettings = {
      duration: 5 * 60 * 1000, // 5 minutes default
    };

    // Dashboard Monitoring TG End Point for KATZ Agent
    this.monitoring = {
      dashboardPort: process.env.DASHBOARD_PORT || 3000,
    };

    // Validate and initialize configuration
    validateConfig(this);
  }

  /**
   * Parse comma-separated fallback URLs into an array.
   */
  parseFallbackUrls(urlString) {
    return urlString ? urlString.split(',').map(url => url.trim()) : [];
  }

  getNetworkConfig(network) {
    const networkConfig = this.networks[network];
    if (!networkConfig) {
      throw new Error(`Invalid network requested: ${network}`);
    }
    return networkConfig;
  }
}

export const config = new Config();