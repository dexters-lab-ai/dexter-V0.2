// ScanCommand.js
import { Command } from "../base/Command.js";
import { ScanHandler } from "./handlers/ScanHandler.js";
import { USER_STATES } from "../../core/constants.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { UnifiedAutonomousProcessor } from "../../services/ai/processors/UnifiedAutonomousEngine.js";

export class ScanCommand extends Command {
  constructor(bot) {
    super(bot);
    this.bot = bot;

    this.command = "/scan";
    this.description = "Scan token details";
    this.pattern = /^(\/scan|🔍 Scan Token)$/;

    this.scanHandler = new ScanHandler(bot);
    this.unifiedAutonomousProcessor = new UnifiedAutonomousProcessor(bot);
  }

  /**
   * Called when user enters /scan or "🔍 Scan Token".
   */
  async execute(msg) {
    const chatId = msg.chat.id;
    try {
      // If user typed normal text, attempt to handle as input
      if (msg.text && !msg.text.startsWith("/")) {
        return await this.handleInput(msg);
      }
      // Otherwise show scanning options
      await this.showScanOptions(chatId);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Inline callback query handler for local usage.
   * Four our main entry in commands registry
   *   bot.on("callback_query", (query) => scanCommand.handleCallbackQuery(query))
   */
  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const action = query.data;

    try {
      switch (action) {
        case "scan_input":
          await this.handleScanInput(chatId);
          await this.setState(chatId, USER_STATES.WAITING_SCAN_INPUT);
          // Optionally, we "answer" the callback so Telegram doesn't keep spinner
          await this.bot.answerCallbackQuery(query.id, { text: "Please type your token / symbol / phrase now." });
          break;

        case "back_to_menu":
          // Return to main menu or remove keyboards
          await this.bot.answerCallbackQuery(query.id, { text: "Returning to main menu..." });
          // Possibly remove inline keyboard
          break;

        default:
          console.warn(`Unhandled callback action: ${action}`);
          // We can answer silently or show a small alert
          await this.bot.answerCallbackQuery(query.id, { text: "No action found." });
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Show scanning options
   */
  async showScanOptions(chatId) {
    try {
      const text =
        "*Cookie it! - Ticker Scanner by Cookie.fun* 🔍\n\n" +
        "Analyze any token with detailed metrics including sentiment, price changes, holders, and more.\n\n" +
        "Enter a token address, symbol, or a search phrase like: \"cookie token utility\" or \"listings BONK\".";

      const keyboard = {
        inline_keyboard: [
          [{ text: "📝 Enter Token Address", callback_data: "scan_input" }],
          [{ text: "↩️ Back to Menu", callback_data: "back_to_menu" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * Ask user to type token address / symbol / phrase
   */
  async handleScanInput(chatId) {
    try {
      const text =
        "*Token Address* / **Symbol/Cashtag** / **Any phrase** 📝\n\n" +
        "Please enter your preferred input for Cookie-It!:";

      const keyboard = {
        inline_keyboard: [
          [{ text: "❌ Cancel", callback_data: "back_to_menu" }]
        ]
      };

      await this.bot.sendMessage(chatId, text, {
        parse_mode: "Markdown",
        reply_markup: keyboard
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /**
   * If user typed normal text while in WAITING_SCAN_INPUT, handle the scanning logic
   */
  async handleInput(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = await this.getState(chatId);

    if (state === USER_STATES.WAITING_SCAN_INPUT && msg.text) {
      try {
        const tokenInput = msg.text.trim();

        // Call the scanHandler
        const results = await this.scanHandler.handleTokenScan(chatId, tokenInput, msg.from);

        // Clear user state
        await this.clearState(chatId);

        // Possibly pass results to an AI or next steps
        await this.unifiedAutonomousProcessor.processMessage(msg, results, userId);

        return true;
      } catch (error) {
        await ErrorHandler.handle(error, this.bot, chatId);
      }
    }

    return false;
  }
}
