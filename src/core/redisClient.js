import { Redis } from 'ioredis';
import { config } from './config.js';

class RedisClient {
  constructor() {
    if (RedisClient.instance) {
      return RedisClient.instance;
    }

    this.initialized = false;
    this.initializing = false;
    this.connected = false;
    this.connectPromise = null;

    const redisHost = process.env.REDIS_HOST || 'redis';
    const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);
    const redisPassword = process.env.REDIS_PASSWORD || '';
    const redisDb = parseInt(process.env.REDIS_DB || '0', 10);

    // Base Redis configuration
    const baseConfig = {
      host: redisHost,
      port: redisPort,
      password: redisPassword,
      db: redisDb,
      retryStrategy: (times) => {
        if (times > 10) {
          console.error('Max Redis reconnection attempts reached. Giving up...');
          return null; // Stop retrying after 10 attempts
        }
        const delay = Math.min(times * 100, 5000);
        console.warn(`Redis connection lost. Reconnecting in ${delay}ms...`);
        return delay;
      },
      reconnectOnError: (err) => {
        console.error('Redis connection error:', err.message);
        return true; // Always attempt to reconnect
      },
      showFriendlyErrorStack: process.env.NODE_ENV !== 'production',
    };

    // Create the main Redis client with ready check enabled
    this.client = new Redis({
      ...baseConfig,
      enableReadyCheck: true,
      maxRetriesPerRequest: null,
      enableOfflineQueue: true, // Changed to true to allow command queuing when offline
      // Add connection retry strategy
      reconnectOnError: (err) => {
        console.error('Redis connection error:', err.message);
        // Always attempt to reconnect when offline
        return true;
      }
    });

    // Set up event listeners
    this.setupEventListeners();

    RedisClient.instance = this;
  }

  setupEventListeners() {
    this.client.on('connect', () => {
      console.log('🟢 Redis client connected');
      this.connected = true;
      this.initialized = true;
      this.initializing = false;
    });

    this.client.on('ready', () => {
      console.log('✅ Redis client ready');
      this.connected = true;
      this.initialized = true;
      this.initializing = false;
    });

    this.client.on('error', (err) => {
      console.error('🔴 Redis client error:', err);
    });

    this.client.on('end', () => {
      console.log('🔌 Redis client connection closed');
      this.connected = false;
      this.initialized = false;
    });

    this.client.on('reconnecting', () => {
      console.log('🔄 Redis client reconnecting...');
      this.connected = false;
    });
  }

  async initialize() {
    if (this.initialized) {
      return this.client;
    }

    if (this.initializing) {
      return new Promise((resolve) => {
        const checkInitialized = () => {
          if (this.initialized) {
            resolve(this.client);
          } else {
            setTimeout(checkInitialized, 100);
          }
        };
        checkInitialized();
      });
    }

    this.initializing = true;
    
    try {
      // ioredis connects automatically, just wait for ready event
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 10000); // 10 second timeout

        const onReady = () => {
          clearTimeout(timeout);
          this.client.off('error', onError);
          resolve();
        };

        const onError = (err) => {
          clearTimeout(timeout);
          this.client.off('ready', onReady);
          reject(err);
        };

        if (this.client.status === 'ready') {
          return resolve();
        }

        this.client.once('ready', onReady);
        this.client.once('error', onError);
      });

      return this.client;
    } catch (error) {
      this.initializing = false;
      console.error('❌ Failed to connect to Redis:', error);
      throw error;
    }
  }

  async getClient() {
    // Return a new client instance for Bull to use
    const client = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      // These options are not allowed for Bull clients
      // maxRetriesPerRequest: null,
      // enableReadyCheck: true,
      showFriendlyErrorStack: process.env.NODE_ENV !== 'production',
      retryStrategy: (times) => Math.min(times * 50, 2000),
      reconnectOnError: (err) => {
        console.error('Redis connection error in getClient:', err.message);
        return true; // Always attempt to reconnect
      }
    });

    // Wait for the client to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis client connection timeout'));
      }, 5000);

      const onReady = () => {
        clearTimeout(timeout);
        client.off('error', onError);
        resolve();
      };

      const onError = (err) => {
        clearTimeout(timeout);
        client.off('ready', onReady);
        reject(err);
      };

      if (client.status === 'ready') {
        return resolve();
      }

      client.once('ready', onReady);
      client.once('error', onError);
    });

    return client;
  }

  // Get a client for Bull to use
  getBullClient() {
    // Create a new client with Bull-compatible settings
    const client = new Redis({
      host: process.env.REDIS_HOST || 'redis',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      // Bull-compatible configuration
      enableReadyCheck: false,  // Must be false for Bull
      maxRetriesPerRequest: null,  // Must be null for Bull
      enableOfflineQueue: true,  // Changed to true to allow command queuing when offline
      showFriendlyErrorStack: process.env.NODE_ENV !== 'production',
      retryStrategy: (times) => Math.min(times * 50, 2000),
      reconnectOnError: (err) => {
        console.error('Redis client error in Bull client:', err.message);
        return true; // Always attempt to reconnect
      }
    });

    // Add error handler to prevent unhandled rejections
    client.on('error', (err) => {
      console.error('Bull Redis client error:', err);
    });

    return client;
  }

  // Get the shared client for non-Bull operations
  async getSharedClient() {
    if (!this.initialized && !this.initializing) {
      await this.initialize();
    } else if (this.initializing) {
      await this.connectPromise;
    }
    return this.client;
  }

  async close() {
    try {
      if (this.client) {
        await this.client.quit();
        this.connected = false;
        this.connectPromise = null;
        console.log('🔌 Redis client connection closed');
      }
    } catch (error) {
      console.error('Error closing Redis client:', error);
      throw error;
    }
  }
}

// Create a singleton instance
export const redisClient = new RedisClient();

// Handle process termination
const cleanup = async () => {
  try {
    await redisClient.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during cleanup:', error);
    process.exit(1);
  }
};

// Handle different termination signals
process.on('SIGTERM', cleanup);
process.on('SIGINT', cleanup);
process.on('SIGQUIT', cleanup);

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('Uncaught Exception:', error);
  await cleanup();
});

// Handle unhandled promise rejections
process.on('unhandledRejection', async (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  await cleanup();
});

export default redisClient;
