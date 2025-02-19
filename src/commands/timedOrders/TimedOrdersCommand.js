import { Markup } from "telegraf";
import { BaseCommand } from "../base/BaseCommand.js";
import { FlowManager } from "../../services/ai/flows/FlowManager.js";
import { timedOrderService } from "../../services/timedOrders.js";
import { User } from "../../models/User.js";
import { networkState } from "../../services/networkState.js";
import { dextools } from "../../services/dextools/index.js";
import { USER_STATES } from "../../core/constants.js";
import { format } from "date-fns";
import { ErrorHandler } from "../../core/errors/index.js";

export class TimedOrdersCommand extends BaseCommand {
  constructor(bot, eventHandler) {
    super(bot);
    this.command = "/timedorders";
    this.description = "Set timed orders";
    this.pattern = /^(\/timedorders|⚡ Timed Orders)$/;

    this.eventHandler = eventHandler;
    this.registerCallbacks();
    this.flowManager = new FlowManager();
  }

  /** Register Callback Queries */
  registerCallbacks() {
    this.eventHandler.on("set_timed_order", async (query) =>
      this.startOrderCreation(query.message.chat.id, query.from)
    );
    this.eventHandler.on("view_active_orders", async (query) =>
      this.showActiveOrders(query.message.chat.id, query.from)
    );
    this.eventHandler.on("confirm_order", async (query) =>
      this.handleOrderConfirmation(query.message.chat.id, query.from)
    );
    this.eventHandler.on("cancel_order", async (query) =>
      this.handleOrderCancellation(query.message.chat.id, query.from)
    );
    this.eventHandler.on(/^order_delete_/, async (query) => {
      const orderId = query.data.replace("order_delete_", "");
      await this.confirmOrderDeletion(query.message.chat.id, orderId, query.from);
    });
    this.eventHandler.on(/^order_delete_confirm_/, async (query) => {
      const orderId = query.data.replace("order_delete_confirm_", "");
      await this.handleOrderDeletion(query.message.chat.id, orderId, query.from);
    });
  }

  /** Main Entry Point */
  async execute(msg) {
    try {
      if (msg.text && !msg.text.startsWith("/")) {
        return this.handleNaturalLanguageInput(msg);
      }
      await this.showTimedOrdersMenu(msg.chat.id, msg.from);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, msg.chat.id);
    }
  }

  /** Handle Natural Language Input */
  async handleNaturalLanguageInput(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const result = await this.flowManager.startFlow(userId, "timedOrder", {
        chatId,
        userInfo: msg.from,
        naturalLanguageInput: msg.text,
      });

      if (result.requiresConfirmation) {
        await this.showOrderConfirmation(chatId, result.order);
      } else {
        await this.bot.sendMessage(chatId, result.response, {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard(result.keyboard.inline_keyboard),
        });
      }

      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /** Show Timed Orders Menu */
  async showTimedOrdersMenu(chatId, userInfo) {
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback("⚡ Set Auto Swap Order", "set_timed_order")],
      [Markup.button.callback("📋 View Active Orders", "view_active_orders")],
      [Markup.button.callback("↩️ Back", "back_to_notifications")],
    ]);

    await this.bot.sendMessage(
      chatId,
      `*Timed Orders* ⚡\n\n` +
        "Schedule automatic token swaps:\n\n" +
        "• Set buy/sell orders\n" +
        "• Schedule for specific time\n" +
        "• Multi-target orders\n" +
        "• Conditional execution\n\n" +
        "_Tip: Try typing naturally like:_\n" +
        '"Buy 1 SOL of BONK tomorrow at 3pm"',
      {
        parse_mode: "Markdown",
        ...keyboard,
      }
    );
  }

  /** Start Order Creation */
  async startOrderCreation(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() });

      if (!user?.settings?.autonomousWallet?.address) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback("⚙️ Go to Settings", "wallet_settings")],
        ]);

        await this.bot.sendMessage(
          chatId,
          "❌ Please set up an autonomous wallet first in Settings.",
          { ...keyboard }
        );
        return;
      }

      const result = await this.flowManager.startFlow(userInfo.id, "timedOrder", {
        chatId,
        userInfo,
        walletAddress: user.settings.autonomousWallet.address,
      });

      const progressMsg = await this.bot.sendMessage(
        chatId,
        "🔄 Processing your request...",
        { parse_mode: "Markdown" }
      );

      this.flowManager.on("flowProgress", async (data) => {
        if (data.userId === userInfo.id) {
          await this.updateProgressMessage(chatId, progressMsg.message_id, data);
        }
      });

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("❌ Cancel", "back_to_timed_orders")],
      ]);

      await this.bot.sendMessage(
        chatId,
        result.response || "*New Timed Order* ⚡\n\nPlease enter the token address:",
        { parse_mode: "Markdown", ...keyboard }
      );
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /** Update Progress Message */
  async updateProgressMessage(chatId, messageId, progress) {
    try {
      const message = this.formatProgressMessage(progress);
      await this.bot.editMessageText(chatId, messageId, null, message, {
        parse_mode: "Markdown",
      });
    } catch (error) {
      console.warn("Error updating progress message:", error);
    }
  }

  /** Format Progress Message */
  formatProgressMessage(progress) {
    const { step, totalSteps, currentStep, message, completed, error } = progress;

    if (error) {
      return `❌ Error: ${error}`;
    }

    const progressBar = this.createProgressBar(currentStep, totalSteps);

    return (
      `*Processing Order*\n\n` +
      `${progressBar}\n` +
      `Step ${currentStep}/${totalSteps}: ${message}\n\n` +
      (completed ? "✅ Step completed!" : "🔄 Processing...")
    );
  }

  /** Create Progress Bar */
  createProgressBar(current, total) {
    const width = 10;
    const filled = Math.floor((current / total) * width);
    return "▓".repeat(filled) + "░".repeat(width - filled);
  }

  /** Handle Input */
  async handleInput(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      if (!this.flowManager.isInFlow(userId)) {
        return false;
      }

      const result = await this.flowManager.continueFlow(userId, msg.text);

      if (result.error) {
        const keyboard = Markup.inlineKeyboard([
          [Markup.button.callback("❌ Cancel", "back_to_timed_orders")],
        ]);

        await this.bot.sendMessage(
          chatId,
          "❌ Invalid token address or symbol. Please try again:",
          { parse_mode: "Markdown", ...keyboard }
        );
        return true;
      }

      if (result.response) {
        await this.bot.sendMessage(chatId, result.response, {
          parse_mode: "Markdown",
          ...Markup.inlineKeyboard(result.keyboard.inline_keyboard),
        });
      }

      if (result.completed && result.order) {
        await this.showOrderConfirmation(chatId, result.order);
        return true;
      }

      return true;
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
      return false;
    }
  }

  /** Handle callback queries */
  async handleCallback(query) {
    const chatId = query.message.chat.id;
    const action = query.data;

    try {
      if (this.flowManager.isInFlow(query.from.id)) {
        const result = await this.flowManager.handleCallback(query.from.id, action);
        if (result.handled) return;
      }

      const handled = await this.eventHandler.emit(action, query);
      if (!handled) {
        console.warn(`Unhandled callback action: ${action}`);
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /** Handle order confirmation */
  async handleOrderConfirmation(chatId, userInfo) {
    try {
      const flow = this.flowManager.getActiveFlow(userInfo.id);
      if (!flow) {
        throw new Error("No active order flow found");
      }

      const result = await this.flowManager.continueFlow(userInfo.id, "confirm");

      if (result.completed && result.order) {
        await timedOrderService.createOrder(userInfo.id, result.order);

        await this.bot.sendMessage(
          chatId,
          `✅ Timed order created successfully!\n\n` +
            `Token: ${result.order.tokenSymbol}\n` +
            `Action: ${result.order.action}\n` +
            `Amount: ${result.order.amount}\n` +
            `Execute at: ${format(result.order.executeAt, "PPpp")}`,
          Markup.inlineKeyboard([
            [
              Markup.button.callback("📋 View Orders", "view_active_orders"),
              Markup.button.callback("↩️ Back", "back_to_notifications"),
            ],
          ])
        );
      }
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /** Handle order cancellation */
  async handleOrderCancellation(chatId, userInfo) {
    try {
      const flow = await this.flowManager.getActiveFlow(userInfo.id);
      if (flow) {
        await this.flowManager.cancelFlow(userInfo.id);
      }

      await this.showTimedOrdersMenu(chatId, userInfo);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /** Show active orders */
  async showActiveOrders(chatId, userInfo) {
    try {
      const orders = await timedOrderService.getActiveOrders(userInfo.id);

      if (!orders || orders.length === 0) {
        await this.bot.sendMessage(
          chatId,
          "*No Active Orders* 📋\n\n" +
            "You have no scheduled orders. Create one to get started!\n\n" +
            '_Tip: Try typing naturally like "Buy 1 SOL of BONK tomorrow at 3pm"_',
          Markup.inlineKeyboard([
            [Markup.button.callback("➕ Create Order", "set_timed_order")],
            [Markup.button.callback("↩️ Back", "back_to_notifications")],
          ])
        );
        return;
      }

      const ordersList = orders
        .map(
          (order, index) =>
            `${index + 1}. ${order.tokenSymbol}\n` +
            `• Action: ${order.action}\n` +
            `• Amount: ${order.amount}\n` +
            `• Execute at: ${format(order.executeAt, "PPpp")}\n`
        )
        .join("\n");

      const keyboard = Markup.inlineKeyboard([
        ...orders.map((order, index) => [
          Markup.button.callback(
            `🗑️ Cancel Order #${index + 1}`,
            `order_delete_${order._id}`
          ),
        ]),
        [
          Markup.button.callback("➕ Create Order", "set_timed_order"),
          Markup.button.callback("↩️ Back", "back_to_notifications"),
        ],
      ]);

      await this.bot.sendMessage(
        chatId,
        `*Active Orders* 📋\n\n${ordersList}`,
        {
          parse_mode: "Markdown",
          ...keyboard,
        }
      );
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /** Confirm order deletion */
  async confirmOrderDeletion(chatId, orderId, userInfo) {
    try {
      const order = await timedOrderService.getOrder(orderId);
      if (!order || order.userId !== userInfo.id.toString()) {
        throw new Error("Order not found");
      }

      await this.bot.sendMessage(
        chatId,
        `*Confirm Delete Order* ⚠️\n\n` +
          `Are you sure you want to delete this order?\n\n` +
          `Token: ${order.tokenSymbol}\n` +
          `Action: ${order.action}\n` +
          `Amount: ${order.amount}\n` +
          `Execute at: ${format(order.executeAt, "PPpp")}`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback(
              "✅ Confirm Delete",
              `order_delete_confirm_${orderId}`
            ),
            Markup.button.callback("❌ Cancel", "view_active_orders"),
          ],
        ])
      );
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /** Handle order deletion */
  async handleOrderDeletion(chatId, orderId, userInfo) {
    try {
      await timedOrderService.cancelOrder(userInfo.id, orderId);

      await this.bot.sendMessage(
        chatId,
        "✅ Order cancelled successfully!",
        Markup.inlineKeyboard([
          [
            Markup.button.callback("📋 View Orders", "view_active_orders"),
            Markup.button.callback("↩️ Back", "back_to_notifications"),
          ],
        ])
      );
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  /** Show order confirmation */
  async showOrderConfirmation(chatId, order) {
    await this.bot.sendMessage(
      chatId,
      `*Confirm Timed Order* ✅\n\n` +
        `Token: ${order.tokenSymbol}\n` +
        `Action: ${order.action}\n` +
        `Amount: ${order.amount}\n` +
        `Execute at: ${format(order.executeAt, "PPpp")}\n\n` +
        "Please confirm your order:",
      Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Confirm", "confirm_order"),
          Markup.button.callback("❌ Cancel", "back_to_timed_orders"),
        ],
      ])
    );
  }
}