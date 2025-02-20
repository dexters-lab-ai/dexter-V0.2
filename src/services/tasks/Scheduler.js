// Scheduler.js
import { tasksService } from "./TasksService.js";
import { bot } from "../../core/bot.js";
import { EventEmitter } from 'events';
import { queueService } from '../queue/QueueService.js';

class TaskScheduler extends EventEmitter {
  constructor() {
    super();
    if (TaskScheduler.instance) {
      return TaskScheduler.instance;
    }
    TaskScheduler.instance = this;
    this.initialized = false;
    this.taskQueue = null;
    this.monitoringQueue = null;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      // Make sure queueService is initialized
      await queueService.initialize();

      // We have a 'tasks' queue for actual tasks
      this.taskQueue = queueService.getQueue('tasks');

      // A separate 'taskMonitoring' queue (created on the fly)
      this.monitoringQueue = await queueService.createQueue('taskMonitoring', {
        defaultJobOptions: {
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 }
        }
      });

      // Named processor for "checkTasks" job
      this.monitoringQueue.process('checkTasks', async (job) => {
        await this.checkAndScheduleDueTasks();
      });

      // Initialize tasks service
      await tasksService.initialize();

      this.initialized = true;
      console.log('✅ TaskScheduler initialized');
    } catch (error) {
      console.error('❌ Error initializing TaskScheduler:', error);
      throw error;
    }
  }

  start() {
    if (!this.initialized) {
      throw new Error('TaskScheduler must be initialized before starting');
    }

    // Add a repeatable, named job that runs every minute
    // Using queueService.addNamedJob or addNamedRecurringJob is optional,
    // but we can do it directly with Bull if you prefer.
    // We'll use the queueService for consistency:
    this.monitoringQueue.add(
      'checkTasks', // job name
      {},          // job data
      {
        repeat: {
          cron: '* * * * *', // every minute
          tz: 'UTC'
        }
      }
    );

    console.log('✅ TaskScheduler started with precise minute monitoring');
  }

  async checkAndScheduleDueTasks() {
    try {
      const processedCount = await tasksService.processDueTasks(bot);
      if (processedCount > 0) {
        console.log(`Processed ${processedCount} due tasks at ${new Date().toISOString()}`);
        this.emit('tasksProcessed', { count: processedCount });
      }
      // Now schedule upcoming tasks
      await this.scheduleUpcomingTasks();
    } catch (error) {
      console.error("Error processing due tasks:", error);
      this.emit('error', error);
    }
  }

  async scheduleUpcomingTasks() {
    try {
      const now = new Date();
      const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

      // Find tasks due in the next 5 minutes that haven't been scheduled
      const upcomingTasks = await tasksService.retrieveTasks({
        dueTime: { $gt: now, $lte: fiveMinutesFromNow },
        status: "PENDING",
        scheduled: { $ne: true }
      });

      for (const task of upcomingTasks) {
        const delay = task.dueTime.getTime() - now.getTime();

        // Here we add a named job "executeTask" or use default?
        // tasksService also uses name "executeTask" for tasks. Let's stay consistent:
        await this.taskQueue.add(
          'executeTask',
          { taskId: task._id, telegramId: task.telegramId },
          {
            delay,
            jobId: `task_${task._id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 }
          }
        );

        // Mark as scheduled
        await tasksService.updateTask(task._id, { scheduled: true });
        console.log(`Scheduled task ${task._id} to run in ${delay}ms`);
      }
    } catch (error) {
      console.error("Error scheduling upcoming tasks:", error);
      this.emit('error', error);
    }
  }

  async scheduleRecurringTask(task) {
    try {
      if (task.recurrence === "daily") {
        // Named or default? We'll do named again:
        await this.taskQueue.add(
          'executeTask',
          { taskId: task._id, telegramId: task.telegramId },
          {
            repeat: { cron: '0 0 * * *', tz: 'UTC' },
            jobId: `recurring_${task._id}`
          }
        );
      } else if (typeof task.recurrence === 'number' && task.recurrence >= 5) {
        await this.taskQueue.add(
          'executeTask',
          { taskId: task._id, telegramId: task.telegramId },
          {
            repeat: { every: task.recurrence * 60 * 1000 },
            jobId: `recurring_${task._id}`
          }
        );
      }
    } catch (error) {
      console.error(`Error scheduling recurring task ${task._id}:`, error);
      this.emit('error', error);
    }
  }

  stop() {
    if (this.monitoringQueue) {
      this.monitoringQueue.clean(0, 'completed');
      this.monitoringQueue.clean(0, 'failed');
      console.log('✅ TaskScheduler stopped');
    }
  }

  async cleanup() {
    try {
      this.stop();

      if (this.taskQueue) {
        await this.taskQueue.clean(0, 'completed');
        await this.taskQueue.clean(0, 'failed');
      }

      if (this.monitoringQueue) {
        await this.monitoringQueue.clean(0, 'completed');
        await this.monitoringQueue.clean(0, 'failed');

        // Remove all repeatable jobs from monitoring
        const repeatableJobs = await this.monitoringQueue.getRepeatableJobs();
        await Promise.all(
          repeatableJobs.map(job => this.monitoringQueue.removeRepeatableByKey(job.key))
        );
      }

      this.removeAllListeners();
      this.initialized = false;
      console.log('✅ TaskScheduler cleaned up');
    } catch (error) {
      console.error('❌ Error cleaning up TaskScheduler:', error);
      throw error;
    }
  }
}

export const taskScheduler = new TaskScheduler();
