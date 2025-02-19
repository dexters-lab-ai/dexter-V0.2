import { Command } from "../base/Command.js";
import { SettingsHandler } from "./handlers/WalletListHandler.js"; // a/k/a "WalletListHandler"
import { WalletCreationHandler } from "./handlers/WalletCreationHandler.js";
import { WalletSettingsHandler } from "./handlers/SettingsHandler.js";
import { WalletDetailsHandler } from "./handlers/WalletDetailsHandler.js";
import { TokenDetailsHandler } from "./handlers/TokenDetailsHandler.js";
import { SendTokenHandler } from "./handlers/SendTokenHandler.js";

import { USER_STATES } from "../../core/constants.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { circuitBreakers } from "../../core/circuit-breaker/index.js";
import { BREAKER_CONFIGS } from "../../core/circuit-breaker/index.js";
import { walletService } from "../../services/wallet/index.js";
import { networkState } from "../../services/networkState.js";

/**
 * WalletsCommand handles:
 *  - /wallets or "👛 Wallets" for managing user wallets
 *  - Inline callbacks for creation, network switching, viewing wallet details, sending tokens, etc.
 */
export class WalletsCommand extends Command {
  constructor(bot) {
    super(bot);
    this.bot = bot;

    this.command = "/wallets";
    this.description = "Manage wallets";
    this.pattern = /^(\/wallets|👛 Wallets)$/;

    // Initialize wallet service if needed
    this.initializeWalletService();

    // Sub-handlers for various wallet features
    this.detailsHandler = new WalletDetailsHandler(bot);
    this.listHandler = new SettingsHandler(bot);  // or "WalletListHandler"
    this.creationHandler = new WalletCreationHandler(bot);
    this.settingsHandler = new WalletSettingsHandler(bot);
    this.tokenDetailsHandler = new TokenDetailsHandler(bot);
    this.sendTokenHandler = new SendTokenHandler(bot);

    // Track callback query states
    this.processingCallbacks = new Set();

    // Local map: callback_data => method
    this.callbackHandlers = new Map([
      // Main wallet flows
      ["view_wallets", this.handleViewWallets.bind(this)],
      ["create_wallet", this.handleCreateWallet.bind(this)],
      ["wallet_settings", this.handleWalletSettings.bind(this)],
      ["back_to_wallets", this.handleBackToWallets.bind(this)],
      ["back_to_menu", this.handleBackToMenu.bind(this)],

      // Wallet subflows
      ["notification_settings", this.handleShowNotificationSettings.bind(this)],
      ["slippage_settings", this.handleSlippageSettings.bind(this)],
      ["toggle_autonomous", this.handleToggleAutonomous.bind(this)],
      ["butler_assistant", this.handleButlerToggle.bind(this)],
      ["toggle_butler", this.handleButlerToggle.bind(this)],

      // Slippage adjustments
      ["adjust_eth_slippage", (q) => this.handleSlippageAdjustment(q, "ethereum")],
      ["adjust_base_slippage", (q) => this.handleSlippageAdjustment(q, "base")],
      ["adjust_sol_slippage", (q) => this.handleSlippageAdjustment(q, "solana")],

      // Switch network
      ["switch_network", this.handleSwitchNetwork.bind(this)],
      // adoptNetwork => e.g. "network_ethereum"
      ["network_", this.handleAdoptNetwork.bind(this)],

      // Possibly user tapped "select_network_ethereum" => create wallet
      ["select_network_ethereum", (q) => this.handleNetworkSelection(q, "ethereum")],
      ["select_network_base", (q) => this.handleNetworkSelection(q, "base")],
      ["select_network_solana", (q) => this.handleNetworkSelection(q, "solana")],

      // Autonomous
      ["set_autonomous_", this.handleSetAutonomous.bind(this)],

      // Access a wallet or token detail
      ["wallet_", this.handleWalletDetails.bind(this)],
      ["token_", this.handleTokenDetails.bind(this)],
      ["send_token_", this.handleSendToken.bind(this)],
      ["back_to_wallet_", this.handleBackToWallet.bind(this)],
    ]);
  }

  async initializeWalletService() {
    try {
      if (!walletService.isInitialized) {
        await walletService.initialize();
      }
    } catch (error) {
      console.error("Failed to initialize wallet service:", error);
    }
  }

  /**
   * Optionally exposed so a registry can integrate these callbacks.
   */
  getCallbackHandlers() {
    return this.callbackHandlers;
  }

  /**
   * Called by the framework when user enters /wallets or "👛 Wallets".
   */
  async execute(msg) {
    return circuitBreakers.executeWithBreaker(
      "wallets",
      async () => {
        const chatId = msg.chat.id;
        try {
          await this.showWalletsMenu(chatId, msg.from);
        } catch (error) {
          await ErrorHandler.handle(error, this.bot, chatId);
        }
      },
      BREAKER_CONFIGS.botErrors
    );
  }

  /**
   * Main callback query router for this command.
   */
  async handleCallback(query) {
    const action = query.data;
    const chatId = query.message.chat.id;
    const userInfo = query.from;

    // Deduplicate
    const callbackId = `${chatId}:${action}:${Date.now()}`;
    if (this.processingCallbacks.has(callbackId)) {
      return true;  // Already processing
    }

    try {
      this.processingCallbacks.add(callbackId);

      // If action starts with "network_", "wallet_", etc. handle them:
      if (action.startsWith("network_")) {
        await this.handleAdoptNetwork(query);
        return true;
      } else if (action.startsWith("wallet_")) {
        await this.handleWalletDetails(query);
        return true;
      } else if (action.startsWith("token_")) {
        await this.handleTokenDetails(query);
        return true;
      } else if (action.startsWith("send_token_")) {
        await this.handleSendToken(query);
        return true;
      } else if (action.startsWith("back_to_wallet_")) {
        await this.handleBackToWallet(query);
        return true;
      } else if (action.startsWith("set_autonomous_")) {
        await this.handleSetAutonomous(query);
        return true;
      } else if (action.startsWith("swap_token_")) {
        await this.handleSwapToken(query);
        return true;
      } else if (action.startsWith("approve_token_")) {
        await this.handleApproveToken(query);
        return true;
      } else if (action === "cancel_approval") {
        await this.handleCancelApproval(query);
        return true;
      }

      // If there's a direct mapping in callbackHandlers, call it
      const handler = this.callbackHandlers.get(action);
      if (handler) {
        await handler(query);
        return true;
      }

      console.warn(`[WalletsCommand] Unhandled callback: ${action}`);
      return false;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    } finally {
      setTimeout(() => this.processingCallbacks.delete(callbackId), 2000);
    }
  }

  /**
   * If user typed normal text in certain states
   */
  async handleInput(msg) {
    const state = await this.getState(msg.from.id);
    const chatId = msg.chat.id;

    try {
      switch (state) {
        case USER_STATES.WAITING_SEND_ADDRESS:
          return this.sendTokenHandler.handleAddressInput(chatId, msg.from, msg.text);

        case USER_STATES.WAITING_SEND_AMOUNT:
          return this.sendTokenHandler.handleAmountInput(chatId, msg.from, msg.text);

        default:
          return false;
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  // ------------------------------------------------
  // Main "Wallets" Menu
  // ------------------------------------------------
  async showWalletsMenu(chatId, from) {
    const currentNetwork = await networkState.getCurrentNetwork(from.id);
    const netDisplay = networkState.getNetworkDisplay(currentNetwork);

    const keyboard = {
      inline_keyboard: [
        [{ text: "👛 View Wallets", callback_data: "view_wallets" }],
        [{ text: "➕ Create Wallet", callback_data: "create_wallet" }],
        [{ text: "🌐 Switch Network", callback_data: "switch_network" }],
        [{ text: "⚙️ Wallet Settings", callback_data: "wallet_settings" }],
        [{ text: "↩️ Back to Menu", callback_data: "back_to_menu" }],
      ]
    };

    const text =
      `*Wallet Management* 👛\n\n` +
      `Current Network: *${netDisplay}*\n\n` +
      "Choose an option:";

    await this.bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      reply_markup: keyboard
    });
  }

  // ------------------------------------------------
  // Callback handlers
  // ------------------------------------------------

  async handleViewWallets(query) {
    const { message, from } = query;
    return this.listHandler.showWalletList(message.chat.id, from);
  }

  async handleCreateWallet(query) {
    const { message, from } = query;
    return this.creationHandler.showNetworkSelection(message.chat.id, from);
  }

  async handleWalletSettings(query) {
    const { message, from } = query;
    return this.settingsHandler.showWalletSettings(message.chat.id, from);
  }

  async handleShowNotificationSettings(query) {
    const { message, from } = query;
    return this.settingsHandler.showNotificationSettings(message.chat.id, from);
  }

  async handleSlippageSettings(query) {
    const { message, from } = query;
    return this.settingsHandler.showSlippageSettings(message.chat.id, from);
  }

  async handleToggleAutonomous(query) {
    const { message, from } = query;
    return this.settingsHandler.toggleAutonomousTrading(message.chat.id, from);
  }

  async handleButlerToggle(query) {
    const { message, from } = query;
    return this.settingsHandler.toggleButlerAssistant(message.chat.id, from);
  }

  /**
   * The user tapped "switch_network"
   */
  async handleSwitchNetwork(query) {
    const { message, from } = query;
    const chatId = message.chat.id;
    const userId = from.id;

    try {
      await networkState.showNetworkSelection(this.bot, chatId, userId);
    } catch (error) {
      console.error("[WalletsCommand] handleSwitchNetwork error:", error);
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * The user tapped something like "network_ethereum"
   */
  async handleAdoptNetwork(query) {
    const { message, from, data } = query;
    const chatId = message.chat.id;
    const userId = from.id;

    const net = data.replace("network_", "");  // e.g. "ethereum"
    try {
      await networkState.handleNetworkSwitch(this.bot, chatId, userId, net);
    } catch (error) {
      console.error("[WalletsCommand] handleAdoptNetwork error:", error);
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * The user tapped e.g. "select_network_ethereum"
   */
  async handleNetworkSelection(query, network) {
    const { message, from } = query;
    const chatId = message.chat.id;

    // Optionally define a small loading function if you want:
    const showLoadingMessage = async (cid, loadingText) => {
      return this.bot.sendMessage(cid, loadingText);  // returns a message object with message_id
    };

    // Now pass that to creationHandler:
    return this.creationHandler.createWallet(
      chatId,
      from,
      network,
      showLoadingMessage
    );
  }

  /**
   * e.g. "adjust_eth_slippage"
   */
  async handleSlippageAdjustment(query, network) {
    const { message, from } = query;
    const chatId = message.chat.id;
    return this.settingsHandler.showSlippageInput(chatId, network, from);
  }

  /**
   * The user tapped "wallet_xxxx"
   */
  async handleWalletDetails(query) {
    const { message, from, data } = query;
    const chatId = message.chat.id;
    const address = data.replace("wallet_", "");
    return this.detailsHandler.showWalletDetails(chatId, from, address);
  }

  /**
   * The user tapped "token_xxxx"
   */
  async handleTokenDetails(query) {
    const { message, from, data } = query;
    const chatId = message.chat.id;
    const tokenAddress = data.replace("token_", "");
    return this.tokenDetailsHandler.showTokenDetails(chatId, from, tokenAddress);
  }

  /**
   * The user tapped "send_token_xxx"
   */
  async handleSendToken(query) {
    const { message, from, data } = query;
    const chatId = message.chat.id;

    // data = "send_token_0xbcd123_base"
    const raw = data.replace("send_token_", "").split("_");
    const [tokenAddress, net] = raw;
    if (!tokenAddress || !net) {
      return this.bot.sendMessage(chatId, "❌ Invalid token info. Please try again.");
    }

    return this.detailsHandler.showSendTokenMenu(chatId, from, net, tokenAddress);
  }

  /**
   * The user tapped "set_autonomous_xxx"
   */
  async handleSetAutonomous(query) {
    const { message, from, data } = query;
    const chatId = message.chat.id;
    const userId = from.id;

    const address = data.replace("set_autonomous_", "");
    return this.detailsHandler.setAutonomousWallet(chatId, userId, address);
  }

  /**
   * Handle a "swap_token_{tokenAddress}_{network}" callback
   */
  async handleSwapToken(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;

    // e.g. data = "swap_token_0xABC_ethereum"
    const action = query.data;
    const raw = action.replace("swap_token_", "").split("_");
    const [tokenAddress, network] = raw;

    // Possibly call a "showSwapMenu" or "executeSwap" in your tokenDetailsHandler:
    try {
      await this.tokenDetailsHandler.showSwapMenu(chatId, userId, tokenAddress, network);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Handle an "approve_token_{tokenAddress}_{network}" callback
   */
  async handleApproveToken(query) {
    const chatId = query.message.chat.id;
    const userInfo = query.from;

    // e.g. "approve_token_0xABC_ethereum"
    const action = query.data;
    const raw = action.replace("approve_token_", "").split("_");
    const [tokenAddress, network] = raw;

    try {
      // Possibly call tokenDetailsHandler.executeApproval(...) 
      await this.tokenDetailsHandler.executeApproval(chatId, userInfo, tokenAddress, network);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Handle a "cancel_approval" callback
   */
  async handleCancelApproval(query) {
    const chatId = query.message.chat.id;
    // Here you can simply show a "cancelled" message or route back to details
    try {
      await this.bot.sendMessage(chatId, "Approval canceled. Returning to token details...");
      // Possibly do: "await this.handleTokenDetails(...)" if you want to go back to that view
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * The user tapped "back_to_wallet_xxx"
   */
  async handleBackToWallet(query) {
    const { message, from, data } = query;
    const chatId = message.chat.id;
    const address = data.replace("back_to_wallet_", "");
    return this.detailsHandler.showWalletDetails(chatId, from, address);
  }

  /**
   * The user tapped "back_to_wallets"
   */
  async handleBackToWallets(query) {
    return this.showWalletsMenu(query.message.chat.id, query.from);
  }

  /**
   * The user tapped "back_to_menu"
   */
  async handleBackToMenu(query) {
    // Show wallet main menu or a real global menu
    return this.showWalletsMenu(query.message.chat.id, query.from);
  }
}
