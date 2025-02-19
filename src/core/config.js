import dotenv from 'dotenv';
import { validateConfig } from '../utils/validation.js';
import { NETWORKS } from './constants.js';

dotenv.config();

// Validate encryption key
const ENCRYPTION_KEY = process.env.MONGO_ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || Buffer.from(ENCRYPTION_KEY, 'base64').length !== 32) {
  throw new Error('Invalid or missing 32-byte encryption key');
}

class Config {
  constructor() {
    // Basic Application Settings
    this.botToken = process.env.BOT_TOKEN;
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

    // Blockchains Endpoints for direct usage (if needed)
    this.solanaEndpoint = process.env.QUICKNODE_SOLANA_ENDPOINT;
    this.baseEndpoint = process.env.QUICKNODE_BASE_RPC;
    this.avaxEndpoint = process.env.QUICKNODE_AVAX_RPC;
    this.etherEndpoint = process.env.QUICKNODE_ETH_RPC;
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
    this.binanceEndpoint = process.env.QUICKNODE_BINANCE_ENDPOINT;
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

    // QuickNode Configuration (if needed)
    this.quickNode = {
      apiKey: process.env.QUICKNODE_API_KEY,
      evmEndpoint: process.env.QUICKNODE_EVM_ENDPOINT || 'https://lingering-red-liquid.base-mainnet.quiknode.pro/a2a21741d8c9370d63a0789ab9eb93f926e11764',
      solanaEndpoint: process.env.QUICKNODE_SOLANA_ENDPOINT || 'https://lingering-red-liquid.solana-mainnet.quiknode.pro/a2a21741d8c9370d63a0789ab9eb93f926e11764',
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

    // -------------------------------------------------------------------------
    // Network Configurations – Extended to Cover All Supported Networks
    // -------------------------------------------------------------------------
    this.networks = {
      [NETWORKS.ETHEREUM]: {        
        rpcUrl: process.env.ETHEREUM_RPC_URL,
        alchemyApiKey: process.env.ALCHEMY_API_KEY,
        fallbackRpcUrls: this.parseFallbackUrls(process.env.ETHEREUM_FALLBACK_RPC_URLS),
        chainId: 1,
        name: 'eth-mainnet',
      },
      [NETWORKS.BASE]: {        
        rpcUrl: process.env.BASE_RPC_URL,
        alchemyApiKey: process.env.ALCHEMY_API_KEY,
        fallbackRpcUrls: this.parseFallbackUrls(process.env.BASE_FALLBACK_RPC_URLS),
        chainId: 8453,
        name: 'base-mainnet',
      },
      [NETWORKS.SOLANA]: {
        name: 'Solana',
        rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
      },
      [NETWORKS.AVALANCHE]: {
        name: 'Avalanche',
        rpcUrl: process.env.QUICKNODE_AVAX_RPC, // C-Chain interactions
        host: process.env.AVALANCHE_HOST || 'api.avax.network',
        port: Number(process.env.AVALANCHE_PORT) || 443,
        protocol: process.env.AVALANCHE_PROTOCOL || 'https',
        chainId: Number(process.env.AVALANCHE_CHAIN_ID) || 43114,
        pchainEndpoint: process.env.AVALANCHE_PCHAIN_ENDPOINT || 'https://docs-demo.avalanche-mainnet.quiknode.pro/ext/bc/P'
      },
      [NETWORKS.POLYGON]: {
        name: 'Polygon',
        rpcUrl: process.env.POLYGON_RPC_URL || process.env.QUICKNODE_POLYGON_ENDPOINT,
        chainId: 137,
      },
      [NETWORKS.BSC]: {
        name: 'Binance Smart Chain',
        rpcUrl: process.env.BSC_RPC_URL || process.env.QUICKNODE_BINANCE_ENDPOINT,
        chainId: 56,
      },
      [NETWORKS.ARBITRUM]: {
        name: 'Arbitrum',
        rpcUrl: process.env.ARBITRUM_RPC_URL || process.env.QUICKNODE_EVM_ENDPOINT,
        chainId: 42161,
      },
      [NETWORKS.OPTIMISM]: {
        name: 'Optimism',
        rpcUrl: process.env.OPTIMISM_RPC_URL || process.env.QUICKNODE_OPTIMISM_ENDPOINT,
        chainId: 10,
      },
      [NETWORKS.FANTOM]: {
        name: 'Fantom',
        rpcUrl: process.env.FANTOM_RPC_URL || process.env.QUICKNODE_FANTOM_ENDPOINT,
        chainId: 250,
      },
      [NETWORKS.LINEAR]: {
        name: 'Linea',
        rpcUrl: process.env.LINEAR_RPC_URL || process.env.QUICKNODE_LINEAR_ENDPOINT,
        chainId: process.env.LINEAR_CHAIN_ID ? Number(process.env.LINEAR_CHAIN_ID) : 59144,
      },
      [NETWORKS.CYBER]: {
        name: 'Cyber',
        rpcUrl: process.env.CYBER_RPC_URL || process.env.QUICKNODE_CYBER_ENDPOINT,
        chainId: process.env.CYBER_CHAIN_ID ? Number(process.env.CYBER_CHAIN_ID) : 0,
      },
      [NETWORKS.BERACHAIN]: {
        name: 'Berachain',
        rpcUrl: process.env.BERACHAIN_RPC_URL || process.env.QUICKNODE_BERACHAIN_ENDPOINT,
        chainId: process.env.BERACHAIN_CHAIN_ID ? Number(process.env.BERACHAIN_CHAIN_ID) : 32520,
      },
      [NETWORKS.NOVA]: {
        name: 'Nova',
        rpcUrl: process.env.NOVA_RPC_URL || process.env.QUICKNODE_NOVA_ENDPOINT,
        chainId: process.env.NOVA_CHAIN_ID ? Number(process.env.NOVA_CHAIN_ID) : 42170,
      },
      [NETWORKS.ZKEVM]: {
        name: 'ZK-EVM',
        rpcUrl: process.env.ZKEVM_RPC_URL || process.env.QUICKNODE_ZKEVM_ENDPOINT,
        chainId: process.env.ZKEVM_CHAIN_ID ? Number(process.env.ZKEVM_CHAIN_ID) : 1101,
      },
      [NETWORKS.SCROLL]: {
        name: 'Scroll',
        rpcUrl: process.env.SCROLL_RPC_URL || process.env.QUICKNODE_SCROLL_ENDPOINT,
        chainId: process.env.SCROLL_CHAIN_ID ? Number(process.env.SCROLL_CHAIN_ID) : 534353,
      },
      [NETWORKS.CELO]: {
        name: 'Celo',
        rpcUrl: process.env.CELO_RPC_URL || process.env.QUICKNODE_CELO_ENDPOINT,
        chainId: process.env.CELO_CHAIN_ID ? Number(process.env.CELO_CHAIN_ID) : 42220,
      },
      [NETWORKS.WORLDCHAIN]: {
        name: 'Worldchain',
        rpcUrl: process.env.WORLDCHAIN_RPC_URL || process.env.QUICKNODE_WORLDCHAIN_ENDPOINT,
        chainId: process.env.WORLDCHAIN_CHAIN_ID ? Number(process.env.WORLDCHAIN_CHAIN_ID) : 0,
      },
      [NETWORKS.MANTLE]: {
        name: 'Mantle',
        rpcUrl: process.env.MANTLE_RPC_URL || process.env.QUICKNODE_MANTLE_QUICKNODE,
        chainId: process.env.MANTLE_CHAIN_ID ? Number(process.env.MANTLE_CHAIN_ID) : 5000,
      },
      [NETWORKS.ZKSYNC]: {
        name: 'ZkSync',
        rpcUrl: process.env.ZKSYNC_RPC_URL || process.env.QUICKNODE_ZKSYNC_QUICKNODE,
        chainId: process.env.ZKSYNC_CHAIN_ID ? Number(process.env.ZKSYNC_CHAIN_ID) : 324,
      },
      [NETWORKS.OMNI]: {
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
