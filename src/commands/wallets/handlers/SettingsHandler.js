import { ErrorHandler } from "../../../core/errors/index.js";
import { User } from "../../../models/User.js";
import { networkState } from "../../../services/networkState.js";
import { USER_STATES } from "../../../core/constants.js";

/**
 * A sub-handler for wallet settings logic (slippage, notifications, etc.)
 * This is used by WalletsCommand to display & handle wallet settings.
 */
export class WalletSettingsHandler {
  constructor(bot) {
    this.bot = bot;
  }

  /** Show the main Wallet Settings menu */
  async showWalletSettings(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();
      const isAutonomous = !!user?.settings?.trading?.autonomousEnabled;

      const text =
        `*Wallet Settings* ⚙️\n\n` +
        `Autonomous Trading: ${isAutonomous ? "✅ Enabled" : "❌ Disabled"}\n\n` +
        `Configure your wallet settings:`;

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: isAutonomous ? "🔴 Disable Autonomous Trading" : "🟢 Enable Autonomous Trading",
              callback_data: "toggle_autonomous"
            }
          ],
          [{ text: "⚙️ Adjust Slippage", callback_data: "slippage_settings" }],
          [{ text: "🔔 Notification Settings", callback_data: "notification_settings" }],
          [{ text: "🫅 Butler Assistant", callback_data: "butler_assistant" }],
          [{ text: "↩️ Back", callback_data: "back_to_wallets" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /** Show Slippage Settings menu */
  async showSlippageSettings(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();
      const slippage = user?.settings?.trading?.slippage || { ethereum: 3, base: 3, solana: 3 };

      const text =
        `*Slippage Settings* ⚙️\n\n` +
        `Current slippage tolerance:\n` +
        `• Ethereum: ${slippage.ethereum}%\n` +
        `• Base: ${slippage.base}%\n` +
        `• Solana: ${slippage.solana}%\n\n` +
        `Select a network to adjust:`;

      const keyboard = {
        inline_keyboard: [
          [{ text: `ETH (${slippage.ethereum}%)`, callback_data: "adjust_eth_slippage" }],
          [{ text: `Base (${slippage.base}%)`, callback_data: "adjust_base_slippage" }],
          [{ text: `Solana (${slippage.solana}%)`, callback_data: "adjust_sol_slippage" }],
          [{ text: "↩️ Back", callback_data: "wallet_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /** Show the input prompt for adjusting slippage on a specific network */
  async showSlippageInput(chatId, network, userInfo) {
    try {
      // Mark user state so next typed message is the new slippage
      await this.setState(userInfo.id, USER_STATES.WAITING_SLIPPAGE_INPUT);
      await this.setUserData(userInfo.id, { pendingSlippage: { network } });

      const text =
        `*Adjust Slippage for ${network.toUpperCase()}* ⚙️\n\n` +
        `Enter a value between 0.1 and 50:`;

      const keyboard = {
        inline_keyboard: [
          [{ text: "❌ Cancel", callback_data: "slippage_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /** Toggle Autonomous Trading on/off */
  async toggleAutonomousTrading(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();
      const newState = !user?.settings?.trading?.autonomousEnabled;

      await User.updateOne(
        { telegramId: userInfo.id.toString() },
        { $set: { "settings.trading.autonomousEnabled": newState } }
      );

      const text = `✅ Autonomous trading has been *${newState ? "enabled" : "disabled"}*.`;
      const keyboard = {
        inline_keyboard: [[{ text: "↩️ Back", callback_data: "wallet_settings" }]]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /** Show Notification Settings */
  async showNotificationSettings(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();
      const notificationsEnabled = !!user?.settings?.notifications?.enabled;

      const text =
        `*Notification Settings* 🔔\n\n` +
        `Current status: ${notificationsEnabled ? "✅ Enabled" : "❌ Disabled"}`;

      const keyboard = {
        inline_keyboard: [
          [{
            text: notificationsEnabled ? "🔕 Disable Notifications" : "🔔 Enable Notifications",
            callback_data: "toggle_notifications"
          }],
          [{ text: "↩️ Back", callback_data: "wallet_settings" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /** Toggle Notifications on/off */
  async toggleNotifications(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();
      const newState = !user?.settings?.notifications?.enabled;

      await User.updateOne(
        { telegramId: userInfo.id.toString() },
        { $set: { "settings.notifications.enabled": newState } }
      );

      const text = `✅ Notifications have been *${newState ? "enabled" : "disabled"}*.`;
      const keyboard = {
        inline_keyboard: [[{ text: "↩️ Back", callback_data: "notification_settings" }]]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return true;
    }
  }

  /** Toggle Butler Assistant on/off */
  async toggleButlerAssistant(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();
      const newState = !user?.settings?.butler?.enabled;

      await User.updateOne(
        { telegramId: userInfo.id.toString() },
        { $set: { "settings.butler.enabled": newState } }
      );

      const text = `✅ Butler Assistant has been *${newState ? "enabled" : "disabled"}*.`;
      const keyboard = {
        inline_keyboard: [[{ text: "↩️ Back", callback_data: "wallet_settings" }]]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return true;
    }
  }

  /**
   * Switch network (If you used to do it from inside WalletSettings). 
   * Possibly not used now if "switch_network" is in WalletsCommand.
   */
  async switchNetwork(chatId, userInfo, network) {
    try {
      await networkState.handleNetworkSwitch(this.bot, chatId, userInfo.id, network);

      const text = `✅ Network switched to *${network.toUpperCase()}* successfully.`;
      const keyboard = {
        inline_keyboard: [[{ text: "↩️ Back", callback_data: "wallet_settings" }]]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return true;
    }
  }

  /**
   * Utility: set user state
   */
  async setState(userId, state) {
    try {
      await User.updateOne({ telegramId: userId }, { $set: { state } });
    } catch (error) {
      console.error(`Failed to update user state for ${userId}:`, error.message);
    }
  }

  /**
   * Utility: store user data
   */
  async setUserData(userId, data) {
    try {
      await User.updateOne({ telegramId: userId }, { $set: { tempData: data } });
    } catch (error) {
      console.error(`Failed to set user data for ${userId}:`, error.message);
    }
  }
}
