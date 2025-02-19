import { User } from "../../../models/User.js";
import { decrypt } from "../../../utils/encryption.js";
import { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import bs58 from "bs58";
import { JupiterQuickNode, getTokenDecimals } from "../../trading/JupiterQuickNode.js";

// This helper takes a human-readable decimal string (e.g. "0.005")
// and converts it to the smallest unit (an integer string) based on the token’s decimals.
// For SOL, 1 SOL = 1e9 lamports; for other tokens the conversion factor is determined by getTokenDecimals.
async function convertToSmallestUnit(amountHuman, mintAddress, connection) {
    
    // Parse the input value
    const value = parseFloat(amountHuman);
    if (isNaN(value) || value <= 0) {
      throw new Error("Invalid amount provided. Must be a positive number.");
    }
    // Get the decimals for the token (using our cached helper)
    const decimals = await getTokenDecimals(mintAddress, connection);
    const factor = Math.pow(10, decimals);
  
    // Multiply and floor to get an integer value
    const smallest = Math.floor(value * factor);
    return smallest.toString();
}
  
export class SwapController {
  constructor(bot) {
    this.bot = bot;
    this.jupiterQuickNode = new JupiterQuickNode(bot);
  }

  async swapTokens(userId, params) {
    console.log("🔄 Swap Parameters:", JSON.stringify(params, null, 2));
    if (!params.wallet || !params.inputMint || !params.outputMint || !params.amount) {
      throw new Error('Missing required parameters: wallet, inputMint, outputMint, and amount are mandatory.');
    }
  
    try {
      // 1. Notify start
      await this.sendTransactionUpdate(userId, "start");
  
      // 2. Retrieve user & check Solana wallets
      const user = await User.findOne({ telegramId: userId });
      if (!user || !user.wallets || !user.wallets.solana) {
        throw new Error('User wallet not found for Solana.');
      }
  
      // 3. Grab the "encryptedPrivateKey" from the first Solana wallet
      const key = user.wallets.solana[0]?.encryptedPrivateKey;
      if (!key) throw new Error("Encrypted private key not found.");
  
      // 4. Check if already unencrypted (Base58 or hex) or if we need to decrypt
      let needsDecryption = true;
      // - 44-char base58 typical for Solana
      const isBase58 = (key.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(key));
      // - 128-char hex
      const isHex128 = (key.length === 128 && /^[0-9a-fA-F]+$/.test(key));
  
      if (isBase58 || isHex128) {
        needsDecryption = false;
      }
  
      const processedKey = needsDecryption ? decrypt(key) : key;
      if (!processedKey) throw new Error("Failed to decrypt private key.");
  
      // 5. Convert processed key to a Uint8Array for Keypair.fromSecretKey
      const secretKeyUint8 = /^[0-9a-fA-F]{128}$/.test(processedKey)
        ? Uint8Array.from(Buffer.from(processedKey, 'hex'))
        : bs58.decode(processedKey);
  
      // 6. Reconstruct the wallet
      const wallet = Keypair.fromSecretKey(secretKeyUint8);
      const publicKey = wallet.publicKey.toBase58();
      console.log("✅ Solana Wallet Reconstructed:", publicKey);
  
      // 7. Check balance
      const walletBalance = await this.jupiterQuickNode.solanaConnection.getBalance(wallet.publicKey);
      const readableBalance = (walletBalance / LAMPORTS_PER_SOL).toFixed(5);
      const MIN_BALANCE_THRESHOLD = 0.0008; // in SOL
  
      if (walletBalance < MIN_BALANCE_THRESHOLD * LAMPORTS_PER_SOL) {
        throw new Error(
          `Insufficient SOL balance to cover transaction fees. ` +
          `At least ${MIN_BALANCE_THRESHOLD.toFixed(5)} SOL required, ` +
          `but wallet has only ${readableBalance} SOL.`
        );
      }
  
      // 8. Convert the human-readable amount (e.g., "0.005") to smallest unit.
      params.amount = await convertToSmallestUnit(
        params.amount,
        params.inputMint,
        this.jupiterQuickNode.solanaConnection
      );
  
      // 9. Notify that we're processing swap
      await this.sendTransactionUpdate(userId, "swap_processing", {
        amount: params.amount,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
      });
  
      // 10. Perform the swap via Jupiter
      const swapResult = await this.jupiterQuickNode.startJupiterSwap({
        wallet,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        amount: params.amount,
        userId,
      });
  
      // 11. On success
      await this.sendTransactionUpdate(userId, "swap_success", {
        amount: params.amount,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        explorerLink: swapResult.txId,
      });
  
      return { swapResult };
    } catch (error) {
      console.error('❌ Error during token swap:', error.message);
      await this.sendTransactionUpdate(userId, "error", { errorMessage: error.message });
      throw new Error('Failed to complete swap.');
    }
  }

  async sendTransactionUpdate(userId, stage, details = {}) {
    const messages = {
      start: "🔄 **Initiating Swap...**\n\n🧑‍💻 Please wait...",
      fetch_wallet: "🔍 **Fetching Wallet Details**\n\n🔑 Retrieving your encrypted private key...",
      decrypt_key: "🔓 **Decrypting Wallet**\n\n✅ Successfully decrypted your wallet key!",
      wallet_ready: `✅ **Wallet Reconstructed!**\n\n🔹 Public Key: \`${details.publicKey}\``,
      swap_processing: `💱 **Constructing Swap...**\n\n🔄 Swapping **${details.amount}** tokens from **${details.inputMint}** to **${details.outputMint}**.\n\n⏳ Please wait while we execute the transaction.`,
      error: `🚨 **Swap Flopped!**\n\n⚠️ Here's why: ${details.errorMessage}`,
      // We'll use a sticker for swap_success.
      swap_success: "STICKER",
    };
  
    let message = messages[stage] || `ℹ️ **Status Update:** ${stage}`;
  
    try {
      if (stage === "swap_success") {
        // Array of celebration sticker IDs.
        const stickerIds = [
          "CAACAgEAAxkBAAJDtGegkogm2PoQjRtQikal786JoOQTAAL6AQACjLEgRHhzeIjneBzENgQ",
          "CAACAgIAAxkBAAJDtWegkqYpfviNpH80P3WRZJFEj-QtAAJFCwACyHYZS1547k877Kz7NgQ",
          "CAACAgIAAxkBAAJDumeglJUqiICUrK1CP8vW7HxYAXDpAAJjAANOXNIpRcBzCXnlr_A2BA",
          "CAACAgIAAxkBAAJDu2eglKwW0PCYsMQjsp3EFKtXUxPkAALKDwACSyiRSc1Ng9DJ7M7cNgQ",
          "CAACAgIAAxkBAAJDwGegl3Y58zwa5IoLrZE1iyNQEyw7AAKJAAMWQmsKRsvaWiyCsI42BA",
          "CAACAgIAAxkBAAJDwWegl-TkePOwxQtQpyi9XXmwunMqAAI2FgACXEDYS9tGbtLdlXoNNgQ",
          "CAACAgIAAxkBAAJDv2egltGjkwgjBQKUfBQPE3N8VsNYAAICFQACOsFQSbdMkgm_6KgTNgQ",
        ];
        const randomSticker = stickerIds[Math.floor(Math.random() * stickerIds.length)];
  
        // 1) Send the sticker
        const stickerMsg = await this.bot.sendSticker(userId, randomSticker);
  
        // 2) Schedule removal after 6s, but CATCH any errors
        setTimeout(() => {
          this.bot
            .deleteMessage(userId, stickerMsg.message_id)
            .catch((err) => {
              console.error("❌ Error deleting sticker message:", err.message);
            });
        }, 6000);
  
        // Optionally send a follow-up text to confirm success
        await this.bot.sendMessage(
          userId,
          "✅ **Swap Completed Successfully!**\n" +
            "Here’s your transaction link:\n" +
            (details.explorerLink || "No TX link"),
          { parse_mode: "Markdown" }
        );
      } else {
        // For other stages, send text
        await this.bot.sendMessage(userId, message, { parse_mode: "Markdown" });
      }
    } catch (err) {
      console.error("❌ Error sending transaction update:", err.message);
    }
  }    
}
