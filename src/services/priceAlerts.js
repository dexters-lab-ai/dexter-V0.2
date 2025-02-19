import { EventEmitter } from 'events';
import { PriceAlert } from '../models/PriceAlert.js';
import { walletService } from './wallet/index.js';
import { tradeService } from './trading/TradeService.js';
import { ErrorHandler } from '../core/errors/index.js';

// IMPORTANT: Adjust the import path for PriceMonitoringService & JupiterQuickNode as needed
import { PriceMonitoringService } from './trading/PriceMonitoring.js';
import { JupiterQuickNode } from './trading/JupiterQuickNode.js';

class PriceAlertService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.initializationPromise = null;
    
    // Instantiate the monitoring service and hand it this service for callbacks
    this.priceMonitoringService = new PriceMonitoringService(this);
    
    // If you need direct Jupiter usage here, instantiate it:
    this.jupiterQuickNode = new JupiterQuickNode();
  }

  /**
   * Initialize the PriceAlertService and start periodic monitoring.
   */
  async initialize() {
    if (this.initializationPromise) {
      // Avoid re-initializing
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        // Start the global monitoring interval
        this.priceMonitoringService.startMonitoring();

        this.initialized = true;
        this.emit('initialized');
        return true;
      } catch (error) {
        await ErrorHandler.handle(error);
        this.emit('error', error);
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  /**
   * Execute an alert (e.g., do a trade or just record the trigger).
   * This is called from PriceMonitoringService once a trigger condition is met.
   */
  async executeAlert(alert, currentPrice) {
    try {
      // If you need to re-fetch the wallet, do so here
      const wallet = await walletService.getWallet(alert.userId, alert.walletAddress);

      // Optional: handle token approval for walletconnect users
      if (wallet.type === 'walletconnect' && !alert.preApproved) {
        const approvalStatus = await walletService.checkAndRequestApproval(
          alert.tokenAddress,
          alert.walletAddress,
          alert.swapAction.amount
        );
        if (approvalStatus.approved) {
          alert.preApproved = true;
          await alert.save();
        } else {
          throw new Error('Token approval required');
        }
      }

      // Convert “percentage amounts” to actual numeric amounts if needed
      let amount = alert.swapAction?.amount || '0';
      if (typeof amount === 'string' && amount.endsWith('%')) {
        const percentage = parseFloat(amount);
        const balance = await walletService.getTokenBalance(alert.userId, alert.tokenAddress);
        amount = String((balance * percentage) / 100);
      }

      // If swapAction is enabled, attempt a trade
      if (alert.swapAction?.enabled) {
        let tradeSuccess = false;
        let tradeResult = null;

        // Example: inputMint / outputMint
        const inputMint =
          alert.swapAction.type === 'buy'
            ? 'So11111111111111111111111111111111111111112' // SOL
            : alert.tokenAddress; // user token to sell

        const outputMint =
          alert.swapAction.type === 'buy'
            ? alert.tokenAddress
            : 'So11111111111111111111111111111111111111112';

        // Try standard trade service up to 2 times
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            tradeResult = await tradeService.executeTrade({
              network: alert.network,
              action: alert.swapAction.type,
              tokenAddress: alert.tokenAddress,
              amount,
              walletAddress: alert.swapAction.walletAddress,
              userId: alert.userId,
              options: {
                slippage: 1,
                autoApprove: true,
              },
            });
            tradeSuccess = true;
            break;
          } catch (tradeError) {
            console.error(`Trade attempt ${attempt + 1} failed: ${tradeError.message}`);
          }
        }

        // If standard trade fails on Solana, use Jupiter fallback
        if (!tradeSuccess && alert.network === 'solana') {
          console.log('[PriceAlertService] Retrying via JupiterQuickNode...');
          try {
            tradeResult = await this.jupiterQuickNode.startJupiterSwap({
              wallet,
              inputMint,
              outputMint,
              amount,
              userId: alert.userId,
            });
            tradeSuccess = true;
          } catch (jupiterError) {
            console.error(`[PriceAlertService] JupiterQuickNode swap failed: ${jupiterError.message}`);
          }
        }

        if (tradeSuccess) {
          await PriceAlert.findByIdAndUpdate(alert._id, {
            $set: {
              // Already set isActive: false in PriceMonitoringService,
              // but let's keep it consistent if needed
              isActive: false,
              executionResult: {
                hash: tradeResult?.hash || tradeResult?.signature,
                executedAt: new Date(),
                price: currentPrice,
                gasCost: tradeResult?.gasCost || null,
              },
            },
          });

          // Emit an event letting others know the alert was triggered & trade succeeded
          this.emit('alertTriggered', {
            userId: alert.userId,
            alertId: alert._id,
            price: currentPrice,
          });
        } else {
          throw new Error('Trade failed on all attempts.');
        }
      } else {
        // If no swap is needed, just mark executed
        await PriceAlert.findByIdAndUpdate(alert._id, {
          $set: {
            isActive: false,
            executionResult: {
              executedAt: new Date(),
              price: currentPrice,
            },
          },
        });

        // Emit an event letting others know the alert was triggered
        this.emit('alertTriggered', {
          userId: alert.userId,
          alertId: alert._id,
          price: currentPrice,
        });
      }
    } catch (error) {
      // Mark as failed
      await PriceAlert.findByIdAndUpdate(alert._id, {
        $set: {
          isActive: false,
          executionResult: {
            error: error.message,
            executedAt: new Date(),
          },
        },
      });

      // Log and emit
      await ErrorHandler.handle(error);
      this.emit('alertFailed', {
        userId: alert.userId,
        alertId: alert._id,
        error,
      });
    }
  }

  /**
   * Create a new alert.
   */
  async createAlert(userId, alertData) {
    try {
      const alert = new PriceAlert({
        userId: userId.toString(),
        tokenAddress: alertData.tokenAddress,
        network: alertData.network,
        targetPrice: alertData.targetPrice,
        condition: alertData.condition, // 'above' or 'below'
        walletType: alertData.walletType || 'internal',
        swapAction: alertData.swapAction || { enabled: false },
        isActive: true,
      });

      await alert.save();

      // We do NOT call a per-token “monitor” method anymore;
      // the global polling interval will pick up this new alert on the next cycle.
      this.emit('alertCreated', {
        userId,
        alertId: alert._id,
        tokenAddress: alert.tokenAddress,
      });

      return alert;
    } catch (error) {
      await ErrorHandler.handle(error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Basic metrics using existing fields.
   * We count "executed" if isActive=false and no error in executionResult.
   * We count "failed" if isActive=false and there's an error in executionResult.
   */
  async getMetrics() {
    try {
      const totalAlerts = await PriceAlert.countDocuments({});
      const activeAlerts = await PriceAlert.countDocuments({ isActive: true });
      const executedAlerts = await PriceAlert.countDocuments({
        isActive: false,
        'executionResult.error': { $exists: false },
      });
      const failedAlerts = await PriceAlert.countDocuments({
        isActive: false,
        'executionResult.error': { $exists: true },
      });

      return {
        totalAlerts,
        activeAlerts,
        executedAlerts,
        failedAlerts,
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw new Error('Error fetching PriceAlert metrics');
    }
  }

  /**
   * Fetch and return all alerts, enriched with current token prices.
   */
  async viewAlerts() {
    try {
      // 1. Fetch all alerts from the database
      const alerts = await PriceAlert.find().lean();
      if (alerts.length === 0) {
        return []; // No alerts, return empty array
      }

      // 2. Use the PriceMonitoringService to get current prices for each token
      const prices = await this.priceMonitoringService.fetchTokenPrices(alerts);

      // 3. Map each alert to a “detailed” object that includes currentPrice
      const detailedAlerts = alerts.map((alert) => {
        const currentPrice = prices?.[alert.tokenAddress] ?? null; // Fallback to null if not found

        return {
          id: alert._id.toString(),
          ...alert,
          currentPrice, // USD price from Jupiter
        };
      });

      return detailedAlerts;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw new Error('Error fetching price alerts');
    }
  }

  /**
   * Fetch an alert by ID.
   */
  async getAlertById(alertId) {
    try {
      const alert = await PriceAlert.findById(alertId);
      if (!alert) {
        return null;
      }
      return {
        id: alert._id.toString(),
        ...alert.toObject(),
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw new Error('Error fetching price alert');
    }
  }

  /**
   * Edit (partially update) an existing alert by ID.
   */
  async editAlert(alertId, updatedData) {
    try {
      const updatedAlert = await PriceAlert.findByIdAndUpdate(
        alertId,
        { $set: updatedData },
        { new: true, runValidators: true }
      );

      if (!updatedAlert) {
        throw new Error(`Alert with ID ${alertId} not found`);
      }

      return {
        id: updatedAlert._id.toString(),
        ...updatedAlert.toObject(),
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw new Error('Error updating price alert');
    }
  }

  /**
   * Delete an alert by ID.
   */
  async deleteAlert(alertId) {
    try {
      const alert = await PriceAlert.findByIdAndDelete(alertId);
      if (!alert) {
        throw new Error(`Alert with ID ${alertId} not found`);
      }
      // In a global monitoring system, we no longer need to stop intervals for specific tokens.
      return { success: true, id: alertId };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw new Error('Error deleting price alert');
    }
  }

  /**
   * Cleanup the monitoring service and event listeners.
   */
  cleanup() {
    // Stop the global polling
    this.priceMonitoringService.stopMonitoring();

    // Remove all event listeners
    this.removeAllListeners();

    // Reset initialization
    this.initialized = false;
    this.initializationPromise = null;
  }
}

export const priceAlertService = new PriceAlertService();

// Handle process termination gracefully
process.on('SIGINT', () => {
  priceAlertService.cleanup();
});

process.on('SIGTERM', () => {
  priceAlertService.cleanup();
});
