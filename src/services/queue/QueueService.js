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
    this.redisClient = null;
    this.connectPromise = null;
    this.reconnecting = false;
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
    this.degraded = false;
    
    // Use a single consistent Redis config
    this.redisConfig = {
      host: config.redis.socket.host,
      port: config.redis.socket.port,
      password: config.redis.password,
      username: config.redis.username
    };
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await this.initializeRedis();
      
      if (!this.degraded) {
        await this.initializeQueues();
        this.startHealthChecks(30 * 60 * 1000); // Every 30 minutes (reduced frequency)
        this.startQueueMonitoring(15 * 60 * 1000); // Every 15 minutes (reduced frequency)
      } else {
        console.warn('⚠️ QueueService initialized in degraded mode due to Redis unavailability.');
      }
      // In case of emergency
      // await this.resetAllQueues();

      this.initialized = true;
      console.log('✅ QueueService initialized');
    } catch (error) {
      console.error('❌ Error initializing QueueService:', error.message);
      this.degraded = true;
      // Not throwing the error allows the system to continue in degraded mode
    }
  }

  async initializeRedis() {
    if (this.redisClient && this.redisClient.isReady) return;
    
    try {
      // Avoid multiple simultaneous connection attempts
      if (this.connectPromise) return this.connectPromise;
      
      this.connectPromise = new Promise(async (resolve, reject) => {
        try {
          // Clean up existing client if necessary
          if (this.redisClient) {
            this.redisClient.removeAllListeners();
            await this.redisClient.quit().catch(() => {});
          }
          
          // Create a new Redis client with reasonable connection settings
          this.redisClient = createClient({
            socket: { 
              host: this.redisConfig.host,
              port: this.redisConfig.port,
              reconnectStrategy: (retries) => {
                // Exponential backoff with maximum delay
                const delay = Math.min(Math.pow(2, retries) * 1000, 30000);
                console.log(`Redis reconnect attempt ${retries} scheduled in ${delay}ms`);
                return delay;
              },
              connectTimeout: 10000 // 10 second connection timeout
            },
            password: this.redisConfig.password,
            username: this.redisConfig.username
          });
          
          // Setup minimal error handling for Redis
          this.redisClient.on('error', (error) => {
            // Only log the first error in a sequence, not every retry
            if (!this.reconnecting) {
              console.error('❌ Redis connection error:', error.message);
              this.degraded = true;
              this.reconnecting = true;
            }
          });
          
          this.redisClient.on('connect', () => {
            console.log('✅ Redis client connected');
            this.degraded = false;
            this.reconnecting = false;
          });
          
          this.redisClient.on('ready', () => {
            console.log('✅ Redis client ready');
            this.degraded = false;
            this.reconnecting = false;
          });
          
          // Connect with timeout
          await Promise.race([
            this.redisClient.connect(),
            new Promise((_, timeoutReject) => 
              setTimeout(() => timeoutReject(new Error('Redis connection timeout')), 10000)
            )
          ]);
          
          resolve();
        } catch (err) {
          console.error('❌ Redis connection failed:', err.message);
          this.degraded = true;
          reject(err);
        } finally {
          this.connectPromise = null;
        }
      });
      
      return this.connectPromise;
    } catch (error) {
      console.error('❌ Redis initialization error:', error.message);
      this.degraded = true;
      // Continue in degraded mode
    }
  }

  async initializeQueues() {
    try {
      // Create queues using consistent configuration
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
    if (this.queues.has(name)) {
      return this.queues.get(name);
    }
    
    try {
      // Use a consistent Redis configuration for all Bull queues
      const queue = new Bull(name, {
        redis: this.redisConfig,
        settings: {
          lockDuration: 300000,          // 5 minutes
          stalledInterval: 300000,       // Check every 5 minutes (increased)
          maxStalledCount: 1,            // Only check once
          drainDelay: 5                 // Reduce CPU usage
        },
        ...this.defaultQueueConfig,
        ...options
      });

      // Limit event listeners
      queue.setMaxListeners(5);
      
      // Streamlined error handling with less logging
      queue.on('error', async (error) => {
        // Avoid excessive logging
        if (!this.degraded) {
          console.error(`❌ Queue "${name}" error: ${error.message}`);
          await ErrorHandler.handle(error);
          this.emit('queueError', { queue: name, error });
        }
      });
      
      // Track job failures but minimize logging
      let lastFailedLog = 0;
      queue.on('failed', async (job, error) => {
        // Throttle failure logging to prevent log flooding
        const now = Date.now();
        if (now - lastFailedLog > 60000) { // Max once per minute
          console.error(`❌ Job failed in queue "${name}": ${error.message}`);
          lastFailedLog = now;
        }
        
        await ErrorHandler.handle(error);
        this.emit('jobFailed', { queue: name, jobId: job.id, error });
      });
      
      // Minimal event handling for other events
      queue.on('stalled', (jobId) => {
        console.warn(`⚠️ Job ${jobId} in queue "${name}" stalled`);
        this.emit('jobStalled', { queue: name, jobId });
      });

      this.queues.set(name, queue);
      return queue;
    } catch (error) {
      console.error(`❌ Error creating queue "${name}":`, error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async tryRecoverFromDegradedState() {
    if (!this.degraded) return true;
    
    try {
      await this.initializeRedis();
      
      if (!this.degraded) {
        // Redis is back, reinitialize queues if needed
        for (const queueName of ['tasks', 'priceAlerts', 'kolMonitor']) {
          if (!this.queues.has(queueName)) {
            await this.createQueue(queueName);
          }
        }
        
        // Restart monitoring if it was stopped
        if (!this.healthCheckInterval) {
          this.startHealthChecks(30 * 60 * 1000);
        }
        if (!this.monitoringInterval) {
          this.startQueueMonitoring(15 * 60 * 1000);
        }
        
        console.log('✅ QueueService recovered from degraded state');
        return true;
      }
    } catch (error) {
      console.error('❌ Failed to recover from degraded state:', error.message);
    }
    
    return false;
  }

  getQueue(name) {
    if (!this.queues.has(name)) {
      throw new Error(`Queue "${name}" not found`);
    }
    return this.queues.get(name);
  }

  async addJob(queueName, data, options = {}) {
    // Try to recover if in degraded mode
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) {
      // Still degraded, log only occasionally
      if (Math.random() < 0.01) { // Log only ~1% of failures to reduce spam
        console.warn(`⚠️ Queue service is degraded. Can't add job to "${queueName}"`);
      }
      return null;
    }
    
    try {
      const queue = this.getQueue(queueName);
      
      // Deduplication logic
      if (data.userId && data.handle) {
        const existingJobs = await queue.getJobs(['waiting', 'active', 'delayed']);
        const duplicateJob = existingJobs.find(job => {
          const d = job.data;
          return d.userId === data.userId && d.handle === data.handle;
        });
        
        if (duplicateJob) {
          return duplicateJob;
        }
      }
      
      const job = await queue.add(data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        ...options
      });
      
      this.emit('jobAdded', { queue: queueName, jobId: job.id, data });
      return job;
    } catch (error) {
      // Handle Redis errors specially
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
        
        // Throttle logging to prevent floods
        if (Math.random() < 0.01) { // Log only ~1% of failures
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
    // Try to recover if in degraded mode
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) {
      // Throttle logging
      if (Math.random() < 0.01) {
        console.warn(`⚠️ Queue service is degraded. Can't add named job "${jobName}" to "${queueName}"`);
      }
      return null;
    }
    
    try {
      const queue = this.getQueue(queueName);
      const job = await queue.add(jobName, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        ...options
      });
      
      this.emit('jobAdded', { queue: queueName, jobName, jobId: job.id, data });
      return job;
    } catch (error) {
      // Handle Redis errors specially
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
        
        // Throttle logging
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
    // Try to recover if in degraded mode
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) {
      // Throttle logging
      if (Math.random() < 0.01) {
        console.warn(`⚠️ Queue service is degraded. Can't add repeatable job "${jobId}" to "${queueName}"`);
      }
      return null;
    }
    
    try {
      const queue = this.getQueue(queueName);
      const uniqueJobId = jobId;
      
      // First, make sure we don't have an existing job with this ID
      await this.removeRepeatableJobById(queueName, uniqueJobId).catch(() => {});
      
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
      // Handle Redis errors specially
      if (error.message.includes('Redis') || error.message.includes('ECONNREFUSED')) {
        this.degraded = true;
        
        // Throttle logging
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
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) return false;
    
    try {
      const queue = this.getQueue(queueName);
      const repeatableJobs = await queue.getRepeatableJobs();
      const jobsToRemove = repeatableJobs.filter(j => j.id === jobId || j.key.includes(jobId));
      
      if (jobsToRemove.length > 0) {
        const removePromises = jobsToRemove.map(job => queue.removeRepeatableByKey(job.key));
        await Promise.all(removePromises);
        
        console.log(`🗑️ Removed ${jobsToRemove.length} repeatable job(s) for ${jobId} from queue "${queueName}"`);
        this.emit('repeatableJobRemoved', { queue: queueName, jobId });
        return true;
      } else {
        return false;
      }
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
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) return false;
    
    try {
      const queue = this.getQueue(queueName);
      const job = await queue.getJob(jobId);
      
      if (job) {
        await job.remove();
        console.log(`🗑️ Removed job ${jobId} from queue "${queueName}"`);
        this.emit('jobRemoved', { queue: queueName, jobId });
        return true;
      } else {
        return false;
      }
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
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) return 0;
    
    try {
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
          // Throttle individual job error logging
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
            // Throttle individual job error logging
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
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) return false;
    
    try {
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
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) return [];
    
    try {
      const queue = this.getQueue(queueName);
      const jobs = await queue.getJobs(states);
      
      return jobs.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        state: job.getState(),
        timestamp: job.timestamp
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

  startHealthChecks(interval = 30 * 60 * 1000) { // Default: 30 minutes (increased)
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
    // Try to recover from degraded state during health checks
    if (this.degraded) {
      await this.tryRecoverFromDegradedState();
      if (this.degraded) return; // Still degraded, exit early
    }
    
    // Check Redis connection
    try {
      if (!this.redisClient || !this.redisClient.isReady) {
        console.error('❌ Redis client is not ready');
        this.emit('healthCheckFailed', { component: 'redis', error: 'Redis client is not ready' });
        
        // Try to reconnect if disconnected
        await this.initializeRedis();
      }
    } catch (error) {
      console.error('❌ Redis health check failed:', error.message);
      this.emit('healthCheckFailed', { component: 'redis', error: error.message });
    }
    
    // Only check a subset of queues each time to spread out the load
    const queueEntries = Array.from(this.queues.entries());
    const sampleQueues = queueEntries.length <= 3 ? 
      queueEntries : 
      queueEntries.sort(() => 0.5 - Math.random()).slice(0, 2);
    
    for (const [queueName, queue] of sampleQueues) {
      try {
        const isPaused = await queue.isPaused();
        if (isPaused) {
          console.warn(`⚠️ Queue "${queueName}" is paused`);
          this.emit('queuePaused', { queue: queueName });
          
          // Auto-resume paused queues
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
  
  startQueueMonitoring(interval = 15 * 60 * 1000) { // Default: 15 minutes (increased)
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
    // Try to recover from degraded state
    if (this.degraded) {
      await this.tryRecoverFromDegradedState();
      if (this.degraded) return; // Still degraded, exit early
    }
    
    // Only check a subset of queues each time
    const queueEntries = Array.from(this.queues.entries());
    const sampleQueues = queueEntries.length <= 2 ? 
      queueEntries : 
      queueEntries.sort(() => 0.5 - Math.random()).slice(0, 2);
    
    for (const [queueName, queue] of sampleQueues) {
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
        
        // Check for orphaned jobs with a higher threshold
        const activeJobs = await queue.getJobs(['active']);
        const now = Date.now();
        const orphanedJobs = activeJobs.filter(job => {
          const processingTime = now - job.timestamp;
          return processingTime > 60 * 60 * 1000; // 60 minutes threshold (increased)
        });
        
        if (orphanedJobs.length > 0) {
          console.warn(`⚠️ Queue "${queueName}" has ${orphanedJobs.length} potentially orphaned jobs`);
          
          // Auto-cleanup orphaned jobs
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
      const orphanedJobs = activeJobs.filter(job => (now - job.timestamp) > thresholdMs);
      
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
        console.error(`❌ Error cleaning up orphaned jobs in "${queueName}":`, error.message);
        await ErrorHandler.handle(error);
      }
      return 0;
    }
  }

  async resetQueue(queueName) {
    if (this.degraded && !(await this.tryRecoverFromDegradedState())) return false;
    
    try {
      const queue = this.getQueue(queueName);
      
      // Empty waiting, delayed, active jobs
      await queue.empty();
      
      // Clean completed and failed jobs
      await queue.clean(0, 'completed');
      await queue.clean(0, 'failed');
      
      // Remove all repeatable jobs
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
    // Clear all intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    // Close all queues
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
    
    // Close Redis client
    if (this.redisClient) {
      try {
        await this.redisClient.quit().catch(() => {});
      } catch (error) {
        console.error('Error closing Redis client:', error.message);
      }
    }
    
    // Clear internal state
    this.queues.clear();
    this.queueStats.clear();
    this.removeAllListeners();
    this.initialized = false;
    this.degraded = false;
    
    console.log('✅ QueueService cleaned up');
  }
}

export const queueService = new QueueService();