import dotenv from 'dotenv';
dotenv.config();

import WebSocket, { WebSocketServer } from 'ws';
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
import { pumpFunService } from './services/pumpfun/PumpFunService.js';
import { startMonitoringDashboard } from './core/monitoring/Dashboard.js'; 

import dashboardRouter from './core/monitoring/Dashboard.js';
import apiRoutes from './core/monitoring/api/routes.js';
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

  setupRoutes() {
    // Serve static files from public directory
    this.app.use(express.static(path.join(this.__dirname, 'public')));
  
    // Root route handler - serves the dashboard
    this.app.get('/', (req, res) => {
      res.sendFile(path.join(this.__dirname, 'public', 'index.html'));
    });
  
    // Mount API routes under /api – all endpoints defined in routes.js are available under /api
    this.app.use('/api', apiRoutes); 
  
    // Mount Google routes (e.g., for OAuth callbacks)
    this.app.use('/api/google', googleRoutes);
  
    // Mount dashboard routes
    this.app.use('/dashboard', dashboardRouter);
  
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ status: 'healthy', uptime: process.uptime() });
    });
  
    // Handle 404s
    this.app.use((req, res) => {
      res.status(404).sendFile(path.join(this.__dirname, 'public', '404.html'));
    });
  }  

  setupMiddleware() {
    this.app.use(bodyParser.json());
    this.app.use('/api/merchants', merchantRoutes);
  }  

  async startHttpServer(port) {
    try {
      // Create the HTTP server
      this.httpServer = http.createServer(this.app);
  
      // Attach WebSocket server to the HTTP server
      const wss = new WebSocketServer({ server: this.httpServer });
      wss.on('connection', (client) => {
        console.log('Client connected to WebSocket');
        client.on('message', (msg) => console.log('Received:', msg));
        client.on('close', () => console.log('Client disconnected'));
      });

      // Broadcast updated metrics on repeat
      setInterval(async () => {
        const metrics = await startMonitoringDashboard();
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(metrics));
          }
        });
      }, 900000);
  
      // Return a promise that resolves when the server is listening
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
      this.ngrokUrl = await ngrok.connect({
        addr: port,
        authtoken: config.ngrokAuthToken,
        hostname: config.ngrokHostname,
      });
      console.log(`🌍 Ngrok tunnel established at: ${this.ngrokUrl}`);      
      console.log(`🔗 OAuth callback URL: ${this.ngrokUrl}/api/google/callback`);
      // Make the ngrok URL available globally
      global.ngrokUrl = this.ngrokUrl;
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
      this.serverManager.setupRoutes();
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
        flipperMode.initialize(),
        pumpFunService.connect()
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
      
      const dashboardPort = 80;
      console.log(`📊 Starting Monitoring Dashboard on port ${dashboardPort}`);
      
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
