import { EventEmitter } from 'events';
import { db } from '../database.js';

export class RateLimiter extends EventEmitter {
  constructor(options = {}) {
    super();
    // More reasonable defaults:
    // 100 requests per hour
    this.windowMs = options.windowMs || 3600000; // 1 hour
    this.max = options.max || 100; // 100 requests per hour
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

      // Get or create document with proper structure
      // First check if the document exists
      const existing = await this.collection.findOne({ key });
      
      if (!existing) {
        // If it doesn't exist, create with proper initial structure
        const result = await this.collection.insertOne({
          key,
          requests: [{ timestamp: new Date(now) }]
        });
        return result;
      }
      
      // If it exists, just push the new request
      const result = await this.collection.findOneAndUpdate(
        { key },
        {
          $push: {
            requests: {
              $each: [{ timestamp: new Date(now) }],
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
        return false;
      }

      // Get valid requests within window
      const validRequests = result.value.requests.filter(
        req => now - req.timestamp < this.windowMs
      );

      // Update cache
      this.requestCache.set(key, {
        key,
        requests: validRequests
      });

      // Log the request
      await this.logsCollection.insertOne({
        key,
        timestamp: now,
        action: validRequests.length < this.max ? 'allow' : 'deny'
      });

      const isLimited = validRequests.length >= this.max;
      if (isLimited) {
        this.emit('limited', { userId, action, count: validRequests.length });
      }

      return isLimited;
    } catch (error) {
      console.error('❌ Rate limit check failed:', error);
      return false;
    }
  }

  async cleanup() {
    try {
      const now = Date.now();

      // Cleanup cache
      for (const [key, data] of this.requestCache.entries()) {
        const validRequests = data.requests.filter(time => now - time < this.windowMs);
        if (validRequests.length === 0) {
          this.requestCache.delete(key);
        } else {
          this.requestCache.set(key, {
            key,
            requests: validRequests
          });
        }
      }

      // Cleanup DB
      if (this.collection) {
        await this.collection.updateMany({}, {
          $pull: {
            requests: {
              timestamp: { $lt: now - this.windowMs }
            }
          }
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
setInterval(() => rateLimiter.cleanup(), 300000);