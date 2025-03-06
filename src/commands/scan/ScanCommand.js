/**
 * ScanCommand.js
 * 
 * 🟦 Unified & Expanded Scanner
 *   - Handles addresses (EVM/Solana), cashtags ($BTC), user handles (@username),
 *     and advanced Twitter queries (operators like minLikes=10, from:someone, etc.).
 *   - Taps into UnifiedAutonomousEngine for token/wallet scans.
 *   - Taps into twitterService for specialized Twitter searches.
 */

import { Command } from "../base/Command.js";
import { USER_STATES } from "../../core/constants.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { UnifiedAutonomousProcessor } from "../../services/ai/processors/UnifiedAutonomousEngine.js";
import { twitterService } from "../../services/twitter/index.js";

export class ScanCommand extends Command {
  constructor(bot) {
    super(bot);
    this.bot = bot;
    this.command = "/scan";
    this.description = "Scan token details";
    this.pattern = /^(\/scan|🔍 Scan Token)$/;

    // Use UnifiedAutonomousProcessor for address and phrase scans.
    this.unifiedAutonomousProcessor = new UnifiedAutonomousProcessor(bot);
  }

  /**
   * Returns an object mapping callback actions to their handler functions.
   */
  getCallbackHandlers() {
    return {
      scan_input: this.handleScanInput.bind(this),
      scan_address_example: this.handleScanAddressExample.bind(this),
      scan_twitter_example: this.handleScanTwitterExample.bind(this),
      back_to_menu: this.handleBackToMenu.bind(this),
    };
  }

  /**
   * Called when a user sends a text command.
   */
  async execute(msg) {
    const chatId = msg.chat.id;
    try {
      if (msg.text && !msg.text.startsWith("/")) {
        return await this.handleInput(msg);
      }
      await this.showScanOptions(chatId);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Handles callback queries.
   * Answers the callback and dispatches the action based on its data.
   */
  async handleCallbackQuery(query) {
    // Normalize callback query: answer it and extract chat and from.
    if (query.callback_query) {
      await this.bot.answerCallbackQuery(query.callback_query.id).catch(console.error);
      query.chat = query.callback_query.message.chat;
      query.from = query.callback_query.from;
    }
    const chatId = query.chat.id;
    const action = query.data;
    try {
      // If the registry calls handleCallbackQuery, it can now look up our getCallbackHandlers mapping.
      const callbacks = this.getCallbackHandlers();
      if (callbacks[action]) {
        await callbacks[action](chatId, query);
      } else {
        console.warn(`Unhandled callback action: ${action}`);
        await this.bot.answerCallbackQuery(query.id, { text: "No action found." });
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Displays the scan options with inline keyboard buttons.
   */
  async showScanOptions(chatId) {
    const text =
      "🟦 *Scanner:* Addresses, Cashtags, Handles, and more\n" +
      "• Paste an EVM/Solana address\n" +
      "• Type a $cashtag (e.g. $BTC)\n" +
      "• Provide a @user handle\n" +
      "• Use advanced ops: minLikes=10, from:someone, filter:media, etc.";
    const keyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Enter Input", callback_data: "scan_input" }],
          [
            { text: "💡 Address Example", callback_data: "scan_address_example" },
            { text: "💡 Twitter Example", callback_data: "scan_twitter_example" },
          ],
          [{ text: "↩️ Back to Menu", callback_data: "back_to_menu" }],
        ],
      },
    };
    await this.bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...keyboard,
    });
  }

  /**
   * Handles the "scan_input" callback by prompting the user to type their input.
   */
  async handleScanInput(chatId, query) {
    const text =
      "🟦 *Scanning Options*\n" +
      "Enter one of the following:\n" +
      "• An EVM/Solana address\n" +
      "• A $cashtag (e.g. $BTC)\n" +
      "• A @user handle\n" +
      "• Or an advanced query: `minLikes=10 from:someone filter:media sort:Latest pizza`";
    const keyboard = {
      reply_markup: {
        inline_keyboard: [[{ text: "❌ Cancel", callback_data: "back_to_menu" }]],
      },
    };
    await this.bot.sendMessage(chatId, text, {
      parse_mode: "Markdown",
      ...keyboard,
    });
  }

  /**
   * Example callback handler for "scan_address_example".
   */
  async handleScanAddressExample(chatId, query) {
    await this.bot.answerCallbackQuery(query.id, {
      text: "Try scanning a valid EVM or Solana address!",
    });
  }

  /**
   * Example callback handler for "scan_twitter_example".
   */
  async handleScanTwitterExample(chatId, query) {
    await this.bot.answerCallbackQuery(query.id, {
      text: "Try entering $BTC, @elonmusk, or something like 'minLikes=10 from:someone'!",
    });
  }

  /**
   * Handles the "back_to_menu" callback.
   */
  async handleBackToMenu(chatId, query) {
    await this.bot.answerCallbackQuery(query.id, { text: "Returning to main menu..." });
    await this.clearState(chatId);
    // Optionally, trigger a menu display.
    await this.bot.sendMessage(chatId, "↩️ Back to menu.");
  }

  async handleInput(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = await this.getState(chatId);
    if (state === USER_STATES.WAITING_SCAN_INPUT && msg.text) {
      try {
        const rawInput = msg.text.trim();
        await this.clearState(chatId);
  
        // EXISTING DETECTIONS (address, $cashtag, @user, advanced)...
        // If user types "snipers:0xABC123..."
        if (rawInput.toLowerCase().startsWith("snipers:")) {
          const tokenAddress = rawInput.split(":")[1]?.trim();
          if (!tokenAddress) {
            return await this.bot.sendMessage(chatId, "❌ Invalid snipers command. Usage: `snipers:0xTokenAddress`");
          }
          return await this.handleTokenSnipersScan(chatId, userId, tokenAddress);
        }
  
        // If user types "price:BTC" or "price:0xSomeToken"
        if (rawInput.toLowerCase().startsWith("price:")) {
          const token = rawInput.split(":")[1]?.trim();
          if (!token) {
            return await this.bot.sendMessage(chatId, "❌ Invalid price command. Usage: `price:BTC` or `price:0xAddress`");
          }
          return await this.handleTokenPriceCheck(chatId, userId, token);
        }
  
        // If user types "resolve:doge"
        if (rawInput.toLowerCase().startsWith("resolve:")) {
          const sym = rawInput.split(":")[1]?.trim();
          if (!sym) {
            return await this.bot.sendMessage(chatId, "❌ Invalid resolve command. Usage: `resolve:doge`");
          }
          return await this.handleSymbolResolution(chatId, userId, sym);
        }
        // If none matched, fallback to address / cashtag / handle / advanced..
        const isEVM = /^0x[a-fA-F0-9]{40}$/.test(rawInput);
        const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(rawInput);
        if (isEVM || isSol) {
          await this.bot.sendMessage(chatId, "🔎 Scanning address...");
          const result = await this.unifiedAutonomousProcessor.handleAddressPaste(userId, rawInput);
          return await this.bot.sendMessage(chatId, `\`\`\`\n${JSON.stringify(result, null, 2)}\n\`\`\``, {
            parse_mode: "Markdown",
          });
        }
        if (rawInput.startsWith("$")) {
          const symbol = rawInput.replace(/^\$/, "").trim();
          return await this.handleCashtagSearch(chatId, userId, symbol);
        }
        if (rawInput.startsWith("@")) {
          const username = rawInput.replace(/^@+/, "").trim();
          return await this.handleUserHandleSearch(chatId, userId, username);
        }
        return await this.handleAdvancedTwitterSearch(chatId, userId, rawInput);
  
      } catch (error) {
        await ErrorHandler.handle(error, this.bot, chatId);
      }
    }
    return false;
  }  

  async handleCashtagSearch(chatId, userId, symbol) {
    const ops = this.parseOperators(symbol);
    const { searchQuery, minLikes, minRetweets, minReplies } = ops;
    await this.bot.sendMessage(chatId, `🔎 Searching $${searchQuery}`, { parse_mode: "Markdown" });
    const tweets = await twitterService.searchTweetsByCashtag(
      userId,
      searchQuery,
      minLikes,
      minRetweets,
      minReplies
    );
    if (!tweets || !tweets.length) {
      return await this.bot.sendMessage(chatId, `No tweets found for $${searchQuery}.`);
    }
    const top5 = tweets.slice(0, 5);
    return await this.bot.sendMessage(
      chatId,
      `Top ${top5.length} tweets:\n\`\`\`\n${JSON.stringify(top5, null, 2)}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  }

  async handleUserHandleSearch(chatId, userId, username) {
    const ops = this.parseOperators(username);
    const { searchQuery, minLikes, minRetweets, minReplies, sortBy, extraOperators } = ops;
    const handle = searchQuery || username;
    await this.bot.sendMessage(chatId, `🔎 Searching user @${handle}`, { parse_mode: "Markdown" });
    const tweets = await twitterService.searchTweetsByUserHandle({
      userId,
      handle,
      minLikes,
      minRetweets,
      minReplies,
      sortBy: sortBy || "Latest",
      extraOperators,
      maxItems: 50,
    });
    if (!tweets || !tweets.length) {
      return await this.bot.sendMessage(chatId, `No tweets found for @${handle}`);
    }
    const top5 = tweets.slice(0, 5);
    return await this.bot.sendMessage(
      chatId,
      `Top ${top5.length} @${handle} tweets:\n\`\`\`\n${JSON.stringify(top5, null, 2)}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  }

  async handleAdvancedTwitterSearch(chatId, userId, rawInput) {
    const ops = this.parseOperators(rawInput);
    const { searchQuery, minLikes, minRetweets, minReplies, sortBy, extraOperators } = ops;
    await this.bot.sendMessage(
      chatId,
      `🔎 Advanced Search:\n"${searchQuery}"\nminLikes=${minLikes}, minRetweets=${minRetweets}, minReplies=${minReplies}, sortBy=${sortBy}`,
      { parse_mode: "Markdown" }
    );
    const tweets = await twitterService.searchTwitter({
      query: searchQuery,
      operators: extraOperators,
      sortBy: sortBy || "Latest",
      maxItems: 50,
    });
    if (!tweets || !tweets.length) {
      return await this.bot.sendMessage(chatId, `No tweets found for "${searchQuery}".`);
    }
    const top5 = tweets.slice(0, 5);
    return await this.bot.sendMessage(
      chatId,
      `Top ${top5.length} tweets:\n\`\`\`\n${JSON.stringify(top5, null, 2)}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  }

  parseOperators(input) {
    const tokens = input.split(/\s+/);
    let searchQuery = "";
    let minLikes = 0;
    let minRetweets = 0;
    let minReplies = 0;
    let sortBy = "";
    const extraOperators = [];
    for (let token of tokens) {
      const lower = token.toLowerCase();
      if (lower.startsWith("minlikes=")) {
        const val = parseInt(token.split("=")[1], 10);
        if (!isNaN(val)) minLikes = val;
        continue;
      }
      if (lower.startsWith("minretweets=")) {
        const val = parseInt(token.split("=")[1], 10);
        if (!isNaN(val)) minRetweets = val;
        continue;
      }
      if (lower.startsWith("minreplies=")) {
        const val = parseInt(token.split("=")[1], 10);
        if (!isNaN(val)) minReplies = val;
        continue;
      }
      if (lower.startsWith("sort:")) {
        sortBy = token.split(":")[1];
        continue;
      }
      if (lower.includes(":")) {
        extraOperators.push(token);
        continue;
      }
      searchQuery += (searchQuery ? " " : "") + token;
    }
    return { searchQuery: searchQuery.trim(), minLikes, minRetweets, minReplies, sortBy, extraOperators };
  }

  /**
   * Handle token snipers for EVM addresses
   */
  async handleTokenSnipersScan(chatId, userId, tokenAddress) {
    await this.bot.sendMessage(chatId, `🔎 Fetching snipers for ${tokenAddress}...`);
    const snipersData = await this.unifiedAutonomousProcessor.fetchTokenSnipers(userId, tokenAddress);
    if (typeof snipersData === "string") {
      return await this.bot.sendMessage(chatId, snipersData);
    }
    return await this.bot.sendMessage(
      chatId,
      `\`\`\`\n${JSON.stringify(snipersData, null, 2)}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  }

  /**
   * Handle token price checks
   */
  async handleTokenPriceCheck(chatId, userId, token) {
    await this.bot.sendMessage(chatId, `🔎 Checking price for: ${token}...`);
    const priceData = await this.unifiedAutonomousProcessor.performTokenPriceCheck(token);
    if (priceData.error) {
      return await this.bot.sendMessage(chatId, `❌ ${priceData.error}`);
    }
    return await this.bot.sendMessage(
      chatId,
      `\`\`\`\n${JSON.stringify(priceData, null, 2)}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  }

  /**
   * Handle symbol-to-address resolution
   */
  async handleSymbolResolution(chatId, userId, symbol) {
    await this.bot.sendMessage(chatId, `🔎 Resolving symbol => address: ${symbol}`);
    const addressResult = await this.unifiedAutonomousProcessor.getTokenAddressBySymbol(symbol);
    if (!addressResult || addressResult === "NONE") {
      return await this.bot.sendMessage(chatId, `❌ Could not resolve symbol "${symbol}" to an address`);
    }
    if (typeof addressResult === "string") {
      return await this.bot.sendMessage(chatId, `Resolved => ${addressResult}`);
    }
    return await this.bot.sendMessage(
      chatId,
      `\`\`\`\n${JSON.stringify(addressResult, null, 2)}\n\`\`\``,
      { parse_mode: "Markdown" }
    );
  }


}
