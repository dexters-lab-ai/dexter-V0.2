// queueService.js
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

    // Node-Redis v4 config for direct usage (if needed)
    this.redisClientConfig = config.redisClient;

    // Plain config for Bull v3 (host, port, password, no socket)
    this.bullRedisConfig = config.bullRedis;

    this.redisClient = null;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // 1) Create Node-Redis v4 client (optional if you need direct Redis ops)
      this.redisClient = createClient(this.redisClientConfig);

      this.redisClient.on('error', async (error) => {
        console.error('❌ Redis connection error:', error);
        await ErrorHandler.handle(error);
      });

      // 2) Wait for readiness
      await this.waitForRedis();

      // 3) Create some default queues for your app
      await this.createQueue('tasks');       // default job type
      await this.createQueue('priceAlerts'); // default job type
      await this.createQueue('kolMonitor');  // default job type

      this.initialized = true;
      console.log('✅ QueueService initialized');
    } catch (error) {
      console.error('❌ Error initializing QueueService:', error);
      throw error;
    }
  }

  /**
   * Wait up to 60 seconds for Redis to become 'ready'.
   */
  async waitForRedis() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 60000);

      this.redisClient.once('ready', () => {
        clearTimeout(timeout);
        console.log('✅ Redis client is ready!');
        resolve();
      });

      this.redisClient.connect().catch((err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  /**
   * Create (and cache) a Bull queue with bullRedisConfig.
   */
  async createQueue(name, options = {}) {
    if (this.queues.has(name)) {
      return this.queues.get(name);
    }

    try {
      const queue = new Bull(name, {
        redis: this.bullRedisConfig,
        ...options
      });

      // Basic logging
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

  /**
   * Add a job with the default job name (`__default__`).
   */
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

  /**
   * Add a job with a custom job name.
   */
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

  /**
   * Add a recurring job (default name).
   */
  async addRecurringJob(queueName, data, cronExpression, options = {}) {
    const queue = this.getQueue(queueName);
    try {
      return await queue.add(data, {
        repeat: { cron: cronExpression },
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

  /**
   * Add a recurring job with a custom job name.
   */
  async addNamedRecurringJob(queueName, jobName, data, cronExpression, options = {}) {
    const queue = this.getQueue(queueName);
    try {
      return await queue.add(jobName, data, {
        repeat: { cron: cronExpression },
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

  async removeJob(queueName, jobId) {
    const queue = this.getQueue(queueName);
    try {
      await queue.removeJob(jobId);
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Cleanup queues & Redis client
   */
  async cleanup() {
    try {
      // Close all Bull queues
      const cleanupPromises = Array.from(this.queues.values()).map(async (queue) => {
        await queue.pause(true);
        await queue.clean(0, 'completed');
        await queue.clean(0, 'failed');
        await queue.close();
      });
      await Promise.all(cleanupPromises);

      // Quit Redis client
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
