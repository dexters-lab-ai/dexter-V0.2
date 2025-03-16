import { EventEmitter } from 'events';
import { ErrorHandler } from '../../../core/errors/index.js';
import { IntentProcessHandler } from '../handlers/IntentProcessHandler.js';
import { User } from "../../../models/User.js";
import { config } from '../../../core/config.js';
import { decrypt, encrypt } from "../../../utils/encryption.js";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58"; // For Base58 decoding
import { normalizeNetwork, NETWORKS, NETWORK_DISPLAY_NAMES } from '../../../core/constants.js';

// Service imports
import { Wallet } from "ethers";
import { addressBookService } from '../../addressBook/AddressBookService.js';
import { tradeService } from '../../trading/TradeService.js';
import { dextools } from '../../dextools/index.js';
import { trendingService } from '../../trending/TrendingService.js';
import { gemsService } from '../../gems/GemsService.js';
import { twitterService } from '../../twitter/index.js';
import { flipperMode } from '../../pumpfun/FlipperMode.js';
import { priceAlertService } from '../../priceAlerts.js';
import { walletService } from '../../wallet/index.js';
import { tokenApprovalService } from '../../tokens/TokenApprovalService.js';
import { shopifyService } from '../../shopify/ShopifyService.js';
import { dbAIInterface } from '../../db/DBAIInterface.js';
import { contextManager } from '../ContextManager.js';
import { dexscreener } from '../../dexscreener/index.js';
import BitrefillService from "../../bitrefill/BitrefillService.js";
import WormholeBridgeService from '../../Wormhole/WormholeBridgeService.js';
import cookieFun from '../../cookieDAO/CookieFun.js';
import ResearchService from '../../research/ResearchService.js';
import { tasksService } from '../../tasks/TasksService.js';
import { searchCoin, getPriceCoinGecko } from '../../coingecko/CoinGecko.js';
import { pumpFunService } from '../../pumpfun/PumpFunService.js';
import { networkScraper } from '../../fireCrawl/fireCrawl.js';

// Google & SolanaPay
import { manageUserGoogleSettings, sendEmail, searchEmails, replyEmail, readEmail } from '../../../controllers/gmailController.js';
import { manageCalendarEvent, listCalendarEvents } from '../../../controllers/calendarController.js';
import { solanaPayService } from '../../solanaPay/SolanaPayService.js';
import { recurringPaymentService } from '../../recurringPayments/RecurringPayments.js';
import { paymentHistoryService } from '../../paymentHistory/PaymentHistory.js';

// Quicknode Jupiter
import { JupiterQuickNode, getDetailedFormattedBalancesSOL, getAllSPLTokenTransactions} from '../../trading/JupiterQuickNode.js';
import { Connection } from "@solana/web3.js";
import { SwapController } from './swapController.js';
import { avalancheService } from '../../avalanche/AvalancheService.js';

// Quicknode EVM Providers
import { providers } from '../../trading/providers/ProviderList.js';
import { getAllERC20TokenTransactionsBASE } from '../../trading/BaseQuickNode.js';
import { evmQuickNode, getAllERC20TokenTransactionsETH } from '../../trading/EthereumQuicknode.js';
import { getAllERC20TokenTransactionsAVAX } from '../../trading/AvalancheQuickNode.js';

// Moralis Web3 SDK
import { getPortfolioData, getWalletTransactions,  getWalletNetWorth, getWalletPNL } from '../../wallet/Portfolio.js';
import { evmChainMapping, getTokenPrice, searchTokens, getEVMTokenInfo, getTokenSnipers, getTokenPairAddress, getTokenHolders, getTokenSymbol, } from '../../tokens/MoralisTokenService.js';

const defaultConfig = {
  baseEndpoint: config.baseEndpoint,
  aggregatorEndpoint: config.baseAggregatorEndpoint || null
};

export class IntentProcessor extends EventEmitter {
  constructor(bot) {
    super();
    this.bot = bot;
    this.initialized = false;
    this.solanaConnection = new Connection(config.solanaEndpoint);
    this.intentProcessHandler = new IntentProcessHandler();
    this.dextools = dextools;
    this.dexscreener = dexscreener;
    this.bitrefillService = new BitrefillService(bot);
    this.swapController = new SwapController(bot);
    this.jupiterQuickNode = new JupiterQuickNode(bot);
    this.bridgeService = new WormholeBridgeService();
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await Promise.all([
        tradeService.initialize(),
        shopifyService.initialize(),
        solanaPayService.initialize(),
        tasksService.initialize(),
        this.bridgeService.initialize(),
      ]);

      this.initialized = true;
      console.log('✅ IntentProcessor initialized');
    } catch (error) {
      console.error('❌ Error initializing IntentProcessor:', error);
      throw error;
    }
  }

  async getPortfolio(userId, network) {
    // 1. Retrieve wallet addresses for the user.
    const walletAddresses = await walletService.getWallets(userId);
  
    // 2. If a chain is specified, process only that chain.
    if (network) {
      const chain = network.toLowerCase();
      let walletBalances = null;
      try {
        // Call getBalances with a dummy chatId ("portfolio") and parameters.
        walletBalances = await this.getBalances("portfolio", userId, { network: chain });
      } catch (e) {
        console.error(`Error fetching balances for ${chain}:`, e);
      }
  
      if (chain === "solana") {
        const solWallets = walletAddresses.solana || [];
        let portfolio = null;
        if (solWallets.length) {
          try {
            portfolio = await getPortfolioData("solana", solWallets[0].address);
          } catch (error) {
            console.error("Solana portfolio fetch failed:", error);
          }
        }
        return {
          chain: "solana",
          walletAddresses,
          walletBalances,
          portfolio,
        };
      } else {
        // Process EVM chain (e.g., "ethereum", "base", "avalanche").
        const evmWallets = walletAddresses[chain] || [];
        const networthResults = await Promise.all(
          evmWallets.map(async (wallet) => {
            try {
              const networthData = await getWalletNetWorth(wallet.address);
              return { title: `Networth for ${wallet.address}`, data: networthData };
            } catch (error) {
              console.error(`Error fetching networth for ${wallet.address}:`, error);
              return { title: `Networth for ${wallet.address}`, data: null };
            }
          })
        );
        return {
          chain,
          walletAddresses,
          walletBalances,
          networth: networthResults,
        };
      }
    }
  
    // 3. No chain specified: Process default chains.
    const defaultChains = ["solana", "ethereum", "base", "avalanche"];
    const portfolioByChain = {};
    const walletBalancesByChain = {};
  
    for (const ch of defaultChains) {
      // Fetch wallet balances for this chain.
      try {
        walletBalancesByChain[ch] = await this.getBalances("portfolio", userId, { network: ch });
      } catch (e) {
        console.error(`Error fetching balances for ${ch}:`, e);
        walletBalancesByChain[ch] = null;
      }
  
      // Process portfolio (Solana) or networth (EVM) for this chain.
      if (ch === "solana") {
        const solWallets = walletAddresses.solana || [];
        let portfolio = null;
        try {
          portfolio = solWallets.length ? await getPortfolioData("solana", solWallets[0].address) : null;
        } catch (error) {
          console.error("Solana portfolio fetch failed:", error);
        }
        portfolioByChain[ch] = { portfolio };
      } else {
        const evmWallets = walletAddresses[ch] || [];
        const networthResults = await Promise.all(
          evmWallets.map(async (wallet) => {
            try {
              const networthData = await getWalletNetWorth(wallet.address);
              return { title: `Networth for ${wallet.address}`, data: networthData };
            } catch (error) {
              console.error(`Error fetching networth for ${wallet.address}:`, error);
              return { title: `Networth for ${wallet.address}`, data: null };
            }
          })
        );
        portfolioByChain[ch] = { networth: networthResults };
      }
    }
  
    return {
      walletAddresses,
      walletBalances: walletBalancesByChain,
      portfolioByChain,
    };
  }  

  // Helper to process a Solana private key.
  async processSolanaKey(key) {
    // If key is already in base58 format (44 characters and matching regex), return it.
    if (key.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(key)) {
      return key;
    }
    // Otherwise, decrypt the key.
    let decrypted = decrypt(key);
    // Ensure we have a string (if decrypt returns something else, convert it).
    if (typeof decrypted !== "string") {
      decrypted = String(decrypted);
    }
    return decrypted;
  }

  /**
   * Get wallet balances for a user on a specified network.
   * Validates the user, decrypts the private key if needed, reconstructs the wallet,
   * and fetches portfolio balances using getPortfolioData (with fallbacks).
   *
   * @param {string} chatId - Chat identifier.
   * @param {string} userId - Telegram user ID.
   * @param {object} parameters - Contains network and optional tokenList.
   * @returns {object} Formatted portfolio balances.
   * @throws {Error} If user/wallet data is missing, decryption fails, or network is unsupported.
  */

  async getBalances(chatId, userId, parameters) {
    const { network, tokenList = [] } = parameters;
    
    // 1. Retrieve and validate user wallet data.
    const user = await User.findOne({ telegramId: userId });
    if (!user || !user.wallets) {
      throw new Error("User wallet data not found.");
    }
    
    // Determine which networks to query:
    const networksToQuery = network
      ? [network]
      : Object.keys(user.wallets);
  
    // Prepare an array to accumulate results.
    const results = [];
  
    for (const net of networksToQuery) {
      // Ensure the user has wallet data for this network.
      if (!user.wallets[net] || !user.wallets[net][0]?.encryptedPrivateKey) {
        // Skip or add a fallback entry.
        results.push({
          network: net,
          publicKey: "N/A",
          balances: {},
          walletPNL: "N/A",
          walletNetWorth: "N/A",
          error: `Wallet for network "${net}" not found.`,
        });
        continue;
      }
      
      const key = user.wallets[net][0].encryptedPrivateKey;
      
      // Process Solana
      if (net.toLowerCase() === "solana") {
        try {
          // Determine if decryption is needed.
          let needsDecryption = true;
          if (
            (key.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(key)) ||
            (key.length === 128 && /^[0-9a-fA-F]+$/.test(key))
          ) {
            needsDecryption = false;
          }
          const processedKey = needsDecryption ? decrypt(key) : key;
          if (!processedKey) {
            throw new Error("Failed to decrypt private key.");
          }
          // Decode the processed key.
          const secretKeyUint8 = /^[0-9a-fA-F]{128}$/.test(processedKey)
            ? Uint8Array.from(Buffer.from(processedKey, "hex"))
            : bs58.decode(processedKey);
          const wallet = Keypair.fromSecretKey(secretKeyUint8);
          const publicKey = wallet.publicKey.toBase58();
          /*
          console.log("✅ Solana Wallet Reconstructed:", publicKey);
          await this.safeSendMessage(
            this.bot,
            userId,
            `✅ **Wallet Reconstructed!**\n\n🔹 Public Key:\n\`\`\`\n${publicKey}\n\`\`\``,
            { parse_mode: "Markdown" }
          );
          */
  
          // Fetch balances with fallback.
          let formattedBalances;
          try {
            formattedBalances = await getPortfolioData("solana", publicKey);
          } catch (error) {
            console.error("Primary Solana balance fetch failed, falling back", error);
            formattedBalances = await getDetailedFormattedBalancesSOL(wallet, this.solanaConnection);
          }
          
          // Retrieve extra data (PNL and Net Worth)
          let walletPNL, walletNetWorth;
          try {
            walletPNL = await getWalletPNL("solana", publicKey);
          } catch (e) {
            walletPNL = "N/A";
          }
          try {
            walletNetWorth = await getWalletNetWorth("solana", publicKey);
          } catch (e) {
            walletNetWorth = "N/A";
          }
  
          results.push({
            network: "solana",
            publicKey,
            balances: formattedBalances || {},
            walletPNL: walletPNL || "N/A",
            walletNetWorth: walletNetWorth || "N/A",
          });
        } catch (error) {
          console.error(`Error processing Solana wallet: ${error.message}`);
          results.push({
            network: "solana",
            publicKey: "N/A",
            balances: {},
            walletPNL: "N/A",
            walletNetWorth: "N/A",
            error: error.message,
          });
        }
      }
      // Process EVM chains
      else if (evmChainMapping[net.toLowerCase()]) {
        try {
          let privateKey;
          if (key.startsWith("0x") && key.length === 66) {
            privateKey = key;
          } else {
            privateKey = decrypt(key);
            if (!privateKey) throw new Error("Failed to decrypt private key.");
            if (!privateKey.startsWith("0x")) {
              privateKey = "0x" + privateKey;
            }
            console.log(`🔓 Private Key Decrypted Successfully for ${net}`);
          }
          const providerForNetwork = providers[net.toLowerCase()];
          if (!providerForNetwork)
            throw new Error(`Provider for network "${net}" is not configured.`);
          
          const wallet = new Wallet(privateKey, providerForNetwork);
          /*
          console.log(`✅ ${net.toUpperCase()} Wallet Reconstructed:`, wallet.address);
          await this.safeSendMessage(
            this.bot,
            userId,
            `✅ **Wallet Reconstructed!**\n\n🔹 Public Key:\n\`\`\`\n${wallet.address}\n\`\`\``,
            { parse_mode: "Markdown" }
          );
          */
          
          let formattedBalances;
          try {
            formattedBalances = await getPortfolioData(net, wallet.address);
          } catch (error) {
            console.error(`Primary ${net.toUpperCase()} balance fetch failed`, error);
            formattedBalances = {};
          }
          
          let walletPNL, walletNetWorth;
          try {
            walletPNL = await getWalletPNL(net, wallet.address);
          } catch (e) {
            walletPNL = "N/A";
          }
          try {
            walletNetWorth = await getWalletNetWorth(net, wallet.address);
          } catch (e) {
            walletNetWorth = "N/A";
          }
          
          results.push({
            network: net,
            publicKey: wallet.address,
            balances: formattedBalances || {},
            walletPNL: walletPNL || "N/A",
            walletNetWorth: walletNetWorth || "N/A",
          });
        } catch (error) {
          console.error(`Error processing ${net.toUpperCase()} wallet: ${error.message}`);
          results.push({
            network: net,
            publicKey: "N/A",
            balances: {},
            walletPNL: "N/A",
            walletNetWorth: "N/A",
            error: error.message,
          });
        }
      } else {
        // For unsupported networks, return a standardized error structure.
        results.push({
          network: net,
          publicKey: "N/A",
          balances: {},
          walletPNL: "N/A",
          walletNetWorth: "N/A",
          error: `Unsupported network: ${net}`,
        });
      }
    }
  
    // Even if no result was found, ensure the return structure is complete.
    if (!results || results.length === 0) {
      return {
        message: "No wallet data found.",
        data: {},
      };
    }
  
    // Format the final result for presentation.
    return {
      message: "Wallet data retrieved successfully.",
      data: results,
    };
  }  

  /**
   * If a chain is specified (e.g., "base", "eth", "avax", "solana"), this function
   * calls the corresponding method to get the transactions for that chain.
   *
   * @param {string|null} chain - The chain identifier. If omitted or falsy, fetches from all chains.
   * @param {string} walletAddress - The wallet address to query.
   * @param {object} [options={}] - Optional parameters to pass to the underlying methods.
   * @returns {Promise<Array|Object>} - If a chain is provided, returns an array of transactions.
   *                                    If no chain is provided, returns an object with keys: { base, eth, avax, solana }.
   */    
  async getWalletTransactions(chatId, parameters) {
    const network = parameters.network;
    const wallet = parameters.walletAddress;
    const options = parameters.tokenList ?? [];
  
    if (!wallet) {
      return { success: false, message: "Wallet address is required." };
    }
  
    let result;
  
    // Solana Transactions Handling
    if (network.toLowerCase() === "solana") {
      try {
        result = await getWalletTransactions("solana", wallet);
      } catch (error) {
        console.error("Solana primary fetch failed, using fallback.", error);
        try {
          result = await getAllSPLTokenTransactions(wallet, options);
        } catch (fallbackError) {
          console.error("Solana fallback fetch failed.", fallbackError);
          return { success: false, message: "Failed to fetch Solana transactions." };
        }
      }
      return result;
    }
  
    // EVM Transactions Handling
    const evmChainId = evmChainMapping[network.toLowerCase()];
    if (!evmChainId) {
      return { success: false, message: `Unsupported EVM network: ${network}` };
    }
  
    try {
      result = await getWalletTransactions(network, wallet);
    } catch (error) {
      console.error(`Primary fetch for ${network} failed, using fallback.`, error);
      try {
        switch (network.toLowerCase()) {
          case "base":
            result = await getAllERC20TokenTransactionsBASE(wallet, options);
            break;
          case "ethereum":
            result = await getAllERC20TokenTransactionsETH(wallet, options);
            break;
          case "avalanche":
            result = await getAllERC20TokenTransactionsAVAX(wallet, options);
            break;
          default:
            return { success: false, message: `No fallback method available for ${network}` };
        }
      } catch (fallbackError) {
        console.error("Fallback fetch failed:", fallbackError);
        return { success: false, message: `Failed to fetch transactions for ${network}.` };
      }
    }
  
    return result;
  }  

  async swapTokensOnJupiter(userId, params) {
    let swapResult;
    try {
      swapResult = await this.swapController.swapTokens(userId, params);
      
      console.log(`🌐 Swap Success JV6 Metis: ${JSON.stringify(swapResult, null, 2)}`);

      return swapResult;
    } catch (error) {
      console.error("Swap process error:", error.message);
      throw error;
    }
  }

  async swapTokensOnAvalanche(userId, params) {
    try {
      if (!this.isValidAvalancheAddress(params.inputToken) || !this.isValidAvalancheAddress(params.outputToken)) {
        await this.safeSendMessage(
          this.bot, userId,
          `⚠️ **Invalid Token Address!**\n\n🔴 Only Avalanche (AVAX) token addresses are allowed.\nEnsure you're using a valid AVAX contract address.`,
          { parse_mode: "Markdown" }
        );
        throw new Error("Invalid Avalanche token address provided.");
      }

      const user = await User.findOne({ telegramId: userId });
      if (!user || !user.wallets || !user.wallets.avalanche) {
        throw new Error("User AVAX wallet not found.");
      }

      const encryptedKey = user.wallets.avalanche[0]?.encryptedPrivateKey;
      if (!encryptedKey) throw new Error("Encrypted AVAX private key not found.");
      console.log("🔑 Found Encrypted Key:", encryptedKey);

      await this.safeSendMessage(
        this.bot, userId,
        "🔓 **Decrypting Wallet...**\n\n✅ Please wait while we decrypt your wallet key.",
        { parse_mode: "Markdown" }
      );      
      const privateKey = decrypt(encryptedKey);
      if (!privateKey) throw new Error("Failed to decrypt private key.");
      console.log("🔓 Private Key Decrypted Successfully");

      console.log(`🚀 Executing Avalanche Swap: ${params.amount} ${params.inputToken} → ${params.outputToken}`);
      await this.safeSendMessage(
        this.bot, userId,
        `🚀 **Initiating Swap**\n\n🔹 Swapping **${params.amount}** ${params.inputToken} → ${params.outputToken} on Avalanche...`,
        { parse_mode: "Markdown" }
      );
      
      const txHash = await avalancheService.swapTokens(privateKey, params.inputToken, params.outputToken, params.amount);

      await this.safeSendMessage(
        this.bot,
        userId,
        `✅ **Swap Completed!**\n\n🔹 Transaction Hash: [${txHash}](https://snowtrace.io/tx/${txHash})`,
        { parse_mode: "Markdown" }
      );
      
      return txHash;
    } catch (error) {
      console.error("❌ Avalanche Swap Error:", error.message);
      await this.safeSendMessage(
        this.bot,
        userId,
        `❌ **Swap Failed!**\n\n⚠️ Error: ${error.message}`,
        { parse_mode: "Markdown" }
      );
      
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  isValidAvalancheAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  async swapTokensOnEvm(userId, params) {
    try {
      console.log("[Swap] Starting swap process...");
      // Find the user document
      const user = await User.findOne({ telegramId: userId });
      if (!user || !user.wallets)
        throw new Error("User wallet not found.");
  
      // Retrieve the wallet data for the requested network.
      // (Assumes that wallets are stored under their network key.)
      const networkKey = params.network.toLowerCase();
      const walletData =
        (user.wallets[networkKey] && user.wallets[networkKey].length > 0)
          ? user.wallets[networkKey][0]
          : null;
      if (!walletData || !walletData.encryptedPrivateKey)
        throw new Error("Encrypted private key missing for network: " + params.network);
  
      // Decrypt the private key (or use it directly if already valid)
      let privateKey = decrypt(walletData.encryptedPrivateKey);
      if (!privateKey) {
        if (/^(0x)?[0-9a-fA-F]{64}$/.test(walletData.encryptedPrivateKey))
          privateKey = walletData.encryptedPrivateKey;
        else throw new Error("Failed to decrypt or retrieve a valid private key.");
      }
  
      // Validate required token parameters.
      if (!params.inputToken || !params.outputToken)
        throw new Error("Missing required parameters: inputToken or outputToken.");
  
      // Get the provider from our unified providers list.
      const provider = providers[networkKey];
      if (!provider) throw new Error(`No provider configured for network: ${params.network}`);
  
      // Create a wallet signer using the decrypted private key and provider.
      const walletSigner = new Wallet(privateKey, provider);
  
      // Build swap parameters (aligned with startEVMSwap).
      const swapParams = {
        network: params.network,
        wallet: walletSigner,
        inputToken: params.inputToken,
        outputToken: params.outputToken,
        amount: params.amount,
        userId,
        tokenList: params.tokenList || []
      };
  
      console.log("[Swap] Before swap parameters:", JSON.stringify(swapParams, null, 2));
      await this.safeSendMessage(
        this.bot,
        userId,
        `Executing Swap: Swapping ${params.amount} of ${params.inputToken} for ${params.outputToken} on ${params.network}.`,
        { parse_mode: "HTML" }
      );
  
      // Use the generic EVM Quicknode swap service.
      const txResult = await evmQuickNode.startEVMSwap(swapParams);
  
      console.log("[Swap] After swap result:", JSON.stringify(txResult, null, 2));
      // Optionally, you can compute a network-specific explorer URL here.
      await this.safeSendMessage(
        this.bot,
        userId,
        `✅ <b>Swap Complete!</b>\n\n<a href="${txResult.explorerUrl}">View Transaction</a>`,
        { parse_mode: "HTML" }
      );
      console.log("[Swap] Transaction completed successfully.");
      return txResult;
    } catch (error) {
      console.error("[Swap] Error:", error.message);
      await this.safeSendMessage(
        this.bot,
        userId,
        `✅ <b>Swap Failed!</b>\n${error.message}`,
        { parse_mode: "HTML" }
      );
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async sendTokensOnEvm(userId, params) {
    try {
      const user = await User.findOne({ telegramId: userId });
      if (!user || !user.wallets) throw new Error("User wallet not found.");
      const networkKey = params.network.toLowerCase();
      const walletData = user.wallets[networkKey]?.[0];
      if (!walletData || !walletData.encryptedPrivateKey) throw new Error("Encrypted private key missing for network: " + params.network);
      
      await this.safeSendMessage(
        this.bot,
        userId,
        "Decrypting Wallet...",
        { parse_mode: "Markdown" }
      );      
      // Decrypt the private key (or use it directly if already valid)
      let privateKey = decrypt(walletData.encryptedPrivateKey);
      if (!privateKey) {
        if (/^(0x)?[0-9a-fA-F]{64}$/.test(walletData.encryptedPrivateKey))
          privateKey = walletData.encryptedPrivateKey;
        else throw new Error("Failed to decrypt or retrieve a valid private key.");
      }
       // Get the provider from our unified providers list.
       const provider = providers[networkKey];
       if (!provider) throw new Error(`No provider configured for network: ${params.network}`);
   
       // Create a wallet signer using the decrypted private key and provider.
       const walletSigner = new Wallet(privateKey, provider);

      await this.safeSendMessage(
        this.bot, 
        userId, 
        `Sending Tokens: Sending ${params.amount} of ${params.tokenAddress} to ${params.recipient} on ${params.network}...`, 
        { parse_mode: "Markdown" });

      const txResult = await evmQuickNode.sendEvmTokenTransfer({ network: params.network, wallet: walletSigner, tokenAddress: params.tokenAddress, to: params.recipient, amount: params.amount });

      await this.safeSendMessage(
        this.bot, 
        userId, 
        `✅ Transfer Complete! [View Transaction](https://basescan.org/tx/${txResult.hash})`, 
        { parse_mode: "Markdown" }
      );      
      console.log("[Transfer] Transaction completed successfully.");
      return txResult;
    } catch (error) {
      console.error("[Transfer] Error:", error.message);await this.safeSendMessage(
        this.bot, 
        userId, 
        `❌ Transfer Failed: ${error.message}`, 
        { parse_mode: "Markdown" }
      );      
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // Wallet Creation
  async createEVMWallet(network) {
    try {
      const wallet = await walletService.createWallet(network);
      return wallet;
    } catch (error) {
      console.error(error.message);
    }
  }

  async createPriceAlert(userId, chatId, params) {
    let logMessageId = null;
  
    const log = async (chatId, message) => {
      if (!chatId) return;
      try {
        if (!logMessageId) {
          const sentMessage = await this.safeSendMessage(this.bot, chatId, message);
          logMessageId = sentMessage.message_id;
        } else {
          await this.bot.editMessageText(chatId, logMessageId, null, message);
        }
      } catch (err) {
        console.warn('⚠️ Error logging message:', err.message);
      }
    };
  
    try {
      await log(chatId, '🚀 Creating price alert...');
  
      // Process and validate token address.
      params.tokenAddress = this.processUrlInput(params.tokenAddress);
      if (!params.tokenAddress || params.tokenAddress === "No valid address found in URL") {
        return { success: false, message: "Invalid token address. Please provide a valid token address." };
      }
  
      // Determine the network for the token.
      const tokenData = await this.getTokenNetwork(params.tokenAddress);
      if (!tokenData) {
        return { success: false, message: "Unable to determine the network for this token. Please notify devs to update the network mappings." };
      }
  
      const { network, tokenInfo } = tokenData;
      console.log(tokenData);
      const tokenSymbol = tokenInfo.symbol || tokenInfo.token_symbol || tokenInfo.mint || "N/A";
      const tokenAddress = tokenInfo.address || tokenInfo.token_address || tokenInfo.mint || "N/A";
      await log(chatId, `✅ Network determined: ${network}\n\nToken Info:\n- Symbol: ${tokenSymbol}\n- Address: ${tokenAddress}`);
  
      // Determine wallet address.
      let walletAddress;
      if (!params.walletAddress) {
        const wallets = await walletService.getWalletsByNetwork(userId, network);
        if (!wallets.length) {
          return { success: false, message: `No wallets found for network ${network}. Please add a wallet for this network.` };
        }
        walletAddress = wallets[0].address;
        await log(chatId, `✅ Using wallet: ${walletAddress}`);
      } else {
        walletAddress = params.walletAddress.trim().replace(/[\u0000-\u001F\u007F]/g, "");
      }
  
      // Validate target price.
      if (!params.targetPrice || typeof params.targetPrice !== 'number' || params.targetPrice <= 0) {
        return { success: false, message: "Invalid target price. It must be a positive number." };
      }
  
      // Validate condition.
      if (!['above', 'below'].includes(params.condition)) {
        return { success: false, message: 'Invalid condition. Must be "above" or "below".' };
      }
  
      // Process swap action if provided.
      let swapAction = { enabled: false };
      if (params.swapAction && params.swapAction.enabled) {
        if (!params.swapAction.amount || isNaN(params.swapAction.amount) || parseFloat(params.swapAction.amount) <= 0) {
          return { success: false, message: "Invalid swap amount. Must be a positive number." };
        }
        if (!['buy', 'sell'].includes(params.swapAction.type)) {
          return { success: false, message: 'Invalid swap action type. Must be "buy" or "sell".' };
        }
        swapAction = {
          enabled: true,
          type: params.swapAction.type,
          amount: params.swapAction.amount,
          walletAddress: walletAddress,
        };
      }
  
      // Prepare alert data.
      const alertData = {
        tokenAddress: params.tokenAddress,
        network,
        targetPrice: params.targetPrice,
        condition: params.condition,
        walletType: 'internal',
        swapAction,
        walletAddress,
      };
  
      // Create the alert.
      const alert = await priceAlertService.createAlert(userId, alertData);
      await log(
        chatId,
        `🎉 Price alert created!
  Token: ${tokenSymbol}
  Target: ${params.targetPrice}
  Condition: ${params.condition}
  Amount: ${swapAction.enabled ? swapAction.amount : 'N/A'}
  Swap Action: ${swapAction.enabled ? swapAction.type : 'N/A'}`
      );
  
      // Delete the log message after 30 seconds.
      setTimeout(async () => {
        try {
          if (logMessageId) {
            await this.bot.deleteMessage(chatId, logMessageId);
          }
        } catch (err) {
          console.warn('⚠️ Could not delete log message:', err.message);
        }
      }, 30000);
  
      return alert;
    } catch (error) {
      await log(chatId, `❌ Error: ${error.message}`);
      setTimeout(async () => {
        try {
          if (logMessageId) {
            await this.bot.deleteMessage(chatId, logMessageId);
          }
        } catch (err) {
          console.warn('⚠️ Could not delete error log message:', err.message);
        }
      }, 30000);
      return { success: false, message: error.message };
    }
  }  

  processUrlInput(input) {
    const urlPattern = /^(https?:\/\/[^\s]+)$/;

    if (urlPattern.test(input)) {
      return extractBlockchainAddress(input) || "No valid address found in URL";
    } else {
      return input.replace(/\s+/g, '');
    }
  }

  extractBlockchainAddress(url) {
    const evmPattern = /0x[a-fA-F0-9]{40}/;
    const solanaPattern = /[1-9A-HJ-NP-Za-km-z]{32,44}/;

    const evmMatch = url.match(evmPattern);
    if (evmMatch) return evmMatch[0];

    const solanaMatch = url.match(solanaPattern);
    if (solanaMatch) return solanaMatch[0];

    return null;
  }

  async viewPriceAlerts(userId) {
    try {
      return await priceAlertService.viewAlerts(userId);
    } catch (error) {
      console.error("Error fetching price alerts", error.message);
      throw error;
    }
  }

  async getPriceAlert(alertId) {
    try {
      if (!alertId) {
        return { success: false, message: "Alert ID is required." };
      }
  
      const alert = await priceAlertService.getAlertById(alertId);
  
      if (!alert) {
        return { success: false, message: `Alert with ID ${alertId} not found.` };
      }
  
      return alert;
    } catch (error) {
      console.error("Error fetching price alert:", error.message);
      return { success: false, message: "Alert could not be retrieved." };
    }
  }  

  async editPriceAlert(alertId, updatedData) {
    try {
      if (!alertId) {
        return { success: false, message: "Alert ID is required." };
      }
  
      if (!updatedData || Object.keys(updatedData).length === 0) {
        return { success: false, message: "Updated data is required to edit the alert." };
      }
  
      const updatedAlert = await priceAlertService.editAlert(alertId, updatedData);
  
      if (!updatedAlert) {
        return { 
          success: false, 
          message: `Alert with ID ${alertId} not found or could not be updated.` 
        };
      }
  
      return updatedAlert;
    } catch (error) {
      console.error("Error editing price alert:", error.message);
      return { success: false, message: "Alert could not be updated." };
    }
  }  

  async deletePriceAlert(alertId) {
    try {
      if (!alertId) {
        return { success: false, message: "Alert ID is required" };
      }
  
      const result = await priceAlertService.deleteAlert(alertId);
  
      if (!result.success) {
        return {
          success: false,
          message: `Alert with ID ${alertId} could not be found or has already been deleted.`,
        };
      }
  
      return result;
    } catch (error) {
      console.error("Error deleting price alert:", error.message);
      return {
        success: false,
        message: "Alert could not be found or deleted already.",
      };
    }
  }  

  async getTokenNetwork(tokenAddress) {
    const solanaRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    const evmRegex = /^0x[a-fA-F0-9]{40}$/;

    // 🌐 Check if it's a Solana token
    if (solanaRegex.test(tokenAddress)) {
        try {
            console.log(`🔍 Checking Dexscreener for Solana token: ${tokenAddress}`);
            const dexData = await this.dexscreener.getTokenInfoByAddress(tokenAddress);

           // console.log(`✅ Solana Token Found: \n${JSON.stringify(dexData, null, 2)}`);
            if (dexData) return { network: 'solana', tokenInfo: dexData };
        } catch (err) {
            console.warn(`❌ Solana Dexscreener failed: ${err.message}`);
        }
    }

    // 🌐 Check if it's an EVM token
    if (evmRegex.test(tokenAddress)) {
       // console.log(`🔍 Checking EVM networks for token: ${tokenAddress}`);

        // Dynamically get all EVM networks from evmChainMapping
        const networks = Object.keys(evmChainMapping).filter(chain => chain !== 'solana'); // Exclude Solana

        let bestResult = null;

        for (const net of networks) {
            try {
                //console.log(`🔄 Checking ${net}...`);
                const result = await getEVMTokenInfo(net, tokenAddress);

                //console.log(`📊 Raw Response from ${net}: \n${JSON.stringify(result, null, 2)}`);

                if (result?.data?.result?.length > 0) {
                    const candidate = result.data.result.reduce((prev, curr) =>
                        prev.security_score > curr.security_score ? prev : curr
                    );
                    if (!bestResult || candidate.security_score > bestResult.security_score) {
                        bestResult = candidate;
                    }
                } else {
                    // If direct token info not found, try searching
                    const searchResult = await searchTokens(tokenAddress, net);
                    if (searchResult?.data?.result?.length > 0) {
                        const candidate = searchResult.data.result.reduce((prev, curr) =>
                            prev.securityScore > curr.securityScore ? prev : curr
                        );
                        if (!bestResult || candidate.securityScore > bestResult.securityScore) {
                            bestResult = candidate;
                        }
                    }
                }
            } catch (err) {
                console.warn(`⚠️ ${net} failed: ${err.message}`);
            }
        }

        if (bestResult) {
            // Convert Chain ID to readable name
            const reverseMapping = {};
            for (const [key, val] of Object.entries(evmChainMapping)) {
                reverseMapping[val] = key;
            }
            const networkFound = reverseMapping[bestResult.chain_id] || bestResult.chain_id;

            console.log(`✅ Best Matching EVM Network: ${networkFound}`);
            return { network: networkFound, tokenInfo: bestResult };
        } else {
            console.warn(`❌ No valid token info found across EVM networks.`);
            return { error: "No valid token info found for EVM address" };
        }
    }

    console.warn(`⚠️ Unrecognized address format: ${tokenAddress}`);
    return { error: "Unrecognized wallet address format." };
  }

  async handleTokenApproval(params, network) {
    return await tokenApprovalService.approveToken(network, {
      tokenAddress: params.tokenAddress,
      spenderAddress: params.spenderAddress,
      amount: params.amount,
      walletAddress: params.walletAddress
    });
  }

  async handleTokenRevocation(params, network) {
    return await tokenApprovalService.revokeApproval(network, {
      tokenAddress: params.tokenAddress,
      spenderAddress: params.spenderAddress,
      walletAddress: params.walletAddress
    });
  }

  async createSolanaPayment(params) {
    return await solanaPayService.createPayment({
      amount: params.amount,
      recipient: params.recipient,
      reference: params.reference,
      label: params.label
    });
  }

  /* Archived stable version
  async handleAddressPaste(userId, address) {
    try {
        console.log(`🔍 Processing pasted address: ${address}`);

        // 1. Determine network & check if it's a token
        let tokenData = null;
        try {
            tokenData = await this.getTokenNetwork(address);
            console.log(`🌐 Network detected: ${JSON.stringify(tokenData, null, 2)}`);
        } catch (error) {
            console.warn(`⚠️ Failed to determine network: ${error.message}`);
            tokenData = null;
        }

        const network = tokenData?.network || null;
        const tokenInfo = tokenData?.tokenInfo || null;
        if (!network) {
            console.warn('⚠️ Unable to determine the network for this address.');
        }
        const tokenSymbol = tokenInfo[0]?.baseToken?.symbol;  
        console.log(`🌐 Network detected: ${network} 🔹 Token Symbol: ${tokenSymbol} & Token info - \n\n ${JSON.stringify(tokenInfo, null, 2)}`);

        // 2. Sanitize address
        const sanitizedAddress = address.trim().replace(/[\u0000-\u001F\u007F]/g, "");

        // 3. Prepare final structured output
        const finalOutput = {
            network,
            type: tokenInfo ? "token" : "wallet",
            data: { address: sanitizedAddress }
        };

        if (tokenInfo) {
            // 4. If it's a token, gather token-related data
            console.log("✅ Address identified as a token!");
            finalOutput.data.info = tokenInfo;

            const blocksAfter = 1000;

            // Run all API calls concurrently to avoid blocking
            const [
                pairAddresses,
                holders,
            ] = await Promise.all([
                getTokenPairAddress(network, sanitizedAddress).catch(err => {
                    console.warn(`⚠️ Failed to fetch pair addresses: ${err.message}`);
                    return null;
                }),
                getTokenHolders(sanitizedAddress, network).catch(err => {
                    console.warn(`⚠️ Failed to fetch holders: ${err.message}`);
                    return null;
                }),
            ]);

            console.log(`🔗 Pair Addresses: ${JSON.stringify(pairAddresses, null, 2)}`);
            console.log(`👥 Holders: ${JSON.stringify(holders, null, 2)}`);
            console.log(`🔤 Token Symbol: ${tokenSymbol}`);

            // Fetch snipers & tweets only if dependent data is available
            const snipers = pairAddresses
                ? await getTokenSnipers(network, pairAddresses[0], blocksAfter).catch(err => {
                    console.warn(`⚠️ Failed to fetch snipers: ${err.message}`);
                    return null;
                })
                : null;

            const tweets = tokenSymbol
                ? await this.search_tweets_for_cashtag(userId, {searchQuery: tokenSymbol}).catch(err => {
                    console.warn(`⚠️ Failed to fetch tweets: ${err.message}`);
                    return null;
                })
                : null;

            console.log(`🎯 Snipers: ${JSON.stringify(snipers, null, 2)}`);
            console.log(`🐦 Tweets: ${JSON.stringify(tweets, null, 2)}`);

            finalOutput.data = {
                ...finalOutput.data,
                pairAddresses,
                snipers,
                holders,
                symbol: tokenSymbol,
                tweets,
                mindshare: null // Placeholder
            };
        } else {
            // 5. If it's a wallet, fetch wallet-related data
            console.log("👛 Address identified as a wallet!");

            const [networth, pnl, transactions] = await Promise.all([
                getWalletNetWorth(network, sanitizedAddress).catch(err => {
                    console.warn(`⚠️ Failed to fetch net worth: ${err.message}`);
                    return null;
                }),
                getWalletPNL(network, sanitizedAddress).catch(err => {
                    console.warn(`⚠️ Failed to fetch PNL: ${err.message}`);
                    return null;
                }),
                getWalletTransactions(network, sanitizedAddress).catch(err => {
                    console.warn(`⚠️ Failed to fetch transactions: ${err.message}`);
                    return null;
                })
            ]);

            console.log(`💰 Net Worth: ${JSON.stringify(networth, null, 2)}`);
            console.log(`📈 PNL: ${JSON.stringify(pnl, null, 2)}`);
            console.log(`📜 Transactions: ${JSON.stringify(transactions, null, 2)}`);

            finalOutput.data = {
                ...finalOutput.data,
                networth,
                pnl,
                transactions
            };
        }

        // 6. Return the final structured result
        console.log("🚀 Final Output:", JSON.stringify(finalOutput, null, 2));
        return finalOutput;
    } catch (error) {
        await ErrorHandler.handle(error);
        console.error("❌ Error in handleAddressPaste:", error);
        return { message: "Failed to process the pasted address.", data: null };
    }
  }
  */

  async handleAddressPaste(userId, address) {
    // Helper: Retry a function call up to 3 times with exponential backoff.
    const retryCall = async (fn, retries = 3, delay = 500) => {
      let attempt = 0;
      while (attempt < retries) {
        try {
          return await fn();
        } catch (err) {
          attempt++;
          if (attempt >= retries) throw err;
          await new Promise((res) => setTimeout(res, delay * attempt));
        }
      }
    };
  
    try {
      console.log(`🔍 Processing pasted address: ${address}`);
  
      // 1. Get token info using the improved fallback chain
      let tokenData;
      try {
        // This now uses getTokenInfoByAddress with proper fallback chain
        tokenData = await retryCall(() => this.getTokenInfoByAddress(address));
        console.log(`🌐 Token data retrieved: ${JSON.stringify(tokenData, null, 2)}`);
      } catch (error) {
        console.warn(`⚠️ Failed to get token info: ${error.message}`);
        tokenData = null;
      }
  
      // Extract network and token info from the response
      let network, tokenInfo, tokenSymbol, dataSource;
      
      if (tokenData?.data) {
        // Handle different response formats based on the source
        if (tokenData.source?.includes("Dexscreener")) {
          network = tokenData.data.chainId || "unknown";
          tokenInfo = [{ baseToken: tokenData.data }];
          tokenSymbol = tokenData.data.symbol;
          dataSource = tokenData.source;
        } else if (tokenData.source === "CoinGecko") {
          const firstNetwork = Object.keys(tokenData.data)[0];
          network = firstNetwork || "unknown";
          const geckoData = tokenData.data[firstNetwork]?.data;
          tokenInfo = [{ baseToken: { symbol: geckoData?.result?.[0]?.symbol || "Unknown", address } }];
          tokenSymbol = tokenInfo[0].baseToken.symbol;
          dataSource = "CoinGecko";
        } else if (tokenData.source === "handleAddressInput") {
          network = tokenData.data.network || "unknown";
          tokenInfo = tokenData.data.tokenInfo;
          tokenSymbol = tokenInfo?.[0]?.baseToken?.symbol;
          dataSource = "handleAddressInput";
        } else if (tokenData.source?.includes("Moralis")) {
          if (tokenData.source.includes("Solana")) {
            network = "solana";
            tokenInfo = [{ baseToken: { symbol: tokenData.data.result?.[0]?.symbol || "Unknown", address } }];
            tokenSymbol = tokenInfo[0].baseToken.symbol;
            dataSource = tokenData.source;
          } else {
            // For EVM networks from Moralis
            const firstNetwork = Object.keys(tokenData)[0];
            network = firstNetwork || "unknown";
            const moralisData = tokenData[firstNetwork]?.data;
            tokenInfo = [{ baseToken: { symbol: moralisData?.result?.[0]?.symbol || "Unknown", address } }];
            tokenSymbol = tokenInfo[0].baseToken.symbol;
            dataSource = tokenData[firstNetwork]?.source || "Moralis";
          }
        }
      }
  
      console.log(`Network: ${network} | Symbol: ${tokenSymbol} | Source: ${dataSource}`);
  
      // 2. Sanitize the address.
      const sanitizedAddress = address.trim().replace(/[\u0000-\u001F\u007F]/g, "");
      const finalOutput = { 
        network, 
        type: tokenInfo ? "token" : "wallet", 
        source: dataSource,
        data: { address: sanitizedAddress } 
      };
  
      if (tokenInfo) {
        console.log("✅ Address identified as a token!");
  
        const blocksAfter = 1000;
        // 3. Run token-related API calls concurrently.
        const [pairAddresses, holders] = await Promise.all([
          retryCall(() => getTokenPairAddress(network, sanitizedAddress))
            .catch(err => {
              console.warn(`⚠️ Failed to fetch pair addresses: ${err.message}`);
              return null;
            }),
          retryCall(() => getTokenHolders(sanitizedAddress, network))
            .catch(err => {
              console.warn(`⚠️ Failed to fetch holders: ${err.message}`);
              return null;
            })
        ]);
  
        // 4. Fetch snipers & tweets if available.
        const snipers = pairAddresses
          ? await retryCall(() => getTokenSnipers(network, pairAddresses[0], blocksAfter))
              .catch(err => {
                console.warn(`⚠️ Failed to fetch snipers: ${err.message}`);
                return null;
              })
          : null;
        const tweets = tokenSymbol
          ? await retryCall(() => this.search_tweets_for_cashtag(userId, { searchQuery: tokenSymbol }))
              .catch(err => {
                console.warn(`⚠️ Failed to fetch tweets: ${err.message}`);
                return null;
              })
          : null;
        /* const mindshare = 
          await retryCall(() => this.processAgentByContractQuery(sanitizedAddress, '_3Days'))
            .catch(err => {
              console.warn(`⚠️ Failed to fetch mindshare: ${err.message}`);
              return null;
          });
          */
  
        // 5. Group the results with titles using the token symbol.
        finalOutput.data = {
          address: sanitizedAddress,
          source: dataSource,
          [`${tokenSymbol} Info`]: tokenInfo,
          [`${tokenSymbol} Pair Addresses`]: pairAddresses,
          [`${tokenSymbol} Holders`]: holders,
          [`${tokenSymbol} Snipers`]: snipers,
          [`${tokenSymbol} Tweets`]: tweets,          
          //[`${tokenSymbol} Mindshare`]: mindshare
        };
      } else {
        // 6. If it's a wallet, fetch wallet-related data.
        console.log("👛 Address identified as a wallet!");
        const [networth, pnl, transactions] = await Promise.all([
          retryCall(() => getWalletNetWorth(network, sanitizedAddress))
            .catch(err => {
              console.warn(`⚠️ Failed to fetch net worth: ${err.message}`);
              return null;
            }),
          retryCall(() => getWalletPNL(network, sanitizedAddress))
            .catch(err => {
              console.warn(`⚠️ Failed to fetch PNL: ${err.message}`);
              return null;
            }),
          retryCall(() => getWalletTransactions(network, sanitizedAddress))
            .catch(err => {
              console.warn(`⚠️ Failed to fetch transactions: ${err.message}`);
              return null;
            })
        ]);
  
        finalOutput.data = {
          address: sanitizedAddress,
          "Wallet Net Worth": networth,
          "Wallet PNL": pnl,
          "Wallet Transactions": transactions
        };
      }
  
      console.log("🚀 Final Output:", JSON.stringify(finalOutput, null, 2));
      return finalOutput;
    } catch (error) {
      await ErrorHandler.handle(error);
      console.error("❌ Error in handleAddressPaste:", error);
      return { message: "Failed to process the pasted address.", data: null };
    }
  }

  async getTokenInfoBySymbol(symbol) {
    try {
      // 1. Attempt lookup via DexScreener first.
      let dexscreenerData;
      try {
        dexscreenerData = await this.dexscreener.getTokenInfoBySymbol(symbol);
      } catch (err) {
        console.warn(`Dexscreener fetch failed for symbol ${symbol}: ${err.message}`);
      }
  
      if (dexscreenerData) {
        console.log("✅ Token found on DexScreener:", dexscreenerData);
        return dexscreenerData;
      }
  
      // 2. Fallback to Moralis search.
      let moralisData;
      try {
        moralisData = await searchTokens(symbol);
      } catch (err) {
        console.warn(`Moralis fetch failed for symbol ${symbol}: ${err.message}`);
      }
  
      if (moralisData?.data?.result?.length > 0) {
        console.log("✅ Token found on Moralis:", moralisData.data.result[0]);
        return moralisData.data.result[0];
      }
  
      // 3. Fallback to Dextools.
      console.log("⚠️ Token not found on DexScreener/Moralis. Trying Dextools...");
      const dextoolsData = await this.dextools.getTokenInfo(symbol).catch(() => null);
      if (dextoolsData) {
        console.log("✅ Token found on Dextools:", dextoolsData);
        return dextoolsData;
      }
  
      // 4. Nothing found on any source.
      console.log("❌ Token not found on any source.");
      return {
        error: "Failed to retrieve token data from DexScreener, Moralis, and Dextools.",
      };
    } catch (error) {
      console.error("❌ Error in getTokenInfoBySymbol:", error);
      return {
        error: "An unexpected error occurred while retrieving token information.",
      };
    }
  }
  
  /**
   * DESCREENER BASED - SUPPORTS BOTH EVM & SOLANA using Symbol or address only
   * @param {*} walletAddress 
   * @returns 
   */
  async getTokenInfoByAddress(walletAddress) {
    // Check if address is EVM (0x-prefixed, 42 characters); otherwise assume Solana.
    const isEVM = /^0x[a-fA-F0-9]{40}$/.test(walletAddress);
    
    // 1. Try Dexscreener first for both EVM and Solana
    try {
      console.log(`Trying Dexscreener for ${isEVM ? 'EVM' : 'Solana'} address: ${walletAddress}`);
      const dexData = await this.dexscreener.getTokenInfoByAddress(walletAddress);
      if (dexData) {
        return { 
          source: `Dexscreener (${isEVM ? dexData.chainId || 'EVM' : 'Solana'})`, 
          data: dexData 
        };
      }
    } catch (err) {
      console.warn(`${isEVM ? 'EVM' : 'Solana'} Dexscreener failed:`, err.message);
    }
    
    // 2. Try CoinGecko as second option
    try {
      console.log(`Trying CoinGecko for address: ${walletAddress}`);
      const geckoData = await this.getTokenInfoFromCoinGecko(walletAddress);
      if (geckoData) {
        return { 
          source: "CoinGecko", 
          data: geckoData 
        };
      }
    } catch (err) {
      console.warn("CoinGecko lookup failed:", err.message);
    }
    
    // 3. Try handleAddressInput as third option
    try {
      console.log(`Trying handleAddressInput for address: ${walletAddress}`);
      const handleData = await this.handleAddressInput(walletAddress);
      if (handleData && !handleData.error) {
        return { 
          source: "handleAddressInput", 
          data: handleData 
        };
      }
    } catch (err) {
      console.warn("handleAddressInput failed:", err.message);
    }
    
    // 4. Finally, try Moralis as last resort (compressed code)
    if (!isEVM) {
      // Solana flow - compressed
      try {
        const solSearch = await searchTokens(walletAddress, 'solana');
        if (solSearch?.data?.result?.length > 0) {
          return { source: "Moralis (Solana)", data: solSearch.data };
        }
      } catch (err) {
        console.warn("Solana Moralis failed:", err.message);
      }
      return { error: "Failed to retrieve token info for Solana." };
    } else {
      // EVM flow - compressed
      const networks = Object.keys(evmChainMapping).filter(chain => chain !== 'solana');
      const results = {};
      
      // Parallel network checks with compressed code
      const networkResults = await Promise.all(networks.map(async (net) => {
        try {
          // Try direct token info first
          const result = await getEVMTokenInfo(net, walletAddress);
          if (result?.data?.result?.length > 0) return { net, result };
          
          // Fall back to search
          const search = await searchTokens(walletAddress, net);
          if (search?.data?.result?.length > 0) {
            return { net, result: { source: `Moralis Search (${net})`, data: search.data } };
          }
          
          return { net, result: { source: `Moralis (${net})`, data: null } };
        } catch (err) {
          return { net, error: err.message };
        }
      }));
      
      // Process results
      networkResults.forEach(item => {
        if (item?.result) results[item.net] = item.result;
      });
      
      return Object.keys(results).length > 0 ? results : { error: "All token info sources failed." };
    }
  } 

  // CookieDAO mindshare
  async processAgentByTwitterQuery(twitterUsername, interval = '_7Days') {
    try {
      const result = await cookieFun.getAgentByTwitterUsername(twitterUsername, interval);
      console.log("Agent details for Twitter username:", result);
      return result;
    } catch (error) {
      console.error("Error fetching agent by Twitter username:", error);
      throw error;
    }
  }

  async processAgentByContractQuery(contractAddress, interval = '_3Days') {
    try {
      const result = await cookieFun.getAgentByContractAddress(contractAddress, interval);
      console.log("Agent details for contract address:", result);
      return result;
    } catch (error) {
      console.error("Error fetching agent by contract address:", error);
      throw error;
    }
  }

  async processAgentsPaged(interval = '_7Days', page = 1, pageSize = 25) {
    try {
      const result = await cookieFun.getAgentsPaged(interval, page, pageSize);
      console.log("Paged agents:", result);
      return result;
    } catch (primaryError) {
      console.error("Error fetching agents paged:", primaryError);
      try {
        const fallback = await twitterService.getTrenchChatterCached();
        return fallback;
      } catch (fallbackError) {
        console.error("Fallback (Trench Chatter) also failed:", fallbackError);
        throw new Error(`Both primary and fallback Trench calls failed. Primary error: ${primaryError.message}, Fallback error: ${fallbackError.message}`);
      }
    }
  }  
  // Cookie DAO API Call
  async processSearchTweets(searchQuery) {
    
    console.log("Search Query>>>>>>>>:", searchQuery);
    try {
      const result = await cookieFun.searchTweets(searchQuery);
      console.log("Search tweets result:", result);
      return result;
    } catch (error) {
      console.error("Error searching tweets:", error);
      throw error;
    }
  }

  async processSentimentShift(queryStr, interval = '_7Days') {
    try {
      const result = await cookieFun.checkSentimentShift(queryStr, interval);
      console.log("Sentiment shift data:", result);
      return result;
    } catch (error) {
      console.error("Error checking sentiment shift:", error);
      throw error;
    }
  }

  async processAuthorizationCheck() {
    try {
      const result = await cookieFun.checkAuthorization();
      console.log("Authorization check:", result);
      return result;
    } catch (error) {
      console.error("Error checking authorization:", error);
      throw error;
    }
  }

  async getTrendingTokens() {
    try {
      const [trendingTokens, agentsPaged] = await Promise.allSettled([
        trendingService.getTrendingTokens(),
        cookieFun.getAgentsPaged(7, 1, 10)
      ]);
  
      const result = {
        trendingTokens: trendingTokens.status === 'fulfilled' ? trendingTokens.value : null,
        agentsPaged: agentsPaged.status === 'fulfilled' ? agentsPaged.value : null,
      };
  
      if (!result.trendingTokens && !result.agentsPaged) {
        return { error: "Failed to fetch trending tokens and agent data." };
      }
  
      return result;
    } catch (error) {
      console.error("❌ Error fetching trending tokens:", error);
      return { error: "An unexpected error occurred while fetching data." };
    }
  }  

  // Apify Twitter Cashtag Call
  async search_tweets_for_cashtag(userId, cashtag) {
    const minLikes = 0, minRetweets = 0, minReplies = 0;
    try {
      const cleanCashtag = cashtag.toLowerCase().trim();
      if (!cleanCashtag) throw new Error('Cashtag cannot be empty');

      return await twitterService.searchTweetsByCashtag(userId, cleanCashtag, minLikes, minRetweets, minReplies);
    } catch (error) {
      console.error(`❌ Error fetching tweets for cashtag "${cashtag}":`, error);
      throw error;
    }
  }

  // twitter Trench Chatter
  async getTrenchChatterCached() {
    const cacheKey = 'trenches:chatter';
    const cached = await twitterService.getFromCache(cacheKey);
    if (cached) {
      console.log("Returning cached trench chatter");
      return cached;
    }
    return await twitterService.getTrenchChatter();
  }  

  //Apify Backup for Muli dimensional twitter searches
  async processMultiDimensionalTwitterSearch(params) {
    try {
      console.log('[processMultiDimensionalTwitterSearch] Received params:', params);

      const {
        query,
        from,
        to,
        class: searchClass,
        operators = [],
        sortBy = 'Latest',
        maxItems = 100
      } = params;

      // Basic fallback checks
      if (!query) {
        throw new Error("Missing 'query' parameter.");
      }

      // Call the new search method in TwitterService
      const results = await twitterService.searchTwitter({
        query,
        from,
        to,
        searchClass,
        operators,
        sortBy,
        maxItems
      });

      return results;
    } catch (error) {
      console.error('❌ [processMultiDimensionalTwitterSearch] Error:', error);
      throw error;
    }
  }

  // Trending
  async getTrendingTokensByChain(chatId, network) {
    console.log("============== Network:", network);
    
    // Normalize the input network name.
    const normalizedNetwork = normalizeNetwork(network);
    
    let trendingTokens;
    try {
      // Call the trending service (which may have its own caching and error handling)
      trendingTokens = await trendingService.getTrendingTokensByChain(normalizedNetwork);
    } catch (error) {
      console.error("Error fetching trending tokens:", error);
      trendingTokens = [];
    }
    
    // Fallback detection:
    // 1. If trendingTokens is not an array, or is empty.
    // 2. Or if the first token contains a fallback flag.
    if (!Array.isArray(trendingTokens) || trendingTokens.length === 0 || trendingTokens[0].fallback) {
      console.warn("Fallback condition triggered in getTrendingTokensByChain. Using networkScraper fallback.");
      const trendingResult = await networkScraper.trendingNetworkScrap(normalizedNetwork);
      return trendingResult;
    }
    
    // Otherwise, return the trending tokens as provided.
    return trendingTokens;
  }

  async getTrendingTokensCoinGecko() {
    return await trendingService.get_trending_coingecko();
  }

  async getTrendingTokensDextools() {
    return await dextools.fetchTrendingEVM();
  }

  async getTrendingTokensDexscreener() {
    return await trendingService.getBoostedTokens();
  }

  async getTrendingTokensTwitter() {
    return await twitterService.discoverTrenches();
  }

  async getGems() {
    return await twitterService.discoverTrenches();
  }

  async getMarketConditions() {
    return await this.intentProcessHandler.getMarketConditions();
  }

  async getMarketCategories() {
    return await this.intentProcessHandler.fetchMarketCategories();
  }

  async getMarketCategoryMetrics() {
    return await this.intentProcessHandler.fetchMarketCategoryMetrics();
  }

  async getCoinsByCategory(categoryId) {
    return await this.intentProcessHandler.fetchCoinsByCategory(categoryId);
  }

  async fetchMetrics() {
    return await flipperMode.fetchMetrics();
  }

  async startFlipperMode(userId, chatId, parameters) {
    return await flipperMode.start(userId, chatId, parameters);
  }

  async stopFlipperMode(bot, userId) {
    return await flipperMode.stop(bot, userId);
  }

  async performInternetSearch(chatId, text) {
    const urlRegex = /(https:\/\/\S+)/;
    const match = text.match(urlRegex);
    if (match && match[1]) {
      const url = match[1];
      const message = "Click the button below to open the web app:";
      const reply_markup = {
        inline_keyboard: [
          [{
            text: "Open Web App",
            web_app: { url }
          }]
        ]
      };
      await this.safeSendMessage(this.bot, chatId, message, { parse_mode: "Markdown", reply_markup });
      await this.safeSendMessage(this.bot, chatId, "⚠️ Advise user to click the link button above!!", { parse_mode: "Markdown" });
      return { status: "web_app", url };
    }
    return await this.intentProcessHandler.performInternetSearch(text);
  }  

  async saveGuidelines(userId, text) {
    return await dbAIInterface.saveUserGuideline(userId, text);
  }

  async getGuidelines(userId) {
    return await dbAIInterface.getUserGuidelines(userId);
  }

  async getChatHistory(userId) {
    return {
      text: await contextManager.getContext(userId),
      type: 'history'
    };
  }
  
  // Google API Methods
  async manageUserGmailSettings(userId, args) {
    return new Promise(async (resolve, reject) => {
      // Extract only the "action" property as per your schema.
      const { action } = args;
      // Create a simulated req object
      const req = { body: { telegramId: userId, action } };
      // Create a dummy res object
      const res = {
        json: (data) => resolve(data),
        status: (code) => ({
          json: (errorData) => reject(new Error(errorData.error || JSON.stringify(errorData)))
        })
      };
  
      try {
        await manageUserGoogleSettings(req, res);
      } catch (error) {
        console.error("Error managing Gmail settings:", error);
        reject(error);
      }
    });
  }    

  async manageCalendarEvent(userId, args) {
    return new Promise(async (resolve, reject) => {
      const { action, eventId, title, startTime, endTime, description } = args;
      // Optionally check that the user exists before calling the controller.
      const user = await User.findOne({ telegramId: userId });
      if (!user) {
        return reject(new Error("User not found"));
      }
      // Create a simulated request object
      const req = {
        body: { telegramId: userId, action, eventId, title, startTime, endTime, description }
      };
      // Create a simulated response object with json() and status().json() methods
      const res = {
        json: (data) => resolve(data),
        status: (code) => ({
          json: (errorData) => reject(new Error(errorData.error || JSON.stringify(errorData)))
        })
      };
  
      try {
        await manageCalendarEvent(req, res);
      } catch (error) {
        console.error("Error managing calendar event:", error);
        reject(error);
      }
    });
  }   
  
  async listCalendarEvent(userId, args) {
    return new Promise(async (resolve, reject) => {
      try {
        const user = await User.findOne({ telegramId: userId });
        if (!user) {
          return reject(new Error("User not found"));
        }
        // Build simulated req object
        const req = { body: { telegramId: userId, maxResults: args.maxResults || 10 } };
        // Build simulated res object
        const res = {
          json: (data) => resolve(data),
          status: (code) => ({
            json: (errorData) => reject(new Error(errorData.error || JSON.stringify(errorData)))
          })
        };
        await listCalendarEvents(req, res);
      } catch (error) {
        console.error("Error listing calendar events:", error);
        reject(error);
      }
    });
  }

  async sendEmail(userId, args) {
    return new Promise(async (resolve, reject) => {
      try {
        const { to, subject, text, html } = args;
        const user = await User.findOne({ telegramId: userId });
        if (!user) {
          return reject(new Error("User not found"));
        }
        const req = { body: { telegramId: userId, to, subject, text, html } };
        const res = {
          json: (data) => resolve(data),
          status: (code) => ({
            json: (errorData) => reject(new Error(errorData.error || JSON.stringify(errorData)))
          })
        };
        await sendEmail(req, res);
      } catch (error) {
        console.error("Error sending email:", error);
        reject(error);
      }
    });
  }

  async searchEmails(userId, args) {
    return new Promise(async (resolve, reject) => {
      try {
        const { query, maxResults } = args;
        const user = await User.findOne({ telegramId: userId });
        if (!user) {
          return reject(new Error("User not found"));
        }
        const req = { body: { telegramId: userId, query, maxResults } };
        const res = {
          json: (data) => resolve(data),
          status: (code) => ({
            json: (errorData) => reject(new Error(errorData.error || JSON.stringify(errorData)))
          })
        };
        await searchEmails(req, res);
      } catch (error) {
        console.error("Error searching emails:", error);
        reject(error);
      }
    });
  }

  async readEmail(userId, args) {
    return new Promise(async (resolve, reject) => {
      try {
        const { messageId, format } = args;
        const user = await User.findOne({ telegramId: userId });
        if (!user) {
          return reject(new Error("User not found"));
        }
        const req = { body: { telegramId: userId, messageId, format } };
        const res = {
          json: (data) => resolve(data),
          status: (code) => ({
            json: (errorData) => reject(new Error(errorData.error || JSON.stringify(errorData)))
          })
        };
        await readEmail(req, res);
      } catch (error) {
        console.error("Error reading email:", error);
        reject(error);
      }
    });
  }

  async replyEmail(userId, args) {
    return new Promise(async (resolve, reject) => {
      try {
        const { threadId, messageId, body } = args;
        const user = await User.findOne({ telegramId: userId });
        if (!user) {
          return reject(new Error("User not found"));
        }
        const req = { body: { telegramId: userId, threadId, messageId, body } };
        const res = {
          json: (data) => resolve(data),
          status: (code) => ({
            json: (errorData) => reject(new Error(errorData.error || JSON.stringify(errorData)))
          })
        };
        await replyEmail(req, res);
      } catch (error) {
        console.error("Error replying to email:", error);
        reject(error);
      }
    });
  }

  // SolanaPay Methods
  async createSolanaPayment(args) {
    try {
      const { amount, recipient, reference, label } = args;
      return await solanaPayService.createPayment(amount, recipient, label, reference);
    } catch (error) {
      console.error('Error creating Solana payment:', error);
      throw error;
    }
  }

  async getPaymentStatus(args) {
    try {
      const { sessionId } = args;
      return await solanaPayService.getPaymentStatus(sessionId);
    } catch (error) {
      console.error('Error getting payment status:', error);
      throw error;
    }
  }

  async validatePayment(args) {
    try {
      const { signature } = args;
      return await solanaPayService.validatePayment(signature);
    } catch (error) {
      console.error('Error validating payment:', error);
      throw error;
    }
  }

  async createRecurringPayment(userId, args) {
    try {
      const { merchantEmail, amount, interval } = args;
      return await recurringPaymentService.createRecurringPayment(
        userId,
        merchantEmail,
        amount,
        interval
      );
    } catch (error) {
      console.error('Error creating recurring payment:', error);
      throw error;
    }
  }

  async getPaymentHistory(userId) {
    try {
      return await paymentHistoryService.getPaymentHistory(userId);
    } catch (error) {
      console.error('Error getting payment history:', error);
      throw error;
    }
  }

  async performTokenPriceCheck(token) {
    if (typeof token !== "string") token = String(token);
    const sanitizedToken = token.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  
    // DexScreener
    let priceUsd;
    try {
        priceUsd = await this.dexscreener.getTokenPriceByAddress(sanitizedToken);//aslo accepts symbol
     
    } catch (err) {
      console.warn("DexScreener fetch failed:", err.message);
    }
    if (priceUsd) {
      return `$${priceUsd}`;
    }
  
    // Fallback: CoinGecko
    try {
      const coingeckoPrice = await getPriceCoinGecko(sanitizedToken);
      // returns usd price in units
      if (coingeckoPrice) return `$${coingeckoPrice}`;
    } catch (err) {
      console.error("Price fetch failed on Dexscreener & CoinGecko:", err.message);
    }
    return { error: "Failed to retrieve token data from all sources." };
  }  
  
  async getTokenInfoFromCoinGecko(input) {
    try {
      return await this.intentProcessHandler.getTokenInfoFromCoinGecko(input);
    } catch (error) {
      console.warn("CoinGecko fetch failed:", error.message);
      const isAddress = /^0x[a-fA-F0-9]{40}$/.test(input) || input.length === 44;
      const results = {};
      const networks = Object.keys(evmChainMapping).filter(net => net.toLowerCase() !== 'solana');
      for (const net of networks) {
        let result;
        try {
          if (isAddress) {
            result = await getTokenPrice(net, input);
          } else {
            result = await searchCoin(input);
          }
          if (result && result.data) results[net] = result;
        } catch (fallbackErr) {
            console.error(`Moralis fallback for ${net} failed:`, fallbackErr.message);

            result = await searchTokens(input, net);
            if (result && result.data) results[net] = result;

            console.error(`Moralis fallback for ${net} yielded:`, result);
        }
      }
      return Object.keys(results).length > 0 ? results : null;
    }
  }  

  async getTokenAddressBySymbol(symbol) {
    // Preprocess the symbol
    symbol = String(symbol).trim().toLowerCase().replace(/\s+/g, '');
    if (!symbol || symbol.length === 44) {
      console.warn("Invalid or unsupported symbol/address provided.");
      return "NONE";
    }
  
    console.log(`[getTokenAddressBySymbol] Starting lookup for symbol: ${symbol}`);
  
    // 1. Try DexScreener first.
    try {
      const dexData = await this.dexscreener.getTokenInfoBySymbol(symbol);
      console.log("[getTokenAddressBySymbol] DexScreener result:", dexData);
      if (dexData) {
        if (Array.isArray(dexData) && dexData.length > 0 && dexData[0].baseToken && dexData[0].baseToken.address) {
          console.log("[getTokenAddressBySymbol] Returning token address from DexScreener (array):", dexData[0].baseToken.address);
          return dexData[0].baseToken.address;
        } else if (dexData.detailPlatforms) {
          console.log("[getTokenAddressBySymbol] Returning token address from DexScreener (object):", dexData.detailPlatforms);
          return dexData.detailPlatforms;
        } else {
          console.warn("[getTokenAddressBySymbol] DexScreener data incomplete or undefined.");
        }
      }
    } catch (error) {
      console.warn("[getTokenAddressBySymbol] DexScreener fetch failed:", error.message);
    }
  
    // 2. Fallback to CoinGecko.
    try {
      const coingeckoData = await this.getTokenInfoFromCoinGecko(symbol);
      //console.log("🚀🚀🚀 [getTokenAddressBySymbol] CoinGecko result:", coingeckoData);  
      //console.log("🚀 Final Output:", JSON.stringify(coingeckoData, null, 2));
      const detailPlatforms = coingeckoData.general.detailPlatforms;
      const platforms = Object.keys(detailPlatforms);
      if (platforms.length > 0) {
        // If you expect only one platform, or want the first one:
        const platform = platforms[0];
        const contractAddress = detailPlatforms[platform].contract_address;
        console.log("Contract Address:", contractAddress);
        return contractAddress;
      }
    } catch (error) {
      console.warn("[getTokenAddressBySymbol] CoinGecko fetch failed:", error.message);
    }
  
    console.warn("[getTokenAddressBySymbol] All lookups failed. Returning 'NONE'.");
    return "NONE";
  }  

  async startBitrefillShoppingFlow(chatId, email) {
    await this.bitrefillService.handleShoppingFlow(chatId, email),

      await this.bitrefillService.notifyPaymentStatus(chatId, invoiceId);
  }

  async bitRefillService(chatId) {
    try {
      if (msg.text?.toLowerCase().includes("shop gift cards")) {
        return await this.bitrefillService.handleShoppingFlow(chatId);
      }

      throw new Error("No matching intent found.");
    } catch (error) {
      console.error("❌ Error in processMessage:", error.message);
      await this.safeSendMessage(this.bot, chatId, "❌ An error occurred while processing your request.");
    }
  }

  extractFirstObject(data) {
    try {
      if (!data || !data.pairs || !Array.isArray(data.pairs) || data.pairs.length === 0) {
        return null;
      }
      const firstPair = data.pairs[0];

      const socials = (firstPair.info?.socials || []).reduce((acc, social) => {
        acc[social.type] = social.url;
        return acc;
      }, {});

      const website = firstPair.info?.websites?.[0]?.url || null;

      return {
        dexId: firstPair.dexId || null,
        pairAddress: firstPair.pairAddress || null,
        priceUsd: parseFloat(firstPair.priceUsd) || 0,
        priceNative: parseFloat(firstPair.priceNative) || 0,
        priceChange24h: firstPair.priceChange?.h24 || 0,
        priceChange6h: firstPair.priceChange?.h6 || 0,
        txnCount24h: firstPair.txns?.h24?.buys + firstPair.txns?.h24?.sells || 0,
        liquidityUsd: firstPair.liquidity?.usd || 0,
        liquidityBase: firstPair.liquidity?.base || 0,
        liquidityQuote: firstPair.liquidity?.quote || 0,
        volumeUsd24h: firstPair.volume?.h24 || 0,
        url: firstPair.url || null,
        baseToken: firstPair.baseToken?.symbol || null,
        quoteToken: firstPair.quoteToken?.symbol || null,
        socials,
        website,
      };
    } catch (error) {
      console.error("Error extracting first object:", error);
      return null;
    }
  }

  async startKOLMonitoring(userId, parameters) {
    let amount = parameters.amount !== null && parameters.amount !== undefined ? parameters.amount : 0;
    return await twitterService.startKOLMonitoring(userId, parameters.query, amount);
  }

  async getKOLMonitors(userId) {
    try {
      // Retrieve monitors from TwitterService.
      let monitors = await twitterService.getKOLsMonitored(userId);
      if (!monitors || monitors.length === 0) {
        return {
          success: false,
          message: "No active KOL monitors found."
        };
      }
  
      // Convert each monitor into a plain object (strip out Mongoose internals)
      monitors = monitors.map(monitor => (monitor._doc ? monitor._doc : monitor));
  
      // Filter duplicates by normalized handle (remove any leading "@" and lowercase).
      const uniqueMonitorsMap = new Map();
      monitors.forEach(monitor => {
        if (monitor.handle) {
          const normHandle = monitor.handle.replace(/^@+/, "").toLowerCase();
          if (!uniqueMonitorsMap.has(normHandle)) {
            uniqueMonitorsMap.set(normHandle, monitor);
          }
        }
      });
      const uniqueMonitors = Array.from(uniqueMonitorsMap.values());
  
      // Format the results.
      const formattedMonitors = uniqueMonitors.map(monitor => {
        // Safely get tweet text.
        let tweetText = "";
        if (monitor.lastTweet && typeof monitor.lastTweet.text === "string") {
          tweetText = monitor.lastTweet.text;
          if (tweetText.length > 100) {
            tweetText = tweetText.slice(0, 100) + '...';
          }
        }
        return {
          handle: monitor.handle,
          status: monitor.enabled ? 'Active' : 'Inactive',
          amount: monitor.amount,
          lastChecked: monitor.lastChecked 
            ? new Date(monitor.lastChecked).toLocaleString() 
            : 'Never',
          lastTweet: monitor.lastTweet && typeof monitor.lastTweet.text === "string"
            ? {
                text: tweetText,
                url: monitor.lastTweet.url || '',
                createdAt: monitor.lastTweet.createdAt 
                          ? new Date(monitor.lastTweet.createdAt).toLocaleString() 
                          : 'Unknown'
              }
            : null
        };
      });
  
      return {
        success: true,
        message: "KOL monitors retrieved successfully",
        monitors: formattedMonitors
      };
    } catch (error) {
      console.error('Error getting KOL monitors:', error);
      await ErrorHandler.handle(error);
      return {
        success: false,
        message: error.message || "Failed to retrieve KOL monitors"
      };
    }
  }  

  async stopKOLMonitoring(userId, handle) {
    return await twitterService.stopKOLMonitoring(userId, handle);
  }

  async deleteKOLMonitoring(userId, handle) {
    return await twitterService.deleteKOLMonitor(userId, handle);
  }

  /*
  async deleteKOLMonitoringID(userId, handle) {
    return await twitterService.deleteKOLMonitorID(userId, handle);
  }
    */

  async handleShopifySearch(text) {
    const products = await shopifyService.searchProducts(text);
    if (!products?.length) {
      return {
        text: "No products found matching your search.",
        type: 'search'
      };
    }

    return products.length === 1
      ? this.formatSingleProduct(products[0])
      : this.formatShopifyResults(products);
  }

  async handleProductReference(userId, productId) {
    const product = await shopifyService.getProductById(productId);
    if (!product) {
      throw new Error('Product not found');
    }
    return this.formatSingleProduct(product);
  }

  formatSingleProduct(product) {
    return {
      text: [
        `*${product.title}* 🛍️`,
        product.description ? product.description : '',
        `💰 ${product.currency} ${parseFloat(product.price).toFixed(2)}`,
        `${product.available ? '✅ In Stock' : '❌ Out of Stock'}`,
        `🔗 [View Product](${product.url})`,
        `Reference: \`product_${product.id}\``
      ].filter(Boolean).join('\n'),
      type: 'single_product',
      parse_mode: 'Markdown',
      product: {
        ...product,
        reference: `product_${product.id}`
      }
    };
  }

  formatShopifyResults(products) {
    const formattedProducts = products.map((product, i) => {
      return [
        `${i + 1}. *${product.title}*`,
        `💰 ${product.currency} ${parseFloat(product.price).toFixed(2)}`,
        product.description ? product.description.slice(0, 100) : '',
        `${product.available ? '✅ In Stock' : '❌ Out of Stock'}`,
        `🔗 [View Product](${product.url})`,
        `Reference: \`${product.id}\``
      ].filter(Boolean).join('\n');
    });

    return {
      text: `*KATZ Store Products* 🛍️\n\n${formattedProducts.join('\n\n')}`,
      type: 'product_list',
      parse_mode: 'Markdown',
      products: products.map(product => ({
        ...product,
        reference: `product_${product.id}`
      }))
    };
  }

  /**
   * processBridgeTransaction
   * -------------------
   * Accepts user input (for example, from an API or chatbot intent),
   * and calls the WormholeBridgeService to perform the bridging.
   *
   * Expected userInput format:
   * {
   *   telegramId: string,
   *   sourceChain: string,
   *   targetChain: string,
   *   tokenAddress: string,   // either "native" or a token symbol/address
   *   amount: string,         // e.g. "0.05"
   *   recipientAddress: string,
   *   roundTrip: boolean      // optional (default: true)
   * }
   *
   * bot and chatId are provided for logging to Telegram.
   */
  async processBridgeTransaction(userId, chatId, userInput) {
    try {
      const bridgeService = new WormholeBridgeService();
      const result = await bridgeService.bridgeTokens(userId, userInput, this.bot, chatId);
      return result;
    } catch (error) {
      console.error("Error processing bridge intent:", error);
      throw error;
    }
  }

  getTokenAddress(chain, tokenSymbol) {
    if (tokenSymbol === "NATIVE") {
      return "native";
    }
    const addressesForChain = tokenAddressMap[chain];
    if (!addressesForChain) throw new Error(`Chain not supported: ${chain}`);
    const addr = addressesForChain[tokenSymbol];
    if (!addr) throw new Error(`Token ${tokenSymbol} not supported on ${chain}`);
    return addr;
  }

  async handleFetchBridgeReceipts({ telegramId, limit }) {
    try {
      limit = limit || 10;
      const records = await User.fetchUserBridgingRecords(telegramId, limit);
      return {
        bridgingRecords: records
      };
    } catch (err) {
      console.error("handleFetchBridgeReceipts error:", err);
      throw err;
    }
  }

  /**
   * Processes a save_research intent.
   * The AI model should pass all recent conversation context as the content,
   * and may optionally pass auto-generated keywords and a summary comment.
   */
  async processSaveResearchIntent(userInput, chatId) {
    try {
      const researchService = new ResearchService();
      const result = await researchService.saveResearch(userInput);
      await this.bot.sendMessage(chatId, `Research saved with ID: ${result.researchId}`);
      return result;
    } catch (error) {
      console.error("Error saving research:", error);
      throw error;
    }
  }

  /**
   * Processes a retrieve_research intent.
   * Accepts either a researchId or a keyword (or neither to return all).
   */
  async processRetrieveResearchIntent(userInput, chatId) {
    try {
      const researchService = new ResearchService();
      const result = await researchService.retrieveResearch(userInput);
      await this.bot.sendMessage(chatId, `Research retrieval successful.`);
      return result;
    } catch (error) {
      console.error("Error retrieving research:", error);
      throw error;
    }
  }

  /**
   * Processes a delete_research intent.
   * Deletes a research record by researchId.
   */
  async processDeleteResearchIntent(userInput, chatId) {
    try {
      const researchService = new ResearchService();
      const result = await researchService.deleteResearch(userInput);
      await this.bot.sendMessage(chatId, result.message);
      return result;
    } catch (error) {
      console.error("Error deleting research:", error);
      throw error;
    }
  }

  /**
   * processSaveTaskIntent
   * -----------------------
   * Accepts user input (from API or chatbot intent) to save a new task.
   * The AI model should pass its conversation context as the content.
   */
  async processSaveTaskIntent(userInput, chatId) {
    try {
      const task = await tasksService.createTask({ telegramId: chatId, ...userInput });
      await this.bot.sendMessage(
        chatId,
        `✅ Task saved with ID: ${task._id}\nScheduled for: ${new Date(task.dueTime).toLocaleString()}`
      );
      return task;
    } catch (error) {
      console.error("Error saving task:", error);
      throw error;
    }
  }

  /**
   * processRetrieveTaskIntent
   * ---------------------------
   * Retrieves tasks for a user. If taskId is provided, returns that specific task;
   * otherwise, returns all tasks for the user.
   */
  async processRetrieveTaskIntent(userInput, chatId) {
    try {
      const tasks = await tasksService.retrieveTasks({ telegramId: chatId, ...userInput });
      await this.bot.sendMessage(chatId, `✅ Retrieved ${Array.isArray(tasks) ? tasks.length : 1} task(s).`);
      return tasks;
    } catch (error) {
      console.error("Error retrieving tasks:", error);
      throw error;
    }
  }  

  /**
   * processExecuteTaskIntent
   * --------------------------
   * Executes a specific task by its taskId. This function triggers the
   * Unified Autonomous Engine call and updates the task based on the result.
   */
  async processExecuteTaskIntent(userInput, chatId) {
    try {
      const task = await tasksService.executeTask({ telegramId: chatId, ...userInput });
      await this.bot.sendMessage(chatId, `✅ Task ${task._id} marked as completed.`);
      return task;
    } catch (error) {
      console.error("Error executing task:", error);
      throw error;
    }
  }  

  /**
   * processDeleteTaskIntent
   * -------------------------
   * Deletes a specific task by its taskId for the user.
   */
  async processDeleteTaskIntent(userInput, chatId) {
    try {
      const task = await tasksService.deleteTask({ telegramId: chatId, ...userInput });
      await this.bot.sendMessage(chatId, `✅ Task ${task._id} has been deleted successfully.`);
      return task;
    } catch (error) {
      console.error("Error deleting task:", error);
      throw error;
    }
  }  

  /**
   * Subscribe a user for new token notifications.
   * @param {string} userId 
   * @param {string} chatId 
   * @param {object} criteria 
   */
  async subscribeNewToken(userId, chatId, criteria = {}) {
    try {
      const result = pumpFunService.subscribeNewToken(userId, chatId, criteria);
      return result;
    } catch (error) {
      console.error("Error in subscribeNewToken:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Unsubscribe a user from new token notifications.
   * @param {string} userId 
   */
  async unsubscribeNewToken(userId) {
    try {
      const result = pumpFunService.unsubscribeNewToken(userId);
      return result;
    } catch (error) {
      console.error("Error in unsubscribeNewToken:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Subscribe a user for token trade notifications.
   * @param {string} userId 
   * @param {string} chatId 
   * @param {object} criteria 
   * @param {string[]} contractAddresses 
   */
  async subscribeTokenTrade(userId, chatId, criteria = {}, contractAddresses = []) {
    try {
      const result = pumpFunService.subscribeTokenTrade(userId, chatId, criteria, contractAddresses);
      return result;
    } catch (error) {
      console.error("Error in subscribeTokenTrade:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Unsubscribe a user from token trade notifications.
   * @param {string} userId 
   * @param {string[]} contractAddresses 
   */
  async unsubscribeTokenTrade(userId, contractAddresses = []) {
    try {
      const result = pumpFunService.unsubscribeTokenTrade(userId, contractAddresses);
      return result;
    } catch (error) {
      console.error("Error in unsubscribeTokenTrade:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Execute a trade.
   * @param {object} options - Trade options.
   */
  async executePumpfunTrade(userId, chatId, options) {
    // Set default pool option.
    options.pool = "auto";
  
    // Retrieve the user's Solana wallet.
    const walletAddresses = await walletService.getWallets(userId);
    const solWallets = walletAddresses.solana || [];
    if (solWallets.length === 0) {
      return { success: false, message: "No Solana wallet available for user." };
    }
    options.publicKey = solWallets[0].address; // Use the first Solana wallet.
  
    try {
      // Retrieve user document.
      const user = await User.findOne({ telegramId: userId });
      if (!user || !user.wallets) {
        return { success: false, message: "User wallet not found." };
      }
  
      // Retrieve wallet data for Solana.
      const networkKey = "solana";
      const walletData =
        user.wallets[networkKey] && user.wallets[networkKey].length > 0
          ? user.wallets[networkKey][0]
          : null;
      if (!walletData || !walletData.encryptedPrivateKey) {
        return { success: false, message: `Encrypted private key missing for network: ${networkKey}` };
      }
  
      // Decrypt the private key.
      let privateKey = decrypt(walletData.encryptedPrivateKey);
      if (!privateKey) {
        if (/^(0x)?[0-9a-fA-F]{64}$/.test(walletData.encryptedPrivateKey)) {
          privateKey = walletData.encryptedPrivateKey;
        } else {
          return { success: false, message: "Failed to decrypt or retrieve a valid private key." };
        }
      }
      options.privateKey = privateKey;
  
      // Execute the trade via PumpFun service.
      const result = await pumpFunService.executeTrade(options);
      
      // Check if trade execution was successful.
      if (!result.success) {
        return { success: false, message: `Trade failed: ${result.error || "Unknown error"}` };
      }
  
      // Truncate transaction signature for display.
      const truncatedSignature = result.signature
        ? `${result.signature.slice(0, 6)}...${result.signature.slice(-6)}`
        : "N/A";
  
      // Build the notification message with a clickable transaction link.
      const txnLink = result.signature
        ? `[${truncatedSignature}](https://solscan.io/tx/${result.signature})`
        : "Transaction failed";
  
      const coolMessage = `🚀 *Aping on PumpFun!*  
      ✅ *Trade Successful!*  
      
      *Action:* ${options.action}  
      *Mint:* \`${options.mint}\`  
      *Amount:* \`${options.amount}\`  
      🔗 *Txn:* ${txnLink}  
      
      🔥 *Happy Pump!* 🚀`;
  
      // Send the message to the user.
      await safeSendMessage(bot, chatId, message, { parse_mode: "Markdown" });
  
      return result;
    } catch (error) {
      console.error("Error in executePumpfunTrade:", error);
      return { success: false, message: error.message };
    }
  }  

  async getPumpfunTokenRanged(userId, chatId, args) {
    // Default to 24 hours ago if startTime isn’t provided.
    const startTime = args.startTime ? new Date(args.startTime) : new Date(Date.now() - 24 * 60 * 60 * 1000);
    // Default to now if endTime isn’t provided.
    const endTime = args.endTime ? new Date(args.endTime) : new Date();
  
    try {
      // Retrieve tokens for the specified period.
      const pumpfunDBresults = await pumpFunService.getTokensByPeriod(startTime, endTime);
      if (!pumpfunDBresults.success) {
        throw new Error(pumpfunDBresults.error);
      }
  
      // Prepare the JSON file data.
      const jsonData = JSON.stringify(pumpfunDBresults.tokens, null, 2);
      const buffer = Buffer.from(jsonData, "utf-8");
  
      // Send the JSON file to the user via Telegram.
      await bot.telegram.sendDocument(chatId, { source: buffer }, { filename: "pumpfun_tokens.json" });
      return { success: true };
    } catch (error) {
      console.error("Pumpfun query calling error:", error.message);
      return { success: false, error: error.message };
    }
  }
  
  async getPumpfunTokenLiquidity(userId, chatId, args) {
    // Expect a liquidity threshold in SOL.
    const minLiquiditySOL = args.minLiquidity;
    if (minLiquiditySOL === undefined) {
      console.error("No minimum liquidity provided.");
      return { success: false, error: "No minimum liquidity provided." };
    }
    
    try {
      // Retrieve tokens based on liquidity threshold.
      const tokensResult = await pumpFunService.getTokensByLiquidity(minLiquiditySOL);
      if (!tokensResult.success) {
        throw new Error(tokensResult.error);
      }
      
      // Limit results to 300 tokens.
      const limitedTokens = tokensResult.tokens.slice(0, 300);
      
      // Prepare the JSON file data.
      const jsonData = JSON.stringify(limitedTokens, null, 2);
      const buffer = Buffer.from(jsonData, "utf-8");
  
      // Send the JSON file to the user via Telegram.
      await bot.telegram.sendDocument(chatId, { source: buffer }, { filename: "pumpfun_tokens_liquidity.json" });
      return { success: true };
    } catch (error) {
      console.error("Pumpfun liquidity query calling error:", error.message);
      return { success: false, error: error.message };
    }
  }  

  // Web Scrap - FireCrawl
  async trendingTokensScrapped(userId) {
    try {
      // To scrape fixed URLs:
      const trendingResult = await networkScraper.networkScrap();
      // trendingResult.results will be an array of objects with each URL's scraped markdown and metadata.
      return trendingResult;
    } catch (error) {
      console.error("Bot sendMessage error:", error.message);
      return null;
    }
  }

  async urlScrapper(userId, input) {
    try {
      // To scrape fixed URLs:
      const scrapResult = await networkScraper.scrapeProvidedUrl(input);
      // scrapResult.results will be an array of objects with each URL's scraped markdown and metadata.
      return scrapResult;
    } catch (error) {
      console.error("Bot sendMessage error:", error.message);
      return null;
    }
  }

  async safeSendMessage(bot, chatId, text, options) {
    try {
      return await bot.sendMessage(chatId, text, options);
    } catch (error) {
      console.error("Bot sendMessage error:", error.message);
      return null;
    }
  }

  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const intentProcessor = new IntentProcessor();