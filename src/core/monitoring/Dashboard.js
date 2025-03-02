import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { healthMonitor } from '../health/HealthMonitor.js';
import { walletService } from '../../services/wallet/index.js';
import { pumpFunService } from '../../services/pumpfun/index.js';
import { priceAlertService } from '../../services/priceAlerts.js';
import { aiMetricsService } from '../../services/aiMetricsService.js';
import { flipperMode } from '../../services/pumpfun/FlipperMode.js';
import { User } from '../../models/User.js';
import { ErrorHandler } from '../errors/index.js';
import os from 'os';

const dashboardRouter = express.Router();

// Function to fetch and compile all metrics
const fetchMetrics = async () => {
  try {
    const activeUsers = await User.countDocuments({ isActive: true });
    const [
      pumpFunMetrics,
      priceAlertMetrics,
      aiMetrics,
      flipperMetrics,
      walletHealth,
      databaseHealth,
    ] = await Promise.allSettled([
      pumpFunService.checkHealth(),
      priceAlertService.getMetrics(),
      aiMetricsService.fetchLiveMetrics(),
      flipperMode.fetchMetrics(),
      walletService.checkHealth(),
      checkDatabaseStatus()
    ]);

    // Convert object results into readable strings
    const formatResult = (result) => {
      return result.status === 'fulfilled'
        ? JSON.stringify(result.value, null, 2)
        : 'Error';
    };

    return {
      uptime: process.uptime().toFixed(2) + " sec",
      memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2), // in MB
      cpuUsage: os.loadavg()[0].toFixed(2), // 1 min load average
      osLoadAvg: os.loadavg(),
      activeUsers,
      walletHealth: formatResult(walletHealth),
      databaseHealth: formatResult(databaseHealth),
      pumpFun: formatResult(pumpFunMetrics),
      priceAlerts: formatResult(priceAlertMetrics),
      aiMetrics: formatResult(aiMetrics),
      flipperMetrics: formatResult(flipperMetrics),
    };
  } catch (error) {
    await ErrorHandler.handle(error);
    return { error: 'Failed to fetch some metrics' };
  }
};

// Helper functions to check individual service health
const checkDatabaseStatus = async () => {
  try {
    await db.ping();
    return 'healthy';
  } catch (error) {
    return 'unhealthy';
  }
};

const checkBotStatus = async () => {
  try {
    if (bot && bot.isRunning) return 'healthy';
    return 'unhealthy';
  } catch (error) {
    return 'unhealthy';
  }
};

// Dashboard route to fetch metrics and display them on the webpage
dashboardRouter.get('/', async (req, res) => {
  try {
    const metrics = await fetchMetrics();

    // Render HTML page with the gathered metrics
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Dexter's AI Lab - D.A.I.L Dashboard</title>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap">
        <style>
          body {
            font-family: 'SF Toontime', sans-serif;
            background-color: #ADD8E6; /* Light blue background */
            color: #fff;
            margin: 0;
            padding: 20px;
          }

          h1, h2 {
            font-family: 'SF Toontime', sans-serif;
            text-align: center;
            color: #ff6600;
          }

          .container {
            max-width: 1200px;
            margin: auto;
          }

          .metrics {
            padding: 20px;
            background: rgba(0, 0, 0, 0.6);
            border-radius: 10px;
            margin-bottom: 30px;
            box-shadow: 4px 4px 10px rgba(0, 0, 0, 0.3);
          }

          .section-title {
            font-weight: bold;
            color: #ff6600;
            text-align: left;
          }

          .metrics p {
            font-size: 16px;
            line-height: 1.8;
          }

          .table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
          }

          .table th, .table td {
            border: 1px solid #fff;
            padding: 10px;
            text-align: center;
          }

          .table th {
            background-color: #ff6600;
            color: white;
          }

          .healthy { color: green; }
          .unhealthy { color: red; }

          .icon {
            width: 60px;
            height: 60px;
            margin-right: 15px;
          }

          .header-logo img {
            width: 120px;
            height: auto;
          }

          .api-section {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px;
            background: #c3cfe2;
            border-radius: 10px;
            margin-bottom: 20px;
          }

          .ai-section {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 20px;
            background: #f9d8e6;
            border-radius: 10px;
            margin-bottom: 20px;
          }

          .metrics-section {
            display: flex;
            justify-content: space-between;
          }

          .api-info {
            display: flex;
            flex-direction: column;
            align-items: flex-start;
          }

          .api-info p {
            margin-bottom: 10px;
          }

          .subsection {
            display: flex;
            justify-content: space-between;
            background: #ffffff;
            padding: 10px;
            border-radius: 8px;
            margin-bottom: 15px;
          }

        </style>
      </head>
      <body>
        <div class="container">
          <header class="header-logo">
            <img src="../../assets/images/dail.png" alt="D.A.I.L" />
            <h1>Dexter's AI Lab - D.A.I.L Dashboard</h1>
            <p><strong>What's up?: "Empowering crypto and daily life with AI"</strong></p>
            <p><a href="https://x.com/dexters_ai_lab" target="_blank">Twitter</a> | <a href="https://t.me/the_ai_lab_announcements" target="_blank">Telegram</a> | GitHub (Private) | Website Coming Soon</p>
          </header>

          <!-- System Metrics -->
          <div class="metrics">
            <h2>System Metrics</h2>
            <p>Memory Usage: ${metrics.memoryUsage} MB</p>
            <p>CPU Usage: ${metrics.cpuUsage}%</p>
            <p>Uptime: ${metrics.uptime} seconds</p>
            <p>OS Load Average: ${metrics.osLoadAvg.join(', ')}</p>
          </div>

          <!-- Service Status -->
          <div class="metrics">
            <h2>Service Status</h2>
            <div class="api-section">
              <img class="icon" src="../../assets/images/soldier.png" alt="API" />
              <div class="api-info">
                <h3>API Metrics</h3>
                <p>Active Users: ${metrics.activeUsers}</p>
                <p>Database: <span class="${metrics.databaseHealth}">${metrics.databaseHealth}</span></p>
                <p>Wallet: <span class="${metrics.walletHealth}">${metrics.walletHealth}</span></p>
                <p>PumpFun Service: <span class="${metrics.pumpFun}">${metrics.pumpFun}</span></p>
                <p>Price Alerts: <span class="${metrics.priceAlerts}">${metrics.priceAlerts}</span></p>
                <p>AI Metrics: <span class="${metrics.aiMetrics}">${metrics.aiMetrics}</span></p>
              </div>
            </div>
          </div>

          <!-- AI Section -->
          <div class="metrics">
            <h2>AI Section</h2>
            <div class="ai-section">
              <img class="icon" src="../../assets/images/helmet.png" alt="AI Models" />
              <div class="api-info">
                <h3>AI Models</h3>
                <p>Models: 3</p>
                <p>TTS LLMs: 2</p>
                <p>STT LLMs: 1</p>
                <p>Average Response Time: 0.5 seconds</p>
              </div>
            </div>
          </div>

          <!-- API Logs Table -->
          <div class="metrics">
            <h2>API Logs</h2>
            <table class="table">
              <thead>
                <tr>
                  <th>Prompt</th>
                  <th>Function Triggered</th>
                  <th>Function Results</th>
                  <th>AI Model Output</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Sample Prompt</td>
                  <td>Example Function</td>
                  <td>Success</td>
                  <td>AI Model Output Example</td>
                </tr>
                <tr>
                  <td>Sample Prompt</td>
                  <td>Example Function</td>
                  <td>Error</td>
                  <td>AI Model Output Error</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- AI Metrics -->
          <div class="metrics">
            <h2>AI Model Details</h2>
            <div class="subsection">
              <div>
                <h3>AI Model Stats</h3>
                <p>Total Models: 3</p>
                <p>Active Models: 2</p>
                <p>Inactive Models: 1</p>
              </div>
              <div>
                <h3>Response Time (Avg)</h3>
                <p>Models: 0.5 seconds</p>
                <p>TTS LLMs: 0.4 seconds</p>
                <p>STT LLMs: 0.6 seconds</p>
              </div>
            </div>
          </div>
          
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error rendering dashboard:', error);
    await ErrorHandler.handle(error);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

// WebSocket implementation for real-time metrics updates
const wss = new WebSocketServer({ port: 4001 });

wss.on('connection', (ws) => {
  console.log('Client connected to WebSocket');
  
  ws.on('message', (message) => {
    console.log('Received:', message);
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

// Broadcast metrics updates every 5 seconds
setInterval(async () => {
  const metrics = await fetchMetrics();

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(metrics));
    }
  });
}, 30000);

export { dashboardRouter as default, fetchMetrics as startMonitoringDashboard };
