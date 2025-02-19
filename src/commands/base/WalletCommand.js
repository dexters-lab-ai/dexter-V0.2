import { Command } from "./Command.js";
import { walletService } from "../../services/wallet/index.js";
import { networkState } from "../../services/networkState.js";
import { Markup } from "telegraf";

export class WalletCommand extends Command {
  constructor(bot) {
    super(bot);
    this.bot = bot;
  }

  async validateNetwork(chatId) {
    const currentNetwork = await networkState.getCurrentNetwork(chatId);
    if (!currentNetwork) {
      await this.bot.sendMessage(
        chatId,
        "❌ Please select a network first.",
        {
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("🌐 Select Network", "switch_network")],
          ]),
        }
      );
      return false;
    }
    return true;
  }

  async showWalletList(chatId, userInfo) {
    const wallets = await walletService.getWallets(userInfo.id);
    const currentNetwork = await networkState.getCurrentNetwork(userInfo.id);
    const networkWallets = wallets.filter((w) => w.network === currentNetwork);

    if (networkWallets.length === 0) {
      await this.showEmptyWalletMessage(chatId, currentNetwork);
      return;
    }

    const keyboard = Markup.inlineKeyboard([
      ...networkWallets.map((wallet) =>
        [Markup.button.callback(this.formatWalletAddress(wallet.address), `wallet_${wallet.address}`)]
      ),
      [Markup.button.callback("↩️ Back", "back_to_wallets")],
    ]);

    await this.bot.sendMessage(
      chatId,
      `*Your ${networkState.getNetworkDisplay(currentNetwork)} Wallets* 👛\n\n` +
        "Select a wallet to view details:",
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }
    );
  }

  formatWalletAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  async showEmptyWalletMessage(chatId, network) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("➕ Create Wallet", "create_wallet")],
      [Markup.button.callback("🔄 Switch Network", "switch_network")],
      [Markup.button.callback("↩️ Back", "back_to_wallets")],
    ]);

    await this.bot.sendMessage(
      chatId,
      `No wallets found for ${networkState.getNetworkDisplay(network)}. Create one first!`,
      { reply_markup: keyboard }
    );
  }
}
