import { EventEmitter } from 'events';
import PQueue from 'p-queue';
import { wsManager } from './WebSocketManager.js';
import { monitoringSystem } from '../../core/monitoring/Monitor.js';
import { circuitBreakers, BREAKER_CONFIGS } from '../../core/circuit-breaker/index.js';
import { User } from '../../models/User.js';
import { tokenInfoService } from '../tokens/TokenInfoService.js';
import { walletService } from '../../services/wallet/index.js';
import { transactionQueue } from '../queue/TransactionQueue.js';
import { db } from '../../core/database.js';
import { tokenLaunchDetector } from './detection/TokenLaunchDetector.js';
import { solanaTradeOptimizer } from '../trading/optimizers/SolanaTradeOptimizer.js';
import { enhancedQueue } from '../queue/enhanced/EnhancedTransactionQueue.js';
import { EnhancedPositionMonitor } from '../../services/queue/enhanced/PositionMonitor.js';
import { errorRecoverySystem } from '../errors/ErrorRecoverySystem.js';
import { kolLearningSystem } from '../ai/flows/learning/KOLLearningSystem.js';
import { strategyManager } from '../ai/flows/learning/StrategyManager.js';

/**
 * FlipperMode
 * 
 * The major changes from your original version:
 * 1) We add two new methods: enable(...) and disable(...),
 *    which simply wrap your existing start(...) and stop(...).
 * 2) Optionally accept a walletAddress param or auto-detect from user
 *    so that `this.walletAddress` is set (the PumpFun command code
 *    calls "enable(user)" but doesn't pass a wallet address).
 */
class FlipperMode extends EventEmitter {
  constructor() {
    super();

    this.openPositions = new Map();
    this.positionStats = new Map();
    this.blacklistedTokens = new Set();
    this.priceWebsockets = new Map();

    this.userMetricsCollection = null;
    this.systemMetricsCollection = null;

    this.tokenQueue = new PQueue({ concurrency: 1, interval: 500, intervalCap: 1 });
    this.transactionQueue = enhancedQueue;
    this.positionMonitor = new EnhancedPositionMonitor();
    this.errorRecovery = errorRecoverySystem;

    this.config = {
      minLiquidity: 5,
      minHolders: 100,
      maxPositions: 3,
      profitTarget: 30,
      stopLoss: 15,
      timeLimit: 15 * 60 * 1000,
      gasBuffer: 0.01,
      buyAmount: 0.1,
    };

    this.kolLearning = kolLearningSystem;
    this.strategyManager = strategyManager;

    this.activeStrategies = new Map();
    this.strategyPerformance = new Map();

    this.isRunning = false;
    this.userId = null;
    this.walletAddress = null;
    this.initialized = false;
  }

  // -------------------------------------------
  // NEW: Simple "enable/disable" to match your PumpFun usage
  // -------------------------------------------
  /**
   * Called from PumpFunCommand: flipperMode.enable(user)
   * Optionally pass `walletAddress` or set it from user doc.
   */
  async enable(user, customConfig = {}) {
    if (!user) throw new Error("No user object provided to enable FlipperMode.");

    // If you store the Solana wallet address in user data, extract it here:
    // e.g. user.wallets.solana.find(...) or user.defaultSolanaWallet, etc.
    const solanaWallet = user.wallets?.solana?.find((w) => w.isAutonomous);
    if (!solanaWallet) throw new Error("No autonomous Solana wallet found in user data.");

    this.walletAddress = solanaWallet.address;
    // Start the mode with userId, no chatId needed, pass config
    return this.start(user.telegramId, null, customConfig);
  }

  /**
   * Called from PumpFunCommand: flipperMode.disable(user, bot)
   */
  async disable(user, bot) {
    if (!user) throw new Error("No user provided to disable FlipperMode.");
    return this.stop(bot, user.telegramId);
  }
  // -------------------------------------------
  // END: Simple enable/disable
  // -------------------------------------------

  async initialize() {
    if (this.initialized) return;
    try {
      const database = db.getDatabase();
      if (!database) throw new Error('Database connection is not established.');
      this.userMetricsCollection = database.collection('userMetrics');
      this.systemMetricsCollection = database.collection('systemMetrics');
      this.errorRecovery.on('recovered', async ({ type }) => {
        if (type === 'WEBSOCKET_DISCONNECT') await this.reconnectPriceFeeds();
      });
      monitoringSystem.registerComponent('flipperMode', {
        getMetrics: this.collectMetrics.bind(this),
        getHealth: () => ({ status: this.isRunning ? 'healthy' : 'stopped' }),
      });
      await this.countDocumentsWithTimeout(this.userMetricsCollection);
      await this.countDocumentsWithTimeout(this.systemMetricsCollection);
      this.snapshotSystemMetrics();
      this.initialized = true;
      console.log('🟢 FlipperMode initialized successfully.');
    } catch (error) {
      console.error('Error during FlipperMode initialization:', error);
      throw error;
    }
  }

  async countDocumentsWithTimeout(collection, retries = 3, timeoutMS = 30000) {
    try {
      const result = await collection.countDocuments({}, { maxTimeMS: timeoutMS });
      console.log(`🚰 Document count for ${collection.collectionName}:`, result);
      return result;
    } catch (error) {
      console.error(`Error counting documents in ${collection.collectionName}:`, error);
      if (retries > 0 && error.code === 50) {
        console.log('Retrying document count...');
        await this.delay(1000);
        return this.countDocumentsWithTimeout(collection, retries - 1, timeoutMS);
      }
      throw new Error(`Failed to count documents: ${error.message}`);
    }
  }
  delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  snapshotSystemMetrics() {
    setInterval(async () => {
      if (!this.systemMetricsCollection) return;
      try {
        const aggregatedMetrics = await this.systemMetricsCollection
          .aggregate([
            {
              $group: {
                _id: null,
                totalTrades: { $sum: '$totalTrades' },
                totalProfit: { $sum: '$totalProfit' },
                profitableTrades: { $sum: '$profitableTrades' },
              },
            },
          ])
          .toArray();
        const snap = {
          timestamp: new Date(),
          totalTrades: aggregatedMetrics[0]?.totalTrades || 0,
          totalProfit: aggregatedMetrics[0]?.totalProfit || 0,
          profitableTrades: aggregatedMetrics[0]?.profitableTrades || 0,
        };
        await db.getDatabase().collection('systemMetricsSnapshots').insertOne(snap);
        console.log('System metrics snapshot saved.');
      } catch (error) {
        console.error('Error saving system metrics snapshot:', error);
      }
    }, 600000);
  }

  // --------------------------------
  // Start/Stop
  // --------------------------------
  async start(userId, chatId = null, customConfig = {}) {
    if (!this.initialized) throw new Error('FlipperMode must be initialized first.');
    return circuitBreakers.executeWithBreaker('pumpfun', async () => {
      if (this.isRunning) throw new Error('FlipperMode is already running.');

      try {
        const strategy = await this.strategyManager.createStrategy(userId, {
          ...this.config,
          ...customConfig,
        });
        this.activeStrategies.set(userId, strategy);
        this.strategyPerformance.set(userId, {
          strategyId: strategy._id,
          startTime: Date.now(),
          trades: 0,
          profit: 0,
        });

        console.log('Starting FlipperMode...');
        const wallet = await walletService.getWallet(userId, this.walletAddress);
        if (!wallet) throw new Error('Wallet not found. Please ensure the wallet address is correct.');

        const balance = await walletService.getBalance(userId, this.walletAddress);
        const needed = this.config.maxPositions * (this.config.buyAmount + this.config.gasBuffer);
        if (balance < needed) {
          throw new Error(`Insufficient balance. Need at least ${needed} SOL.`);
        }

        // If using walletconnect, confirm autonomous is enabled
        if (wallet.type === 'walletconnect') {
          const user = await User.findOne({ telegramId: userId.toString() }).lean();
          if (!user?.settings?.trading?.autonomousEnabled) {
            throw new Error('Autonomous trading is disabled. Enable in wallet settings.');
          }
        }

        this.config = { ...this.config, ...customConfig };
        this.userId = userId;
        this.isRunning = true;
        await this.setupPriceMonitoring();

        this.emit('started', {
          userId,
          walletAddress: this.walletAddress,
          config: this.config,
          wallet: wallet.type,
        });
        console.log('FlipperMode started successfully.');
        return { action: 'start', config: this.config };
      } catch (err) {
        console.error('Error starting FlipperMode:', err);
        this.cleanup();
        throw err;
      }
    }, BREAKER_CONFIGS.pumpfun);
  }

  async stop(bot, userId) {
    return circuitBreakers.executeWithBreaker('pumpfun', async () => {
      if (!this.isRunning) return;
      try {
        this.tokenQueue.clear();
        const closePromises = Array.from(this.openPositions.values()).map(async (pos) => {
          try {
            await this.closePosition(pos.token.address, 'manual_stop');
          } catch (error) {
            const msg = `🚨 *Trade Closure Failed*\nToken: ${pos.token.name} (${pos.token.address})\nReason: ${error.message || 'Unknown'}`;
            console.error(`Failed to close position for ${pos.token.name}:`, error);
            if (bot && userId) {
              try {
                await bot.sendMessage(userId, msg, { parse_mode: 'Markdown' });
              } catch (botError) {
                console.error('Failed sending notification:', botError);
              }
            }
            // Log error
            await ErrorHandler.handle(error, bot, userId);
          }
        });

        await Promise.allSettled(closePromises);
        const stats = this.calculateStats();
        this.cleanup();
        this.emit('stopped', { stats });
        return { action: 'stop', stats };
      } catch (error) {
        await ErrorHandler.handle(error, bot, userId);
        console.error('Error stopping FlipperMode:', error);
        this.cleanup();
        this.emit('error', error);
      }
    }, BREAKER_CONFIGS.pumpfun);
  }

  // ---------------------------
  // Price Monitoring & Metrics
  // ---------------------------
  async setupPriceMonitoring() {
    try {
      const positions = Array.from(this.openPositions.values());
      for (const position of positions) {
        const subscription = await tokenInfoService.subscribeToPriceUpdates(
          position.token.network || 'solana',
          position.token.address,
          (price) => this.updatePosition(position.token.address, price)
        );
        this.priceWebsockets.set(position.token.address, subscription);
        await this.positionMonitor.setupRedundantPriceFeeds({
          address: position.token.address,
          ...position.token
        });
      }
      this.positionMonitor.on('priceUpdate', ({ tokenAddress, price }) => {
        if (!this.priceWebsockets.get(tokenAddress)?.isActive) {
          this.updatePosition(tokenAddress, price);
        }
      });
      console.log('✅ Price monitoring setup complete');
    } catch (error) {
      console.error('Error setting up price monitoring:', error);
      throw error;
    }
  }

  async saveLiveSystemMetrics() {
    try {
      const queueSize = this.tokenQueue.size;
      const baseInterval = 500;
      const additionalDelay = queueSize * 50;
      this.tokenQueue.interval = Math.min(baseInterval + additionalDelay, 2000);
      console.log(`Adjusted PQueue interval: ${this.tokenQueue.interval}ms for queue size: ${queueSize}`);

      const liveMetrics = {
        activePositions: this.openPositions.size,
        openTokens: Array.from(this.openPositions.keys()),
        lastUpdated: new Date()
      };

      await this.systemMetricsCollection.updateOne(
        { _id: 'live' },
        { $set: liveMetrics },
        { upsert: true }
      );
      console.log('Live system metrics saved successfully.');
    } catch (error) {
      console.error('Error saving live system metrics:', error);
    }
  }



  // ---------------------------
  // Token Processing & Trading
  // ---------------------------
  async processNewToken(token) {
    try {
      const isValid = await tokenLaunchDetector.validateToken(token);
      if (!isValid) return;

      const preparedTrade = await solanaTradeOptimizer.prepareTrade({
        network: 'solana',
        action: 'buy',
        tokenAddress: token.address,
        amount: this.config.buyAmount,
        walletAddress: this.walletAddress,
        userId: this.userId
      });

      const result = await this.transactionQueue.addTransaction(preparedTrade, 'high');
      if (result.success) {
        await this.positionMonitor.setupRedundantPriceFeeds({ address: token.address, ...token });
        this.openPositions.set(token.address, {
          token,
          entryPrice: result.price,
          amount: result.amount,
          entryTime: Date.now(),
          txHash: result.hash
        });
      }
    } catch (error) {
      await this.errorRecovery.handleError(error, { operation: 'processNewToken', token });
    }
  }

  shouldProcessToken(token) {
    return this.isRunning &&
      token.network === 'solana' &&
      token.liquidity >= this.config.minLiquidity &&
      token.holders >= this.config.minHolders &&
      !this.openPositions.has(token.address) &&
      this.openPositions.size < this.config.maxPositions &&
      !this.blacklistedTokens.has(token.address);
  }

  async monitorPosition(position) {
    return circuitBreakers.executeWithBreaker(
      'pumpfun',
      async () => {
        try {
          const [primaryFeed, backupOracle] = await Promise.all([
            this.positionMonitor.setupRedundantPriceFeeds({ address: position.token.address, ...position.token })
          ]);

          this.positionMonitor.on('priceUpdate', async ({ tokenAddress, price }) => {
            const oraclePrice = await backupOracle.getPrice();
            const priceDiff = Math.abs(price - oraclePrice) / price;
            const finalPrice = priceDiff > 0.01 ? oraclePrice : price;
            await this.updatePosition(tokenAddress, finalPrice);
          });

          this.positionMonitor.on('update', ({ token, metrics }) => {
            if (token === position.token.address) {
              this.handleMetricsUpdate(token, {
                price: metrics.price,
                volume: metrics.volume,
                liquidity: metrics.liquidity,
                holders: metrics.holders,
                timestamp: Date.now()
              });
            }
          });

          this.positionMonitor.on('error', async (error) => {
            await this.errorRecovery.handleError(error, { operation: 'monitorPosition', position, component: 'priceMonitor' });
          });

          const timeoutId = setTimeout(() => {
            this.closePosition(position.token.address, 'timeout')
              .catch(error => this.handleError(error, { operation: 'closePosition', reason: 'timeout', position }));
          }, this.config.timeLimit);

          this.openPositions.set(position.token.address, {
            ...position,
            priceFeeds,
            timeoutId,
            monitoringStarted: Date.now()
          });

          this.positionStats.set(position.token.address, {
            entryTime: position.entryTime,
            entryPrice: position.entryPrice,
            highPrice: position.entryPrice,
            lowPrice: position.entryPrice,
            updates: 0,
            volume: 0,
            liquidity: 0,
            lastUpdate: Date.now()
          });

          const snapshotInterval = setInterval(() => {
            this.saveLiveSystemMetrics().catch(console.error);
          }, 60000);

          this.once(`positionClosed_${position.token.address}`, () => {
            clearInterval(snapshotInterval);
            clearTimeout(timeoutId);
            priceFeeds.forEach(feed => feed.close?.());
          });
        } catch (error) {
          await this.handleError(error, { operation: 'monitorPosition', position });
          await this.errorRecovery.handleError(error, { component: 'FlipperMode', operation: 'monitorPosition', position, userId: this.userId });
        }
      },
      BREAKER_CONFIGS.pumpfun
    );
  }

  // ---------------------------
  // Fetch Metrics for Dashboard
  // ---------------------------
  async fetchMetrics() {
    try {
      if (!this.userMetricsCollection || !this.systemMetricsCollection) {
        throw new Error('Metrics collections are not initialized.');
      }
      const userMetrics = await this.userMetricsCollection.find({}).toArray();
      const systemMetrics = await this.systemMetricsCollection.findOne({ _id: 'global' });
      const liveMetrics = {
        activePositions: this.openPositions.size || 0,
        tokensBeingTracked: Array.from(this.openPositions.keys()) || [],
        lastSnapshot: systemMetrics?.lastUpdated || new Date(),
      };
      const aggregatedSystemMetrics = {
        totalTrades: systemMetrics?.totalTrades || 0,
        totalProfit: systemMetrics?.totalProfit || 0,
        profitableTrades: systemMetrics?.profitableTrades || 0,
        averageHoldTime: systemMetrics?.totalHoldTime ? (systemMetrics.totalHoldTime / systemMetrics.totalTrades).toFixed(2) : 0,
        winRate: systemMetrics?.totalTrades ? ((systemMetrics.profitableTrades / systemMetrics.totalTrades) * 100).toFixed(2) : 0,
        lastUpdated: systemMetrics?.lastUpdated || new Date(),
      };
      const userLevelMetrics = (userMetrics || []).map((userMetric) => ({
        userId: userMetric.userId,
        totalTrades: userMetric.totalTrades || 0,
        profitableTrades: userMetric.profitableTrades || 0,
        totalProfit: userMetric.totalProfit || 0,
        averageHoldTime: userMetric.avgHoldTime || 0,
        winRate: userMetric.totalTrades ? ((userMetric.profitableTrades / userMetric.totalTrades) * 100).toFixed(2) : 0,
        lastUpdated: userMetric.lastUpdated || new Date(),
      }));
      const combinedMetrics = {
        systemMetrics: aggregatedSystemMetrics,
        liveMetrics,
        userMetrics: userLevelMetrics,
      };
      console.log('Fetched metrics successfully:', combinedMetrics);
      return combinedMetrics;
    } catch (error) {
      console.error('Error fetching metrics:', error);
      throw new Error('Failed to fetch metrics. Please check the collections or database connection.');
    }
  }

  // ---------------------------
  // Handle Metrics Update
  // ---------------------------
  async handleMetricsUpdate(tokenAddress, metrics) {
    const position = this.openPositions.get(tokenAddress);
    if (!position) return;
    try {
      const stats = this.positionStats.get(tokenAddress) || {
        entryTime: position.entryTime,
        entryPrice: position.entryPrice,
        highPrice: position.entryPrice,
        lowPrice: position.entryPrice,
        updates: 0,
        volume: 0,
        liquidity: 0
      };

      stats.currentPrice = metrics.price;
      stats.highPrice = Math.max(stats.highPrice, metrics.price);
      stats.lowPrice = Math.min(stats.lowPrice, metrics.price);
      stats.volume = metrics.volume;
      stats.liquidity = metrics.liquidity;
      stats.updates++;
      this.positionStats.set(tokenAddress, stats);
      this.emit('metricsUpdate', { token: tokenAddress, stats });
    } catch (error) {
      await ErrorHandler.handle(error);
      this.emit('error', error);
    }
  }

  // ---------------------------
  // Reconnect Price Feeds
  // ---------------------------
  async reconnectPriceFeeds() {
    for (const [tokenAddress] of this.openPositions) {
      await this.positionMonitor.setupRedundantPriceFeeds({ address: tokenAddress });
    }
  }

  // ---------------------------
  // Handle Errors
  // ---------------------------
  async handleError(error, context) {
    try {
      await this.errorRecovery.handleError(error, { ...context, component: 'FlipperMode', userId: this.userId });
    } catch (recoveryError) {
      console.error('Error recovery failed:', recoveryError);
      await this.stop(null, this.userId);
    }
  }

  // ---------------------------
  // Update Position
  // ---------------------------
  async updatePosition(tokenAddress, currentPrice) {
    return circuitBreakers.executeWithBreaker(
      'pumpfun',
      async () => {
        const position = this.openPositions.get(tokenAddress);
        if (!position) return;
        try {
          const stats = this.positionStats.get(tokenAddress) || {
            entryTime: position.entryTime,
            entryPrice: position.entryPrice,
            highPrice: position.entryPrice,
            lowPrice: position.entryPrice,
            updates: 0
          };

          stats.currentPrice = currentPrice;
          stats.highPrice = Math.max(stats.highPrice, currentPrice);
          stats.lowPrice = Math.min(stats.lowPrice, currentPrice);
          stats.updates++;
          this.positionStats.set(tokenAddress, stats);

          const profitLoss = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;
          if (profitLoss >= this.config.profitTarget) {
            await this.closePosition(tokenAddress, 'take_profit');
          } else if (profitLoss <= -this.config.stopLoss) {
            await this.closePosition(tokenAddress, 'stop_loss');
          }
        } catch (error) {
          await ErrorHandler.handle(error, null, this.userId);
          console.warn('Error updating position:', error);
          this.emit('error', error);
        }
      },
      BREAKER_CONFIGS.pumpfun
    );
  }

  async closePosition(tokenAddress, reason = 'manual') {
    return circuitBreakers.executeWithBreaker(
      'pumpfun',
      async () => {
        const position = this.openPositions.get(tokenAddress);
        if (!position) return;
        try {
          const wallet = await walletService.getWallet(this.userId, this.walletAddress);
          if (wallet.type === 'walletconnect' && !position.preApproved) {
            const approvalStatus = await walletService.checkAndRequestApproval(tokenAddress, this.walletAddress, position.amount);
            if (!approvalStatus.approved) throw new Error('Token approval required for selling');
            position.preApproved = true;
          }
          const result = await transactionQueue.addTransaction({
            id: `flip_sell_${tokenAddress}_${Date.now()}`,
            type: 'sell',
            network: 'solana',
            userId: this.userId,
            tokenAddress,
            amount: position.amount,
            priority: 2,
          });

          await this.updateStrategyPerformance(position.userId, {
            profit: result.profit,
            maxDrawdown: position.maxDrawdown
          });

          const stats = this.positionStats.get(tokenAddress);
          if (stats) {
            stats.exitPrice = result.price;
            stats.exitTime = Date.now();
            stats.reason = reason;
            stats.profitLoss = ((result.price - position.entryPrice) / position.entryPrice) * 100;
          }

          const normalizedMetrics = {
            ...this.calculateMetricsForPosition(stats),
            avgHoldTime: parseFloat(stats.avgHoldTime.toFixed(2)),
          };

          await this.saveUserMetrics(this.userId, normalizedMetrics);
          await this.saveSystemMetrics(normalizedMetrics);

          this.openPositions.delete(tokenAddress);
          const ws = this.priceWebsockets.get(tokenAddress);
          if (ws) {
            ws.close();
            this.priceWebsockets.delete(tokenAddress);
          }

          this.emit('exitExecuted', { token: position.token, reason, result, stats });
          return result;
        } catch (error) {
          await ErrorHandler.handle(error, null, this.userId);
          console.error('Error closing position:', error);
          this.emit('error', error);
        }
      },
      BREAKER_CONFIGS.pumpfun
    );
  }

  calculateMetricsForPosition(position) {
    const profit = ((position.exitPrice - position.entryPrice) / position.entryPrice) * 100;
    return {
      totalTrades: this.positionStats.size,
      profitable: profit > 0 ? 1 : 0,
      totalProfit: profit,
      avgHoldTime: (position.exitTime - position.entryTime) / 60000,
    };
  }

  async saveUserMetrics(userId, stats) {
    try {
      await this.userMetricsCollection.updateOne(
        { userId },
        {
          $set: { userId, lastUpdated: new Date() },
          $inc: {
            totalTrades: stats.totalTrades,
            profitableTrades: stats.profitable,
            totalProfit: stats.totalProfit,
            avgHoldTime: stats.avgHoldTime * stats.totalTrades,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      console.warn('Error saving user metrics:', error);
      monitoringSystem.reportCriticalError({
        component: 'FlipperMode',
        message: 'Failed to save user ' + userId + ' trade metrics',
        error,
      });
    }
  }

  async saveSystemMetrics(stats) {
    try {
      await this.systemMetricsCollection.updateOne(
        { _id: 'global' },
        {
          $set: { lastUpdated: new Date() },
          $inc: {
            totalTrades: stats.totalTrades,
            profitableTrades: stats.profitable,
            totalProfit: stats.totalProfit,
            totalHoldTime: stats.avgHoldTime * stats.totalTrades,
          },
        },
        { upsert: true }
      );
    } catch (error) {
      console.error('Error saving system metrics:', error);
      monitoringSystem.reportCriticalError({
        component: 'FlipperMode',
        message: 'Failed to save system metrics',
        error,
      });
    }
  }

  async updateStrategyPerformance(userId, performance) {
    const tracking = this.strategyPerformance.get(userId);
    if (!tracking) return;
    try {
      await this.strategyManager.updateStrategyPerformance(tracking.strategyId, performance);
      tracking.trades++;
      tracking.profit += performance.profit;
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async applyStrategyChanges(userId, changes) {
    try {
      const tracking = this.strategyPerformance.get(userId);
      if (!tracking) throw new Error('No active strategy found');
      const updatedStrategy = await this.strategyManager.applyStrategyChanges(tracking.strategyId, changes);
      this.config = { ...this.config, ...updatedStrategy.config };
      this.emit('strategyUpdated', { userId, strategy: updatedStrategy });
      return updatedStrategy;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Collects metrics for the system, including token positions, trade stats,
   * user performance, and system health.
   */
  async collectMetrics() {
    try {
      // Collecting general system performance metrics
      const systemMetrics = await this.getSystemMetrics();
      const userMetrics = await this.getUserMetrics();
      const openPositions = this.getOpenPositions();
      const activeTokens = Array.from(this.openPositions.keys());
      const activeStrategies = this.activeStrategies.size;
      
      // Additional data to track
      const totalTrades = systemMetrics.totalTrades || 0;
      const totalProfit = systemMetrics.totalProfit || 0;
      const profitableTrades = systemMetrics.profitableTrades || 0;
      const avgHoldTime = totalTrades > 0 ? systemMetrics.totalHoldTime / totalTrades : 0;
      const winRate = totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0;
      const avgProfit = totalTrades > 0 ? totalProfit / totalTrades : 0;

      const liveMetrics = {
        activePositions: this.openPositions.size,
        activeTokens,
        activeStrategies,
        totalTrades,
        totalProfit,
        profitableTrades,
        avgHoldTime: avgHoldTime.toFixed(2),
        winRate: winRate.toFixed(2),
        avgProfit: avgProfit.toFixed(2),
        lastUpdated: new Date().toISOString(),
      };

      // Gathering more specific position-level metrics
      const positionStats = Array.from(this.positionStats.values()).map(stats => ({
        tokenAddress: stats.token.address,
        currentPrice: stats.currentPrice || stats.entryPrice,
        profitLoss: stats.exitPrice
          ? ((stats.exitPrice - stats.entryPrice) / stats.entryPrice) * 100
          : 0,
        timeElapsed: Math.floor((Date.now() - stats.entryTime) / 60000), // time in minutes
        liquidity: stats.liquidity || 0,
        volume: stats.volume || 0,
      }));

      // Combine all metrics into a comprehensive report
      const metricsReport = {
        systemMetrics: liveMetrics,
        positionMetrics: positionStats,
        userMetrics: userMetrics,
      };

      // Optionally, log the report
      console.log('Metrics collected:', metricsReport);

      // Return the metrics report
      return metricsReport;
    } catch (error) {
      console.error('Error collecting metrics:', error);
      throw new Error('Failed to collect metrics');
    }
  }

  // Helper method to fetch system-level aggregated metrics
  async getSystemMetrics() {
    try {
      // Assuming systemMetricsCollection is available and properly initialized
      const result = await this.systemMetricsCollection.aggregate([
        {
          $group: {
            _id: null,
            totalTrades: { $sum: '$totalTrades' },
            totalProfit: { $sum: '$totalProfit' },
            profitableTrades: { $sum: '$profitableTrades' },
            totalHoldTime: { $sum: '$totalHoldTime' },
          }
        }
      ]).toArray();

      return result.length > 0 ? result[0] : {};
    } catch (error) {
      console.error('Error fetching system metrics:', error);
      return {};
    }
  }

  // Helper method to fetch user-level aggregated metrics
  async getUserMetrics() {
    try {
      // Assuming userMetricsCollection is available and properly initialized
      const userMetrics = await this.userMetricsCollection.aggregate([
        {
          $group: {
            _id: null,
            totalTrades: { $sum: '$totalTrades' },
            profitableTrades: { $sum: '$profitableTrades' },
            totalProfit: { $sum: '$totalProfit' },
            avgHoldTime: { $sum: '$avgHoldTime' },
          }
        }
      ]).toArray();

      return userMetrics.length > 0 ? userMetrics[0] : {};
    } catch (error) {
      console.error('Error fetching user metrics:', error);
      return {};
    }
  }

  // Example: Get current open positions with relevant details
  getOpenPositions() {
    return Array.from(this.openPositions.values()).map(position => {
      const stats = this.positionStats.get(position.token.address);
      return {
        ...position,
        currentPrice: stats?.currentPrice || position.entryPrice,
        profitLoss: stats
          ? ((stats.currentPrice - position.entryPrice) / position.entryPrice) * 100
          : 0,
        timeElapsed: Math.floor((Date.now() - position.entryTime) / 60000), // Time in minutes
      };
    });
  }
  
  calculateStats() {
      const stats = {
        totalTrades: this.positionStats.size,
        profitable: 0,
        totalProfit: 0,
        avgHoldTime: 0,
        bestTrade: 0,
        worstTrade: 0
      };

      for (const [, position] of this.positionStats) {
        if (!position.exitPrice) continue;
        const profit = ((position.exitPrice - position.entryPrice) / position.entryPrice) * 100;
        if (profit > 0) stats.profitable++;
        stats.totalProfit += profit;
        stats.avgHoldTime += (position.exitTime - position.entryTime);
        stats.bestTrade = Math.max(stats.bestTrade, profit);
        stats.worstTrade = Math.min(stats.worstTrade, profit);
      }

      if (stats.totalTrades > 0) {
        stats.avgHoldTime = Math.floor(stats.avgHoldTime / (stats.totalTrades * 60000));
        stats.winRate = (stats.profitable / stats.totalTrades) * 100;
        stats.avgProfit = stats.totalProfit / stats.totalTrades;
      }

      return stats;
  }

  cleanup() {
    this.isRunning = false;
    this.userId = null;
    this.walletAddress = null;
    this.tokenQueue.clear();
    this.openPositions.clear();
    this.positionStats.clear();
    this.blacklistedTokens.clear();
    for (const ws of this.priceWebsockets.values()) {
      ws.close();
    }
    this.priceWebsockets.clear();
    wsManager.cleanup();
    this.positionMonitor.cleanup();
    //monitoringSystem.unregisterComponent('flipperMode');
    this.removeAllListeners();
  }
}

export const flipperMode = new FlipperMode();

process.on('SIGINT', () => { flipperMode.cleanup(); });
process.on('SIGTERM', () => { flipperMode.cleanup(); });
