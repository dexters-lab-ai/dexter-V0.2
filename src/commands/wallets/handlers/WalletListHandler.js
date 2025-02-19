import { User } from '../../../models/User.js';
import { walletService } from '../../../services/wallet/index.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { networkState } from '../../../services/networkState.js';
import { Markup } from 'telegraf';
import { Command } from '../../base/Command.js';

export class SettingsHandler extends Command{
  constructor(bot) {
    super(bot);
    this.bot = bot;
  }

  async showWalletList(chatId, userInfo) {
    // Provide a "loading" message
    let loadingMsg;
    try {
      loadingMsg = await this.bot.sendMessage(chatId, "👛 Loading wallets...");

      const wallets = await walletService.getWallets(userInfo.id);
      if (!wallets || wallets.length === 0) {
        // Delete loading message
        await this.safeDeleteMessage(chatId, loadingMsg.message_id);
        return this.showEmptyWalletMessage(chatId);
      }

      // Group wallets by network
      const walletsByNetwork = wallets.reduce((acc, w) => {
        if (!acc[w.network]) acc[w.network] = [];
        acc[w.network].push(w);
        return acc;
      }, {});

      // Construct inline_keyboard
      const inline_keyboard = [];
      for (const [network, networkWallets] of Object.entries(walletsByNetwork)) {
        // A "heading" row for that network
        inline_keyboard.push([
          {
            text: `🌐 ${networkState.getNetworkDisplay(network)}`,
            callback_data: "noop" // or some no-op
          }
        ]);
        // Each wallet
        networkWallets.forEach((wallet) => {
          inline_keyboard.push([
            {
              text: `${wallet.type === "walletconnect" ? "🔗" : "👛"} ${this.formatWalletAddress(wallet.address)}`,
              callback_data: `wallet_${wallet.address}`
            }
          ]);
        });
      }

      // Add a "Back" row
      inline_keyboard.push([{ text: "↩️ Back", callback_data: "back_to_wallets" }]);

      // Delete loading message, then show wallet list
      await this.safeDeleteMessage(chatId, loadingMsg.message_id);
      await this.bot.sendMessage(chatId, "*Your Wallets* 👛\n\nSelect a wallet to view details:", {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });

      return true;
    } catch (error) {
      if (loadingMsg) {
        await this.safeDeleteMessage(chatId, loadingMsg.message_id);
      }
      // Log & handle error
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /**
   * Show a short message if no wallets exist
   */
  async showEmptyWalletMessage(chatId) {
    const inline_keyboard = [
      [{ text: "➕ Create Wallet", callback_data: "create_wallet" }],
      [{ text: "🌐 Switch Network", callback_data: "switch_network" }],
      [{ text: "↩️ Back", callback_data: "back_to_wallets" }]
    ];

    await this.bot.sendMessage(chatId, "No wallets found. Create one first!", {
      reply_markup: { inline_keyboard }
    });

    return true;
  }

  /**
   * Show the "Wallet Settings" menu
   */
  async showSettings(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() });
      const isAutonomousEnabled = !!user?.settings?.trading?.autonomousEnabled;

      const text =
        "*Wallet Settings* ⚙️\n\n" +
        `Autonomous Trading: ${isAutonomousEnabled ? "✅" : "❌"}\n\n` +
        "Configure your wallet settings:";

      const inline_keyboard = [
        [
          {
            text: isAutonomousEnabled ? "🔴 Disable Autonomous Trading" : "🟢 Enable Autonomous Trading",
            callback_data: "toggle_autonomous"
          }
        ],
        [{ text: "⚙️ Adjust Slippage", callback_data: "slippage_settings" }],
        [{ text: "↩️ Back", callback_data: "back_to_wallets" }]
      ];

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /**
   * Show Slippage Settings
   */
  async showSlippageSettings(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() });
      const slippage = user?.settings?.trading?.slippage || {
        ethereum: 3,
        base: 3,
        solana: 3
      };

      const text =
        "*Slippage Settings* ⚙️\n\n" +
        "Current slippage tolerance:\n\n" +
        `• Ethereum: ${slippage.ethereum}%\n` +
        `• Base: ${slippage.base}%\n` +
        `• Solana: ${slippage.solana}%\n\n` +
        "Select a network to adjust:";

      const inline_keyboard = [
        [{ text: `ETH (${slippage.ethereum}%)`, callback_data: "adjust_eth_slippage" }],
        [{ text: `Base (${slippage.base}%)`, callback_data: "adjust_base_slippage" }],
        [{ text: `Solana (${slippage.solana}%)`, callback_data: "adjust_sol_slippage" }],
        [{ text: "↩️ Back", callback_data: "wallet_settings" }]
      ];

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });
      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  a/**
   * Prompt user for new slippage
   */
  async handleSlippageAdjustment(chatId, userInfo, network) {
    try {
      const userId = userInfo.id;

      await this.setState(userId, USER_STATES.WAITING_SLIPPAGE_INPUT);
      await this.setUserData(userId, { pendingSlippage: { network } });

      const text = "*Enter New Slippage* ⚙️\n\nEnter a number between 0.1 and 50:";
      const inline_keyboard = [
        [{ text: "❌ Cancel", callback_data: "slippage_settings" }]
      ];

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });

      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /**
   * Actually update the slippage in DB after user typed a value
   */
  async updateSlippage(chatId, userInfo, network, value) {
    try {
      const slippageVal = parseFloat(value);
      if (isNaN(slippageVal) || slippageVal < 0.1 || slippageVal > 50) {
        throw new Error("Invalid slippage value. Must be between 0.1 and 50.");
      }

      await User.updateOne(
        { telegramId: userInfo.id.toString() },
        { $set: { [`settings.trading.slippage.${network}`]: slippageVal } }
      );

      const text = `✅ Slippage for ${network} updated to ${slippageVal}%`;
      const inline_keyboard = [
        [{ text: "↩️ Back to Settings", callback_data: "slippage_settings" }]
      ];

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });

      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  async toggleAutonomous(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() });
      const newState = !user?.settings?.trading?.autonomousEnabled;

      await User.updateOne(
        { telegramId: userInfo.id.toString() },
        { $set: { "settings.trading.autonomousEnabled": newState } }
      );

      const text = `✅ Autonomous trading ${newState ? "enabled" : "disabled"} successfully!`;
      const inline_keyboard = [
        [{ text: "↩️ Back", callback_data: "wallet_settings" }]
      ];

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard }
      });

      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  formatWalletAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  async safeDeleteMessage(chatId, messageId) {
    if (!messageId) return;
    try {
      await this.bot.deleteMessage(chatId, messageId);
    } catch (e) {
      // Ignore if message was already deleted
      console.warn("Could not delete message:", e.message);
    }
  }

  async showEmptyWalletMessage(ctx) {
    await ctx.reply(
      `No wallets found. Create one first!`,
      {
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('➕ Create Wallet', 'create_wallet')],
          [Markup.button.callback('🌐 Switch Network', 'switch_network')],
          [Markup.button.callback('↩️ Back', 'back_to_wallets')],
        ]),
      }
    );

    return true;
  }
}
