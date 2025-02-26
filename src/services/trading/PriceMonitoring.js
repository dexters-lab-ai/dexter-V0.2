import { PriceAlert } from '../../models/PriceAlert.js';
import { JupiterQuickNode } from './JupiterQuickNode.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * A polling-based price monitoring service that periodically:
 *  1. Fetches all active alerts from the DB
 *  2. Retrieves prices from Jupiter
 *  3. Checks if each alert has been triggered
 *  4. Calls priceAlertService.executeAlert for triggered alerts
 */
export class PriceMonitoringService {
  constructor(priceAlertService) {
    // priceAlertService is passed so we can call its `executeAlert` method
    this.priceAlertService = priceAlertService;

    // How often to poll, in milliseconds
    this.alertCheckInterval = 60000; // 1 minute

    // Will hold the setInterval() ID so we can stop monitoring
    this.monitoringIntervalId = null;

    // Jupiter client for price fetching
    this.jupiterQuickNode = new JupiterQuickNode();
  }

  /**
   * Start the global polling loop.
   */
  startMonitoring() {
    if (this.monitoringIntervalId) {
      console.log('[PriceMonitoring] Already monitoring. Skipped.');
      return;
    }

    // Optionally run one check immediately on startup
    this.monitorPrices();

    // Then schedule repeated checks
    this.monitoringIntervalId = setInterval(() => {
      this.monitorPrices();
    }, this.alertCheckInterval);

    console.log(`[PriceMonitoring] Started polling every ${this.alertCheckInterval} ms`);
  }

  /**
   * Stop the global polling loop.
   */
  stopMonitoring() {
    if (this.monitoringIntervalId) {
      clearInterval(this.monitoringIntervalId);
      this.monitoringIntervalId = null;
      console.log('[PriceMonitoring] Stopped monitoring.');
    }
  }

  /**
   * Fetch current prices for all tokens that appear in the given alerts,
   * using 1 USDC as the "input" to find out how much 1 token costs in USD.
   */
  async fetchTokenPrices(alerts) {
    // Gather unique token addresses from the alerts
    const tokenAddresses = [...new Set(alerts.map((alert) => alert.tokenAddress))];
    // console.log('[PriceMonitoring] Unique token addresses:', tokenAddresses);
  
    // We'll use 1 USDC as the input amount to get price in USD
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC on Solana
    const oneUsdcAmount = 1_000_000; // 1 USDC = 10^6 in lamports (6 decimals)
  
    try {
      // Filter out any blacklisted or unwanted tokens if needed
      const filteredTokens = tokenAddresses.filter(
        (t) => t !== 'BkYAUVMar1gwuFLv2n5cmB6HhcNtvd86kU3gqAypump'
      );
  
      // For each token, ask Jupiter: "If I swap 1 USDC, how many tokens do I get?"
      const pricePromises = filteredTokens.map(async (tokenMint) => {
        try {
          const quoteParams = {
            inputMint: usdcMint,   // we are giving USDC
            outputMint: tokenMint, // we want that token
            amount: oneUsdcAmount, // exactly 1 USDC in lamports
          };
  
          const response = await this.jupiterQuickNode.getCachedQuote(quoteParams);
          // console.log('[PriceMonitoring] Jupiter Quote:', response);
  
          // If "response" is not nested, parse ratio from outAmount / inAmount
          const inAmount = parseFloat(response.inAmount);
          const outAmount = parseFloat(response.outAmount);
  
          if (!inAmount || !outAmount || inAmount <= 0 || outAmount <= 0) {
            return { token: tokenMint, price: null };
          }
  
          // ratio = how many tokens per 1 USDC
          const ratio = outAmount / inAmount; 
          // priceInUsdFor1Token = 1 / ratio
          const tokenPriceInUsd = 1 / ratio;
  
          return { token: tokenMint, price: tokenPriceInUsd };
        } catch (error) {
          console.error(`❌ Error fetching price for ${tokenMint}:`, error.message);
          return { token: tokenMint, price: null };
        }
      });
  
      // Resolve all promises
      const results = await Promise.all(pricePromises);
  
      // Convert array of { token, price } into an object map { [token]: price }
      const prices = results.reduce((acc, { token, price }) => {
        if (price !== null && !Number.isNaN(price)) {
          acc[token] = price;
        }
        return acc;
      }, {});
  
      // Log the final prices map for verification
      // console.log('[PriceMonitoring] Fetched token prices (USD):', prices);
  
      return prices;
    } catch (error) {
      console.error('❌ Error fetching prices from Jupiter:', error.message);
      return null;
    }
  }  

  /**
   * Main polling method: fetch alerts, get prices, trigger alerts if conditions are met.
   */
  async monitorPrices() {
    try {
      // 1. Get all active alerts
      const activeAlerts = await PriceAlert.find({ isActive: true }).lean();
      if (!activeAlerts.length) {
        return; // Nothing to do
      }

      // 2. Fetch token prices in bulk
      const prices = await this.fetchTokenPrices(activeAlerts);
      if (!prices) {
        return; // Could not fetch prices, skip
      }

      // 3. Check trigger conditions for each alert
      for (const alert of activeAlerts) {
        const currentPrice = prices[alert.tokenAddress];
        if (typeof currentPrice !== 'number') {
          // If no price was found for this token
          continue;
        }

        // Log the comparison for debug
        /*
        console.log(
          `[PriceMonitoring] Checking alert ID ${alert._id} for token ${alert.tokenAddress}:\n` +
          `  targetPrice=${alert.targetPrice}, currentPrice=${currentPrice}, condition=${alert.condition}`
        );
        */

        const meetsAbove =
          alert.condition === 'above' && currentPrice >= alert.targetPrice;
        const meetsBelow =
          alert.condition === 'below' && currentPrice <= alert.targetPrice;

        if (meetsAbove || meetsBelow) {
          // 4. Mark the alert as inactive in an atomic update to avoid double-processing
          const updatedAlert = await PriceAlert.findOneAndUpdate(
            { _id: alert._id, isActive: true },
            { $set: { isActive: false } },
            { new: true }
          );

          // If another process already claimed it, updatedAlert will be null
          if (updatedAlert) {
            // Trigger the actual alert execution (trade, logging, etc.)
            await this.priceAlertService.executeAlert(updatedAlert, currentPrice);
          }
        }
      }
    } catch (error) {
      console.error('[PriceMonitoring] Error in monitorPrices:', error.message);
    }
  }
}
