import { EventEmitter } from 'events';
import mongoose from 'mongoose'; // MongoDB for persistence
import { ErrorHandler } from '../core/errors/index.js';
import { cleanupManager } from '../core/cleanup.js';

// Define MongoDB Schema for persisting AI metrics
const metricsSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  metrics: { type: Object, required: true }
});

const MetricsModel = mongoose.model('AIMetrics', metricsSchema);

class AIMetricsService extends EventEmitter {
  constructor() {
    super();
    this.metrics = this.getInitialMetrics();
    this.initialized = false;
    this.metricsInterval = null;
  }

  /**
   * Returns initial metrics structure
   */
  getInitialMetrics() {
    return {
      intents: new Map(),
      openai: {
        totalTokens: 0,
        totalCost: 0,
        rateLimitHits: 0,
        responseTimes: [],
        modelUsage: new Map(),
      },
      context: {
        totalSize: 0,
        cacheHits: 0,
        cacheMisses: 0,
        memoryUsage: 0,
      },
      users: new Map(),
      hourlyStats: new Map(),
      errors: new Map(),
      functions: new Map(),
      messages: { total: 0, text: 0, audio: 0, responseTimes: [] },
      wallets: [],
      pumpFun: {},
      twitter: { service: "twitter", actors: [], healthy: false },
      kolMonitoring: { service: "kolMonitoring", healthy: false, handleCount: 0, details: [] },
      priceAlerts: { totalAlerts: 0, activeAlerts: 0, executedAlerts: 0, failedAlerts: 0 },
      tts: { totalCalls: 0, totalDuration: 0, modelUsage: new Map() },
      stt: { totalCalls: 0, totalDuration: 0, modelUsage: new Map() },
      models: new Map(),
    };
  }

  /**
   * Initializes the AIMetricsService
   */
  async initialize() {
    if (this.initialized) return;

    try {
      this.initialized = true;
      console.log('✅ AIMetricsService initialized');

      // Load persisted metrics from the database
      await this.loadMetricsFromDB();

      // Start periodic saving every 30 seconds
      this.metricsInterval = setInterval(() => this.saveMetricsSnapshot(), 30000);
      
    } catch (error) {
      console.error('❌ Error initializing AIMetricsService:', error);
      throw error;
    }
  }

  // ==============================
  // 🗂️ DATABASE PERSISTENCE METHODS
  // ==============================

  /**
   * Loads the latest metrics from the database on startup
   */
  async loadMetricsFromDB() {
    try {
      const latestMetrics = await MetricsModel.findOne().sort({ timestamp: -1 }).exec();
      if (latestMetrics && latestMetrics.metrics) {
        this.metrics = this.restoreMaps(latestMetrics.metrics);
        console.log('📊 Loaded AI Metrics from database.');
      }
    } catch (error) {
      console.error('❌ Error loading AI Metrics from DB:', error);
    }
  }

  /**
   * Saves a snapshot of metrics to the database every 30 seconds
   */
  async saveMetricsSnapshot() {
    try {
      await MetricsModel.findOneAndUpdate({}, { timestamp: new Date(), metrics: this.serializeMaps(this.metrics) }, { upsert: true });
      console.log('📊 AI Metrics snapshot saved.');
    } catch (error) {
      console.error('❌ Error saving AI Metrics:', error);
    }
  }

  /**
   * Converts Maps to Objects before saving to DB
   */
  serializeMaps(metrics) {
    return {
      ...metrics,
      intents: Object.fromEntries(metrics.intents),
      openai: { ...metrics.openai, modelUsage: Object.fromEntries(metrics.openai.modelUsage) },
      models: Object.fromEntries(metrics.models),
      users: Object.fromEntries(metrics.users),
      hourlyStats: Object.fromEntries(metrics.hourlyStats),
      errors: Object.fromEntries(metrics.errors),
      functions: Object.fromEntries(metrics.functions),
      context: metrics.context,
      twitter: metrics.twitter,
      kolMonitoring: metrics.kolMonitoring,
      tts: { ...metrics.tts, modelUsage: Object.fromEntries(metrics.tts.modelUsage) },
      stt: { ...metrics.stt, modelUsage: Object.fromEntries(metrics.stt.modelUsage) },
    };
  }
  
  /**
   * Converts Objects back to Maps after loading from DB
   */
  restoreMaps(metrics) {
    return {
      ...metrics,
      intents: new Map(Object.entries(metrics.intents || {})),
      openai: { 
        ...metrics.openai, 
        modelUsage: new Map(Object.entries(metrics.openai?.modelUsage || {}))
      },
      users: new Map(Object.entries(metrics.users || {})),
      hourlyStats: new Map(Object.entries(metrics.hourlyStats || {})),
      errors: new Map(Object.entries(metrics.errors || {})),
      functions: new Map(Object.entries(metrics.functions || {})),
      context: metrics.context,
      models: new Map(Object.entries(metrics.models || {})),
      twitter: metrics.twitter || { service: "twitter", actors: [], healthy: false },
      kolMonitoring: metrics.kolMonitoring || { service: "kolMonitoring", healthy: false, handleCount: 0, details: [] },
      tts: { ...metrics.tts, modelUsage: new Map(Object.entries(metrics.tts?.modelUsage || {})) },
      stt: { ...metrics.stt, modelUsage: new Map(Object.entries(metrics.stt?.modelUsage || {})) }
    };
  }
  
  // ==============================
  // 🔍 METRICS TRACKING METHODS
  // ==============================

  recordOpenAIUsage(tokens, cost, responseTime, model) {
    // Update global stats
    this.metrics.openai.totalTokens += tokens;
    this.metrics.openai.totalCost += cost;
    
    // Update per-model stats (or use the same code as trackModelUsage)
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
  
    // Update both maps
    this.metrics.openai.modelUsage.set(model, modelStats);
    this.metrics.models.set(model, modelStats);
  
    // Track response time
    this.metrics.openai.responseTimes.push({
      timestamp: new Date(),
      duration: responseTime
    });
  
    // Keep only last 1000 response times
    if (this.metrics.openai.responseTimes.length > 1000) {
      this.metrics.openai.responseTimes.shift();
    }
  
    console.log(`📊 OpenAI Usage Updated:
      Model: ${model}
      Tokens: ${tokens}
      Cost: $${cost.toFixed(4)}
      Response Time: ${responseTime}ms`);
  }  

  // Track context and memory of input to LLM
  trackContextMetrics(hit) {
    if (hit) {
      this.metrics.context.cacheHits++;
    } else {
      this.metrics.context.cacheMisses++;
    }
    this.metrics.context.memoryUsage = process.memoryUsage().heapUsed;
  }
  
  // Track TTS usage.
  // model: string, duration in ms, cost (if applicable)
  trackTTSUsage(model, duration, cost = 0) {
    this.metrics.tts.totalCalls++;
    this.metrics.tts.totalDuration += duration;
    const key = model.toLowerCase();
    if (!this.metrics.tts.modelUsage.has(key)) {
      this.metrics.tts.modelUsage.set(key, { calls: 0, totalDuration: 0, totalCost: 0 });
    }
    const usage = this.metrics.tts.modelUsage.get(key);
    usage.calls++;
    usage.totalDuration += duration;
    usage.totalCost += cost;
  }
  
  // Track STT usage.
  // model: string, duration in ms.
  trackSTTUsage(model, duration) {
    this.metrics.stt.totalCalls++;
    this.metrics.stt.totalDuration += duration;
    const key = model.toLowerCase();
    if (!this.metrics.stt.modelUsage.has(key)) {
      this.metrics.stt.modelUsage.set(key, { calls: 0, totalDuration: 0 });
    }
    const usage = this.metrics.stt.modelUsage.get(key);
    usage.calls++;
    usage.totalDuration += duration;
  }
  
  // Track message metrics (e.g. text vs audio and response times).
  trackMessageMetrics(type, duration) {
    this.metrics.messages.total++;
    if (type === 'audio') {
      this.metrics.messages.audio++;
    } else if (type === 'text') {
      this.metrics.messages.text++;
    }
    this.metrics.messages.responseTimes.push(duration);

    // Keep only last 1000 response times
    if (this.metrics.messages.responseTimes.length > 1000) {
      this.metrics.messages.responseTimes.shift();
    }
  }

  // Track OpenAI model usage
  trackModelUsage(model, tokens, cost, responseTime) {
    // Update per-model stats
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
  
    // Update both maps
    this.metrics.openai.modelUsage.set(model, modelStats);
    this.metrics.models.set(model, modelStats); // <-- now also update models
  
    // Update global stats
    this.metrics.openai.totalTokens += tokens;
    this.metrics.openai.totalCost += cost;
    this.metrics.openai.responseTimes.push({
      timestamp: new Date(),
      duration: responseTime
    });
  
    // Keep only last 1000 response times
    if (this.metrics.openai.responseTimes.length > 1000) {
      this.metrics.openai.responseTimes.shift();
    }
  
    // Emit metrics update event
    this.emit('metricsUpdated', this.metrics);
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
    this.emit('functionMetricsUpdated', { name, stats });
  }
  
  // Expose current metrics snapshot.
  fetchLiveMetrics() {
    return Promise.resolve(this.metrics);
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

  updateTwitterHealth(twitterData) {
    this.metrics.twitter = twitterData;
    console.log("📊 Updated Twitter Health Metrics:", twitterData);
    this.emit("metricsUpdated", this.metrics);
  }

  updateKOLMetrics(kolMetrics) {
    this.metrics.kolMonitoring = kolMetrics;
    console.log("📊 Updated KOL Monitoring Metrics:", kolMetrics);
    this.emit("metricsUpdated", this.metrics);
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

  // ==============================
  // 📡 DATA FETCHING METHODS
  // ==============================

  async fetchLiveMetrics() {
    const serializedMetrics = this.serializeMaps(this.metrics);
    
    // Convert functions, models, and users to arrays for proper rendering
    serializedMetrics.functions = Object.entries(serializedMetrics.functions || {});
    serializedMetrics.models = Object.entries(serializedMetrics.models || {});
    serializedMetrics.users = Object.entries(serializedMetrics.users || {});

    return serializedMetrics;
  }

  // ==============================
  // 🧹 CLEANUP & SERVICE MANAGEMENT
  // ==============================

  cleanup() {
    clearInterval(this.metricsInterval);
    this.metrics = this.getInitialMetrics();
    this.removeAllListeners();
    this.initialized = false;
    console.log('✅ AIMetricsService cleaned up');
  }
}

// Export the service
export const aiMetricsService = new AIMetricsService();

// Initialize service
aiMetricsService.initialize().catch(err => console.error('❌ Error initializing AI Metrics:', err));

// Register cleanup on exit
cleanupManager.registerService('aiMetrics', () => aiMetricsService.cleanup());
