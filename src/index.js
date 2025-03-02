import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import http from 'http'; // Use http instead of https
import path from 'path';
import { fileURLToPath } from 'url';
import ngrok from 'ngrok';
import bodyParser from 'body-parser';

import { config } from './core/config.js';
import { bot } from './core/bot.js';
import { db } from './core/database.js';
import { intentProcessor } from './services/ai/processors/IntentProcessor.js';
import { unifiedMessenger } from './core/UnifiedMessageHandler.js';
import { rateLimiter } from './core/rate-limiting/RateLimiter.js';
import { circuitBreakers } from './core/circuit-breaker/index.js';
import { tasksService } from './services/tasks/TasksService.js';
import { taskScheduler } from './services/tasks/Scheduler.js';
import { priceAlertService } from './services/priceAlerts.js';
import { walletService } from './services/wallet/index.js';
import { shopifyService } from './services/shopify/ShopifyService.js';
import { kolLearningSystem } from './services/ai/flows/learning/KOLLearningSystem.js';
import { strategyManager } from './services/ai/flows/learning/StrategyManager.js';
import { twitterService } from './services/twitter/index.js';
import { flipperMode } from './services/pumpfun/FlipperMode.js';
import { startMonitoringDashboard } from './core/monitoring/Dashboard.js'; 

import DashboardServer from './core/monitoring/DashboardServer.js';
import googleRoutes from './routes/googleRoutes.js';
import merchantRoutes from './routes/merchantRoutes.js';

import Moralis from 'moralis';

class ServerManager {
  constructor() {
    this.app = express();
    this.httpServer = null;  // Changed to httpServer
    this.ngrokUrl = null;
    this.__dirname = path.dirname(fileURLToPath(import.meta.url));
  }

  setupMiddleware() {
    this.app.use(bodyParser.json());
    this.app.use('/api', googleRoutes);
    this.app.use('/api/merchants', merchantRoutes);
  }  

  async startHttpServer(port) {
    try {
      // Switch to HTTP since we don't need SSL certificates
      this.httpServer = http.createServer(this.app);

      return new Promise((resolve, reject) => {
        this.httpServer.listen(port, () => {
          console.log(`🚀 HTTP Server running on port ${port}`);
          resolve(this.httpServer);
        });
        this.httpServer.on('error', reject);
      });
    } catch (error) {
      console.error('Failed to start HTTP server:', error);
      throw error;
    }
  }

  async startNgrok(port) {
    try {
      // Now using port 80 as per Ngrok's recommendation
      this.ngrokUrl = await ngrok.connect({
        addr: port,  // Port for Ngrok to tunnel to
        authtoken: config.ngrokAuthToken,
      });

      console.log(`🌍 Ngrok tunnel established at: ${this.ngrokUrl}`);
      console.log(`🔗 OAuth callback URL: ${this.ngrokUrl}/api/google/callback`);

      return this.ngrokUrl;
    } catch (error) {
      console.error('Failed to start Ngrok:', error);
      throw error;
    }
  }

  async shutdown() {
    try {
      if (this.httpServer) {
        await new Promise(resolve => this.httpServer.close(resolve));
      }
      if (this.ngrokUrl) {
        await ngrok.disconnect(this.ngrokUrl);
        await ngrok.kill();
      }
      console.log('✅ Servers shut down successfully');
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
  }
}

class Application {
  constructor() {
    this.serverManager = new ServerManager();
    this.isShuttingDown = false;
  }

  async initialize() {
    try {
      this.serverManager.setupMiddleware();
      await this.initializeServices();
      await this.startServers();
      this.setupErrorHandlers();
      console.log('✅ Application initialized successfully');
    } catch (error) {
      console.error('Failed to initialize application:', error);
      process.exit(1);
    }
  }

  async initializeServices() {
    console.log('🔧 Initializing core services...');
    try {
      await db.connect();
      await intentProcessor.initialize();
      await unifiedMessenger.initialize();
      await walletService.initialize();
      await rateLimiter.initialize();
      await circuitBreakers.initialize();
      await shopifyService.initialize();
      await tasksService.initialize();
      await taskScheduler.initialize();
      await taskScheduler.start();
      await Moralis.start({ apiKey: config.moralisAPIKey });
      
      await Promise.all([
        kolLearningSystem.initialize(),
        strategyManager.initialize(),
        priceAlertService.initialize(),
        twitterService.initialize(),
        // Initialize FlipperMode for DB collections in Dashboard
        flipperMode.initialize() 
      ]);
  
      console.log('✅ Core services initialized successfully');
    } catch (error) {
      console.error('Error initializing services:', error);
      throw error;
    }
  }  

  async startServers() {
    try {
      await this.serverManager.startHttpServer(80); 
      await this.serverManager.startNgrok(80);  
      
      // Automatically start monitoring dashboard when the server starts
      await startMonitoringDashboard(); // Starts the monitoring dashboard automatically
      
      const dashboardPort = process.env.DASHBOARD_PORT || 4000;
      console.log(`📊 Starting Monitoring Dashboard on port ${dashboardPort}`);
      
      // Create and start the dashboard server
      const dashboardServer = new DashboardServer();
      await dashboardServer.start();
      
      await bot.startPolling();
    } catch (error) {
      console.error('Error starting servers:', error);
      throw error;
    }
  }

  setupErrorHandlers() {
    process.on('SIGINT', async () => {
      console.log('🛑 SIGINT received. Shutting down...');
      await this.serverManager.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('🛑 SIGTERM received. Shutting down...');
      await this.serverManager.shutdown();
      process.exit(0);
    });

    process.on('uncaughtException', async (error) => {
      console.error('❌ Uncaught Exception:', error);
      await this.serverManager.shutdown();
      process.exit(1);
    });

    process.on('unhandledRejection', async (reason) => {
      console.error('❌ Unhandled Rejection:', reason);
      await this.serverManager.shutdown();
    });
  }
}

const app = new Application();
app.initialize().catch(console.error);
