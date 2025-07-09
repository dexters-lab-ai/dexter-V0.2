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
      const isBase58 = (key.length === 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(key));
      const isHex128 = (key.length === 128 && /^[0-9a-fA-F]+$/.test(key));
      if (isBase58 || isHex128) { needsDecryption = false; }
  
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
        console.log(' * * insufficient balance * * ', + walletBalance );
        throw new Error(
          `Insufficient SOL balance to cover transaction fees. ` +
          `At least ${MIN_BALANCE_THRESHOLD.toFixed(5)} SOL required, ` +
          `but wallet has only ${readableBalance} SOL.`
        );
      }
  
      // 8. Convert the human-readable amount to smallest unit.
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
  
      // 11. On success, send a sticker (which is not deleted) and then a text follow‑up that gets deleted.
      await this.sendTransactionUpdate(userId, "swap_success", {
        amount: params.amount,
        inputMint: params.inputMint,
        outputMint: params.outputMint,
        explorerLink: swapResult.txId,
      });
      
      return swapResult;
    } catch (error) {
      console.error('❌ Error during token swap:', error.message);
      await this.sendTransactionUpdate(userId, "error", { errorMessage: error.message });
      throw new Error('Failed to complete swap: Jupiter says, ' + error);
    }
  }
  
  async sendTransactionUpdate(userId, stage, details = {}) {
    // Define messages for each stage
    const messages = {
      start: "🔄 **Initiating Swap...**\n\n🧑‍💻 Please wait...",
      fetch_wallet: "🔍 **Fetching Wallet Details**\n\n🔑 Retrieving your encrypted private key...",
      decrypt_key: "🔓 **Decrypting Wallet**\n\n✅ Successfully decrypted your wallet key!",
      wallet_ready: `✅ **Wallet Reconstructed!**\n\n🔹 Public Key: \`${details.publicKey}\``,
      swap_processing: `💱 **Constructing Swap...**\n\n🔄 Swapping **${details.amount}** tokens from **${details.inputMint}** to **${details.outputMint}**.\n\n⏳ Please wait while we execute the transaction.`,
      error: `🚨 **Swap Flopped!**\n\n⚠️ Here's why: ${details.errorMessage}`,
      // For swap_success, we use a sticker (which we don't delete) and then a follow-up text.
      swap_success: "STICKER",
    };
  
    // Determine the message content for non-sticker stages.
    const messageContent = messages[stage] || `ℹ️ **Status Update:** ${stage}`;
    try {
      if (stage === "swap_success") {
        // Sticker handling: choose a random sticker; if random fails, use the first.
        const stickerIds = [
          "CAACAgEAAxkBAAJDtGegkogm2PoQjRtQikal786JoOQTAAL6AQACjLEgRHhzeIjneBzENgQ",
          "CAACAgIAAxkBAAJDtWegkqYpfviNpH80P3WRZJFEj-QtAAJFCwACyHYZS1547k877Kz7NgQ",
          "CAACAgIAAxkBAAJDumeglJUqiICUrK1CP8vW7HxYAXDpAAJjAANOXNIpRcBzCXnlr_A2BA",
          "CAACAgIAAxkBAAJDu2eglKwW0PCYsMQjsp3EFKtXUxPkAALKDwACSyiRSc1Ng9DJ7M7cNgQ",
          "CAACAgIAAxkBAAJDwGegl3Y58zwa5IoLrZE1iyNQEyw7AAKJAAMWQmsKRsvaWiyCsI42BA",
          "CAACAgIAAxkBAAJDwWegl-TkePOwxQtQpyi9XXmwunMqAAI2FgACXEDYS9tGbtLdlXoNNgQ",
          "CAACAgIAAxkBAAJDv2egltGjkwgjBQKUfBQPE3N8VsNYAAICFQACOsFQSbdMkgm_6KgTNgQ",
        ];
        let randomIndex = Math.floor(Math.random() * stickerIds.length);
        if (isNaN(randomIndex) || randomIndex < 0 || randomIndex >= stickerIds.length) {
          randomIndex = 0;
        }
        const chosenSticker = stickerIds[randomIndex];
        // Send the sticker (do not schedule deletion)
        const stickerMsg = await this.bot.sendSticker(userId, chosenSticker);
  
        // Now send the follow-up text message.
        const followUpText =
          "✅ **Swap Completed!**\n" +
          "Here’s your transaction link:\n" +
          (details.explorerLink || "No TX link");
        const textMsg = await this.bot.sendMessage(userId, followUpText, { parse_mode: "Markdown" });
        // Schedule deletion of the follow-up text message after 3 seconds.
        setTimeout(() => {
          this.bot.deleteMessage(userId, textMsg.message_id).catch(err => {
            console.error("❌ Error deleting follow-up text message:", err.message);
          });
        }, 3000);
      } else {
        // For all other stages, send the text message and schedule its deletion after 3 seconds.
        const sentMsg = await this.bot.sendMessage(userId, messageContent, { parse_mode: "Markdown" });
        setTimeout(() => {
          this.bot.deleteMessage(userId, sentMsg.message_id).catch(err => {
            console.error("❌ Error deleting message:", err.message);
          });
        }, 3000);
      }
    } catch (err) {
      console.error("❌ Error sending transaction update:", err.message);
    }
  }
  
}

