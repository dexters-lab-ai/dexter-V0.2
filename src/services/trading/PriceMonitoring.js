import { PriceAlert } from '../../models/PriceAlert.js';
import { JupiterQuickNode } from './JupiterQuickNode.js';
import dotenv from 'dotenv';
import { bot } from '../../core/bot.js';
import { dexscreener } from '../dexscreener/index.js';

// Load environment variables
dotenv.config();

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

/**
 * A polling-based price monitoring service that periodically:
 *  1. Fetches all active alerts from the DB
 *  2. Retrieves prices from Jupiter
 *  3. Checks if each alert has been triggered
 *  4. Calls priceAlertService.executeAlert for triggered alerts
 */
let IntentProcessor;
export class PriceMonitoringService {
  constructor(priceAlertService) {
    // Import dynamically to break circular dependency
    import('../ai/processors/IntentProcessor.js').then(module => {
      IntentProcessor = module.IntentProcessor;
      this.intentProcessor = new IntentProcessor(bot);
    });

    // priceAlertService is passed so we can call its `executeAlert` method
    this.priceAlertService = priceAlertService;

    // How often to poll, in milliseconds (currently set to 5 minutes; adjust if needed)
    this.alertCheckInterval = 300000;

    // Holds the setInterval() ID so we can stop monitoring later
    this.monitoringIntervalId = null;

    // Jupiter client for price fetching
    this.jupiterQuickNode = new JupiterQuickNode();

    // Easy token info check
    this.dexscreener = dexscreener;
  }

  /**
   * Start the global polling loop.
   */
  startMonitoring() {
    if (this.monitoringIntervalId) {
      console.log('💲 [PriceMonitoring] Already monitoring. Skipped.');
      return;
    }    
    console.log(`💲 [PriceMonitoring] Started polling every ${this.alertCheckInterval} ms`);

    // Optionally, run monitorPrices immediately
    this.monitorPrices();

    // Start the polling loop
    this.monitoringIntervalId = setInterval(() => {
      this.monitorPrices();
    }, this.alertCheckInterval);
  }

  /**
   * Stop the global polling loop.
   */
  stopMonitoring() {
    if (this.monitoringIntervalId) {
      clearInterval(this.monitoringIntervalId);
      this.monitoringIntervalId = null;
      console.log('🔴 [PriceMonitoring] Stopped monitoring.');
    }
  }

  /**
   * Fetch current prices for all tokens that appear in the given alerts,
   * using 1 USDC as the "input" to find out how much 1 token costs in USD.
   */
  async fetchTokenPrices(alerts) {
    // Gather unique token addresses from the alerts, trimming each address.
    const tokenAddresses = [
        ...new Set(alerts.map(alert => alert.tokenAddress.trim()))
    ];

    // Use 1 USDC as input amount (adjust these values as needed)
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC on Solana
    const oneUsdcAmount = 1_000_000; // 1 USDC in lamports (6 decimals)

    try {
        // Filter out any blacklisted tokens if necessary.
        const filteredTokens = tokenAddresses.filter(
            (t) => t !== 'BkYAUVMar1gwuFLv2n5cmB6HhcNtvd86kU3gqAypump'
        );

        // For each token, first try DexScreener, then fall back to Jupiter
        const pricePromises = filteredTokens.map(async (tokenMint) => {
            try {
                console.log(`🔍 Checking DexScreener for: ${tokenMint}`);

                // Attempt to get token info from DexScreener
                const priceRaw = await this.dexscreener.getTokenPriceByAddress(tokenMint);
                console.log(`🔍 Token Found: ${priceRaw}`);
                const priceUsd = parseFloat(priceRaw);

                if (!isNaN(priceUsd) && priceUsd > 0) {
                    console.log(`✅ Found price on DexScreener for ${tokenMint}: $${priceUsd}`);
                    return { token: tokenMint.trim(), price: priceUsd };
                }
                

                console.log(`⚠️ DexScreener data missing or invalid for ${tokenMint}, falling back to Jupiter`);

                // Fall back to Jupiter
                const quoteParams = {
                    inputMint: usdcMint,
                    outputMint: tokenMint.trim(),
                    amount: oneUsdcAmount,
                };

                console.log(`>>> Fetching Jupiter quote for: ${tokenMint}`);
                const response = await this.jupiterQuickNode.getCachedQuote(quoteParams);
                const inAmount = parseFloat(response.inAmount);
                const outAmount = parseFloat(response.outAmount);

                if (!inAmount || !outAmount || inAmount <= 0 || outAmount <= 0) {
                    throw new Error('Invalid Jupiter quote received');
                }

                // Calculate price: 1 / (tokens received per 1 USDC)
                const ratio = outAmount / inAmount;
                const tokenPriceInUsd = 1 / ratio;
                console.log(`✅ Fallback Jupiter price for ${tokenMint}: $${tokenPriceInUsd}`);

                return { token: tokenMint.trim(), price: tokenPriceInUsd };
            } catch (error) {
                console.error(`❌ Error fetching price for ${tokenMint}:`, error.message);
                return { token: tokenMint.trim(), price: null };
            }
        });

        const results = await Promise.all(pricePromises);
        const prices = results.reduce((acc, { token, price }) => {
            if (price !== null && !Number.isNaN(price)) {
                acc[token] = price;
            }
            return acc;
        }, {});

        return prices;
    } catch (error) {
        console.error('❌ Error fetching token prices:', error.message);
        return null;
    }
  }

  /**
   * Main polling method: fetch alerts, get prices, trigger alerts if conditions are met.
   */
  async monitorPrices() {
    try {
      // 1. Fetch all active alerts from the database.
      const activeAlerts = await PriceAlert.find({ isActive: true }).lean();
      logInfo('PriceMonitoring', `Found ${activeAlerts.length} active alerts in DB.`);
      if (!activeAlerts.length) {
        return;
      }
  
      // 2. Fetch token prices in bulk.
      const prices = await this.fetchTokenPrices(activeAlerts);
      if (!prices || Object.keys(prices).length === 0) {
        logWarn('PriceMonitoring', 'No token prices fetched.');
        return;
      }
      logInfo('PriceMonitoring', 'Fetched token prices', { prices });
  
      // 3. Check each alert against the current price.
      for (const alert of activeAlerts) {
        // Use the trimmed token address to access the price map.
        const tokenKey = alert.tokenAddress.trim();
        const currentPrice = prices[tokenKey];
        if (typeof currentPrice !== 'number') {
          logWarn('PriceMonitoring', `No valid price found for token ${tokenKey} in alert ${alert._id}`);
          continue;
        }
        
        logInfo('PriceMonitoring', `Checking alert ${alert._id}`, {
          token: tokenKey,
          targetPrice: alert.targetPrice,
          currentPrice,
          condition: alert.condition
        });
        
        const meetsAbove = alert.condition === 'above' && currentPrice >= alert.targetPrice;
        const meetsBelow = alert.condition === 'below' && currentPrice <= alert.targetPrice;
        
        // Trigger the alert if either condition is met.
        if (meetsAbove || meetsBelow) {
          // 4. Atomically mark the alert as inactive to prevent duplicate processing.
          const updatedAlert = await PriceAlert.findOneAndUpdate(
            { _id: alert._id, isActive: true },
            { $set: { isActive: false } },
            { new: true }
          );
  
          console.log("Triggered alert update:", updatedAlert);
  
          if (updatedAlert) {
            logInfo('PriceMonitoring', `Alert ${alert._id} triggered; executing alert with currentPrice ${currentPrice}.`);
            await this.priceAlertService.executeAlert(updatedAlert, currentPrice);
          } else {
            logWarn('PriceMonitoring', `Alert ${alert._id} was already claimed by another process.`);
          }
        }
      }
    } catch (error) {
      logError('PriceMonitoring', 'Error in monitorPrices', { error: error.message });
    }
  }
  
  
}
