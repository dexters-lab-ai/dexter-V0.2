import { Command } from "../base/Command.js";
import { Markup } from "telegraf";

export class HelpCommand extends Command {
  constructor(bot) {
    super(bot);
    this.bot = bot;
    this.command = "/help";
    this.description = "Show help menu";
    this.pattern = /^(\/help|❓ Help)$/;
  }

  /**
   * Executes when the user types /help or selects Help from a menu.
   */
  async execute(msg) {
    const chatId = msg.chat.id;
    await this.showHelpMenu(chatId);
  }

  /**
   * Handles callback queries from inline buttons.
   */
  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const action = query.data;

    try {
      switch (action) {
        case "help_trading":
          await this.showTradingHelp(chatId);
          break;

        case "help_wallets":
          await this.showWalletsHelp(chatId);
          break;

        case "help_automation":
          await this.showAutomationHelp(chatId);
          break;

        case "help_encryption":
          await this.showEncryptionHelp(chatId);
          break;

        case "help_architecture":
          await this.showArchitectureHelp(chatId);
          break;

        case "help_scenarios":
          await this.showScenariosHelp(chatId);
          break;

        case "back_to_help":
        case "back_to_menu":
          await this.showHelpMenu(chatId);
          break;

        default:
          console.warn(`⚠️ Unhandled HelpCommand callback: ${action}`);
          await this.bot.answerCallbackQuery(query.id, {
            text: "No handler found for that action.",
          });
      }

      // Acknowledge callback
      await this.bot.answerCallbackQuery(query.id);
    } catch (error) {
      console.error("❌ Error handling help callback:", error);
      await this.bot.answerCallbackQuery(query.id, {
        text: "An error occurred while processing your request.",
      });
    }
  }

  /**
   * Displays the main help menu.
   */
  async showHelpMenu(chatId) {
    const keyboard = {
      inline_keyboard: [
        [{ text: "💱 Trading Features", callback_data: "help_trading" }],
        [{ text: "👛 Wallet Management", callback_data: "help_wallets" }],
        [{ text: "🤖 Automation & AI", callback_data: "help_automation" }],
        [{ text: "🛡️ Encryption & Security", callback_data: "help_encryption" }],
        [{ text: "⚙️ Advanced Architecture", callback_data: "help_architecture" }],
        [{ text: "🌟 Multi-Level Swaps & Scenarios", callback_data: "help_scenarios" }],
        [{ text: "↩️ Back to Menu", callback_data: "back_to_menu" }],
      ],
    };

    const message = `*KATZ! [O.P.E.R.A.T.O.R-TG] *

• 💭The most capable AI assistant, companion, and agent for Web2 and Web3 tasks.
• 💭The AI that does things for you - all you have to do is tell it!

*Key Features:*
• Switch between DeepSeek or OpenAi seemlesly whilst in in-use to get your prefered perfomance.
• Autonomous trading with real-time updates.
• Complex multi-step task handling in sequence or async, with batch processing.
• Limit orders? Done. AI calculates and executes seamlessly through QuickNode.
• Voice navigation with precise execution. Operate in lazy mode—it will talk back!
• AI-compiled research on trending tokens, sentiment, narratives, price action, news, mindshare, and KOL opinions.
• Secure internal and external wallet management for Solana, Avalanche, Base, and Ethereum.
• Bank-grade encryption and data protection.
• Advanced architecture for reliability and speed.
• Flip Mode for tracking trends and auto-swaps.
• Internet-linked searches and opinions on every ticker, symbol, and cashtag.
• Copy a KOL? KATZ! [O.P.E.R.A.T.O.R-TG] will buy when your delegated KOL tweets.
• Multi-LLM MCP Architecture: scalable integration of new LLM features.
• Use Solana Pay for crypto payments online, including on Shopify!
• Try the demo store on Shopify—look for "Snowboards" or "Gift Card". Amazon and Shopify merchants are coming!
• Spend your crypto easily with Crypto Gift Cards from Bitrefill.
• Bridge from Solana to Avalanche or Ethereum using Wormhole.
• Execute the quickest and cheapest swaps via QuickNodes Jupiter API V6.
• View your portfolio and manage price alerts with NLI.
• Create and manage price alerts for any token, with optional auto-swap triggers.
• Set up your Google Cloud account to manage emails and calendar events. Send a voicenote saying "please check my emails" and it will read them out!

💡🧠 *TRY THIS OUT:*
• Ask for popular narratives, trending tokens, and have it filter the top 5 by price and volume metrics.
• Request the price and sentiment of a token from Cookie.fun.
• Then ask if it's a buy based on all the research and validate with the latest Bitcoin news.
• You can even ask for online Trump news and policies.
• Finally, instruct "Buy 0.001 SOL worth of SNAI using my Solana wallet."
• Next, set a price alert for SNAI for when it's 50% higher, with a condition to sell all when triggered.
• Explore further and provide feedback!

Select a category to explore more, or simply ask the agent about it.
🌟 *When more? Soon...*`;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }

  async showTradingHelp(chatId) {
    await this.sendHelpSection(
      chatId,
    "💱 *Trading Features*",
     `💭 *Limit Orders*: Automate trades at specific price points.
      💭 *Flip Mode*: Catch trends and execute rapid trades.
      💭 *Price Alerts*: Set auto-trade triggers.
      💭 *AI Predictions*: Get data-driven market insights.
      💭 *Batch Processing*: Trade multiple tokens simultaneously.

      💡 *Example:*
      • "Check the sentiment of $SNAI, if its bullish Buy 1 SOL worth of $SNAI when it drops to 50% from now, sell half at $40, the rest at $200. Buy back again with 2 SOL at $100 and send me an email of the final transaction link"`
    );
  }

  async showWalletsHelp(chatId) {
    await this.sendHelpSection(
      chatId,
      "👛 *Wallet Management*",
       `💭 *Multi-Chain Support*: Avalanche, Solana, Ethereum, and Base.
        💭 *WalletConnect*: Integrate MetaMask, Trust Wallet, etc.
        💭 *Real-Time Tracking*: Monitor balances & transactions.
        💭 *Encrypted Transactions*: Keep transfers private.`
    );
  }

  async showAutomationHelp(chatId) {
    await this.sendHelpSection(
      chatId,
    "🤖 *Automation & AI*",
     `💭 *Auto-Trading*: AI executes trades based on strategy.
      💭*Task Batching*: Execute multiple tasks in parallel and asynchronously.
      💭 *Voice Navigation*: lazy to type, just speak to it it talks back! Lazy mode.
      💭 *AI Sleep Mode*: Toggle AI/manual trading though wallet settings and disable AI trades.

      💡 *Example:*
      • "Check the latest BTC & Tarriff news from Trump online. Fetch the prices of BTC, SOL and FTM. Check the sentiment of each on twitter. Fecth trending tokens by Mindshare, tell me what to buy and if market and news supports it."`
    );
  }

  async showEncryptionHelp(chatId) {
    await this.sendHelpSection(
      chatId,
     "🛡️ *Encryption & Security*",
     `💭 *AES-256 Encryption*: Personal information is stored securely using the best standards.
      💭 *Privacy First*: Full control over your data.
      💭 *Secure Wallet Sync*: Connect external wallets safely, or default to a internal wallet inside the bot you can create/update anytime`
    );
  }

  async showArchitectureHelp(chatId) {
    await this.sendHelpSection(
      chatId,
      "⚙️ *Advanced Architecture*",
      `💭 *WebSocket Reliability*: Real-time execution.
       💭 *Circuit Breaking*: Prevents overloads with rate limits and circuit breakers across all services.
       💭 *Database Caching*: Accelerates data queries and reduces load times for frequent queries.
       💭 *Scalable Processing*: Built to scale with companies like OpenAI and DeepSeek seemlessly.`
    );
  }

  async showScenariosHelp(chatId) {
    await this.sendHelpSection(
      chatId,
      "🌟 *Natural Language Commands*: Build trading strategies with simple inputs.",
      `💭 *Smart Swaps*: AI optimizes trade execution paths.
       💭 *Multi-Step Trades*: Automate sequences like DCA.
       💭 *Dynamic Scenarios*: Set risk-based trade conditions.

      💡 *Example:*
      • "Research the hot gems from Cookie.fun, vet with twitter sentiment independently, check overal market sentiment and metric then tell me the best time to buy. Email me the final report @"`
    );
  }

  /**
   * Generic function to send help section messages.
   */
  async sendHelpSection(chatId, title, text) {
    const keyboard = {
      inline_keyboard: [[{ text: "↩️ Back to Help", callback_data: "back_to_help" }]],
    };

    await this.bot.sendMessage(chatId, `${title}\n\n${text}`, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
}
