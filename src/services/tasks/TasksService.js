// src/services/tasks/TasksService.js

import { EventEmitter } from 'events';
import Task from "../../models/Task.js";
import { User } from "../../models/User.js";
import { unifiedMessenger } from "../../core/UnifiedMessageHandler.js";
import { autonomousProcessor } from '../ai/processors/UnifiedAutonomousEngine.js';
import { contextManager } from "../ai/ContextManager.js";
import { bot } from "../../core/bot.js";
import { queueService } from '../queue/QueueService.js';
import { generateJobId, createJobPattern } from '../../utils/queueUtils.js';

/**
 * The TasksService handles user-created tasks (one-time or recurring).
 * - We use Bull via queueService for scheduling/executing tasks.
 */
class TasksService extends EventEmitter {
  constructor(bot) {
    super();
    if (TasksService.instance) {
      return TasksService.instance;
    }
    TasksService.instance = this;

    this.initialized = false;
    this.MAX_ACTIVE_TASKS = 3;
    this.taskQueue = null;

    // Autonomous Processor
    this.autonomousProcessor = autonomousProcessor;
    this.BULL_QUEUE_NAME = 'tasks';
    this.SERVICE_NAME = 'tasks'; // For job ID standardization
  }

  async initialize() {
    if (this.initialized) return;
    try {
      // 1) Ensure queue service is ready
      await queueService.initialize();
  
      // Check if the queue service is running in degraded mode.
      if (queueService.degraded) {
        console.warn('⚠️ QueueService is degraded. Tasks will be executed via fallback (synchronously).');
        // Instead of obtaining the queue, you may opt to process tasks using a fallback method.
        // Lets set up a global polling mechanism to process due tasks.
      } else {
        // 2) Grab or create the "tasks" queue if available
        this.taskQueue = queueService.getQueue(this.BULL_QUEUE_NAME);
  
        // 3) Define how jobs in the "tasks" queue are processed
        this.taskQueue.process(async (job) => {
          const { telegramId, taskId } = job.data;
          await this.executeTask({ telegramId, taskId });
        });
      }
  
      this.initialized = true;
      console.log('✅ TasksService initialized');
    } catch (error) {
      console.error('❌ Error initializing TasksService:', error);
      throw error;
    }
  }  

  /**
   * Creates a Task document in MongoDB, then schedules it with the queue.
   * Uses a transaction-like pattern to ensure both operations succeed or fail together.
   */
  async createTask({ telegramId, content, dueTime, recurrence = "none", heading }) {
    if (!this.initialized) await this.initialize();
  
    const user = await User.findOne({ telegramId: telegramId.toString() }).exec();
    if (!user) {
      throw new Error(`User with telegramId ${telegramId} not found.`);
    }
  
    const activeTasks = await Task.countDocuments({
      telegramId,
      status: "PENDING"
    });
    if (activeTasks >= this.MAX_ACTIVE_TASKS) {
      throw new Error(`Maximum active tasks (${this.MAX_ACTIVE_TASKS}) reached for user ${telegramId}.`);
    }
  
    // 1) If dueTime is a number, interpret as "X minutes from now".
    //    So dueTime=60 => 1 hour from the current time.
    if (typeof dueTime === 'number') {
      const now = new Date();
      const offsetMinutes = dueTime; // e.g. 60
      dueTime = new Date(now.getTime() + offsetMinutes * 60_000);
    }
  
    // 2) Now we can safely convert to a Date:
    let task;
    let schedulingSuccessful = false;
    
    try {
      // Create the task in MongoDB
      task = await Task.create({
        user: user._id,
        telegramId,
        heading: heading || undefined,
        content,
        dueTime: new Date(dueTime),  // If user passed a date-string or we just built one
        recurrence
      });
      
      // Schedule the task in Bull
      await this.scheduleTask(task);
      schedulingSuccessful = true;
      
      this.emit('taskCreated', { taskId: task._id, telegramId });
      return task;
    } catch (error) {
      // If scheduling failed but task was created, delete the task
      if (task && !schedulingSuccessful) {
        console.error(`❌ Task created but scheduling failed. Deleting task ${task._id}:`, error);
        await Task.findByIdAndDelete(task._id);
      }
      throw error;
    }
  }

  /**
   * scheduleTask
   * ------------
   * Decides whether this is a one-time task or recurring,
   * then calls queueService with the appropriate method.
   * Uses standardized job IDs.
   */
  async scheduleTask(task) {
    // In case it's in the past, use a 0ms delay (execute ASAP)
    const now = new Date();
    const delayMs = Math.max(0, task.dueTime.getTime() - now.getTime());
  
    // Helper function to check for duplicate job by ID.
    async function jobExists(queue, jobId, isRepeatable = false) {
      if (isRepeatable) {
        const repeatableJobs = await queue.getRepeatableJobs();
        return repeatableJobs.some(j => j.id === jobId);
      } else {
        const job = await queue.getJob(jobId);
        return !!job;
      }
    }
  
    // If the queue service is degraded, fall back to a direct setTimeout call.
    if (queueService.degraded || !this.taskQueue) {
      console.warn('⚠️ QueueService is degraded; executing task directly after delay:', delayMs);
      setTimeout(async () => {
        try {
          await this.executeTask({ telegramId: task.telegramId, taskId: task._id });
        } catch (error) {
          console.error('❌ Error executing task in fallback mode:', error);
        }
      }, delayMs);
      return;
    }
  
    const queue = this.taskQueue;
    
    // Determine job ID and schedule based on recurrence.
    if (task.recurrence === "none") {
      const jobId = generateJobId(this.SERVICE_NAME, task._id.toString(), 'execute');
      if (await jobExists(queue, jobId)) {
        console.log(`Job ${jobId} already exists for one-time task ${task._id}. Skipping scheduling.`);
        return;
      }
      await queueService.addJob(
        this.BULL_QUEUE_NAME,
        {
          telegramId: task.telegramId,
          taskId: task._id
        },
        {
          delay: delayMs,
          jobId
        }
      );
      console.log(`✅ Scheduled one-time task ${task._id} with job ID ${jobId}`);
    } else if (task.recurrence === "daily") {
      const dateObj = new Date(task.dueTime);
      const hour = dateObj.getHours();
      const minute = dateObj.getMinutes();
      const dailyCron = `${minute} ${hour} * * *`;
      const jobId = generateJobId(this.SERVICE_NAME, task._id.toString(), 'daily');
      if (await jobExists(queue, jobId, true)) {
        console.log(`Job ${jobId} already exists for daily task ${task._id}. Skipping scheduling.`);
        return;
      }
      await queueService.addRepeatableJob(
        this.BULL_QUEUE_NAME,
        {
          telegramId: task.telegramId,
          taskId: task._id
        },
        { cron: dailyCron },
        jobId
      );
      console.log(`✅ Scheduled daily task ${task._id} with job ID ${jobId} (cron: ${dailyCron})`);
    } else if (typeof task.recurrence === "number" && task.recurrence > 0) {
      const intervalCron = `*/${task.recurrence} * * * *`;
      const jobId = generateJobId(this.SERVICE_NAME, task._id.toString(), 'interval');
      if (await jobExists(queue, jobId, true)) {
        console.log(`Job ${jobId} already exists for interval task ${task._id}. Skipping scheduling.`);
        return;
      }
      await queueService.addRepeatableJob(
        this.BULL_QUEUE_NAME,
        {
          telegramId: task.telegramId,
          taskId: task._id
        },
        { cron: intervalCron },
        jobId
      );
      console.log(`✅ Scheduled interval task ${task._id} with job ID ${jobId} (cron: ${intervalCron})`);
    }
  }    

  /**
   * Retrieves tasks. If "taskId" is provided, returns just that one. Otherwise returns all tasks for the user.
   */
  async retrieveTasks({ telegramId, taskId }) {
    if (!this.initialized) await this.initialize();

    if (taskId) {
      return Task.findOne({ telegramId, _id: taskId }).exec();
    }
    return Task.find({ telegramId }).sort({ dueTime: 1 }).exec();
  }

  // Utility: Truncate heading to 50 chars
  truncateText(text = '', maxLength = 50) {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength) + '...';
  }

  /**
   * executeTask
   * -----------
   * The "worker" function that runs when the Bull job is processed. 
   */
  async executeTask({ telegramId, taskId }) {
    if (!this.initialized) await this.initialize();
  
    // Try to fetch the task from MongoDB
    const task = await Task.findOne({ telegramId, _id: taskId }).exec();
    if (!task) {
      // If the task is not found, log a warning and exit gracefully.
      console.warn(`Task with id ${taskId} not found for user ${telegramId}. It may have been deleted.`);
      return;
    }
  
    // Prepare the prompt for the autonomous engine.
    const modifiedContent = `
  [RUN THIS TASK NOW]
  Instruction: ${task.content.trim()}
  Please process the above instruction fully and return the complete result.
  Retry on failure if needed.
  [/RUN THIS TASK NOW]
    `;
  
    let resultText;
    try {
      // Execute the task via the autonomous processor.
      resultText = await this.autonomousProcessor.runTask(task.user, task.telegramId, modifiedContent);
    } catch (error) {
      resultText = `Error executing task: ${error.message}`;
    }
  
    if (typeof resultText !== "string") {
      resultText = resultText && resultText.text ? resultText.text : JSON.stringify(resultText);
    }
  
    // For one-time tasks, mark as COMPLETED; for recurring ones, update dueTime.
    if (task.recurrence === "none") {
      task.status = "COMPLETED";
    } else if (typeof task.recurrence === "number") {
      const nextDue = new Date(task.dueTime.getTime() + task.recurrence * 60000);
      task.dueTime = nextDue;
      task.status = "PENDING";
    } else if (task.recurrence === "daily") {
      const nextDue = new Date(task.dueTime);
      nextDue.setDate(nextDue.getDate() + 1);
      task.dueTime = nextDue;
      task.status = "PENDING";
    } else {
      task.status = "PENDING";
    }
  
    task.result = resultText;
    task.executedAt = new Date();
    await task.save();
  
    // Construct and send user-facing messages.
    const truncatedHeading = this.truncateText(task.heading ?? '', 50);
    const truncatedContent = this.truncateText(task.content ?? '', 50);
    const completionCard = `
  <b>        TASK COMPLETED</b>
  \n"${truncatedHeading}"
  \n<i>${truncatedContent}</i>
    `;
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
    try {
      const contextInput = { text: task.content };
      const sanitizedText = resultText;
      await contextManager.updateContext(task.user, contextInput, sanitizedText);
    } catch (contextError) {
      console.error("Error updating context:", contextError.message);
    }
  
    this.emit('taskCompleted', { taskId: task._id, telegramId });
    return task;
  }
  
  /**
   * For backward compatibility: checks if any tasks are due right now, then executes them.
   * Some prefer to rely entirely on Bull's scheduling, but this can remain as a "safety net".
   */
  async processDueTasks(bot) {
    if (!this.initialized) await this.initialize();
  
    const now = new Date();
    const dueTasks = await Task.find({
      dueTime: { $lte: now },
      status: "PENDING"
    }).sort({ dueTime: 1 }).exec();
  
    for (const task of dueTasks) {
      const preview = task.content.substring(0, 100) + (task.content.length > 100 ? "..." : "");
      console.log(`⚡ Task Due Alert: Heading: ${task.heading}, Preview: ${preview}`);
  
      const alertMsg = `⏱ *Task Notification!*\n💭*Task:* ${task.heading}\n💭*Spec:* ${preview}\n\n🤖 taking over task...`;
      try {
        await bot.sendMessage(task.telegramId, alertMsg, { parse_mode: "Markdown" });
        // If queue is degraded, execute directly
        if (queueService.degraded) {
          console.warn('⚠️ QueueService degraded; processing due task synchronously.');
          await this.executeTask({ telegramId: task.telegramId, taskId: task._id });
        } else {
          // Otherwise, rely on the scheduled Bull job
          console.log(`Task ${task._id} is scheduled via the queue.`);
        }
        await bot.sendMessage(task.telegramId, `✅ Task ${task._id} executed successfully.`);
      } catch (err) {
        console.error(`Error executing task ${task._id}:`, err);
        await bot.sendMessage(task.telegramId, `⚠️ Task ${task._id} execution failed: ${err.message}`);
      }
    }
    return dueTasks.length;
  }  

  /**
   * deleteTask
   * ----------
   * Removes the Task from MongoDB and cancels any queued or repeatable jobs.
   * Uses the new removeJobsByPattern method for more thorough cleanup.
   */
  async deleteTask({ telegramId, taskId }) {
    if (!this.initialized) await this.initialize();

    // Log current tasks for debugging
    const userTasks = await Task.find({ telegramId }).exec();
    console.log(`📝 Found ${userTasks.length} tasks for user ${telegramId}:`);
    userTasks.forEach(t => {
      console.log(`  - TaskID: ${t._id}, Heading: "${t.heading}", DueTime: ${t.dueTime}, Status: ${t.status}`);
    });

    // Delete the task document from MongoDB
    const task = await Task.findOneAndDelete({ telegramId, _id: taskId }).exec();
    if (!task) {
      throw new Error(`Task with id ${taskId} not found for user ${telegramId}.`);
    }

    // Remove all associated jobs using the pattern matching
    try {
      const jobPattern = createJobPattern(this.SERVICE_NAME, taskId);
      const removedCount = await queueService.removeJobsByPattern(this.BULL_QUEUE_NAME, jobPattern);
      console.log(`✅ Removed ${removedCount} jobs matching pattern "${jobPattern}" for task ${taskId}`);
    } catch (error) {
      console.error(`Error removing queue jobs for task ${taskId}:`, error);
      // Continue with deletion even if job removal fails
    }

    this.emit('taskDeleted', { taskId, telegramId });
    return task;
  }

  /**
   * Cleanup listeners & set back to uninitialized.
   */
  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
    console.log('✅ TasksService cleaned up');
  }
}

export const tasksService = new TasksService(bot);
