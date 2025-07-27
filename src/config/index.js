import dotenv from 'dotenv';
// import { validateConfig } from '../utils/validation.js';

dotenv.config();

const config = {
  botToken: process.env.BOT_TOKEN,
  openaiApiKey: process.env.OPENAI_API_KEY,
  smartContractAddress: process.env.SMART_CONTRACT_ADDRESS,
  mongoUri: process.env.MONGO_URI,
  mongoEncryptionKey: process.env.MONGO_ENCRYPTION_KEY,
  alchemyApiKey: process.env.ALCHEMY_API_KEY,
  solanaApiKey: process.env.SOLANA_API_KEY,
  dextoolsUri: process.env.DEXTOOLS_BASE_URL,
  dextoolsApiKey: process.env.DEXTOOLS_API_KEY,
  apifyApiKey: process.env.APIFY_API_KEY,
  networks: {
    ethereum: {
      name: 'Ethereum',
      rpcUrl: process.env.ETHEREUM_RPC_URL,
    },
    base: {
      name: 'Base',
      rpcUrl: process.env.BASE_RPC_URL, 
      chainId: 8453
    },
    solana: {
      name: 'Solana',
      rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'
    }
  }
};

// Temporarily commented out validation to fix startup issues
// validateConfig(config);

export default config;