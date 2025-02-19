import { BaseCommand } from "../base/BaseCommand.js";
import { AlertHandler } from "./handlers/AlertHandler.js";
import { USER_STATES } from "../../core/constants.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { FlowManager } from "../../services/ai/flows/FlowManager.js";
import { Markup } from "telegraf";
import { Command } from "../base/Command.js";

export class PriceAlertsCommand extends Command {
  constructor(bot, eventHandler) {
    super(bot, eventHandler);
    this.bot = bot;
    this.command = "/pricealerts";
    this.description = "Set price alerts";
    this.pattern = /^(\/pricealerts|💰 Price Alerts)$/;

    this.alertHandler = new AlertHandler(bot);
    this.eventHandler = eventHandler;

    this.registerCallbacks();
    this.flowManager = new FlowManager();
  }

  registerCallbacks() {
    this.eventHandler.on("create_price_alert", async (query) =>
      this.handleCreatePriceAlert(query)
    );
    this.eventHandler.on("enable_swap", async (query) =>
      this.handleEnableSwap(query)
    );
    this.eventHandler.on("skip_swap", async (query) =>
      this.handleSkipSwap(query)
    );
    this.eventHandler.on("confirm_alert", async (query) =>
      this.handleConfirmAlert(query)
    );
    this.eventHandler.on("back_to_price_alerts", async (query) =>
      this.handleBackToPriceAlerts(query)
    );
  }

  async execute(msg) {
    const chatId = msg.chat.id;
    try {
      await this.showPriceAlertsMenu(chatId, msg.from);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async showPriceAlertsMenu(chatId, userInfo) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("➕ Create Alert", "create_price_alert")],
      [Markup.button.callback("📋 View Alerts", "view_price_alerts")],
      [Markup.button.callback("↩️ Back", "back_to_notifications")],
    ]);

    await this.bot.sendMessage(
      chatId,
      "*Price Alerts* 🔔\n\n" +
        "Create and manage price alerts:\n\n" +
        "• Set target prices\n" +
        "• Enable auto-swaps\n" +
        "• Multi-token monitoring\n" +
        "• Real-time notifications",
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }
    );
  }

  async handleCreatePriceAlert(query) {
    const chatId = query.message.chat.id;
    const userInfo = query.from;

    try {
      // Start alert flow with initial data
      const result = await this.flowManager.startFlow(userInfo.id, "alert", {
        chatId,
        userInfo,
        type: "price_alert",
      });

      // Show initial prompt based on flow response
      await this.bot.sendMessage(
        chatId,
        result.response ||
          "*Create Price Alert* 🎯\n\nPlease enter the token address:",
        {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback("❌ Cancel", "back_to_price_alerts")],
          ]),
        }
      );
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async handleInput(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      // Check if user is in a flow
      if (!this.flowManager.isInFlow(userId)) {
        return false;
      }

      // Continue the flow with user input
      const result = await this.flowManager.continueFlow(userId, msg.text);

      // Handle flow response
      if (result.response) {
        await this.bot.sendMessage(chatId, result.response, {
          parse_mode: "Markdown",
          reply_markup: Markup.inlineKeyboard(result.keyboard || []),
        });
      }

      // Handle flow completion
      if (result.completed) {
        if (result.alert) {
          await this.alertHandler.savePriceAlert(chatId, userId, result.alert);
        }
        await this.showPriceAlertsMenu(chatId, msg.from);
      }

      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  async handleCallback(query) {
    const chatId = query.message.chat.id;
    const action = query.data;

    try {
      // Check if callback is for flow
      if (this.flowManager.isInFlow(query.from.id)) {
        const result = await this.flowManager.handleCallback(
          query.from.id,
          action
        );
        if (result.handled) return;
      }

      // Handle other callbacks
      const handled = await this.eventHandler.emit(action, query);
      if (!handled) {
        console.warn(`Unhandled callback action: ${action}`);
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async handleEnableSwap(query) {
    const chatId = query.message.chat.id;
    const userInfo = query.from;

    try {
      const userData = await this.getUserData(userInfo.id);
      await this.alertHandler.handleEnableSwap(
        chatId,
        userInfo,
        userData.pendingAlert.tokenAddress,
        userData.pendingAlert.walletAddress,
        userData.pendingAlert.amount
      );
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async handleSkipSwap(query) {
    const chatId = query.message.chat.id;
    const userInfo = query.from;

    try {
      await this.showAlertConfirmation(chatId, userInfo);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async handleConfirmAlert(query) {
    const chatId = query.message.chat.id;
    const userInfo = query.from;

    try {
      const alertData = await this.getUserData(userInfo.id);
      await this.alertHandler.savePriceAlert(
        chatId,
        userInfo,
        alertData.pendingAlert
      );
      await this.clearState(userInfo.id);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async handleBackToPriceAlerts(query) {
    const chatId = query.message.chat.id;

    try {
      await this.showPriceAlertsMenu(chatId, query.from);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async showAlertConfirmation(chatId, userInfo) {
    const userData = await this.getUserData(userInfo.id);
    const { pendingAlert } = userData;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Confirm", "confirm_alert"),
        Markup.button.callback("❌ Cancel", "back_to_price_alerts"),
      ],
    ]);

    await this.bot.sendMessage(
      chatId,
      "*Confirm Price Alert* ✅\n\n" +
        `Token: ${pendingAlert.tokenInfo.symbol}\n` +
        `Target Price: $${pendingAlert.targetPrice}\n` +
        `Condition: ${pendingAlert.condition}\n` +
        `Network: ${networkState.getNetworkDisplay(pendingAlert.network)}`,
      {
        parse_mode: "Markdown",
        reply_markup: keyboard,
      }
    );
  }
}
