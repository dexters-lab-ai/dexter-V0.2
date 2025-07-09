import { User } from "../../models/User.js";
import { networkState } from "../../services/networkState.js";
import { USER_STATES } from "../../core/constants.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { Command } from "../base/Command.js";
import { WalletsCommand } from "../wallets/WalletsCommand.js";
import { LLMSwitcher } from "../../services/ai/processors/LLMSwitcher.js";

/**
 * A self-contained SettingsCommand that handles:
 *  1) /settings or "⚙️ Settings" text command
 *  2) All inline keyboard callbacks (slippage, notifications, etc.)
 */
export class SettingsCommand extends Command {
  constructor(bot) {
    super(bot);

    this.bot = bot;
    this.command = "/settings";
    this.description = "Configure bot settings";
    this.pattern = /^(\/settings|⚙️ Settings)$/;
  }

  /**
   * Called when user types /settings or text matching this.pattern.
   */
  async execute(msg) {
    const chatId = msg.chat.id;
    const from = msg.from;
    try {
      // Optionally check if user typed normal text -> handle state
      // Otherwise, show main settings menu
      await this.showSettingsMenu(chatId, from);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Main callback query handler. 
   * We handle every inline button action from SettingsCommand's UI.
   */
  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const from = query.from;
    const action = query.data;

    try {
      switch (action) {
        case "llm_settings":
          console.log("✅ Handling LLM settings callback...");
          await this.showLLMSettings(chatId, from);
          break;

        case "switch_llm_openai":
          console.log("✅ Switching to OpenAI...");
          await this.handleSwitchLLM(chatId, from, "openai");
          break;

        case "switch_llm_deepseek":
          console.log("✅ Switching to DeepSeek...");
          await this.handleSwitchLLM(chatId, from, "deepseek");
          break;

        case "slippage_settings":
          await this.showSlippageSettings(chatId, from);
          break;

        case "notification_settings":
          await this.showNotificationSettings(chatId, from);
          break;

        case "toggle_notifications":
          await this.toggleNotifications(chatId, from);
          break;

        case "switch_network":
          await this.showSwitchNetwork(chatId);
          break;

        case "back_to_settings":
          await this.showSettingsMenu(chatId, from);
          break;

        case "adjust_eth_slippage":
          await this.showSlippageInput(chatId, from, "ethereum");
          break;

        case "adjust_base_slippage":
          await this.showSlippageInput(chatId, from, "base");
          break;

        case "adjust_sol_slippage":
          await this.showSlippageInput(chatId, from, "solana");
          break;

        case "autonomous_settings":
          await this.showAutonomousSettings(chatId, from);
          break;

        case "toggle_autonomous":
          await this.toggleAutonomousTrading(chatId, from);
          break;

        case "back_to_menu":
          await this.handleBackToMenu(chatId, from);
          break;

        case "back":
          await this.showSettingsMenu(chatId, from);
          break;

        case "view_wallets":
          await this.handleViewWallets(chatId, from);
          break;

        case "back_to_wallets":
          await this.handleBackToWallets(chatId, from);
          break;

        default:
          console.warn(`⚠️ [SettingsCommand] Unhandled callback action: ${action}`);
          // Optionally respond so user doesn't see "loading..."
          await this.bot.answerCallbackQuery(query.id, {
            text: "No handler found for that action."
          });
      }

      // Acknowledge callback
      await this.bot.answerCallbackQuery(query.id);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Show the main Settings menu: Switch Net, Slippage, Autonomous, etc.
   */
  async showSettingsMenu(chatId, from) {
    try {
      const user = await User.findOne({ telegramId: from.id.toString() }).lean();
      const currentNetwork = await networkState.getCurrentNetwork(from.id);
      const netDisplay = networkState.getNetworkDisplay(currentNetwork);

      const text =
      `<b>Settings ⚙️</b>\n\n` +
      `Current Network: <b>${netDisplay}</b>\n` +
      `Slippage: ${user?.settings?.trading?.slippage?.[currentNetwork] ?? 3}%\n` +
      `Autonomous Trading: ${
        user?.settings?.trading?.autonomousEnabled ? "✅ Enabled" : "❌ Disabled"
      }\n` +
      `Notifications: ${
        user?.settings?.notifications?.enabled ? "✅ Enabled" : "❌ Disabled"
      }\n` +
      `AI Model: <b>${user?.settings?.defaultLLM === "deepseek" ? "🔍 DeepSeek AI" : "🧠 OpenAI (GPT)"}</b>\n\n` +
      `Configure your preferences:`;

      const keyboard = {
        inline_keyboard: [
          [{ text: "🔄 Switch Network", callback_data: "switch_network" }],
          [{ text: "⚙️ Slippage Settings", callback_data: "slippage_settings" }],
          [{ text: "🤖 Autonomous Trading", callback_data: "autonomous_settings" }],
          [{ text: "🔔 Notification Settings", callback_data: "notification_settings" }],
          [{ text: "🤖 AI Model Selection", callback_data: "llm_settings" }],
          [{ text: "↩️ Back to Menu", callback_data: "back_to_wallets" }],
        ],
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Slippage settings sub-menu: list ETH/base/solana slippage adjusters
   */
  async showSlippageSettings(chatId, from) {
    try {
      const user = await User.findOne({ telegramId: from.id.toString() }).lean();
      const slippage = user?.settings?.trading?.slippage || { ethereum: 3, base: 3, solana: 3 };

      const text = `<b>Slippage Settings ⚙️</b>\n\nAdjust slippage tolerance (disabled).`;
      const keyboard = {
        /*inline_keyboard: [
          [{ text: `ETH (${slippage.ethereum}%)`, callback_data: "adjust_eth_slippage" }],
          [{ text: `Base (${slippage.base}%)`, callback_data: "adjust_base_slippage" }],
          [{ text: `Solana (${slippage.solana}%)`, callback_data: "adjust_sol_slippage" }],
          [{ text: "↩️ Back", callback_data: "back_to_settings" }]
        ]
          */
        inline_keyboard: [
          [{ text: `ETH (auto%)`, callback_data: "adjust_eth_slippage" }],
          [{ text: `Base (auto%)`, callback_data: "adjust_base_slippage" }],
          [{ text: `Solana (auto%)`, callback_data: "adjust_sol_slippage" }],
          [{ text: "↩️ Back", callback_data: "back_to_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Show slippage input prompt for a specific network
   */
  async showSlippageInput(chatId, from, network) {
    try {
      // Set user state so next typed message is new slippage
      await this.setState(from.id, USER_STATES.WAITING_SLIPPAGE_INPUT);
      await this.setUserData(from.id, { pendingSlippage: { network } });

      const text =
        `<b>Enter New Slippage for ${network.toUpperCase()}</b>\n\n` +
        `Enter a number between 0.1 and 50.`;

      const keyboard = {
        inline_keyboard: [
          [{ text: "❌ Cancel", callback_data: "slippage_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Show autonomous trading settings
   */
  async showAutonomousSettings(chatId, from) {
    try {
      const user = await User.findOne({ telegramId: from.id.toString() }).lean();
      const isEnabled = !!user?.settings?.trading?.autonomousEnabled;

      const text =
        `<b>Autonomous Trading Settings 🤖</b>\n\n` +
        `Current Status: ${isEnabled ? "✅ Enabled" : "❌ Disabled"}`;

      const keyboard = {
        inline_keyboard: [
          [{
            text: isEnabled 
              ? "🔴 Disable Autonomous Trading"
              : "🟢 Enable Autonomous Trading",
            callback_data: "toggle_autonomous"
          }],
          [{ text: "↩️ Back", callback_data: "back_to_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Toggle autonomous trading on or off
   */
  async toggleAutonomousTrading(chatId, from) {
    try {
      const user = await User.findOne({ telegramId: from.id.toString() }).lean();
      const newState = !user?.settings?.trading?.autonomousEnabled;

      // Save
      await User.updateOne(
        { telegramId: from.id.toString() },
        { $set: { "settings.trading.autonomousEnabled": newState } }
      );

      const text = `✅ Autonomous Trading ${newState ? "enabled" : "disabled"} successfully.`;
      const keyboard = {
        inline_keyboard: [
          [{ text: "↩️ Back", callback_data: "autonomous_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Show notification settings
   */
  async showNotificationSettings(chatId, from) {
    try {
      const user = await User.findOne({ telegramId: from.id.toString() }).lean();
      const notificationsEnabled = !!user?.settings?.notifications?.enabled;

      const text =
        `<b>Notification Settings 🔔</b>\n\n` +
        `Current Status: ${notificationsEnabled ? "✅ Enabled" : "❌ Disabled"}`;

      const keyboard = {
        inline_keyboard: [
          [{
            text: notificationsEnabled 
              ? "🔕 Disable Notifications"
              : "🔔 Enable Notifications",
            callback_data: "toggle_notifications"
          }],
          [{ text: "↩️ Back", callback_data: "back_to_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Toggle notifications
   */
  async toggleNotifications(chatId, from) {
    try {
      const user = await User.findOne({ telegramId: from.id.toString() }).lean();
      const newState = !user?.settings?.notifications?.enabled;

      await User.updateOne(
        { telegramId: from.id.toString() },
        { $set: { "settings.notifications.enabled": newState } }
      );

      const text = `✅ Notifications have been <b>${newState ? "enabled" : "disabled"}</b>.`;
      const keyboard = {
        inline_keyboard: [
          [{ text: "↩️ Back", callback_data: "notification_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Show network switch menu
   */
  async showSwitchNetwork(chatId) {
    try {
      const text = `<b>Switch Network 🔄</b>\n\nChoose your preferred network.`;
      const keyboard = {
        inline_keyboard: [
          [{ text: "Ethereum", callback_data: "switch_network_ethereum" }],
          [{ text: "Base", callback_data: "switch_network_base" }],
          [{ text: "Solana", callback_data: "switch_network_solana" }],
          [{ text: "↩️ Back", callback_data: "back_to_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }
  /** 
   * Switch the AI model
   * Choose between OpenaAI & DeppSeek
  **/
  async showLLMSettings(chatId, from) {
    try {
      const user = await User.findOne({ telegramId: from.id.toString() }).lean();
      const currentLLM = user?.settings?.defaultLLM || "openai"; // Default to OpenAI
  
      const text =
        `<b>LLM Selection 🤖</b>\n\n` +
        `Current Model: <b>${currentLLM === "openai" ? "OpenAI (GPT)" : "DeepSeek AI"}</b>\n\n` +
        `Choose your preferred AI model for chat responses and automation.`;
  
      const keyboard = {
        inline_keyboard: [
          [
            { text: "🧠 OpenAI (GPT)", callback_data: "switch_llm_openai" },
            { text: "🔍 DeepSeek AI", callback_data: "switch_llm_deepseek" },
          ],
          [{ text: "↩️ Back", callback_data: "back_to_settings" }],
        ],
      };
  
      await this.bot.sendMessage(chatId, text, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async handleSwitchLLM(chatId, from, newLLM) {
    try {
      const success = await LLMSwitcher.updateUserLLM(from.id.toString(), newLLM);
  
      if (success) {
        await this.bot.sendMessage(chatId, `✅ Successfully switched to <b>${newLLM === "openai" ? "OpenAI (GPT)" : "DeepSeek AI"}</b>.`, {
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "↩️ Back to LLM Settings", callback_data: "llm_settings" }]],
          },
        });
      } else {
        await this.bot.sendMessage(chatId, "❌ Failed to switch LLM. Please try again.", {
          reply_markup: {
            inline_keyboard: [[{ text: "↩️ Back", callback_data: "llm_settings" }]],
          },
        });
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }  

  /**
   * Optional: A callback that might be invoked if "back_to_wallets" is clicked in a menu. 
   * Example usage for returning to a wallet overview. 
   */
  async handleBackToWallets(chatId) {
    // For now, we can just log or show a message. 
    // In real code, you'd do something like "walletsCommand.showWalletMenu(chatId)" if relevant.
    await this.bot.sendMessage(
      chatId,
      "Returning to wallets... (not yet implemented)",
      { reply_markup: { remove_keyboard: true } }
    );
  }
}
