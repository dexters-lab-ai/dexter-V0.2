import mongoose from 'mongoose';
import { bot } from '../core/bot.js';
import { EventEmitter } from 'events';
import { PriceAlert } from '../models/PriceAlert.js';
import { walletService } from './wallet/index.js';
import { tradeService } from './trading/TradeService.js';
import { ErrorHandler } from '../core/errors/index.js';
import { PriceMonitoringService } from './trading/PriceMonitoring.js';
import { JupiterQuickNode } from './trading/JupiterQuickNode.js';
import { queueService } from './queue/QueueService.js';
import { dexscreener } from './dexscreener/index.js';
import { getPriceCoinGecko } from './coingecko/CoinGecko.js';

// --- Logging Helpers ---
function logInfo(context, message, extra = {}) {
  console.log(JSON.stringify({ level: 'info', context, message, ...extra }));
}

function logWarn(context, message, extra = {}) {
  console.warn(JSON.stringify({ level: 'warn', context, message, ...extra }));
}

function logError(context, message, extra = {}) {
  console.error(JSON.stringify({ level: 'error', context, message, ...extra }));
}

let IntentProcessor;
// --- PriceAlertService Class ---
class PriceAlertService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.initializationPromise = null;
    // Import dynamically to break circular dependency
    import('./ai/processors/IntentProcessor.js').then(module => {
      IntentProcessor = module.IntentProcessor;
      this.intentProcessor = new IntentProcessor(bot);
    });
    this.priceMonitoringService = new PriceMonitoringService(this);
    this.jupiterQuickNode = new JupiterQuickNode();
    // Easy token info check
    this.dexscreener = dexscreener;
    this.alertQueue = null;
    this.QUEUE_NAME = 'priceAlerts';
    this.JOB_TYPES = {
      EXECUTE_ALERT: 'executeAlert',
      CHECK_PRICE: 'checkPrice'
    };
    // Cache for price data (if multiple alerts check same token quickly)
    this.priceCache = new Map();
    // Fallback monitoring interval (for degraded mode)
    this.fallbackInterval = null;
    // Limit event listeners to avoid leaks
    this.setMaxListeners(20);
  }

  /**
   * Fallback monitoring runs a price check on all active alerts every minute.
   */
  startFallbackMonitoring() {
    if (this.fallbackInterval) return;
    logWarn('PriceAlertService', 'Starting fallback monitoring due to degraded queue service.');
    this.fallbackInterval = setInterval(async () => {
      try {
        const activeAlerts = await PriceAlert.find({ isActive: true }).lean();
        for (const alert of activeAlerts) {
          // Process price check directly without the queue.
          await this.checkAlertPrice(alert._id);
        }
      } catch (error) {
        logError('PriceAlertService', 'Error in fallback price monitoring', { error: error.message });
        await ErrorHandler.handle(error);
      }
    }, 60 * 1000);
  }
  
  stopFallbackMonitoring() {
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
      logInfo('PriceAlertService', 'Fallback monitoring stopped.');
    }
  }

  /**
   * Initializes the service. Uses QueueService if available, otherwise falls back.
   */
  async initialize(resetAlerts = false) {
    if (this.initializationPromise) return this.initializationPromise;
    
    this.initializationPromise = (async () => {
      try {
        // Clear all existing alerts if resetAlerts is true
        if (resetAlerts) {
          logWarn('PriceAlertService', 'Initializing with reset: clearing all existing alerts');
          await this.clearAllAlerts();
        }

        await queueService.initialize();
        if (queueService.degraded) {
          logWarn('PriceAlertService', 'QueueService is degraded. Running in fallback mode.');
          this.startFallbackMonitoring();
        } else {
          // Retrieve dedicated queue and set up job processors.
          this.alertQueue = queueService.getQueue(this.QUEUE_NAME);
          await this.setupJobProcessors();
          // Start the global price monitoring process.
          this.priceMonitoringService.startMonitoring();
        }
        // Initialize an in‑memory price cache.
        this.priceCache = new Map();
        this.initialized = true;
        this.emit('initialized');
        logInfo('PriceAlertService', 'PriceAlertService initialized successfully.');
        return true;
      } catch (error) {
        logError('PriceAlertService', 'Error during initialization', { error: error.message });
        await ErrorHandler.handle(error);
        this.emit('error', error);
        throw error;
      }
    })();
    
    return this.initializationPromise;
  }  

  /**
   * Sets up processors for executing alerts and checking prices with a concurrency limit.
   */
  async setupJobProcessors() {
    // Process execution jobs with a concurrency limit of 3.
    this.alertQueue.process(this.JOB_TYPES.EXECUTE_ALERT, 3, async (job) => {
      const { alertId, currentPrice } = job.data;
      try {
        const alert = await PriceAlert.findById(alertId);
        if (alert && alert.isActive) {
          await this.executeAlert(alert, currentPrice);
          logInfo('PriceAlertService', `Executed alert ${alertId}`, { jobId: job.id });
        }
      } catch (error) {
        logError('PriceAlertService', `Error executing alert ${alertId}`, { jobId: job.id, error: error.message });
        await ErrorHandler.handle(error);
      }
    });

    // Process price check jobs with a concurrency limit of 3.
    this.alertQueue.process(this.JOB_TYPES.CHECK_PRICE, 3, async (job) => {
      const { alertId } = job.data;
      try {
        await this.checkAlertPrice(alertId);
        logInfo('PriceAlertService', `Checked price for alert ${alertId}`, { jobId: job.id });
      } catch (error) {
        logError('PriceAlertService', `Error checking price for alert ${alertId}`, { jobId: job.id, error: error.message });
        await ErrorHandler.handle(error);
      }
    });

    // Job event handlers.
    this.alertQueue.on('completed', (job) => {
      logInfo('PriceAlertService', `Job ${job.id} completed successfully`, { type: job.name });
      this.emit('jobCompleted', { jobId: job.id, type: job.name });
    });
    
    this.alertQueue.on('failed', async (job, error) => {
      logError('PriceAlertService', `Job ${job.id} failed`, { type: job.name, error: error.message });
      await ErrorHandler.handle(error);
      this.emit('jobFailed', { jobId: job.id, type: job.name, error });
    });
  }

  /**
   * Creates a new price alert after performing validations:
   * - Limits active alerts to 10 per user.
   * - Checks for duplicates based on tokenAddress, network, targetPrice, condition, wallet, and amount.
   * If a duplicate exists, returns a graceful error message.
   */
  async createAlert(userId, alertData) {
    try {
      const userIdStr = userId.toString();
  
      // Remove all white spaces from string inputs
      const tokenAddress = alertData.tokenAddress ? alertData.tokenAddress.replace(/\s+/g, '') : '';
      const network = alertData.network ? alertData.network.replace(/\s+/g, '') : '';
      const condition = alertData.condition ? alertData.condition.replace(/\s+/g, '') : '';
      const walletType = alertData.walletType ? alertData.walletType.replace(/\s+/g, '') : 'internal';
      // For numeric or other non-string fields (targetPrice, amount), we assume they are well-formed.
  
      // 1. Limit the maximum number of active alerts per user to 10.
      const existingAlerts = await PriceAlert.find({ userId: userIdStr, isActive: true });
      if (existingAlerts.length >= 10) {
        return {
          success: false,
          message: "Maximum of 10 active alerts per user reached."
        };
      }
  
      // 2. Check for duplicate alerts based on sanitized fields.
      const duplicateAlert = await PriceAlert.findOne({
        userId: userIdStr,
        tokenAddress,
        network,
        targetPrice: alertData.targetPrice,
        condition,
        walletType,
        amount: alertData.amount,
        isActive: true,
      });
  
      if (duplicateAlert) {
        return {
          success: false,
          message: `Price alert already saved for ${tokenAddress} at ${alertData.targetPrice} on ${network} to ${condition} with amount ${alertData.amount}.`
        };
      }
  
      // 3. Create the new alert document using sanitized data.
      const alert = new PriceAlert({
        userId: userIdStr,
        tokenAddress,
        network,
        targetPrice: alertData.targetPrice,
        condition,
        walletType,
        amount: alertData.amount,
        swapAction: alertData.swapAction || { enabled: false },
        isActive: true,
        jobIds: {
          immediate: null,
          recurring: null
        }
      });
  
      await alert.save();
      logInfo('PriceAlertService', `Created alert ${alert._id} for token ${alert.tokenAddress}`);
  
      // Schedule an immediate price check and track job IDs
      const jobs = await this.scheduleAlertCheck(alert._id);
      
      // Update the alert document with job IDs for future reference
      if (jobs && !jobs.fallback) {
        await PriceAlert.findByIdAndUpdate(alert._id, {
          $set: {
            'jobIds.immediate': jobs.immediateJob ? jobs.immediateJob.id : null,
            'jobIds.recurring': jobs.recurringJob ? `recurring_check_${alert._id}` : null
          }
        });
      }
      
      this.emit('alertCreated', {
        userId,
        alertId: alert._id,
        tokenAddress: alert.tokenAddress,
      });
      return { success: true, alert };
    } catch (error) {
      logError('PriceAlertService', 'Error creating alert', { error: error.message });
      await ErrorHandler.handle(error);
      this.emit('error', error);
      throw error;
    }
  }  

  /**
   * Schedules an immediate price check and a recurring job for a given alert.
   * Falls back to direct check if the queue service is degraded.
   * Returns job identifiers for tracking.
   */
  async scheduleAlertCheck(alertId) {
    try {
      if (queueService.degraded || !this.alertQueue) {
        logWarn('PriceAlertService', 'QueueService is degraded; running immediate price check directly.');
        await this.checkAlertPrice(alertId);
        return { fallback: true };
      }
      
      // Check if this alert already has scheduled jobs to avoid duplicates
      const alert = await PriceAlert.findById(alertId);
      if (!alert) {
        throw new Error(`Alert with ID ${alertId} not found`);
      }
      
      // If there's already a recurring job ID, don't create a new one
      if (alert.jobIds && alert.jobIds.recurring) {
        // Check if the job actually exists in the queue
        const existingJobs = await queueService.getRepeatableJobs(this.QUEUE_NAME);
        const jobExists = existingJobs.some(job => job.id === alert.jobIds.recurring);
        
        if (jobExists) {
          logInfo('PriceAlertService', `Recurring job already exists for alert ${alertId}`);
          // Just do an immediate check
          const immediateJob = await this.alertQueue.add(
            this.JOB_TYPES.CHECK_PRICE,
            { alertId },
            {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5000 },
              removeOnComplete: true,
              priority: 1,
              jobId: `check_${alertId}_${Date.now()}`
            }
          );
          return { immediateJob, recurringJob: { id: alert.jobIds.recurring } };
        }
      }
      
      // 3) For the immediate job: use the same uppercase job type
      const immediateJob = await this.alertQueue.add(
        this.JOB_TYPES.CHECK_PRICE,  // "CHECK_PRICE"
        { alertId },
        {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          priority: 1,
          jobId: `check_${alertId}_${Date.now()}`
        }
      );

      // 4) For the repeatable job, also use "CHECK_PRICE"
      const recurringJobKey = `recurring_check_${alertId}`;
      const recurringJob = await queueService.addRepeatableJob(
        this.QUEUE_NAME,
        this.JOB_TYPES.CHECK_PRICE,   // must match .process(...) name exactly
        { alertId },
        { cron: '* * * * *' },        // every minute
        recurringJobKey,
        { removeOnComplete: true, priority: 1 }
      );
      
      // Update the alert with job IDs
      await PriceAlert.findByIdAndUpdate(alertId, {
        $set: {
          'jobIds.immediate': immediateJob.id,
          'jobIds.recurring': recurringJobKey
        }
      });
      
      logInfo('PriceAlertService', `Scheduled price check for alert ${alertId}`);
      return { immediateJob, recurringJob };
    } catch (error) {
      logError('PriceAlertService', `Error scheduling alert check for ${alertId}`, { error: error.message });
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Checks the current price for a given alert and, if the alert condition is met, schedules its execution.
   */
  async checkAlertPrice(alertId) {
    try {
      const alert = await PriceAlert.findById(alertId);
      if (!alert || !alert.isActive) return;

      // Optionally, use a price cache here if multiple alerts target the same token.
      const currentPrice = await this.getCurrentPrice(alert.tokenAddress);
      if (!currentPrice) return;

      if (this.shouldTriggerAlert(alert, currentPrice)) {
        const executeJobId = `execute_${alertId}_${Date.now()}`;
        
        await this.alertQueue.add(
          this.JOB_TYPES.EXECUTE_ALERT,
          { alertId, currentPrice },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
            priority: 1,
            jobId: executeJobId
          }
        );
        
        // Update the alert to track the execution job
        await PriceAlert.findByIdAndUpdate(alertId, {
          $set: {
            'jobIds.execute': executeJobId
          }
        });
        
        logInfo('PriceAlertService', `Triggered alert ${alertId} for price ${currentPrice}`);
      }
    } catch (error) {
      logError('PriceAlertService', `Error checking alert price for ${alertId}`, { error: error.message });
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Determines if an alert should be triggered based on its condition.
   */
  shouldTriggerAlert(alert, currentPrice) {
    return (alert.condition === 'above' && currentPrice >= alert.targetPrice) ||
           (alert.condition === 'below' && currentPrice <= alert.targetPrice);
  }

  async getCurrentPrice(tokenAddress) {
    try {
      // Initialize the in-memory cache if needed.
      if (!this.priceCache) {
        this.priceCache = new Map();
      }
      const now = Date.now();
      const cached = this.priceCache.get(tokenAddress);
      // Cache duration: 30 seconds.
      if (cached && (now - cached.timestamp) < 30000) {
        return cached.price;
      }
  
      // Determine if the token address is EVM or Solana.
      // (EVM addresses typically start with "0x"; assume non-"0x" are Solana)
      const isEvm = tokenAddress.startsWith("0x");
  
      let priceUsd = null;
  
      // --- Attempt 1: DexScreener ---
      try {
        console.log(`🔍 Checking DexScreener for: ${tokenAddress}`);
        const priceRaw = await this.dexscreener.getTokenPriceByAddress(tokenAddress);
        console.log(`🔍 Price Found on DexScreener: ${priceRaw}`);
        priceUsd = parseFloat(priceRaw);
      } catch (dexError) {
        console.warn(`DexScreener failed for ${tokenAddress}: ${dexError.message}`);
      }
  
      // --- Attempt 2: CoinGecko ---
      if (!priceUsd || isNaN(priceUsd)) {
        try {
          console.log(`🔍 Checking CoinGecko for: ${tokenAddress}`);
          const priceRaw = await getPriceCoinGecko(tokenAddress);
          console.log(`🔍 Price Found on CoinGecko: ${priceRaw}`);
          priceUsd = parseFloat(priceRaw);
        } catch (cgError) {
          console.warn(`CoinGecko failed for ${tokenAddress}: ${cgError.message}`);
        }
      }
  
      // --- Attempt 3 (Fallback for Solana only): Jupiter QuickNode ---
      if ((!priceUsd || isNaN(priceUsd)) && !isEvm) {
        try {
          console.log(`🔍 Using Jupiter fallback for: ${tokenAddress}`);
          const quote = await this.jupiterQuickNode.getCachedQuote({
            inputMint: tokenAddress,
            outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mint for Solana
            amount: '1000000000' // 1 unit in smallest denomination
          });
          if (quote && quote.outAmount) {
            priceUsd = parseFloat(quote.outAmount) / 1000000000;
            console.log(`🔍 Price Found via Jupiter fallback: ${priceUsd}`);
          }
        } catch (jupError) {
          console.warn(`Jupiter fallback failed for ${tokenAddress}: ${jupError.message}`);
        }
      }
  
      // If no valid price is found, return null.
      if (!priceUsd || isNaN(priceUsd)) {
        console.warn(`No price found for ${tokenAddress}. Returning null.`);
        return null;
      }
  
      // Cache the found price.
      this.priceCache.set(tokenAddress, { price: priceUsd, timestamp: now });
      return priceUsd;
    } catch (error) {
      console.error(`Error fetching price for ${tokenAddress}:`, error);
      return null;
    }
  }   

  async executeAlert(alert, currentPrice) {
    consolr.log(' * * * * * ALERT !!!! ', alert);
    try {
      let wallet;
      // 1. Retrieve wallet: use getWallet if walletAddress is provided, otherwise fallback.
      if (alert.swapAction && alert.swapAction.walletAddress) {
        wallet = await walletService.getWallet(alert.userId, alert.swapAction.walletAddress);
      } else {
        // get network
        const networkObj = this.intentProcessor.getTokenNetwork(alert.tokenAddress);
        const network = networkObj?.networkFound;
        wallet = await walletService.getWalletByNetwork(alert.userId, network);
      }

      // Ensure we got a wallet, or throw an error.
      if (!wallet) {
        throw new Error("Wallet not found.");
      }
  
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
          // Clean up associated jobs before marking the alert as inactive
          await this.removeAlertJobs(alert._id);
          
          // Update the PriceAlert with the trade result details.
          await PriceAlert.findByIdAndUpdate(alert._id, {
            $set: {
              isActive: false,
              jobIds: { immediate: null, recurring: null, execute: null },
              executionResult: {
                hash: tradeResult.txId,
                executedAt: new Date(),
                price: currentPrice,
                expectedOutput: tradeResult.expectedOutput,
                slippageBps: tradeResult.slippageBps,
                timeTaken: tradeResult.timeTaken,
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
        const timeTaken = tradeResult.timeTaken
          ? `${tradeResult.timeTaken} secs`
          : "0.2 sec";
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
          `• **Speed Taken:** ${timeTaken}\n\n` +
          `**Time:** ${nowFormatted}\n\n` +
          `*This trade was automatically executed based on your price alert set 'action'.*`;
  
        await bot.sendMessage(alert.userId, message, { parse_mode: "Markdown" });
      } else {
        // Clean up associated jobs before marking the alert as inactive
        await this.removeAlertJobs(alert._id);
        
        // If swap action is disabled, mark the alert as inactive.
        await PriceAlert.findByIdAndUpdate(alert._id, {
          $set: {
            isActive: false,
            jobIds: { immediate: null, recurring: null, execute: null },
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
      // Clean up associated jobs even on error
      await this.removeAlertJobs(alert._id);
      
      // On error, update the alert document with the error details.
      await PriceAlert.findByIdAndUpdate(alert._id, {
        $set: {
          isActive: false,
          jobIds: { immediate: null, recurring: null, execute: null },
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
   * If userId is falsy (null/undefined), returns all alerts
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
  
      // Verify jobs exist for active alerts and fix if necessary
      for (const alert of alerts) {
        if (alert.isActive) {
          await this.ensureJobsExist(alert._id);
        }
      }
  
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
   * Ensures that active alerts have associated jobs in the queue.
   * If jobs are missing, creates them.
   */
  async ensureJobsExist(alertId) {
    try {
      if (queueService.degraded || !this.alertQueue) return;
      
      const alert = await PriceAlert.findById(alertId);
      if (!alert || !alert.isActive) return;
      
      let needsJobUpdate = false;
      
      // Check if recurring job exists
      if (!alert.jobIds?.recurring) {
        needsJobUpdate = true;
      } else {
        // Verify the job actually exists in the queue
        const repeatableJobs = await queueService.getRepeatableJobs(this.QUEUE_NAME);
        const jobExists = repeatableJobs.some(job => 
          job.id === alert.jobIds.recurring || 
          job.key.includes(`recurring_check_${alertId}`)
        );
        
        if (!jobExists) {
          needsJobUpdate = true;
        }
      }
      
      // If jobs need to be created, schedule them
      if (needsJobUpdate) {
        logWarn('PriceAlertService', `Fixing missing jobs for alert ${alertId}`);
        await this.removeAlertJobs(alertId);
        const jobs = await this.scheduleAlertCheck(alertId);
        
        if (jobs && !jobs.fallback) {
          await PriceAlert.findByIdAndUpdate(alertId, {
            $set: {
              'jobIds.immediate': jobs.immediateJob ? jobs.immediateJob.id : null,
              'jobIds.recurring': jobs.recurringJob ? `recurring_check_${alertId}` : null
            }
          });
        }
      }
    } catch (error) {
      logError('PriceAlertService', `Error ensuring jobs for alert ${alertId}`, { error: error.message });
      await ErrorHandler.handle(error);
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
      // If the alert is being deactivated, clean up its jobs first
      if (updatedData.hasOwnProperty('isActive') && !updatedData.isActive) {
        await this.removeAlertJobs(alertId);
        // Make sure to nullify job IDs in the update
        updatedData.jobIds = { immediate: null, recurring: null, execute: null };
      }
      
      const updatedAlert = await PriceAlert.findByIdAndUpdate(
        alertId,
        { $set: updatedData },
        { new: true, runValidators: true }
      );

      if (!updatedAlert) {
        throw new Error(`Alert with ID ${alertId} not found`);
      }
      
      // If alert is active but we're changing parameters that affect triggering,
      // reschedule the jobs to ensure proper monitoring
      if (updatedAlert.isActive && (
        updatedData.hasOwnProperty('targetPrice') || 
        updatedData.hasOwnProperty('condition') ||
        updatedData.hasOwnProperty('tokenAddress')
      )) {
        await this.removeAlertJobs(alertId);
        const jobs = await this.scheduleAlertCheck(alertId);
        
        if (jobs && !jobs.fallback) {
          updatedAlert.jobIds = {
            immediate: jobs.immediateJob ? jobs.immediateJob.id : null,
            recurring: jobs.recurringJob ? `recurring_check_${alertId}` : null,
            execute: null
          };
          await updatedAlert.save();
        }
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
   * Deletes an alert and removes all associated jobs.
   * Ensures the alert no longer appears in viewAlerts results.
   */
  async deleteAlert(alertId) {
    try {
      // Validate that the provided alertId is a valid ObjectId
      if (!mongoose.Types.ObjectId.isValid(alertId)) {
        throw new Error(`Invalid alert ID provided: ${alertId}`);
      }
      
      // First find the alert to ensure it exists
      const alert = await PriceAlert.findById(alertId);
      if (!alert) {
        logWarn('PriceAlertService', `Alert ${alertId} not found for deletion`);
        return { success: false, message: 'Alert not found' };
      }
      
      // Remove all associated jobs before deleting the alert
      await this.removeAlertJobs(alertId);
      
      // Permanently delete the alert from the database
      const result = await PriceAlert.deleteOne({ _id: alertId });
      
      if (result.deletedCount === 1) {
        logInfo('PriceAlertService', `Successfully deleted alert ${alertId}`);
        this.emit('alertDeleted', { alertId });
        return { success: true, message: 'Alert deleted successfully' };
      } else {
        // This should rarely happen since we already checked existence
        logWarn('PriceAlertService', `No alerts were deleted for ID ${alertId}`);
        return { success: false, message: 'Alert could not be deleted' };
      }
    } catch (error) {
      logError('PriceAlertService', `Error deleting alert ${alertId}`, { error: error.message });
      await ErrorHandler.handle(error);
      throw new Error(`Error deleting price alert: ${error.message}`);
    }
  }

  /**
   * Removes all queue jobs associated with an alert.
   * Cleans up both immediate and recurring jobs.
   */
  async removeAlertJobs(alertId) {
    try {
      if (queueService.degraded || !this.alertQueue) {
        logInfo('PriceAlertService', `Queue service unavailable, no jobs to remove for alert ${alertId}`);
        return;
      }
      
      // Get the alert to access its job IDs
      const alert = await PriceAlert.findById(alertId);
      if (!alert) {
        logWarn('PriceAlertService', `Cannot remove jobs: Alert ${alertId} not found`);
        return;
      }
      
      // Remove the immediate job if it exists
      if (alert.jobIds?.immediate) {
        try {
          await this.alertQueue.removeJobs(alert.jobIds.immediate);
          logInfo('PriceAlertService', `Removed immediate job ${alert.jobIds.immediate} for alert ${alertId}`);
        } catch (error) {
          logWarn('PriceAlertService', `Failed to remove immediate job ${alert.jobIds.immediate}`, { error: error.message });
        }
      }
      
      // Remove the execution job if it exists
      if (alert.jobIds?.execute) {
        try {
          await this.alertQueue.removeJobs(alert.jobIds.execute);
          logInfo('PriceAlertService', `Removed execution job ${alert.jobIds.execute} for alert ${alertId}`);
        } catch (error) {
          logWarn('PriceAlertService', `Failed to remove execution job ${alert.jobIds.execute}`, { error: error.message });
        }
      }
      
      // Remove the recurring job if it exists
      if (alert.jobIds?.recurring) {
        try {
          await queueService.removeRepeatableJob(
            this.QUEUE_NAME,
            alert.jobIds.recurring
          );
          logInfo('PriceAlertService', `Removed recurring job ${alert.jobIds.recurring} for alert ${alertId}`);
        } catch (error) {
          logWarn('PriceAlertService', `Failed to remove recurring job ${alert.jobIds.recurring}`, { error: error.message });
        }
      }
      
      // Update the alert to clear job IDs
      await PriceAlert.findByIdAndUpdate(alertId, {
        $set: { 'jobIds': { immediate: null, recurring: null, execute: null } }
      });
      
      logInfo('PriceAlertService', `Successfully removed all jobs for alert ${alertId}`);
    } catch (error) {
      logError('PriceAlertService', `Error removing jobs for alert ${alertId}`, { error: error.message });
      await ErrorHandler.handle(error);
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
        status: activeAlerts > 0 ? 'healthy' : 'unhealthy',
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
   * Clears all price alerts from the database and removes associated jobs.
   * Should be used carefully, typically only during system initialization or reset.
   */
  async clearAllAlerts() {
    try {
      logWarn('PriceAlertService', 'Starting to clear all price alerts from the database');
      
      // Find all alerts to get their IDs for job removal
      const allAlerts = await PriceAlert.find({});
      const totalCount = allAlerts.length;
      
      logInfo('PriceAlertService', `Found ${totalCount} alerts to clear`);
      
      // Clean up jobs for each alert
      if (!queueService.degraded && this.alertQueue) {
        logInfo('PriceAlertService', 'Removing all alert-related jobs from the queue');
        
        // Process in batches to avoid overwhelming the queue service
        const batchSize = 50;
        for (let i = 0; i < allAlerts.length; i += batchSize) {
          const batch = allAlerts.slice(i, i + batchSize);
          await Promise.all(batch.map(alert => this.removeAlertJobs(alert._id)));
          logInfo('PriceAlertService', `Removed jobs for ${i + batch.length}/${totalCount} alerts`);
        }
      }
      
      // Delete all alerts from the database
      const result = await PriceAlert.deleteMany({});
      
      logInfo('PriceAlertService', `Successfully cleared ${result.deletedCount} price alerts from the database`);
      this.emit('allAlertsCleared', { count: result.deletedCount });
      
      return { 
        success: true, 
        message: `Successfully cleared ${result.deletedCount} price alerts`,
        alertsRemoved: result.deletedCount
      };
    } catch (error) {
      logError('PriceAlertService', 'Error clearing all price alerts', { error: error.message });
      await ErrorHandler.handle(error);
      throw new Error(`Failed to clear price alerts: ${error.message}`);
    }
  }

  async cleanup() {
    // Stop price monitoring
    this.priceMonitoringService.stopMonitoring();
    this.stopFallbackMonitoring(); // Stop fallback timer if active
  
    // Clean up all jobs in the queue (if available)
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
