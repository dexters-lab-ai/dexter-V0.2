import { User } from "../../models/User.js";
import { Command } from "../../commands/base/Command.js";
import { flipperMode } from "../../services/pumpfun/FlipperMode.js";
import { USER_STATES } from "../../core/constants.js";
import { circuitBreakers, BREAKER_CONFIGS } from "../../core/circuit-breaker/index.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { Markup } from "telegraf";
import WebSocket from "ws";

// Single Websocket
let ws = null;
function getPumpPortalWebsocket() {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  ws = new WebSocket("wss://pumpportal.fun/api/data");
  ws.on("open", () => console.log("Connected to PumpPortal Websocket."));
  ws.on("close", () => {
    console.log("PumpPortal Websocket closed.");
    ws = null;
  });
  ws.on("error", (err) => console.error("PumpPortal Websocket error:", err.message));
  return ws;
}

// Watch sessions
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

  // -----------------
  // FlipperMode events
  // -----------------
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
      await circuitBreakers.executeWithBreaker("pumpFun", async () => {
        let msg = `*${title}*\n\nToken: ${token.symbol}\nPrice: $${price}\n`;
        if (reason) msg += `Reason: ${reason}\n`;
        if (!this.userId) return; // Skip if no user
        await this.bot.sendMessage(this.userId, msg, { parse_mode: "Markdown" });
      }, BREAKER_CONFIGS.pumpFun);
    } catch (error) {
      ErrorHandler.handle(error);
    }
  }

  // -----------------
  // Command Execution
  // -----------------
  async execute(msg) {
    try {
      const chatId = msg.chat.id;
      await this.showMainMenu(chatId, msg.from);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, msg.chat.id);
    }
  }

  // -----------------
  // Unified Callback
  // -----------------
  async handleCallback(query) {
    const chatId = query.message.chat.id;
    const action = query.data;
    const userInfo = query.from;
    try {
      switch (action) {
        case "pump_watch":
          return await this.startTokenWatching(chatId);
        case "pump_stopwatch":
          return await this.stopTokenWatching(chatId, query.message.message_id);
        case "pump_buy":
          return await this.showBuyForm(chatId);
        case "pump_sell":
          return await this.showSellForm(chatId);
        case "flipper_mode":
          return await this.startFlipperMode(chatId, userInfo);
        case "stop_flipper":
          return await this.stopFlipperMode(chatId, userInfo);
        case "view_positions":
          return await this.showOpenPositions(chatId);
        case "pump_retry":
          return await this.showMainMenu(chatId, userInfo);
        case "back_to_wallets":
          return await this.showWalletRequiredMessage(chatId);
        case "back_to_pump":
          return await this.showMainMenu(chatId, userInfo);
        default:
          // Check for dynamic actions
          if (action.startsWith("close_position_")) {
            const tokenAddress = action.replace("close_position_", "");
            return await this.closePosition(chatId, tokenAddress);
          }
          if (action.startsWith("adjust_tp_")) {
            const tokenAddress = action.replace("adjust_tp_", "");
            return await this.adjustTakeProfit(chatId, tokenAddress);
          }
          if (action.startsWith("adjust_sl_")) {
            const tokenAddress = action.replace("adjust_sl_", "");
            return await this.adjustStopLoss(chatId, tokenAddress);
          }
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  // -----------------
  // Show Main Menu
  // -----------------
  async showMainMenu(chatId, userInfo) {
    await circuitBreakers.executeWithBreaker("pumpFun", async () => {
      const user = await User.findByTelegramId(userInfo.id);
      if (!user) return this.showWalletRequiredMessage(chatId);

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

      const positions = flipperMode.getOpenPositions();
      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("👀 Watch New Tokens", "pump_watch")],
        [Markup.button.callback("💰 Buy Token", "pump_buy")],
        [Markup.button.callback("💱 Sell Token", "pump_sell")],
        [Markup.button.callback("🤖 FlipperMode", "flipper_mode")],
        [Markup.button.callback("📊 View Positions", "view_positions")],
        [Markup.button.callback("↩️ Back to Menu", "back_to_menu")],
      ]);

      let text = "*PumpFun Trading* 💊\n\n";
      text += `Active Wallet: \`${solanaWallet.address}\` on *Solana*\n\n`;
      if (positions.length > 0) {
        text += "*Active Positions:*\n";
        positions.forEach((pos, i) => {
          text += `${i + 1}. ${pos.token.symbol} - $${pos.currentPrice}\n`;
        });
        text += "\n";
      }
      text += "Select an action:\n• Watch new tokens\n• Buy or Sell tokens\n• Enable FlipperMode\n• Manage positions";
      await this.bot.sendMessage(chatId, text, { parse_mode: "Markdown", reply_markup: keyboard });
    }, BREAKER_CONFIGS.pumpFun);
  }

  // -----------------
  // Watch New Tokens
  // -----------------
  async startTokenWatching(chatId) {
    await this.setState(chatId, USER_STATES.WATCHING_PUMP_TOKENS);
    const keyboard = { inline_keyboard: [[{ text: "🛑 Stop Monitoring", callback_data: "pump_stopwatch" }]] };
    const msg = await this.bot.sendMessage(chatId, "👀 Watching for new tokens...", { reply_markup: keyboard });
    const sessionData = { tokens: [], timer: null, subscribed: false };

    const ws = getPumpPortalWebsocket();
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ method: "subscribeNewToken" }));
      sessionData.subscribed = true;
    } else {
      ws.on("open", () => {
        ws.send(JSON.stringify({ method: "subscribeNewToken" }));
        sessionData.subscribed = true;
      });
    }

    ws.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw);
        if (data?.event === "newToken" && sessionData.subscribed) {
          const token = data?.payload;
          if (token) {
            sessionData.tokens.push(token);
            const link = `https://pump.fun/coin/${token.address}`;
            await this.bot.sendMessage(
              chatId,
              `🆕 *New Token Listed*\n\n🪙 **Symbol**: ${token.symbol}\n💵 **Price**: $${token.price}\n` +
                `🔗 [View on Pump.fun](${link})\n⏰ **Time**: ${new Date().toLocaleTimeString()}`,
              { parse_mode: "Markdown" }
            );
          }
        }
      } catch (err) {
        console.error("Error parsing newToken message:", err);
      }
    });

    watchSessions.set(chatId, sessionData);
    const timer = setTimeout(async () => {
      await this.stopTokenWatching(chatId, msg.message_id);
    }, 5 * 60 * 1000);
    sessionData.timer = timer;
  }

  async stopTokenWatching(chatId, loadingMsgId) {
    const session = watchSessions.get(chatId);
    if (!session) return;
    if (session.subscribed) {
      const ws = getPumpPortalWebsocket();
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ method: "unsubscribeNewToken" }));
      }
    }
    if (session.timer) clearTimeout(session.timer);
    if (loadingMsgId) {
      try {
        await this.bot.deleteMessage(chatId, loadingMsgId);
      } catch (err) {
        console.warn("Can't delete message:", err.message);
      }
    }
    const stamp = new Date().toLocaleTimeString();
    if (!session.tokens.length) {
      await this.bot.sendMessage(chatId, "🛑 Monitoring stopped. No new tokens were launched.");
    } else {
      let txt = `**Monitoring Stopped**\n\n_Powered by Pump.fun_\n**Time Ended**: ${stamp}\n` +
                `**Total Tokens Found**: ${session.tokens.length}\n\n`;
      session.tokens.forEach((t, i) => {
        const link = `https://pump.fun/coin/${t.address}`;
        txt += `- ${i + 1}. 🪙 **${t.symbol}** - $${t.price}\n[View on Pump.fun](${link})\n\n`;
      });
      await this.bot.sendMessage(chatId, txt, { parse_mode: "Markdown" });
    }
    watchSessions.delete(chatId);
    await this.clearState(chatId);
  }

  // -----------------
  // Buy / Sell
  // -----------------
  async showBuyForm(chatId) {
    await this.bot.sendMessage(
      chatId,
      "*Buy Token* 💰\nEnter `<token_address> <amount_in_SOL>`",
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "back_to_pump")]]),
      }
    );
  }
  async showSellForm(chatId) {
    await this.bot.sendMessage(
      chatId,
      "*Sell Token* 💱\nEnter `<token_address> <amount_in_tokens>`",
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", "back_to_pump")]]),
      }
    );
  }

  // -----------------
  // FlipperMode
  // -----------------
  async startFlipperMode(chatId, userInfo) {
    await circuitBreakers.executeWithBreaker("pumpFun", async () => {
      // Minimal check
      const user = await User.findByTelegramId(userInfo.id);
      if (!user) return this.showWalletRequiredMessage(chatId);
      // Start flipper for this user
      flipperMode.enable(user);
      // Optionally store userId so we can send notifications
      this.userId = userInfo.id;
      await this.bot.sendMessage(
        chatId,
        "🤖 *FlipperMode Activated!*\n\nThe bot will automatically trade selected tokens.",
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("Stop FlipperMode", "stop_flipper")],
            [Markup.button.callback("↩️ Back", "back_to_pump")],
          ]),
        }
      );
    }, BREAKER_CONFIGS.pumpFun);
  }

  async stopFlipperMode(chatId, userInfo) {
    await circuitBreakers.executeWithBreaker("pumpFun", async () => {
      const user = await User.findByTelegramId(userInfo.id);
      if (!user) return this.showWalletRequiredMessage(chatId);
      flipperMode.disable(user);
      this.userId = null;
      await this.bot.sendMessage(
        chatId,
        "🤖 *FlipperMode Stopped.*\nNo more auto trades will occur.",
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("↩️ Back", "back_to_pump")],
          ]),
        }
      );
    }, BREAKER_CONFIGS.pumpFun);
  }

  // -----------------
  // Position Management
  // -----------------
  async showOpenPositions(chatId) {
    const positions = flipperMode.getOpenPositions();
    if (!positions.length) {
      return this.bot.sendMessage(
        chatId,
        "*No Open Positions* 📊\nStart trading or enable FlipperMode to open positions.",
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
      positions
        .map((pos) => [
          Markup.button.callback(
            `${pos.token.symbol} ($${pos.currentPrice})`,
            `position_details_${pos.token.address}`
          ),
        ])
        .concat([[Markup.button.callback("↩️ Back", "back_to_pump")]])
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

  async closePosition(chatId, tokenAddress) {
    await circuitBreakers.executeWithBreaker("pumpFun", async () => {
      const loading = await this.showLoadingMessage(chatId, "🔄 Closing position...");
      try {
        const result = await flipperMode.closePosition(tokenAddress);
        await this.deleteMessage(chatId, loading.message_id);
        await this.bot.sendMessage(
          chatId,
          `*Position Closed* ✅\nToken: ${result.token.symbol}\nExit Price: $${result.price}\nP/L: ${result.profitLoss}%`,
          {
            parse_mode: "Markdown",
            reply_markup: Markup.inlineKeyboard([
              [Markup.button.callback("📊 View Positions", "view_positions")],
              [Markup.button.callback("↩️ Back", "back_to_pump")],
            ]),
          }
        );
      } catch (err) {
        await this.deleteMessage(chatId, loading.message_id);
        throw err;
      }
    }, BREAKER_CONFIGS.pumpFun);
  }

  async adjustTakeProfit(chatId, tokenAddress) {
    await this.bot.sendMessage(chatId, "*Adjust Take Profit* 📈\nEnter the new TP %:", {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", `position_details_${tokenAddress}`)]]),
    });
    this.setState(chatId, USER_STATES.WAITING_TP_INPUT);
    this.setUserData(chatId, { pendingTP: { tokenAddress } });
  }
  async adjustStopLoss(chatId, tokenAddress) {
    await this.bot.sendMessage(chatId, "*Adjust Stop Loss* 📉\nEnter the new SL %:", {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([[Markup.button.callback("❌ Cancel", `position_details_${tokenAddress}`)]]),
    });
    this.setState(chatId, USER_STATES.WAITING_SL_INPUT);
    this.setUserData(chatId, { pendingSL: { tokenAddress } });
  }

  async handleInput(ctx) {
    // If a user is typing a numeric input for TP/SL, etc.
    const chatId = ctx.chat.id;
    const text = ctx.message.text?.trim();
    const state = await this.getState(chatId);

    if (state === USER_STATES.WAITING_TP_INPUT) {
      await this.updateTakeProfit(chatId, text);
    } else if (state === USER_STATES.WAITING_SL_INPUT) {
      await this.updateStopLoss(chatId, text);
    }
  }
  async updateTakeProfit(chatId, percentage) {
    const userData = await this.getUserData(chatId);
    const tokenAddress = userData?.pendingTP?.tokenAddress;
    if (isNaN(percentage) || percentage <= 0) {
      await this.bot.sendMessage(chatId, "❌ Invalid percentage. Try again or cancel.");
      return;
    }
    // ... do your logic ...
    await this.bot.sendMessage(chatId, `✅ Take Profit set to ${percentage}%!`);
    await this.clearState(chatId);
  }
  async updateStopLoss(chatId, percentage) {
    const userData = await this.getUserData(chatId);
    const tokenAddress = userData?.pendingSL?.tokenAddress;
    if (isNaN(percentage) || percentage <= 0) {
      await this.bot.sendMessage(chatId, "❌ Invalid percentage. Try again or cancel.");
      return;
    }
    // ... do your logic ...
    await this.bot.sendMessage(chatId, `✅ Stop Loss set to ${percentage}%!`);
    await this.clearState(chatId);
  }

  // -----------------
  // Helpers
  // -----------------
  async showWalletRequiredMessage(chatId) {
    await this.bot.sendMessage(
      chatId,
      "❌ *No active Solana wallet.*\nPlease create/enable a Solana wallet for PumpFun.",
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("⚙️ Go to Wallets", "back_to_wallets")],
        ]),
      }
    );
  }
  async showLoadingMessage(chatId, text) {
    return this.bot.sendMessage(chatId, text);
  }
  async deleteMessage(chatId, msgId) {
    try {
      await this.bot.deleteMessage(chatId, msgId);
    } catch (err) {
      console.warn("Could not delete message:", err.message);
    }
  }
}


export const pumpFunService = new PumpFunCommand({
  rpcUrl: 'https://api.mainnet-beta.solana.com',
});
