import { UserState } from "../utils/userState.js";
import { config } from "../core/config.js";

console.log("✅ NetworkState module is being loaded...");

class NetworkStateManager {
  constructor() {
    this.defaultNetwork = "ethereum";
    this.networks = Object.keys(config.networks);
    this.initialized = false;
    this.initializationPromise = null;
  }

  /**
   * Initialize if needed (here it's mostly a placeholder).
   */
  async initialize() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        this.initialized = true;
        return true;
      } catch (error) {
        this.initialized = false;
        console.error("Initialization error:", error);
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  async ensureInitialized() {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Gets the current network for a user, or returns the default if none is set.
   */
  async getCurrentNetwork(userId) {
    await this.ensureInitialized();
    const userData = await UserState.getUserData(userId);
    return userData?.network || this.defaultNetwork;
  }

  /**
   * Sets the user's current network, if valid.
   */
  async setCurrentNetwork(userId, network) {
    await this.ensureInitialized();

    if (!this.networks.includes(network)) {
      throw new Error(`Invalid network: ${network}`);
    }

    await UserState.setUserData(userId, { network });
  }

  /**
   * Returns a human-readable name for a network code like "ethereum", "base", or "solana".
   */
  getNetworkDisplay(network) {
    const networkMap = {
      ethereum: "Ethereum",
      base: "Base",
      solana: "Solana",
    };
    return networkMap[network] || network;
  }

  /**
   * Switch the user's network and notify them via a normal Telegram text message.
   * @param {Object} bot - The node-telegram-bot-api instance.
   * @param {number} chatId - The chat (or group) ID where we send the response.
   * @param {number|string} userId - The numeric or string user ID from Telegram.
   * @param {string} network - The new network code to switch to.
   */
  async handleNetworkSwitch(bot, chatId, userId, network) {
    try {
      await this.setCurrentNetwork(userId, network);

      const text =
        `Network switched to *${this.getNetworkDisplay(network)}* 🔄\n\n` +
        "Notice: This has no effect, depracated method.";

      const keyboard = {
        inline_keyboard: [
          [
            { text: "⚙️ Back to Settings", callback_data: "back_to_settings" },
            { text: "😼 Main Menu", callback_data: "back_to_menu" },
          ],
        ],
      };

      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      });
    } catch (error) {
      console.error("Error switching network:", error);
      await bot.sendMessage(chatId, "❌ Failed to switch network. Please try again.");
    }
  }

  /**
   * Shows a list of possible networks, letting user pick one to switch to.
   * The callback_data might look like "network_ethereum", "network_base", etc.
   */
  async showNetworkSelection(bot, chatId, userId) {
    try {
      const current = await this.getCurrentNetwork(userId);

      // Build inline keyboard with each network
      const buttons = this.networks.map((net) => {
        const isActive = net === current;
        return {
          text: isActive 
            ? `${this.getNetworkDisplay(net)} ✓`
            : this.getNetworkDisplay(net),
          callback_data: `network_${net}` // e.g. "network_ethereum"
        };
      });

      const text =
        "*Select Network* 🌐\n\n" +
        "Choose the blockchain network to use:\n\n" +
        "_Deprecated: This wont affect any blockchain operations, the Agent now auto picks chains during tasks_";

      // We'll place each network in its own row, plus a "Back" row
      const inline_keyboard = buttons.map((b) => [b]);
      inline_keyboard.push([{ text: "↩️ Back", callback_data: "back_to_settings" }]);

      await bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard
        }
      });
    } catch (error) {
      console.error("Error showing network selection:", error);
      await bot.sendMessage(chatId, "❌ Failed to show network selection. Please try again.");
    }
  }

  /**
   * Cleanup method for gracefully shutting down or resetting state.
   */
  async cleanup() {
    console.log("Cleaning up network state...");
    this.initialized = false;
    this.initializationPromise = null;
  }
}

export const networkState = new NetworkStateManager();
