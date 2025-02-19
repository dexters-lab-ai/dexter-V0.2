import mongoose from 'mongoose';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { DB_POOL_SIZE, DB_IDLE_TIMEOUT, DB_CONNECT_TIMEOUT } from './constants.js';
import { config } from './config.js';
import { EventEmitter } from 'events';

class Database extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.database = null;
    this.isInitialized = false;
    this.initializationPromise = null;
    this.maxRetries = 5;
    this.retryDelay = 5000;
    
    // Internal ready state promise
    this.ready = new Promise((resolve, reject) => {
      this.once('connected', resolve);
      this.once('error', reject);
    });
  }

  async connect() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }
    this.initializationPromise = this._initialize();
    return this.initializationPromise;
  }

  async _initialize() {
    let retriesLeft = this.maxRetries;
    while (retriesLeft > 0) {
      try {
        console.log('🚀 Connecting to MongoDB Atlas...');

        // Mongoose connection options
        const mongooseOptions = {
          serverApi: ServerApiVersion.v1,
          maxPoolSize: DB_POOL_SIZE || 50,
          minPoolSize: 10,
          connectTimeoutMS: DB_CONNECT_TIMEOUT || 30000,
          socketTimeoutMS: 360000,
          serverSelectionTimeoutMS: 30000,
          heartbeatFrequencyMS: 10000,
          retryWrites: true,
          autoIndex: false,
          w: 'majority',
          bufferCommands: true, // ✅ FIXED: Allow buffering until connection is ready
        };

        // Connect with Mongoose
        await mongoose.connect(config.mongoUri, mongooseOptions);

        // Ensure Mongoose is fully connected
        await this._waitForMongooseConnection();

        // MongoClient connection options
        const mongoClientOptions = {
          serverApi: ServerApiVersion.v1,
          maxPoolSize: DB_POOL_SIZE || 50,
          connectTimeoutMS: DB_CONNECT_TIMEOUT || 30000,
          socketTimeoutMS: 360000,
          retryWrites: true,
          w: 'majority',
        };

        // Connect using the native MongoClient
        this.client = new MongoClient(config.mongoUri, mongoClientOptions);
        await this.client.connect();

        // Get database reference
        this.database = this.client.db(config.mongoDatabase || 'KATZdatabase1');

        // Test connections for both Mongoose and MongoClient
        await this._testConnections();

        this.isInitialized = true;
        this.emit('connected'); // ✅ FIXED: Now emits connected event
        console.log('✅ Successfully connected to MongoDB Atlas');
        return true;
      } catch (error) {
        console.warn(`❌ MongoDB connection failed. Retries left: ${retriesLeft - 1}`, error.message);
        retriesLeft--;
        if (retriesLeft === 0) {
          this.isInitialized = false;
          this.initializationPromise = null;
          this.emit('error', error);
          throw new Error('Failed to connect to MongoDB after all retries: ' + error.message);
        }
        console.log(`🔄 Retrying in ${this.retryDelay / 1000} seconds...`);
        await new Promise((resolve) => setTimeout(resolve, this.retryDelay));
      }
    }
  }

  async _waitForMongooseConnection() {
    return new Promise((resolve, reject) => {
      const checkReady = () => {
        if (mongoose.connection.readyState === 1) {
          console.log('✅ Mongoose is fully connected.');
          resolve();
        } else if (mongoose.connection.readyState === 2) {
          console.log('⏳ Mongoose is still connecting, waiting...');
          setTimeout(checkReady, 500);
        } else {
          reject(new Error('Mongoose failed to connect.'));
        }
      };
      checkReady();
    });
  }

  async _testConnections() {
    try {
      // Test Mongoose connection
      await mongoose.connection.db.command({ ping: 1 });

      // Test MongoClient connection
      const pingResult = await this.database.command({ ping: 1 });
      if (!pingResult.ok) {
        throw new Error('MongoClient ping failed.');
      }

      console.log('✅ Both Mongoose and MongoClient connections are healthy.');
    } catch (error) {
      throw new Error('Failed to verify database connections: ' + error.message);
    }
  }

  getDatabase() {
    if (!this.isInitialized || !this.database) {
      throw new Error('Database not initialized. Call connect() first.');
    }
    return this.database;
  }

  async disconnect() {
    try {
      if (this.client) {
        await this.client.close();
      }
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      this.isInitialized = false;
      this.initializationPromise = null;
      this.emit('disconnected');
      console.log('✅ Disconnected from MongoDB Atlas');
    } catch (error) {
      console.error('❌ Error during database disconnect:', error);
      throw error;
    }
  }

  async checkHealth() {
    try {
      if (mongoose.connection.readyState !== 1) {
        throw new Error('Mongoose connection is not ready');
      }
      const pingResult = await this.database.command({ ping: 1 });
      if (!pingResult.ok) {
        throw new Error('MongoClient ping failed');
      }
      console.log('✅ Database health check passed');
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        mongooseState: mongoose.connection.readyState,
        clientConnected: this.client.topology?.isConnected() || false,
      };
    } catch (error) {
      console.error('❌ Database health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

export const db = new Database();


// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`🛑 ${signal} received. Closing MongoDB connections...`);
  try {
    await db.disconnect();
  } catch (error) {
    console.error(error);
  }
  process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
