import { Markup } from "telegraf";
import { User } from "../../../models/User.js";
import { networkState } from "../../../services/networkState.js";
import { WelcomeHandler } from "./WelcomeHandler.js";
import { RegistrationHandler } from "./RegistrationHandler.js";
import { MenuHandler } from "./MenuHandler.js";
import { USER_STATES } from "../../../core/constants.js";
import { ErrorHandler } from "../../../core/errors/index.js";

export class StartCommand {
  constructor(bot, eventHandler) {
    this.bot = bot;
    this.command = "/start";
    this.description = "Start the bot";
    this.pattern = /^\/start$/;

    if (!eventHandler) {
      throw new Error("Event handler is required for StartCommand");
    }

    this.eventHandler = eventHandler;

    // Initialize handlers
    this.welcomeHandler = new WelcomeHandler(bot);
    this.registrationHandler = new RegistrationHandler(bot);
    this.menuHandler = new MenuHandler(bot);

    // Register event callbacks
    this.registerCallbacks();
  }

  registerCallbacks() {
    this.eventHandler.on("register_user", async (ctx) =>
      this.safeHandle(() => this.handleRegistration(ctx), ctx.chat.id)
    );
    this.eventHandler.on("cancel_registration", async (ctx) =>
      this.safeHandle(() => this.handleCancelRegistration(ctx), ctx.chat.id)
    );
    this.eventHandler.on("start_menu", async (ctx) =>
      this.safeHandle(() => this.handleStartMenu(ctx), ctx.chat.id)
    );
    this.eventHandler.on("retry_start", async (ctx) =>
      this.safeHandle(() => this.retryStart(ctx), ctx.chat.id)
    );
  }

  async execute(ctx) {
    await this.safeHandle(() => this.handleStart(ctx.chat.id, ctx.from), ctx.chat.id);
  }

  async handleStart(chatId, userInfo) {
    await this.clearState(userInfo.id);

    const currentNetwork = await networkState.getCurrentNetwork(userInfo.id);
    const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();

    const startMessage = `
🐈‍⬛ *KATZ - Autonomous AI Agent...* 🐈‍⬛

_AI trench pawtner on SOL, Base, ETH_

🔍 *Personal meme trading agent:* 😼
• 🦴 All in one crypto trading, transacting, and shopping assistant
• 🦴 AI Token Suggestions
• 🦴 AI Task Monitoring and Execution
• 🦴 Twitter sentiment scanning and KOL monitoring
• 🦴 Autonomous Voice Trading
• 🦴 Pump.fun, Moonshot and more...

🐕 *Origins:* Courage The Cowardly Dog (meme)

Chain: *${networkState.getNetworkDisplay(currentNetwork)}*
`.trim();

    await this.bot.telegram.sendAnimation(
      chatId,
      "https://i.giphy.com/media/v1.Y2lkPTc5MGI3NjExa2JkenYycWk0YjBnNXhhaGliazI2dWxwYm94djNhZ3R1dWhsbmQ2MCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/xouqS1ezHDrNkhPWMI/giphy.gif",
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

  async showRegistrationPrompt(chatId) {
    await this.bot.telegram.sendMessage(
      chatId,
      `*🆕 First Time?...*\n\n` +
        `_Let's get you set up with your own secure wallets and access to all KATZ features!_\n\n` +
        `• Secure wallet creation\n` +
        `• Multi-chain trenching\n` +
        `• AI-powered trading\n` +
        `• And much more...\n\n` +
        `Ready to start? 🚀`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("🎯 Register Now", "register_user")],
          [Markup.button.callback("❌ Cancel", "cancel_registration")],
        ]),
      }
    );
  }

  async handleRegistration(ctx) {
    const chatId = ctx.chat.id;
    const userInfo = ctx.from;

    const state = await this.getState(userInfo.id);
    if (state === USER_STATES.AWAITING_REGISTRATION) {
      await this.registrationHandler.handleRegistration(ctx);
    } else {
      await ctx.reply("🛑 You are already registered or in another state.");
    }
  }

  async handleCancelRegistration(ctx) {
    await ctx.reply("❌ Registration cancelled. Use /start when you're ready to begin.");
    await this.clearState(ctx.from.id);
  }

  async handleStartMenu(ctx) {
    await this.menuHandler.showMainMenu(ctx.chat.id);
  }

  async retryStart(ctx) {
    await this.handleStart(ctx.chat.id, ctx.from);
  }

  async handleCallback(ctx) {
    const action = ctx.callbackQuery.data;
    const handled = this.eventHandler.emit(action, ctx);

    if (!handled) {
      console.warn(`Unhandled callback action: ${action}`);
    }
  }

  async safeHandle(fn, chatId) {
    try {
      await fn();
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }
}
