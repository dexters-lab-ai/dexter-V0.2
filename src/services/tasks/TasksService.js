import { EventEmitter } from 'events';
import Task from "../../models/Task.js";
import { User } from "../../models/User.js";
import { autonomousProcessor } from "../ai/processors/UnifiedAutonomousEngine.js";
import { unifiedMessenger } from "../../core/UnifiedMessageHandler.js";
import { contextManager } from "../ai/ContextManager.js";
import { bot } from "../../core/bot.js";
import { queueService } from '../queue/QueueService.js';

class TasksService extends EventEmitter {
  constructor() {
    super();
    if (TasksService.instance) {
      return TasksService.instance;
    }
    TasksService.instance = this;
    this.initialized = false;
    this.MAX_ACTIVE_TASKS = 3;
    this.taskQueue = null;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await queueService.initialize();
      this.taskQueue = queueService.getQueue('tasks');
      
      // Set up task processor
      this.taskQueue.process(async (job) => {
        const { telegramId, taskId } = job.data;
        await this.executeTask({ telegramId, taskId });
      });

      this.initialized = true;
      console.log('✅ TasksService initialized');
    } catch (error) {
      console.error('❌ Error initializing TasksService:', error);
      throw error;
    }
  }

  async createTask({ telegramId, content, dueTime, recurrence = "none", heading }) {
    if (!this.initialized) await this.initialize();

    const user = await User.findOne({ telegramId: telegramId.toString() }).exec();
    if (!user) throw new Error(`User with telegramId ${telegramId} not found.`);

    const activeTasks = await Task.countDocuments({ telegramId, status: "PENDING" });
    if (activeTasks >= this.MAX_ACTIVE_TASKS) {
      throw new Error(`Maximum active tasks (${this.MAX_ACTIVE_TASKS}) reached for user ${telegramId}.`);
    }

    const task = await Task.create({
      user: user._id,
      telegramId,
      heading: heading || undefined,
      content,
      dueTime: new Date(dueTime),
      recurrence
    });

    // Schedule the task
    await this.scheduleTask(task);
    
    this.emit('taskCreated', { taskId: task._id, telegramId });
    return task;
  }

  async scheduleTask(task) {
    const now = new Date();
    const delay = Math.max(0, task.dueTime.getTime() - now.getTime());

    if (task.recurrence === "none") {
      // One-time task
      await queueService.addJob('tasks', {
        telegramId: task.telegramId,
        taskId: task._id
      }, {
        delay,
        jobId: `task_${task._id}`
      });
    } else if (task.recurrence === "daily") {
      // Daily recurring task
      await queueService.addRecurringJob('tasks', {
        telegramId: task.telegramId,
        taskId: task._id
      }, '0 0 * * *', { // Runs at midnight every day
        jobId: `task_${task._id}_daily`
      });
    } else if (typeof task.recurrence === "number") {
      // Custom interval in minutes
      await queueService.addRecurringJob('tasks', {
        telegramId: task.telegramId,
        taskId: task._id
      }, `*/${task.recurrence} * * * *`, {
        jobId: `task_${task._id}_interval`
      });
    }
  }

  async retrieveTasks({ telegramId, taskId }) {
    if (!this.initialized) await this.initialize();

    if (taskId) {
      return await Task.findOne({ telegramId, _id: taskId }).exec();
    }
    return await Task.find({ telegramId }).sort({ dueTime: 1 }).exec();
  }

  // 1) Truncate heading to 50 chars
  truncateText(text = '', maxLength = 50) {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }

  async executeTask({ telegramId, taskId }) {
    if (!this.initialized) await this.initialize();

    const task = await Task.findOne({ telegramId, _id: taskId }).exec();
    if (!task) throw new Error(`Task with id ${taskId} not found for user ${telegramId}.`);

    const modifiedContent = `
[RUN THIS TASK NOW]
Instruction: ${task.content.trim()}
Please process the above instruction fully and return the complete result.
Retry on failure if needed.
[/RUN THIS TASK NOW]
    `;

    let resultText;
    try {
      resultText = await autonomousProcessor.runTask(task.user, task.telegramId, modifiedContent);
    } catch (error) {
      resultText = `Error executing task: ${error.message}`;
    }
    
    if (typeof resultText !== "string") {
      if (resultText && resultText.text) {
        resultText = resultText.text;
      } else {
        resultText = JSON.stringify(resultText);
      }
    }

    // Handle recurring tasks
    if (task.recurrence !== "none") {
      if (typeof task.recurrence === "number" && task.recurrence >= 5) {
        const nextDue = new Date(task.dueTime.getTime() + task.recurrence * 60 * 1000);
        task.dueTime = nextDue;
        task.status = "PENDING";
        await this.scheduleTask(task); // Schedule next execution
      } else if (task.recurrence === "daily") {
        const nextDue = new Date(task.dueTime);
        nextDue.setDate(nextDue.getDate() + 1);
        task.dueTime = nextDue;
        task.status = "PENDING";
        await this.scheduleTask(task); // Schedule next execution
      } else {
        task.status = "COMPLETED";
      }
    } else {
      task.status = "COMPLETED";
    }
    
    task.result = resultText;
    task.executedAt = new Date();
    await task.save();

    const truncatedHeading = this.truncateText(task.heading ?? '', 50);
    const truncatedContent = this.truncateText(task.content ?? '', 50);

    // 2) Build a simpler, more mobile-friendly message
    // Use “smart quotes” around heading and italic for content
    const completionCard = `
    <b>        TASK COMPLETED</b>  <!-- 6 spaces for a faux-center -->
    \n“${truncatedHeading}”
    \n<i>${truncatedContent}</i>
    `;

    // 3) Send to Telegram
    try {
      await bot.sendMessage(telegramId, completionCard, { parse_mode: "HTML" });
    } catch (cardError) {
      console.error("Error sending completion card:", cardError.message);
    }

    try {
      if (unifiedMessenger && typeof unifiedMessenger.sendMessageWithLimit === "function") {
        await unifiedMessenger.sendMessageWithLimit(telegramId, resultText, "HTML");
      } else {
        await bot.sendMessage(telegramId, resultText, { parse_mode: "HTML" });
      }
    } catch (fullMsgError) {
      console.error("Error sending full task result:", fullMsgError.message);
    }

    const contextInput = { text: task.content };
    const sanitizedText = resultText;
    try {
      await contextManager.updateContext(task.user, contextInput, sanitizedText);
    } catch (contextError) {
      console.error("Error updating context:", contextError.message);
    }

    this.emit('taskCompleted', { taskId: task._id, telegramId });
    return task;
  }

  async processDueTasks(bot) {
    if (!this.initialized) await this.initialize();

    const now = new Date();
    const dueTasks = await Task.find({ dueTime: { $lte: now }, status: "PENDING" })
      .sort({ dueTime: 1 })
      .exec();

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

  async deleteTask({ telegramId, taskId }) {
    if (!this.initialized) await this.initialize();

    const task = await Task.findOneAndDelete({ telegramId, _id: taskId }).exec();
    if (!task) {
      throw new Error(`Task with id ${taskId} not found for user ${telegramId}.`);
    }

    // Remove any scheduled jobs for this task
    await queueService.removeJob('tasks', `task_${taskId}`);
    await queueService.removeJob('tasks', `task_${taskId}_daily`);
    await queueService.removeJob('tasks', `task_${taskId}_interval`);

    this.emit('taskDeleted', { taskId, telegramId });
    return task;
  }

  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
    console.log('✅ TasksService cleaned up');
  }
}

export const tasksService = new TasksService();