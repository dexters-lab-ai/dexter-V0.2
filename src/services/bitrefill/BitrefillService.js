import { Markup } from "telegraf";
import { config } from '../../core/config.js';

class BitrefillService {
  constructor(bot) {
    this.bot = bot;
    this.referralToken = config.bitrefillApiKey;
    this.paymentEvents = new Map(); // Store payment events (invoiceId => status)
    this.supportedPaymentMethods = ["usdc_solana", "bitcoin", "ethereum"];
    this.theme = "dark";
    this.language = "en";
  }

  /**
   * Generate the Bitrefill embed URL with required query parameters.
   */
  generateEmbedUrl({ email, refundAddress, showPaymentInfo = true }) {
    const queryParams = new URLSearchParams({
      ref: this.referralToken,
      paymentMethods: this.supportedPaymentMethods.join(","),
      theme: this.theme,
      hl: this.language,
      email: email || "",
      refundAddress: refundAddress || "",
      showPaymentInfo: showPaymentInfo.toString(),
    });

    return `https://embed.bitrefill.com/?${queryParams.toString()}`;
  }

  /**
   * Handle the shopping flow.
   */
  async handleShoppingFlow(chatId, email = null) {
    const embedUrl = this.generateEmbedUrl({ email });

    // Send a message with an inline keyboard link to Bitrefill
    await this.bot.sendMessage(
      chatId,
      "🛍️ *Shop for gift cards using crypto!*\n\nClick the button below to start shopping.",
      {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          Markup.button.url("Open Bitrefill", embedUrl),
        ]),
      }
    );
  }

  /**
   * Setup webhook for Bitrefill payment events.
   */
  setupWebhook(app, webhookPath = "/bitrefill-webhook") {
    app.post(webhookPath, (req, res) => {
      const { event, invoiceId, paymentUri } = req.body;

      if (event === "payment_intent") {
        console.log(`Payment started for Invoice: ${invoiceId}`);
        this.paymentEvents.set(invoiceId, { status: "pending", paymentUri });
      }

      res.status(200).send("OK");
    });
  }

  /**
   * Notify user about payment status.
   */
  async notifyPaymentStatus(chatId, invoiceId) {
    const paymentEvent = this.paymentEvents.get(invoiceId);

    if (!paymentEvent) {
      await this.bot.sendMessage(
        chatId,
        `❌ No payment information found for Invoice: ${invoiceId}`
      );
      return;
    }

    const message =
      paymentEvent.status === "paid"
        ? "🎉 Your payment was successful! Your gift card will be sent shortly."
        : `⚠️ Your payment is still pending. Please complete the transaction using the link below:`;

    const replyMarkup =
      paymentEvent.status !== "paid"
        ? Markup.inlineKeyboard([
            Markup.button.url("Complete Payment", paymentEvent.paymentUri),
          ])
        : null;

    await this.bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: replyMarkup,
    });
  }
}

export default BitrefillService;
