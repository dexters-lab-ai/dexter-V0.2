import { User } from "../../models/User.js";
import { Command } from "./Command.js";
import { networkState } from "../../services/networkState.js";
import { walletService } from "../../services/wallet/index.js";
import { Markup } from "telegraf";

export class TradeCommand extends Command {
  constructor(bot) {
    super(bot);
    this.bot = bot;
  }

  async validateWallet(chatId, userInfo) {
    // Fetch the user document
    const user = await User.findByTelegramId(userInfo.id);

    // Get the active wallet for the default network
    const defaultNetwork = user.settings?.defaultNetwork || "ethereum";
    const activeWallet = user.getActiveWallet(defaultNetwork);

    if (!activeWallet) {
      await this.bot.sendMessage(
        chatId,
        "❌ Please select or create a wallet first.",
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("👛 Go to Wallets", "/wallets")],
          ]),
        }
      );
      return false;
    }
    return true;
  }

  // Unused, trade service now uses QuickNode smart transactions
  async estimateTrade(tradeParams) {
    return walletService.estimateTrade(tradeParams);
  }

  async executeTrade(tradeParams) {
    return walletService.executeTrade(tradeParams);
  }

  async showTradeConfirmation(chatId, tradeDetails) {
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Confirm", "confirm_trade"),
        Markup.button.callback("❌ Cancel", "cancel_trade"),
      ],
    ]);

    await this.bot.sendMessage(
      chatId,
      this.formatTradeDetails(tradeDetails),
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }
    );
  }

  formatTradeDetails(details) {
    return (
      `*Trade Details* 💱\n\n` +
      `Action: ${details.action}\n` +
      `Token: ${details.token}\n` +
      `Amount: ${details.amount}\n` +
      `Network: ${networkState.getNetworkDisplay(details.network)}\n` +
      `Estimated Fee: ${details.estimatedFee}`
    );
  }
}
