// src/services/queue/QueueService.js

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
    this.healthCheckInterval = null;
    this.monitoringInterval = null;
    this.queueStats = new Map();
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

      // Start health checks and monitoring
      this.startHealthChecks();
      this.startQueueMonitoring();

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
        this.emit('queueError', { queue: name, error });
      });
      
      queue.on('failed', async (job, error) => {
        console.error(`❌ Job ${job.id} in queue "${name}" failed:`, error);
        await ErrorHandler.handle(error);
        this.emit('jobFailed', { queue: name, jobId: job.id, error });
      });
      
      queue.on('completed', (job) => {
        console.log(`✅ Job ${job.id} in queue "${name}" completed`);
        this.emit('jobCompleted', { queue: name, jobId: job.id });
      });
      
      queue.on('stalled', (jobId) => {
        console.warn(`⚠️ Job ${jobId} in queue "${name}" stalled`);
        this.emit('jobStalled', { queue: name, jobId });
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
      const job = await queue.add(data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        ...options
      });
      
      console.log(`📋 Added job ${job.id} to queue "${queueName}"`);
      this.emit('jobAdded', { queue: queueName, jobId: job.id, data });
      
      return job;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async addNamedJob(queueName, jobName, data, options = {}) {
    const queue = this.getQueue(queueName);
    try {
      const job = await queue.add(jobName, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        ...options
      });
      
      console.log(`📋 Added named job ${jobName}:${job.id} to queue "${queueName}"`);
      this.emit('jobAdded', { queue: queueName, jobName, jobId: job.id, data });
      
      return job;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async addRepeatableJob(queueName, data, repeatOptions, jobId, moreOptions = {}) {
    const queue = this.getQueue(queueName);
    try {
      // Add timestamp to jobId to ensure uniqueness
      //const uniqueJobId = `${jobId}_${Date.now()}`;
      const uniqueJobId = jobId;
      
      const jobOpts = {
        jobId: uniqueJobId,
        repeat: repeatOptions,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
        ...moreOptions
      };
      
      const job = await queue.add(data, jobOpts);
      
      console.log(`🔄 Added repeatable job ${uniqueJobId} to queue "${queueName}"`);
      this.emit('repeatableJobAdded', { 
        queue: queueName, 
        jobId: uniqueJobId, 
        data,
        repeatOptions 
      });
      
      return job;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }
  
  async removeRepeatableJobById(queueName, jobId) {
    const queue = this.getQueue(queueName);
    try {
      const repeatableJobs = await queue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find(j => j.id === jobId || j.key.includes(jobId));
      
      if (jobToRemove) {
        await queue.removeRepeatableByKey(jobToRemove.key);
        console.log(`🗑️ Removed repeatable job ${jobId} from queue "${queueName}"`);
        this.emit('repeatableJobRemoved', { queue: queueName, jobId });
        return true;
      } else {
        console.log(`⚠️ Repeatable job ${jobId} not found in queue "${queueName}"`);
        return false;
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
        console.log(`🗑️ Removed job ${jobId} from queue "${queueName}"`);
        this.emit('jobRemoved', { queue: queueName, jobId });
        return true;
      } else {
        console.log(`⚠️ No job found with id ${jobId} in queue "${queueName}"`);
        return false;
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Removes all jobs related to a specific pattern or ID
   * @param {string} queueName - The name of the queue
   * @param {string} pattern - The job ID pattern to match
   * @returns {Promise<number>} - Number of jobs removed
   */
  async removeJobsByPattern(queueName, pattern) {
    const queue = this.getQueue(queueName);
    try {
      // Get all jobs in various states
      const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'paused']);
      
      // Filter jobs by ID pattern
      const matchingJobs = jobs.filter(job => 
        job.id && job.id.toString().includes(pattern)
      );
      
      // Remove each matching job
      for (const job of matchingJobs) {
        await job.remove();
        console.log(`🗑️ Removed job ${job.id} matching pattern "${pattern}" from queue "${queueName}"`);
        this.emit('jobRemoved', { queue: queueName, jobId: job.id, pattern });
      }
      
      // Also try to remove any repeatable jobs with this pattern
      const repeatableJobs = await queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        if (job.id && job.id.includes(pattern)) {
          await queue.removeRepeatableByKey(job.key);
          console.log(`🗑️ Removed repeatable job ${job.id} matching pattern "${pattern}" from queue "${queueName}"`);
          this.emit('repeatableJobRemoved', { queue: queueName, jobId: job.id, pattern });
        }
      }
      
      return matchingJobs.length;
    } catch (error) {
      console.error(`❌ Error removing jobs by pattern "${pattern}" from queue "${queueName}":`, error);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Checks if a job exists in the queue
   * @param {string} queueName - The name of the queue
   * @param {string} jobId - The job ID to check
   * @returns {Promise<boolean>} - True if job exists, false otherwise
   */
  async jobExists(queueName, jobId) {
    const queue = this.getQueue(queueName);
    try {
      const job = await queue.getJob(jobId);
      return !!job;
    } catch (error) {
      console.error(`❌ Error checking if job ${jobId} exists in queue "${queueName}":`, error);
      return false;
    }
  }

  /**
   * Lists all jobs in a queue with optional filtering
   * @param {string} queueName - The name of the queue
   * @param {Array<string>} states - Job states to include
   * @returns {Promise<Array>} - Array of jobs
   */
  async listJobs(queueName, states = ['active', 'waiting', 'delayed', 'paused']) {
    const queue = this.getQueue(queueName);
    try {
      const jobs = await queue.getJobs(states);
      return jobs.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        state: job.getState(),
        timestamp: job.timestamp
      }));
    } catch (error) {
      console.error(`❌ Error listing jobs in queue "${queueName}":`, error);
      throw error;
    }
  }

  /**
   * Starts health checks for all queues
   * Runs every 5 minutes
   */
  startHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.runHealthChecks();
      } catch (error) {
        console.error('❌ Error running health checks:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
    
    console.log('✅ Queue health checks started');
  }
  
  /**
   * Runs health checks on all queues
   * Checks for stalled jobs and Redis connection
   */
  async runHealthChecks() {
    console.log('🏥 Running queue health checks...');
    
    // Check Redis connection
    try {
      if (!this.redisClient.isReady) {
        console.error('❌ Redis client is not ready');
        this.emit('healthCheckFailed', { component: 'redis', error: 'Redis client is not ready' });
        
        // Try to reconnect
        await this.redisClient.connect();
      }
    } catch (error) {
      console.error('❌ Redis health check failed:', error);
      this.emit('healthCheckFailed', { component: 'redis', error: error.message });
    }
    
    // Check each queue
    for (const [queueName, queue] of this.queues.entries()) {
      try {
        // Check for stalled jobs
        const stalledCount = await queue.getStalledCount();
        if (stalledCount > 0) {
          console.warn(`⚠️ Queue "${queueName}" has ${stalledCount} stalled jobs`);
          this.emit('stalledJobsDetected', { queue: queueName, count: stalledCount });
        }
        
        // Check if queue is paused
        const isPaused = await queue.isPaused();
        if (isPaused) {
          console.warn(`⚠️ Queue "${queueName}" is paused`);
          this.emit('queuePaused', { queue: queueName });
        }
      } catch (error) {
        console.error(`❌ Health check failed for queue "${queueName}":`, error);
        this.emit('healthCheckFailed', { component: queueName, error: error.message });
      }
    }
    
    console.log('✅ Queue health checks completed');
  }
  
  /**
   * Starts monitoring for all queues
   * Collects stats every minute
   */
  startQueueMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectQueueStats();
      } catch (error) {
        console.error('❌ Error collecting queue stats:', error);
      }
    }, 60 * 1000); // Every minute
    
    console.log('✅ Queue monitoring started');
  }
  
  /**
   * Collects stats for all queues
   * Emits events for monitoring systems
   */
  async collectQueueStats() {
    for (const [queueName, queue] of this.queues.entries()) {
      try {
        const stats = {
          waiting: await queue.getWaitingCount(),
          active: await queue.getActiveCount(),
          completed: await queue.getCompletedCount(),
          failed: await queue.getFailedCount(),
          delayed: await queue.getDelayedCount(),
          timestamp: Date.now()
        };
        
        this.queueStats.set(queueName, stats);
        this.emit('queueStats', { queue: queueName, stats });
        
        // Check for orphaned jobs (active for too long)
        const activeJobs = await queue.getJobs(['active']);
        const now = Date.now();
        const orphanedJobs = activeJobs.filter(job => {
          const processingTime = now - job.timestamp;
          return processingTime > 10 * 60 * 1000; // 10 minutes
        });
        
        if (orphanedJobs.length > 0) {
          console.warn(`⚠️ Queue "${queueName}" has ${orphanedJobs.length} potentially orphaned jobs`);
          this.emit('orphanedJobsDetected', { 
            queue: queueName, 
            count: orphanedJobs.length,
            jobs: orphanedJobs.map(j => ({ id: j.id, timestamp: j.timestamp }))
          });
        }
      } catch (error) {
        console.error(`❌ Error collecting stats for queue "${queueName}":`, error);
      }
    }
  }
  
  /**
   * Gets the current stats for all queues
   * @returns {Object} - Queue stats
   */
  getQueueStats() {
    const stats = {};
    for (const [queueName, queueStats] of this.queueStats.entries()) {
      stats[queueName] = queueStats;
    }
    return stats;
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
      const activeJobs = await queue.getJobs(['active']);
      const delayedJobs = await queue.getJobs(['delayed']);
      
      console.log(`📊 Queue "${queueName}" contents:`);
      console.log(`- Repeatable Jobs (${repeatableJobs.length}):`, repeatableJobs.map(j => ({ id: j.id, key: j.key, cron: j.cron, every: j.every })));
      console.log(`- Waiting Jobs (${waitingJobs.length}):`, waitingJobs.map(j => ({ id: j.id, name: j.name })));
      console.log(`- Active Jobs (${activeJobs.length}):`, activeJobs.map(j => ({ id: j.id, name: j.name })));
      console.log(`- Delayed Jobs (${delayedJobs.length}):`, delayedJobs.map(j => ({ id: j.id, name: j.name })));
    } catch (error) {
      console.error(`❌ Error logging queue contents for "${queueName}":`, error);
    }
  }

  /**
   * Cleans up orphaned jobs that have been active for too long
   * @param {string} queueName - The name of the queue
   * @param {number} thresholdMs - Time threshold in milliseconds (default: 30 minutes)
   */
  async cleanupOrphanedJobs(queueName, thresholdMs = 30 * 60 * 1000) {
    const queue = this.getQueue(queueName);
    try {
      const activeJobs = await queue.getJobs(['active']);
      const now = Date.now();
      const orphanedJobs = activeJobs.filter(job => {
        const processingTime = now - job.timestamp;
        return processingTime > thresholdMs;
      });
      
      if (orphanedJobs.length > 0) {
        console.warn(`⚠️ Cleaning up ${orphanedJobs.length} orphaned jobs in queue "${queueName}"`);
        
        for (const job of orphanedJobs) {
          // Move to failed state instead of removing
          await job.moveToFailed(new Error('Job marked as orphaned due to excessive processing time'), true);
          console.log(`🗑️ Marked job ${job.id} as failed (orphaned) in queue "${queueName}"`);
        }
        
        this.emit('orphanedJobsCleaned', { 
          queue: queueName, 
          count: orphanedJobs.length 
        });
      }
      
      return orphanedJobs.length;
    } catch (error) {
      console.error(`❌ Error cleaning up orphaned jobs in queue "${queueName}":`, error);
      throw error;
    }
  }

  async cleanup() {
    try {
      // Stop health checks and monitoring
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
        this.healthCheckInterval = null;
      }
      
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }
      
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
      this.queueStats.clear();
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
