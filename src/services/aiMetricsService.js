// services/aiMetricsService.js
import { EventEmitter } from 'events';
import { ErrorHandler } from '../core/errors/index.js';
import { cleanupManager } from '../core/cleanup.js';

class AIMetricsService extends EventEmitter {
  constructor() {
    super();
    this.metrics = {
      // Existing AI metrics
      intents: new Map(),
      openai: {
        totalTokens: 0,
        totalCost: 0,
        rateLimitHits: 0,
        responseTimes: [],
        modelUsage: new Map() // Track per-model stats
      },
      context: {
        totalSize: 0,
        cacheHits: 0,
        cacheMisses: 0,
        memoryUsage: 0
      },
      users: new Map(),
      hourlyStats: new Map(),
      errors: new Map(),

      // New metrics
      messages: {
        total: 0,
        text: 0,
        audio: 0,
        responseTimes: []
      },
      functions: new Map(), // Track AI function usage
      wallets: [], // Track wallet health
      pumpFun: {}, // PumpFun service status
      priceAlerts: {
        totalAlerts: 0,
        activeAlerts: 0,
        executedAlerts: 0,
        failedAlerts: 0
      }
    };

    this.initialized = false;
    this.metricsInterval = null;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      this.initializeMetrics();
      this.startMetricsCollection();
      this.initialized = true;
      console.log('✅ AIMetricsService initialized');
      return true;
    } catch (error) {
      console.error('❌ Error initializing AIMetricsService:', error);
      throw error;
    }
  }

  // Track OpenAI model usage
  trackModelUsage(model, tokens, cost, responseTime) {
    const modelStats = this.metrics.openai.modelUsage.get(model) || {
      uses: 0,
      tokens: 0,
      cost: 0,
      avgResponseTime: 0
    };

    modelStats.uses++;
    modelStats.tokens += tokens;
    modelStats.cost += cost;
    modelStats.avgResponseTime = 
      (modelStats.avgResponseTime * (modelStats.uses - 1) + responseTime) / modelStats.uses;

    this.metrics.openai.modelUsage.set(model, modelStats);
    this.recordOpenAIUsage(tokens, cost, responseTime);
  }

  // Track message metrics
  trackMessageMetrics(type, responseTime) {
    this.metrics.messages[type]++;
    this.metrics.messages.total++;
    this.metrics.messages.responseTimes.push({
      timestamp: new Date(),
      duration: responseTime
    });

    // Keep only last 1000 response times
    if (this.metrics.messages.responseTimes.length > 1000) {
      this.metrics.messages.responseTimes.shift();
    }
  }

  // Track function calls
  trackFunctionCall(name, success, duration) {
    const stats = this.metrics.functions.get(name) || {
      calls: 0,
      successes: 0,
      failures: 0,
      avgDuration: 0,
      lastUsed: null
    };

    stats.calls++;
    if (success) stats.successes++;
    else stats.failures++;
    
    stats.avgDuration = 
      (stats.avgDuration * (stats.calls - 1) + duration) / stats.calls;
    stats.lastUsed = new Date();

    this.metrics.functions.set(name, stats);
  }

  // Update service statuses
  updateWalletHealth(walletStatus) {
    this.metrics.wallets = walletStatus;
  }

  updatePumpFunStatus(status) {
    this.metrics.pumpFun = status;
  }

  updatePriceAlerts(alerts) {
    this.metrics.priceAlerts = alerts;
  }

  // Enhanced existing methods
  recordUserActivity(userId, type = 'interaction') {
    const userMetrics = this.metrics.users.get(userId) || {
      totalInteractions: 0,
      messagesSent: 0,
      functionsUsed: new Set(),
      lastActive: null,
      sessionDuration: 0,
      sessionStart: new Date()
    };

    userMetrics.totalInteractions++;
    userMetrics.lastActive = new Date();
    
    if (type === 'message') userMetrics.messagesSent++;
    
    this.metrics.users.set(userId, userMetrics);
  }

  // Enhanced metrics snapshot
  async saveMetricsSnapshot() {
    const hourKey = new Date().toISOString().slice(0, 13);
    const snapshot = {
      timestamp: new Date(),
      intents: Object.fromEntries(this.metrics.intents),
      openai: {
        ...this.metrics.openai,
        modelUsage: Array.from(this.metrics.openai.modelUsage.entries())
      },
      messages: { ...this.metrics.messages },
      functions: Array.from(this.metrics.functions.entries()),
      context: { ...this.metrics.context },
      users: {
        total: this.metrics.users.size,
        active: Array.from(this.metrics.users.values())
          .filter(u => {
            const lastActive = new Date(u.lastActive);
            return (Date.now() - lastActive) < 24 * 60 * 60 * 1000;
          }).length
      },
      services: {
        wallets: this.metrics.wallets,
        pumpFun: this.metrics.pumpFun,
        priceAlerts: this.metrics.priceAlerts
      }
    };

    this.metrics.hourlyStats.set(hourKey, snapshot);

    // Keep only last 24 hours
    const hours = Array.from(this.metrics.hourlyStats.keys()).sort();
    while (hours.length > 24) {
      this.metrics.hourlyStats.delete(hours.shift());
    }

    this.emit('snapshotSaved', snapshot);
  }

  // Enhanced health check
  async checkHealth() {
    try {
      const totalRequests = Array.from(this.metrics.intents.values())
        .reduce((sum, m) => sum + m.total, 0);

      const successRate = totalRequests > 0 
        ? (Array.from(this.metrics.intents.values())
            .reduce((sum, m) => sum + m.success, 0) / totalRequests) * 100
        : 100;

      const avgResponseTime = this.metrics.messages.responseTimes.length > 0
        ? this.metrics.messages.responseTimes
            .reduce((sum, r) => sum + r.duration, 0) / 
          this.metrics.messages.responseTimes.length
        : 0;

      return {
        status: successRate > 90 ? 'healthy' : 'degraded',
        metrics: {
          totalRequests,
          successRate: `${successRate.toFixed(2)}%`,
          avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
          activeUsers: this.metrics.users.size,
          messageStats: {
            total: this.metrics.messages.total,
            text: this.metrics.messages.text,
            audio: this.metrics.messages.audio
          },
          openai: {
            tokenUsage: this.metrics.openai.totalTokens,
            estimatedCost: `$${this.metrics.openai.totalCost.toFixed(2)}`,
            models: Array.from(this.metrics.openai.modelUsage.entries())
          },
          functions: {
            total: this.metrics.functions.size,
            successRate: Array.from(this.metrics.functions.values())
              .reduce((acc, f) => acc + (f.successes / f.calls * 100), 0) / 
              this.metrics.functions.size
          },
          system: {
            memoryUsage: `${(this.metrics.context.memoryUsage / 1024 / 1024).toFixed(2)}MB`,
            uptime: process.uptime()
          }
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

  // Fetch live metrics
  async fetchLiveMetrics() {
    return {
      openai: {
        ...this.metrics.openai,
        modelUsage: Array.from(this.metrics.openai.modelUsage.entries())
      },
      messages: this.metrics.messages,
      functions: Array.from(this.metrics.functions.entries()),
      wallets: this.metrics.wallets,
      pumpFun: this.metrics.pumpFun,
      priceAlerts: this.metrics.priceAlerts,
      users: {
        total: this.metrics.users.size,
        active: Array.from(this.metrics.users.values())
          .filter(u => {
            const lastActive = new Date(u.lastActive);
            return (Date.now() - lastActive) < 24 * 60 * 60 * 1000;
          }).length
      },
      context: this.metrics.context,
      intents: Array.from(this.metrics.intents.entries()),
      hourlyStats: Array.from(this.metrics.hourlyStats.entries()),
      errors: Array.from(this.metrics.errors.entries()),
      liveUpdate: new Date().toISOString()
    };
  }

  cleanup() {
    clearInterval(this.metricsInterval);
    this.metrics.intents.clear();
    this.metrics.users.clear();
    this.metrics.hourlyStats.clear();
    this.metrics.errors.clear();
    this.metrics.functions.clear();
    this.metrics.openai.modelUsage.clear();
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
