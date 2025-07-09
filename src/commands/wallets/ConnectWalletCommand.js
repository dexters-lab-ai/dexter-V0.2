import { Markup } from "telegraf";
import { walletConnectService } from "../../services/wallet/WalletConnect.js";
import { ErrorHandler } from "../../core/errors/index.js";

/**
 * JWT Tokens for Secure Session Management:
 *
 * - Every user session is protected with a JWT (JSON Web Token).
 * - Tokens are signed using a secret key and contain user-specific payloads.
 * - Tokens have a time-bound validity (e.g., 1 hour) to prevent session hijacking.
 * - Refresh mechanisms ensure valid tokens without user re-authentication.
 * - JWTs are validated at every critical operation for added security.
 */
export class ConnectWalletCommand {
  constructor(bot, eventHandler) {
    this.bot = bot;
    this.command = "/connectwallet";
    this.description = "Connect external wallet";
    this.pattern = /^(\/connectwallet|🔗 Connect Wallet)$/;

    this.eventHandler = eventHandler;

    // Register handlers
    this.registerHandlers();
  }

  registerHandlers() {
    this.eventHandler.on("connect_wallet", async (data) => {
      const { chatId, userInfo } = data;
      try {
        await this.initiateWalletConnect(chatId, userInfo);
      } catch (error) {
        await ErrorHandler.handle(error, this.bot, chatId);
      }
    });

    this.eventHandler.on("disconnect_wallet", async (data) => {
      const { chatId, userInfo } = data;
      try {
        await this.disconnectWallet(chatId, userInfo);
      } catch (error) {
        await ErrorHandler.handle(error, this.bot, chatId);
      }
    });
  }

  async execute(msg) {
    const chatId = msg.chat.id;
    try {
      await this.showConnectOptions(chatId, msg.from);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async showConnectOptions(chatId, userInfo) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🔗 Connect with Reown", "connect_wallet")],
      [Markup.button.callback("❌ Cancel", "back_to_wallets")],
    ]);

    await this.bot.sendMessage(
      chatId,
      "*Connect External Wallet* 🔗\n\n" +
        "Connect your existing wallet:\n\n" +
        "• MetaMask\n" +
        "• Trust Wallet\n" +
        "• Solana-Compatible Wallets\n" +
        "• Any Reown-compatible wallet\n\n" +
        "Choose your connection method:",
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }
    );
  }

  async handleCallback(query) {
    const chatId = query.message.chat.id;
    const action = query.data;
    const userInfo = query.from;

    if (action === "connect_wallet" || action === "disconnect_wallet") {
      this.eventHandler.emit(action, { chatId, userInfo });
      return true;
    }
    return false;
  }

  async initiateWalletConnect(chatId, userInfo) {
    const loadingMsg = await this.showLoadingMessage(chatId, "🔗 Initiating connection...");

    try {
      // Initialize WalletConnect
      if (!walletConnectService.signClient || !walletConnectService.walletModal) {
        await walletConnectService.initializeWalletConnect();
      }

      // Create connection and generate JWT
      const session = await walletConnectService.createConnection(userInfo.id);
      const jwtToken = walletConnectService.sessions.get(userInfo.id)?.token;

      await this.safeDeleteMessage(chatId, loadingMsg.message_id);

      // Handle connection events
      walletConnectService.once("connected", async ({ address, network }) => {
        try {
          const keyboard = Markup.inlineKeyboard([
            [Markup.button.callback("👛 View Wallets", "view_wallets")],
            [Markup.button.callback("🔄 Disconnect", "disconnect_wallet")],
          ]);

          await this.bot.sendMessage(
            chatId,
            "✅ *Wallet Connected Successfully!*\n\n" +
              `Address: \`${address}\`\n` +
              `Network: ${network}\n\n` +
              "Your wallet is now connected and can be used for trading.\n\n" +
              `🔐 *Session Token:* \`${jwtToken}\` (expires in 1 hour)`,
            {
              parse_mode: "Markdown",
              reply_markup: keyboard,
            }
          );
        } catch (error) {
          await ErrorHandler.handle(error, this.bot, chatId);
        }
      });

      console.log(`WalletConnect session established for user ${userInfo.id}.`);
    } catch (error) {
      await this.safeDeleteMessage(chatId, loadingMsg.message_id);
      throw error;
    }
  }

  async disconnectWallet(chatId, userInfo) {
    const loadingMsg = await this.showLoadingMessage(chatId, "🔄 Disconnecting wallet...");

    try {
      // Disconnect WalletConnect session
      await walletConnectService.disconnect(userInfo.id);

      await this.safeDeleteMessage(chatId, loadingMsg.message_id);

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔗 Connect Another", "connect_wallet")],
        [Markup.button.callback("↩️ Back", "back_to_wallets")],
      ]);

      await this.bot.sendMessage(chatId, "✅ Wallet disconnected successfully!", {
        reply_markup: keyboard,
      });
    } catch (error) {
      await this.safeDeleteMessage(chatId, loadingMsg.message_id);
      throw error;
    }
  }

  async showLoadingMessage(chatId, message) {
    return this.bot.sendMessage(chatId, message);
  }

  async safeDeleteMessage(chatId, messageId) {
    try {
      await this.bot.deleteMessage(chatId, messageId);
    } catch (error) {
      if (error.response?.body?.description?.includes("message to delete not found")) {
        console.warn(`Message ${messageId} not found; skipping deletion.`);
      } else {
        console.error(`Error deleting message ${messageId}:`, error);
      }
    }
  }
}
