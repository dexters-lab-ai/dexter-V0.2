import OpenAI from "openai";
import { config } from "../../core/config.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { aiMetricsService } from "../aiMetricsService.js";

/**
 * DeepSeekService
 *
 * Uses the OpenAI-compatible "openai" library with DeepSeek's API endpoint.
 * Exposes methods for chat completions and utilities.
 */
class DeepSeekService {
  constructor() {
    this.apiKey = config.deepseekApiKey; // Correctly sourced from config
    this.isConnected = false;
    this.conversationHistory = new Map();
    this.startTime = Date.now();

    // Initialize OpenAI client with DeepSeek's endpoint
    this.openai = new OpenAI({
      baseURL: "https://api.deepseek.com", // Correct DeepSeek API URL
      apiKey: this.apiKey,
    });
  }

  /**
   * Tests the connection with a minimal chat completion.
   * Sets this.isConnected = true on success.
   * @returns {Promise<boolean>}
   */
  async testConnection() {
    try {
      const completion = await this.openai.chat.completions.create({
        model: "deepseek-chat", // Confirm this with DeepSeek's latest docs
        messages: [{ role: "user", content: "test" }],
        max_tokens: 10,
      });

      if (completion?.choices?.length > 0) {
        this.isConnected = true;
        return true;
      }
      throw new Error("DeepSeek testConnection returned an empty response.");
    } catch (error) {
      this.isConnected = false;
      console.error("❌ Failed to connect to DeepSeek API:", error.message);
      await ErrorHandler.handle(error);
      return false;
    }
  }

  /**
   * Creates a chat completion with DeepSeek API.
   * @param {Object} options - Configuration for the completion
   * @returns {Promise<Object>} - Raw DeepSeek response
   */
  async createChatCompletion({
    messages,
    model = "deepseek-chat", // Default model
    max_tokens = 700,
    temperature = 1.0,
    top_p = 1,
    frequency_penalty = 0,
    presence_penalty = 0,
  }) {
    try {
      // Only test connection if not already confirmed
      if (!this.isConnected && !(await this.testConnection())) {
        throw new Error("DeepSeek API connection failed.");
      }

      const requestStart = Date.now();
      const completion = await this.openai.chat.completions.create({
        model,
        messages,
        max_tokens,
        temperature,
        top_p,
        frequency_penalty,
        presence_penalty,
      });

      if (!completion?.choices?.length) {
        throw new Error("Empty response from DeepSeek API.");
      }

      // Track metrics
      const duration = Date.now() - requestStart;
      aiMetricsService.trackModelUsage(
        model,
        completion.usage.total_tokens,
        this.calculateCost(model, completion.usage),
        duration
      );

      return completion;
    } catch (error) {
      console.error("❌ Error in createChatCompletion:", error.message);
      if (error.response?.status === 429) {
        aiMetricsService.metrics.openai.rateLimitHits++;
      }
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Calculates cost based on model and token usage.
   * Update these rates from DeepSeek's latest pricing.
   */
  calculateCost(model, usage) {
    const rates = {
      "deepseek-chat": 0.00014 / 1000, // Example: $0.14/M input tokens (check docs)
      "deepseek-coder": 0.00014 / 1000, // Adjust as needed
    };
    const rate = rates[model] || 0.00014 / 1000; // Default rate
    return rate * (usage.prompt_tokens + usage.completion_tokens);
  }

  /**
   * Generates a single string response from messages.
   * @param {Array} messages - Array of { role, content }
   * @returns {Promise<string>} - Assistant's response
   */
  async generateAIResponse(messages) {
    try {
      const formattedMessages = this.formatMessages(messages);
      const completion = await this.createChatCompletion({ messages: formattedMessages });
      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error("No content in DeepSeek response.");
      }
      return content;
    } catch (error) {
      console.error("❌ Error generating AI response:", error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Formats messages for DeepSeek API.
   * @param {Array} messages - Raw messages
   * @returns {Array} - Formatted messages
   */
  formatMessages(messages) {
    return messages.map((msg) => ({
      role: msg.role || "user",
      content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
    }));
  }

  /**
   * Updates conversation history for a user.
   * @param {string} userId - User identifier
   * @param {Array|string} messages - Input messages
   * @param {string} reply - AI response
   */
  updateConversationHistory(userId, messages, reply) {
    if (!userId) return;
    const history = this.conversationHistory.get(userId) || [];
    const updatedHistory = [...history];

    if (Array.isArray(messages)) {
      updatedHistory.push(...this.formatMessages(messages));
    } else if (typeof messages === "string") {
      updatedHistory.push({ role: "user", content: messages });
    }
    if (reply) {
      updatedHistory.push({ role: "assistant", content: String(reply) });
    }
    while (updatedHistory.length > 10) {
      updatedHistory.shift();
    }
    this.conversationHistory.set(userId, updatedHistory);
  }
}

export const deepSeekService = new DeepSeekService();