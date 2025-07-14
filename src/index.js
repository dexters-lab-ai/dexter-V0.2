import dotenv from 'dotenv';
dotenv.config();
import cors from 'cors';

import WebSocket, { WebSocketServer } from 'ws';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import ngrok from 'ngrok';
import bodyParser from 'body-parser';

import { config } from './core/config.js';
import { bot } from './core/bot.js';
import { db } from './core/database.js';
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
import { intentProcessor } from './services/ai/processors/IntentProcessor.js';
import { unifiedMessenger } from './core/UnifiedMessageHandler.js';

import dashboardRouter from './core/monitoring/Dashboard.js';
import apiRoutes from './core/monitoring/api/routes.js';
import googleRoutes from './routes/googleRoutes.js';
import merchantRoutes from './routes/merchantRoutes.js';

import Moralis from 'moralis';

class ServerManager {
  constructor() {
    this.app = express();
    this.httpServer = null;
    this.ngrokUrl = null;
    this.__dirname = path.dirname(fileURLToPath(import.meta.url));
    this.wss = null;
    this.isShuttingDown = false;
    this.ngrokRetryCount = 0;
    this.httpRetryCount = 0;
    this.MAX_RETRIES = 10;
    this.RETRY_DELAY = 5000; // 5 seconds
    this.NGROK_HEALTHCHECK_INTERVAL = 600000; // 1 minute
    this.METRICS_UPDATE_INTERVAL = 600000; // 1 minute
    this.ngrokHealthcheckTimer = null;
    this.metricsUpdateTimer = null;
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
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.json({ 
        status: 'healthy', 
        uptime: process.uptime(),
        ngrokConnected: !!this.ngrokUrl,
        ngrokUrl: this.ngrokUrl,
        serverPort: 80
      });
    });      

    // Allow all origins
    this.app.use(cors({
      origin: '*',
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      allowedHeaders: 'Content-Type,Authorization',
      credentials: true,
    }));
  
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
    if (this.isShuttingDown) return null;
    
    try {
      // If server already exists, close it first
      if (this.httpServer) {
        await new Promise(resolve => this.httpServer.close(resolve));
        this.httpServer = null;
      }
      
      // Create the HTTP server
      this.httpServer = http.createServer(this.app);
  
      // Attach WebSocket server to the HTTP server
      this.wss = new WebSocketServer({ server: this.httpServer });
      this.wss.on('connection', (client) => {
        console.log('Client connected to WebSocket');
        client.on('message', (msg) => console.log('Received:', msg));
        client.on('close', () => console.log('Client disconnected'));
      });

      // Start metrics update timer
      this.startMetricsUpdater();
  
      // Return a promise that resolves when the server is listening
      return new Promise((resolve, reject) => {
        this.httpServer.listen(port, () => {
          console.log(`🚀 HTTP Server running on port ${port}`);
          this.httpRetryCount = 0; // Reset retry count on success
          resolve(this.httpServer);
        });
        
        this.httpServer.on('error', (error) => {
          console.error('HTTP server error:', error);
          
          if (this.isShuttingDown) {
            reject(error);
            return;
          }
          
          if (this.httpRetryCount < this.MAX_RETRIES) {
            this.httpRetryCount++;
            console.log(`🔄 Retrying HTTP server start (${this.httpRetryCount}/${this.MAX_RETRIES})...`);
            setTimeout(() => {
              this.startHttpServer(port)
                .then(resolve)
                .catch(reject);
            }, this.RETRY_DELAY);
          } else {
            console.error(`❌ Failed to start HTTP server after ${this.MAX_RETRIES} attempts`);
            reject(error);
          }
        });
      });
    } catch (error) {
      console.error('Failed to start HTTP server:', error);
      
      if (this.isShuttingDown) throw error;
      
      if (this.httpRetryCount < this.MAX_RETRIES) {
        this.httpRetryCount++;
        console.log(`🔄 Retrying HTTP server start (${this.httpRetryCount}/${this.MAX_RETRIES})...`);
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            this.startHttpServer(port)
              .then(resolve)
              .catch(reject);
          }, this.RETRY_DELAY);
        });
      } else {
        console.error(`❌ Failed to start HTTP server after ${this.MAX_RETRIES} attempts`);
        throw error;
      }
    }
  }

  startMetricsUpdater() {
    // Clear existing timer if it exists
    if (this.metricsUpdateTimer) {
      clearInterval(this.metricsUpdateTimer);
    }
    
    // Set up new timer for metrics broadcast
    this.metricsUpdateTimer = setInterval(async () => {
      try {
        if (!this.wss || this.isShuttingDown) return;
        
        const metrics = await startMonitoringDashboard();
        this.wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(metrics));
          }
        });
      } catch (error) {
        console.error('Error updating metrics:', error);
        // Don't crash on metrics error
      }
    }, this.METRICS_UPDATE_INTERVAL);
  }

  async verifyNgrokConnection() {
    try {
      // Check if the ngrok URL is still valid by making a request to it
      const response = await fetch(`${this.ngrokUrl}/health`, {
        method: 'GET',
        timeout: 5000
      });
      
      if (!response.ok) {
        throw new Error(`Ngrok health check failed with status: ${response.status}`);
      }
      
      return true;
    } catch (error) {
      console.error('Ngrok connection error:', error);
      return false;
    }
  }

  async startNgrokHealthcheck() {
    // Clear existing timer if it exists
    if (this.ngrokHealthcheckTimer) {
      clearInterval(this.ngrokHealthcheckTimer);
    }
    
    // Set up periodic check of ngrok connection
    this.ngrokHealthcheckTimer = setInterval(async () => {
      if (this.isShuttingDown) return;
      
      const isConnected = await this.verifyNgrokConnection();
      
      if (!isConnected) {
        console.log('🔄 Ngrok connection lost, restarting...');
        try {
          // Disconnect and kill ngrok
          if (this.ngrokUrl) {
            await ngrok.disconnect(this.ngrokUrl);
            await ngrok.kill();
          }
          
          // Restart ngrok
          await this.startNgrok(80);
        } catch (error) {
          console.error('Failed to restart Ngrok:', error.body.msg);
        }
      }
    }, this.NGROK_HEALTHCHECK_INTERVAL);
  }

  async startNgrok(port) {
    if (this.isShuttingDown) return null;
    
    try {
      // If ngrok is already connected, disconnect it first
      if (this.ngrokUrl) {
        await ngrok.disconnect(this.ngrokUrl);
        this.ngrokUrl = null;
      }
      
      this.ngrokUrl = await ngrok.connect({
        addr: port,
        authtoken: config.ngrokAuthToken,
        hostname: config.ngrokHostname,
        region: config.ngrokRegion || 'us',
        protocol: 'http',
        bind_tls: false,
        authtoken_from_env: true,
        config: {
          region: 'us',
          authtoken: config.ngrokAuthToken
        }
      });
      
      console.log(`🌍 Ngrok tunnel established at: ${this.ngrokUrl}`);      
      console.log(`🔗 OAuth callback URL: ${this.ngrokUrl}/api/google/callback`);
      
      // Make the ngrok URL available globally
      global.ngrokUrl = this.ngrokUrl;
      
      // Start health check for ngrok
      this.startNgrokHealthcheck();
      
      // Reset retry count on success
      this.ngrokRetryCount = 0;
      
      return this.ngrokUrl;
    } catch (error) {
      console.error('Failed to start Ngrok:', error);
      
      if (this.isShuttingDown) throw error;
      
      if (this.ngrokRetryCount < this.MAX_RETRIES) {
        this.ngrokRetryCount++;
        console.log(`🔄 Retrying Ngrok start (${this.ngrokRetryCount}/${this.MAX_RETRIES})...`);
        
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            this.startNgrok(port)
              .then(resolve)
              .catch(reject);
          }, this.RETRY_DELAY);
        });
      } else {
        console.error(`❌ Failed to start Ngrok after ${this.MAX_RETRIES} attempts`);
        throw error;
      }
    }
  }  

  async shutdown() {
    this.isShuttingDown = true;
    
    // Clear all timers
    if (this.ngrokHealthcheckTimer) {
      clearInterval(this.ngrokHealthcheckTimer);
      this.ngrokHealthcheckTimer = null;
    }
    
    if (this.metricsUpdateTimer) {
      clearInterval(this.metricsUpdateTimer);
      this.metricsUpdateTimer = null;
    }
    
    try {
      if (this.httpServer) {
        await new Promise(resolve => this.httpServer.close(resolve));
        this.httpServer = null;
      }
      
      this.ngrokUrl = await ngrok.connect({
        addr: port,
        authtoken: config.ngrokAuthToken,
        hostname: config.ngrokHostname,
        region: config.ngrokRegion || 'us',
        protocol: 'http',
        bind_tls: false,
        authtoken_from_env: true
      });
      
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
    this.servicesInitialized = false;
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
      
      // Don't exit the process, try to recover instead
      setTimeout(() => {
        console.log('🔄 Attempting recovery...');
        this.recoverFromFailure();
      }, 10000); // Wait 10 seconds before recovery attempt
    }
  }

  async recoverFromFailure() {
    try {
      console.log('🔄 Recovery process started');
      
      // If services weren't initialized, try again
      if (!this.servicesInitialized) {
        await this.initializeServices();
      }
      
      // Try to start servers again
      await this.startServers();
      
      console.log('✅ Recovery successful');
    } catch (error) {
      console.error('Recovery failed:', error);
      
      // Try again after a delay
      setTimeout(() => {
        this.recoverFromFailure();
      }, 30000); // Wait 30 seconds before next attempt
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
        flipperMode.initialize(),
        pumpFunService.connect(),
      ]);
  
      console.log('✅ Core services initialized successfully');
      this.servicesInitialized = true;
    } catch (error) {
      console.error('Error initializing services:', error);
      this.servicesInitialized = false;
      throw error;
    }
  }  

  async startServers() {
    try {
      await this.serverManager.startHttpServer(80); 
      await this.serverManager.startNgrok(80);  
      
      // Start the monitoring dashboard
      await startMonitoringDashboard();
      console.log(`📊 Monitoring Dashboard running on port 80`);
      
      await bot.startPolling();
      
      return true;
    } catch (error) {
      console.error('Error starting servers:', error);
      throw error;
    }
  }

  setupErrorHandlers() {
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      console.log('🛑 SIGINT received. Shutting down...');
      this.isShuttingDown = true;
      console.log('🛑 Flushing PumpFun token cache before exit...');
      try {
        await pumpFunService.cleanup();
        await this.serverManager.shutdown();
      } catch (error) {
        console.error('Error during shutdown:', error);
      }
      process.exit(0);
    });
    
    process.on('SIGTERM', async () => {
      console.log('🛑 SIGTERM received. Shutting down...');
      this.isShuttingDown = true;
      console.log('🛑 Flushing PumpFun token cache before exit...');
      try {
        await pumpFunService.cleanup();
        await this.serverManager.shutdown();
      } catch (error) {
        console.error('Error during shutdown:', error);
      }
      process.exit(0);
    });    

    // For uncaught exceptions, log but don't exit
    process.on('uncaughtException', async (error) => {
      console.error('❌ Uncaught Exception:', error);
      
      // Don't shutdown the server on uncaught exceptions
      // Instead, log the error and continue running
      
      // If this is a critical error with the server, try to recover
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        console.log('🔄 Critical server error, attempting recovery...');
        setTimeout(() => {
          this.serverManager.startHttpServer(80).catch(console.error);
        }, 5000);
      }
    });

    // For unhandled rejections, log but don't exit
    process.on('unhandledRejection', async (reason) => {
      console.error('❌ Unhandled Rejection:', reason);
      
      // Don't shutdown the server on unhandled rejections
      // Instead, log the error and continue running
    });
  }
}

// Global exception handler to catch any errors that might crash the app
try {
  const app = new Application();
  app.initialize().catch(error => {
    console.error('Application initialization error:', error);
    // Keep the process running even if initialization fails
  });
} catch (error) {
  console.error('Critical application error:', error);
  // Keep the process running even on critical errors
}