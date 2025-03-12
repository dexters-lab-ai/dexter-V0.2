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
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.backoffDelay = 1000;
    this.maxBackoffDelay = 60000; // 1 minute max backoff
    this.connectionPool = new Set(); // Track active connections
    this.maxConnections = 20; // Limit concurrent connections
    
    this.defaultQueueConfig = {
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    };
    
    this.healthCheckInterval = null;
    this.monitoringInterval = null;
    this.reconnectTimer = null;
    this.queueStats = new Map();
    this.degraded = false;
    this.shuttingDown = false;
    
    // Use a single consistent Redis configuration
    this.redisConfig = {
      host: config.redis?.socket?.host || config.bullRedis?.host,
      port: config.redis?.socket?.port || config.bullRedis?.port,
      password: config.redis?.password || config.bullRedis?.password,
      username: config.redis?.username || 'default',
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
        // Schedule a reconnection attempt
        this.scheduleReconnect(this.calculateBackoff());
      }
      this.initialized = true;
      console.log('✅ QueueService initialized');
    } catch (error) {
      console.error('❌ Error initializing QueueService:', error.message);
      this.degraded = true;
      // Schedule a reconnection attempt
      this.scheduleReconnect(this.calculateBackoff());
    }
  }

  calculateBackoff() {
    // Exponential backoff with jitter
    const delay = Math.min(
      this.backoffDelay * Math.pow(1.5, this.reconnectAttempts) + Math.random() * 1000,
      this.maxBackoffDelay
    );
    return Math.floor(delay);
  }

  scheduleReconnect(delay) {
    if (this.shuttingDown) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectTimer = setTimeout(async () => {
      if (this.shuttingDown) return;
      try {
        this.reconnectAttempts++;
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
          // Don't log every failure when we're in long-term degraded mode
          if (this.reconnectAttempts % 10 === 0) {
            console.warn(`⚠️ Redis reconnection attempts exceeded limit (${this.maxReconnectAttempts}). Service remains degraded.`);
          }
          // After max attempts, we back off even more and try less frequently
          this.scheduleReconnect(Math.min(this.maxBackoffDelay * 2, 300000)); // Max 5 minutes
          return;
        }
        
        await this.tryRecoverFromDegradedState();
        if (!this.degraded) {
          console.log('✅ QueueService successfully reconnected to Redis');
          this.reconnectAttempts = 0;
        } else {
          // If we couldn't recover, schedule another attempt
          this.scheduleReconnect(this.calculateBackoff());
        }
      } catch (error) {
        console.error('❌ Error during reconnection attempt:', error.message);
        this.scheduleReconnect(this.calculateBackoff());
      }
    }, delay);
    
    if (this.reconnectAttempts === 0 || this.reconnectAttempts % 5 === 0) {
      console.log(`⏱️ Scheduled reconnection attempt in ${Math.round(delay/1000)}s (attempt ${this.reconnectAttempts + 1})`);
    }
  }

  async initializeRedis() {
    if (this.redisClient && this.redisClient.isReady) return;
    
    try {
      if (this.connectPromise) return this.connectPromise;
      
      this.connectPromise = new Promise(async (resolve, reject) => {
        try {
          // Clean up any previous client instance
          if (this.redisClient) {
            this.redisClient.removeAllListeners();
            try {
              await this.redisClient.quit().catch(() => {});
            } catch (e) {
              // Ignore quit errors
            }
          }
          
          // Create a new Redis client with custom reconnect strategy
          this.redisClient = createClient({
            socket: { 
              host: this.redisConfig.host,
              port: this.redisConfig.port,
              connectTimeout: 10000, // 10-second timeout
              reconnectStrategy: (retries) => {
                if (this.shuttingDown) return false; // Don't reconnect if shutting down
                if (retries > 5) {
                  this.degraded = true;
                  return false; // Stop automatic reconnect after 5 attempts, we'll handle it
                }
                return Math.min(Math.pow(2, retries) * 1000, 10000); // Backoff up to 10 seconds
              },
            },
            password: this.redisConfig.password,
            username: this.redisConfig.username,
            // Limit maximum retries per request to avoid hanging
            maxRetriesPerRequest: 3,
          });
          
          this.redisClient.on('error', (error) => {
            // Log only the first error in a series to avoid flood
            if (!this.reconnecting) {
              console.error('❌ Redis connection error:', error.message);
              this.degraded = true;
              this.reconnecting = true;
              // Schedule a reconnection attempt
              this.scheduleReconnect(this.calculateBackoff());
            }
          });
          
          this.redisClient.on('connect', () => {
            console.log('✅ Redis client connected');
            this.reconnecting = false;
          });
          
          this.redisClient.on('ready', () => {
            console.log('✅ Redis client ready');
            this.degraded = false;
            this.reconnecting = false;
            this.reconnectAttempts = 0;
          });
          
          // Handle client end (could be intentional or due to error)
          this.redisClient.on('end', () => {
            if (!this.shuttingDown) {
              console.log('⚠️ Redis client disconnected');
              this.degraded = true;
              // Only schedule reconnect if not shutting down
              this.scheduleReconnect(this.calculateBackoff());
            }
          });
          
          try {
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
          }
        } catch (err) {
          console.error('❌ Redis client creation failed:', err.message);
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
      // Schedule a reconnection attempt if this was the initial connection
      if (this.reconnectAttempts === 0) {
        this.scheduleReconnect(this.calculateBackoff());
      }
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
      // If we're at connection limit, don't create a new queue
      if (this.connectionPool.size >= this.maxConnections) {
        console.warn(`⚠️ Connection pool limit reached (${this.maxConnections}). Queue "${name}" creation deferred.`);
        return null;
      }
      
      // Create a unique ID for this connection
      const connectionId = `queue:${name}:${Date.now()}:${Math.random().toString(36).substring(2, 15)}`;
      this.connectionPool.add(connectionId);
      
      const queue = new Bull(name, {
        redis: this.redisConfig,
        settings: {
          lockDuration: 300000,          // 5 minutes
          stalledInterval: 300000,       // Check every 5 minutes
          maxStalledCount: 1,            // Only check once per job
          drainDelay: 5,                 // Slight delay to reduce CPU load
        },
        // These options are crucial for handling connection issues
        redis: {
          host: this.redisConfig.host,
          port: this.redisConfig.port,
          password: this.redisConfig.password,
          maxRetriesPerRequest: 3,       // Limit retries to avoid hanging
          enableReadyCheck: false,       // Disable ready check to avoid hanging
          connectTimeout: 10000,         // 10-second timeout
        },
        ...this.defaultQueueConfig,
        ...options,
      });

      // Limit event listeners to avoid memory leak warnings.
      queue.setMaxListeners(5);
      
      queue.on('error', async (error) => {
        // Check if this is a Redis connection error
        if (error.message && (
            error.message.includes('Redis') || 
            error.message.includes('ECONNREFUSED') ||
            error.message.includes('connection')
        )) {
          this.degraded = true;
          // Don't log every Redis error to avoid spam
          if (!this.reconnecting) {
            console.error(`❌ Queue "${name}" Redis error: ${error.message}`);
            this.reconnecting = true;
            this.scheduleReconnect(this.calculateBackoff());
          }
        } else {
          // Log non-connection errors normally
          console.error(`❌ Queue "${name}" error: ${error.message}`);
          await ErrorHandler.handle(error);
        }
        this.emit('queueError', { queue: name, error });
      });
      
      // Control the rate of failure logs to avoid flooding
      let lastFailedLog = 0;
      queue.on('failed', async (job, error) => {
        const now = Date.now();
        if (now - lastFailedLog > 60000) { // log at most once per minute
          console.error(`❌ Job failed in queue "${name}": ${error.message}`);
          lastFailedLog = now;
        }
        await ErrorHandler.handle(error);
        this.emit('jobFailed', { queue: name, jobId: job.id, error });
      });
      
      // Track stalled jobs
      queue.on('stalled', (jobId) => {
        console.warn(`⚠️ Job ${jobId} in queue "${name}" stalled`);
        this.emit('jobStalled', { queue: name, jobId });
      });
      
      // Handle queue client closed (when Bull's Redis client disconnects)
      queue.on('closed', () => {
        // Clean up connection tracking
        this.connectionPool.delete(connectionId);
        // Only log if not shutting down
        if (!this.shuttingDown) {
          console.warn(`⚠️ Queue "${name}" Redis client closed`);
          // If this wasn't intentional, mark as degraded
          if (!this.degraded) {
            this.degraded = true;
            this.scheduleReconnect(this.calculateBackoff());
          }
        }
      });

      this.queues.set(name, queue);
      return queue;
    } catch (error) {
      console.error(`❌ Error creating queue "${name}": ${error.message}`);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async tryRecoverFromDegradedState() {
    if (!this.degraded) return true;
    if (this.shuttingDown) return false;
    
    try {
      // Attempt to reconnect to Redis
      await this.initializeRedis();
      
      // If Redis connection succeeded, initialize queues
      if (this.redisClient && this.redisClient.isReady) {
        this.degraded = false;
        
        // Recreate any missing queues
        for (const queueName of ['tasks', 'priceAlerts', 'kolMonitor']) {
          if (!this.queues.has(queueName)) {
            await this.createQueue(queueName);
          } else {
            // Check if the existing queue is healthy
            try {
              const queue = this.queues.get(queueName);
              const isPaused = await queue.isPaused();
              if (isPaused) {
                try {
                  await queue.resume();
                  console.log(`✅ Resumed queue "${queueName}" during recovery`);
                } catch (resumeError) {
                  // If resume fails, recreate the queue
                  this.queues.delete(queueName);
                  await this.createQueue(queueName);
                }
              }
            } catch (healthError) {
              // Queue is unhealthy, recreate it
              this.queues.delete(queueName);
              await this.createQueue(queueName);
            }
          }
        }
        
        // Restart health checks and monitoring if needed
        if (!this.healthCheckInterval) this.startHealthChecks(30 * 60 * 1000);
        if (!this.monitoringInterval) this.startQueueMonitoring(15 * 60 * 1000);
        
        console.log('✅ QueueService recovered from degraded state');
        return true;
      }
    } catch (error) {
      console.error('❌ Failed to recover from degraded state:', error.message);
      // Increment reconnect attempts
      this.reconnectAttempts++;
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
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) {
        if (Math.random() < 0.01) console.warn(`⚠️ Queue service is degraded. Can't add job to "${queueName}"`);
        return null;
      }
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) {
        // If we couldn't get a queue due to connection limits, return null
        return null;
      }
      
      // Check for duplicates if user ID and handle are provided
      if (data.userId && data.handle) {
        try {
          const existingJobs = await queue.getJobs(['waiting', 'active', 'delayed']);
          const duplicateJob = existingJobs.find(job => {
            const d = job.data;
            return d.userId === data.userId && d.handle === data.handle;
          });
          if (duplicateJob) return duplicateJob;
        } catch (getJobsError) {
          // If we can't check for duplicates, just continue with adding the job
          console.warn(`⚠️ Could not check for duplicate jobs: ${getJobsError.message}`);
        }
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
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
        if (Math.random() < 0.01) console.error(`❌ Redis error when adding job to "${queueName}"`);
      } else {
        console.error(`❌ Error adding job to "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return null;
    }
  }

  async addNamedJob(queueName, jobName, data, options = {}) {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) {
        if (Math.random() < 0.01) console.warn(`⚠️ Queue service is degraded. Can't add named job "${jobName}" to "${queueName}"`);
        return null;
      }
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return null;
      
      const job = await queue.add(jobName, data, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        ...options,
      });
      
      this.emit('jobAdded', { queue: queueName, jobName, jobId: job.id, data });
      return job;
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
        if (Math.random() < 0.01) console.error(`❌ Redis error when adding named job to "${queueName}"`);
      } else {
        console.error(`❌ Error adding named job "${jobName}" to "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return null;
    }
  }

  async addRepeatableJob(queueName, data, repeatOptions, jobId, moreOptions = {}) {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) {
        if (Math.random() < 0.01) console.warn(`⚠️ Queue service is degraded. Can't add repeatable job "${jobId}" to "${queueName}"`);
        return null;
      }
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return null;
      
      const uniqueJobId = jobId;
      // Try to remove existing repeatable job with the same ID
      try {
        await this.removeRepeatableJobById(queueName, uniqueJobId).catch(() => {});
      } catch (removeError) {
        // If removal fails due to connection issues, retry recovery
        if (removeError.message.includes('Redis') || 
            removeError.message.includes('ECONNREFUSED') || 
            removeError.message.includes('connection')) {
          this.degraded = true;
          return null;
        }
        // Otherwise ignore removal errors
      }
      
      const jobOpts = {
        jobId: uniqueJobId,
        repeat: repeatOptions,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        removeOnFail: false,
        ...moreOptions,
      };
      
      const job = await queue.add(data, jobOpts);
      console.log(`🔄 Added repeatable job ${uniqueJobId} to queue "${queueName}"`);
      this.emit('repeatableJobAdded', { queue: queueName, jobId: uniqueJobId, data, repeatOptions });
      return job;
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
        if (Math.random() < 0.01) console.error(`❌ Redis error when adding repeatable job to "${queueName}"`);
      } else {
        console.error(`❌ Error adding repeatable job "${jobId}" to "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return null;
    }
  }
  
  async removeRepeatableJobById(queueName, jobId) {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return false;
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return false;
      
      // Wrap getRepeatableJobs in a timeout to prevent hanging
      const repeatableJobs = await Promise.race([
        queue.getRepeatableJobs(),
        new Promise((_, timeoutReject) => 
          setTimeout(() => timeoutReject(new Error('Get repeatable jobs timeout')), 5000)
        )
      ]);
      
      const jobsToRemove = repeatableJobs.filter(j => j.id === jobId || j.key.includes(jobId));
      
      if (jobsToRemove.length > 0) {
        const removePromises = jobsToRemove.map(job => 
          Promise.race([
            queue.removeRepeatableByKey(job.key),
            new Promise((_, timeoutReject) => 
              setTimeout(() => timeoutReject(new Error('Remove repeatable job timeout')), 5000)
            )
          ])
        );
        
        // Use allSettled to continue even if some removals fail
        const results = await Promise.allSettled(removePromises);
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        
        if (successCount > 0) {
          console.log(`🗑️ Removed ${successCount}/${jobsToRemove.length} repeatable job(s) for ${jobId} from queue "${queueName}"`);
          this.emit('repeatableJobRemoved', { queue: queueName, jobId });
          return true;
        }
      }
      return false;
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection') ||
          error.message.includes('timeout')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
      } else {
        console.error(`❌ Error removing repeatable job "${jobId}" from "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return false;
    }
  }

  async removeJob(queueName, jobId) {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return false;
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return false;
      
      // Wrap getJob in a timeout to prevent hanging
      const job = await Promise.race([
        queue.getJob(jobId),
        new Promise((_, timeoutReject) => 
          setTimeout(() => timeoutReject(new Error('Get job timeout')), 5000)
        )
      ]);
      
      if (job) {
        await Promise.race([
          job.remove(),
          new Promise((_, timeoutReject) => 
            setTimeout(() => timeoutReject(new Error('Remove job timeout')), 5000)
          )
        ]);
        
        console.log(`🗑️ Removed job ${jobId} from queue "${queueName}"`);
        this.emit('jobRemoved', { queue: queueName, jobId });
        return true;
      }
      return false;
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection') ||
          error.message.includes('timeout')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
      } else {
        console.error(`❌ Error removing job ${jobId} from "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return false;
    }
  }

  async removeJobsByPattern(queueName, pattern) {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return 0;
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return 0;
      
      // Wrap getJobs in a timeout to prevent hanging
      const jobs = await Promise.race([
        queue.getJobs(['active', 'waiting', 'delayed', 'paused']),
        new Promise((_, timeoutReject) => 
          setTimeout(() => timeoutReject(new Error('Get jobs timeout')), 10000)
        )
      ]);
      
      const matchingJobs = jobs.filter(job => job.id && job.id.toString().includes(pattern));
      
      let removed = 0;
      // Use a batched approach to avoid overwhelming Redis
      const batchSize = 10;
      for (let i = 0; i < matchingJobs.length; i += batchSize) {
        const batch = matchingJobs.slice(i, i + batchSize);
        const removePromises = batch.map(job => 
          Promise.race([
            job.remove().then(() => true).catch(() => false),
            new Promise(resolve => setTimeout(() => resolve(false), 5000))
          ])
        );
        
        const results = await Promise.allSettled(removePromises);
        removed += results.filter(r => r.status === 'fulfilled' && r.value === true).length;
        
        // Pause between batches to avoid overwhelming Redis
        if (i + batchSize < matchingJobs.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      // Also remove matching repeatable jobs
      try {
        const repeatableJobs = await Promise.race([
          queue.getRepeatableJobs(),
          new Promise((_, timeoutReject) => 
            setTimeout(() => timeoutReject(new Error('Get repeatable jobs timeout')), 5000)
          )
        ]);
        
        const matchingRepeatableJobs = repeatableJobs.filter(job => 
          job.id && job.id.includes(pattern)
        );
        
        for (let i = 0; i < matchingRepeatableJobs.length; i += batchSize) {
          const batch = matchingRepeatableJobs.slice(i, i + batchSize);
          const removePromises = batch.map(job => 
            Promise.race([
              queue.removeRepeatableByKey(job.key).then(() => true).catch(() => false),
              new Promise(resolve => setTimeout(() => resolve(false), 5000))
            ])
          );
          
          const results = await Promise.allSettled(removePromises);
          removed += results.filter(r => r.status === 'fulfilled' && r.value === true).length;
          
          if (i + batchSize < matchingRepeatableJobs.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
      } catch (repeatableError) {
        // Log but continue if we can't get repeatable jobs
        console.warn(`⚠️ Could not get repeatable jobs: ${repeatableError.message}`);
      }
      
      if (removed > 0) {
        console.log(`🗑️ Removed ${removed} jobs matching pattern "${pattern}" from queue "${queueName}"`);
      }
      
      return removed;
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection') ||
          error.message.includes('timeout')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
      } else {
        console.error(`❌ Error removing jobs by pattern "${pattern}" from "${queueName}": ${error.message}`);
        await ErrorHandler.handle(error);
      }
      return 0;
    }
  }

  async jobExists(queueName, jobId) {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return false;
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return false;
      
      // Wrap getJob in a timeout to prevent hanging
      const job = await Promise.race([
        queue.getJob(jobId),
        new Promise(resolve => setTimeout(() => resolve(null), 5000))
      ]);
      
      return !!job;
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
      }
      return false;
    }
  }

  async listJobs(queueName, states = ['active', 'waiting', 'delayed', 'paused']) {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return [];
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return [];
      
      // Wrap getJobs in a timeout to prevent hanging
      const jobs = await Promise.race([
        queue.getJobs(states),
        new Promise((_, timeoutReject) => 
          setTimeout(() => timeoutReject(new Error('Get jobs timeout')), 10000)
        )
      ]);
      
      return jobs.map(job => ({
        id: job.id,
        name: job.name,
        data: job.data,
        state: job.getState(),
        timestamp: job.timestamp,
      }));
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection') ||
          error.message.includes('timeout')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
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
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return;
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
      this.degraded = true;
      this.scheduleReconnect(this.calculateBackoff());
    }
    
    const queueEntries = Array.from(this.queues.entries());
    const sampleQueues = queueEntries.length <= 3 ? queueEntries : queueEntries.sort(() => 0.5 - Math.random()).slice(0, 2);
    
    for (const [queueName, queue] of sampleQueues) {
      try {
        // Wrap isPaused in a timeout to prevent hanging
        const isPaused = await Promise.race([
          queue.isPaused(),
          new Promise((_, timeoutReject) => 
            setTimeout(() => timeoutReject(new Error('Queue isPaused timeout')), 5000)
          )
        ]);
        
        if (isPaused) {
          console.warn(`⚠️ Queue "${queueName}" is paused`);
          this.emit('queuePaused', { queue: queueName });
          try {
            await Promise.race([
              queue.resume(),
              new Promise((_, timeoutReject) => 
                setTimeout(() => timeoutReject(new Error('Queue resume timeout')), 5000)
              )
            ]);
            console.log(`✅ Auto-resumed queue "${queueName}"`);
          } catch (resumeError) {
            console.error(`Failed to resume queue "${queueName}":`, resumeError.message);
            if (resumeError.message.includes('Redis') || 
                resumeError.message.includes('ECONNREFUSED') || 
                resumeError.message.includes('connection') ||
                resumeError.message.includes('timeout')) {
              this.degraded = true;
              this.scheduleReconnect(this.calculateBackoff());
            }
          }
        }
      } catch (error) {
        console.error(`❌ Health check failed for queue "${queueName}":`, error.message);
        this.emit('healthCheckFailed', { component: queueName, error: error.message });
        if (error.message.includes('Redis') || 
            error.message.includes('ECONNREFUSED') || 
            error.message.includes('connection') ||
            error.message.includes('timeout')) {
          this.degraded = true;
          this.scheduleReconnect(this.calculateBackoff());
        }
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
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return;
    }
    
    const queueEntries = Array.from(this.queues.entries());
    const sampleQueues = queueEntries.length <= 2 ? queueEntries : queueEntries.sort(() => 0.5 - Math.random()).slice(0, 2);
    
    for (const [queueName, queue] of sampleQueues) {
      try {
        const stats = {
          waiting: await Promise.race([
            queue.getWaitingCount(),
            new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Waiting count timeout')), 5000))
          ]),
          active: await Promise.race([
            queue.getActiveCount(),
            new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Active count timeout')), 5000))
          ]),
          completed: await Promise.race([
            queue.getCompletedCount(),
            new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Completed count timeout')), 5000))
          ]),
          failed: await Promise.race([
            queue.getFailedCount(),
            new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Failed count timeout')), 5000))
          ]),
          delayed: await Promise.race([
            queue.getDelayedCount(),
            new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Delayed count timeout')), 5000))
          ]),
          timestamp: Date.now(),
        };
        
        this.queueStats.set(queueName, stats);
        this.emit('queueStats', { queue: queueName, stats });
        
        const activeJobs = await Promise.race([
          queue.getJobs(['active']),
          new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Get active jobs timeout')), 10000))
        ]);
        
        const now = Date.now();
        const orphanedJobs = activeJobs.filter(job => now - job.timestamp > 60 * 60 * 1000);
        if (orphanedJobs.length > 0) {
          console.warn(`⚠️ Queue "${queueName}" has ${orphanedJobs.length} orphaned jobs`);
          await this.cleanupOrphanedJobs(queueName, 60 * 60 * 1000);
        }
      } catch (error) {
        if (error.message.includes('Redis') || 
            error.message.includes('ECONNREFUSED') || 
            error.message.includes('connection') ||
            error.message.includes('timeout')) {
          this.degraded = true;
          this.scheduleReconnect(this.calculateBackoff());
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
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) {
        console.warn(`⚠️ Cannot log queue contents while in degraded mode`);
        return;
      }
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return;
      
      const repeatableJobs = await Promise.race([
        queue.getRepeatableJobs(),
        new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Get repeatable jobs timeout')), 5000))
      ]);
      
      const waitingJobs = await Promise.race([
        queue.getJobs(['waiting']),
        new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Get waiting jobs timeout')), 10000))
      ]);
      
      const activeJobs = await Promise.race([
        queue.getJobs(['active']),
        new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Get active jobs timeout')), 10000))
      ]);
      
      console.log(`📊 Queue "${queueName}" summary:`);
      console.log(`- Repeatable Jobs: ${repeatableJobs.length}`);
      console.log(`- Waiting Jobs: ${waitingJobs.length}`);
      console.log(`- Active Jobs: ${activeJobs.length}`);
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection') ||
          error.message.includes('timeout')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
      } else {
        console.error(`❌ Error logging queue contents for "${queueName}":`, error.message);
      }
    }
  }
  
  async cleanupOrphanedJobs(queueName, thresholdMs = 60 * 60 * 1000) {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return 0;
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return 0;
      
      const activeJobs = await Promise.race([
        queue.getJobs(['active']),
        new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Get active jobs timeout')), 10000))
      ]);
      
      const now = Date.now();
      const orphanedJobs = activeJobs.filter(job => now - job.timestamp > thresholdMs);
      
      if (orphanedJobs.length > 0) {
        console.warn(`⚠️ Cleaning up ${orphanedJobs.length} orphaned jobs in queue "${queueName}"`);
        let cleaned = 0;
        
        // Process in batches to avoid overwhelming Redis
        const batchSize = 10;
        for (let i = 0; i < orphanedJobs.length; i += batchSize) {
          const batch = orphanedJobs.slice(i, i + batchSize);
          const movePromises = batch.map(job => 
            Promise.race([
              job.moveToFailed(new Error('Job marked as orphaned due to excessive processing time'), true)
                .then(() => true)
                .catch(() => false),
              new Promise(resolve => setTimeout(() => resolve(false), 5000))
            ])
          );
          
          const results = await Promise.allSettled(movePromises);
          cleaned += results.filter(r => r.status === 'fulfilled' && r.value === true).length;
          
          // Pause between batches
          if (i + batchSize < orphanedJobs.length) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
        }
        
        if (cleaned > 0) {
          this.emit('orphanedJobsCleaned', { queue: queueName, count: cleaned });
        }
        return cleaned;
      }
      return 0;
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection') ||
          error.message.includes('timeout')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
      } else {
        console.error(`❌ Error cleaning orphaned jobs in "${queueName}":`, error.message);
        await ErrorHandler.handle(error);
      }
      return 0;
    }
  }
  
  async resetQueue(queueName) {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return false;
    }
    
    try {
      const queue = this.getQueue(queueName);
      if (!queue) return false;
      
      await Promise.race([
        queue.empty(),
        new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Queue empty timeout')), 10000))
      ]);
      
      await Promise.race([
        queue.clean(0, 'completed'),
        new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Queue clean completed timeout')), 10000))
      ]);
      
      await Promise.race([
        queue.clean(0, 'failed'),
        new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Queue clean failed timeout')), 10000))
      ]);
      
      const repeatableJobs = await Promise.race([
        queue.getRepeatableJobs(),
        new Promise((_, timeoutReject) => setTimeout(() => timeoutReject(new Error('Get repeatable jobs timeout')), 5000))
      ]);
      
      // Process in batches to avoid overwhelming Redis
      const batchSize = 10;
      for (let i = 0; i < repeatableJobs.length; i += batchSize) {
        const batch = repeatableJobs.slice(i, i + batchSize);
        const removePromises = batch.map(job => 
          Promise.race([
            queue.removeRepeatableByKey(job.key).catch(() => {}),
            new Promise(resolve => setTimeout(resolve, 5000))
          ])
        );
        
        await Promise.allSettled(removePromises);
        
        // Pause between batches
        if (i + batchSize < repeatableJobs.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      
      console.log(`🔄 Queue "${queueName}" has been reset`);
      this.emit('queueReset', { queue: queueName });
      return true;
    } catch (error) {
      if (error.message.includes('Redis') || 
          error.message.includes('ECONNREFUSED') || 
          error.message.includes('connection') ||
          error.message.includes('timeout')) {
        this.degraded = true;
        this.scheduleReconnect(this.calculateBackoff());
      } else {
        console.error(`❌ Error resetting queue "${queueName}":`, error.message);
        await ErrorHandler.handle(error);
      }
      return false;
    }
  }
  
  async resetAllQueues() {
    if (this.degraded) {
      const recovered = await this.tryRecoverFromDegradedState();
      if (!recovered) return false;
    }
    
    const results = [];
    for (const queueName of this.queues.keys()) {
      try {
        const result = await this.resetQueue(queueName);
        results.push({ queue: queueName, success: result });
      } catch (error) {
        console.error(`Error resetting queue "${queueName}":`, error.message);
        results.push({ queue: queueName, success: false, error: error.message });
        if (error.message.includes('Redis') || 
            error.message.includes('ECONNREFUSED') || 
            error.message.includes('connection') ||
            error.message.includes('timeout')) {
          this.degraded = true;
          this.scheduleReconnect(this.calculateBackoff());
          // Break the loop if we entered degraded state
          break;
        }
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
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    
    const closePromises = Array.from(this.queues.values()).map(async (queue) => {
      try {
        // Add timeouts to prevent hanging during shutdown
        await Promise.race([
          queue.pause(true).catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 5000))
        ]);
        
        await Promise.race([
          queue.close().catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 5000))
        ]);
        
        return true;
      } catch (error) {
        console.error(`Error closing queue:`, error.message);
        return false;
      }
    });
    
    await Promise.allSettled(closePromises);
    
    if (this.redisClient) {
      try {
        await Promise.race([
          this.redisClient.quit().catch(() => {}),
          new Promise(resolve => setTimeout(resolve, 5000))
        ]);
      } catch (error) {
        console.error('Error closing Redis client:', error.message);
      }
    }
    
    this.queues.clear();
    this.queueStats.clear();
    this.removeAllListeners();
    this.initialized = false;
    this.degraded = false;
    this.reconnectAttempts = 0;
    console.log('✅ QueueService cleaned up');
  }
  }
  
  export const queueService = new QueueService();