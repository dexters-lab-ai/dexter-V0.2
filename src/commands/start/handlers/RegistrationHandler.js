import { CertificateGenerator } from "../CertificateGenerator.js";
import { User } from "../../../models/User.js";
import { walletService } from "../../../services/wallet/index.js";
import { encrypt } from "../../../utils/encryption.js";
import { ErrorHandler } from "../../../core/errors/index.js";
import { providers } from "../../../services/trading/providers/ProviderList.js";

export class RegistrationHandler {
  constructor(bot) {
    this.bot = bot;
    this.certificateGenerator = new CertificateGenerator();
  }

  /**
   * Handle user registration process
   * @param {number} userId - The Telegram user ID
   * @param {string} username - The Telegram username
   */
  async handleRegistration(userId, username) {
    try {
      // Notify user that wallet creation is in progress
      const loadingMsg = await this.bot.sendMessage(userId, "🔐 Creating your secure wallets...");

      // Determine networks to create wallets for.
      // Include all EVM networks from providers and add 'solana'
      const evmNetworks = Object.keys(providers); // e.g., 'ethereum', 'avalanche', 'base', etc.
      const walletNetworks = [...evmNetworks, "solana"];

      // Create wallets for each network
      const wallets = {};
      for (const network of walletNetworks) {
        wallets[network] = await walletService.createWallet(userId, network);
      }

      // Construct user document with the created wallets.
      const userDoc = new User({
        telegramId: userId.toString(),
        username,
        wallets: {},
        settings: {
          defaultNetwork: "ethereum",
          notifications: { enabled: true, showInChat: true },
        },
        registeredAt: new Date(),
      });

      // Format each wallet for storage.
      for (const [network, wallet] of Object.entries(wallets)) {
        userDoc.wallets[network] = [this.formatWallet(wallet)];
      }

      await userDoc.save();

      // Generate wallet certificate
      const certificateBuffer = await this.certificateGenerator.generate({
        user: { username, telegramId: userId },
        wallets: wallets,
      });

      // Delete loading message and send wallet certificate
      await this.bot.deleteMessage(userId, loadingMsg.message_id);
      const certificateMsg = await this.bot.sendPhoto(userId, certificateBuffer, {
        caption: this.getCertificateCaption(),
        parse_mode: "Markdown",
      });

      // Delete the certificate message after 20 seconds
      setTimeout(async () => {
        try {
          await this.bot.deleteMessage(userId, certificateMsg.message_id);
          await this.bot.sendMessage(
            userId,
            "✅ Certificate deleted for security.\nMake sure you saved your wallet credentials!"
          );
        } catch (error) {
          console.error("Error deleting certificate:", error);
        }
      }, 20000);

      // Send welcome message
      await this.bot.sendMessage(
        userId,
        `**Meet D.A.I.L - KATZ!** \n\n` +
          `*${username}*, your wallets are ready.\n\n` +
          `_Let's start finding gems in the trenches..._ 💎\n\nType /help to see available commands.`,
        { parse_mode: "Markdown" }
      );

      return true;
    } catch (error) {
      console.error("❌ Error during registration:", error);
      await ErrorHandler.handle(error);
      await this.bot.sendMessage(userId, "❌ Registration failed. Please try again later.");
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
      encryptedMnemonic: encrypt(wallet.mnemonic || ""),
      createdAt: new Date(),
    };
  }

  /**
   * Returns the caption for the wallet certificate.
   */
  getCertificateCaption() {
    return (
      "🔐 *Your Wallet Certificate*\n\n" +
      "Download this certificate immediately to secure your wallet credentials.\n\n" +
      "⚠️ This image will self-destruct in 20 seconds!\n\n" +
      "*CRITICAL SECURITY INFORMATION*\n" +
      "• Save these details in a secure location\n" +
      "• Never share private keys or recovery phrases\n" +
      "• We don't store your private keys\n" +
      "• Lost credentials CANNOT be recovered"
    );
  }
}
