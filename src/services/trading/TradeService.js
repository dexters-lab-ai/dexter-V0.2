import { bot } from "../../core/bot.js";
import { EventEmitter } from "events";
import { walletService } from "../wallet/index.js"; // If you have a separate walletService
import { evmQuickNode } from "./EthereumQuicknode.js"; 
import { JupiterQuickNode } from "./JupiterQuickNode.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { User } from "../../models/User.js";
import { Wallet } from "ethers";
import { decrypt } from "../../utils/encryption.js";

// --- For Solana transfers:
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getMint,
  getOrCreateAssociatedTokenAccount,
  TOKEN_PROGRAM_ID,
  transfer as splTokenTransfer,
} from "@solana/spl-token";
import { config } from "../../core/config.js";

/**
 * The TradeService coordinates:
 *  - Buying, Selling, or Transferring EVM tokens/currencies using evmQuickNode
 *  - Buying, Selling, or Transferring Solana tokens using JupiterQuickNode or raw Solana methods
 */
export class TradeService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;

    // Our new helpers for EVM & Solana
    this.evmQuickNode = evmQuickNode;                   // re-used EVM helper
    this.jupiterQuickNode = new JupiterQuickNode(bot); 
  }

  async initialize() {
    if (this.initialized) return;
    // If you need extra init steps, place them here
    this.initialized = true;
  }

  /**
   * Main entry: Execute a "trade" or "transfer" by routing based on network.
   * Fetches the user's wallet, then calls the correct function for EVM or Solana.
   */
  async executeTrade(params) {
    try {
      // Validate core fields
      await this.validateTradeParams(params);

      // 1) Get user wallet for the target network
      const walletObj = params.walletObj;

      // 2) Route by network & action
      if (params.network === "solana") {
        if (params.action === "transfer") {
          return await this.transferSolana(params, walletObj);
        } else {
          // buy / sell => Jupiter swap
          return await this.executeSolanaTradeWithWallet(params, walletObj);
        }
      } else {
        // EVM networks
        if (params.action === "transfer") {
          return await this.executeEvmTransferWithWallet(params, walletObj);
        } else {
          // buy / sell => EVM swap
          return await this.executeEvmTradeWithWallet(params, walletObj);
        }
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // ----------------------------------------------------------------------
  // EVM FLOW
  // ----------------------------------------------------------------------

  /**
   * executeEvmTradeWithWallet
   * Executes an EVM trade (swap) using a pre-fetched wallet object.
   * - If `action === "buy"`, we interpret that as swapping "native → tokenAddress".
   * - If `action === "sell"`, we interpret that as swapping "tokenAddress → native".
   */
  async executeEvmTradeWithWallet(params, walletObj) {
    const inputToken = params.action === "buy" ? "ETH" : params.tokenAddress;
    const outputToken = params.action === "buy" ? params.tokenAddress : "ETH";

    // The evmQuickNode expects an object with:
    //   { network, wallet, inputToken, outputToken, amount, userId, tokenList? }
    return await this.evmQuickNode.startEVMSwap({
      network: params.network,
      wallet: walletObj.signer, // Ethers.js wallet signer
      inputToken,
      outputToken,
      amount: params.amount,
      userId: params.userId,
      tokenList: params.tokenList || []
    });
  }

  /**
   * executeEvmTransferWithWallet
   * Simple EVM token or native transfer using the newly introduced helper methods
   * in evmQuickNode (see "sendEvmNativeTransfer" and "sendEvmTokenTransfer").
   */
  async executeEvmTransferWithWallet(params, walletObj) {
    if (!params.recipient) {
      throw new Error("Recipient is required for an EVM transfer");
    }
    const network = params.network;
    let receipt;
    if (params.tokenAddress === "native" || params.tokenAddress === "ETH") {
      // Native transfer
      receipt = await this.evmQuickNode.sendEvmNativeTransfer({
        wallet: walletObj.signer,
        to: params.recipient,
        amount: params.amount
      });
    } else {
      // Token transfer
      receipt = await this.evmQuickNode.sendEvmTokenTransfer({
        wallet: walletObj.signer,
        tokenAddress: params.tokenAddress,
        to: params.recipient,
        amount: params.amount
      });
    }

    return {
      hash: receipt.transactionHash || receipt.hash, // depending on how you structure your returns
      success: receipt.status === 1,
      link: this.buildBlockExplorerLink(network, receipt.transactionHash || receipt.hash)
    };
  }

  // ----------------------------------------------------------------------
  // SOLANA FLOW
  // ----------------------------------------------------------------------

  /**
   * executeSolanaTradeWithWallet
   * Executes a Solana trade (swap) using Jupiter.
   * - If `action === "buy"`, we interpret that as swapping "SOL → tokenAddress".
   * - If `action === "sell"`, we interpret that as swapping "tokenAddress → SOL".
   */
  async executeSolanaTradeWithWallet(params, walletObj) {
    console.log('[executeSolanaTradeWithWallet] Called with params:', JSON.stringify(params, null, 2));
    console.log('[executeSolanaTradeWithWallet] Wallet object:', JSON.stringify(walletObj, null, 2));
  
    // Call Jupiter swap using the provided parameters and wallet.
    const result = await this.jupiterQuickNode.startJupiterSwap({
      wallet: walletObj._keypair, // pass the ~full~ Keypair object for Solana
      inputMint:
        params.action === "buy"
          ? "So11111111111111111111111111111111111111112" // 'native' SOL mint
          : params.tokenAddress,
      outputMint:
        params.action === "buy"
          ? params.tokenAddress
          : "So11111111111111111111111111111111111111112",
      amount: params.amount,
      userId: params.userId
    });
  
    console.log('[executeSolanaTradeWithWallet] Jupiter swap result:', result);
    return result;
  }  

  /**
   * transferSolana
   * Send a "native" SOL transfer or an SPL token transfer using standard @solana/web3.js + @solana/spl-token.
   */
  async transferSolana(params, walletObj) {
    if (!params.recipient) {
      throw new Error("Recipient is required for a Solana transfer");
    }

    const connection = new Connection(config.solanaEndpoint, "confirmed");
    const fromKeypair = walletObj; // in getWalletForTrade, we return { address, signer: null, ... } for Solana
    const fromPublicKey = new PublicKey(fromKeypair.address);
    const toPubkey = new PublicKey(params.recipient);

    // Build transaction
    const transaction = new Transaction();

    if (
      params.tokenAddress === "native" ||
      params.tokenAddress === "So11111111111111111111111111111111111111112"
    ) {
      // Native SOL transfer
      const lamports = parseFloat(params.amount) * LAMPORTS_PER_SOL;
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: fromPublicKey,
          toPubkey,
          lamports: lamports
        })
      );
    } else {
      // SPL token transfer
      const tokenMintAddress = new PublicKey(params.tokenAddress);
      const mintInfo = await getMint(connection, tokenMintAddress);

      // Ensure associated token account for recipient
      const toTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        fromKeypair,        // payer
        tokenMintAddress,
        toPubkey
      );

      // Ensure associated token account for sender
      const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        fromKeypair,        // payer
        tokenMintAddress,
        fromPublicKey
      );

      const decimalFactor = 10 ** mintInfo.decimals;
      const tokenAmount = parseFloat(params.amount) * decimalFactor;

      transaction.add(
        splTokenTransfer(
          fromTokenAccount.address,
          toTokenAccount.address,
          tokenAmount,
          fromPublicKey,
          [],
          TOKEN_PROGRAM_ID
        )
      );
    }

    // Send & confirm
    transaction.feePayer = fromPublicKey;
    const latestBlockhash = await connection.getLatestBlockhash();
    transaction.recentBlockhash = latestBlockhash.blockhash;

    // Sign
    transaction.sign(fromKeypair);

    const txSignature = await sendAndConfirmTransaction(connection, transaction, [fromKeypair], {
      skipPreflight: false
    });

    return {
      hash: txSignature,
      success: true,
      link: `https://solscan.io/tx/${txSignature}`
    };
  }

  // ----------------------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------------------

  /**
   * Retrieves the user's wallet for a given network from MongoDB.
   * - For EVM networks: create an Ethers.js Wallet Signer
   * - For Solana: return a Keypair
  */
  async getWalletForTrade(userId, network) {
    const networkKey = network.toLowerCase();
    const user = await User.findOne({ telegramId: userId.toString() });
    if (!user || !user.wallets) {
      throw new Error("User wallet not found.");
    }
  
    const walletData =
      user.wallets[networkKey] && user.wallets[networkKey].length > 0
        ? user.wallets[networkKey][0]
        : null;
  
    if (!walletData) {
      throw new Error(`No wallet data found for network: ${network}`);
    }
  
    if (networkKey === "solana") {
      if (!walletData.encryptedPrivateKey) {
        throw new Error("Encrypted Solana private key missing");
      }
      // Use our helper to check if the key is already decrypted.
      const rawStr = await this.processSolanaKey(walletData.encryptedPrivateKey);
      let secretKey;
      // If the key is a valid 128-character hex string, convert it.
      if (/^[0-9a-fA-F]+$/.test(rawStr) && rawStr.length === 128) {
        secretKey = new Uint8Array(rawStr.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
      } else {
        try {
          // Attempt to parse as JSON (expecting an array)
          const arr = JSON.parse(rawStr);
          if (!Array.isArray(arr)) {
            throw new Error("Expected an array from JSON");
          }
          secretKey = new Uint8Array(arr);
        } catch (err) {
          // Fallback: assume rawStr is a base58 string
          const bs58 = await import("bs58");
          secretKey = bs58.default.decode(rawStr);
        }
      }
      const solanaKeypair = Keypair.fromSecretKey(secretKey);
      return {
        ...solanaKeypair,
        address: solanaKeypair.publicKey.toBase58(),
      };
    } else {
      // EVM branch
      if (!walletData.encryptedPrivateKey)
        throw new Error("Encrypted private key missing for network: " + network);
      let privateKey;
      // If the key is already a valid 64-character hex string (with or without 0x), use it directly.
      if (/^(0x)?[0-9a-fA-F]{64}$/.test(walletData.encryptedPrivateKey)) {
        privateKey = walletData.encryptedPrivateKey;
      } else {
        // Otherwise, decrypt it.
        privateKey = decrypt(walletData.encryptedPrivateKey);
      }
      if (!privateKey || !/^(0x)?[0-9a-fA-F]{64}$/.test(privateKey)) {
        throw new Error("Failed to decrypt or retrieve a valid private key.");
      }
  
      const signerProvider = await walletService.getProvider(network);
      if (!signerProvider) {
        throw new Error(`No provider configured for network: ${network}`);
      }
  
      const ethersWallet = new Wallet(privateKey, signerProvider);
      return { address: walletData.address, signer: ethersWallet };
    }
  }
  
  async processSolanaKey(key) {
    // If the key is already a valid base58 string (44 characters matching the regex), return it.
    if (key.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(key)) {
      return key;
    }
    // Also, if the key is already a valid hex string of length 128, return it.
    if (/^[0-9a-fA-F]+$/.test(key) && key.length === 128) {
      return key;
    }
    // Otherwise, decrypt the key.
    let decrypted = decrypt(key);
    if (typeof decrypted !== "string") {
      decrypted = String(decrypted);
    }
    return decrypted;
  }   

  /**
   * Basic validation for trade parameters.
   */
  async validateTradeParams(params) {
    const required = ["network", "action", "tokenAddress", "amount", "userId"];
    const missing = required.filter((field) => !params[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required parameters: ${missing.join(", ")}`);
    }
    if (!["buy", "sell", "transfer"].includes(params.action)) {
      throw new Error('Invalid action. Must be "buy", "sell", or "transfer"');
    }
  }

  buildBlockExplorerLink(network, txHash) {
    switch (network.toLowerCase()) {
      case "ethereum":
        return `https://etherscan.io/tx/${txHash}`;
      case "base":
        return `https://basescan.org/tx/${txHash}`;
      // Add more explorers as needed
      default:
        return "";
    }
  }
}

export const tradeService = new TradeService();
