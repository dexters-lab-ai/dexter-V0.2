import { Markup } from "telegraf";
import { WELCOME_MESSAGES, REGISTRATION_MESSAGES } from "../../../core/constants.js";

export class WelcomeHandler {
  constructor(bot) {
    this.bot = bot;
  }

  /** Show Welcome Message */
  async showWelcome(chatId) {
    const startMessage = `
# 🧠 D.A.I.L - Your Smart Companion for Crypto & Daily Digital Life 

**Live smarter, faster, better**

---

### 🧠 Intelligent Assistant:
- **Ticker Discovery** 🔎
- **Ticker Research & Analysis** 🔬
- **Autonomous Portfolio Management** ⚗️
- **Autonomous Position & Task Management** 🧫
- **Voice-Enabled Operations (Easy Mode)** 🗯️
- **Powered by:** OpenAI, DeepSeek, Google, Nvidia Parakeet
- **Services:** Pump.fun, SolanaPay, Google, Shopify, and more...

---

### 🧬 Origins:
**KATZ! from CTCD, D.A.I.L's Pilot Agent in Node.js **

`.trim();

    // Send animation with the welcome message
    await this.bot.sendAnimation(
      chatId,
      "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExeWJlaTQxdW01NW9jeGQ4aGlvM3c5YjJ2bTQ5bWY4cHVob2s0ajIwcSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/Aq1gmGwbJNye8Wvm4v/giphy.gif",
      {
        caption: startMessage,
        parse_mode: "Markdown",
        disable_web_page_preview: true,
      }
    );

    // Show registration prompt after the welcome animation
    await this.showRegistrationPrompt(chatId);
  }

  /** Show Registration Prompt */
  async showRegistrationPrompt(chatId) {
    // Create inline keyboard using Markup
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("🎯 Register Now", "register_user")],
      [Markup.button.callback("❌ Cancel", "cancel_registration")],
    ]);

    // Send registration prompt
    await this.bot.sendMessage(chatId, REGISTRATION_MESSAGES.PROMPT, {
      parse_mode: "Markdown",
      ...keyboard,
    });
  }

  /** Get Welcome Message for User */
  getWelcomeMessage(username, isNewUser = false) {
    const template = isNewUser
      ? WELCOME_MESSAGES.NEW_USER
      : WELCOME_MESSAGES.RETURNING_USER;
    return template.replace("{username}", username);
  }
}
