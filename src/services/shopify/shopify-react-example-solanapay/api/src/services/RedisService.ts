import { Singleton } from "typescript-ioc";
import Redis, { RedisOptions } from 'ioredis';

@Singleton
export class RedisService {
  readonly redis: Redis;
  private isConnected: boolean = false;

  constructor() {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379', 10);
    const password = process.env.REDIS_PASSWORD || undefined;
    const db = parseInt(process.env.REDIS_DB || '0', 10);
    
    const redisOptions: RedisOptions = {
      host,
      port,
      password,
      db,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true; // Reconnect on read-only error
        }
        return false;
      },
      // Enable auto-pipelining for better performance
      enableAutoPipelining: true,
      // Add connection name for identification in Redis
      connectionName: process.env.REDIS_CONNECTION_NAME || 'katzlife-api',
    };

    this.redis = new Redis(redisOptions);

    // Handle connection events
    this.redis.on('connect', () => {
      this.isConnected = true;
      console.log('✅ Redis client connected');
    });

    this.redis.on('error', (error) => {
      this.isConnected = false;
      console.error('❌ Redis error:', error);
    });

    this.redis.on('reconnecting', () => {
      console.log('🔄 Redis client reconnecting...');
    });
  }

  // Helper method to check connection status
  async checkConnection(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      console.error('Redis connection check failed:', error);
      return false;
    }
  }

  // Graceful shutdown
  async disconnect(): Promise<void> {
    try {
      await this.redis.quit();
      console.log('Redis client disconnected');
    } catch (error) {
      console.error('Error disconnecting from Redis:', error);
    }
  }
}
