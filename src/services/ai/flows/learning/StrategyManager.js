import { EventEmitter } from 'events';
import { ErrorHandler } from '../../../../core/errors/index.js';
import { db } from '../../../../core/database.js';

export class StrategyManager extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.strategyCollection = null;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await db.connect();
      const database = db.getDatabase();
      
      this.strategyCollection = database.collection('strategies');
      
      await this.setupIndexes();
      this.initialized = true;
      console.log('✅ StrategyManager initialized');
    } catch (error) {
      console.error('❌ Error initializing StrategyManager:', error);
      throw error;
    }
  }

  async setupIndexes() {
    await this.strategyCollection.createIndex({ userId: 1 });
    await this.strategyCollection.createIndex({ name: 1 });
    await this.strategyCollection.createIndex({ 'performance.score': -1 });
  }

  async createStrategy(userId, config) {
    try {
      const name = await this.generateStrategyName(userId);
      
      const strategy = {
        userId,
        name,
        config,
        version: 1,
        performance: {
          trades: 0,
          winRate: 0,
          profitFactor: 0,
          score: 0
        },
        history: [],
        createdAt: new Date()
      };

      const result = await this.strategyCollection.insertOne(strategy);
      return { ...strategy, _id: result.insertedId };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async generateStrategyName(userId) {
    const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
    return `Strategy_${userId}_${timestamp}`;
  }  

  async updateStrategyPerformance(strategyId, performance) {
    try {
      const strategy = await this.strategyCollection.findOne({ _id: strategyId });
      
      const updatedPerformance = {
        trades: strategy.performance.trades + 1,
        winRate: this.calculateWinRate(strategy, performance),
        profitFactor: this.calculateProfitFactor(strategy, performance),
        score: this.calculateScore(strategy, performance)
      };

      await this.strategyCollection.updateOne(
        { _id: strategyId },
        {
          $set: { performance: updatedPerformance },
          $push: {
            history: {
              ...performance,
              timestamp: new Date()
            }
          }
        }
      );

      return updatedPerformance;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  calculateWinRate(strategy, performance) {
    const totalTrades = strategy.performance.trades + 1;
    const previousWins = strategy.performance.winRate * strategy.performance.trades / 100;
    const currentWin = performance.profit > 0 ? 1 : 0;
    return ((previousWins + currentWin) / totalTrades) * 100;
  }

  calculateProfitFactor(strategy, performance) {
    const previousPF = strategy.performance.profitFactor;
    const currentPF = performance.profit / Math.abs(performance.maxDrawdown);
    return (previousPF * strategy.performance.trades + currentPF) / (strategy.performance.trades + 1);
  }

  calculateScore(strategy, performance) {
    return (
      this.calculateWinRate(strategy, performance) * 0.3 +
      this.calculateProfitFactor(strategy, performance) * 0.4 +
      (performance.profit / performance.maxDrawdown) * 0.3
    );
  }

  async getTopStrategies(userId, limit = 4) {
    return this.strategyCollection
      .find({ userId })
      .sort({ 'performance.score': -1 })
      .limit(limit)
      .toArray();
  }

  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const strategyManager = new StrategyManager();