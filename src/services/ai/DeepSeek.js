import OpenAI from "openai";
import { config } from "../../core/config.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { aiMetricsService } from '../aiMetricsService.js';

/**
 * DeepSeekService
 *
 * Uses the OpenAI-compatible "openai" library but points to "https://api.deepseek.com"
 * with your DeepSeek API key.
 *
 * Exposes methods:
 *  - testConnection()
 *  - createChatCompletion()
 *  - generateAIResponse()
 *  - formatMessages()
 */
class DeepSeekService {
  constructor() {
    this.apiKey = config.deepseekApiKey; // e.g. "sk-1234..."
    this.isConnected = false;
    this.conversationHistory = new Map();
    this.startTime = Date.now();

    // Set up the "openai" client but override baseURL to DeepSeek
    // (The docs mention we can still use "https://api.deepseek.com/v1" or "https://api.deepseek.com")
    this.openai = new OpenAI({
      baseURL: "https://api.deepseek.com", // or 'https://api.deepseek.com/v1'
      apiKey: this.apiKey,
      // If needed, you can also specify "defaultHeaders", "organization", etc.
    });
  }

  /**
   * Tests the connection by creating a small chat completion.
   * If it succeeds, sets this.isConnected = true
   */
  async testConnection() {
    try {
      // Minimal example
      const completion = await this.openai.chat.completions.create({
        model: "deepseek-chat",
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
      throw error;
    }
  }

  /**
   * Create a chat completion using the DeepSeek "openai" style call
   * with additional parameters if you like (temperature, etc.)
   *
   * @param {Object} options
   *   @param {Array} options.messages - conversation array, e.g. [{role: "user", content: "..."}]
   *   @param {string} [options.model="deepseek-chat"] - which model to use
   *   @param {number} [options.max_tokens=700] - max tokens
   *   @param {number} [options.temperature=1.0]
   *   @param {number} [options.top_p=1]
   *   @param {number} [options.frequency_penalty=0]
   *   @param {number} [options.presence_penalty=0]
   * @returns {Promise<Object>} - The raw response from DeepSeek
   */
  async createChatCompletion({
    messages,
    model = "deepseek-chat",
    max_tokens = 700,
    temperature = 1.0,
    top_p = 1,
    frequency_penalty = 0,
    presence_penalty = 0,
  }) {
    try {
      if (!this.isConnected) {
        await this.testConnection();
      }
      const requestStart = Date.now();  // Capture start time per call
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
        throw new Error("Invalid or empty response from DeepSeek createChatCompletion.");
      }
  
      // Track metrics after successful call
      const duration = Date.now() - requestStart;  // Use per-call timing
      aiMetricsService.trackModelUsage(
        model,
        completion.usage.total_tokens,
        this.calculateCost(model, completion.usage.total_tokens),
        duration
      );
  
      return completion;
    } catch (error) {
      console.error("❌ Error in DeepSeek createChatCompletion:", error.message);
      aiMetricsService.metrics.openai.rateLimitHits++;
      await ErrorHandler.handle(error);
      throw error;
    }
  }  

  // Helper to calculate costs based on model and tokens
  calculateCost(model, tokens) {
    const costs = {
      'deepseek-chat': 0.0025,  // 8B model pricing
      'deepseek-chat-67b': 0.012  // 67B model pricing
    };
    return (costs[model] || 0.0025) * (tokens / 1000); // Default to 8B pricing
  }

  /**
   * Generates a single AI response (string) from the chat messages.
   * Example usage:
   *    const responseText = await deepSeekService.generateAIResponse([
   *      { role: "system", content: "You are an assistant." },
   *      { role: "user", content: "Hello, how are you?" }
   *    ]);
   *
   * @param {Array} messages - conversation array
   * @returns {Promise<string>} content from the first choice
   */
  async generateAIResponse(messages) {
    try {
      const formattedMessages = this.formatMessages(messages);
      // Just call createChatCompletion with default model
      const completion = await this.createChatCompletion({ messages: formattedMessages });

      // Return the "assistant" message text
      const firstChoice = completion.choices[0];
      if (!firstChoice?.message?.content) {
        throw new Error("No content in DeepSeek AI response.");
      }
      return firstChoice.message.content;
    } catch (error) {
      console.error("❌ Error generating AI response:", error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Utility: convert an array of { role, content } to the correct shape for DeepSeek/OpenAI.
   *   If "content" is an object, we'll JSON-stringify it. 
   */
  formatMessages(messages) {
    return messages.map((msg) => ({
      role: msg.role || "user",
      content:
        typeof msg.content === "string"
          ? msg.content
          : JSON.stringify(msg.content),
    }));
  }

  updateConversationHistory(userId, messages, reply) {
    if (!userId) return;
    const history = this.conversationHistory.get(userId) || [];
    const updatedHistory = [...history];
    if (Array.isArray(messages)) {
      updatedHistory.push(
        ...messages.map(msg => ({
          role: msg.role || 'user',
          content: typeof msg.content === 'string' ? msg.content : String(msg.content),
        }))
      );
    } else if (typeof messages === 'string') {
      updatedHistory.push({ role: 'user', content: messages });
    }
    if (reply) {
      updatedHistory.push({ role: 'assistant', content: typeof reply === 'string' ? reply : String(reply) });
    }
    while (updatedHistory.length > 10) {
      updatedHistory.shift();
    }
    this.conversationHistory.set(userId, updatedHistory);
  }
}

export const deepSeekService = new DeepSeekService();
