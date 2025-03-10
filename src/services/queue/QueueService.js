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
      // Create a single shared Redis client
      this.redisClient = createClient({
        ...this.redisClientConfig,
        socket: { 
          ...this.redisClientConfig.socket, 
          reconnectStrategy: (times) => Math.min(times * 100, 2000)
        }
      });
  
      this.redisClient.on('error', async (error) => {
        console.error('❌ Redis connection error:', error);
        await ErrorHandler.handle(error);
        // Optionally, mark as degraded so that queue-dependent services can later check this flag
        this.degraded = true;
      });
  
      this.redisClient.on('connect', () => {
        console.log('✅ Redis client connected');
        this.degraded = false; // Reset degraded state on connect
      });
  
      // Attempt to wait for Redis connection with limited attempts
      try {
        await this.waitForRedis(30000);
      } catch (err) {
        console.error('❌ Redis did not connect in time. Running in degraded mode.');
        this.degraded = true;
        // Do not throw error—allow the system to continue running.
      }
  
      // Only create queues if Redis is available (non-degraded)
      if (!this.degraded) {
        await this.createQueue('tasks');
        await this.createQueue('priceAlerts');
        await this.createQueue('kolMonitor');
        // Optionally, start health checks and monitoring only when not degraded.
        this.startHealthChecks();
        this.startQueueMonitoring();
      } else {
        console.warn('⚠️ QueueService is running in degraded mode due to Redis unavailability.');
      }
  
      this.initialized = true;
      console.log('✅ QueueService initialized');
    } catch (error) {
      console.error('❌ Error initializing QueueService:', error);
      // Do not crash the entire system – rethrow only if absolutely necessary.
      // throw error;
    }
  }  

  async waitForRedis(timeout = 30000, maxAttempts = 3) {
    let attempts = 0;
    const startTime = Date.now();
    while (attempts < maxAttempts && (Date.now() - startTime) < timeout) {
      try {
        if (!this.redisClient.isReady) {
          console.log(`Attempt ${attempts + 1}: Waiting for Redis to be ready...`);
          await this.redisClient.connect();
        }
        if (this.redisClient.isReady) {
          console.log('✅ Redis client is ready!');
          return;
        }
      } catch (err) {
        attempts++;
        console.error(`❌ Redis connection attempt ${attempts} failed:`, err.message);
        // Wait a bit before retrying (exponential backoff)
        await new Promise(res => setTimeout(res, Math.min(1000 * 2 ** attempts, 5000)));
      }
    }
    throw new Error('Redis connection failed after maximum attempts.');
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
          retryStrategy: (times) => Math.min(times * 100, 2000)
        },
        settings: {
          lockDuration: 300000,      // 5 minutes
          stalledInterval: 60000,    // checks every 1 minute
          maxStalledCount: 0         // disables stall detection
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

  /**
   * Deduplicate jobs based on a combination of userId and handle.
   * If both properties exist in the data, only add a new job if
   * no job with the same userId and handle is already in waiting, active, or delayed state.
   */
  async addJob(queueName, data, options = {}) {
    const queue = this.getQueue(queueName);
    try {
      if (data.userId && data.handle) {
        const existingJobs = await queue.getJobs(['waiting', 'active', 'delayed']);
        const duplicateJob = existingJobs.find(job => {
          const d = job.data;
          return d.userId === data.userId && d.handle === data.handle;
        });
        if (duplicateJob) {
          console.log(
            `⚠️ Skipping duplicate job in queue "${queueName}" for userId=${data.userId}, handle=${data.handle} (existing job ID ${duplicateJob.id})`
          );
          return duplicateJob;
        }
      }
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
      // Use jobId (or unique string) to identify the repeatable job.
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

  async removeJobsByPattern(queueName, pattern) {
    const queue = this.getQueue(queueName);
    try {
      // Get all jobs in various states.
      const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'paused']);
      // Filter jobs by matching pattern in their ID.
      const matchingJobs = jobs.filter(job => job.id && job.id.toString().includes(pattern));
      
      // Remove each matching job.
      for (const job of matchingJobs) {
        await job.remove();
        console.log(`🗑️ Removed job ${job.id} matching pattern "${pattern}" from queue "${queueName}"`);
        this.emit('jobRemoved', { queue: queueName, jobId: job.id, pattern });
      }
      
      // Also remove any repeatable jobs matching the pattern.
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

  startHealthChecks() {
    if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
    
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.runHealthChecks();
      } catch (error) {
        console.error('❌ Error running health checks:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
    
    console.log('✅ Queue health checks started');
  }
  
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
    
    // Check each queue for stalled jobs and paused state.
    for (const [queueName, queue] of this.queues.entries()) {
      try {
        const stalledCount = await queue.getStalledCount();
        if (stalledCount > 0) {
          console.warn(`⚠️ Queue "${queueName}" has ${stalledCount} stalled jobs`);
          this.emit('stalledJobsDetected', { queue: queueName, count: stalledCount });
        }
        
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
  
  startQueueMonitoring() {
    if (this.monitoringInterval) clearInterval(this.monitoringInterval);
    
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectQueueStats();
      } catch (error) {
        console.error('❌ Error collecting queue stats:', error);
      }
    }, 60 * 1000); // Every minute
    
    console.log('✅ Queue monitoring started');
  }
  
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
          return processingTime > 10 * 60 * 1000; // 10 minutes threshold
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
  
  getQueueStats() {
    const stats = {};
    for (const [queueName, queueStats] of this.queueStats.entries()) {
      stats[queueName] = queueStats;
    }
    return stats;
  }

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

  async cleanupOrphanedJobs(queueName, thresholdMs = 30 * 60 * 1000) {
    const queue = this.getQueue(queueName);
    try {
      const activeJobs = await queue.getJobs(['active']);
      const now = Date.now();
      const orphanedJobs = activeJobs.filter(job => (now - job.timestamp) > thresholdMs);
      
      if (orphanedJobs.length > 0) {
        console.warn(`⚠️ Cleaning up ${orphanedJobs.length} orphaned jobs in queue "${queueName}"`);
        
        for (const job of orphanedJobs) {
          // Mark as failed rather than removing immediately.
          await job.moveToFailed(new Error('Job marked as orphaned due to excessive processing time'), true);
          console.log(`🗑️ Marked job ${job.id} as failed (orphaned) in queue "${queueName}"`);
        }
        
        this.emit('orphanedJobsCleaned', { queue: queueName, count: orphanedJobs.length });
      }
      
      return orphanedJobs.length;
    } catch (error) {
      console.error(`❌ Error cleaning up orphaned jobs in queue "${queueName}":`, error);
      throw error;
    }
  }

  /**
   * Hard resets (empties) the specified queue by:
   * - Emptying waiting, delayed, active, completed, and failed jobs.
   * - Removing all repeatable jobs.
   */
  async resetQueue(queueName) {
    const queue = this.getQueue(queueName);
    try {
      // Empty all jobs from waiting, delayed, active, completed, and failed sets.
      await queue.empty();
      await queue.clean(0, 'completed');
      await queue.clean(0, 'failed');
      
      // Remove all repeatable jobs.
      const repeatableJobs = await queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        await queue.removeRepeatableByKey(job.key);
      }
      
      console.log(`🔄 Queue "${queueName}" has been hard reset (emptied)`);
      this.emit('queueReset', { queue: queueName });
    } catch (error) {
      console.error(`❌ Error resetting queue "${queueName}":`, error);
      throw error;
    }
  }

  /**
   * Hard resets all queues managed by this service.
   * Call this on startup to ensure no stuck or leftover jobs remain.
   */
  async resetAllQueues() {
    const resetPromises = Array.from(this.queues.keys()).map(queueName => this.resetQueue(queueName));
    await Promise.all(resetPromises);
    console.log('🔄 All queues have been hard reset');
  }

  async cleanup() {
    try {
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
