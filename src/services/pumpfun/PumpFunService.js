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
  signature: String,
  mint: String,
  traderPublicKey: String,
  initialBuy: Number,
  marketCapSol: Number,
  name: String,
  symbol: String,
  uri: String,
  timestamp: { type: Date, default: Date.now }
});
const PumpFunTokenModel = mongoose.model('PumpFunToken', pumpFunTokenSchema);

class PumpFunService extends EventEmitter {
  constructor(networkConfig = { rpcUrl: config.solanaEndpoint }) {
    super();

    // WebSocket and API endpoints
    this.websocketEndpoint = 'wss://pumpportal.fun/api/data';
    this.apiEndpoint = 'https://pumpportal.fun/api/trade-local';
    this.apiKey = config.pumpFunApiKey;

    // Solana connection
    this.connection = new Connection(networkConfig.rpcUrl, 'confirmed');

    // WebSocket manager for a single connection instance
    this.wsManager = wsManager;
    this.ws = null;

    // Optional token launch detector
    this.tokenDetector = tokenLaunchDetector;

    // Subscription maps for per-user subscriptions
    this.newTokenSubscriptions = new Map(); // key: userId, value: { telegramChatId, criteria }
    this.tokenTradeSubscriptions = new Map(); // key: userId, value: { telegramChatId, criteria }

    // Global set of contract addresses to monitor for token trades
    this.tokenTradeQueue = new Set();

    // Message queue for outgoing messages (when WS is not ready)
    this.messageQueue = [];

    // Reconnection and heartbeat management
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;

    // Track total tokens launched (incremented on new token messages)
    this.tokenLaunchCount = 0;

    // Token cache: store every token event (new token) received
    this.tokenCache = [];

    // Start periodic flush of token cache to the DB every 2mins
    this.cacheFlushInterval = setInterval(() => this.flushTokenCache(), 120000);

    // Initialization flag
    this.isInitialized = false;

    // Start periodic batch processing for outgoing WS messages
    this.startBatchProcessing();
  }

  /**
   * Establish the WebSocket connection.
   * 
   * IMPORTANT: Call pumpFunService.connect() at startup so the module is ready.
   */
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
      this.isInitialized = true;
      this.emit('connected');
    } catch (error) {
      await ErrorHandler.handle(error, { operation: 'connect' });
      this.handleReconnect();
    }
  }

  handleOpen() {
    console.log(`✅ PumpFun WS connected to ${this.websocketEndpoint}`);
    this.reconnectAttempts = 0;
    this.isInitialized = true;
    this.flushQueue();
    this.startHeartbeat();
    this.emit('connected');
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data);
      console.log('📩 PumpFun WS message received:', JSON.stringify(message, null, 2));
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
    this.handleReconnect();
  }

  handleError(error) {
    console.error('❌ PumpFun WS error:', error);
    this.emit('error', error);
    this.handleReconnect();
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
    }, 600000);
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
      this.newTokenSubscriptions.set(userId, { telegramChatId, criteria });
      // Activate WS subscription if not already active
      this.send({ method: "subscribeNewToken" });
      return { success: true, message: "Subscribed to new token notifications." };
    } catch (error) {
      console.error("❌ Error in subscribeNewToken:", error);
      return { success: false, error: error.message };
    }
  }

  unsubscribeNewToken(userId) {
    try {
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
      console.log('🎉 Handling new token message:', message);
      const { signature, mint, traderPublicKey, initialBuy, marketCapSol, name, symbol, uri } = message;
      // Increment token launch count
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

      // Emit event for internal listeners
      this.emit('newTokenCreated', { message: formattedMsg, raw: message });

      // Notify subscribers (filtering by criteria)
      this.newTokenSubscriptions.forEach(async (sub, userId) => {
        if (sub.criteria.minLiquidity && Number(marketCapSol) < Number(sub.criteria.minLiquidity)) {
          return;
        }
        await sendTelegramNotification(sub.telegramChatId, formattedMsg);
      });

      // Save the token event to the in-memory cache
      this.tokenCache.push({ signature, mint, traderPublicKey, initialBuy, marketCapSol, name, symbol, uri, timestamp: new Date() });
      console.log('✅ Processed new token message.');
    } catch (error) {
      console.error('❌ Error handling new token message:', error);
    }
  }

  handleTokenTradeMessage(message) {
    try {
      // Adjust field extraction based on your WS message schema.
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

  /**
   * Flush the in-memory token cache to the database.
   */
  async flushTokenCache() {
    if (this.tokenCache.length === 0) return;
    try {
      await PumpFunTokenModel.insertMany(this.tokenCache);
      console.log(`Flushed ${this.tokenCache.length} tokens to DB`);
      this.tokenCache = [];
    } catch (error) {
      console.error("Error flushing token cache:", error);
    }
  }

  /**
   * Retrieve all tokens stored in the DB within a given period.
   * (This function remains as is for custom queries.)
   */
  async getTokensByPeriod(startTime, endTime) {
    try {
      const tokens = await PumpFunTokenModel.find({
        timestamp: { $gte: startTime, $lte: endTime }
      }).sort({ timestamp: 1 });
      return { success: true, tokens };
    } catch (error) {
      console.error("Error fetching tokens by period:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check health using available endpoints.
   * Returns WS status, endpoint, tokens launched, reconnect attempts, cached tokens count,
   * and additionally, the 300 most recent tokens (chronologically ordered).
   */
  async checkHealth() {
    try {
      let status = "unhealthy";
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        status = "healthy";
      }
      // Fetch last 300 tokens (most recent first), then reverse to get chronological order.
      const tokens = await PumpFunTokenModel.find({})
        .sort({ timestamp: -1 })
        .limit(300)
        .exec();
      const recentTokens = tokens.reverse();
      return {
        status,
        endpoint: this.websocketEndpoint,
        tokensLaunched: this.tokenLaunchCount,
        reconnectAttempts: this.reconnectAttempts,
        cachedTokens: this.tokenCache.length,
        recentTokens
      };
    } catch (error) {
      return { status: "unhealthy", error: error.message };
    }
  }

  /* ────────────────────────────────
     Cleanup & Shutdown
  ──────────────────────────────── */

  cleanup() {
    console.log('🧹 Cleaning up PumpFunService...');
    if (this.ws) {
      this.ws.terminate();
    }
    this.stopHeartbeat();
    clearInterval(this.cacheFlushInterval);
    // Flush remaining token cache on shutdown
    this.flushTokenCache();
    this.removeAllListeners();
    this.isInitialized = false;
  }
}

export const pumpFunService = new PumpFunService({
  rpcUrl: 'https://api.mainnet-beta.solana.com'
});
