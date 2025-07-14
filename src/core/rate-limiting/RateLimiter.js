import { EventEmitter } from 'events';
import { db } from '../database.js';

export class RateLimiter extends EventEmitter {
  constructor(options = {}) {
    super();
    this.windowMs = options.windowMs || 300000; // Default window: 1 minute
    this.max = options.max || 5000; // Default max requests per window
    this.collection = null;
    this.logsCollection = null;
    this.isInitialized = false;
    this.requestCache = new Map(); // In-memory cache for faster checks
  }

  async initialize() {
    if (this.isInitialized) return;
  
    try {
      await db.connect();
      const database = db.getDatabase();
  
      // Create collections with validation schemas
      await database.createCollection('rateLimits', {
        validator: {
          $jsonSchema: {
            bsonType: "object",
            required: ["key", "requests"],
            properties: {
              key: {
                bsonType: "string",
                description: "Identifier for rate limiting"
              },
              requests: {
                bsonType: "array",
                items: {
                  bsonType: "object",
                  required: ["timestamp"],
                  properties: {
                    timestamp: { bsonType: "date" }
                  }
                }
              }
            }
          }
        }
      });

      await database.createCollection('rateLimitLogs', {
        validator: {
          $jsonSchema: {
            bsonType: "object",
            required: ["key", "timestamp", "action"],
            properties: {
              key: {
                bsonType: "string",
                description: "Identifier for the rate limit"
              },
              timestamp: {
                bsonType: "date",
                description: "When the action occurred"
              },
              action: {
                bsonType: "string",
                description: "Action taken (allow/deny)"
              }
            }
          }
        }
      });

      // Initialize collections
      this.collection = database.collection('rateLimits');
      this.logsCollection = database.collection('rateLimitLogs');
  
      // Check and recreate the index if needed
      await this.ensureIndex(this.collection, "requests.timestamp", { expireAfterSeconds: this.windowMs / 1000 });
      await this.ensureIndex(this.logsCollection, "timestamp", { expireAfterSeconds: 86400 }); // 24 hours
  
      this.isInitialized = true;
      console.log('✅ RateLimiter initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ RateLimiter initialization failed:', error);
      throw error;
    }
  }
  
  async ensureIndex(collection, field, options) {
    const indexes = await collection.indexes();
  
    const indexName = `${field}_1`;
    const existingIndex = indexes.find(idx => idx.name === indexName);
  
    if (existingIndex) {
      // Compare options, if they differ, drop and recreate the index
      if (existingIndex.expireAfterSeconds !== options.expireAfterSeconds) {
        console.log(`⚠️ Dropping existing index: ${indexName}`);
        await collection.dropIndex(indexName);
      } else {
        console.log(`✅ Index ${indexName} already exists with correct options`);
        return; // No need to recreate
      }
    }
  
    // Create the index with the specified options
    console.log(`🔧 Creating index: ${indexName}`);
    await collection.createIndex({ [field]: 1 }, options);
  }  

  async isRateLimited(userId, action) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const now = Date.now();
    const key = `${userId}:${action}`;

    try {
      // Check cache first
      const cached = this.requestCache.get(key);
      if (cached) {
        const validRequests = cached.requests.filter(time => now - time < this.windowMs);
        if (validRequests.length >= this.max) {
          return true;
        }
      }

      // Get or create document
      const result = await this.collection.findOneAndUpdate(
        { key },
        {
          $push: {
            requests: {
              $each: [{ timestamp: now }],
              $position: 0
            }
          }
        },
        { 
          upsert: true, 
          returnDocument: 'after',
          projection: { requests: 1 }
        }
      );

      if (!result.value || !result.value.requests) {
        // Initialize if no requests array
        await this.collection.updateOne(
          { key },
          { $set: { requests: [{ timestamp: now }] } },
          { upsert: true }
        );
        return false;
      }

      // Filter valid requests
      const validRequests = result.value.requests.filter(
        req => now - req.timestamp < this.windowMs
      );

      // Update cache
      this.requestCache.set(key, {
        requests: validRequests.map(req => req.timestamp),
        timestamp: now
      });

      // Update DB with filtered requests
      await this.collection.updateOne(
        { key },
        { $set: { requests: validRequests } }
      );

      // Log request
      await this.logsCollection.insertOne({
        userId,
        action,
        timestamp: now,
        limited: validRequests.length >= this.max
      });

      const isLimited = validRequests.length >= this.max;
      if (isLimited) {
        this.emit('limited', { userId, action, count: validRequests.length });
      }

      return isLimited;
    } catch (error) {
      console.error('Rate limit check error:', error);
      // Fail open on errors
      return false;
    }
  }

  async cleanup() {
    try {
      const now = Date.now();

      // Cleanup cache
      for (const [key, data] of this.requestCache.entries()) {
        if (now - data.timestamp > this.windowMs) {
          this.requestCache.delete(key);
        }
      }

      // Cleanup DB
      if (this.collection) {
        await this.collection.deleteMany({
          'requests.timestamp': { $lt: now - this.windowMs }
        });
      }

      console.log('✅ Rate limiter cleanup completed');
    } catch (error) {
      console.error('❌ Rate limiter cleanup error:', error);
    }
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();

// Run cleanup every 5 minutes
setInterval(() => rateLimiter.cleanup(), 3600000);