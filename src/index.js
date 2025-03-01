import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import https from 'https';
import fs from 'fs';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import ngrok from 'ngrok'

import { config } from './core/config.js';

// Core services (Telegram bot, DB, etc.)
import { bot } from './core/bot.js';
import { db } from './core/database.js';
import { intentProcessor } from './services/ai/processors/IntentProcessor.js';
import { unifiedMessenger } from './core/UnifiedMessageHandler.js';
import { rateLimiter } from './core/rate-limiting/RateLimiter.js';
import { circuitBreakers } from './core/circuit-breaker/index.js';
import { startMonitoringDashboard } from './core/monitoring/Dashboard.js';
import { tasksService } from './services/tasks/TasksService.js';
import { taskScheduler } from './services/tasks/Scheduler.js';
import { priceAlertService } from './services/priceAlerts.js';
import { walletService } from './services/wallet/index.js';
import { shopifyService } from './services/shopify/ShopifyService.js';
import { ErrorHandler } from './core/errors/index.js';
import { kolLearningSystem } from './services/ai/flows/learning/KOLLearningSystem.js';
import { strategyManager } from './services/ai/flows/learning/StrategyManager.js';
import { twitterService } from './services/twitter/index.js';

// Moralis Web3 SDK
import Moralis from 'moralis';

let isShuttingDown = false;

/**
 * Graceful Cleanup
 */
async function cleanup(botInstance) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log('🛑 Shutting down AI Agent...');
  try {
    await db.disconnect();
    await walletService.cleanup();
    if (botInstance) {
      await botInstance.stopPolling();
    }
    console.log('✅ Cleanup completed.');
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    isShuttingDown = false;
  }
}

/**
 * Start an HTTPS server on local port 3000,
 * 
 */
async function startLocalHttpsAndNgrok() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  
  // 1) Create an Express app if you want to mount routes, etc.
  app.get('/', (req, res) => {
    res.send('Hello from local HTTPS server + ngrok!');
  });

  // 2) Create local HTTPS server
  const keyPath = path.join(__dirname, '../config/openssl/key.pem');
  const certPath = path.join(__dirname, '../config/openssl/cert.pem');
  const options = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath)
  };

  const localPort = config.ngrokPort || 3000;
  const server = https.createServer(options, app);

  await new Promise((resolve, reject) => {
    server.listen(localPort, () => {
      console.log(`✅ HTTPS server running on https://localhost:${localPort}`);
      resolve();
    });
    server.on('error', reject);
  });

  // 3) Start ngrok tunnel
  const authtoken = config.ngrokAuthToken;

  try {
    const publicUrl = await ngrok.connect({
      addr: localPort,
      authtoken,
      region: 'us',
      hostname: 'molly-humane-flea.ngrok-free.app',
      onStatusChange: status => console.log('ngrok status ->', status),
      onLogEvent: data => console.log('ngrok event ->', data)
    });

    console.log(`🔗 Ngrok tunnel established at: ${publicUrl}`);
    console.log('In use for Google OAuth callbacks:', `${publicUrl}/api/google/callback`);

    return { server, publicUrl };
  } catch (err) {
    console.error('❌ Error starting ngrok tunnel:', err);
    throw err;
  }
}

/**
 * Initialize all your core services
 */
async function initializeServices() {
  console.log('🔧 Initializing core services...');
  try {
    console.log('📡 Connecting to MongoDB...');
    await db.connect();

    await intentProcessor.initialize();
    await unifiedMessenger.initialize();

    console.log('👛 Initializing wallet service...');
    await walletService.initialize();

    console.log('⚡ Initializing rate limiter...');
    await rateLimiter.initialize();

    console.log('📊 Starting Express Server & monitoring dashboard...');
    await startMonitoringDashboard();

    console.log('☁️ Initializing Google API & Ngrok service...');
    await startLocalHttpsAndNgrok();

    console.log('🔌 Setting up circuit breakers...');
    await circuitBreakers.initialize();

    console.log('🛍️ Initializing Shopify service...');
    await shopifyService.initialize();

    console.log('⚙️ Initializing tasks and scheduler...');
    await tasksService.initialize();
    await taskScheduler.initialize();
    await taskScheduler.start();

    console.log('⚙️ Initializing Moralis...');
    await Moralis.start({ apiKey: config.moralisAPIKey });

    console.log('🧠 Initializing learning systems...');
    await Promise.all([
      kolLearningSystem.initialize(),
      strategyManager.initialize(),
    ]);

    console.log('💲 Initializing price alerts...');
    await priceAlertService.initialize();

    console.log('🐦 Initializing Twitter service...');
    await twitterService.initialize();

    console.log('✅ Core services initialized successfully :)');
  } catch (error) {
    console.error('❌ Error initializing core services:', error);
    throw error;
  }
}

/**
 * Main startup function
 */
async function startAgent() {
  try {
    console.log('🚀 Starting KATZ AI Agent...');
    await initializeServices();

    console.log('🤖 Starting Telegram Bot polling...');
    await bot.startPolling();

    console.log('✅ D.A.I.L AI Agent is up and running!');
    return bot;
  } catch (error) {
    console.error('❌ Error during agent startup:', error);
    await cleanup(bot);
    process.exit(1);
  }
}

/**
 * Error Handlers
 */
function setupErrorHandlers(botInstance) {
  process.on('SIGINT', async () => {
    console.log('🛑 SIGINT received. Shutting down...');
    await cleanup(botInstance);
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('🛑 SIGTERM received. Shutting down...');
    await cleanup(botInstance);
    process.exit(0);
  });

  process.on('uncaughtException', async (error) => {
    console.error('❌ Uncaught Exception:', error);
    await ErrorHandler.handle(error);
  });

  process.on('unhandledRejection', async (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    await ErrorHandler.handle(reason);
  });
}

/**
 * Run it all
 */
(async () => {
  const botInstance = await startAgent();
  setupErrorHandlers(botInstance);
})();
