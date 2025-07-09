export class MenuHandler {
  /**
   * @param {object} bot - A node-telegram-bot-api instance.
   */
  constructor(bot) {
    this.bot = bot;
  }

  /**
   * Display the main menu with a custom keyboard.
   * @param {object} msg - A plain message object with at least a chat property.
   */
  async showMainMenu(msg) {
    const chatId = msg.chat.id;
    const keyboard = {
      keyboard: [
        ["🎭 Analysis", "💰 Sentiment"],
        ["📊 Swaps", "🔥 Trending"],
        ["🔍 Scan Token", "⚠️ Bridge"],
        ["💊 Pump.fun", "👛 Wallets"],
        ["⚙️ Settings", "❓ Help"],
      ],
      resize_keyboard: true,
    };

    await this.bot.sendMessage(chatId, "Select an option:", {
      reply_markup: keyboard,
    });
  }

  /**
   * Display the welcome message.
   * @param {object} msg - A plain message object with at least a chat property.
   * @param {string} username - User's Telegram username.
   * @param {boolean} isNewUser - Whether the user is new or returning.
   */
  async showWelcomeMessage(chatId, username, isNewUser) {
    const message = isNewUser
      ? `*Clueless where to start? Ask the Agent what features it has\n\n` +
        `*${username.toUpperCase()}*, ready for the trenches? 🌳🌍🕳️\n\n` +
        `_This is what J.A.R.V.I.S would look like, the real operator.._ 🤖💎\n\n` +
        `Use voicenotes to operate in lazy mode.`
      : `*Welcome Back ${username.toUpperCase()}!* 🐈‍⬛\n\n` +
        `Ready for the trenches? 🌳🕳️\n\n` +
        `_Let's find gems..._ 💎\n\n` +
        `Need help? Ask KATZ anything, use voicenotes to operate in lazy mode.`;

    const keyboard = {
      inline_keyboard: [
        [{ text: "🚀 Let's Go!", callback_data: "start_menu" }],
      ],
    };

    await this.bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      reply_markup: keyboard,
    });
  }
}
