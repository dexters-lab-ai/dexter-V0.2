import { EventEmitter } from 'events';
import { twitterService } from '../../../twitter/index.js';
import { ErrorHandler } from '../../../../core/errors/index.js';
import { db } from '../../../../core/database.js';

export class KOLLearningSystem extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.kolCollection = null;
    this.patternCollection = null;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await db.connect();
      const database = db.getDatabase();
      
      this.kolCollection = database.collection('kolData');
      this.patternCollection = database.collection('kolPatterns');
      
      await this.setupIndexes();
      this.initialized = true;
      console.log('✅ KOLLearningSystem initialized');
    } catch (error) {
      console.error('❌ Error initializing KOLLearningSystem:', error);
      throw error;
    }
  }

  async setupIndexes() {
    await this.kolCollection.createIndex({ handle: 1 });
    await this.kolCollection.createIndex({ 'performance.score': -1 });
    await this.patternCollection.createIndex({ kolId: 1 });
  }

  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const kolLearningSystem = new KOLLearningSystem();