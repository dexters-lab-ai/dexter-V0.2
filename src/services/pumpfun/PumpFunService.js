import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Connection, VersionedTransaction, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import fetch from 'node-fetch';
import mongoose from 'mongoose';
import { ErrorHandler } from '../../core/errors/index.js';
import { config } from '../../core/config.js';
import { wsManager } from './WebSocketManager.js';
import { tokenLaunchDetector } from './detection/TokenLaunchDetector.js';
import { getLPSizeForToken } from './detection/getLPSizeForToken.js';
import { bot } from '../../core/bot.js';

export async function sendTelegramNotification(telegramChatId, message) {
  try {
    await bot.telegram.sendMessage(telegramChatId, message, { parse_mode: 'Markdown' });
    return { success: true };
  } catch (error) {
    console.error('Error sending Telegram notification:', error);
    return { success: false, error: error.message };
  }
}

/* --- Mongoose Schema for saving PumpFun token events --- */
const pumpFunTokenSchema = new mongoose.Schema({
  signature: { type: String, required: true },
  mint: { type: String, required: true },
  traderPublicKey: { type: String },
  initialBuy: { type: Number },
  marketCapSol: { type: Number },
  name: { type: String },
  symbol: { type: String },
  uri: { type: String },
  timestamp: { type: Date, default: Date.now },
});
// Indexed timestamp field for faster retrieval.
pumpFunTokenSchema.index({ timestamp: 1 });
const PumpFunTokenModel = mongoose.model('PumpFunToken', pumpFunTokenSchema);

/* --- Mongoose Schema for PumpFun Stats --- */
const pumpFunStatsSchema = new mongoose.Schema({
  totalTokensSaved: { type: Number, default: 0 }
});
const PumpFunStatsModel = mongoose.model('PumpFunStats', pumpFunStatsSchema);


class PumpFunService extends EventEmitter {
  constructor(networkConfig = { rpcUrl: config.solanaEndpoint }) {
    super();
    console.log('🚀 Starting PumpFunService...');
    // WebSocket and API endpoints
    this.websocketEndpoint = 'wss://pumpportal.fun/api/data';
    this.apiEndpoint = 'https://pumpportal.fun/api/trade-local';
    this.apiKey = config.pumpFunApiKey;
    
    // Solana connection and other services
    this.connection = new Connection(networkConfig.rpcUrl, 'confirmed');
    this.wsManager = wsManager;
    this.ws = null;
    this.tokenDetector = tokenLaunchDetector;
    
    // Subscriptions and queues
    this.newTokenSubscriptions = new Map();  // key: userId, value: { telegramChatId, criteria, batch, batchTimer }
    this.tokenTradeSubscriptions = new Map();
    this.tokenTradeQueue = new Set();
    this.messageQueue = [];
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
    
    // Cumulative token tracking:
    this.tokenLaunchCount = 0;          // Total tokens received via WS events
    this.totalTokensSaved = 0;          // Cumulative count of tokens flushed to DB
    this.tokenCache = [];               // Tokens waiting to be flushed
    this.lastHealthyTimestamp = null;
    
    // Start periodic flush of token cache to DB every 2 mins
    this.cacheFlushInterval = setInterval(() => this.flushTokenCache(), 120000);
    
    // Initialization flag
    this.isInitialized = false;
    
    // Start batch processing for outgoing WS messages
    this.startBatchProcessing();
  }
  
  async connect() {
    try {
      this.ws = await this.wsManager.createConnection(
        this.websocketEndpoint,
        {
          reconnect: true,
          onMessage: this.handleMessage.bind(this),
          onOpen: this.handleOpen.bind(this),
          onClose: this.handleClose.bind(this),
          onError: this.handleError.bind(this)
        }
      );
      console.log(`✅ PumpFunService connected to ${this.websocketEndpoint}`);
      this.isInitialized = true;
      this.emit('connected');
      this.flushQueue();
      this.startHeartbeat();
    } catch (error) {
      await ErrorHandler.handle(error, { operation: 'connect' });
      this.handleReconnect();
    }
  }

  // When the connection opens, subscribe automatically to new token events.
  handleOpen() {
    console.log(`✅ PumpFun⛽ WS connected to ${this.websocketEndpoint}`);
    this.lastHealthyTimestamp = Date.now(); 
    this.reconnectAttempts = 0;
    this.isInitialized = true;
    this.flushQueue();
    this.startHeartbeat();
    // SYSTEM SUBSCRIPTION: Automatically subscribe to new token events.
    this.send({ method: "subscribeNewToken" });
    this.emit('connected');
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      this.lastHealthyTimestamp = Date.now(); 
      //console.log('📩 PumpFun WS message received:', JSON.stringify(message, null, 2));
      if (message.txType) {
        switch (message.txType) {
          case 'create':
            this.handleCreateMessage(message);
            break;
          case 'trade':
            this.handleTokenTradeMessage(message);
            break;
          default:
            console.log(`ℹ️ Unhandled PumpFun txType: "${message.txType}"`);
        }
      } else {
        console.warn('⚠️ Missing txType in PumpFun message. Ignoring:', message);
      }
    } catch (error) {
      console.error('❌ Error processing WS message:', error);
    }
  }

  handleClose() {
    console.warn('🔌 PumpFun WS connection closed.');
    this.isInitialized = false;
    this.stopHeartbeat();
    // Immediately trigger reconnection when the WS closes.
    this.handleReconnect();
    this.emit('closed');
  }  

  handleError(error) {
    console.error('❌ PumpFun WS error:', error);
    this.emit('error', error);
    // Reconnection is managed by wsManager if needed.
  }

  handleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('❌ PumpFun: Max reconnect attempts reached. Giving up.');
      this.emit('reconnectFailed');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    console.warn(`🔄 PumpFun: Reconnecting in ${delay / 1000}s...`);
    setTimeout(() => this.connect(), delay);
  }

  startHeartbeat() {
    clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'ping' }));
        this.heartbeatTimeout = setTimeout(() => {
          console.warn('⚠️ PumpFun: No pong received. Terminating connection...');
          this.ws.terminate();
          this.handleReconnect();
        }, 5000);
      }
    }, 300000);
  }

  stopHeartbeat() {
    clearInterval(this.heartbeatInterval);
    clearTimeout(this.heartbeatTimeout);
  }

  startBatchProcessing() {
    setInterval(() => {
      if (this.messageQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
        const message = this.messageQueue.shift();
        this.ws.send(JSON.stringify(message));
      }
    }, 50);
  }

  flushQueue() {
    while (this.messageQueue.length > 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = this.messageQueue.shift();
      this.ws.send(JSON.stringify(message));
    }
  }

  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  /* ────────────────────────────────
     Public API for User Subscriptions
  ──────────────────────────────── */
  subscribeNewToken(userId, telegramChatId, criteria = {}) {
    try {
      // Initialize subscription object with batching support.
      this.newTokenSubscriptions.set(userId, { 
        telegramChatId, 
        criteria, 
        batch: [], 
        batchTimer: null 
      });
      this.send({ method: "subscribeNewToken" });
      return { success: true, message: "Subscribed to new token notifications." };
    } catch (error) {
      console.error("❌ Error in subscribeNewToken:", error);
      return { success: false, error: error.message };
    }
  }

  unsubscribeNewToken(userId) {
    try {
      const sub = this.newTokenSubscriptions.get(userId);
      if (sub && sub.batchTimer) {
        clearTimeout(sub.batchTimer);
      }
      this.newTokenSubscriptions.delete(userId);
      if (this.newTokenSubscriptions.size === 0) {
        this.send({ method: "unsubscribeNewToken" });
      }
      return { success: true, message: "Unsubscribed from new token notifications." };
    } catch (error) {
      console.error("❌ Error in unsubscribeNewToken:", error);
      return { success: false, error: error.message };
    }
  }

  subscribeTokenTrade(userId, telegramChatId, criteria = {}, contractAddresses = []) {
    try {
      this.tokenTradeSubscriptions.set(userId, { telegramChatId, criteria });
      contractAddresses.forEach(addr => this.tokenTradeQueue.add(addr));
      this.send({ method: "subscribeTokenTrade", keys: Array.from(this.tokenTradeQueue) });
      return { success: true, message: "Subscribed to token trade notifications." };
    } catch (error) {
      console.error("❌ Error in subscribeTokenTrade:", error);
      return { success: false, error: error.message };
    }
  }

  unsubscribeTokenTrade(userId, contractAddresses = []) {
    try {
      this.tokenTradeSubscriptions.delete(userId);
      contractAddresses.forEach(addr => this.tokenTradeQueue.delete(addr));
      this.send({ method: "unsubscribeTokenTrade", keys: contractAddresses });
      return { success: true, message: "Unsubscribed from token trade notifications." };
    } catch (error) {
      console.error("❌ Error in unsubscribeTokenTrade:", error);
      return { success: false, error: error.message };
    }
  }

  async executeTrade(options) {
    const { publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee, pool, privateKey } = options;
    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ publicKey, action, mint, amount, denominatedInSol, slippage, priorityFee, pool }),
      });
      if (response.ok) {
        const transactionBuffer = await response.arrayBuffer();
        const transaction = VersionedTransaction.deserialize(new Uint8Array(transactionBuffer));
        const signerKeypair = Keypair.fromSecretKey(bs58.decode(privateKey));
        transaction.sign([signerKeypair]);
        const signature = await this.connection.sendTransaction(transaction);
        console.log(`Transaction successful: https://solscan.io/tx/${signature}`);
        return { success: true, signature };
      } else {
        const errorText = await response.text();
        console.error('Trade API Error:', errorText);
        throw new Error(errorText);
      }
    } catch (error) {
      console.error('❌ Error executing trade:', error);
      await ErrorHandler.handle(error, { operation: 'executeTrade' });
      return { success: false, error: error.message };
    }
  }

  /* ────────────────────────────────
     Handlers for Incoming WS Messages
  ──────────────────────────────── */
  handleCreateMessage(message) {
    try {
      // console.log('🎉 Handling new token message:', message);
      const { signature, mint, traderPublicKey, initialBuy, marketCapSol, name, symbol, uri } = message;
      // Increase both the per-session counter and cumulative count.
      this.tokenLaunchCount++;
  
      const formattedMsg = `
🚀 *New Token Detected!*
*Name:* ${name}
*Symbol:* ${symbol}
*Mint:* ${mint}
*Trader:* ${traderPublicKey}
*Initial Buy:* ${initialBuy}
*Market Cap:* ${marketCapSol} SOL
*URI:* ${uri}
*Tx:* https://solscan.io/tx/${signature}
      `.trim();

      this.emit('newTokenCreated', { message: formattedMsg, raw: message });

      // Batched notifications for new token subscribers.
      const BATCH_SIZE = 10;
      const BATCH_INTERVAL = 60000; // 60 seconds

      this.newTokenSubscriptions.forEach((sub, userId) => {
        // Filter based on criteria if defined.
        if (sub.criteria.minLiquidity && Number(marketCapSol) < Number(sub.criteria.minLiquidity)) {
          return;
        }

        // Add the formatted message to this subscription's batch.
        sub.batch.push(formattedMsg);

        // If the batch size reaches the threshold, send immediately.
        if (sub.batch.length >= BATCH_SIZE) {
          const aggregatedMsg = sub.batch.join('\n\n');
          sendTelegramNotification(sub.telegramChatId, aggregatedMsg);
          sub.batch = [];
          if (sub.batchTimer) {
            clearTimeout(sub.batchTimer);
            sub.batchTimer = null;
          }
        } 
        // Otherwise, if no timer is set, schedule a batch send after BATCH_INTERVAL.
        else if (!sub.batchTimer) {
          sub.batchTimer = setTimeout(() => {
            const aggregatedMsg = sub.batch.join('\n\n');
            sendTelegramNotification(sub.telegramChatId, aggregatedMsg);
            sub.batch = [];
            sub.batchTimer = null;
          }, BATCH_INTERVAL);
        }
      });

      // Save token event to the in-memory cache for later DB flush.
      this.tokenCache.push({ signature, mint, traderPublicKey, initialBuy, marketCapSol, name, symbol, uri, timestamp: new Date() });
      console.log('✅ Processed new token message.');
    } catch (error) {
      console.error('❌ Error handling new token message:', error);
    }
  }

  handleTokenTradeMessage(message) {
    try {
      const { token, tradeAmount, tradeType, signature } = message;
      const formattedMsg = `
💱 *Token Trade Alert!*
*Token:* ${token}
*Type:* ${tradeType}
*Amount:* ${tradeAmount}
*Tx:* https://solscan.io/tx/${signature}
      `.trim();

      this.emit('tokenTrade', { message: formattedMsg, raw: message });
      this.tokenTradeSubscriptions.forEach(async (sub, userId) => {
        if (sub.criteria.minTradeAmount && Number(tradeAmount) < Number(sub.criteria.minTradeAmount)) {
          return;
        }
        await sendTelegramNotification(sub.telegramChatId, formattedMsg);
      });
    } catch (error) {
      console.error('❌ Error handling token trade message:', error);
    }
  }

  /* ────────────────────────────────
     Token Cache Management
  ──────────────────────────────── */
  async flushTokenCache() {
    if (this.tokenCache.length === 0) return;
    try {
      console.log(`🔄 Flushing ${this.tokenCache.length} tokens from cache to DB...`);
      await PumpFunTokenModel.insertMany(this.tokenCache);
      console.log(`✅ Successfully flushed ${this.tokenCache.length} tokens to DB.`);
      // Calculate the increment
      const countIncrement = this.tokenCache.length;
      // Update in-memory counter (optional, for quick access)
      this.totalTokensSaved += countIncrement;
      
      // Update the persistent stats document: increment the counter or create if not exists
      await PumpFunStatsModel.updateOne({}, { $inc: { totalTokensSaved: countIncrement } }, { upsert: true });
      
      // Clear the pending cache.
      this.tokenCache = [];
    } catch (error) {
      console.error("❌ Error flushing token cache:", error);
    }
  }

  async getTokensByPeriod(startTime, endTime) {
    try {
      // If startTime/endTime are not provided, default to 24 hours ago and now respectively.
      const start = startTime ? new Date(startTime) : new Date(Date.now() - 24 * 60 * 60 * 1000);
      const end = endTime ? new Date(endTime) : new Date();
  
      // Query tokens with timestamp between start and end. Limit results to 300.
      const tokens = await PumpFunTokenModel.find({
        timestamp: { $gte: start, $lte: end }
      }).sort({ timestamp: 1 }).limit(300);
  
      return { success: true, tokens };
    } catch (error) {
      console.error("Error fetching tokens by period:", error);
      return { success: false, error: error.message };
    }
  }
  
  async getTokensByLiquidity(minLiquidity) {
    try {
      // Retrieve tokens with a basic market cap filter. Limit results to 300.
      const result = await PumpFunTokenModel.find({
        marketCapSol: { $gte: minLiquidity }
      }).sort({ timestamp: 1 }).limit(300);
  
      const filteredTokens = [];
      for (const token of result) {
        const lpSize = await getLPSizeForToken(token.mint);
        console.log(`Token ${token.name} (${token.mint}) LP size: ${lpSize}`);
        // If the LP size meets the threshold, include this token.
        if (lpSize >= minLiquidity) { 
          filteredTokens.push({ ...token.toObject(), lpSize });
        }
      }
      return { success: true, tokens: filteredTokens };
    } catch (error) {
      console.error("Error fetching tokens by liquidity:", error);
      return { success: false, error: error.message };
    }
  }  

  async checkHealth() {
    try {
      let status = "unhealthy";
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        status = "healthy";
      } else if (this.lastHealthyTimestamp && (Date.now() - this.lastHealthyTimestamp < 120000)) {
        status = "healthy";
      }
      // Retrieve persistent total tokens saved from the stats document.
      const statsDoc = await PumpFunStatsModel.findOne({});
      const persistentTotalTokens = statsDoc ? statsDoc.totalTokensSaved : 0;
      
      const tokens = await PumpFunTokenModel.find({})
        .sort({ timestamp: -1 })
        .limit(10)
        .exec();
      const recentTokens = tokens.reverse();
      return {
        status,
        endpoint: this.websocketEndpoint,
        tokensLaunched: this.tokenLaunchCount,
        totalTokensSaved: persistentTotalTokens,  
        reconnectAttempts: this.reconnectAttempts,
        cachedTokens: this.tokenCache.length,
        recentTokens
      };
    } catch (error) {
      return { status: "unhealthy", error: error.message };
    }
  }

  /**
   * Fetches graduated tokens from Pump.fun via Moralis API
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of tokens to return (1-100)
   * @param {string} options.sortBy - Field to sort by (graduatedAt, liquidity, priceChange24h, volume24h)
   * @param {string} options.sortOrder - Sort order (asc, desc)
   * @param {string} options.cursor - Pagination cursor
   * @returns {Promise<Object>} - Returns token data and pagination info
   */
  async getGraduatedTokens({
    limit = 50,
    cursor = null,
    sortBy = 'graduatedAt',
    sortOrder = 'desc',
    timeframe = '24h',
    minLiquidity = 0
  } = {}) {
    try {
      // Validate inputs
      if (limit < 1 || limit > 100) {
        throw new Error('Limit must be between 1 and 100');
      }
  
      // Validate sort options
      const validSortFields = ['graduatedAt', 'liquidity', 'priceChange24h', 'volume24h'];
      if (!validSortFields.includes(sortBy)) {
        throw new Error(`Invalid sortBy option. Must be one of: ${validSortFields.join(', ')}`);
      }
  
      const validSortOrders = ['asc', 'desc'];
      if (!validSortOrders.includes(sortOrder)) {
        throw new Error(`Invalid sortOrder option. Must be one of: ${validSortOrders.join(', ')}`);
      }
  
      // Build URL with query parameters
      const params = new URLSearchParams({
        limit,
        ...(timeframe && { timeframe }),
        ...(cursor && { cursor })
      });
  
      const url = `https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/graduated?${params}`;
      
      const response = await fetch(url, {
        headers: {
          'accept': 'application/json',
          'X-API-Key': config.moralisAPIKey
        }
      });
  
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API request failed with status ${response.status}: ${errorData.message || 'Unknown error'}`);
      }
  
      const data = await response.json();
      
      // Process and format the response
      const tokens = data.result || [];
      const now = new Date();
      
      // Format tokens with additional calculated fields
      const formattedTokens = tokens.map(token => ({
        ...token,
        liquidity: parseFloat(token.liquidity) || 0,
        priceUsd: parseFloat(token.priceUsd) || 0,
        priceNative: parseFloat(token.priceNative) || 0,
        fullyDilutedValuation: parseFloat(token.fullyDilutedValuation) || 0,
        daysSinceGraduation: Math.floor((now - new Date(token.graduatedAt)) / (1000 * 60 * 60 * 24)) || 0,
        solscanUrl: `https://solscan.io/token/${token.tokenAddress}`,
        dexscreenerUrl: `https://dexscreener.com/solana/${token.tokenAddress}`
      }));
  
      // Apply minimum liquidity filter if specified
      let filteredTokens = minLiquidity > 0 
        ? formattedTokens.filter(token => token.liquidity >= minLiquidity)
        : formattedTokens;
  
      // Sort tokens 
      filteredTokens = filteredTokens.sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'liquidity') comparison = a.liquidity - b.liquidity;
        else if (sortBy === 'priceChange24h') comparison = (a.priceChange24h || 0) - (b.priceChange24h || 0);
        else if (sortBy === 'volume24h') comparison = (a.volume24h || 0) - (b.volume24h || 0);
        else comparison = new Date(a.graduatedAt) - new Date(b.graduatedAt);
        
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  
      // Generate summary statistics
      const summary = {
        totalLiquidity: filteredTokens.reduce((sum, token) => sum + token.liquidity, 0),
        avgLiquidity: filteredTokens.length > 0 
          ? filteredTokens.reduce((sum, token) => sum + token.liquidity, 0) / filteredTokens.length 
          : 0,
        minLiquidity: filteredTokens.length > 0 
          ? Math.min(...filteredTokens.map(t => t.liquidity)) 
          : 0,
        maxLiquidity: filteredTokens.length > 0 
          ? Math.max(...filteredTokens.map(t => t.liquidity)) 
          : 0,
        tokenCount: filteredTokens.length
      };
  
      return {
        success: true,
        tokens: filteredTokens,
        summary,
        cursor: data.cursor || null,
        hasMore: !!data.cursor,
        timeframe,
        minLiquidity
      };
    } catch (error) {
      console.error('Error in getGraduatedTokens:', error);
      return {
        success: false,
        error: error.message,
        tokens: [],
        summary: {
          totalLiquidity: 0,
          avgLiquidity: 0,
          minLiquidity: 0,
          maxLiquidity: 0,
          tokenCount: 0
        },
        cursor: null,
        hasMore: false
      };
    }
  }

  /**
   * Fetches tokens still in the bonding curve phase
   * @param {Object} options - Query options
   * @param {number} options.limit - Maximum number of tokens to return (1-100)
   * @param {number} options.minLiquidity - Minimum liquidity in USD
   * @param {number} options.minProgress - Minimum bonding curve progress percentage (0-100)
   * @param {string} options.sortBy - Field to sort by (liquidity, priceUsd, bondingCurveProgress)
   * @param {string} options.sortOrder - Sort order (asc, desc)
   * @param {string} options.cursor - Pagination cursor
   * @returns {Promise<Object>} - Returns bonding tokens data
   */
  async getBondingTokens({
    limit,
    minRaised = 0,
    maxTimeLeft,
    sortBy = 'timeLeft',
    sortOrder = 'asc',
    cursor = null
  } = {}) {
    try {
      // Validate input limit
      if (limit === undefined) {
        throw new Error('Limit is required');
      }
      if (limit < 1 || limit > 100) {
        throw new Error('Limit must be between 1 and 100');
      }

      // Build URL with query parameters
      const params = new URLSearchParams({
        limit
      });
      
      // Add optional parameters if they exist
      if (cursor) params.append('cursor', cursor);
      if (minRaised > 0) params.append('minRaised', minRaised);
      if (maxTimeLeft) params.append('maxTimeLeft', maxTimeLeft);
      if (sortBy) params.append('sortBy', sortBy);
      if (sortOrder) params.append('sortOrder', sortOrder);

      const url = `https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/bonding?${params}`;
      
      const response = await fetch(url, {
        headers: {
          'accept': 'application/json',
          'X-API-Key': config.moralisAPIKey
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`API request failed with status ${response.status}: ${errorData.message || 'Unknown error'}`);
      }

      const data = await response.json();
      
      // Process and format the response
      const tokens = data.result || [];
      
      // Format tokens with additional calculated fields
      const formattedTokens = tokens.map(token => ({
        ...token,
        liquidity: parseFloat(token.liquidity) || 0,
        priceUsd: parseFloat(token.priceUsd) || 0,
        priceNative: parseFloat(token.priceNative) || 0,
        fullyDilutedValuation: parseFloat(token.fullyDilutedValuation) || 0,
        bondingCurveProgress: parseFloat(token.bondingCurveProgress) || 0,
        solscanUrl: `https://solscan.io/token/${token.tokenAddress}`,
        dexscreenerUrl: `https://dexscreener.com/solana/${token.tokenAddress}`,
        // Calculate estimated time left based on bonding curve progress
        // This is an approximation since the API doesn't provide exact time
        estimatedTimeLeft: 24 * (100 - (parseFloat(token.bondingCurveProgress) || 0)) / 100,
        timeLeftFormatted: this.formatTimeRemaining(24 * (100 - (parseFloat(token.bondingCurveProgress) || 0)) / 100)
      }));

      // Sort tokens (no filtering since minLiquidity and minProgress are no longer supported)
      const filteredTokens = formattedTokens
        .sort((a, b) => {
          let comparison = 0;
          if (sortBy === 'liquidity') comparison = a.liquidity - b.liquidity;
          else if (sortBy === 'priceUsd') comparison = a.priceUsd - b.priceUsd;
          else comparison = a.bondingCurveProgress - b.bondingCurveProgress;
          
          return sortOrder === 'asc' ? comparison : -comparison;
        });
      
      // Generate summary statistics
      const summary = {
        totalLiquidity: formattedTokens.reduce((sum, token) => sum + token.liquidity, 0),
        avgLiquidity: formattedTokens.length > 0 
          ? formattedTokens.reduce((sum, token) => sum + token.liquidity, 0) / formattedTokens.length 
          : 0,
        minProgress: filteredTokens.length > 0 
          ? Math.min(...filteredTokens.map(t => t.bondingCurveProgress)) 
          : 0,
        maxProgress: filteredTokens.length > 0 
          ? Math.max(...filteredTokens.map(t => t.bondingCurveProgress)) 
          : 0,
        tokenCount: filteredTokens.length
      };

      return {
        success: true,
        tokens: filteredTokens,
        summary,
        cursor: data.cursor || null,
        hasMore: !!data.cursor
      };
    } catch (error) {
      console.error('Error in getBondingTokens:', error);
      return {
        success: false,
        error: error.message,
        tokens: [],
        summary: {
          totalLiquidity: 0,
          avgLiquidity: 0,
          minProgress: 0,
          maxProgress: 0,
          tokenCount: 0
        },
        cursor: null,
        hasMore: false
      };
    }
  }    

  /**
   * Formats time remaining in hours to a human-readable string
   * @param {number} hours - Time in hours
   * @returns {string} Formatted time string (e.g., "12h 30m")
   */
  formatTimeRemaining(hours) {
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${h}h ${m}m`;
  }

  /**
   * Get detailed bonding status and price for a specific token
   * @param {string} tokenAddress - The token mint address
   * @returns {Promise<Object>} Token bonding status and price information
   */
  /**
   * Create a new Pump.fun token
   * @param {Object} params - Token creation parameters
   * @param {string} params.apiKey - User's Pump.fun API key
   * @param {string} params.publicKey - Wallet public key
   * @param {string} params.name - Token name
   * @param {string} params.symbol - Token symbol
   * @param {string} params.description - Token description
   * @param {string} params.twitter - Twitter link
   * @param {string} params.telegram - Telegram link
   * @param {string} params.website - Website link
   * @param {boolean} params.showName - Show name in UI
   * @param {File} params.image - Token image file
   * @param {number} [params.amount] - Amount of SOL to use
   * @param {number} [params.slippage] - Slippage percentage
   * @param {number} [params.priorityFee] - Priority fee in SOL
   * @returns {Promise<Object>} Token creation transaction data
   */
  async createPumpFunToken(params) {
    if (!params.apiKey) {
      throw new Error('API key is required for token creation');
    }
    try {
      const mintKeypair = Keypair.generate();
      
      const formData = new FormData();
      formData.append("file", params.image); // Image file
      formData.append("name", params.name);
      formData.append("symbol", params.symbol);
      formData.append("description", params.description);
      formData.append("twitter", params.twitter);
      formData.append("telegram", params.telegram);
      formData.append("website", params.website);
      formData.append("showName", params.showName.toString());

      const metadataResponse = await fetch("https://pump.fun/api/ipfs", {
        method: "POST",
        body: formData,
      });
      const metadataResponseJSON = await metadataResponse.json();

      const response = await fetch(`https://pumpportal.fun/api/trade?api-key=${params.apiKey}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          "publicKey": params.publicKey,
          "action": "create",
          "tokenMetadata": {
            name: metadataResponseJSON.metadata.name,
            symbol: metadataResponseJSON.metadata.symbol,
            uri: metadataResponseJSON.metadataUri
          },
          "mint": mintKeypair.publicKey.toBase58(),
          "denominatedInSol": "true",
          "amount": params.amount || 1,
          "slippage": params.slippage || 10,
          "priorityFee": params.priorityFee || 0.0005,
          "pool": "pump"
        })
      });

      if(response.status === 200) {
        const data = await response.arrayBuffer();
        const tx = VersionedTransaction.deserialize(new Uint8Array(data));
        return {
          success: true,
          transaction: tx,
          mintAddress: mintKeypair.publicKey.toBase58(),
          metadata: metadataResponseJSON.metadata
        };
      } else {
        throw new Error(`Failed to create token: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error creating Pump.fun token:', error);
      throw error;
    }
  }

  /**
   * Create a new Bonk token
   * @param {Object} params - Token creation parameters
   * @param {string} params.apiKey - User's Pump.fun API key
   * @param {string} params.name - Token name
   * @param {string} params.symbol - Token symbol
   * @param {string} params.description - Token description
   * @param {string} params.website - Website link
   * @param {File} params.image - Token image file
   * @param {number} [params.amount] - Amount of SOL to use
   * @param {number} [params.slippage] - Slippage percentage
   * @param {number} [params.priorityFee] - Priority fee in SOL
   * @returns {Promise<Object>} Token creation transaction data
   */
  async createMoonshotToken(params) {
    if (!params.apiKey) {
      throw new Error('API key is required for token creation');
    }
    try {
      const mintKeypair = Keypair.generate();

      const formData = new FormData();
      formData.append("image", params.image);

      const imgResponse = await fetch("https://nft-storage.letsbonk22.workers.dev/upload/img", {
        method: "POST",
        body: formData,
      });
      const imgUri = await imgResponse.text();

      const metadataResponse = await fetch("https://nft-storage.letsbonk22.workers.dev/upload/meta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: params.description,
          image: imgUri,
          name: params.name,
          symbol: params.symbol,
          website: params.website
        }),
      });
      const metadataUri = await metadataResponse.text();

      const response = await fetch(
        `https://pumpportal.fun/api/trade?api-key=${params.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create",
            tokenMetadata: {
              name: params.name,
              symbol: params.symbol,
              uri: metadataUri,
            },
            mint: bs58.encode(mintKeypair.secretKey),
            denominatedInSol: "true",
            amount: params.amount || 1,
            slippage: params.slippage || 5,
            priorityFee: params.priorityFee || 0.00005,
            pool: "moonshot"
          }),
        }
      );

      if (response.status === 200) {
        const data = await response.json();
        return {
          success: true,
          transaction: data,
          mintAddress: mintKeypair.publicKey.toBase58(),
          metadataUri
        };
      } else {
        throw new Error(`Failed to create Moonshot token: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error creating Moonshot token:', error);
      throw error;
    }
  }

  /**
   * Create a new Bonk token
   * @param {Object} params - Token creation parameters
   * @param {string} params.apiKey - User's Pump.fun API key
   * @param {string} params.name - Token name
   * @param {string} params.symbol - Token symbol
   * @param {string} params.description - Token description
   * @param {string} params.website - Website link
   * @param {File} params.image - Token image file
   * @param {number} [params.amount] - Amount of SOL to use
   * @param {number} [params.slippage] - Slippage percentage
   * @param {number} [params.priorityFee] - Priority fee in SOL
   * @returns {Promise<Object>} Token creation transaction data
   */
  async createBonkToken(params) {
    if (!params.apiKey) {
      throw new Error('API key is required for token creation');
    }
    try {
      const mintKeypair = Keypair.generate();

      const formData = new FormData();
      formData.append("image", params.image);

      const imgResponse = await fetch("https://nft-storage.letsbonk22.workers.dev/upload/img", {
        method: "POST",
        body: formData,
      });
      const imgUri = await imgResponse.text();

      const metadataResponse = await fetch("https://nft-storage.letsbonk22.workers.dev/upload/meta", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          createdOn: "https://bonk.fun",
          description: params.description,
          image: imgUri,
          name: params.name,
          symbol: params.symbol,
          website: params.website
        }),
      });
      const metadataUri = await metadataResponse.text();

      const response = await fetch(
        `https://pumpportal.fun/api/trade?api-key=${params.apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "create",
            tokenMetadata: {
              name: params.name,
              symbol: params.symbol,
              uri: metadataUri,
            },
            mint: bs58.encode(mintKeypair.secretKey),
            denominatedInSol: "true",
            amount: params.amount || 0.5,
            slippage: params.slippage || 5,
            priorityFee: params.priorityFee || 0.00005,
            pool: "bonk"
          }),
        }
      );

      if (response.status === 200) {
        const data = await response.json();
        return {
          success: true,
          transaction: data,
          mintAddress: mintKeypair.publicKey.toBase58(),
          metadataUri
        };
      } else {
        throw new Error(`Failed to create Bonk token: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error creating Bonk token:', error);
      throw error;
    }
  }

  async getTokenBondingStatus(tokenAddress) {
    try {
      // Validate token address
      if (!tokenAddress || typeof tokenAddress !== 'string' || tokenAddress.length < 30) {
        throw new Error('Invalid token address');
      }

      // Fetch bonding status and price in parallel
      const statusUrl = `https://solana-gateway.moralis.io/token/mainnet/${tokenAddress}/bonding-status`;
      const priceUrl = `https://solana-gateway.moralis.io/token/mainnet/${tokenAddress}/price`;
      
      const [statusResponse, priceResponse] = await Promise.all([
        fetch(statusUrl, {
          headers: {
            'accept': 'application/json',
            'X-API-Key': this.config.moralisApiKey
          }
        }),
        fetch(priceUrl, {
          headers: {
            'accept': 'application/json',
            'X-API-Key': this.config.moralisApiKey
          }
        })
      ]);

      if (!statusResponse.ok || !priceResponse.ok) {
        const errorText = await Promise.all([statusResponse.text(), priceResponse.text()]);
        throw new Error(`API request failed: ${errorText.join(' | ')}`);
      }

      const [statusData, priceData] = await Promise.all([
        statusResponse.json(),
        priceResponse.json()
      ]);

      // Calculate time remaining if bonding is in progress
      let timeRemaining = null;
      if (statusData.bondingProgress < 100) {
        // Estimate time based on typical bonding curve progression
        const progressRemaining = 100 - statusData.bondingProgress;
        const estimatedHours = (progressRemaining / 5); // Rough estimate: 5% per hour
        timeRemaining = this.formatTimeRemaining(estimatedHours * 60); // Convert hours to minutes
      }

      return {
        success: true,
        tokenAddress,
        bondingProgress: statusData.bondingProgress,
        isFullyBonded: statusData.bondingProgress >= 100,
        timeRemaining,
        price: {
          usd: priceData.usdPrice,
          native: {
            value: priceData.nativePrice?.value,
            symbol: priceData.nativePrice?.symbol || 'SOL',
            decimals: priceData.nativePrice?.decimals || 9
          },
          exchange: {
            name: priceData.exchangeName,
            address: priceData.exchangeAddress
          },
          pairAddress: priceData.pairAddress
        },
        lastUpdated: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error fetching token bonding status:', error);
      return {
        success: false,
        error: error.message,
        tokenAddress,
        lastUpdated: new Date().toISOString()
      };
    }
  }

  cleanup() {
    console.log('🧹 Cleaning up PumpFunService...');
    if (this.ws) {
      this.ws.terminate();
    }
    this.stopHeartbeat();
    clearInterval(this.cacheFlushInterval);
    this.flushTokenCache();
    this.removeAllListeners();
    this.isInitialized = false;
  }
}

export const pumpFunService = new PumpFunService({
  rpcUrl: 'https://api.mainnet-beta.solana.com'
});
