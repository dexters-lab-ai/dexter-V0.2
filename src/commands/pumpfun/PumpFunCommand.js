import { User } from "../../models/User.js";
import { Command } from "../base/Command.js";
import { flipperMode } from "../../services/pumpfun/FlipperMode.js";
import { USER_STATES } from "../../core/constants.js";
import { circuitBreakers, BREAKER_CONFIGS } from "../../core/circuit-breaker/index.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { Markup } from "telegraf";
import WebSocket from "ws";

// --------------
// Single Websocket Connection
// --------------
let ws = null;
function getPumpPortalWebsocket() {
  // If we already have a connection, return it
  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  }

  // Otherwise, create a new connection
  ws = new WebSocket("wss://pumpportal.fun/api/data");

  ws.on("open", () => {
    console.log("Connected to PumpPortal Websocket.");
  });

  ws.on("close", () => {
    console.log("PumpPortal Websocket closed.");
    ws = null;
  });

  ws.on("error", (err) => {
    console.error("PumpPortal Websocket error:", err.message);
  });

  return ws;
}

// --------------
// Watch Sessions: chatId -> { tokens: [], timer: null, subscribed: boolean }
// --------------
const watchSessions = new Map();

export class PumpFunCommand extends Command {
  constructor(bot, eventHandler) {
    super(bot, eventHandler);
    this.bot = bot;
    this.command = "/pumpfun";
    this.description = "Trade Pump.fun launches, real Degen";
    this.pattern = /^(\/pumpfun|💊 Pump\.fun)$/;

    this.setupFlipperModeHandlers();
  }

  // -------------------------
  // FLIPPER MODE EVENT HANDLERS
  // -------------------------
  setupFlipperModeHandlers() {
    flipperMode.on("entryExecuted", async ({ token, result }) => {
      await this.sendFlipperNotification("New Trench Entry 📈", token, result.price);
    });

    flipperMode.on("exitExecuted", async ({ token, reason, result }) => {
      await this.sendFlipperNotification("Trench Exit 📉", token, result.price, reason);
    });
  }

  async sendFlipperNotification(title, token, price, reason = null) {
    try {
      await circuitBreakers.executeWithBreaker(
        "pumpFun",
        async () => {
          let message = `*${title}*\n\nToken: ${token.symbol}\nPrice: $${price}\n`;
          if (reason) message += `Reason: ${reason}\n`;
          message += "\n";

          // If there's no userId set, skip sending
          if (!this.userId) return;
          await this.bot.sendMessage(this.userId, message, { parse_mode: "Markdown" });
        },
        BREAKER_CONFIGS.pumpFun
      );
    } catch (error) {
      ErrorHandler.handle(error);
    }
  }

  // -------------------------
  // BOT COMMAND EXECUTION
  // -------------------------
  async execute(msg) {
    try {
      const chatId = msg.chat.id;
      await this.handlePumpFunCommand(chatId, msg.from);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, msg.chat.id);
    }
  }

  async handlePumpFunCommand(chatId, userInfo) {
    await circuitBreakers.executeWithBreaker(
      "pumpFun",
      async () => {
        const user = await User.findByTelegramId(userInfo.id);
        if (!user) {
          return this.showWalletRequiredMessage(chatId);
        }

        // Check for an autonomous Solana wallet
        const solanaWallet = user.wallets.solana?.find((w) => w.isAutonomous);
        if (!solanaWallet) {
          return this.bot.sendMessage(
            chatId,
            "❌ *No Solana wallet enabled for autonomous trading.*\n\nPlease enable autonomous trading in wallet settings.",
            {
              parse_mode: "Markdown",
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("⚙️ Go to Wallets", "back_to_wallets")],
              ]),
            }
          );
        }

        const loadingMsg = await this.showLoadingMessage(chatId, "🚀 Loading PumpFun data...");
        const positions = flipperMode.getOpenPositions();
        await this.deleteMessage(chatId, loadingMsg.message_id);

        // Main menu keyboard
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback("👀 Watch New Tokens", "pump_watch")],
          [Markup.button.callback("💰 Buy Token", "pump_buy")],
          [Markup.button.callback("💱 Sell Token", "pump_sell")],
          [Markup.button.callback("🤖 FlipperMode", "flipper_mode")],
          [Markup.button.callback("📊 View Positions", "view_positions")],
          [Markup.button.callback("↩️ Back to Menu", "back_to_menu")],
        ]);

        let message = "*PumpFun Trading* 💊\n\n";
        message += `Active Wallet: \`${solanaWallet.address}\` on *Solana*\n\n`;

        if (positions.length > 0) {
          message += "*Active Positions:*\n";
          positions.forEach((pos, i) => {
            message += `${i + 1}. ${pos.token.symbol} - $${pos.currentPrice}\n`;
          });
          message += "\n";
        }

        message +=
          "Select an action:\n\n" +
          "• Watch new token listings\n" +
          "• Buy tokens with SOL\n" +
          "• Sell tokens for SOL\n" +
          "• Enable FlipperMode\n" +
          "• Manage positions";

        await this.bot.sendMessage(chatId, message, { parse_mode: "Markdown", reply_markup: keyboard });
      },
      BREAKER_CONFIGS.pumpFun
    );
  }

  // -------------------------
  // CALLBACK HANDLER
  // -------------------------
  async handleCallback(query) {
    const chatId = query.message.chat.id;
    const action = query.data;
    const userInfo = query.from;

    try {
      switch (action) {
        case "pump_watch":
          await this.startTokenWatching(chatId);
          break;
        case "pump_stopwatch":
          await this.stopTokenWatching(chatId, query.message.message_id);
          break;
        case "pump_buy":
          await this.showBuyForm(chatId);
          break;
        case "pump_sell":
          await this.showSellForm(chatId);
          break;
        case "flipper_mode":
          await this.startFlipperMode(chatId, userInfo);
          break;
        case "stop_flipper":
          await this.stopFlipperMode(chatId);
          break;
        case "view_positions":
          await this.showOpenPositions(chatId);
          break;
        case "pump_retry":
          await this.handlePumpFunCommand(chatId, userInfo);
          break;
        case "back_to_wallets":
          await this.showWalletRequiredMessage(chatId);
          break;
        default:
          if (action.startsWith("close_position_")) {
            const tokenAddress = action.replace("close_position_", "");
            await this.closePosition(chatId, tokenAddress);
          } else if (action.startsWith("adjust_tp_")) {
            const tokenAddress = action.replace("adjust_tp_", "");
            await this.adjustTakeProfit(chatId, tokenAddress);
          } else if (action.startsWith("adjust_sl_")) {
            const tokenAddress = action.replace("adjust_sl_", "");
            await this.adjustStopLoss(chatId, tokenAddress);
          }
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  // -------------------------
  // WATCHING NEW TOKENS
  // -------------------------
  async startTokenWatching(chatId) {
    await this.setState(chatId, USER_STATES.WATCHING_PUMP_TOKENS);

    const keyboard = {
      inline_keyboard: [[{ text: "🛑 Stop Monitoring", callback_data: "pump_stopwatch" }]],
    };

    const msg = await this.bot.sendMessage(chatId, "👀 Watching for new tokens...", { reply_markup: keyboard });
    const sessionData = { tokens: [], timer: null, subscribed: false };

    // 1) Initialize single WS connection
    const ws = getPumpPortalWebsocket();

    // 2) Subscribe to new token events
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      sessionData.subscribed = true;
    } else {
      ws.on("open", () => {
        ws.send(JSON.stringify({ method: "subscribeNewToken" }));
        sessionData.subscribed = true;
      });
    }

    // 3) Listen for data on the same ws
    ws.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw);
        if (data?.event === "newToken" && sessionData.subscribed) {
          // token object from the server
          const token = data?.payload;
          if (token) {
            sessionData.tokens.push(token);

            const pumpFunLink = `https://pump.fun/coin/${token.address}`;
            await this.bot.sendMessage(
              chatId,
              `🆕 *New Token Listed*\n\n` +
                `🪙 **Symbol**: ${token.symbol}\n` +
                `💵 **Price**: $${token.price}\n` +
                `🔗 [View on Pump.fun](${pumpFunLink})\n` +
                `⏰ **Time**: ${new Date().toLocaleTimeString()}`,
              { parse_mode: "Markdown" }
            );
          }
        }
      } catch (error) {
        console.error("Error parsing newToken message:", error);
      }
    });

    watchSessions.set(chatId, sessionData);

    const timer = setTimeout(async () => {
      await this.stopTokenWatching(chatId, msg.message_id);
    }, 5 * 60 * 1000);

    sessionData.timer = timer;
  }

  async stopTokenWatching(chatId, loadingMsgId = null) {
    const session = watchSessions.get(chatId);
    if (!session) return;

    // 1) unsubscribe from "newToken"
    if (session.subscribed) {
      const ws = getPumpPortalWebsocket();
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ method: "unsubscribeNewToken" }));
      }
    }

    if (session.timer) clearTimeout(session.timer);
    if (loadingMsgId) {
      await this.deleteMessage(chatId, loadingMsgId);
    }

    const timestamp = new Date().toLocaleTimeString();

    if (!session.tokens.length) {
      await this.bot.sendMessage(chatId, "🛑 Monitoring stopped. No new tokens were launched.");
    } else {
      let finalList =
        `**Monitoring Stopped**\n\n` +
        `_Powered by Pump.fun_\n` +
        `**Time Ended**: ${timestamp}\n` +
        `**Total Tokens Found**: ${session.tokens.length}\n\n`;
      session.tokens.forEach((token, i) => {
        const pumpFunLink = `https://pump.fun/coin/${token.address}`;
        finalList += `- ${i + 1}. 🪙 **${token.symbol}** - $${token.price}\n` +
                     `  [View on Pump.fun](${pumpFunLink})\n\n`;
      });

      await this.bot.sendMessage(chatId, finalList, { parse_mode: "Markdown" });
    }

    watchSessions.delete(chatId);
    await this.clearState(chatId);
  }

  // -------------------------
  // BUY / SELL FORMS
  // -------------------------
  async showBuyForm(chatId) {
    await this.bot.sendMessage(
      chatId,
      "*Buy Token* 💰\n\nEnter the token address and amount to buy:\n\nFormat: `<token_address> <amount_in_sol>`",
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "back_to_pump")]]),
      }
    );
  }

  async showSellForm(chatId) {
    await this.bot.sendMessage(
      chatId,
      "*Sell Token* 💱\n\nEnter the token address and amount to sell:\n\nFormat: `<token_address> <amount_in_tokens>`",
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "back_to_pump")]]),
      }
    );
  }

  // -------------------------
  // TAKE PROFIT / STOP LOSS
  // -------------------------
  async adjustTakeProfit(chatId, tokenAddress) {
    await this.bot.sendMessage(chatId, "*Adjust Take Profit* 📈\n\nEnter the new TP percentage:", {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", `position_details_${tokenAddress}`)]]),
    });
    this.setState(chatId, USER_STATES.WAITING_TP_INPUT);
    this.setUserData(chatId, { pendingTP: { tokenAddress } });
  }

  async adjustStopLoss(chatId, tokenAddress) {
    await this.bot.sendMessage(chatId, "*Adjust Stop Loss* 📉\n\nEnter the new SL percentage:", {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", `position_details_${tokenAddress}`)]]),
    });
    this.setState(chatId, USER_STATES.WAITING_SL_INPUT);
    this.setUserData(chatId, { pendingSL: { tokenAddress } });
  }

  async handleInput(ctx) {
    const state = await this.getState(ctx.chat.id);
    if (state === USER_STATES.WAITING_TP_INPUT) {
      await this.updateTakeProfit(ctx.chat.id, ctx.message.text);
    } else if (state === USER_STATES.WAITING_SL_INPUT) {
      await this.updateStopLoss(ctx.chat.id, ctx.message.text);
    }
  }

  async updateTakeProfit(chatId, percentage) {
    const userData = await this.getUserData(chatId);
    const tokenAddress = userData.pendingTP?.tokenAddress;
    if (isNaN(percentage) || percentage <= 0) {
      await this.bot.sendMessage(chatId, "❌ Invalid percentage entered. Please try again.");
      return;
    }
    // ... timedOrderService logic ...
    await this.bot.sendMessage(chatId, `✅ Take Profit set at ${percentage}% successfully!`);
    await this.clearState(chatId);
  }

  async updateStopLoss(chatId, percentage) {
    const userData = await this.getUserData(chatId);
    const tokenAddress = userData.pendingSL?.tokenAddress;
    if (isNaN(percentage) || percentage <= 0) {
      await this.bot.sendMessage(chatId, "❌ Invalid percentage entered. Please try again.");
      return;
    }
    // ... timedOrderService logic ...
    await this.bot.sendMessage(chatId, `✅ Stop Loss set at ${percentage}% successfully!`);
    await this.clearState(chatId);
  }

  // -------------------------
  // POSITIONS MANAGEMENT
  // -------------------------
  async closePosition(chatId, tokenAddress) {
    await circuitBreakers.executeWithBreaker(
      "pumpFun",
      async () => {
        const loadingMsg = await this.showLoadingMessage(chatId, "🔄 Closing position...");
        try {
          const result = await flipperMode.closePosition(tokenAddress);
          await this.deleteMessage(chatId, loadingMsg.message_id);

          await this.bot.sendMessage(
            chatId,
            `*Position Closed* ✅\n\n` +
              `Token: ${result.token.symbol}\n` +
              `Exit Price: $${result.price}\n` +
              `P/L: ${result.profitLoss}%`,
            {
              parse_mode: "Markdown",
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback("📊 View Positions", "view_positions")],
                [Markup.button.callback("↩️ Back", "back_to_pump")],
              ]),
            }
          );
        } catch (error) {
          await this.deleteMessage(chatId, loadingMsg.message_id);
          throw error;
        }
      },
      BREAKER_CONFIGS.pumpFun
    );
  }

  async showOpenPositions(chatId) {
    const positions = flipperMode.getOpenPositions();
    if (!positions.length) {
      return this.bot.sendMessage(
        chatId,
        "*No Open Positions* 📊\n\nStart trading or enable FlipperMode to open positions.",
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("🤖 FlipperMode", "flipper_mode")],
            [Markup.button.callback("↩️ Back", "back_to_pump")],
          ]),
        }
      );
    }

    const keyboard = Markup.inlineKeyboard(
      positions.map((pos) => [
        Markup.button.callback(`${pos.token.symbol} ($${pos.currentPrice})`, `position_details_${pos.token.address}`),
      ]).concat([[Markup.button.callback("↩️ Back", "back_to_pump")]])
    );

    const text = positions
      .map((pos, i) =>
        `${i + 1}. ${pos.token.symbol}\n` +
        `• Entry: $${pos.entryPrice}\n` +
        `• Current: $${pos.currentPrice}\n` +
        `• P/L: ${pos.profitLoss}%\n` +
        `• Time: ${pos.timeElapsed} mins`
      )
      .join("\n\n");

    await this.bot.sendMessage(chatId, `*Open Positions* 📊\n\n${text}`, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }

  // -------------------------
  // HELPER MESSAGES
  // -------------------------
  async showWalletRequiredMessage(chatId) {
    await this.bot.sendMessage(
      chatId,
      "❌ *No active Solana wallet found.*\n\nPlease create a wallet or enable autonomous trading first in the wallet settings.",
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("⚙️ Go to Wallets", "back_to_wallets")],
        ]),
      }
    );
  }

  async showLoadingMessage(chatId, message) {
    return this.bot.sendMessage(chatId, message);
  }

  async deleteMessage(chatId, messageId) {
    try {
      await this.bot.deleteMessage(chatId, messageId);
    } catch (error) {
      console.warn(`Could not delete message: ${error.message}`);
    }
  }
}
