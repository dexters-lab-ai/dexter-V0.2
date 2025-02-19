import { Markup } from "telegraf";
import { trendingService } from "../../services/trending/TrendingService.js";
import { networkState } from "../../services/networkState.js";
import { ErrorHandler } from "../../core/errors/index.js";

export class TrendingCommand {
  constructor(bot) {
    this.bot = bot;
    this.command = "/trending";
    this.description = "Dextools & Dexscreener Trending Tokens";
    this.pattern = /^(\/trending|🔥 Trending Tokens)$/;
  }

  async execute(msg) {
    const chatId = msg.chat.id;
    try {
      await this.fetchAndDisplayTrending(chatId);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async fetchAndDisplayTrending(chatId) {
    let retries = 3, trendingData, loadingMsg;
  
    try {
      // Show a loading message
      loadingMsg = await this.bot.sendMessage(chatId, "⏳ Fetching trending tokens...");
  
      while (retries--) {
        try {
          trendingData = await trendingService.getTrendingTokens();
          if (trendingData?.tokens?.length) break;
        } catch (err) {
          if (!retries) throw err;
          console.warn(`Retrying fetchTrendingTokens... (${retries} left)`);
          await new Promise(res => setTimeout(res, 2000));
        }
      }
  
      // Remove loading message
      await this.safeDeleteMessage(chatId, loadingMsg?.message_id);
  
      if (!trendingData?.tokens?.length) {
        await this.bot.sendMessage(chatId, "⚠️ No trending tokens found.");
        return;
      }
  
      // Process tokens
      const tokenMessages = trendingData.tokens.map((token, index) => {
        let url = "N/A";
  
        if (token.chain === "coingecko") {
          url = token.detailsUrl;
        } else if (token.address) {
          url = `https://dexscreener.com/${token.chain}/${token.address}`;
        }
  
        return `*${index + 1}. ${token.name}* (${token.symbol})\n🔗 [View Token](${url})`;
      }).join("\n\n");
  
      // Create keyboard with "Refresh" button
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("🔄 Refresh", "refresh_trending")]
      ]);
  
      // Send message
      await this.bot.sendMessage(chatId, `🔥 *Trending Tokens:*\n\n${tokenMessages}`, {
        parse_mode: "Markdown",
        reply_markup: keyboard,
        disable_web_page_preview: false
      });
  
    } catch (error) {
      console.error("❌ Fetching trending tokens failed:", error);
      await this.safeDeleteMessage(chatId, loadingMsg?.message_id);
      await this.bot.sendMessage(chatId, "⚠️ Unable to retrieve trending tokens. Try again later.");
    }
  }   

  async displayTokens(chatId, tokens, header, keyboard) {
    if (!Array.isArray(tokens) || tokens.length === 0) {
      await this.bot.sendMessage(chatId, `${header}\n\nNo tokens found.`, {
        parse_mode: "Markdown",
      });
      return;
    }

    await this.bot.sendMessage(chatId, `*${header}*`, { parse_mode: "Markdown" });

    for (const token of tokens) {
      const { message, buttons = [], images = [] } = token;

      if (images.length) {
        const media = images.map((image, index) => ({
          type: "photo",
          media: image,
          caption: index === images.length - 1 ? message : undefined,
          parse_mode: "Markdown",
        }));

        try {
          await this.bot.sendMediaGroup(chatId, media);
        } catch (error) {
          console.error("Error sending media group:", error);
        }
      } else {
        await this.bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
      }

      if (buttons.length) {
        const linksKeyboard = Markup.inlineKeyboard(
          buttons.map(btn => [Markup.button.url(btn.text, btn.url)])
        );

        await this.bot.sendMessage(chatId, "🔗 Links:", { reply_markup: linksKeyboard });
      }
    }

    await this.bot.sendMessage(chatId, "📋 Options:", { reply_markup: keyboard });
  }

  async handleCallback(query) {
    const chatId = query.message.chat.id;
    const action = query.data;

    try {
      switch (action) {
        case "refresh_trending":
          await this.fetchAndDisplayTrending(chatId);
          break;
        case "back_to_trending":
          await this.fetchAndDisplayTrending(chatId);
          break;
        default:
          console.warn(`Unhandled callback action: ${action}`);
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
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
