import Bull from 'bull';
import { EventEmitter } from 'events';
import { createClient } from 'redis';
import { config } from '../../core/config.js';
import { ErrorHandler } from '../../core/errors/index.js';

class QueueService extends EventEmitter {
  constructor() {
    super();
    this.queues = new Map();
    this.initialized = false;
    this.redisClientConfig = config.redisClient; 
    this.bullRedisConfig = config.bullRedis;
    this.redisClient = null;
    this.defaultQueueConfig = {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false
      }
    };
  }

  async initialize() {
    if (this.initialized) return;
    try {
      this.redisClient = createClient(this.redisClientConfig);
      this.redisClient.on('error', async (error) => {
        console.error('❌ Redis connection error:', error);
        await ErrorHandler.handle(error);
      });
      this.redisClient.on('connect', () => {
        console.log('✅ Redis client connected');
      });
      await this.waitForRedis(30000);

      // Create default queues
      await this.createQueue('tasks');
      await this.createQueue('priceAlerts');
      await this.createQueue('kolMonitor');

      this.initialized = true;
      console.log('✅ QueueService initialized');
    } catch (error) {
      console.error('❌ Error initializing QueueService:', error);
      throw error;
    }
  }

  async waitForRedis(timeout = 30000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, timeout);

      this.redisClient.once('ready', () => {
        clearTimeout(timer);
        console.log('✅ Redis client is ready!');
        resolve();
      });

      this.redisClient.connect().catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  async createQueue(name, options = {}) {
    if (this.queues.has(name)) {
      return this.queues.get(name);
    }
    try {
      const queue = new Bull(name, {
        redis: {
          host: config.redis.socket.host,
          port: config.redis.socket.port,
          password: config.redis.password,
          username: config.redis.username,
          retryStrategy: (times) => {
            const delay = Math.min(times * 100, 2000);
            return delay;
          }
        },
        settings: {
          lockDuration: 300000,      // 5 minutes
          stalledInterval: 60000,    // checks every 1 min
          maxStalledCount: 0         // effectively disables stall detection
        },
        ...this.defaultQueueConfig,
        ...options
      });

      queue.on('error', async (error) => {
        console.error(`❌ Queue "${name}" error:`, error);
        await ErrorHandler.handle(error);
      });
      queue.on('failed', async (job, error) => {
        console.error(`❌ Job ${job.id} in queue "${name}" failed:`, error);
        await ErrorHandler.handle(error);
      });

      this.queues.set(name, queue);
      return queue;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  getQueue(name) {
    if (!this.queues.has(name)) {
      throw new Error(`Queue "${name}" not found`);
    }
    return this.queues.get(name);
  }

  async addJob(queueName, data, options = {}) {
    const queue = this.getQueue(queueName);
    try {
      return await queue.add(data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        ...options
      });
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async addNamedJob(queueName, jobName, data, options = {}) {
    const queue = this.getQueue(queueName);
    try {
      return await queue.add(jobName, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        ...options
      });
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async addRepeatableJob(queueName, data, repeatOptions, jobId, moreOptions = {}) {
    const queue = this.getQueue(queueName);
    try {
      const jobOpts = {
        jobId,
        repeat: repeatOptions,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
        ...moreOptions
      };
      return await queue.add(data, jobOpts);
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async removeRepeatableJobById(queueName, jobId) {
    const queue = this.getQueue(queueName);
    try {
      const repeatableJobs = await queue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find(j => j.id === jobId);
      if (jobToRemove) {
        await queue.removeRepeatableByKey(jobToRemove.key);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Removes a one-time (non-repeatable) job from the queue by job ID.
   * For Bull v3, we must get the job, then call job.remove().
   */
  async removeJob(queueName, jobId) {
    const queue = this.getQueue(queueName);
    try {
      const job = await queue.getJob(jobId);
      if (job) {
        await job.remove();
        console.log(`✅ Removed job ${jobId} from queue "${queueName}"`);
      } else {
        console.log(`⚠️ No job found with id ${jobId} in queue "${queueName}"`);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * logQueueContents()
   * ------------------
   * Logs the current repeatable and waiting jobs for the specified queue.
   */
  async logQueueContents(queueName) {
    try {
      const queue = this.getQueue(queueName);
      const repeatableJobs = await queue.getRepeatableJobs();
      const waitingJobs = await queue.getJobs(['waiting']);
      console.log(`Queue "${queueName}" contents:`);
      console.log('Repeatable Jobs:', repeatableJobs);
      console.log('Waiting Jobs:', waitingJobs);
    } catch (error) {
      console.error(`❌ Error logging queue contents for "${queueName}":`, error);
    }
  }

  async cleanup() {
    try {
      const cleanupPromises = Array.from(this.queues.values()).map(async (queue) => {
        await queue.pause(true);
        await queue.clean(0, 'completed');
        await queue.clean(0, 'failed');
        await queue.close();
      });
      await Promise.all(cleanupPromises);

      if (this.redisClient) {
        await this.redisClient.quit();
      }
      this.queues.clear();
      this.removeAllListeners();
      this.initialized = false;
      console.log('✅ QueueService cleaned up');
    } catch (error) {
      console.error('❌ Error cleaning up QueueService:', error);
      throw error;
    }
  }
}

export const queueService = new QueueService();
