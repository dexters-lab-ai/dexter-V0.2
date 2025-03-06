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
   * Handle user registration process.
   * @param {Object} ctx - Telegraf context object.
   */
  async handleRegistration(chatId, userId, username) {
    try {
      
      console.log("we are here....", chatId, " userId: ", userId, " username: ", username)

      // Notify user that wallet creation is in progress
      const loadingMsg = await this.bot.sendMessage(userId, "🔐 Creating your secure wallets...");
      
      // Determine networks to create wallets for.
      //const evmNetworks = Object.keys(providers); // e.g., 'ethereum', 'avalanche', 'base', etc.
      //const walletNetworks = [...evmNetworks, "solana"];

      // Create wallets for each network
      /*
      const wallets = {};
      for (const network of walletNetworks) {
        wallets[network] = await walletService.createWallet(userId, network);
      }
      */
      // 1) Choose only the top 10 EVM networks from your providers object, in the order you want
      const top7EvmNetworks = [
        "sonic",
        "avalanche",
        "base",
        "bsc",
        "polygon",
        "ethereum",
        "berachain",
        "linear",
        "arbitrum",
        "optimism"//10 wallets
      ];

      // 2) Combine them with "solana" as the 11th
      const walletNetworks = [...top7EvmNetworks, "solana"];

      // 3) Create wallets for those 8
      const wallets = {};
      for (const network of walletNetworks) {
        // If your providers config might not have one of these, you can check for existence
        if (network !== "solana" && !providers[network]) {
          console.warn(`No provider for ${network}, skipping...`);
          continue;
        }
        wallets[network] = await walletService.createWallet(userId, network);
      }

      // Construct user document with the created wallets.
      const userDoc = new User({
        telegramId: userId.toString(),
        username,
        wallets: {},
        settings: {
          defaultNetwork: "sonic",
          notifications: { enabled: true, showInChat: true },
        },
        registeredAt: new Date(),
      });

      // Format each wallet for storage.
      for (const [network, wallet] of Object.entries(wallets)) {
        userDoc.wallets[network] = [this.formatWallet(wallet)];
      }

      // ENCRYPTED in formatWallet above
      //await userDoc.save();

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
        `# 🧠 D.A.I.L - Youre in! 

**Live smarter, faster, better**

--- \n\n` +
          `Anon *${username}*, you may proceed.\n\n` +
          `💭 Try asking, "check trending tokens from everywhere"💎\n\nTDon't be shy to experiment.`,
        { parse_mode: "Markdown" }
      );

      return true;
    } catch (error) {
      console.error("❌ Error during registration:", error);
      await ErrorHandler.handle(error);
      await this.bot.sendMessage(chatId, "❌ Registration failed. Please try again later.");
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
