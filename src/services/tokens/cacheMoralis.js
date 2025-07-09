import CacheEntry from './cacheModel.js';
import { db } from '../../core/database.js';

class CacheManager {
  constructor() {
    this.cache = new Map();
    this.initialized = false;
    this.initPromise = this.initialize();
  }

  async initialize() {
    try {
      // ✅ Ensure database is connected before making queries
      await db.ready;
      console.log('📦 Initializing CacheManager...');

      const now = new Date();
      
      // ✅ Use retry logic to handle potential delays
      let retries = 3;
      while (retries > 0) {
        try {
          const entries = await CacheEntry.find({ expiresAt: { $gt: now } }).exec();
          entries.forEach((entry) => {
            this.cache.set(entry.key, { value: entry.value, expiresAt: entry.expiresAt });
          });
          this.initialized = true;
          console.log(`✅ CacheManager initialized with ${entries.length} entries.`);
          return;
        } catch (error) {
          console.error(`⚠️ Cache initialization failed. Retries left: ${retries - 1}`, error.message);
          retries--;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      console.warn('⚠️ CacheManager initialized with no entries (fallback mode).');
      this.initialized = true;
    } catch (error) {
      console.error('❌ Failed to initialize CacheManager:', error);
    }
  }

  async get(key) {
    if (!this.initialized) await this.initPromise;
    
    const cached = this.cache.get(key);
    if (cached) {
      if (cached.expiresAt > new Date()) {
        return cached.value;
      } else {
        this.cache.delete(key);
        await CacheEntry.deleteOne({ key });
      }
    }
    return null;
  }

  async set(key, value, ttlMilliseconds) {
    const expiresAt = new Date(Date.now() + ttlMilliseconds);
    this.cache.set(key, { value, expiresAt });
    try {
      await CacheEntry.findOneAndUpdate(
        { key },
        { value, expiresAt },
        { upsert: true, new: true }
      );
    } catch (error) {
      console.error('❌ Failed to set cache in database:', error);
    }
  }
}

const cacheManager = new CacheManager();
export default cacheManager;
