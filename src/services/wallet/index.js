import { User } from "../../models/User.js";
import { ethers } from "ethers";
import { config } from "../../core/config.js";
import { db } from "../../core/database.js";
import { encrypt, decrypt } from "../../utils/encryption.js";
import { EventEmitter } from "events";
import { ErrorHandler } from "../../core/errors/index.js";
import axios from "axios";
import { SolanaWallet } from "./wallets/solana.js";
import { Avalanche } from 'avalanche';
import { providers } from "../trading/providers/ProviderList.js";
import { solanaProvider } from "./wallets/solana.js";
import { tradeService } from "../trading/TradeService.js";
import { aiMetricsService } from "../aiMetricsService.js";

// -------------------------------------------------
// Helper: Sleep
// -------------------------------------------------
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns dynamic network resources including:
 *  - provider (from the ProviderList)
 *  - endpoint (from config)
 *  - axiosInstance (using the endpoint)
 *
 * @param {string} network - The network name.
 * @returns {object} { provider, endpoint, axiosInstance }
 */
function getNetworkResources(network) {
  const networkKey = network.toLowerCase();
  const provider = providers[networkKey];
  if (!provider) throw new Error(`No provider configured for network: ${network}`);
  const endpointKey = `${networkKey}Endpoint`;
  const endpoint = config[endpointKey];
  if (!endpoint) throw new Error(`No endpoint configured in config for network: ${network}`);
  const axiosInstance = axios.create({
    baseURL: endpoint,
    headers: { "Content-Type": "application/json" },
  });
  return { provider, endpoint, axiosInstance };
}

async function validateProvider(network, provider) {
  try {
    if (!provider) {
      throw new Error(`No provider configured for network: ${network}`);
    }

    // Network-specific validation
    if (network === 'solana') {
      const version = await provider.connection.getVersion();
      console.log(`✅ Solana provider validated. Version: ${version['solana-core']}`);
    } else {
      const blockNumber = await provider.getBlockNumber();
      console.log(`✅ ${network} provider validated. Block: ${blockNumber}`);
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Provider validation failed for ${network}:`, error.message);
    return false;
  }
}

class WalletService extends EventEmitter {
  constructor() {
    super();
    this.walletCache = new Map();
    this.providers = providers;
    this.isInitialized = false;
    this.initializationPromise = null;
    this.CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours
  }

  /**
   * Initializes the WalletService by connecting to the database and
   * setting up necessary collections.
   */
  async initialize() {
    if (this.initializationPromise) return this.initializationPromise;
    this.initializationPromise = (async () => {
      try {
        await db.connect();
        const database = db.getDatabase();
        this.usersCollection = database.collection("users");
        this.metricsCollection = database.collection("walletMetrics");
        console.log("✅ WalletService initialized successfully.");

        // Validate all providers on startup
        const validationResults = await Promise.all(
          Object.entries(this.providers).map(async ([network, provider]) => {
            const isValid = await validateProvider(network, provider);
            return { network, isValid };
          })
        );

        // Log validation results
        validationResults.forEach(({ network, isValid }) => {
          console.log(`${isValid ? '✅' : '❌'} ${network} provider: ${isValid ? 'Valid' : 'Invalid'}`);
        });


        this.isInitialized = true;
        return true;
      } catch (error) {
        console.error("❌ Error initializing WalletService:", error);
        throw error;
      }
    })();
    return this.initializationPromise;
  }

  /**
   * Returns a provider for the specified network using dynamic network resources.
   * @param {string} network
   */
  async getProvider(network) {
    const { provider } = getNetworkResources(network);
    if (!provider) {
      throw new Error(`No provider found for network: ${network}`);
    }
    return provider;
  }

  /**
   * Executes a trade using the tradeService.
   * @param {string} network
   * @param {object} params
   */
  async executeTrade(network, params) {
    return tradeService.executeTrade({
      network,
      ...params,
      options: { autoApprove: true },
    });
  }

  /**
   * Creates a wallet on the given network and stores encrypted wallet data.
   * Routes to specific modules if network is 'solana' or 'avalanche'.
   * @param {string|number} userId - The user's identifier.
   * @param {string} network - The network on which to create the wallet.
   */
  async createWallet(userId, network) {
    // Default: use the provider's createWallet method
    console.log("🏗️🔑 Generating a new wallet for @", userId, " on network: ", network);

    try {
      let wallet;
      if (network.toLowerCase() === "solana") {
        // Use Solana-specific wallet creation logic
        const solanaWallet = new SolanaWallet();
        await solanaWallet.initialize();
        wallet = await solanaWallet.createWallet();
      } else if (network.toLowerCase() === "avalanche") {
        // Use the dedicated Avalanche wallet creation method
        wallet = await this.createAvalancheWallet();
      } else {// Create a new random wallet
        const newWallet = ethers.Wallet.createRandom();
        wallet = newWallet;

        // Connect the new wallet to the provider, not really necessary but il leave 4 reference
        const provider = await this.getProvider(network);
        const connectedWallet = newWallet.connect(provider);

        console.log(`🌞🔹New wallet address: ${connectedWallet.address}`);
        console.log(`📂🔏New wallet private key: ${newWallet.privateKey}`);
      }
      // Log fresh wallet
      console.log('Wallet In full: ', wallet);

      // Remove spaces for encryption on mnemonic * encrypt
      const encryptedData = this.formatWallet(wallet);
      await this.usersCollection.updateOne(
        { telegramId: userId.toString() },
        { $push: { [`wallets.${network}`]: encryptedData } },
        { upsert: true }
      );

      await this.incrementWalletTally(network);
      this.cacheWallet(userId, wallet.address, { ...wallet, network });
      this.emit("walletCreated", { userId, network, address: wallet.address });
      return wallet;
    } catch (error) {
      await ErrorHandler.handle(error, null, null, "Error creating wallet");
      throw error;
    }
  }

  /**
   * Formats wallet data for storage.
   * @param {Object} wallet - Wallet object.
   * @returns {Object} - Formatted wallet object with encrypted keys.
   */
  formatWallet(wallet) {
    return {
      address: wallet.address,
      encryptedPrivateKey: encrypt(wallet.privateKey), 
      encryptedMnemonic: encrypt(wallet.mnemonic?.phrase || "No Mnemonic for this wallet"), 
      createdAt: new Date(),
    };
  } 

  async createAvalancheWallet() {
    try {
      // Create an Avalanche instance using the updated configuration
      const avalanche = new Avalanche(
        config.networks.avalanche.host,
        config.networks.avalanche.port,
        config.networks.avalanche.protocol
      );
      // For creating a key pair on the Platform Chain (P-Chain), use the PChain API.
      const pchain = avalanche.PChain();

      // Get the keyChain instance from the PChain.
      const keyChain = pchain.keyChain();

      // Create a new key pair using the makeKey() method.
      const keyPair = keyChain.makeKey();

      // Retrieve the wallet address and private key.
      const walletAddress = keyPair.getAddressString();
      const privateKey = keyPair.getPrivateKeyString();

      console.log("Avalanche P-Chain Wallet Address:", walletAddress);
      console.log("Avalanche P-Chain Private Key:", privateKey);

      return {
        address: walletAddress,
        privateKey: privateKey,
        mnemonic: null
      };
    } catch (error) {
      console.error("❌ Error creating Avalanche wallet:", error);
      throw error;
    }
  }

  /**
   * Retrieves the current Avalanche fee state using the P-Chain RPC endpoint.
   * The fee state includes fields like capacity, excess, price, and timestamp.
   */
  async getAvalancheFeeState() {
    try {
      const pchainEndpoint = config.networks.avalanche.pchainEndpoint;
      if (!pchainEndpoint) {
        throw new Error("Avalanche P-chain endpoint is not configured.");
      }

      // Create a new ethers provider pointed at the P-Chain endpoint.
      const provider = new ethers.JsonRpcProvider(pchainEndpoint);
      const params = {}; // No parameters needed for this RPC method
      const result = await provider.send("platform.getFeeState", params);
      
      //console.log(`🔥 Avalanche Fee State:`, result);
      return result;
    } catch (error) {
      console.error("❌ Error fetching Avalanche fee state:", error);
      throw error;
    }
  }

  /**
   * Increments a counter in the walletMetrics collection for a given network.
   * @param {string} network
   */
  async incrementWalletTally(network) {
    try {
      await this.metricsCollection.updateOne(
        { network },
        { $inc: { walletCount: 1 } }
      );
      console.log(`✅ Incremented wallet tally for ${network}`);
    } catch (error) {
      console.error(`❌ Error incrementing wallet tally for ${network}:`, error);
      throw error;
    }
  }

  /**
   * Retrieves all wallets for a user across supported networks.
   * @param {string|number} userId
   */
  async getWallets(userId) {
    try {
      if (!this.isInitialized) {
        throw new Error("WalletService is not initialized. Call initialize() before use.");
      }
      const supportedNetworks = Object.keys(config.networks);
      const user = await User.findOne({ telegramId: userId.toString() }).lean();
      if (!user) return [];

      const wallets = supportedNetworks.flatMap((network) =>
        (user.wallets?.[network] || []).map((wallet) => ({ ...wallet, network }))
      );
      console.log(`✅ Retrieved wallets for user ${userId}:`, wallets);
      return wallets;
    } catch (error) {
      console.error(`❌ Error fetching wallets for user ${userId}:`, error.message);
      throw error;
    }
  }

  /**
   * Retrieves wallets for a user on a specific network.
   * @param {string|number} userId
   * @param {string} network
   */
  async getWalletsByNetwork(userId, network) {
    try {
      const supportedNetworks = Object.keys(config.networks);
      if (!supportedNetworks.includes(network)) {
        throw new Error(
          `Invalid network: ${network}. Supported networks: ${supportedNetworks.join(", ")}`
        );
      }

      const user = await User.findOne({ telegramId: userId.toString() }).lean();
      if (!user) return [];

      const wallets = (user.wallets?.[network] || []).map((wallet) => ({
        address: wallet.address,
        type: wallet.type || "internal",
        isAutonomous: wallet.isAutonomous,
        createdAt: wallet.createdAt,
        network,
      }));

      console.log(`✅ Retrieved ${wallets.length} wallets for ${network}`);
      return wallets;
    } catch (error) {
      console.error(`❌ Error fetching wallets for ${network}:`, error.message);
      throw error;
    }
  }

  /**
   * Returns the balance for a wallet address.
   * @param {string|number} userId
   * @param {string} address
   */
  async getBalance(userId, address) {
    try {
      const wallet = await this.getWallet(userId, address);
      if (!wallet) {
        throw new Error("Wallet not found");
      }
      const provider = await this.getProvider(wallet.network);
      return await provider.getBalance(address);
    } catch (error) {
      console.error("Error getting balance:", error);
      throw error;
    }
  }

  /**
   * Retrieves a single wallet for a user by its address.
   * @param {string|number} userId
   * @param {string} address
   */
  async getWallet(userId, address) {
    try {
      const user = await User.findOne({ telegramId: userId.toString() }).lean();
      if (!user || !user.wallets) {
        throw new Error("User not found or no wallets exist.");
      }

      for (const [network, wallets] of Object.entries(user.wallets)) {
        const wallet = wallets.find((w) => w.address === address);
        if (wallet) {
          return { address: wallet.address, network };
        }
      }

      throw new Error("Wallet not found.");
    } catch (error) {
      console.error("Error fetching wallet:", error.message);
      throw error;
    }
  }

  /**
   * Toggles the autonomous flag on a wallet.
   * @param {string|number} userId
   * @param {string} address
   */
  async setAutonomousWallet(userId, address) {
    if (!this.isInitialized) {
      throw new Error("WalletService is not initialized");
    }

    try {
      const wallet = await this.getWallet(userId, address);
      if (!wallet) {
        throw new Error("Wallet not found");
      }

      const user = await User.findOne(
        { telegramId: userId.toString(), [`wallets.${wallet.network}`]: { $elemMatch: { address } } },
        { [`wallets.${wallet.network}.$`]: 1 }
      ).lean();

      if (!user || !user.wallets[wallet.network][0]) {
        throw new Error("Wallet not found");
      }

      const currentIsAutonomous = user.wallets[wallet.network][0].isAutonomous;

      const result = await User.updateOne(
        {
          telegramId: userId.toString(),
          [`wallets.${wallet.network}`]: { $elemMatch: { address } },
        },
        {
          $set: { [`wallets.${wallet.network}.$.isAutonomous`]: !currentIsAutonomous },
        }
      );

      if (result.matchedCount === 0) {
        throw new Error("Wallet not found or no changes made");
      }

      console.log(
        `✅ Successfully toggled isAutonomous for wallet ${address} to ${!currentIsAutonomous}`
      );
      return true;
    } catch (error) {
      console.error("Error toggling autonomous wallet:", error);
      throw error;
    }
  }

  /**
   * Checks if a wallet is marked as autonomous.
   * @param {string|number} userId
   * @param {string} network
   * @param {string} address
   */
  async isAutonomousWallet(userId, network, address) {
    try {
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user?.wallets?.[network]) return false;
      const wallet = user.wallets[network].find((w) => w.address === address);
      return wallet?.isAutonomous || false;
    } catch (error) {
      console.error("Error checking autonomous status:", error);
      return false;
    }
  }

  /**
   * Deletes a wallet from a user's record.
   * @param {string|number} userId
   * @param {string} network
   * @param {string} address
   */
  async deleteWallet(userId, network, address) {
    try {
      if (!this.usersCollection) {
        throw new Error("WalletService is not initialized. Call initialize() before use.");
      }

      const result = await this.usersCollection.updateOne(
        { telegramId: userId.toString() },
        { $pull: { [`wallets.${network}`]: { address } } }
      );

      if (result.modifiedCount > 0) {
        this.removeFromCache(userId, address);
        this.emit("walletDeleted", { userId, network, address });
        return true;
      }

      return false;
    } catch (error) {
      await ErrorHandler.handle(error, null, null, "Error deleting wallet");
      throw error;
    }
  }

  // ---------------------------
  // Cache Helpers
  // ---------------------------
  cacheWallet(userId, address, walletData) {
    const key = `${userId}-${address}`;
    this.walletCache.set(key, { data: walletData, timestamp: Date.now() });
  }

  getFromCache(userId, address) {
    const key = `${userId}-${address}`;
    const cached = this.walletCache.get(key);

    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data;
    }

    if (cached) {
      this.walletCache.delete(key);
    }

    return null;
  }

  removeFromCache(userId, address) {
    const key = `${userId}-${address}`;
    this.walletCache.delete(key);
  }

  /**
   * Performs cleanup by clearing caches and removing all event listeners.
   */
  cleanup() {
    this.walletCache.clear();
    this.removeAllListeners();
    console.log("✅ WalletService cleaned up successfully.");
  }

  /**
   * Checks the health of each network provider by calling its checkHealth method (if available).
   */
  async checkHealth() {
    try {
      // Get all available provider keys (e.g. evm networks) and add 'solana'
      const availableNetworks = [...new Set([...Object.keys(this.providers), 'solana'])];
  
      // Map each network to a health check promise
      const healthChecks = availableNetworks.map(async (network) => {
        try {
          if (network === 'solana') {
            // For Solana, initialize and get latest blockhash
            await solanaProvider.initialize();
            const blockhash = await solanaProvider.getLatestBlockhash();
            if (blockhash) {
              return { network, status: 'healthy', blockhash };
            } else {
              return { network, status: 'unhealthy', error: 'Blockhash not retrieved' };
            }
          } else {
            // For EVM chains, get block number
            const provider = this.providers[network];
            if (!provider) {
              return { network, status: 'unhealthy', error: `No provider configured for network: ${network}` };
            }
            await provider.getBlockNumber();
            return { network, status: 'healthy' };
          }
        } catch (error) {
          return { network, status: 'unhealthy', error: error.message };
        }
      });
  
      // Run all health checks in parallel
      const networkStatuses = await Promise.all(healthChecks);
      aiMetricsService.updateWalletHealth(networkStatuses);
      return networkStatuses;
    } catch (error) {
      console.error('Error checking wallet health:', error);
      return [];
    }
  }  
}

export const walletService = new WalletService();

// ---------------------------
// Periodic Cache Cleanup (every 24 hours)
// ---------------------------
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of walletService.walletCache.entries()) {
    if (now - value.timestamp > walletService.CACHE_DURATION) {
      walletService.walletCache.delete(key);
    }
  }
}, 1000 * 60 * 60 * 24);
