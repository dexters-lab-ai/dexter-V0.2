// ScanHandler.js
import cookieFun from "../../../services/cookieDAO/CookieFun.js";
import { ErrorHandler } from "../../../core/errors/index.js";

export class ScanHandler {
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * Given a string the user typed, detect if it's an address or generic string,
   * then fetch relevant data from cookieFun and show results.
   */
  async handleTokenScan(chatId, queryStr, from) {
    let loadingMsg;
    try {
      loadingMsg = await this.bot.sendMessage(
        chatId,
        `🍪 Scanning token "${queryStr}"...`
      );

      // Prepare date range for tweet search
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const fromDate = sevenDaysAgo.toISOString().slice(0, 10);
      const toDate = now.toISOString().slice(0, 10);

      // Check if query is EVM address (0x + 40 hex chars)
      const isAddress = /^0x[a-fA-F0-9]{40}$/.test(queryStr.trim());
      let results = {};

      if (isAddress) {
        const agentByContractPromise = cookieFun.getAgentByContractAddress(queryStr, "_3Days");
        const searchTweetsPromise = cookieFun.searchTweets(queryStr, fromDate, toDate);

        const [agentByContract, searchTweets] = await Promise.all([
          agentByContractPromise,
          searchTweetsPromise
        ]);

        results.agentByContract = agentByContract;
        results.searchTweets = searchTweets;
      } else {
        // Not an address, assume a general phrase or symbol
        const searchTweetsResult = await cookieFun.searchTweets(queryStr, fromDate, toDate);
        results.searchTweets = searchTweetsResult;
      }

      // Format the final text
      const resultMessage = this.formatCombinedResult(queryStr, results, isAddress);

      // Clean up loading message
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);

      // Send the combined result message with a small interactive keyboard
      await this.bot.sendMessage(chatId, resultMessage, {
        parse_mode: "Markdown",
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [
            [{ text: "🍪 Scan Another", callback_data: "scan_input" }],
            [{ text: "🔄 Switch Network", callback_data: "switch_network" }],
            [{ text: "↩️ Back to Menu", callback_data: "back_to_menu" }]
          ]
        }
      });

      // Return the raw results if needed by other logic
      return results;

    } catch (error) {
      if (loadingMsg) {
        try {
          await this.bot.deleteMessage(chatId, loadingMsg.message_id);
        } catch (e) {
          // Ignore
        }
      }
      await ErrorHandler.handle(error, this.bot, chatId);
      throw error; // Re-throw if you want the calling code to handle it
    }
  }

  /**
   * Build a nicely formatted message for user. Using triple backticks for code blocks in Markdown.
   */
  formatCombinedResult(queryStr, results, isAddress) {
    let message = `🍪 *CookieDAO Scan Result for "${queryStr}"* 🍪\n\n`;

    if (isAddress) {
      if (results.agentByContract) {
        message += `*Agent By Contract:*\n\`\`\`\n${JSON.stringify(results.agentByContract, null, 2)}\n\`\`\`\n\n`;
      } else {
        message += "*Agent By Contract:* (No data)\n\n";
      }
    }

    // The user code mentions "Agent By Twitter" but never fetches it for an address. 
    // If you want to do that, you'd do a getAgentByTwitterUsername. 
    // We'll omit it or show a placeholder:
    // message += `*Agent By Twitter:* (Not implemented here)\n\n`;

    if (results.searchTweets) {
      message += `*Search Tweets (Last 7 Days):*\n\`\`\`\n${JSON.stringify(results.searchTweets, null, 2)}\n\`\`\`\n\n`;
    } else {
      message += "*Search Tweets:* (No data)\n\n";
    }

    message += "_Data fetched via CookieDAO API endpoints._";
    return message;
  }
}
