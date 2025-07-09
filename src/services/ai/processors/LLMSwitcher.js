import { User } from "../../../models/User.js";
import { ErrorHandler } from "../../../core/errors/index.js";

export class LLMSwitcher {
  /**
   * Gets the user's default LLM (OpenAI or DeepSeek)
   * @param {string} userId - Telegram user ID
   * @returns {Promise<string>} - "openai" or "deepseek"
   */
  static async getUserDefaultLLM(userId) {
    try {
      const user = await User.findByTelegramId(userId);
      return user?.settings?.defaultLLM || "openai"; // Default to OpenAI if not set
    } catch (error) {
      console.error("❌ Error getting user LLM preference:", error);
      await ErrorHandler.handle(error);
      return "openai"; // Default fallback
    }
  }

  /**
   * Updates the user's preferred LLM
   * @param {string} userId - Telegram user ID
   * @param {string} llm - "openai" or "deepseek"
   * @returns {Promise<boolean>} - Success status
   */
  static async updateUserLLM(userId, llm) {
    try {
        if (!["openai", "deepseek"].includes(llm)) {
            throw new Error(`Invalid LLM choice: ${llm}`);
        }

        const user = await User.findOne({ telegramId: userId.toString() });
        if (!user) throw new Error(`User not found: ${userId}`);

        // Update only the specific field without validating the entire schema
        await User.updateOne(
            { telegramId: userId.toString() },
            { $set: { "settings.defaultLLM": llm } },
            { runValidators: false } // ✅ Disables validation for missing fields
        );

        return true;
    } catch (error) {
        console.error("❌ Error updating user LLM preference:", error);
        await ErrorHandler.handle(error);
        return false;
    }
}

  /**
   * Toggle the default LLM for a user between OpenAI and DeepSeek.
   * @param {string} userId - The Telegram user ID.
   * @returns {Promise<Object>} - The new LLM selection.
   */
  static async toggleLLM(userId) {
    try {
      // Find user
      const user = await User.findOne({ telegramId: userId.toString() });

      if (!user) {
        throw new Error("User not found.");
      }

      // Determine new LLM (toggle)
      const currentLLM = user.settings.defaultLLM || "openai"; // Default OpenAI
      const newLLM = currentLLM === "openai" ? "deepseek" : "openai";

      // Update database
      await User.updateOne(
        { telegramId: userId.toString() },
        { $set: { "settings.defaultLLM": newLLM } }
      );

      return {
        success: true,
        message: `✅ Switched to ${newLLM === "openai" ? "OpenAI (GPT)" : "DeepSeek AI"}.`,
        newLLM
      };
    } catch (error) {
      console.error("❌ Error toggling LLM:", error);
      return {
        success: false,
        message: "❌ Failed to toggle AI model. Try again later."
      };
    }
  }
}
