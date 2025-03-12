import Bull from 'bull';
import { EventEmitter } from 'events';
import { createClient } from 'redis';
import { config } from '../../core/config.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { redisPool } from '../../core/redisPool.js';

class QueueService extends EventEmitter {
  constructor() {
    super();
    this.queues = new Map();
    this.initialized = false;
    this.redisClient = null;
    this.connectPromise = null;
    this.reconnecting = false;
    this.defaultQueueConfig = {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    };
    // Increase intervals so that health checks and monitoring do not run too frequently.
    this.healthCheckInterval = null;
    this.monitoringInterval = null;
    this.queueStats = new Map();
    this.degraded = false;
    
    // Use a single consistent Redis configuration
    this.redisConfig = {
      host: config.redis.socket.host,
      port: config.redis.socket.port,
      password: config.redis.password,
      username: config.redis.username,
    };
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await this.initializeRedis();

      if (!this.degraded) {
        await this.initializeQueues();
        // Health checks every 30 minutes, queue monitoring every 15 minutes
        this.startHealthChecks(30 * 60 * 1000);
        this.startQueueMonitoring(15 * 60 * 1000);
      } else {
        console.warn('⚠️ QueueService initialized in degraded mode due to Redis unavailability.');
      }
      this.initialized = true;
      console.log('✅ QueueService initialized');
    } catch (error) {
      console.error('❌ Error initializing QueueService:', error.message);
      this.degraded = true;
      // Continue in degraded mode.
    }
  }

  async initializeRedis() {
    // If we already hold a ready client from the pool, no need to reacquire.
    if (this.redisClient && this.redisClient.isReady) return;
  
    try {
      if (this.connectPromise) return this.connectPromise;
  
      this.connectPromise = new Promise(async (resolve, reject) => {
        try {
          // If an existing client exists, release it back to the pool first.
          if (this.redisClient) {
            try {
              this.redisClient.removeAllListeners();
              await redisPool.release(this.redisClient);
            } catch (e) {
              console.error('Error releasing previous Redis client:', e.message);
            }
          }
          // Acquire a new Redis client from the pool.
          this.redisClient = await redisPool.acquire();
  
          // Set up event handlers on the pooled client.
          this.redisClient.on('error', (error) => {
            if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
              if (!this._lastRedisErrorTime || (Date.now() - this._lastRedisErrorTime) > 60000) {
                console.error('❌ Redis connection error (pool):', error.message);
                this._lastRedisErrorTime = Date.now();
              }
              this.degraded = true;
              // Optionally schedule a reconnection attempt (with exponential backoff)
              setTimeout(() => {
                this.initializeRedis().catch(err => {
                  console.error('❌ Redis reconnection attempt failed (pool):', err.message);
                });
              }, Math.min(30000, Math.pow(2, (this.reconnectAttempts || 1)) * 1000));
            } else {
              console.error('❌ Redis error (pool):', error.message);
            }
          });
  
          this.redisClient.on('connect', () => {
            console.log('✅ Redis client acquired from pool and connected.');
            this.degraded = false;
          });
  
          this.redisClient.on('ready', () => {
            console.log('✅ Redis client ready (pool).');
            this.degraded = false;
          });
  
          resolve();
        } catch (err) {
          console.error('❌ Redis connection failed (pool):', err.message);
          this.degraded = true;
          reject(err);
        } finally {
          this.connectPromise = null;
        }
      });
  
      return this.connectPromise;
    } catch (error) {
      console.error('❌ Redis initialization error (pool):', error.message);
      this.degraded = true;
      // Continue in degraded mode.
    }
  }

  async initializeQueues() {
    try {
      await this.createQueue('tasks');
      await this.createQueue('priceAlerts');
      await this.createQueue('kolMonitor');
      console.log('✅ All queues initialized');
    } catch (error) {
      console.error('❌ Error initializing queues:', error.message);
      await ErrorHandler.handle(error);
    }
  }

  async createQueue(name, options = {}) {
    if (this.queues.has(name)) return this.queues.get(name);
    try {
      const queue = new Bull(name, {
        redis: this.redisConfig,
        settings: {
          lockDuration: 300000,
          stalledInterval: 300000,
          maxStalledCount: 1,
          drainDelay: 5,
        },
        ...this.defaultQueueConfig,
        ...options,
      });
  
      // Limit event listeners to avoid memory leaks.
      queue.setMaxListeners(5);
  
      // Throttled error handler for network errors.
      queue.on('error', async (error) => {
        if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
          if (!queue._lastErrorLogged || (Date.now() - queue._lastErrorLogged) > 60000) {
            console.error(`❌ Queue "${name}" error: ${error.message}`);
            queue._lastErrorLogged = Date.now();
          }
        } else {
          console.error(`❌ Queue "${name}" error: ${error.message}`);
        }
        await ErrorHandler.handle(error);
        this.emit('queueError', { queue: name, error });
      });
  
      let lastFailedLog = 0;
      queue.on('failed', async (job, error) => {
        const now = Date.now();
        if (now - lastFailedLog > 60000) {
          console.error(`❌ Job failed in queue "${name}": ${error.message}`);
          lastFailedLog = now;
        }
        await ErrorHandler.handle(error);
        this.emit('jobFailed', { queue: name, jobId: job.id, error });
      });
  
      queue.on('stalled', (jobId) => {
        console.warn(`⚠️ Job ${jobId} in queue "${name}" stalled`);
        this.emit('jobStalled', { queue: name, jobId });
      });
  
      this.queues.set(name, queue);
      return queue;
    } catch (error) {
      console.error(`❌ Error creating queue "${name}": ${error.message}`);
      await ErrorHandler.handle(error);
      return null;
    }
  }
  
  async tryRecoverFromDegradedState() {
    if (!this.degraded) return true;
    
    try {
      await this.initializeRedis();
      if (!this.degraded) {
        for (const queueName of ['tasks', 'priceAlerts', 'kolMonitor']) {
          if (!this.queues.has(queueName)) {
            await this.createQueue(queueName);
          }
        }
        if (!this.healthCheckInterval) this.startHealthChecks(30 * 60 * 1000);
        if (!this.monitoringInterval) this.startQueueMonitoring(15 * 60 * 1000);
        console.log('✅ QueueService recovered from degraded state');
        return true;
      }
    } catch (error) {
      console.error('❌ Failed to recover from degraded state:', error.message);
    }
    return false;
  }

  getQueue(name) {
    if (!this.queues.has(name)) throw new Error(`Queue "${name}" not found`);
    return this.queues.get(name);
  }

  async addJob(queueName, data, options = {}) {
    try {
      if (this.degraded && !(await this.tryRecoverFromDegradedState())) {
        if (Math.random() < 0.01) {
          console.warn(`⚠️ Queue service is degraded. Can't add job to "${queueName}"`);
        }
        return null;
      }
      const queue = this.getQueue(queueName);
      // Deduplication if applicable.
      if (data.userId && data.handle) {
        const existingJobs = await queue.getJobs(['waiting', 'active', 'delayed']);
        const duplicateJob = existingJobs.find(job => {
          const d = job.data;
          return d.userId === data.userId && d.handle === data.handle;
        });
        if (duplicateJob) return duplicateJob;
      }
      const job = await queue.add(data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        ...options,
      });
      this.emit('jobAdded', { queue: queueName, jobId: job.id, data });
      return job;
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
        if (Math.random() < 0.01) {
          console.error(`❌ Redis error when adding job to "${queueName}"`);
        }
      } else {
        console.error(`❌ Error adding job to "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return null;
    }
  }  

  async addNamedJob(queueName, jobName, data, options = {}) {
    try {
      if (this.degraded && !(await this.tryRecoverFromDegradedState())) {
        if (Math.random() < 0.01) {
          console.warn(`⚠️ Queue service is degraded. Can't add named job "${jobName}" to "${queueName}"`);
        }
        return null;
      }
      const queue = this.getQueue(queueName);
      const job = await queue.add(jobName, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        ...options,
      });
      this.emit('jobAdded', { queue: queueName, jobName, jobId: job.id, data });
      return job;
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
        if (Math.random() < 0.01) {
          console.error(`❌ Redis error when adding named job to "${queueName}"`);
        }
      } else {
        console.error(`❌ Error adding named job "${jobName}" to "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return null;
    }
  }  

  async addRepeatableJob(queueName, data, repeatOptions, jobId, moreOptions = {}) {
    try {
      if (this.degraded && !(await this.tryRecoverFromDegradedState())) {
        if (Math.random() < 0.01) {
          console.warn(`⚠️ Queue service is degraded. Can't add repeatable job "${jobId}" to "${queueName}"`);
        }
        return null;
      }
      const queue = this.getQueue(queueName);
      // Ensure duplicate repeatable jobs are removed.
      await this.removeRepeatableJobById(queueName, jobId).catch(() => {});
      const jobOpts = {
        jobId,
        repeat: repeatOptions,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
        ...moreOptions,
      };
      const job = await queue.add(data, jobOpts);
      console.log(`🔄 Added repeatable job ${jobId} to queue "${queueName}"`);
      this.emit('repeatableJobAdded', { queue: queueName, jobId, data, repeatOptions });
      return job;
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
        if (Math.random() < 0.01) {
          console.error(`❌ Redis error when adding repeatable job to "${queueName}"`);
        }
      } else {
        console.error(`❌ Error adding repeatable job "${jobId}" to "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return null;
    }
  }  
  
  async removeRepeatableJobById(queueName, jobId) {
    try {
      if (this.degraded && !(await this.tryRecoverFromDegradedState())) return false;
      const queue = this.getQueue(queueName);
      const repeatableJobs = await queue.getRepeatableJobs();
      const jobsToRemove = repeatableJobs.filter(j => j.id === jobId || j.key.includes(jobId));
      if (jobsToRemove.length > 0) {
        const removePromises = jobsToRemove.map(job => queue.removeRepeatableByKey(job.key));
        await Promise.all(removePromises);
        console.log(`🗑️ Removed ${jobsToRemove.length} repeatable job(s) for ${jobId} from queue "${queueName}"`);
        this.emit('repeatableJobRemoved', { queue: queueName, jobId });
        return true;
      }
      return false;
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
      } else {
        console.error(`❌ Error removing repeatable job "${jobId}" from "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return false;
    }
  }  

  async removeJob(queueName, jobId) {
    try {
      if (this.degraded && !(await this.tryRecoverFromDegradedState())) return false;
      const queue = this.getQueue(queueName);
      const job = await queue.getJob(jobId);
      if (job) {
        await job.remove();
        console.log(`🗑️ Removed job ${jobId} from queue "${queueName}"`);
        this.emit('jobRemoved', { queue: queueName, jobId });
        return true;
      }
      return false;
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
      } else {
        console.error(`❌ Error removing job ${jobId} from "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return false;
    }
  }  

  async removeJobsByPattern(queueName, pattern) {
    try {
      if (this.degraded && !(await this.tryRecoverFromDegradedState())) return 0;
      const queue = this.getQueue(queueName);
      const jobs = await queue.getJobs(['active', 'waiting', 'delayed', 'paused']);
      const matchingJobs = jobs.filter(job => job.id && job.id.toString().includes(pattern));
      let removed = 0;
      for (const job of matchingJobs) {
        try {
          await job.remove();
          removed++;
          this.emit('jobRemoved', { queue: queueName, jobId: job.id, pattern });
        } catch (removeError) {
          if (Math.random() < 0.1) {
            console.error(`Error removing job ${job.id}: ${removeError.message}`);
          }
        }
      }
      const repeatableJobs = await queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        if (job.id && job.id.includes(pattern)) {
          try {
            await queue.removeRepeatableByKey(job.key);
            removed++;
            this.emit('repeatableJobRemoved', { queue: queueName, jobId: job.id, pattern });
          } catch (removeError) {
            if (Math.random() < 0.1) {
              console.error(`Error removing repeatable job ${job.id}: ${removeError.message}`);
            }
          }
        }
      }
      if (removed > 0) {
        console.log(`🗑️ Removed ${removed} jobs matching pattern "${pattern}" from queue "${queueName}"`);
      }
      return removed;
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
      } else {
        console.error(`❌ Error removing jobs by pattern "${pattern}" from "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return 0;
    }
  }  

  async jobExists(queueName, jobId) {
    try {
      if (this.degraded && !(await this.tryRecoverFromDegradedState())) return false;
      const queue = this.getQueue(queueName);
      const job = await queue.getJob(jobId);
      return !!job;
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
      }
      return false;
    }
  }  

  async listJobs(queueName, states = ['active', 'waiting', 'delayed', 'paused']) {
    try {
      if (this.degraded && !(await this.tryRecoverFromDegradedState())) return [];
      const queue = this.getQueue(queueName);
      const jobs = await queue.getJobs(states);
      return jobs.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        state: job.getState(),
        timestamp: job.timestamp,
      }));
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
      } else {
        console.error(`❌ Error listing jobs in "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return [];
    }
  }  

  startHealthChecks(interval = 30 * 60 * 1000) {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.runHealthChecks();
      } catch (error) {
        console.error('❌ Error running health checks:', error.message);
      }
    }, interval);
    
    console.log(`✅ Queue health checks started (interval: ${interval}ms)`);
  }
  
  async runHealthChecks() {
    if (this.degraded) {
      await this.tryRecoverFromDegradedState();
      if (this.degraded) return;
    }
    
    try {
      if (!this.redisClient || !this.redisClient.isReady) {
        console.error('❌ Redis client is not ready');
        this.emit('healthCheckFailed', { component: 'redis', error: 'Redis client is not ready' });
        await this.initializeRedis();
      }
    } catch (error) {
      console.error('❌ Redis health check failed:', error.message);
      this.emit('healthCheckFailed', { component: 'redis', error: error.message });
    }
    
    const queueEntries = Array.from(this.queues.entries());
    const sampleQueues = queueEntries.length <= 3 ? queueEntries : queueEntries.sort(() => 0.5 - Math.random()).slice(0, 2);
    
    for (const [queueName, queue] of sampleQueues) {
      try {
        const isPaused = await queue.isPaused();
        if (isPaused) {
          console.warn(`⚠️ Queue "${queueName}" is paused`);
          this.emit('queuePaused', { queue: queueName });
          try {
            await queue.resume();
            console.log(`✅ Auto-resumed queue "${queueName}"`);
          } catch (resumeError) {
            console.error(`Failed to resume queue "${queueName}":`, resumeError.message);
          }
        }
      } catch (error) {
        console.error(`❌ Health check failed for queue "${queueName}":`, error.message);
        this.emit('healthCheckFailed', { component: queueName, error: error.message });
      }
    }
  }
  
  startQueueMonitoring(interval = 15 * 60 * 1000) {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectQueueStats();
      } catch (error) {
        console.error('❌ Error collecting queue stats:', error.message);
      }
    }, interval);
    
    console.log(`✅ Queue monitoring started (interval: ${interval}ms)`);
  }
  
  async collectQueueStats() {
    if (this.degraded) {
      await this.tryRecoverFromDegradedState();
      if (this.degraded) return;
    }
    
    const queueEntries = Array.from(this.queues.entries());
    const sampleQueues = queueEntries.length <= 2 ? queueEntries : queueEntries.sort(() => 0.5 - Math.random()).slice(0, 2);
    
    for (const [queueName, queue] of sampleQueues) {
      try {
        const stats = {
          waiting: await queue.getWaitingCount(),
          active: await queue.getActiveCount(),
          completed: await queue.getCompletedCount(),
          failed: await queue.getFailedCount(),
          delayed: await queue.getDelayedCount(),
          timestamp: Date.now(),
        };
        this.queueStats.set(queueName, stats);
        this.emit('queueStats', { queue: queueName, stats });
        
        const activeJobs = await queue.getJobs(['active']);
        const now = Date.now();
        const orphanedJobs = activeJobs.filter(job => now - job.timestamp > 60 * 60 * 1000);
        if (orphanedJobs.length > 0) {
          console.warn(`⚠️ Queue "${queueName}" has ${orphanedJobs.length} orphaned jobs`);
          await this.cleanupOrphanedJobs(queueName, 60 * 60 * 1000);
        }
      } catch (error) {
        if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
          this.degraded = true;
        } else {
          console.error(`❌ Error collecting stats for queue "${queueName}":`, error.message);
        }
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
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) {
      console.warn(`⚠️ Cannot log queue contents while in degraded mode`);
      return;
    }
    
    try {
      const queue = this.getQueue(queueName);
      const repeatableJobs = await queue.getRepeatableJobs();
      const waitingJobs = await queue.getJobs(['waiting']);
      const activeJobs = await queue.getJobs(['active']);
      
      console.log(`📊 Queue "${queueName}" summary:`);
      console.log(`- Repeatable Jobs: ${repeatableJobs.length}`);
      console.log(`- Waiting Jobs: ${waitingJobs.length}`);
      console.log(`- Active Jobs: ${activeJobs.length}`);
    } catch (error) {
      console.error(`❌ Error logging queue contents for "${queueName}":`, error.message);
    }
  }

  async cleanupOrphanedJobs(queueName, thresholdMs = 60 * 60 * 1000) {
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) return 0;
    
    try {
      const queue = this.getQueue(queueName);
      const activeJobs = await queue.getJobs(['active']);
      const now = Date.now();
      const orphanedJobs = activeJobs.filter(job => now - job.timestamp > thresholdMs);
      
      if (orphanedJobs.length > 0) {
        console.warn(`⚠️ Cleaning up ${orphanedJobs.length} orphaned jobs in queue "${queueName}"`);
        let cleaned = 0;
        for (const job of orphanedJobs) {
          try {
            await job.moveToFailed(new Error('Job marked as orphaned due to excessive processing time'), true);
            cleaned++;
          } catch (moveError) {
            console.error(`Error moving job ${job.id} to failed:`, moveError.message);
          }
        }
        if (cleaned > 0) {
          this.emit('orphanedJobsCleaned', { queue: queueName, count: cleaned });
        }
        return cleaned;
      }
      return 0;
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
      } else {
        console.error(`❌ Error cleaning orphaned jobs in "${queueName}":`, error.message);
        await ErrorHandler.handle(error);
      }
      return 0;
    }
  }

  async resetQueue(queueName) {
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) return false;
    
    try {
      const queue = this.getQueue(queueName);
      await queue.empty();
      await queue.clean(0, 'completed');
      await queue.clean(0, 'failed');
      const repeatableJobs = await queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        try {
          await queue.removeRepeatableByKey(job.key);
        } catch (removeError) {
          console.error(`Error removing repeatable job key ${job.key}:`, removeError.message);
        }
      }
      console.log(`🔄 Queue "${queueName}" has been reset`);
      this.emit('queueReset', { queue: queueName });
      return true;
    } catch (error) {
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
      } else {
        console.error(`❌ Error resetting queue "${queueName}":`, error.message);
        await ErrorHandler.handle(error);
      }
      return false;
    }
  }

  async resetAllQueues() {
    if (this.degraded) return false;
    const results = [];
    for (const queueName of this.queues.keys()) {
      try {
        const result = await this.resetQueue(queueName);
        results.push({ queue: queueName, success: result });
      } catch (error) {
        console.error(`Error resetting queue "${queueName}":`, error.message);
        results.push({ queue: queueName, success: false, error: error.message });
      }
    }
    console.log('🔄 Queue reset operation completed');
    return results;
  }

  async cleanup() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    const closePromises = Array.from(this.queues.values()).map(async (queue) => {
      try {
        await queue.pause(true).catch(() => {});
        await queue.close().catch(() => {});
        return true;
      } catch (error) {
        console.error(`Error closing queue:`, error.message);
        return false;
      }
    });
    await Promise.allSettled(closePromises);
    
    // Instead of quitting the client, release it to the pool.
    if (this.redisClient) {
      await redisPool.release(this.redisClient);
    }
    this.queues.clear();
    this.queueStats.clear();
    this.removeAllListeners();
    this.initialized = false;
    this.degraded = false;
    console.log('✅ QueueService cleaned up');
  }
  
}

export const queueService = new QueueService();
