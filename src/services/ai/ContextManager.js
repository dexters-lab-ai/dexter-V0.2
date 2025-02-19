import { EventEmitter } from 'events';
import { ErrorHandler } from '../../core/errors/index.js';
import { db } from '../../core/database.js';

export class AIContextManager extends EventEmitter {
  constructor() {
    super();
    this.conversations = new Map(); // In-memory storage for active contexts
    this.contextCache = new Map(); // Cached summaries
    this.referenceMap = new Map(); // References for quick lookups
    this.maxMessagesForAI = 14; // Limit in-memory context to 10 messages for AI
    this.initialized = false; // Initialization flag
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      // Ensure database is connected
      await db.connect();
      
      // Get database instance
      const database = db.getDatabase();
      if (!database) {
        throw new Error('Database not initialized');
      }
  
      // Initialize collections
      this.contextCollection = database.collection('contexts');
      if (!this.contextCollection) {
        throw new Error('Failed to initialize context collection');
      }
  
      // Setup indexes
      await this.setupIndexes();
      
      this.initialized = true;
      console.log('✅ ContextManager initialized');
      return true;
    } catch (error) {
      console.error('❌ Error initializing ContextManager:', error);
      throw error;
    }
  }  

  async setupIndexes() {
    await this.contextCollection.createIndex({ userId: 1 });
    await this.contextCollection.createIndex({ updatedAt: 1 }, { expireAfterSeconds: 2592000 }); // 30 days
  }

  /**
   * Retrieve the last 15 messages for AI processing
   */
  async getContext(userId) {
    try {
      if (!this.initialized) await this.initialize();

      // Check in-memory cache
      let context = this.conversations.get(userId);

      if (!context) {
        // Restore full history from the database if not found in memory
        const fullHistory = await this.getFullHistoryFromDB(userId);
        this.conversations.set(userId, fullHistory);
        context = fullHistory;
      }

      // Return the last 10 messages for processing
      return context.slice(-this.maxMessagesForAI);
    } catch (error) {
      await ErrorHandler.handle(error);
      return [];
    }
  }

  /**
   * Retrieve full chat history from the database
   */
  async getFullHistoryFromDB(userId) {
    try {
      const savedContext = await this.contextCollection.findOne({ userId });
      return savedContext?.context || [];
    } catch (error) {
      await ErrorHandler.handle(error);
      return [];
    }
  }

  /**
   * Update the in-memory and database context
   */
  async updateContext(userId, message, response) {
    try {
      const context = await this.getContext(userId);

      // Format user message
      const userMessage = {
        role: 'user',
        content: this.cleanMessageContent(message.text),
        timestamp: new Date(),
        metadata: message.metadata || {},
      };

      // Format assistant response
      const assistantResponse = {
        role: 'assistant',
        content: this.cleanMessageContent(response),
        timestamp: new Date(),
      };

      // Add new messages to the in-memory context
      const updatedContext = [...context, userMessage, assistantResponse];

      // Update in-memory storage (limit to the last N messages)
      this.conversations.set(userId, updatedContext);

      // Append to the database (store the full conversation history)
      await this.appendToDatabase(userId, userMessage, assistantResponse);

      // Update cached summary
      await this.updateContextSummary(userId, updatedContext);

      this.emit('contextUpdated', { userId, context: updatedContext });
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  /**
   * Append new messages to the database
   */
  async appendToDatabase(userId, ...messages) {
    try {
      await this.contextCollection.updateOne(
        { userId },
        { 
          $push: { context: { $each: messages } }, // Append new messages
          $set: { updatedAt: new Date() },
        },
        { upsert: true } // Create document if it doesn't exist
      );
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  /**
   * Clean and validate message content
   */
  cleanMessageContent(message) {
    if (typeof message === 'object') {
      return message.transcription || JSON.stringify(message); // Handle voice transcriptions
    }
    if (typeof message === 'string') {
      return message.trim(); // Trim and sanitize strings
    }
    return ''; // Fallback for unsupported types
  }

  /**
   * Generate and cache a summary of the context
   */

  async updateContextSummary(userId, context) {
    //console.warn('context to update with: ', context)
    this.contextCache.set(userId, {
      context,
      timestamp: Date.now()
    });
  }

  /**
   * Cleanup old contexts and clear memory
   */
  async cleanup() {
    try {
      this.conversations.clear();
      this.contextCache.clear();
      this.referenceMap.clear();

      // Remove old contexts from the database
      const expiryDate = new Date();
      expiryDate.setMonth(expiryDate.getMonth() - 1);
      await this.contextCollection.deleteMany({ updatedAt: { $lt: expiryDate } });

      this.removeAllListeners();
      this.initialized = false;
      console.log('✅ AIContextManager cleaned up');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }
}

export const contextManager = new AIContextManager();