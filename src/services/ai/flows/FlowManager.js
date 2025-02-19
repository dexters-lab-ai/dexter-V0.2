import { EventEmitter } from 'events';
import { TradeFlow } from './TradeFlow.js';
import { AlertFlow } from './AlertFlow.js';
import { FlipperFlow } from './FlipperFlow.js';
import { WalletFlow } from './WalletFlow.js';
import { GemsFlow } from './GemsFlow.js';
import { MonitoringFlow } from './MonitoringFlow.js';
import { PortfolioFlow } from './PortfolioFlow.js';
import { KOLMonitorFlow } from './KOLMonitorFlow.js';
import { MultiTargetFlow } from './MultiTargetFlow.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { db } from '../../../core/database.js';

export class FlowManager extends EventEmitter {
  constructor() {
    super();
    this.flows = new Map();
    this.activeFlows = new Map();
    this.flowTimeouts = new Map();
    this.initialized = false;
    this.flowCollection = null;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await db.connect();
      this.flowCollection = db.getDatabase().collection('flows');
      await this.setupIndexes();
      this.registerFlows(); // Add this line
      this.initialized = true;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }
  
  // Register all flows
  async registerFlows() {
    
    this.flows.set('trade', new TradeFlow());
    this.flows.set('alert', new AlertFlow());
    this.flows.set('flipper', new FlipperFlow());
    this.flows.set('wallet', new WalletFlow());
    this.flows.set('gems', new GemsFlow());
    this.flows.set('monitor', new MonitoringFlow());
    this.flows.set('portfolio', new PortfolioFlow());
    this.flows.set('kolMonitor', new KOLMonitorFlow());
    this.flows.set('multiTarget', new MultiTargetFlow());

    // Initialize each flow
    await Promise.all(
      Array.from(this.flows.values()).map(flow => flow.initialize?.())
    );

    // Set up event listeners for each flow
    for (const [type, flow] of this.flows.entries()) {
      flow.on('networkSwitch', async (data) => {
        await this.handleNetworkSwitch(data.userId, data.from, data.to);
      });

      flow.on('progress', (data) => {
        this.emit('flowProgress', { type, ...data });
      });

      flow.on('error', (error) => {
        this.emit('flowError', { type, error });
      });

      flow.on('complete', (data) => {
        this.emit('flowComplete', { type, ...data });
      });
    }
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await db.connect();
      this.flowCollection = db.getDatabase().collection('flows');
      await this.setupIndexes();
      this.initialized = true;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async setupIndexes() {
    await this.flowCollection.createIndex({ userId: 1 });
    await this.flowCollection.createIndex({ 'state.lastActivity': 1 }, { expireAfterSeconds: 3600 });
  }
  
  
  async startFlow(userId, flowType, initialData = {}) {
    try {
      // Ensure initialization
      if (!this.initialized) {
        await this.initialize();
      }

      // Validate flow exists
      const flow = this.flows.get(flowType);
      if (!flow) {
        throw new Error(`Unknown flow type: ${flowType}`);
      }

      // Validate initialData
      if (!userId) {
        throw new Error('userId is required');
      }

      // Set flow timeout
      this.flowTimeouts.set(userId, setTimeout(() => {
        this.cleanupFlow(userId);
      }, 300000)); // 5 min timeout

      // Start the flow
      const state = await flow.start({
        ...initialData,
        userId,
        startTime: Date.now()
      });

      // Store active flow
      this.activeFlows.set(userId, { 
        type: flowType, 
        state,
        flow 
      });

      // Persist flow state
      await this.persistFlowState(userId, flowType, state);

      // Return standardized response
      return {
        type: flowType,
        response: state.response,
        requiresInput: !state.completed,
        data: state.data,
        keyboard: state.keyboard
      };

    } catch (error) {
      // Cleanup on error
      this.cleanupFlow(userId);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async handleNetworkSwitch(userId, from, to) {
    const flow = this.activeFlows.get(userId);
    if (!flow) return;

    // Emit network switch events
    this.emit('networkSwitchStarted', { userId, from, to });
    await networkState.setCurrentNetwork(userId, to);
    this.emit('networkSwitchCompleted', { userId, network: to });
  }

  async persistFlowState(userId, flowType, state) {
    await this.flowCollection.updateOne(
      { userId },
      {
        $set: {
          flowType,
          state,
          lastActivity: new Date()
        }
      },
      { upsert: true }
    );
  }
  
  async restoreFlow(userId) {
    const saved = await this.flowCollection.findOne({ userId });
    if (saved && this.flows.has(saved.flowType)) {
      this.activeFlows.set(userId, {
        type: saved.flowType,
        state: saved.state
      });
      return true;
    }
    return false;
  }  

  async continueFlow(userId, input) {
    const lock = await this.acquireLock(userId);
    if (!lock) {
      throw new Error('Flow operation in progress');
    }

    const activeFlow = this.activeFlows.get(userId);
    if (!activeFlow) return null;

    const flow = this.flows.get(activeFlow.type);
    if (!flow) {
      await this.cleanupFlow(userId);
      throw new Error('Invalid flow type');
    }
  
    try {
      const flow = this.flows.get(activeFlow.type);
      const result = await flow.processStep(activeFlow.state, input);
  
      // Emit progress event
      this.emit('flowProgress', {
        userId,
        flowType: activeFlow.type,
        step: result.flowData?.currentStep,
        timestamp: Date.now()
      });
  
      if (result.completed) {
        await this.cleanupFlow(userId);
        this.emit('flowCompleted', {
          userId,
          flowType: activeFlow.type,
          timestamp: Date.now()
        });
        return {
          ...result,
          completed: true
        };
      }
  
      // Update flow state
      this.activeFlows.set(userId, {
        type: activeFlow.type,
        state: result.flowData
      });
  
      // Reset timeout
      this.resetFlowTimeout(userId);
  
      return {
        type: activeFlow.type,
        response: result.response,
        requiresInput: true
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      await this.cleanupFlow(userId);
      throw error;
    } finally {
      await this.releaseLock(userId);
    }
  }

  // Helper methods
  async acquireLock(key, timeout = 5000) {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      if (await this.tryLock(key)) {
        return async () => this.releaseLock(key);
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('Failed to acquire lock');
  }
  
  async tryLock(key) {
    return await this.lockCollection.updateOne(
      { _id: key, locked: { $ne: true } },
      { $set: { locked: true, timestamp: Date.now() } },
      { upsert: true }
    );
  }
  
  async releaseLock(key) {
    await this.lockCollection.updateOne(
      { _id: key },
      { $set: { locked: false } }
    );
  }

  async cleanupFlow(userId) {
    clearTimeout(this.flowTimeouts.get(userId));
    this.flowTimeouts.delete(userId);
    this.activeFlows.delete(userId);
    await this.flowCollection.deleteOne({ userId });
  }

  resetFlowTimeout(userId) {
    clearTimeout(this.flowTimeouts.get(userId));
    this.flowTimeouts.set(userId, setTimeout(() => {
      this.cleanupFlow(userId);
    }, 300000));
  }

  isInFlow(userId) {
    return this.activeFlows.has(userId);
  }

  getActiveFlow(userId) {
    return this.activeFlows.get(userId);
  }

  cleanup() {
    // Clear all timeouts
    for (const timeout of this.flowTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.flowTimeouts.clear();
    this.activeFlows.clear();
    this.flows.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}