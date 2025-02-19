/****************************************************
 * TasksService.js
 ****************************************************/
import Task from "../../models/Task.js";
import { User } from "../../models/User.js";
import { autonomousProcessor } from "../ai/processors/UnifiedAutonomousEngine.js";
import { unifiedMessenger } from "../../core/UnifiedMessageHandler.js";
import { contextManager } from "../ai/ContextManager.js";
import { bot } from "../../core/bot.js";

// Global constant: Maximum number of active (PENDING) tasks per user.
const MAX_ACTIVE_TASKS = 3;

class TasksService {
  /**
   * Create a new task.
   * @param {Object} params - Contains telegramId, content, dueTime, recurrence (optional), and heading (optional).
   */
  async createTask({ telegramId, content, dueTime, recurrence = "none", heading }) {
    // Find the user first.
    const user = await User.findOne({ telegramId: telegramId.toString() }).exec();
    if (!user) throw new Error(`User with telegramId ${telegramId} not found.`);

    // Enforce maximum active tasks.
    const activeTasks = await Task.countDocuments({ telegramId, status: "PENDING" });
    if (activeTasks >= MAX_ACTIVE_TASKS) {
      throw new Error(`Maximum active tasks (${MAX_ACTIVE_TASKS}) reached for user ${telegramId}.`);
    }

    const task = await Task.create({
      user: user._id,
      telegramId,
      heading: heading || undefined,
      content,
      dueTime: new Date(dueTime),
      recurrence
    });
    return task;
  }

  /**
   * Retrieve tasks.
   * If taskId is provided, return that specific task; otherwise, return all tasks for the user.
   */
  async retrieveTasks({ telegramId, taskId }) {
    if (taskId) {
      return await Task.findOne({ telegramId, _id: taskId }).exec();
    }
    return await Task.find({ telegramId }).sort({ dueTime: 1 }).exec();
  }

  /**
   * Execute a task by calling the Unified Autonomous Engine.
   * On completion, update the task record and notify the user.
   */
  async executeTask({ telegramId, taskId }) {
    // Find the task record.
    const task = await Task.findOne({ telegramId, _id: taskId }).exec();
    if (!task) throw new Error(`Task with id ${taskId} not found for user ${telegramId}.`);

    // Prepare modified content for the AI model.
    const modifiedContent = `
[RUN THIS TASK NOW]
Instruction: ${task.content.trim()}
Please process the above instruction fully and return the complete result.
Retry on failure if needed.
[/RUN THIS TASK NOW]
    `;

    // Execute the task using the autonomous processor.
    let resultText;
    try {
      resultText = await autonomousProcessor.runTask(task.user, task.telegramId, modifiedContent);
    } catch (error) {
      resultText = `Error executing task: ${error.message}`;
    }
    
    // Ensure resultText is stored as a string.
    if (typeof resultText !== "string") {
      if (resultText && resultText.text) {
        resultText = resultText.text;
      } else {
        resultText = JSON.stringify(resultText);
      }
    }

    // Update the task record.
    // If recurrence is set (and not "none"), schedule the next execution.
    if (task.recurrence !== "none") {
      if (typeof task.recurrence === "number" && task.recurrence >= 5) {
        // Recurrence is given as an interval in minutes.
        const nextDue = new Date(task.dueTime.getTime() + task.recurrence * 60 * 1000);
        task.dueTime = nextDue;
        task.status = "PENDING";
      } else if (task.recurrence === "daily") {
        const nextDue = new Date(task.dueTime);
        nextDue.setDate(nextDue.getDate() + 1);
        task.dueTime = nextDue;
        task.status = "PENDING";
      } else {
        // If recurrence is provided but invalid, mark as completed.
        task.status = "COMPLETED";
      }
    } else {
      task.status = "COMPLETED";
    }
    task.result = resultText;
    task.executedAt = new Date();
    await task.save();

    // Build a nicely formatted card for task completion.
    const completionCard = `
╔════════════════════════════╗
║ 🔔 <b>Task Completed Ser</b> 🔔
║ <u>${task.heading}</u>
║ <b>Task:</b> ${task.content}
╚════════════════════════════╝
    `;

    // Notify the user about task completion using the card.
    try {
      await bot.sendMessage(telegramId, completionCard, { parse_mode: "HTML" });
    } catch (cardError) {
      console.error("Error sending completion card:", cardError.message);
    }

    // Send the full task result using sendMessageWithLimit from the unifiedMessenger instance.
    try {
      if (unifiedMessenger && typeof unifiedMessenger.sendMessageWithLimit === "function") {
        await unifiedMessenger.sendMessageWithLimit(telegramId, resultText, "HTML");
      } else {
        await bot.sendMessage(telegramId, resultText, { parse_mode: "HTML" });
      }
    } catch (fullMsgError) {
      console.error("Error sending full task result:", fullMsgError.message);
    }

    // Update the conversation context.
    const contextInput = { text: task.content };
    const sanitizedText = resultText;
    try {
      await contextManager.updateContext(task.user, contextInput, sanitizedText);
    } catch (contextError) {
      console.error("Error updating context:", contextError.message);
    }

    return task;
  }

  /**
   * Check due tasks and process them sequentially.
   * This function is designed to be called at regular intervals.
   */
  async processDueTasks(bot) {
    const now = new Date();
    // Retrieve due tasks that are pending, sorted by dueTime.
    const dueTasks = await Task.find({ dueTime: { $lte: now }, status: "PENDING" })
      .sort({ dueTime: 1 })
      .exec();

    // Process each task sequentially.
    for (const task of dueTasks) {
      const preview = task.content.substring(0, 100) + (task.content.length > 100 ? "..." : "");
      console.log(`⚡ Task Due Alert: Heading: ${task.heading}, Preview: ${preview}`);
      const alertMsg = `⏱ *Task Notification!*\n💭*Task:* ${task.heading}\n💭*Spec:* ${preview}\n\n🤖 taking over task...`;
      try {
        await bot.sendMessage(task.telegramId, alertMsg, { parse_mode: "Markdown" });
        await this.executeTask({ telegramId: task.telegramId, taskId: task._id });
        await bot.sendMessage(task.telegramId, `✅ Task ${task._id} executed successfully.`);
      } catch (err) {
        console.error(`Error executing task ${task._id}:`, err);
        await bot.sendMessage(task.telegramId, `⚠️ Task ${task._id} execution failed: ${err.message}`);
      }
    }
    return dueTasks.length;
  }

  /**
   * Delete a task.
   * @param {Object} params - Contains telegramId and taskId.
   * @returns {Promise<Object>} - The deleted task record.
   */
  async deleteTask({ telegramId, taskId }) {
    const task = await Task.findOneAndDelete({ telegramId, _id: taskId }).exec();
    if (!task) {
      throw new Error(`Task with id ${taskId} not found for user ${telegramId}.`);
    }
    return task;
  }
}

export default new TasksService();
