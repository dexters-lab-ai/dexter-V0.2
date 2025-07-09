import { trendingService } from "../../services/trending/TrendingService.js";
import { ErrorHandler } from "../../core/errors/index.js";

export class TrendingCommand {
  constructor(bot) {
    this.bot = bot;
    this.command = "/trending";
    this.description = "Dextools & Dexscreener Trending Tokens";
    this.pattern = /^(\/trending|🔥 Trending Tokens)$/;
  }

  // Provide a mapping for callback actions.
  getCallbackHandlers() {
    return {
      refresh_trending: this.handleRefreshTrending.bind(this),
      back_to_trending: this.handleRefreshTrending.bind(this)
    };
  }

  // Main entry point when a text command is received.
  async execute(msg) {
    const chatId = msg.chat.id;
    try {
      await this.fetchAndDisplayTrending(chatId);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  // Fetch trending token data and display it with an inline keyboard.
  async fetchAndDisplayTrending(chatId) {
    let retries = 3, trendingData, loadingMsg;
    try {
      // Show a loading message.
      loadingMsg = await this.bot.sendMessage(chatId, "⏳ Fetching trending tokens...");

      while (retries--) {
        try {
          trendingData = await trendingService.getTrendingTokens();
          if (trendingData?.tokens?.length) break;
        } catch (err) {
          if (!retries) throw err;
          console.warn(`Retrying fetchTrendingTokens... (${retries} left)`);
          await new Promise((res) => setTimeout(res, 2000));
        }
      }

      // Remove loading message.
      await this.safeDeleteMessage(chatId, loadingMsg?.message_id);

      if (!trendingData?.tokens?.length) {
        await this.bot.sendMessage(chatId, "⚠️ No trending tokens found.");
        return;
      }

      // Process tokens into a message.
      const tokenMessages = trendingData.tokens
        .map((token, index) => {
          let url = "N/A";
          if (token.chain === "coingecko") {
            url = token.detailsUrl;
          } else if (token.address) {
            url = `https://dexscreener.com/${token.chain}/${token.address}`;
          }
          return `*${index + 1}. ${token.name}* (${token.symbol})\n🔗 [View Token](${url})`;
        })
        .join("\n\n");

      // Build an inline keyboard with a "Refresh" button.
      const keyboard = {
        reply_markup: {
          inline_keyboard: [
            [{ text: "🔄 Refresh", callback_data: "refresh_trending" }]
          ]
        }
      };

      // Send the trending tokens message.
      await this.bot.sendMessage(
        chatId,
        `🔥 *Trending Tokens:*\n\n${tokenMessages}`,
        {
          parse_mode: "Markdown",
          disable_web_page_preview: false,
          ...keyboard
        }
      );
    } catch (error) {
      console.error("❌ Fetching trending tokens failed:", error);
      await this.safeDeleteMessage(chatId, loadingMsg?.message_id);
      await this.bot.sendMessage(chatId, "⚠️ Unable to retrieve trending tokens. Try again later.");
    }
  }
  
  // Normalize a callback query message so that msg.chat and msg.from exist at the top level.
  normalizeCallbackQuery(msg) {
    if (msg.callback_query) {
      this.bot
        .answerCallbackQuery(msg.callback_query.id, { text: "Processing..." })
        .catch((err) => console.error("answerCallbackQuery error:", err));

      // Merge callback query info into top-level msg
      msg.chat = msg.callback_query.message.chat;
      msg.from = msg.callback_query.from;
      msg.data = msg.callback_query.data;
    }
    return msg;
  }

  // Handler for callback queries with data "refresh_trending" (and "back_to_trending").
  async handleRefreshTrending(msg) {
    msg = this.normalizeCallbackQuery(msg);
    const chatId = msg.chat.id;
    try {
      await this.fetchAndDisplayTrending(chatId);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  // Safely delete a message by chat and message ID.
  async safeDeleteMessage(chatId, messageId) {
    try {
      await this.bot.deleteMessage(chatId, messageId);
    } catch (error) {
      if (
        error.response?.body?.description &&
        error.response.body.description.includes("message to delete not found")
      ) {
        console.warn(`Message ${messageId} not found; skipping deletion.`);
      } else {
        console.error(`Error deleting message ${messageId}:`, error);
      }
    }
  }
}
