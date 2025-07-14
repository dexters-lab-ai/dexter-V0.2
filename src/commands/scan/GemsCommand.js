import { Markup } from "telegraf";
import { Command } from "../base/Command.js";
import { User } from "../../models/User.js";
import { createCanvas, loadImage } from "canvas";
import { format } from "date-fns";
import { ErrorHandler } from "../../core/errors/index.js";
import path from "path";
import cookieFun from "../../services/cookieDAO/CookieFun.js";

export class GemsCommand extends Command {
  constructor(bot, eventHandler) {
    super(bot, eventHandler);
    this.bot = bot;
    this.command = "/gems";
    this.description = "View Gems Ruling the Narrative";
    this.pattern = /^(\/gems|💎 Gems Today)$/;

    this.eventHandler = eventHandler;
    this.registerCallbacks();
  }

  registerCallbacks() {
    this.eventHandler.on("view_gems", async (ctx) => this.showTodayGems(ctx));
    this.eventHandler.on("toggle_gems_notifications", async (ctx) =>
      this.toggleNotifications(ctx)
    );
    this.eventHandler.on("retry_gems", async (ctx) => this.retryGems(ctx));
  }

  async execute(ctx) {
    const chatId = ctx.chat.id;
    try {
      await this.showGemsMenu(chatId, ctx.from);
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async showGemsMenu(chatId, userInfo) {
    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();
      const notificationsEnabled = user?.settings?.notifications?.gemsToday || false;

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback("💎 View Today's Gems", "view_gems")],
        [
          Markup.button.callback(
            `${notificationsEnabled ? "🔕 Disable" : "🔔 Enable"} Notifications`,
            "toggle_gems_notifications"
          ),
        ],
        [Markup.button.callback("↩️ Back to Scan", "back_to_scan")],
      ]);

      await this.bot.sendMessage(
        chatId,
        "*Gems Today from Cookie.fun* 💎\n\n" +
          "Discover in-season gems with high social metrics and mindshare:\n\n" +
          "• Hourly scans across all chains\n" +
          "• Social media analysis\n" +
          "• Interest rating system\n" +
          `• Notifications: ${notificationsEnabled ? "✅" : "❌"}\n\n` +
          "_Note: This is an experimental feature based on social metrics._",
        {
          parse_mode: "Markdown",
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async showTodayGems(ctx) {
    const chatId = ctx.chat.id;
    const loadingMsg = await this.showLoadingMessage(chatId, "💎 Generating Cookie.fun Gems report...");
    try {
      const paged = await cookieFun.getAgentsPaged('_7Days', 1, 25);
      if (!paged || !paged.ok || !paged.ok.data || paged.ok.data.length === 0) {
        await this.bot.deleteMessage(chatId, loadingMsg.message_id);
        await this.bot.sendMessage(chatId, "No gems found for today yet. Check back later!", {
          reply_markup: {
            inline_keyboard: [
              [{ text: "↩️ Back", callback_data: "retry_gems" }]
            ]
          }
        });
        return;
      }
      const canvas = await this.generateGemsCanvas(paged.ok.data.slice(0, 10));
      await this.bot.deleteMessage(chatId, loadingMsg.message_id);
      await this.bot.sendPhoto(chatId, { source: canvas.toBuffer() }, {
        caption:
          "💎*Today's Top Gems by Mindshare - Cookie.fun*\n\n" +
          `Last Updated: ${format(new Date(), "HH:mm")}\n\n` +
          "_Ratings based on social metrics & mindshare._",
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "🔄 Refresh", callback_data: "view_gems" },
              { text: "↩️ Back", callback_data: "retry_gems" }
            ]
          ]
        }
      });
    } catch (error) {
      if (loadingMsg) {
        try {
          await this.bot.deleteMessage(chatId, loadingMsg.message_id);
        } catch (e) {}
      }
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }

  async showLoadingMessage(chatId, message) {
    return this.bot.sendMessage(chatId, message);
  }

  async generateGemsCanvas(tokens) {
    const canvas = createCanvas(800, 1200);
    const ctx = canvas.getContext("2d");

    // Draw Background
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, "#0d1117");
    gradient.addColorStop(1, "#1c1f26");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Logo and Title
    await this.drawLogoAndTitle(ctx);

    // Draw Token Information
    let y = 250;
    for (const token of tokens) {
      this.drawTokenContainer(ctx, 50, y, 700, 100);
      this.drawTokenDetails(ctx, token, 70, y + 30);
      y += 130;
    }

    // Add Footer with Timestamp and Branding
    await this.drawFooter(ctx);

    return canvas;
  }

  async drawLogoAndTitle(ctx) {
    const logoPath = path.resolve(__dirname, "../../../assets/images/logo.png");
    const logo = await loadImage(logoPath);

    ctx.save();
    ctx.drawImage(logo, 350, 50, 100, 100);
    ctx.restore();

    ctx.font = "bold 36px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.fillText("Today's Top Gems/ Hot Picks 💎", 400, 200);
  }

  async drawFooter(ctx) {
    const timestamp = format(new Date(), "PPpp");

    const cookieLogoPath = path.resolve(__dirname, "../../../assets/images/logoFun.png");
    const cookieLogo = await loadImage(cookieLogoPath);

    // Draw Cookie.fun logo small at the bottom left
    ctx.drawImage(cookieLogo, 50, 1140, 50, 50);

    // Add "Powered by Cookie.fun" text
    ctx.font = "italic 16px Arial";
    ctx.fillStyle = "#cccccc";
    ctx.fillText("Powered by Cookie.fun", 110, 1170);

    // Add Timestamp
    ctx.font = "italic 14px Arial";
    ctx.fillStyle = "#58a6ff";
    ctx.textAlign = "center";
    ctx.fillText(`KATZ! [O.P.E.R.A.T.O.R-TG] Report generated on: ${timestamp}`, 400, 1180);
  }

  drawTokenContainer(ctx, x, y, width, height) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.roundRect(x, y, width, height, 15);
    ctx.fill();
    ctx.stroke();
  }

  drawTokenDetails(ctx, token, x, y) {
    ctx.font = "bold 20px Arial";
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "left";
    ctx.fillText(token.agentName, x, y);

    ctx.font = "16px Arial";
    ctx.fillStyle = "#ccc";
    ctx.fillText(`Mindshare: ${token.mindshare}`, x, y + 25);

    ctx.font = "bold 16px Arial";
    ctx.fillStyle = "#ff7b72";
    ctx.textAlign = "right";
    ctx.fillText(`Market Cap: $${token.marketCap}`, x + 650, y + 10);
  }

  async toggleNotifications(ctx) {
    const chatId = ctx.chat.id;
    const userInfo = ctx.from;

    try {
      const user = await User.findOne({ telegramId: userInfo.id.toString() }).lean();
      const newState = !user?.settings?.notifications?.gemsToday;

      await User.updateOne(
        { telegramId: userInfo.id.toString() },
        { $set: { "settings.notifications.gemsToday": newState } }
      );

      await this.bot.sendMessage(chatId, `✅ Gems notifications ${newState ? "enabled" : "disabled"} successfully!`, {
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback("↩️ Back", "retry_gems")]]),
      });
    } catch (error) {
      await ErrorHandler.handle(error, this.bot, chatId);
    }
  }
}
