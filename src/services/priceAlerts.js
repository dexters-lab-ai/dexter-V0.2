import { bot } from '../core/bot.js';
import { EventEmitter } from 'events';
import { PriceAlert } from '../models/PriceAlert.js';
import { walletService } from './wallet/index.js';
import { tradeService } from './trading/TradeService.js';
import { ErrorHandler } from '../core/errors/index.js';
import { PriceMonitoringService } from './trading/PriceMonitoring.js';
import { JupiterQuickNode } from './trading/JupiterQuickNode.js';
import { queueService } from './queue/QueueService.js';

class PriceAlertService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.initializationPromise = null;
    this.priceMonitoringService = new PriceMonitoringService(this);
    this.jupiterQuickNode = new JupiterQuickNode();
    this.alertQueue = null;
    this.QUEUE_NAME = 'priceAlerts';
    this.JOB_TYPES = {
      EXECUTE_ALERT: 'executeAlert',
      CHECK_PRICE: 'checkPrice'
    };
  }

  async initialize() {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        // Initialize queue service
        await queueService.initialize();
        
        // Get dedicated queue for price alerts
        this.alertQueue = queueService.getQueue(this.QUEUE_NAME);
        
        // Set up job processors
        await this.setupJobProcessors();
        
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

  async setupJobProcessors() {
    // Process alert execution jobs
    this.alertQueue.process(this.JOB_TYPES.EXECUTE_ALERT, async (job) => {
      const { alertId, currentPrice } = job.data;
      const alert = await PriceAlert.findById(alertId);
      if (alert && alert.isActive) {
        await this.executeAlert(alert, currentPrice);
      }
    });

    // Process price check jobs
    this.alertQueue.process(this.JOB_TYPES.CHECK_PRICE, async (job) => {
      const { alertId } = job.data;
      await this.checkAlertPrice(alertId);
    });

    // Handle completed jobs
    this.alertQueue.on('completed', (job) => {
      console.log(`✅ Job ${job.id} completed successfully`);
      this.emit('jobCompleted', { jobId: job.id, type: job.name });
    });

    // Handle failed jobs
    this.alertQueue.on('failed', async (job, error) => {
      console.error(`❌ Job ${job.id} failed:`, error);
      await ErrorHandler.handle(error);
      this.emit('jobFailed', { jobId: job.id, type: job.name, error });
    });
  }

  async createAlert(userId, alertData) {
    try {
      const alert = new PriceAlert({
        userId: userId.toString(),
        tokenAddress: alertData.tokenAddress,
        network: alertData.network,
        targetPrice: alertData.targetPrice,
        condition: alertData.condition,
        walletType: alertData.walletType || 'internal',
        swapAction: alertData.swapAction || { enabled: false },
        isActive: true,
      });

      await alert.save();

      // Schedule immediate price check
      await this.scheduleAlertCheck(alert._id);

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

  async scheduleAlertCheck(alertId) {
    try {
      // Add immediate price check job
      const immediateJob = await this.alertQueue.add(
        this.JOB_TYPES.CHECK_PRICE,
        { alertId },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000
          },
          removeOnComplete: true,
          jobId: `check_${alertId}_${Date.now()}`
        }
      );

      // Add recurring price check (every minute)
      const recurringJob = await queueService.addRecurringJob(
        this.QUEUE_NAME,
        this.JOB_TYPES.CHECK_PRICE,
        { alertId },
        '* * * * *', // Every minute
        {
          jobId: `recurring_check_${alertId}`,
          removeOnComplete: true
        }
      );

      return { immediateJob, recurringJob };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async checkAlertPrice(alertId) {
    try {
      const alert = await PriceAlert.findById(alertId);
      if (!alert || !alert.isActive) return;

      const currentPrice = await this.getCurrentPrice(alert.tokenAddress);
      if (!currentPrice) return;

      const shouldTrigger = this.shouldTriggerAlert(alert, currentPrice);
      if (shouldTrigger) {
        await this.alertQueue.add(
          this.JOB_TYPES.EXECUTE_ALERT,
          { alertId, currentPrice },
          {
            attempts: 3,
            backoff: {
              type: 'exponential',
              delay: 5000
            },
            removeOnComplete: true,
            jobId: `execute_${alertId}_${Date.now()}`
          }
        );
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  shouldTriggerAlert(alert, currentPrice) {
    return (alert.condition === 'above' && currentPrice >= alert.targetPrice) ||
           (alert.condition === 'below' && currentPrice <= alert.targetPrice);
  }

  async getCurrentPrice(tokenAddress) {
    try {
      const quote = await this.jupiterQuickNode.getCachedQuote({
        inputMint: tokenAddress,
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        amount: '1000000000' // 1 unit in smallest denomination
      });

      if (!quote?.outAmount) return null;
      return parseFloat(quote.outAmount) / 1000000000;
    } catch (error) {
      console.error(`Error fetching price for ${tokenAddress}:`, error);
      return null;
    }
  }

  async executeAlert(alert, currentPrice) {
    try {
      // Retrieve the wallet for the alert.
      const wallet = await walletService.getWallet(alert.userId, alert.walletAddress);
  
      // For WalletConnect wallets, ensure token approval if not already pre-approved.
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
  
      // Determine the amount to trade. If expressed as a percentage, compute it.
      let amount = alert.swapAction?.amount || '0';
      if (typeof amount === 'string' && amount.endsWith('%')) {
        const percentage = parseFloat(amount);
        const balance = await walletService.getTokenBalance(alert.userId, alert.tokenAddress);
        amount = String((balance * percentage) / 100);
      }
  
      // Proceed only if swap action is enabled.
      if (alert.swapAction?.enabled) {
        let tradeSuccess = false;
        let tradeResult = null;
  
        // Determine input and output mints based on the swap action type.
        const inputMint = alert.swapAction.type === 'buy'
          ? 'So11111111111111111111111111111111111111112'  // Native SOL mint
          : alert.tokenAddress;
        const outputMint = alert.swapAction.type === 'buy'
          ? alert.tokenAddress
          : 'So11111111111111111111111111111111111111112';
  
        // Attempt to execute the trade via the primary swap controller route.
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
            console.error(`Trade attempt ${attempt + 1} failed:`, tradeError);
          }
        }
  
        // Fallback: For Solana, if primary route fails, try JupiterQuickNode.
        if (!tradeSuccess && alert.network === 'solana') {
          console.log('[executeAlert] Retrying via JupiterQuickNode...');
          try {
            tradeResult = await tradeService.jupiterQuickNode.startJupiterSwap({
              wallet,
              inputMint,
              outputMint,
              amount,
              userId: alert.userId,
            });
            tradeSuccess = true;
          } catch (jupiterError) {
            console.error(`[executeAlert] JupiterQuickNode swap failed: ${jupiterError.message}`);
          }
        }
  
        if (tradeSuccess && tradeResult && tradeResult.txId) {
          // Update the PriceAlert with the trade result details.
          await PriceAlert.findByIdAndUpdate(alert._id, {
            $set: {
              isActive: false,
              executionResult: {
                hash: tradeResult.txId,
                executedAt: new Date(),
                price: currentPrice,
                expectedOutput: tradeResult.expectedOutput,
                slippageBps: tradeResult.slippageBps,
                dynamicSlippage: tradeResult.dynamicSlippage,
              },
            },
          });
  
          this.emit('alertTriggered', {
            userId: alert.userId,
            alertId: alert._id,
            price: currentPrice,
          });
        } else {
          throw new Error('Trade failed on all attempts.');
        }
  
        // Format trade details for a user-friendly message.
        const formattedInput = parseFloat(amount).toFixed(4) + " SOL";
        const formattedOutput = (tradeResult.expectedOutput !== undefined)
          ? parseFloat(tradeResult.expectedOutput).toFixed(4) + " " + (alert.swapAction.type === 'buy' ? alert.tokenAddress : 'SOL')
          : "N/A";
        const slippageInfo = tradeResult.slippageBps ? `${tradeResult.slippageBps} bps` : "N/A";
        const dynamicSlippage = tradeResult.dynamicSlippage
          ? `${tradeResult.dynamicSlippage.minBps}-${tradeResult.dynamicSlippage.maxBps} bps`
          : "N/A";
        const nowFormatted = new Date().toLocaleString();
  
        // Craft the final message for the user.
        function truncateString(str, maxLength = 10) { return str.length > maxLength ? str.slice(0, maxLength) + '...' : str; }
        const truncatedTokenAddress = truncateString(alert.tokenAddress, 10);

        const message =
          `📢 **Price Alert Swap Txn**\n\n` +
          `**Action:** ${alert.swapAction.type}\n` +
          `**Token:** ${truncatedTokenAddress}\n` +
          `**Network:** ${alert.network}\n\n` +
          `**Swap Details:**\n` +
          `• **Input Amount:** ${formattedInput}\n` +
          `• **Expected Output:** ${formattedOutput}\n` +
          `• **Static Slippage:** ${slippageInfo}\n` +
          `• **Dynamic Slippage:** ${dynamicSlippage}\n\n` +
          `**Time:** ${nowFormatted}\n\n` +
          `*This trade was automatically executed based on your price alert set 'action'.*`;
  
        await bot.sendMessage(alert.userId, message, { parse_mode: "Markdown" });
      } else {
        // If swap action is disabled, mark the alert as inactive.
        await PriceAlert.findByIdAndUpdate(alert._id, {
          $set: {
            isActive: false,
            executionResult: {
              executedAt: new Date(),
              price: currentPrice,
            },
          },
        });
        this.emit('alertTriggered', {
          userId: alert.userId,
          alertId: alert._id,
          price: currentPrice,
        });
      }
    } catch (error) {
      // On error, update the alert document with the error details.
      await PriceAlert.findByIdAndUpdate(alert._id, {
        $set: {
          isActive: false,
          executionResult: {
            error: error.message,
            executedAt: new Date(),
          },
        },
      });
      await ErrorHandler.handle(error);
      this.emit('alertFailed', {
        userId: alert.userId,
        alertId: alert._id,
        error,
      });
    }
  }
  
  // Utility
  /**
   * Returns an array of alerts for a specific user.
   * If userId is falsy (null/undefined), returns all alerts (if that's desired).
   */
  async viewAlerts(userId) {
    try {
      console.log('➡️ [viewAlerts] Entering method with userId:', userId);
  
      // Build the query based on userId
      const query = userId ? { userId: userId.toString() } : {};
      console.log('➡️ [viewAlerts] Mongo query:', query);
  
      // Fetch alerts from the database
      const alerts = await PriceAlert.find(query).lean();
      console.log('➡️ [viewAlerts] Alerts found in DB:', alerts);
  
      if (!alerts || alerts.length === 0) {
        console.log('➡️ [viewAlerts] No alerts found. Returning "Create some alerts..." message.');
        return ['Create some alerts, none found...'];
      }
  
      // Retrieve current prices
      console.log('➡️ [viewAlerts] Fetching token prices for alerts...');
      const prices = await this.priceMonitoringService.fetchTokenPrices(alerts);
      console.log('➡️ [viewAlerts] Prices returned:', prices);
  
      // Attach current price to each alert
      const detailedAlerts = alerts.map((alert) => {
        const currentPrice = prices?.[alert.tokenAddress] ?? null;
        return {
          id: alert._id.toString(),
          ...alert,
          currentPrice,
        };
      });
  
      console.log('➡️ [viewAlerts] Detailed alerts with currentPrice:', detailedAlerts);
      console.log('➡️ [viewAlerts] Returning detailed alerts.');
  
      return {detailedAlerts};
    } catch (error) {
      console.error('❌ [viewAlerts] Caught error:', error);
      await ErrorHandler.handle(error);
      throw new Error('Error fetching price alerts');
    }
  }  

  /**
   * Retrieves one alert by Mongo _id.
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
   * Edits alert data by alertId.
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
   * Deletes an alert.
   */
  async deleteAlert(alertId) {
    try {
      const alert = await PriceAlert.findByIdAndDelete(alertId);
      if (!alert) {
        throw new Error(`Alert with ID ${alertId} not found`);
      }
      return { success: true, id: alertId };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw new Error('Error deleting price alert');
    }
  }

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

  async cleanup() {
    // Stop price monitoring
    this.priceMonitoringService.stopMonitoring();

    // Clean up all jobs
    if (this.alertQueue) {
      await this.alertQueue.clean(0, 'completed');
      await this.alertQueue.clean(0, 'failed');

      // Remove all repeatable jobs
      const repeatableJobs = await this.alertQueue.getRepeatableJobs();
      await Promise.all(
        repeatableJobs.map(job => this.alertQueue.removeRepeatableByKey(job.key))
      );
    }

    // Remove all listeners
    this.removeAllListeners();
    
    this.initialized = false;
    this.initializationPromise = null;
  }
}

export const priceAlertService = new PriceAlertService();
