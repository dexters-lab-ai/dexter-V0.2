import { EventEmitter } from 'events';
import { TRADING_INTENTS } from './ai/intents.js';
import { ErrorHandler } from '../core/errors/index.js';
import { cleanupManager } from '../core/cleanup.js';

class AIMetricsService extends EventEmitter {
  constructor() {
    super();
    this.metrics = {
      intents: new Map(),
      openai: {
        totalTokens: 0,
        totalCost: 0,
        rateLimitHits: 0,
        responseTimes: [],
      },
      context: {
        totalSize: 0,
        cacheHits: 0,
        cacheMisses: 0,
        memoryUsage: 0,
      },
      users: new Map(),
      hourlyStats: new Map(),
      errors: new Map()
    };

    this.initialized = false;
    this.metricsInterval = null;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize metrics tracking
      this.initializeMetrics();
      
      // Start periodic metrics collection
      this.startMetricsCollection();

      this.initialized = true;
      console.log('✅ AIMetricsService initialized');
      return true;
    } catch (error) {
      console.error('❌ Error initializing AIMetricsService:', error);
      throw error;
    }
  }

  initializeMetrics() {
    // Initialize intent metrics
    Object.values(TRADING_INTENTS).forEach(intent => {
      this.metrics.intents.set(intent, {
        total: 0,
        success: 0,
        failed: 0,
        avgProcessingTime: 0,
        lastUsed: null
      });
    });
  }

  startMetricsCollection() {
    // Collect metrics every 5 minutes
    this.metricsInterval = setInterval(() => {
      this.saveMetricsSnapshot();
    }, 300000);
  }

  async recordIntent(intent, success, processingTime, userId) {
    try {
      const intentMetrics = this.metrics.intents.get(intent) || {
        total: 0,
        success: 0,
        failed: 0,
        avgProcessingTime: 0,
        lastUsed: null
      };

      // Update intent metrics
      intentMetrics.total++;
      if (success) {
        intentMetrics.success++;
      } else {
        intentMetrics.failed++;
      }

      // Update average processing time
      intentMetrics.avgProcessingTime = 
        (intentMetrics.avgProcessingTime * (intentMetrics.total - 1) + processingTime) / intentMetrics.total;
      intentMetrics.lastUsed = new Date();

      this.metrics.intents.set(intent, intentMetrics);

      // Update user metrics
      this.recordUserMetrics(userId, intent, success);

      // Emit metrics update
      this.emit('metricsUpdated', { type: 'intent', intent, metrics: intentMetrics });
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  recordUserMetrics(userId, intent, success) {
    if (!userId) return;

    const userMetrics = this.metrics.users.get(userId) || {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      intents: new Map(),
      lastActive: null
    };

    userMetrics.totalRequests++;
    if (success) {
      userMetrics.successfulRequests++;
    } else {
      userMetrics.failedRequests++;
    }

    const intentCount = userMetrics.intents.get(intent) || 0;
    userMetrics.intents.set(intent, intentCount + 1);
    userMetrics.lastActive = new Date();

    this.metrics.users.set(userId, userMetrics);
  }

  recordOpenAIUsage(tokens, cost, responseTime) {
    this.metrics.openai.totalTokens += tokens;
    this.metrics.openai.totalCost += cost;
    this.metrics.openai.responseTimes.push(responseTime);

    // Keep only last 1000 response times
    if (this.metrics.openai.responseTimes.length > 1000) {
      this.metrics.openai.responseTimes.shift();
    }
  }

  recordContextMetrics(contextSize, cacheHit) {
    this.metrics.context.totalSize += contextSize;
    if (cacheHit) {
      this.metrics.context.cacheHits++;
    } else {
      this.metrics.context.cacheMisses++;
    }
    this.metrics.context.memoryUsage = process.memoryUsage().heapUsed;
  }

  async saveMetricsSnapshot() {
    const hourKey = new Date().toISOString().slice(0, 13); // Group by hour
    const snapshot = {
      timestamp: new Date(),
      intents: Object.fromEntries(this.metrics.intents),
      openai: { ...this.metrics.openai },
      context: { ...this.metrics.context },
      users: this.metrics.users.size,
      errors: Object.fromEntries(this.metrics.errors)
    };

    this.metrics.hourlyStats.set(hourKey, snapshot);

    // Keep only last 24 hours
    const hours = Array.from(this.metrics.hourlyStats.keys()).sort();
    while (hours.length > 24) {
      this.metrics.hourlyStats.delete(hours.shift());
    }

    this.emit('snapshotSaved', snapshot);
  }

  async checkHealth() {
    try {
      const totalRequests = Array.from(this.metrics.intents.values())
        .reduce((sum, m) => sum + m.total, 0);

      const successRate = totalRequests > 0 
        ? (Array.from(this.metrics.intents.values())
            .reduce((sum, m) => sum + m.success, 0) / totalRequests) * 100
        : 100;

      const avgResponseTime = this.metrics.openai.responseTimes.length > 0
        ? this.metrics.openai.responseTimes.reduce((a, b) => a + b, 0) / 
          this.metrics.openai.responseTimes.length
        : 0;

      return {
        status: successRate > 90 ? 'healthy' : 'degraded',
        metrics: {
          totalRequests,
          successRate: `${successRate.toFixed(2)}%`,
          avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
          activeUsers: this.metrics.users.size,
          tokenUsage: this.metrics.openai.totalTokens,
          estimatedCost: `$${this.metrics.openai.totalCost.toFixed(2)}`,
          memoryUsage: `${(this.metrics.context.memoryUsage / 1024 / 1024).toFixed(2)}MB`
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async fetchLiveMetrics() {
    return {
      ...this.metrics,
      liveUpdate: new Date().toISOString()
    };
  }

  cleanup() {
    clearInterval(this.metricsInterval);
    this.metrics.intents.clear();
    this.metrics.users.clear();
    this.metrics.hourlyStats.clear();
    this.metrics.errors.clear();
    this.removeAllListeners();
    this.initialized = false;
    console.log('✅ AIMetricsService cleaned up');
  }
}

export const aiMetricsService = new AIMetricsService();

// Initialize service
aiMetricsService.initialize().catch(console.error);

// Register with cleanup manager
cleanupManager.registerService('aiMetrics', () => aiMetricsService.cleanup());