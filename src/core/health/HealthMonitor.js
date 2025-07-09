import { EventEmitter } from 'events';
import { aiMetricsService } from '../../services/aiMetricsService.js';
import { db } from '../database.js';
import { walletService } from '../../services/wallet/index.js';
import { pumpFunService } from '../../services/pumpfun/index.js';
import { ErrorHandler } from '../errors/index.js';
import { config } from '../config.js';

export class HealthMonitor extends EventEmitter {
  constructor() {
    super();
    this.services = new Map();
    this.intervalDuration = 600000; // Default to 10 minutes - moderate
    this.monitoringTimeout = null;
    // Instead of tracking unlimited restart attempts, we limit to 3 per service.
    this.restartAttempts = new Map();
    this.maxRestartAttempts = 3;
    this.errorLogs = []; // for reference
  }

  async initialize() {
    try {
      console.log('🔧 Initializing HealthMonitor dependencies...');
      // Initialize dependencies. (Each service should handle its own reconnection logic.)
      await aiMetricsService.initialize();
      // Other services are assumed to be already initialized.
      console.log('✅ Dependencies initialized. HealthMonitor is ready.');
      // Register the health checks.
      this.setupChecks();
    } catch (error) {
      console.error('❌ Failed to initialize HealthMonitor:', error);
      await ErrorHandler.handle(error);
    }
  }

  setupChecks() {
    // Register each check with a simple function returning a promise.
    this.services.set('database', async () => this.checkDatabaseHealth());
    this.services.set('aiMetrics', async () => this.checkServiceHealth(aiMetricsService));
    //this.services.set('walletService', async () => walletService.checkHealth());
    this.services.set('pumpFun', async () => pumpFunService.checkHealth());
  }

  async checkDatabaseHealth() {
    try {
      await db.checkHealth();
      return { status: 'healthy', timestamp: new Date().toISOString() };
    } catch (error) {
      throw new Error(`Database unreachable: ${error.message}`);
    }
  }

  async checkServiceHealth(service) {
    try {
      if (service.checkHealth) {
        return await service.checkHealth();
      }
      throw new Error(`Health check not implemented for ${service.constructor.name}`);
    } catch (error) {
      throw new Error(`${service.constructor.name} unreachable: ${error.message}`);
    }
  }

  async checkHealth() {
    const results = {};
    for (const [name, checkFn] of this.services) {
      try {
        results[name] = await checkFn();
      } catch (error) {
        const formattedError = {
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString(),
        };
        results[name] = formattedError;
        this.logError(error, `Health check failed for service: ${name}`);
        this.emit('serviceError', { service: name, error: formattedError });
        // Attempt a modest restart (up to maxRestartAttempts)
        await this.restartService(name);
      }
    }
    return results;
  }

  logError(error, context = null) {
    const logEntry = {
      error: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
    };
    this.errorLogs.push(logEntry);
    if (this.errorLogs.length > 100) {
      this.errorLogs.shift();
    }
    console.error('🔴 Logged error:', logEntry);
  }

  async restartService(serviceName) {
    const count = this.restartAttempts.get(serviceName) || 0;
    if (count >= this.maxRestartAttempts) {
      console.warn(`Max restart attempts reached for service: ${serviceName}`);
      return;
    }
    console.warn(`Attempting to restart ${serviceName} (attempt ${count + 1})`);
    this.restartAttempts.set(serviceName, count + 1);
    const delay = Math.min(1000 * 2 ** count, 30000);
    setTimeout(async () => {
      try {
        const service = this.getServiceInstance(serviceName);
        if (service && service.initialize) {
          await service.initialize();
          console.log(`✅ ${serviceName} restarted successfully.`);
          this.restartAttempts.delete(serviceName);
        } else {
          console.warn(`No restart logic for ${serviceName}`);
        }
      } catch (error) {
        console.error(`Failed to restart ${serviceName}:`, error.message);
        await ErrorHandler.handle(error);
      }
    }, delay);
  }

  getServiceInstance(serviceName) {
    const mapping = {
      database: db,
      aiMetrics: aiMetricsService,
      walletService: walletService,
      pumpFun: pumpFunService,
    };
    return mapping[serviceName];
  }

  async startMonitoring() {
    console.log('⏳ Starting HealthMonitor checks...');
    const executeCheck = async () => {
      try {
        const health = await this.checkHealth();
        this.emit('healthCheck', health);
      } catch (error) {
        console.error('Error during health check:', error.message);
        await ErrorHandler.handle(error);
      } finally {
        this.monitoringTimeout = setTimeout(executeCheck, this.intervalDuration);
      }
    };
    executeCheck();
  }

  stopMonitoring() {
    if (this.monitoringTimeout) {
      clearTimeout(this.monitoringTimeout);
      this.monitoringTimeout = null;
    }
  }

  cleanup() {
    this.stopMonitoring();
    this.removeAllListeners();
    console.log('🧹 HealthMonitor cleaned up.');
  }
}

export const healthMonitor = new HealthMonitor();
