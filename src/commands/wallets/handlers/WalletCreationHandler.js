import { ErrorHandler } from "../../../core/errors/index.js";
import { walletService } from "../../../services/wallet/index.js";
import { networkState } from "../../../services/networkState.js";
import { User } from "../../../models/User.js"; // In case you need user checks
import { USER_STATES } from "../../../core/constants.js";

/**
 * WalletCreationHandler:
 *  - showNetworkSelection: lists possible networks for new wallet creation
 *  - createWallet: calls walletService to actually create the wallet
 */
export class WalletCreationHandler {
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * Show network selection menu for creating a new wallet.
   * 
   * @param {number} chatId  The Telegram chat ID
   * @param {Object} userInfo An object containing .id, .username, etc.
   * @returns {Promise<boolean>} True on success, false on failure
   */
  async showNetworkSelection(chatId, userInfo) {
    try {
      const currentNetwork = await networkState.getCurrentNetwork(userInfo.id);
      const networks = ["ethereum", "base", "solana"];

      // Build inline keyboard for network selection
      const inline_keyboard = networks.map((net) => {
        const displayName = networkState.getNetworkDisplay(net);
        const isActive = net === currentNetwork;

        return [
          {
            text: isActive ? `${displayName} ✓` : displayName,
            callback_data: `select_network_${net}`,
          },
        ];
      });

      // Add a "Back to Wallets" row
      inline_keyboard.push([{ text: "↩️ Back", callback_data: "back_to_wallets" }]);

      const text = "*Select Network* 🌐\n\nChoose the network for your new wallet:";

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });
      return true;
    } catch (error) {
      console.error("Error showing network selection:", error);
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /**
   * Create a new wallet on the specified network.
   * 
   * @param {number} chatId         The Telegram chat ID
   * @param {Object} userInfo       Contains .id of user
   * @param {string} network        The network code, e.g. "ethereum"
   * @param {Function} showLoadingMessage A function that returns a promise for a "loading" message
   *                                     e.g. showLoadingMessage(chatId, 'Creating wallet...') => { message_id }
   */
  async createWallet(chatId, userInfo, network, showLoadingMessage) {
    let loadingMsg = null;
    if (typeof showLoadingMessage === "function") {
      // If a function was provided, show a loading message
      loadingMsg = await showLoadingMessage(chatId, "🔐 Creating your wallet...");
    }

    try {
      // Actually create the new wallet using wallet service
      const wallet = await walletService.createWallet(userInfo.id, network);

      // Remove the loading message if displayed
      if (loadingMsg) {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      }

      // Build success message
      const text =
        `✅ Wallet created successfully!\n\n` +
        `*Network:* ${networkState.getNetworkDisplay(network)}\n` +
        `*Address:* \`${wallet.address}\``;

      // Build inline keyboard with "View Wallets" or "Back"
      const inline_keyboard = [
        [
          { text: "👛 View Wallets", callback_data: "view_wallets" },
          { text: "↩️ Back", callback_data: "back_to_wallets" }
        ]
      ];

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });

      return true;
    } catch (error) {
      console.error("Error creating wallet:", error);

      // If we had a loading message, remove it
      if (loadingMsg) {
        try {
          await this.bot.deleteMessage(chatId, loadingMsg.message_id);
        } catch (delError) {
          console.warn("Could not delete loading message:", delError);
        }
      }

      // Provide a retry option
      const inline_keyboard = [
        [
          { text: "🔄 Retry", callback_data: `select_network_${network}` },
          { text: "↩️ Back", callback_data: "back_to_wallets" }
        ]
      ];

      await this.bot.sendMessage(chatId, "❌ Failed to create wallet. Please try again.", {
        reply_markup: { inline_keyboard }
      });

      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }
}
