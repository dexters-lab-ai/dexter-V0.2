import { bot } from "./bot.js";
import { EventEmitter } from "events";
import { ErrorHandler } from "./errors/index.js";
import { rateLimiter } from "./rate-limiting/RateLimiter.js";
import { circuitBreakers } from "./circuit-breaker/index.js";
import { autonomousProcessor } from "../services/ai/processors/UnifiedAutonomousEngine.js";
import { contextManager } from "../services/ai/ContextManager.js";
import { VoiceService } from "../services/audio/voiceService.js"; // Provides both STT & TTS
import { setupCommands } from "../commands/index.js";
import { aiMetricsService } from '../services/aiMetricsService.js';

// Command registry
console.log('📜 Setting up command registry...');
const commandRegistry = await setupCommands(bot);

export class UnifiedMessageHandler extends EventEmitter {
  constructor(bot, commandRegistry) {
    super();
    this.bot = bot;
    this.commandRegistry = commandRegistry;
    this.initialized = false;
    this.processedCallbacks = new Set();
    this.contextManager = contextManager;
    this.voiceService = new VoiceService(bot);

    // Track temporary message IDs (e.g. for animations and "taking long" notifications)
    this.currentAnimationMsgId = null;
    this.tooLongMsgId = null;
    
    // Timer references for typing indicators and long-response notifications
    this.typingInterval = null;
    this.tooLongTimer = null;
    this.startTime = Date.now();
  }

  async initialize() {
    if (this.initialized) return;
    try {
      // Listen for incoming messages
      this.bot.on("message", async (msg) => {
        await circuitBreakers.executeWithBreaker("messages", async () => {
          const isLimited = await rateLimiter.isRateLimited(msg.from.id, "message");
          if (isLimited) {
            await this.bot.sendMessage(msg.chat.id, "⚠️ Please slow down! Try again in a minute.");
            return;
          }
          await this.handleMessage(msg);
        });
      });

      // Listen for callback queries (inline keyboard actions)
      this.bot.on("callback_query", async (query) => {
        const callbackId = `${query.from.id}:${query.data}:${Date.now()}`;
        if (this.processedCallbacks.has(callbackId)) return;
        this.processedCallbacks.add(callbackId);
        await this.handleCallback(query);
        setTimeout(() => this.processedCallbacks.delete(callbackId), 5000);
      });

      this.initialized = true;
      console.log("✅ UnifiedMessageHandler initialized");
    } catch (error) {
      console.error("❌ Error during UnifiedMessageHandler initialization:", error);
      throw error;
    }
  }

  /**
   * Handle incoming messages (text, photo, voice, etc.).
   */
  async handleMessage(msg) {
    let processedText = "";
    let isVoiceInput = false;
    let fileUrl = "";
    let isImageInput = false;

    try {
      const chatId = msg.chat.id;

      // 🖼️ **Handle Image Input**
      if (msg.photo) {
        const fileId = msg.photo[msg.photo.length - 1].file_id; // highest resolution
        fileUrl = await this.bot.getFileLink(fileId);
        processedText = msg.caption ? msg.caption.trim() : "";
        isImageInput = true;
        console.log("🖼️ Received image:", fileUrl, "Caption:", processedText);
      }

      // 🎙️ **Handle Voice Input**
      if (msg.voice) {
        const fileId = msg.voice.file_id;
        fileUrl = await this.bot.getFileLink(fileId);
        try {
          processedText = await this.voiceService.transcribeVoiceWhisp(fileUrl);
          console.log("🎙️ Transcribed voice input:", processedText);
          isVoiceInput = true;
        } catch (error) {
          console.error("❌ Voice transcription failed:", error.message);
          await this.bot.sendMessage(chatId, "⚠️ Sorry, I couldn't understand the voice message. Wanna try again?");
          return; // stop processing on transcription error
        }
      }

      // 📝 **Handle Text Input** (if no voice/image)
      if (msg.text && !isVoiceInput && !isImageInput) {
        processedText = msg.text.trim();
      }

      // If no text or image to process, do nothing
      if (!processedText && !isImageInput) return;

      console.log("📄 Processed Text:", processedText);

      // 🔍 **Check for Commands**
      const command = this.commandRegistry.findCommand(processedText);
      if (command) {
        await command.execute(msg);
        return;
      }

      // 🚀 **Send Processing Indicator**
      await this.sendProcessingAtBottom(chatId, "🧞‍♂️ Summoning your request...");
      this.startTypingIndicators(chatId);

      // 🧠 **Process Message** (AI/Autonomous)
      let result;
      try {
        result = await autonomousProcessor.processMessage(msg, processedText, msg.from.id, fileUrl);
      } catch (error) {
        console.error("❌ Error in autonomousProcessor:", error);
      }

      this.clearTypingIndicators(chatId);

      // 🏁 **Handle AI Response**
      if (result && result.imageUrl) {
        // If there's an image
        console.log("📤 Sending image response:", result.imageUrl);
        await this.bot.sendPhoto(chatId, result.imageUrl, {
          caption: "🖼️ Here is your generated image",
        });
      } else {
        // Fallback to text
        let finalText = result?.text?.trim() ? result.text : "🧞‍♂️ I didn't get that, come again?";
        const sanitizedText = this.cleanTextForInternal(finalText);

        // 🗂️ **Update Context**
        let contextInput;
        if (msg.voice) {
          contextInput = { text: processedText };
        } else if (isImageInput) {
          contextInput = { text: processedText, fileUrl };
        } else {
          contextInput = msg;
        }
        await this.contextManager.updateContext(msg.from.id, contextInput, sanitizedText);

        // 📩 **Send Text Response**
        await this.sendMessageWithLimit(chatId, this.cleanTextForTelegram(finalText), "HTML");

        const synthesizeAndSendAudio = async (chatId, textToSpeak) => {
          // 1. Start the "record_audio" chat action at intervals
          const actionInterval = setInterval(() => {
            this.bot.sendChatAction(chatId, "record_audio").catch(() => {});
          }, 4000);

          try {
            // 2. Get the buffer from TTS
            const audioBuffer = await this.voiceService.synthesizeGoogle(textToSpeak);
            if (audioBuffer) {
              // 3. Send the buffer with separate Telegram options vs file options
              await this.bot.sendAudio(
                chatId,
                audioBuffer, // the raw Buffer is the second argument
                {
                  caption: "🎙️ <b>hear me out...</b>",
                  parse_mode: "HTML"
                  // ^ Telegram's API options (the "options" object)
                },
                {
                  filename: "KATZ!.mp3",
                  contentType: "audio/mpeg"
                  // ^ "fileOptions" object for metadata
                }
              );
            }
          } catch (err) {
            console.error("❌ TTS Error:", err.message);
          } finally {
            clearInterval(actionInterval);
          }
        };

        // Heuristics: If user spoke or random chance -> TTS
        if (
          isVoiceInput ||
          (!isImageInput && sanitizedText.length > 5 && Math.random() < 0.5)
        ) {
          const ttsText = this.cleanTextForSynthesis(sanitizedText);
          await synthesizeAndSendAudio(chatId, ttsText);
        }
      }
      // Track metrics
      const duration = Date.now() - this.startTime;
      aiMetricsService.trackMessageMetrics(
        isVoiceInput ? 'audio' : 'text',
        duration
      );
    } catch (error) {
      console.error("❌ Error in handleMessage:", {
        message: error.message,
        stack: error.stack,
        msg,
        userId: msg.from.id,
      });
      await this.sendMessageWithLimit(msg.chat.id, `❌ <b>An error occurred:</b> ${error.message}`, "HTML");
    }
  }

  /**
   * Start showing "typing..." or "taking too long" indicators.
   */
  startTypingIndicators(chatId) {
    // Send "typing" every 4s
    this.typingInterval = setInterval(() => {
      this.bot.sendChatAction(chatId, "typing").catch(() => {});
    }, 4000);

    // After 10s, show a "this is taking longer" message
    this.tooLongTimer = setTimeout(async () => {
      try {
        const msgLong = await this.bot.sendMessage(chatId, "🧞‍♂️ this is taking longer than usual...");
        this.tooLongMsgId = msgLong.message_id;
        await this.sendProcessingAtBottom(chatId, "🧞‍♂️ (yikes) thanks for your patience...");
      } catch (e) {
        console.warn("Error sending 'too long' message:", e.message);
      }
    }, 10000);
  }

  /**
   * Stop and clear "typing..." and "too long" indicators.
   */
  async clearTypingIndicators(chatId) {
    if (this.typingInterval) {
      clearInterval(this.typingInterval);
      this.typingInterval = null;
    }
    if (this.tooLongTimer) {
      clearTimeout(this.tooLongTimer);
      this.tooLongTimer = null;
    }

    await this.deleteMessageIfExists(chatId, this.currentAnimationMsgId);
    this.currentAnimationMsgId = null;

    await this.deleteMessageIfExists(chatId, this.tooLongMsgId);
    this.tooLongMsgId = null;
  }

  /**
   * Safe deletion of messages that might not exist anymore.
   */
  async deleteMessageIfExists(chatId, messageId) {
    if (!messageId) return;
    try {
      await this.bot.deleteMessage(chatId, messageId);
    } catch (err) {
      console.warn("Could not delete message:", err.message);
    }
  }

  /**
   * Sends an animation/sticker at the bottom of the chat to show "processing".
   */
  async sendProcessingAtBottom(chatId, captionText) {
    await this.deleteMessageIfExists(chatId, this.currentAnimationMsgId);
    this.currentAnimationMsgId = null;

    const randomAnimations = [
      "CAACAgIAAxkBAAIpZWeWMwABJmPIQ3AmSdQ4WOkL_K0OgAACZAIAAsoDBgsBgU7S7-nk3TYE",
      "CAACAgIAAxkBAAIpZmeWMzcTMjQmBs0FtAjPJvHSQ0doAAI4AwACtXHaBsLy3lrP6g0VNgQ",
      "CAACAgIAAxkBAAIpc2eWfcRPbLoFWD0eIlcxlnU-n_TlAALUEQADwKBJeScB4o8r9Aw2BA",
      "CAACAgIAAxkBAAIpdGeWfhNo-JPjFD7YcQFWlVZ6D1ojAAJiFQACIqPBSfvS-zntbkh-NgQ",
      "CAACAgIAAxkBAAIpdWeWfiwbmEwdAuoS4TKMlrvkz6EkAAKEAANEDc8XWsrYRJs5QO42BA",
      "CAACAgIAAxkBAAIpdmeWflpXi57EicNEhDfGPIbXImlOAAJpGwACw5RZSkeuZ_mZmncSNgQ",
      "CAACAgIAAxkBAAIpd2eWfnGlcgVCmKea-0YQarloWLjcAAJwAAPb234AAeoAAbe3Jpg43TYE",
      "CAACAgIAAxkBAAIpeWeWf6Zx-yts9XVzs0BlPuD0ncctAAIUEAACRd7YS4GzdytDqYx1NgQ"
    ];

    const randomIndex = Math.floor(Math.random() * randomAnimations.length);
    const chosenAnimation = randomAnimations[randomIndex];

    try {
      const animMsg = await this.bot.sendAnimation(chatId, chosenAnimation, {
        caption: captionText,
        parse_mode: "HTML",
        // If you want to pass a file name for a local file or buffer, you'd do:
        // animation: { source: <Buffer>, filename: 'somefile.gif' }, ...
      });
      this.currentAnimationMsgId = animMsg.message_id;
      return animMsg;
    } catch (err) {
      console.warn("Failed to send animation, fallback text:", err.message);
      const fallback = await this.bot.sendMessage(chatId, captionText);
      this.currentAnimationMsgId = fallback.message_id;
      return fallback;
    }
  }

  /**
   * Prepares raw text for TTS synthesis by removing HTML tags and unescaping common entities.
   * This ensures the synthesized voice note is clean.
   *
   * @param {string} input - The text to prepare.
   * @returns {string} Clean text for TTS.
   */
  prepareTextForTTS(input) {
    if (!input || typeof input !== "string") return "";
    let text = input.replace(/<\/?[^>]+(>|$)/g, ""); // Remove HTML tags.
    text = text.replace(/&nbsp;/g, " ")
               .replace(/&amp;/g, "&")
               .replace(/&lt;/g, "<")
               .replace(/&gt;/g, ">")
               .replace(/&quot;/g, "\"")
               .replace(/&#39;/g, "'");
    return text.trim();
  }

  /**
   * Cleans text for internal use (e.g., context updates, AI processing).
   * This removes unnecessary characters but preserves the structure.
   * 
   * @param {string} input - The text to clean.
   * @returns {string} Cleaned text.
   */
  cleanTextForInternal(input) {
    if (!input || typeof input !== "string") return "";
    return input
      .replace(/[!#*_~`]/g, "")  // Remove Markdown characters
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s]+)\)/g, " $2") // Remove inline links
      .replace(/\[.*?\]/g, "") // Remove brackets
      .replace(/\.{3,}/g, "..") // Replace excessive dots
      .replace(/\b(https?:\/\/[^\s]+)\b/g, "\n🔗 $1") // Make links clearer
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .trim();
  }

  // For Telegram output (HTML-safe)
  cleanTextForTelegram(input) {
    if (!input || typeof input !== "string") return "";
    
    // First, perform the basic cleaning (but do not escape HTML yet)
    let cleaned = input
      .replace(/[!#*_~]/g, "")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s]+)\)/g, " $2")
      .replace(/\[.*?\]/g, "")
      .replace(/\.{3,}/g, "..")
      .replace(/\b(https?:\/\/[^\s]+)\b/g, "\n🔗 $1")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .trim();

    // Then, escape HTML special characters
    cleaned = cleaned
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    // Optionally, if you wish to allow <strong> tags, unescape those:
    // (Be cautious: this assumes the source <strong> tags are balanced and correct)
    cleaned = cleaned.replace(/&lt;(\/?strong)&gt;/g, "<$1>");

    return cleaned;
  }

  /**
   * Cleans text for TTS synthesis.
   * 
   * Steps:
   * 1. Remove HTML tags.
   * 2. Decode common HTML entities.
   * 3. Remove Markdown link syntax (keeping URL if desired).
   * 4. Remove emojis.
   * 5. Remove extraneous formatting symbols.
   * 6. Normalize repeated punctuation (dots, dashes, exclamation/question marks).
   * 7. Remove bullet prefixes at the beginning of lines.
   * 8. Remove wallet/token addresses (EVM & Solana).
   * 9. Replace curly quotes with straight quotes.
   * 10. Capitalize the first letter of each sentence.
   * 11. Collapse multiple spaces and trim.
   *
   * @param {string} input - The text to prepare for speech.
   * @returns {string} Cleaned text for TTS.
   */
  cleanTextForSynthesis(input) {
    if (!input || typeof input !== "string") return "";

    let text = input;

    // 1. Remove HTML tags.
    text = text.replace(/<\/?[^>]+(>|$)/g, "");

    // 2. Decode HTML entities.
    text = text
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'");

    // 3. Remove Markdown links: Replace [text](url) with just the URL.
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, " $2 ")
              .replace(/\[[^\]]*\]/g, "");
    
              // Remove embedded clickable links and standalone URLs
    text = text.replace(/<a href=['"]?(https?:\/\/[^\s'"]+)['"]?>link here<\/a>/g, "")
      .replace(/\bhttps?:\/\/[^\s]+/g, "")

    // 4. Remove emojis (covers many common ranges).
    text = text.replace(/[\u{1F300}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, "");

    // 5. Remove extraneous formatting symbols.
    text = text.replace(/[!#*_~`]/g, "");

    // 6. Normalize repeated punctuation.
    text = text.replace(/\.{3,}/g, "..")
              .replace(/-{2,}/g, "-")
              .replace(/!{2,}/g, "!")
              .replace(/\?{2,}/g, "?");

    // 7. Remove bullet prefixes at the start of lines.
    text = text.replace(/^[\-\*\•]\s*/gm, "");

    // 8. Remove wallet/token addresses.
    // EVM: 0x followed by 40 hex characters.
    text = text.replace(/\b0x[a-fA-F0-9]{40}\b/g, "");
    // Solana: Base58 addresses (32 to 44 characters).
    text = text.replace(/\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g, "");

    // 9. Replace curly quotes with straight ones.
    text = text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

    // 10. Capitalize the first letter of each sentence.
    // Split on sentence-ending punctuation while preserving it.
    text = text
      .split(/([.!?]\s*)/)
      .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join("");

    // 11. Collapse multiple spaces and trim.
    return text.replace(/\s{2,}/g, " ").trim();
  }

  /**
   * Sends a message to a chat while splitting it into chunks if it exceeds Telegram's character limit.
   * Additionally, if options.sendVoice is true and the input was plain text,
   * a voice note will be synthesized and sent.
   *
   * @param {number|string} chatId
   * @param {string} message
   * @param {string} [parseMode="HTML"]
   * @param {Object} [options] - Options; e.g., { sendVoice: true }
   */
  async sendMessageWithLimit(chatId, message, parseMode = "HTML", options = {}) {
    if (!this.bot || typeof this.bot.sendMessage !== "function") {
      console.warn("sendMessageWithLimit: Bot sendMessage function not available. Skipping message sending.");
      return;
    }
  
    const MAX_LENGTH = 4096;
    let safeMessage = message?.trim() || "⚠️";
    console.log("📝 Original Message Length:", safeMessage.length);
    console.log("📩 Full Message Before Sending:", safeMessage);
  
    const sendWithRetries = async (msgToSend) => {
      const maxRetries = 3;
      const delayMs = 250;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          return await this.bot.sendMessage(chatId, msgToSend, { parse_mode: parseMode });
        } catch (error) {
          console.error(`❌ Telegram Error on attempt ${attempt} for message chunk:`, error.message);
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          } else {
            console.error("🚨 Giving up on this message chunk after maximum retries.");
            return null;
          }
        }
      }
    };
  
    try {
      if (safeMessage.length > MAX_LENGTH) {
        const chunks = safeMessage.match(/.{1,4096}/g) || [];
        console.log(`🔄 Splitting Message into ${chunks.length} chunks...`);
        for (let i = 0; i < chunks.length; i++) {
          let chunk = chunks[i]?.trim();
          if (!chunk) continue;
          console.log(`📦 Chunk ${i + 1}/${chunks.length} Size: ${chunk.length}`);
          await sendWithRetries(chunk);
        }
      } else {
        console.log("📤 Sending Full Message...");
        await sendWithRetries(safeMessage);
      }
  
      // If options indicate voice should be sent (and input was plain text), synthesize and send a voice note.
      if (options.sendVoice) {
        const actionInterval = setInterval(() => {
          this.bot.sendChatAction(chatId, "record_audio").catch(() => {});
        }, 4000);
  
        try {
          const ttsText = this.prepareTextForTTS(safeMessage);
          const audioBuffer = await this.voiceService.synthesizeGoogle(ttsText);
          if (audioBuffer) {
            await this.bot.sendAudio(chatId, audioBuffer, {
              caption: "🎙️ *hear me out..*",
              filename: "voice_response.mp3",
              contentType: "audio/mpeg"
            });
          } else {
            console.log("No audio content received from TTS service.");
          }
        } catch (ttsErr) {
          console.error("TTS generation error:", ttsErr.message);
          await this.bot.sendMessage(chatId, "⚠️ Could not generate audio for response.");
        } finally {
          clearInterval(actionInterval);
        }
      }
  
    } catch (error) {
      console.error("❌ Critical Error in sendMessageWithLimit:", error.message);
      console.error("📌 Full Stack Trace:", error.stack);
      console.log("🛠️ Debugging: Last Attempted Message Was:", message);
      try {
        await sendWithRetries("⚠️ An error occurred while processing your request.");
      } catch (fallbackError) {
        console.error("🚨 Even the fallback message failed!", fallbackError.message);
      }
    }
  }
  
  cleanup() {
    this.bot.removeAllListeners();
    this.removeAllListeners();
    this.processedCallbacks.clear();
    this.contextManager.cleanup();
    this.initialized = false;
  }
  
  async handleCallback(query) {
    try {
      const handled = await this.commandRegistry.handleCallback(query);
      if (handled) {
        await this.bot.answerCallbackQuery(query.id);
      } else {
        console.warn("⚠️ Unhandled callback:", query.data);
        await this.bot.answerCallbackQuery(query.id, {
          text: "⚠️ Action not recognized.",
          show_alert: false,
        });
      }
    } catch (error) {
      await this.bot.answerCallbackQuery(query.id, {
        text: "❌ An error occurred",
        show_alert: false,
      });
      await ErrorHandler.handle(error, this.bot, query.message?.chat?.id);
    }
  }
  
  async fallbackResponse(msg, text) {
    try {
      await this.bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
    } catch (error) {
      console.error("Error sending fallback response:", error.message);
    }
  }
}

export const unifiedMessenger = new UnifiedMessageHandler(bot, commandRegistry);
