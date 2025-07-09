import { EventEmitter } from 'events';
import { TimedOrder } from '../models/TimedOrder.js';
import { dextools } from './dextools/index.js';
import { tradeService } from './trading/TradeService.js';
import { tokenInfoService } from './tokens/TokenInfoService.js';
import { format } from 'date-fns';
import PQueue from 'p-queue';
import mongoose from 'mongoose';
import { EnhancedPositionMonitor } from './queue/enhanced/PositionMonitor.js';

class TimedOrderService extends EventEmitter {
  constructor() {
    super();
    this.orderQueue = new PQueue({ concurrency: 1 });
    this.orderChecks = new Map();
    this.initialized = false;
    this.initializationPromise = null;
    this.priceWebsockets = new Map();
    this.positionMonitor = new EnhancedPositionMonitor();
  }

  async initialize() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        // Wait for mongoose connection to be ready
        if (mongoose.connection.readyState !== 1) {
          console.log('🔄 Waiting for database connection...');
          await new Promise((resolve) => {
            mongoose.connection.once('connected', resolve);
          });
        }
        
        await this.rescheduleExistingOrders();
        this.startPriceMonitoring();
        this.initialized = true;
        this.emit('initialized');
        return true;
      } catch (error) {
        this.initialized = false;
        this.emit('error', error);
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  async rescheduleExistingOrders() {
    try {
      // Check mongoose connection
      if (mongoose.connection.readyState !== 1) {
        throw new Error('Database connection not ready');
      }

      const pendingOrders = await TimedOrder.find({ 
        status: 'pending' 
      }).lean().exec();
      
      if (!pendingOrders?.length) {
        console.log('✅ No pending orders to reschedule');
        return;
      }

      console.log(`Found ${pendingOrders.length} pending orders to reschedule`);
      
      // Group orders by execution time
      const orderGroups = new Map();
      pendingOrders.forEach(order => {
        const timeKey = order.executeAt.getTime();
        if (!orderGroups.has(timeKey)) {
          orderGroups.set(timeKey, []);
        }
        orderGroups.get(timeKey).push(order);
      });

      // Schedule each group
      for (const [executeTime, orders] of orderGroups) {
        this.scheduleOrderGroup(orders, executeTime);
      }

      console.log('✅ Orders rescheduled successfully');
    } catch (error) {
      console.error('Error rescheduling orders:', error);
      throw error;
    }
  }

  startPriceMonitoring() {
    // Clean up existing websockets
    this.priceWebsockets.forEach(ws => ws.close());
    this.priceWebsockets.clear();

    // Set up price monitoring for active orders
    setInterval(async () => {
      try {
        const uniqueTokens = await this.getUniqueTokensFromPendingOrders();
        
        for (const { network, tokenAddress } of uniqueTokens) {
          const wsKey = `${network}:${tokenAddress}`;
          
          if (!this.priceWebsockets.has(wsKey)) {
            const ws = await dextools.subscribeToPriceUpdates(
              network,
              tokenAddress,
              (price) => this.handlePriceUpdate(network, tokenAddress, price)
            );
            this.priceWebsockets.set(wsKey, ws);
          }
        }
      } catch (error) {
        console.error('Error updating price monitors:', error);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  async getUniqueTokensFromPendingOrders() {
    const orders = await TimedOrder.find({ status: 'pending' });
    const uniqueTokens = new Set();
    
    orders.forEach(order => {
      uniqueTokens.add(`${order.network}:${order.tokenAddress}`);
    });

    return Array.from(uniqueTokens).map(key => {
      const [network, tokenAddress] = key.split(':');
      return { network, tokenAddress };
    });
  }

  scheduleOrderGroup(orders, executeTime) {
    const now = Date.now();
    const delay = Math.max(0, executeTime - now);
    const timeoutId = setTimeout(() => {
      this.orderQueue.addAll(
        orders.map(order => () => this.executeOrder(order))
      );
    }, delay);

    // Store timeout ID for each order in group
    orders.forEach(order => {
      this.orderChecks.set(order._id.toString(), timeoutId);
    });
  }

  async createOrder(userId, orderData) {
    
    try {
      const order = new TimedOrder({
        userId: userId.toString(),
        ...orderData,
        status: 'pending'
      });

      await order.save();

      // Find orders with similar execution time
      const similarOrders = await TimedOrder.find({
        status: 'pending',
        executeAt: {
          $gte: new Date(order.executeAt.getTime() - 1000),
          $lte: new Date(order.executeAt.getTime() + 1000)
        }
      });

      this.scheduleOrderGroup(similarOrders, order.executeAt.getTime());
      
      this.emit('orderCreated', { 
        userId, 
        orderId: order._id,
        executeAt: format(order.executeAt, 'PPpp')
      });
      
      return order;
    } catch (error) {
      console.error('Error creating order:', error);
      this.emit('error', error);
      throw error;
    }
  }

  async executeOrder(order) {
    const retries = 3;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const currentPrice = await dextools.getTokenPrice(
          order.network, 
          order.tokenAddress
        );

        const result = await tradeService.executeTrade(
          {
            action: order.action,
            tokenAddress: order.tokenAddress,
            amount: order.amount,
            walletAddress: order.walletAddress,
            network: order.network,
          }
        );

        await order.markExecuted({
          ...result,
          price: currentPrice
        });

        this.emit('orderExecuted', {
          userId: order.userId,
          orderId: order._id,
          result: {
            ...result,
            price: currentPrice
          }
        });

        return;
      } catch (error) {
        console.error(`Execution attempt ${attempt} failed:`, error);
        
        if (attempt === retries) {
          await order.markFailed(error);
          this.emit('orderFailed', {
            userId: order.userId,
            orderId: order._id,
            error
          });
          throw error;
        }

        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  async createAdvancedOrder(userId, orderData) {
    try {
      const order = new TimedOrder({
        userId: userId.toString(),
        ...orderData,
        status: 'pending',
        orderType: orderData.orderType || 'standard'
      });
  
      await order.save();
  
      // Setup monitoring based on order type
      switch(order.orderType) {
        case 'trailing':
          await this.setupTrailingStop(order);
          break;
        case 'scaled':
          await this.createScaledOrders(order);
          break;
        case 'conditional':
          await this.setupConditionalMonitoring(order);
          break;
        case 'chain':
          await this.setupChainedOrders(order);
          break;
      }
  
      return order;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async setupTrailingStop(order) {
    const { trailAmount } = order.conditions;
    let highestPrice = await this.getCurrentPrice(order.tokenAddress);
  
    // Subscribe to price updates
    await dextools.subscribeToPriceUpdates(
      order.network,
      order.tokenAddress,
      async (price) => {
        // Update highest price if new high reached
        if (price > highestPrice) {
          highestPrice = price;
          // Update stop price
          const stopPrice = highestPrice * (1 - trailAmount/100);
          await order.updateTrailingStop(stopPrice);
        }
        // Check if price fell below stop
        else if (price <= order.conditions.stopPrice) {
          await this.executeOrder(order);
        }
      }
    );
  }
  
  async createScaledOrders(parentOrder) {
    const { levels, priceStep, amountPerLevel } = parentOrder.conditions;
    const basePrice = await this.getCurrentPrice(parentOrder.tokenAddress);
  
    for (let i = 0; i < levels; i++) {
      const targetPrice = basePrice * (1 + priceStep * i);
      await this.createOrder(parentOrder.userId, {
        ...parentOrder,
        amount: amountPerLevel,
        conditions: {
          targetPrice,
          parentOrderId: parentOrder._id
        }
      });
    }
  }
  
  async setupConditionalMonitoring(order) {
    const { conditions } = order;
    
    // Subscribe to required data sources
    if (conditions.priceTarget) {
      await this.monitorPrice(order);
    }
    if (conditions.volumeTarget) {
      await this.monitorVolume(order);
    }
    if (conditions.timeWindow) {
      await this.setupTimeWindow(order);
    }
  }
  
  async setupChainedOrders(order) {
    const { chain } = order.conditions;
    
    // Create subsequent orders
    for (const nextOrder of chain) {
      await this.createOrder(order.userId, {
        ...nextOrder,
        conditions: {
          ...nextOrder.conditions,
          dependsOn: order._id
        }
      });
    }
  }

  async createSplitOrders(parentOrder) {
    const {
      totalAmount,
      orderCount,
      intervalMinutes
    } = parentOrder.conditions.multiOrderConfig;

    const amountPerOrder = totalAmount / orderCount;
    const now = new Date();

    for (let i = 0; i < orderCount; i++) {
      const executeAt = new Date(now.getTime() + i * intervalMinutes * 60000);
      
      await this.createOrder(parentOrder.userId, {
        ...parentOrder.toObject(),
        amount: amountPerOrder.toString(),
        executeAt,
        conditions: {
          parentOrderId: parentOrder._id
        }
      });
    }
  }

  async handlePriceUpdate(network, tokenAddress, price) {
    try {
      const tokenInfo = await tokenInfoService.getTokenInfo(network, tokenAddress);
      if (!tokenInfo?.price) return;

      // Check orders that depend on this token's price
      const orders = await TimedOrder.find({
        network,
        tokenAddress,
        status: 'pending'
      });

      for (const order of orders) {
        await this.checkOrderConditions(order, tokenInfo.price);
      }
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  // Start Price Monitoring
  async startPriceMonitoring() {
    try {
      const uniqueTokens = await this.getUniqueTokensFromPendingOrders();
      
      for (const { network, tokenAddress } of uniqueTokens) {
        await this.positionMonitor.setupRedundantPriceFeeds({
          address: tokenAddress,
          network
        });
      }

      this.positionMonitor.on('priceUpdate', ({ tokenAddress, price }) => {
        this.handlePriceUpdate(tokenAddress, price);
      });

    } catch (error) {
      console.error('Error starting price monitoring:', error);
      throw error;
    }
  }


  // Override execute method to handle advanced orders
  async executeOrder(order) {
    if (order.orderType === 'chain') {
      return this.executeChainedOrders(order);
    }

    return super.executeOrder(order);
  }

  async executeChainedOrders(firstOrder) {
    const orders = await TimedOrder.find({
      'conditions.dependencies.orderId': firstOrder._id
    }).sort('executeAt');

    for (const order of orders) {
      try {
        await this.executeOrder(order);
      } catch (error) {
        console.error(`Chain execution failed at order ${order._id}:`, error);
        break;
      }
    }
  }

  async getMetrics() {
    try {
      const totalOrders = await TimedOrder.countDocuments();
      const pendingOrders = await TimedOrder.countDocuments({ status: 'pending' });
      const executedOrders = await TimedOrder.countDocuments({ status: 'executed' });
      const failedOrders = await TimedOrder.countDocuments({ status: 'failed' });
  
      return {
        totalOrders,
        pendingOrders,
        executedOrders,
        failedOrders,
      };
    } catch (error) {
      console.error('Error fetching timed orders metrics:', error);
      throw new Error('Failed to fetch timed orders metrics.');
    }
  }  

  cleanup() {
    // Clear all scheduled checks
    for (const [orderId, timeoutId] of this.orderChecks) {
      clearTimeout(timeoutId);
    }
    this.orderChecks.clear();

    // Close all websocket connections
    this.priceWebsockets.forEach(ws => ws.close());
    this.priceWebsockets.clear();

    // Clear the queue
    this.orderQueue.clear();

    // Remove all listeners
    this.removeAllListeners();
    this.initialized = false;
    this.initializationPromise = null;
  }
}

export const timedOrderService = new TimedOrderService();

// Initialize service
timedOrderService.initialize().catch(console.error);

// Handle cleanup on process termination
process.on('SIGINT', () => {
  timedOrderService.cleanup();
});

process.on('SIGTERM', () => {
  timedOrderService.cleanup();
});