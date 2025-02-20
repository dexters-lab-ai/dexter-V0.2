import { EventEmitter } from "events";
import { walletService } from "../wallet/index.js";
import { quickNodeService } from "../quicknode/QuickNodeService.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { JupiterQuickNode } from "./JupiterQuickNode.js";
import { evmQuickNode } from "./EthereumQuicknode.js";
import { User } from "../../models/User.js";
import { Wallet } from "ethers";
import { decrypt } from "../../utils/encryption.js";

export class TradeService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.jupiterQuickNode = new JupiterQuickNode();
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * executeTrade
   * ------------
   * Main entry: Execute a "trade" or "transfer" by routing based on network.
   * Fetches the user's wallet once and passes it along.
   *
   * @param {Object} params - See existing docs.
   * @returns {Promise<Object>} Result of trade execution.
   */
  async executeTrade(params) {
    try {  
      // Fetch the wallet once.
      const walletObj = await this.getWalletForTrade(params.userId, params.network);
      // Route to the appropriate trade function using the pre-fetched wallet.
      if (params.network === 'solana') {
        return await this.executeSolanaTradeWithWallet(params, walletObj);
      } else {
        return await this.executeEvmTradeWithWallet(params, walletObj);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // -----------------------------------------------
  // E V M   F L O W
  // -----------------------------------------------
  async executeEvmFlow(params) {
    if (params.action === "transfer") {
      return await this.executeEvmTransfer(params);
    } else {
      // buy / sell => perform swap logic
      return await this.executeEvmTrade(params);
    }
  }

  /**
   * Execute an EVM token or native transfer.
   */
  async executeEvmTransfer(params) {
    if (!params.recipient) {
      throw new Error("Recipient is required for an EVM transfer");
    }
    const provider = await walletService.getProvider(params.network);
    if (params.tokenAddress === "native") {
      const result = await quickNodeService.evm.sendNativeTransfer({
        provider,
        from: params.walletAddress,
        to: params.recipient,
        amount: params.amount,
      });
      return {
        hash: result.txHash,
        success: true,
        link: this.buildBlockExplorerLink(params.network, result.txHash),
      };
    } else {
      const result = await quickNodeService.evm.sendTokenTransfer({
        provider,
        from: params.walletAddress,
        to: params.recipient,
        tokenAddress: params.tokenAddress,
        amount: params.amount,
      });
      return {
        hash: result.txHash,
        success: true,
        link: this.buildBlockExplorerLink(params.network, result.txHash),
      };
    }
  }

  /**
   * executeEvmTradeWithWallet
   * -------------------------
   * Executes an EVM trade (swap) using a pre-fetched wallet object.
   *
   * @param {Object} params - Trade parameters.
   * @param {Object} walletObj - Pre-fetched wallet object with signer.
   * @returns {Promise<Object>} - Result of swap execution.
   */
  async executeEvmTradeWithWallet(params, walletObj) {
    // Build swap parameters.
    const swapParams = {
      network: params.network,
      wallet: walletObj.signer, // Use the EVM signer.
      inputToken: params.action === 'buy' ? 'native' : params.tokenAddress,
      outputToken: params.action === 'buy' ? params.tokenAddress : 'native',
      amount: params.amount,
      userId: params.userId,
      tokenList: params.tokenList || []
    };
    return await evmQuickNode.startEVMSwap(swapParams);
  }

  /**
   * executeSolanaTradeWithWallet
   * ----------------------------
   * Executes a Solana trade (swap) using a pre-fetched wallet object.
   *
   * @param {Object} params - Trade parameters.
   * @param {Object} walletObj - Pre-fetched wallet object (no signer needed for Solana).
   * @returns {Promise<Object>} - Result of swap execution.
   */
  async executeSolanaTradeWithWallet(params, walletObj) {
    return await this.jupiterQuickNode.startJupiterSwap({
      wallet: walletObj, // For Solana, we pass the wallet instance directly.
      inputMint: params.action === 'buy'
        ? 'So11111111111111111111111111111111111111112'
        : params.tokenAddress,
      outputMint: params.action === 'buy'
        ? params.tokenAddress
        : 'So11111111111111111111111111111111111111112',
      amount: params.amount,
      userId: params.userId
    });
  }

  /**
   * getWalletForTrade
   * -----------------
   * Retrieves the user's wallet for a given network.
   * For EVM networks: decrypts the private key (or uses it directly if valid) and creates an Ethers.js signer.
   * For Solana, returns the wallet info directly.
   *
   * @param {string} userId - Telegram user ID.
   * @param {string} network - Target network (e.g. "ethereum", "solana").
   * @returns {Promise<Object>} - { address, signer (or null), network }
   */
  async getWalletForTrade(userId, network) {
    const networkKey = network.toLowerCase();
    const user = await User.findOne({ telegramId: userId.toString() });
    if (!user || !user.wallets) {
      throw new Error("User wallet not found.");
    }
    const walletData = (user.wallets[networkKey] && user.wallets[networkKey].length > 0)
      ? user.wallets[networkKey][0]
      : null;
    if (!walletData) {
      throw new Error(`No wallet data found for network: ${network}`);
    }
  
    if (networkKey !== "solana") {
      if (!walletData.encryptedPrivateKey)
        throw new Error("Encrypted private key missing for network: " + network);
      let privateKey = decrypt(walletData.encryptedPrivateKey);
      if (!privateKey) {
        if (/^(0x)?[0-9a-fA-F]{64}$/.test(walletData.encryptedPrivateKey)) {
          privateKey = walletData.encryptedPrivateKey;
        } else {
          throw new Error("Failed to decrypt or retrieve a valid private key.");
        }
      }
      const provider = await tradeService.getProvider(network);
      if (!provider) throw new Error(`No provider configured for network: ${network}`);
      const walletSigner = new Wallet(privateKey, provider);
      return { address: walletData.address, signer: walletSigner, network };
    } else {
      return { address: walletData.address, signer: null, network };
    }
  }

  // -----------------------------------------------
  // S O L A N A   F L O W
  // -----------------------------------------------
  async executeSolanaFlow(params) {
    if (params.action === "transfer") {
      return await this.transferSolana(params);
    } else {
      return await this.executeSolanaTrade(params);
    }
  }

  async transferSolana(params) {
    if (!params.recipient) {
      throw new Error("Recipient is required for a Solana transfer");
    }
    const result = await quickNodeService.solana.sendTransfer({
      fromPubkey: params.walletAddress,
      toPubkey: params.recipient,
      tokenMint: params.tokenAddress,
      amount: params.amount,
    });
    return {
      hash: result.signature,
      success: true,
      link: `https://solscan.io/tx/${result.signature}`,
    };
  }

  async executeSolanaTrade(params) {
    // Fetch the wallet for Solana if not already provided.
    const walletObj = await this.getWalletForTrade(params.userId, 'solana');
    return await this.executeSolanaTradeWithWallet(params, walletObj);
  }

  // -----------------------------------------------
  // MULTIPLE SWAPS (SOLANA)
  // -----------------------------------------------
  async executeMultipleSwaps(swaps) {
    try {
      if (!swaps.every((s) => s.network === "solana")) {
        throw new Error("Multiple swaps only supported on Solana");
      }
      const results = [];
      for (const swap of swaps) {
        const singleResult = await this.executeSolanaTrade(swap);
        results.push({ swap, success: true, hash: singleResult.hash });
      }
      return results;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // -----------------------------------------------
  // HELPERS
  // -----------------------------------------------
  async validateTradeParams(params) {
    const required = ["network", "action", "tokenAddress", "amount", "walletAddress"];
    const missing = required.filter((field) => !params[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required parameters: ${missing.join(", ")}`);
    }
    if (!["buy", "sell", "transfer"].includes(params.action)) {
      throw new Error('Invalid action. Must be "buy", "sell", or "transfer"');
    }
    if (!["ethereum", "base", "solana"].includes(params.network)) {
      throw new Error("Invalid network");
    }
  }

  buildBlockExplorerLink(network, txHash) {
    switch (network) {
      case "ethereum":
        return `https://etherscan.io/tx/${txHash}`;
      case "base":
        return `https://basescan.org/tx/${txHash}`;
      default:
        return "";
    }
  }
}

export const tradeService = new TradeService();
