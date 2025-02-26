import dotenv from 'dotenv';
dotenv.config();
import axios from 'axios';
import { config } from './core/config.js';

// OpenSSL & Ngrok Tunneling 
import https from "https";
import fs from "fs";
import express from "express";
import path from 'path'; // Added import for 'path' module
import { fileURLToPath } from "url";

// Core services
import { bot } from './core/bot.js';
import { intentProcessor } from './services/ai/processors/IntentProcessor.js';
import { unifiedMessenger } from './core/UnifiedMessageHandler.js';
import { db } from './core/database.js';
import { rateLimiter } from './core/rate-limiting/RateLimiter.js';
import { circuitBreakers } from './core/circuit-breaker/index.js';

// Service imports
import { tasksService } from './services/tasks/TasksService.js';
import { taskScheduler } from './services/tasks/Scheduler.js';
import { priceAlertService } from './services/priceAlerts.js';
import { walletService } from './services/wallet/index.js';
import { butlerService } from './services/butler/ButlerService.js';
import { shopifyService } from './services/shopify/ShopifyService.js';
import { ErrorHandler } from './core/errors/index.js';

// Learning systems
import { kolLearningSystem } from './services/ai/flows/learning/KOLLearningSystem.js';
import { strategyManager } from './services/ai/flows/learning/StrategyManager.js';
import { twitterService } from './services/twitter/index.js';

// Moralis Web3 SDK
import Moralis from 'moralis';

let isShuttingDown = false;

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

// Ngrok tunneling for our Google Cloud
async function startNgrokTunnel() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const app = express();
  const options = {
    key: fs.readFileSync(path.join(__dirname, '../config/openssl/key.pem')),
    cert: fs.readFileSync(path.join(__dirname, '../config/openssl/cert.pem'))
  };
  const port = process.env.NGROK_PORT || 5050;
  return new Promise((resolve, reject) => {
    const server = https.createServer(options, app);
    server.listen(port, () => {
      console.log(`✅ Ngrok Server running on http://localhost:${port}`);
      resolve(server);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${port} is already in use.`);
      } else {
        console.error('❌ Error setting up Ngrok Tunneling:', err);
      }
      reject(err);
    });
  });
}

async function initializeServices() {
  console.log('🔧 Initializing core services...');

  try {
    // Initialize database first
    console.log('📡 Connecting to MongoDB...');
    await db.connect();

    await intentProcessor.initialize();

    // Messenger & Command Registry Setup
    await unifiedMessenger.initialize();

    // Initialize wallet service
    console.log('👛 Initializing wallet service...');
    await walletService.initialize();

    // Initialize rate limiter
    console.log('⚡ Initializing rate limiter...');
    await rateLimiter.initialize();

    // Initialize Butler Google service    
    console.log('☁️ Initializing Google services...');
    await butlerService.initialize();
    await startNgrokTunnel();

    // Initialize circuit breakers
    console.log('🔌 Setting up circuit breakers...');
    await circuitBreakers.initialize();

    // Initialize Shopify service
    console.log('🛍️ Initializing Shopify service...');
    await shopifyService.initialize();

    // Tasks and Queues
    await tasksService.initialize();

    // Tasks Scheduler    
    await taskScheduler.initialize();
    await taskScheduler.start(); 

    // Initialize Moralis    
    await Moralis.start({ apiKey: config.moralisAPIKey});

    // Initialize learning systems
    console.log('🧠 Initializing learning systems...');
    await Promise.all([
      kolLearningSystem.initialize(),
      strategyManager.initialize(),
    ]);

    // Price Alerts
    await priceAlertService.initialize();

    // Twitter KOL & Trench Chatter Monitoring
    await twitterService.initialize();

    console.log('✅ Core services initialized successfully :)');
  } catch (error) {
    console.error('❌ Error initializing core services:', error);
    throw error;
  }
}

async function startAgent() {
  try {
    console.log('🚀 Starting KATZ AI Agent...');

    // 1. Initialize core services
    await initializeServices();

    // 2. Start Telegram Bot Polling
    console.log('🤖 Starting KATZ! Telegram Interface...');
    await bot.startPolling();

    console.log('✅ D.A.I.L AI Agent is up and running!');
    
    return bot;
  } catch (error) {
    console.error('❌ Error during agent startup:', error);
    await cleanup(bot);
    process.exit(1);
  }
}

// Error Handlers
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

// Start the Agent
(async () => {
  const botInstance = await startAgent();
  setupErrorHandlers(botInstance);
})();
