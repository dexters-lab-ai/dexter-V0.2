// ResearchService.js
import { v4 as uuidv4 } from "uuid";
import { User } from "../../models/User.js";

export default class ResearchService {
  /**
   * Saves research content for a user.
   * If keywords are not provided, they are auto‑generated from the content.
   */
  async saveResearch({ telegramId, content, keywords, notes }) {
    // Auto-generate keywords if none provided (naively picking up to 5 unique words)
    if (!keywords || keywords.length === 0) {
      const words = content
        .split(" ")
        .map(word => word.toLowerCase().replace(/[^a-z]/g, ""))
        .filter(word => word.length > 3);
      keywords = Array.from(new Set(words)).slice(0, 5);
    }
    const researchRecord = {
      researchId: uuidv4(),
      content,
      keywords,
      notes
    };
    const user = await User.findOne({ telegramId });
    if (!user) {
      throw new Error(`User with telegramId ${telegramId} not found.`);
    }
    await user.addResearchRecord(researchRecord);
    return researchRecord;
  }

  /**
   * Retrieves research records for a user.
   * If researchId is provided, returns that record.
   * If keyword is provided, returns all records containing that keyword.
   * Otherwise, returns all research records.
   */
  async retrieveResearch({ telegramId, researchId, keyword }) {
    const user = await User.findOne({ telegramId });
    if (!user) {
      throw new Error(`User with telegramId ${telegramId} not found.`);
    }
    if (researchId) {
      return user.getResearchRecordById(researchId);
    }
    if (keyword) {
      return user.getResearchRecordsByKeyword(keyword);
    }
    return user.researches;
  }

  /**
   * Deletes a research record by its researchId.
   */
  async deleteResearch({ telegramId, researchId }) {
    const user = await User.findOne({ telegramId });
    if (!user) {
      throw new Error(`User with telegramId ${telegramId} not found.`);
    }
    const record = user.getResearchRecordById(researchId);
    if (!record) {
      throw new Error(`Research record with id ${researchId} not found.`);
    }
    await user.deleteResearchRecordById(researchId);
    return { success: true, message: `Research record ${researchId} deleted.` };
  }
}
