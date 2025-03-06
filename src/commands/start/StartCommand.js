import { User } from "../../models/User.js";
import { networkState } from "../../services/networkState.js";
import { WelcomeHandler } from "./handlers/WelcomeHandler.js";
import { RegistrationHandler } from "./handlers/RegistrationHandler.js";
import { MenuHandler } from "./handlers/MenuHandler.js";
import { USER_STATES } from "../../core/constants.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { Command } from "../base/Command.js";

export class StartCommand extends Command {
  /**
   * @param {object} bot - node-telegram-bot-api instance
   * @param {EventEmitter} eventHandler - An event emitter for registering events
   */
  constructor(bot, eventHandler) {
    super(bot, eventHandler);
    if (!eventHandler) {
      throw new Error("Event handler is required for StartCommand");
    }
    this.bot = bot;
    this.eventHandler = eventHandler;
    this.command = "/start";
    this.description = "Start the bot";
    this.pattern = /^\/start$/;

    // Initialize handlers for welcome, registration, and menu actions
    this.welcomeHandler = new WelcomeHandler(bot);
    this.registrationHandler = new RegistrationHandler(bot);
    this.menuHandler = new MenuHandler(bot);

    // Register event callbacks from the event handler.
    this.registerCallbacks();
  }

  getCallbackHandlers() {
    return {
      register_user: this.handleRegistration.bind(this),
      cancel_registration: this.handleCancelRegistration.bind(this),
      start_menu: this.handleStartMenu.bind(this),
      retry_start: this.retryStart.bind(this)
    };
  }  

  /**
   * Register event callbacks. These events now expect plain message objects.
   */
  registerCallbacks() {
    this.eventHandler.on("register_user", async (msg) =>
      this.safeHandle(() => this.handleRegistration(msg), msg.chat.id)
    );
    this.eventHandler.on("cancel_registration", async (msg) =>
      this.safeHandle(() => this.handleCancelRegistration(msg), msg.chat.id)
    );
    this.eventHandler.on("start_menu", async (msg) =>
      this.safeHandle(() => this.handleStartMenu(msg), msg.chat.id)
    );
    this.eventHandler.on("retry_start", async (msg) =>
      this.safeHandle(() => this.retryStart(msg), msg.chat.id)
    );
  }

  /**
   * Executes the command when the user sends a text message (e.g. "/start").
   * @param {object} msg - Message object from node-telegram-bot-api.
   */
  async execute(msg) {
    // Ensure we have the chat id from the message.
    await this.safeHandle(() => this.handleStart(msg), msg.chat.id);
  }

  /**
   * Main handler when the user starts the bot.
   * Clears any previous state, sends an animation with a welcome caption,
   * and shows either a registration prompt or the main menu.
   * @param {object} msg - Message object.
   */
  async handleStart(msg) {
    
    console.log('====>>>> start',msg);

    const chatId = msg.chat.id;
    const userInfo = msg.from;
    
    // Clear any previous state for the user.
    await this.clearState(userInfo.id);
    const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();

    const startMessage = `
# 🧠 D.A.I.L - Your Smart Companion for Crypto & Daily Digital Life 

**Live smarter, faster, better**

---

📜 *Delegate tasks in *natural language* & watch it execute:* 
• 💭 Deep research, Twitter search, Brave Search, Moralis, Coingecko, Apify, Dexscreener, Dextools
• 💭 Ticker Suggestions based on narratives, sentiment & popular trends
• 💭 AI Task Monitoring and Execution, for price alerts, KOLs, positions, events etc
• 💭 AI powered strategy management, trade measurable shifts in ticker sentiment over a period
• 💭 Ticker social sentiment and KOL monitoring with automated swap actions
• 💭 Bridge between Solana and EVM chains using Wormhole. +JupiterMetis V6, QuickNode and Paraswap
• 💭 Digital life just got easier, schedule tasks: "buy coffee at 8am daily", "search for PS5 for sale near me at 1pm"
• 💭 Pump.fun, Emailing, Calender Events, Offline SMS Notifications, Analyze images and more...

`.trim();

    // Send an animation (GIF) with a caption using node-telegram-bot-api.
    await this.bot.sendAnimation(
      chatId,
      "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExeWJlaTQxdW01NW9jeGQ4aGlvM3c5YjJ2bTQ5bWY4cHVob2s0ajIwcSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Aq1gmGwbJNye8Wvm4v/giphy.gif",
      {
        caption: startMessage,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }
    );

    if (!user) {
      await this.showRegistrationPrompt(chatId);
      await this.setState(userInfo.id, USER_STATES.AWAITING_REGISTRATION);
    } else {
      await this.menuHandler.showWelcomeMessage(chatId, userInfo.username, false);
    }
  }

  /**
   * Displays a registration prompt to first-time users.
   * @param {number} chatId 
   */
  async showRegistrationPrompt(chatId) {
    const keyboard = {
      inline_keyboard: [
        [{ text: "🎯 Register Now", callback_data: "register_user" }],
        [{ text: "❌ Cancel", callback_data: "cancel_registration" }],
      ],
    };

    await this.bot.sendMessage(
      chatId,
      `*🆕 First Time?...*\n\n` +
      `_Let's get you set up with your own secure wallets inside the Agent!_\n\n` +
      `• Secure wallet creation\n` +
      `• Multi-chain transactions\n` +
      `• AI-powered trading\n` +
      `• And much more...\n\n` +
      `Ready to start? 🚀`,
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }
    );
  }

  normalizeCallbackQuery(msg) {
    if (msg.callback_query) {
      // Answer the callback query
      this.bot.answerCallbackQuery(msg.callback_query.id).catch(console.error);
      // Replace the top-level properties with those from the callback
      msg.chat = msg.callback_query.message.chat;
      msg.from = msg.callback_query.from;
    }
    return msg;
  }  

  /**
   * Handles user registration when the "register_user" callback is received.
   * @param {object} msg - Message object.
   */
  async handleRegistration(msg) {
    // Normalize the callback query so that msg.chat and msg.from exist
    msg = this.normalizeCallbackQuery(msg);
    console.log('====>>>>',msg);
    
    const chatId = msg.message.chat.id;
    const userInfo = msg.from;
    const state = await this.getState(userInfo.id);
    if (state === USER_STATES.AWAITING_REGISTRATION) {
      await this.registrationHandler.handleRegistration(chatId, userInfo.id, userInfo.username);
    } else {
      await this.bot.sendMessage(chatId, "🛑 You are already registered buddy");
    }
  }
  

  /**
   * Handles registration cancellation.
   * @param {object} msg - Message object.
   */
  async handleCancelRegistration(msg) {
    await this.bot.sendMessage(msg.chat.id, "❌ Registration cancelled. Use /start when you're ready to begin.");
    await this.clearState(msg.from.id);
  }

  /**
   * Shows the main menu by delegating to the menu handler.
   * @param {object} msg - Message object.
   */
  async handleStartMenu(msg) {
    await this.menuHandler.showMainMenu(msg.chat.id);
  }

  /**
   * Retries starting the bot by re-invoking handleStart.
   * @param {object} msg - Message object.
   */
  async retryStart(msg) {
    await this.handleStart(msg);
  }

  /**
   * Handles callback queries that are dispatched to this command.
   * In this implementation, we forward the query to the event handler.
   * @param {object} query - Callback query object.
   */
  async handleCallback(query) {
    // Here we expect query.data and query.message.chat.id to be present.
    const action = query.data;
    // Emit the action to the event handler. (It will call registered callbacks.)
    const handled = this.eventHandler.emit(action, query);
    if (!handled) {
      console.warn(`Unhandled callback action: ${action}`);
    }
  }

  /**
   * A helper to catch errors in a given function and delegate to ErrorHandler.
   * @param {Function} fn - The function to execute.
   * @param {number} chatId - The chat id where errors should be reported.
   */
  async safeHandle(fn, chatId) {
    try {
      await fn();
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }
}
