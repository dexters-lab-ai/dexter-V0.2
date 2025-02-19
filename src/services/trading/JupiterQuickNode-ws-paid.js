// TOO BROKE TO PAY QUICKNODE :) coming soon...

import {
    Connection,
    PublicKey,
    VersionedTransaction,
    TransactionInstruction,
    TransactionMessage,
    AddressLookupTableAccount
  } from "@solana/web3.js";
  import WebSocket from "ws";
  import JupiterApi from '@jup-ag/api';
  import { TOKEN_PROGRAM_ID, getAccount, getMint } from "@solana/spl-token";
  import dotenv from "dotenv";
  import * as fs from 'fs';
  import * as path from 'path';
  import { config } from "../../core/config.js";
  import { MongoClient } from "mongodb";
  
  dotenv.config();
  
  const defaultConfig = {
    solanaEndpoint: config.solanaEndpoint,
    jupiterEndpoint: config.jupiterEndpoint,
    jupiterQuoteRPC: config.jupiterQuoteRPC,
    jupiterWebSocket: "wss://public.jupiterapi.com/ws",
  };
  
  // Helper: Sleep for ms milliseconds.
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  /**
   * Safely converts a base64 string to a Buffer.
   * Pads the string if its length isn’t a multiple of 4.
   */
  function safeBufferFromBase64(base64String) {
    if (typeof base64String !== 'string') {
      throw new Error("Input is not a string");
    }
    base64String = base64String.trim();
    const padLength = (4 - (base64String.length % 4)) % 4;
    const padded = base64String + '='.repeat(padLength);
    return Buffer.from(padded, 'base64');
  }
  
  /* =======================================================
     Formatting Helpers (New Additions)
     ======================================================= */
  
  /**
   * In-memory cache for mint decimals.
   * (This cache is persisted in MongoDB so that values survive restarts.)
   */
  const mintDecimalsCache = {};
  
  // --- MongoDB Persistence for Mint Decimals ---
  const mongoUri = config.mongoUri; 
  const mongoClient = new MongoClient(mongoUri, { useUnifiedTopology: true });
  let mintDecimalsCollection;
  
  /**
   * Initialize MongoDB connection and get the collection.
   */
  async function initMongo() {
    if (!mongoClient.isConnected()) {
      await mongoClient.connect();
    }
    const db = mongoClient.db("cache"); // Using database "cache"
    mintDecimalsCollection = db.collection("mintDecimals");
  }
  initMongo().catch(err => console.error("MongoDB initialization error:", err));
  
  /**
   * Fetches the decimals for a given token mint.
   * For SOL ("So11111111111111111111111111111111111111112"), returns 9.
   */
  async function getTokenDecimalsCached(mintAddress, connection) {
    // Check in-memory cache.
    if (mintDecimalsCache[mintAddress] !== undefined) {
      return mintDecimalsCache[mintAddress];
    }
    // For SOL, we know the decimals are 9.
    if (mintAddress === "So11111111111111111111111111111111111111112") {
      mintDecimalsCache[mintAddress] = 9;
      return 9;
    }
    // Check MongoDB cache.
    try {
      if (!mintDecimalsCollection) await initMongo();
      const doc = await mintDecimalsCollection.findOne({ mintAddress });
      if (doc && doc.decimals !== undefined) {
        mintDecimalsCache[mintAddress] = doc.decimals;
        return doc.decimals;
      }
    } catch (mongoErr) {
      console.error(`Error checking MongoDB for ${mintAddress}:`, mongoErr);
    }
    // If not cached, fetch from blockchain.
    try {
      const mintInfo = await getMint(connection, new PublicKey(mintAddress));
      mintDecimalsCache[mintAddress] = mintInfo.decimals;
      // Save the decimals in MongoDB.
      try {
        if (mintDecimalsCollection) {
          await mintDecimalsCollection.updateOne(
            { mintAddress },
            { $set: { decimals: mintInfo.decimals } },
            { upsert: true }
          );
        }
      } catch (mongoWriteErr) {
        console.error(`Error saving ${mintAddress} to MongoDB:`, mongoWriteErr);
      }
      return mintInfo.decimals;
    } catch (err) {
      console.error(`Error fetching mint info for ${mintAddress}:`, err);
      throw err;
    }
  }
  
  /**
   * Formats a raw token amount (number or string) into a human-readable string
   * using the token mint’s decimals.
   */
  async function formatTokenAmount(amount, mintAddress, connection) {
    const decimals = await getTokenDecimalsCached(mintAddress, connection);
    const raw = Number(amount);
    if (isNaN(raw)) return "0";
    const humanAmount = raw / Math.pow(10, decimals);
    const displayDecimals = decimals > 6 ? 6 : decimals;
    return humanAmount.toLocaleString('en-US', {
      minimumFractionDigits: displayDecimals,
      maximumFractionDigits: displayDecimals
    });
  }
  
  /**
   * Returns a truncated version of a token mint address.
   * For example, "EPjFWdd5AufqSSqeM2qN1xzybapC8wEGGkZwyTDt1v" becomes "EPjF...Dt1v".
   */
  function getTruncatedAddress(mintAddress) {
    const str = mintAddress.toString();
    if (str.length <= 10) return str;
    return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
  }
  
  /**
   * Retrieves detailed formatted balances as an array of objects.
   * Each object includes { symbol, mint, balance } where symbol is the truncated mint address as a Markdown link.
   */
  async function getDetailedFormattedBalances(wallet, connection) {
    const rawBalances = { solBalance: 0, tokenBalances: {} };
    try {
      rawBalances.solBalance = await connection.getBalance(wallet.publicKey);
      const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });
      for (const tokenAccount of tokenAccounts.value) {
        const accountInfo = await getAccount(connection, tokenAccount.pubkey);
        rawBalances.tokenBalances[accountInfo.mint.toBase58()] = Number(accountInfo.amount);
      }
    } catch (error) {
      console.error('Error fetching raw balances:', error);
    }
    const result = [];
    // For SOL:
    const solFormatted = await formatTokenAmount(rawBalances.solBalance, "So11111111111111111111111111111111111111112", connection);
    result.push({
      symbol: `[**SOL**](https://solscan.io/token/So11111111111111111111111111111111111111112)`,
      mint: "So11111111111111111111111111111111111111112",
      balance: solFormatted
    });
    // For each token:
    for (const [mint, balance] of Object.entries(rawBalances.tokenBalances)) {
      const truncated = getTruncatedAddress(mint);
      const symbolDisplay = `[**${truncated}**](https://solscan.io/token/${mint})`;
      const formattedBalance = await formatTokenAmount(balance, mint, connection);
      result.push({
        symbol: symbolDisplay,
        mint,
        balance: formattedBalance
      });
    }
    return result;
  }
  
  /**
   * Sends a formatted swap quote message to the user.
   */
  async function sendQuoteDetails(bot, connection, userId, quote, inputMint, outputMint) {
    try {
      const formattedInput = await formatTokenAmount(quote.inAmount, inputMint, connection);
      const formattedOutput = await formatTokenAmount(quote.outAmount, outputMint, connection);
      const message = `📜 **Swap Quote Details:**\n\n` +
        `• **Input Amount:** ${formattedInput}\n\n` +
        `• **Expected Output:** ${formattedOutput}\n\n` +
        `• **Static Slippage:** ${quote.slippageBps} bps\n\n` +
        `• **Dynamic Slippage Range:** ${quote.dynamicSlippage ? `${quote.dynamicSlippage.minBps}-${quote.dynamicSlippage.maxBps} bps` : 'N/A'}`;
      await bot.sendMessage(userId, message, { parse_mode: "Markdown" });
    } catch (error) {
      console.error("Error sending quote details:", error.message);
    }
  }
  
  /* =======================================================
     End Formatting Helpers
     ======================================================= */
  
  export { getTokenDecimalsCached as getTokenDecimals, formatTokenAmount, getDetailedFormattedBalances, sendQuoteDetails };
  
  /**
   * WebSocket Client for Jupiter API
   */
  class JupiterWebSocket {
    constructor() {
      this.ws = null;
      this.reconnectDelay = 2000;
      this.maxReconnectAttempts = 5;
      this.pendingRequests = new Map();
      this.connect();
    }
  
    connect() {
      console.log("🔌 Connecting to Jupiter WebSocket...");
      this.ws = new WebSocket(defaultConfig.jupiterWebSocket);
  
      this.ws.on("open", () => {
        console.log("✅ WebSocket Connected to Jupiter API.");
      });
  
      this.ws.on("message", (message) => {
        const data = JSON.parse(message.toString());
        console.log("📩 Received WebSocket Message:", data);
        if (this.pendingRequests.has(data.id)) {
          this.pendingRequests.get(data.id)(data.result);
          this.pendingRequests.delete(data.id);
        }
      });
  
      this.ws.on("close", (code, reason) => {
        console.warn(`🔌 WebSocket Closed. Code: ${code}, Reason: ${reason}`);
        this.reconnect();
      });
  
      this.ws.on("error", (error) => {
        console.error("❌ WebSocket Error:", error.message);
      });
    }
  
    reconnect() {
      setTimeout(() => {
        console.log("🔄 Reconnecting WebSocket...");
        this.connect();
      }, this.reconnectDelay);
    }
  
    send(request) {
      return new Promise((resolve, reject) => {
        if (this.ws.readyState !== WebSocket.OPEN) {
          console.warn("⚠️ WebSocket not open. Reconnecting...");
          this.reconnect();
          return reject(new Error("WebSocket not connected"));
        }
        this.pendingRequests.set(request.id, resolve);
        this.ws.send(JSON.stringify(request));
      });
    }
  }
  
  /**
   * Jupiter QuickNode Class for Swaps using WebSockets
   */
  export class JupiterQuickNode {
    constructor(bot) {
      this.bot = bot;
      this.solanaConnection = new Connection(defaultConfig.solanaEndpoint);
      this.wsClient = new JupiterWebSocket();
    }
  
    /**
     * Get Quote using WebSocket with retries
     * @param {Object} quoteRequest - Parameters for the quote request
     */
    async getQuoteWithRetries(quoteRequest, maxRetries = 3, delay = 1000) {
      let attempt = 0;
      while (attempt < maxRetries) {
        attempt++;
        try {
          console.log(`🔄 Fetching quote (Attempt ${attempt}/${maxRetries})...`);
          const requestId = Date.now();
          const request = {
            jsonrpc: "2.0",
            method: "quote",
            params: quoteRequest,
            id: requestId
          };
  
          const quote = await this.wsClient.send(request);
          console.log("📜 Quote Received:", quote);
          return quote;
        } catch (error) {
          console.warn(`⚠️ Quote fetch attempt ${attempt} failed: ${error.message}`);
          if (attempt < maxRetries) {
            await sleep(delay);
          } else {
            throw new Error("Failed to fetch quote after multiple retries.");
          }
        }
      }
    }
  
    /**
     * Get Quote (Preserving function name & sending updates)
     */
    async getQuote(quoteRequest) {
      return await this.getQuoteWithRetries(quoteRequest);
    }
  
    /**
     * Execute Swap using WebSocket with retries
     * @param {Object} route - Swap route from quote
     * @param {PublicKey} wallet - User wallet public key
     */
    async executeSwapWithRetries(route, wallet, maxRetries = 3, delay = 1000) {
      let attempt = 0;
      while (attempt < maxRetries) {
        attempt++;
        try {
          console.log(`🔄 Executing swap (Attempt ${attempt}/${maxRetries})...`);
          const requestId = Date.now();
          const request = {
            jsonrpc: "2.0",
            method: "swap",
            params: {
              userPublicKey: wallet.publicKey.toBase58(),
              quoteResponse: route
            },
            id: requestId
          };
  
          const swapResult = await this.wsClient.send(request);
          console.log("✅ Swap Executed:", swapResult);
          return swapResult;
        } catch (error) {
          console.warn(`⚠️ Swap attempt ${attempt} failed: ${error.message}`);
          if (attempt < maxRetries) {
            await sleep(delay);
          } else {
            throw new Error("Swap execution failed after multiple retries.");
          }
        }
      }
    }
  
    /**
     * Execute Swap (Preserving function name & sending updates)
     */
    async executeSwap({ route, wallet }) {
      return await this.executeSwapWithRetries(route, wallet);
    }
  
    /**
     * Start Jupiter Swap Flow: fetch quote, update user, execute swap, send final updates.
     */
    async startJupiterSwap({ wallet, inputMint, outputMint, amount, userId }) {
      try {
        await this.sendSwapUpdate(userId, "fetching_quote", { inputMint, outputMint });
        console.log('🔄 Fetching swap quote from Jupiter API...');
        const quote = await this.getQuote({ inputMint, outputMint, amount: amount.toString() });
        
        // Send the formatted quote details to the user before proceeding.
        await sendQuoteDetails(this.bot, this.solanaConnection, userId, quote, inputMint, outputMint);
        
        await this.sendSwapUpdate(userId, "executing_swap", { inputMint, outputMint, amount });
        console.log('🔄 Executing swap transaction...');
        const swapResult = await this.executeSwap({ route: quote, wallet });
        console.log('✅ Swap executed:', swapResult);
        
        await this.sendSwapUpdate(userId, "swap_success", {
          inputMint,
          inAmount: await formatTokenAmount(amount, inputMint, this.solanaConnection),
          outputMint,
          outAmount: await formatTokenAmount(quote.outAmount, outputMint, this.solanaConnection),
          txId: swapResult.txId,
        });
        
        // Optionally: fetch updated balances and send balance update
        /*
        const detailedBalances = await getDetailedFormattedBalances(wallet, this.solanaConnection);
        await this.sendSwapUpdate(userId, "balance_update", { message: JSON.stringify(detailedBalances, null, 2) });
        */
        
        await this.logSwap({
          inputToken: inputMint,
          inAmount: amount,
          outputToken: outputMint,
          outAmount: quote.outAmount,
          txId: swapResult.txId,
          timestamp: new Date().toISOString(),
        });
        
        return swapResult;
      } catch (error) {
        console.error('❌ Error during swap execution:', error.message);
        await this.sendSwapUpdate(userId, "swap_failed", { errorMessage: error.message });
        throw new Error('Failed to complete token swap.');
      }
    }
  
    async sendSwapUpdate(userId, stage, details = {}) {
      try {
        let message = "";
        switch (stage) {
          case "fetching_quote":
            message = `🔄 **Fetching Swap Quote...**\n\n💱 **From:** \`${details.inputMint.slice(0, 4)}...${details.inputMint.slice(-4)}\`\n🔹 **To:** \`${details.outputMint.slice(0, 4)}...${details.outputMint.slice(-4)}\`\n\n⏳ Retrieving the best rates...`;
            break;
          case "executing_swap":
            message = `⚡ **Executing Swap Transaction...**\n\n💰 **Amount:** \`${await formatTokenAmount(details.amount, details.inputMint, this.solanaConnection)}\` tokens\n🪙 **Swapping:** [${details.inputMint.slice(0, 4)}...${details.inputMint.slice(-4)}](https://solscan.io/address/${details.inputMint}) → [${details.outputMint.slice(0, 4)}...${details.outputMint.slice(-4)}](https://solscan.io/address/${details.outputMint})\n\n🚀 Processing...`;
            break;
          case "quote_details":
            message = `📜 **Swap Quote Details:**\n${details.message}`;
            break;
          case "swap_success":
            message = `🎉 **Swap Successful!**\n\n🔁 **Swap Summary:**\n🔹 **From:** [${details.inputMint.slice(0, 4)}...${details.inputMint.slice(-4)}](https://solscan.io/address/${details.inputMint})\n💰 **Amount Sent:** \`${details.inAmount}\`\n🔹 **To:** [${details.outputMint.slice(0, 4)}...${details.outputMint.slice(-4)}](https://solscan.io/address/${details.outputMint})\n💎 **Amount Received:** \`${details.outAmount}\`\n\n🔗 **[View Transaction](https://solscan.io/tx/${details.txId})**`;
            break;
          case "balance_update": {
            let balanceMessage = "";
            try {
              const balancesArray = typeof details.message === 'string' ? JSON.parse(details.message) : details.message;
              for (const entry of balancesArray) {
                balanceMessage += `${entry.symbol}: ${entry.balance}\n\n`;
              }
            } catch (err) {
              balanceMessage = details.message;
            }
            message = `🏦 **Updated Balances:**\n\n${balanceMessage}`;
            break;
          }
          case "swap_failed":
            message = `🚨 **Swap Failed!**\n\n❌ Error: ${details.errorMessage}\n\n⚠️ Please check your balance or try again later.`;
            break;
          default:
            message = `ℹ️ **Status Update:** ${stage}`;
            break;
        }
        await this.bot.sendMessage(userId, message, { parse_mode: "Markdown" });
      } catch (err) {
        console.error("❌ Error sending swap update:", err.message);
      }
    }
  
    formatNumber(num, options = {}) {
      const { maximumFractionDigits = 2, locale = 'en-US' } = options;
      const number = typeof num === 'number' ? num : parseFloat(num);
      if (isNaN(number)) return '0';
      return number.toLocaleString(locale, { maximumFractionDigits });
    }
  
    async logSwap(logArgs) {
      try {
        const dirPath = path.join(process.cwd(), 'history');
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        const filePath = path.join(dirPath, 'swapLogs.json');
        const data = { ...logArgs };
        if (fs.existsSync(filePath)) {
          let fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          if (Array.isArray(fileData)) {
            fileData.push(data);
          } else {
            console.warn('Unexpected log file format. Resetting log file.');
            fileData = [data];
          }
          fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
        } else {
          fs.writeFileSync(filePath, JSON.stringify([data], null, 2));
        }
      } catch (error) {
        console.error('Error logging swap:', error);
      }
    }
  }
  