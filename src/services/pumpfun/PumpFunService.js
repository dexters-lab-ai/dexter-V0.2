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
