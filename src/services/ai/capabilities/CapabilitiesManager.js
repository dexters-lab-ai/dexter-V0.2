import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import { ErrorHandler } from '../../../core/errors/index.js';
import { db } from '../../../core/database.js';
import { healthMonitor } from '../../../core/health/HealthMonitor.js';
import { User } from '../../../models/User.js';
import { braveSearch } from '../../brave/BraveSearchService.js';
import { demoManager } from './DemoManager.js';

export class CapabilitiesManager extends EventEmitter {
  constructor() {
    super();
    this.docsPath = path.resolve(process.cwd(), 'docs');
    this.capabilities = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Load capabilities from docs
      await this.loadCapabilities();
      
      // Initialize database connection
      await db.connect();
      
      this.initialized = true;
      console.log('✅ CapabilitiesManager initialized');
    } catch (error) {
      console.error('❌ Error initializing CapabilitiesManager:', error);
      throw error;
    }
  }

  async loadCapabilities() {
    try {
      // Read all markdown files from docs directory
      const files = await this.readDocsDirectory(this.docsPath);
      
      // Parse capabilities from docs
      for (const file of files) {
        const content = await fs.readFile(file, 'utf8');
        const capabilities = this.parseCapabilities(content);
        this.capabilities.set(path.basename(file, '.md'), capabilities);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async readDocsDirectory(dir) {
    const files = [];
    const items = await fs.readdir(dir, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        files.push(...await this.readDocsDirectory(fullPath));
      } else if (item.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
    
    return files;
  }

  parseCapabilities(content) {
    // Extract capabilities from markdown content
    const sections = content.split('\n## ');
    return sections.map(section => {
      const [title, ...details] = section.split('\n');
      return {
        title: title.trim(),
        details: details.join('\n').trim()
      };
    });
  }

  async listCapabilities() {
    const categories = Array.from(this.capabilities.entries());
    return categories.map(([category, capabilities]) => ({
      category,
      features: capabilities.map(c => c.title)
    }));
  }

  async getCapabilityDetails(category, capability) {
    const categoryData = this.capabilities.get(category);
    if (!categoryData) return null;
    
    return categoryData.find(c => 
      c.title.toLowerCase() === capability.toLowerCase()
    );
  }

async getSystemMetrics() {
  try {
    // Get core health metrics
    const healthStatus = await healthMonitor.checkHealth();
    
    // Get AI metrics
    const aiMetrics = await aiMetricsService.fetchLiveMetrics();

    // Get database metrics
    const dbMetrics = await db.checkHealth();

    // Get user metrics
    const userMetrics = await User.aggregate([
      {
        $group: {
          _id: null,
          totalUsers: { $sum: 1 },
          activeUsers: { 
            $sum: { 
              $cond: [
                { $gt: ["$lastActivity", new Date(Date.now() - 24*60*60*1000)] },
                1,
                0
              ]
            }
          },
          totalWallets: {
            $sum: {
              $add: [
                { $size: "$wallets.ethereum" },
                { $size: "$wallets.base" },
                { $size: "$wallets.solana" }
              ]
            }
          }
        }
      }
    ]);

    // Get trading metrics
    const tradingMetrics = await this.getTradingMetrics();

    // Get learning system metrics
    const learningMetrics = await this.getLearningMetrics();

    // Get WebSocket metrics
    const wsMetrics = await this.getWebSocketMetrics();

    return {
      status: healthStatus.status,
      timestamp: new Date(),
      
      // System Performance
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        loadAvg: os.loadavg()
      },

      // Service Health
      services: healthStatus.services,

      // AI Performance
      ai: {
        totalRequests: aiMetrics.totalRequests,
        successRate: aiMetrics.successRate,
        avgResponseTime: aiMetrics.avgResponseTime,
        activeUsers: aiMetrics.activeUsers,
        tokenUsage: aiMetrics.tokenUsage,
        estimatedCost: aiMetrics.estimatedCost,
        contextCacheHits: aiMetrics.context.cacheHits,
        contextCacheMisses: aiMetrics.context.cacheMisses
      },

      // Database Health
      database: {
        status: dbMetrics.status,
        connections: dbMetrics.connections,
        queryLatency: dbMetrics.queryLatency,
        cacheHitRate: dbMetrics.cacheHitRate
      },

      // User Statistics
      users: {
        total: userMetrics[0]?.totalUsers || 0,
        active24h: userMetrics[0]?.activeUsers || 0,
        totalWallets: userMetrics[0]?.totalWallets || 0
      },

      // Trading Performance
      trading: {
        totalTrades: tradingMetrics.totalTrades,
        successfulTrades: tradingMetrics.successfulTrades,
        failedTrades: tradingMetrics.failedTrades,
        avgExecutionTime: tradingMetrics.avgExecutionTime,
        activePositions: tradingMetrics.activePositions,
        pendingOrders: tradingMetrics.pendingOrders,
        activeAlerts: tradingMetrics.activeAlerts
      },

      // Learning System Performance
      learning: {
        patternsDetected: learningMetrics.patterns,
        strategiesOptimized: learningMetrics.strategies,
        userPreferencesUpdated: learningMetrics.preferences,
        kolPatternsAnalyzed: learningMetrics.kolPatterns
      },

      // WebSocket Stats
      websockets: {
        activeConnections: wsMetrics.activeConnections,
        messageRate: wsMetrics.messageRate,
        errorRate: wsMetrics.errorRate,
        avgLatency: wsMetrics.avgLatency
      }
    };
  } catch (error) {
    await ErrorHandler.handle(error);
    throw error;
  }
}

async getUserData(userId) {
    try {
        const user = await User.findOne({ telegramId: userId.toString() });
        if (!user) throw new Error('User not found');

        return {
        wallets: user.wallets,
        settings: user.settings,
        registeredAt: user.registeredAt,
        // Don't include sensitive data
        stats: {
            totalTrades: await this.getUserTradeCount(userId),
            activeAlerts: await this.getUserAlertCount(userId),
            monitoredKOLs: user.settings?.kol?.monitors?.length || 0
        }
        };
    } catch (error) {
        await ErrorHandler.handle(error);
        throw error;
    }
}

async performInternetSearch(query) {
    try {
        const results = await braveSearch.search(query);
        return this.formatSearchResults(results);
    } catch (error) {
        await ErrorHandler.handle(error);
        throw error;
    }
}

// Helper methods for metric collection
async getTradingMetrics() {
  try {
    const [trades, positions, orders, alerts] = await Promise.all([
      db.getDatabase().collection('trades').aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            successful: { 
              $sum: { $cond: [{ $gt: ["$profit", 0] }, 1, 0] }
            },
            failed: { 
              $sum: { $cond: [{ $lt: ["$profit", 0] }, 1, 0] }
            },
            avgExecutionTime: { $avg: "$executionTime" }
          }
        }
      ]).toArray(),
      flipperMode.getOpenPositions(),
      timedOrderService.getMetrics(),
      priceAlertService.getMetrics()
    ]);

    return {
      totalTrades: trades[0]?.total || 0,
      successfulTrades: trades[0]?.successful || 0,
      failedTrades: trades[0]?.failed || 0,
      avgExecutionTime: trades[0]?.avgExecutionTime || 0,
      activePositions: positions.length,
      pendingOrders: orders.pendingOrders,
      activeAlerts: alerts.activeAlerts
    };
  } catch (error) {
    console.error('Error getting trading metrics:', error);
    return {
      totalTrades: 0,
      successfulTrades: 0,
      failedTrades: 0,
      avgExecutionTime: 0,
      activePositions: 0,
      pendingOrders: 0,
      activeAlerts: 0
    };
  }
}

async getLearningMetrics() {
  try {
    const [patterns, strategies, preferences, kolPatterns] = await Promise.all([
      db.getDatabase().collection('patterns').countDocuments(),
      db.getDatabase().collection('strategies').countDocuments(),
      db.getDatabase().collection('userPreferences').countDocuments(),
      db.getDatabase().collection('kolPatterns').countDocuments()
    ]);

    return {
      patterns,
      strategies,
      preferences,
      kolPatterns
    };
  } catch (error) {
    console.error('Error getting learning metrics:', error);
    return {
      patterns: 0,
      strategies: 0,
      preferences: 0,
      kolPatterns: 0
    };
  }
}

async getWebSocketMetrics() {
  try {
    // Get metrics from WebSocket manager
    const metrics = wsManager.getMetrics();
    
    return {
      activeConnections: metrics.connections,
      messageRate: metrics.messageRate,
      errorRate: metrics.errorRate,
      avgLatency: metrics.latency
    };
  } catch (error) {
    console.error('Error getting WebSocket metrics:', error);
    return {
      activeConnections: 0,
      messageRate: 0,
      errorRate: 0,
      avgLatency: 0
    };
  }
}

  async showcaseCapability() {
    // Randomly select and demonstrate a capability
    const capabilities = await this.listCapabilities();
    const category = capabilities[Math.floor(Math.random() * capabilities.length)];
    const feature = category.features[Math.floor(Math.random() * category.features.length)];
    
    // Execute showcase
    return this.executeShowcase(category.category, feature);
  }

  async executeShowcase(category, feature) {
    switch (category) {
      case 'trading':
        return await this.showcaseTradingFeature(feature);
      case 'analysis':
        return await this.showcaseAnalysisFeature(feature);
      case 'social':
        return await this.showcaseSocialFeature(feature);
      default:
        throw new Error('Invalid capability category');
    }
  }

  // Helper methods
  async getUserTradeCount(userId) {
    try {
      // Get database instance
      const database = db.getDatabase();
  
      // Aggregate trades across collections
      const [trades, flipperTrades, timedTrades] = await Promise.all([
        // Regular trades
        database.collection('trades').countDocuments({
          userId: userId.toString()
        }),
  
        // FlipperMode trades
        database.collection('flipperTrades').countDocuments({
          userId: userId.toString()
        }),
  
        // Timed order trades
        database.collection('timedOrders').countDocuments({
          userId: userId.toString(),
          status: 'executed'
        })
      ]);
  
      // Return total count
      return trades + flipperTrades + timedTrades;
    } catch (error) {
      console.error('Error getting user trade count:', error);
      await ErrorHandler.handle(error);
      return 0; // Return 0 as fallback
    }
  }
  
  async getUserAlertCount(userId) {
    try {
      // Get database instance
      const database = db.getDatabase();
  
      // Get counts from different alert types
      const [priceAlerts, kolAlerts, customAlerts] = await Promise.all([
        // Price alerts
        database.collection('priceAlerts').countDocuments({
          userId: userId.toString(),
          isActive: true
        }),
  
        // KOL monitoring alerts
        database.collection('kolMonitors').countDocuments({
          userId: userId.toString(),
          enabled: true
        }),
  
        // Custom alerts
        database.collection('customAlerts').countDocuments({
          userId: userId.toString(),
          isActive: true
        })
      ]);
  
      // Return total active alerts
      return priceAlerts + kolAlerts + customAlerts;
    } catch (error) {
      console.error('Error getting user alert count:', error);
      await ErrorHandler.handle(error);
      return 0; // Return 0 as fallback
    }
  }

  formatSearchResults(results) {
    return {
      count: results.length,
      results: results.map(r => ({
        title: r.title,
        description: r.description,
        url: r.url
      }))
    };
  }

  cleanup() {
    this.capabilities.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const capabilitiesManager = new CapabilitiesManager();