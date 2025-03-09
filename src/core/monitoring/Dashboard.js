import express from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { db } from '../../core/database.js';
import { walletService } from '../../services/wallet/index.js';
import { pumpFunService } from '../../services/pumpfun/index.js';
import { priceAlertService } from '../../services/priceAlerts.js';
import { aiMetricsService } from '../../services/aiMetricsService.js';
import { twitterService } from '../../services/twitter/index.js';
import { flipperMode } from '../../services/pumpfun/FlipperMode.js';
import { User } from '../../models/User.js';
import { ErrorHandler } from '../errors/index.js';
import os from 'os';
// For API keys
import { encrypt, decrypt } from '../../utils/encryption.js';

const dashboardRouter = express.Router();

// ----------------------------------------------------------
// 1) HELPER: fetchMetrics() for system & service status
// ----------------------------------------------------------
async function fetchMetrics() {
  try {
    const activeUsers = await User.countDocuments({ isActive: true });
    const results = await Promise.allSettled([
      pumpFunService.checkHealth(),
      aiMetricsService.fetchLiveMetrics(),
      flipperMode.fetchMetrics(),
      walletService.checkHealth(),
      db.checkHealth(),
      priceAlertService.getMetrics(),
      twitterService.checkTwitterHealth(),
      twitterService.checkKOLMonitoringHealth()
    ]);

    const [
      pumpFunMetrics,
      aiMetricsResult,
      flipperMetrics,
      walletHealth,
      databaseHealth,
      priceAlertMetrics,
      twitterHealth,
      kolMetrics
    ] = results;

    // If pumpFunMetrics is fulfilled, extract its value; otherwise, use an empty object.
    const pumpFunHealth = pumpFunMetrics.status === 'fulfilled' ? pumpFunMetrics.value : {};

    // Update the pumpFun field in your AI metrics with the PumpFun health data,
    // which now includes recentTokens (the last 300 tokens from the DB).
    aiMetricsService.updatePumpFunStatus(pumpFunHealth);

    // Then, when you fetch live metrics from aiMetricsService, the pumpFun field is updated.
    const aiMetrics = aiMetricsResult.status === 'fulfilled'
      ? restoreMaps(aiMetricsResult.value)
      : {};

    // Format memory usage for display.
    let memoryUsage = parseFloat(aiMetrics.context?.memoryUsage || 0);
    aiMetrics.context.memoryUsage = isNaN(memoryUsage)
      ? "0 MB"
      : (memoryUsage / 1024 / 1024).toFixed(2) + " MB";

    const systemMetrics = {
      uptime: process.uptime().toFixed(2),
      memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + " MB",
      cpuUsage: os.loadavg()[0].toFixed(2),
      osLoadAvg: os.loadavg()
    };

    return {
      system: systemMetrics,
      services: {
        database: formatResult(databaseHealth),
        wallets: aggregateWalletStatus(formatResult(walletHealth)),
        pumpFun: formatResult(pumpFunMetrics),
        priceAlerts: formatResult(priceAlertMetrics),
        twitter: formatResult(twitterHealth.value),
        kolMonitoring: formatResult(kolMetrics.value)
      },
      ai: aiMetrics,
      flipper: formatResult(flipperMetrics),
      users: {
        active: activeUsers,
        total: await User.countDocuments()
      }
    };
  } catch (error) {
    console.error('Error fetching metrics:', error);
    await ErrorHandler.handle(error);
    return { error: 'Failed to fetch metrics' };
  }
}

function restoreMaps(metrics) {
  return {
      ...metrics,
      intents: new Map(Object.entries(metrics.intents || {})),
      openai: { 
          ...metrics.openai, 
          modelUsage: new Map(Object.entries(metrics.openai?.modelUsage || {})) 
      },
      users: new Map(Object.entries(metrics.users || {})),
      hourlyStats: new Map(Object.entries(metrics.hourlyStats || {})),
      errors: new Map(Object.entries(metrics.errors || {})),
      tts: { ...metrics.tts, modelUsage: new Map(Object.entries(metrics.tts?.modelUsage || {})) },
      stt: { ...metrics.stt, modelUsage: new Map(Object.entries(metrics.stt?.modelUsage || {})) }
  };
}

function formatResult(res) {
  if (typeof res === 'boolean') {
    return { status: res ? 'healthy' : 'unhealthy' };
  }
  if (typeof res === 'object' && res !== null && 'status' in res) {
    if (res.status === 'fulfilled') {
      return res.value;
    } else {
      console.error('Error in result:', res.reason);
      return null;
    }
  }
  return res || null;
}

function aggregateWalletStatus(walletArray) {
  if (!Array.isArray(walletArray) || !walletArray.length) {
    return {
      overall: 'unhealthy',
      details: [],
      total: 0,
      healthyCount: 0,
      failCount: 0
    };
  }
  const total = walletArray.length;
  const healthyCount = walletArray.filter(n => n.status === 'healthy').length;
  const failCount = total - healthyCount;
  let overall = 'unhealthy';
  if (healthyCount === total) overall = 'healthy';
  else if (healthyCount > 0) overall = 'partial';

  return {
    overall,
    details: walletArray,
    total,
    healthyCount,
    failCount
  };
}

// ----------------------------------------------------------
// 2) MONGODB Collections for API Keys
// ----------------------------------------------------------
let apiKeyCollection;
let apiUsageCollection;

async function initializeCollections() {
  await db.connect();
  const database = db.getDatabase();
  apiKeyCollection = database.collection('apiKeys');
  apiUsageCollection = database.collection('apiUsage');

  await apiKeyCollection.createIndex({ key: 1 }, { unique: true });
  await apiKeyCollection.createIndex({ userId: 1 });
  await apiUsageCollection.createIndex({ apiKey: 1 });
  await apiUsageCollection.createIndex({ timestamp: 1 });
}
initializeCollections().catch(console.error);

async function validateApiKey(key) {
  const record = await apiKeyCollection.findOne({ key: decrypt(key) });
  if (!record || !record.active) return false;
  if (record.usageCount >= record.quotaLimit) return false;
  return true;
}

async function trackApiUsage(key, endpoint) {
  await apiUsageCollection.insertOne({
    apiKey: encrypt(key),
    endpoint,
    timestamp: new Date()
  });
  await apiKeyCollection.updateOne(
    { key: encrypt(key) },
    { $inc: { usageCount: 1 } }
  );
}

// ----------------------------------------------------------
// 3) THE MAIN DASHBOARD ROUTE
// ----------------------------------------------------------
// Render the full dashboard HTML page
function renderDashboard(metrics) {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <title>D.A.I.L Dashboard</title>
        <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        ${getDashboardStyles()}
      </head>
      <body>
        ${renderHeader()}
        <!-- Lab + Matrix behind everything -->
        <div class="lab-container"></div>
        <div class="matrix-container"></div>
        <div class="dashboard-container" id="dashboardContainer">
          ${renderSystemMetrics(metrics.system)}
          ${renderNetworkStatus(metrics.services.wallets?.details || [])}
          ${renderServiceStatus(metrics.services)}
          ${renderAIMetrics(metrics.ai)}
          ${renderPriceAlerts(metrics.services.priceAlerts)}
          ${renderPumpFunMetrics(metrics.services.pumpFun)}
          ${renderFunctionMetrics(metrics.ai?.functions || [])}
          ${renderApiSection()}
        </div>
        ${getDashboardScripts()}
      </body>
    </html>
  `;
}

dashboardRouter.get('/', async (req, res) => {
  try {
    const metrics = await fetchMetrics();    
  
  console.log("*******  ***  00000000000000A *********:", JSON.stringify(metrics, null, 2));
    if (metrics.error) throw new Error(metrics.error);
    res.send(renderDashboard(metrics));
  } catch (error) {
    console.error('Error rendering dashboard:', error);
    res.status(500).send(`
      <html>
        <body style="background:#111;color:#f33;">
          <h1>Dashboard Error</h1>
          <p>Failed to load dashboard: ${error.message}</p>
        </body>
      </html>
    `);
  }
});

// IMP: DASHBOARD FRAGMENT ENDPOINT FOR DYNAMIC UPDATES
dashboardRouter.get('/fragment', async (req, res) => {
  try {
    const metrics = await fetchMetrics();
    if (metrics.error) throw new Error(metrics.error);
    // Only return the inner HTML of the dashboard container
    res.send(`
      ${renderSystemMetrics(metrics.system)}
      ${renderNetworkStatus(metrics.services.wallets?.details || [])}
      ${renderServiceStatus(metrics.services)}
      ${renderAIMetrics(metrics.ai)}
      ${renderPriceAlerts(metrics.services.priceAlerts)}
      ${renderPumpFunMetrics(metrics.services.pumpFun)}
      ${renderFunctionMetrics(metrics.ai?.functions || [])}
      ${renderApiSection()}
    `);
  } catch (error) {
    console.error('Error rendering fragment:', error);
    res.status(500).send('<p>Error refreshing dashboard.</p>');
  }
});

// IMP: Download the last 300 Pumpfun launches from our cache
dashboardRouter.get('/downloadPumpFunTokens', async (req, res) => {
  try {
    // Fetch all tokens from the beginning until now, then limit to 300 most recent
    const tokensResult = await pumpFunService.getTokensByPeriod(new Date(0), new Date());
    if (!tokensResult.success) {
      throw new Error(tokensResult.error);
    }
    // Sort descending by timestamp and take the top 300
    const tokens = tokensResult.tokens
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 300)
      .reverse(); // reverse to chronological order
    res.setHeader('Content-Disposition', 'attachment; filename=pumpfun_tokens.json');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(tokens, null, 2));
  } catch (error) {
    res.status(500).send({ error: error.message });
  }
});

// ----------------------------------------------------------
// 4) RENDER FUNCTIONS (SYSTEM METRICS, ETC.) - UNCHANGED
// ----------------------------------------------------------
function renderHeader() {
  const baseUrl = global.ngrokUrl || 'http://localhost';
  return `
    <nav class="glass-nav">
      <div class="nav-brand">
        <img src="${baseUrl}/images/dail.png" alt="D.A.I.L" class="logo" />
        <h1>D.A.I.L</h1>
      </div>
      <div class="nav-links">
        <a href="${baseUrl}" class="nav-link">API Landing</a>
        <a href="https://t.me/the_ai_lab_announcements" class="nav-link">Telegram</a>
        <a href="https://x.com/dexters_ai_lab" class="nav-link">Twitter</a>
      </div>
    </nav>
    <div style="margin-top:7rem;"></div>
  `;
}

/**
 * Render System Health metrics with animated progress bars and neon icons.
 */
function renderSystemMetrics(system) {
  if (!system) return '';
  return `
    <section class="metrics-card system-metrics glass-effect">
      <div class="card-header">
        <h2><i class="fas fa-microchip pulse-icon"></i> System Health</h2>
        <div class="pulse-indicator ${system.cpuUsage > 80 ? 'warning' : 'healthy'}"></div>
      </div>
      <div class="metrics-grid">
        <!-- Memory Usage -->
        <div class="metric-item">
          <div class="metric-icon"><i class="fas fa-memory"></i></div>
          <div class="metric-info">
            <h3>Memory Usage</h3>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress" style="width: ${Math.min((system.memoryUsage / 1024) * 100, 100)}%">
                  <div class="progress-glow"></div>
                </div>
              </div>
              <span class="progress-text">${system.memoryUsage} MB</span>
            </div>
          </div>
        </div>
        <!-- CPU Load -->
        <div class="metric-item">
          <div class="metric-icon"><i class="fas fa-tachometer-alt"></i></div>
          <div class="metric-info">
            <h3>CPU Load</h3>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress" style="width: ${system.cpuUsage}%">
                  <div class="progress-glow"></div>
                </div>
              </div>
              <span class="progress-text">${system.cpuUsage}%</span>
            </div>
          </div>
        </div>
        <!-- Uptime -->
        <div class="metric-item">
          <div class="metric-icon"><i class="fas fa-clock"></i></div>
          <div class="metric-info">
            <h3>Uptime</h3>
            <div class="uptime-display">
              <i class="fas fa-server"></i> ${formatUptime(system.uptime)}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

/**
 * Render network status for each chain or network.
 */
function renderNetworkStatus(networks) {
  if (Array.isArray(networks)) {
    return `
      <section class="metrics-card system-metrics glass-effect">
        <div class="card-header">
          <h2><i class="fas fa-globe pulse-icon"></i> Network Status</h2>
          <div class="pulse-indicator ${networks.length > 0 ? 'healthy' : 'warning'}"></div>
        </div>
        <div class="metrics-grid network-grid" id="networkGrid">
          ${networks.map((net, index) => `
            <div class="metric-item network-card" data-network="${net.network || 'unknown'}">
              <div class="metric-icon">
                <i class="fas fa-globe-americas"></i>
              </div>
              <div class="metric-info">
                <h3>${net.network || 'Unknown Network'}</h3>
                <div class="status-display ${net.status || 'unknown'}">
                  ${net.status === 'healthy' ? '✅ Healthy' : '❌ Error'}
                </div>
                ${net.error ? `<p class="error-message">${net.error}</p>` : ''}
              </div>
              <div class="network-ping-indicator"></div>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  } else {
    return `
      <section class="metrics-card system-metrics glass-effect">
        <div class="card-header">
          <h2><i class="fas fa-network-wired pulse-icon"></i> Network Status</h2>
          <div class="pulse-indicator warning"></div>
        </div>
        <div class="metrics-grid">
          <p>No network data available</p>
        </div>
      </section>
    `;
  }
}

/**
 * Render the status of various services.
 */
function renderServiceStatus(services) {
  if (!services) return '';

  return `
    <section class="metrics-card system-metrics glass-effect">
      <div class="card-header">
        <h2><i class="fas fa-cogs pulse-icon"></i> Service Status</h2>
        <div class="pulse-indicator ${getOverallPulse(services)}"></div>
      </div>
      <div class="metrics-grid">
        ${Object.entries(services).map(([svc, status]) => {
          // Special handling for aggregated wallets
          if (svc === 'wallets' && status && typeof status === 'object' && status.overall) {
            return renderAggregatedWallets(svc, status);
          } else {
            // Otherwise, treat as a normal string-based service
            return renderGenericService(svc, status);
          }
        }).join('')}
      </div>
    </section>
  `;
}

/**
 * Render the wallets
 */
function renderAggregatedWallets(svc, walletObj) {
  // walletObj has { overall, details, total, healthyCount, failCount }
  const icon = getServiceIcon(svc);
  let overallText = '⚠️ Issues Detected';
  if (walletObj.overall === 'healthy') overallText = '✅ Operational';
  else if (walletObj.overall === 'partial') overallText = '⚠️ Some Failures';

  // Build a small tooltip or text about failing networks
  let failText = '';
  if (walletObj.failCount > 0) {
    const failingNetworks = walletObj.details
      .filter(n => n.status !== 'healthy')
      .map(n => n.network + (n.error ? ` (${n.error})` : ''));
    
    failText = `
      <div class="fail-tooltip" title="Failed: ${failingNetworks.join(', ')}">
        ${walletObj.failCount} failing
      </div>
    `;
  }

  return `
    <div class="metric-item">
      <div class="metric-icon">
        <i class="fas fa-${icon}"></i>
      </div>
      <div class="metric-info">
        <h3>${capitalize(svc)}</h3>
        <div class="status-display ${walletObj.overall}">
          ${overallText} <br/>
          <small>(${walletObj.healthyCount}/${walletObj.total} healthy)</small>
          ${failText}
        </div>
      </div>
    </div>
  `;
}

function renderGenericService(svc, status) {
  const icon = getServiceIcon(svc);
  let state = 'unhealthy';

  if (typeof status === 'object' && status !== null) {
    // If the object explicitly has a 'healthy' property, use it.
    if ('healthy' in status) {
      state = status.healthy ? 'healthy' : 'unhealthy';
    }
    // Otherwise, if it has a 'status' property (like "status": "healthy"),
    // treat 'healthy' or 'unhealthy' strings.
    else if ('status' in status) {
      state = status.status === 'healthy' ? 'healthy' : 'unhealthy';
    }
  } 
  else if (typeof status === 'string') {
    // If it’s just a string like "healthy" or "unhealthy"
    state = status;
  }

  return `
    <div class="metric-item">
      <div class="metric-icon">
        <i class="fas fa-${icon}"></i>
      </div>
      <div class="metric-info">
        <h3>${capitalize(svc)}</h3>
        <div class="status-display ${state}">
          ${state === 'healthy' ? '✅ Operational' : '⚠️ Issues Detected'}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render AI metrics such as OpenAI usage and context stats.
 */
function renderAIMetrics(ai) {
  if (!ai || !ai.openai) return '';

  // Use safe defaults for TTS and STT metrics
  const tts = ai.tts || { totalCalls: 0, totalDuration: 0, modelUsage: [] };
  const stt = ai.stt || { totalCalls: 0, totalDuration: 0, modelUsage: [] };
  const modelUsage = ai.openai.modelUsage;
  
  console.log("*******  ***  AI - DATA *********:", JSON.stringify(ai, null, 2));

  return `
    <section class="metrics-card system-metrics glass-effect">
      <div class="card-header">
        <h2><i class="fas fa-robot pulse-icon"></i> AI Performance</h2>
        <div class="pulse-indicator ${ai.openai.rateLimitHits > 10 ? 'warning' : 'healthy'}"></div>
      </div>
      
      <!-- Basic Metrics Grid -->
      <div class="metrics-grid">
        <!-- Token Usage -->
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-microchip"></i>
          </div>
          <div class="metric-info">
            <h3>Token Usage</h3>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress" style="width: ${Math.min((ai.openai.totalTokens / 1000000) * 100, 100)}%">
                  <div class="progress-glow"></div>
                </div>
              </div>
              <span class="progress-text">${ai.openai.totalTokens?.toLocaleString() || 0} tokens</span>
            </div>
          </div>
        </div>

        <!-- Cost Tracking -->
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-dollar-sign"></i>
          </div>
          <div class="metric-info">
            <h3>Cost</h3>
            <div class="value-display">
              $${(ai.openai.totalCost || 0).toFixed(2)}
            </div>
          </div>
        </div>

        <!-- Rate Limits -->
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-tachometer-alt"></i>
          </div>
          <div class="metric-info">
            <h3>Rate Limits</h3>
            <div class="value-display">
              ${ai.openai.rateLimitHits || 0} hits
            </div>
          </div>
        </div>

        <!-- Cache Performance -->
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-memory"></i>
          </div>
          <div class="metric-info">
            <h3>Cache Performance</h3>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress" style="width: ${Math.min((ai.context?.cacheHits / ((ai.context?.cacheHits + ai.context?.cacheMisses) || 1)) * 100, 100)}%">
                  <div class="progress-glow"></div>
                </div>
              </div>
              <span class="progress-text">Hits: ${ai.context?.cacheHits || 0} / Misses: ${ai.context?.cacheMisses || 0}</span>
            </div>
          </div>
        </div>

        <!-- Memory Usage -->
        <div class="metric-item">
          <div class="metric-icon"><i class="fas fa-database"></i></div>
          <div class="metric-info">
            <h3>Memory Usage</h3>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress" style="width: ${Math.min((parseFloat(ai.context.memoryUsage) / 1024) * 100, 100)}%">
                  <div class="progress-glow"></div>
                </div>
              </div>
              <span class="progress-text">${ai.context.memoryUsage || "0 MB"}</span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Extra Info Cards Grid -->
      <div class="metrics-grid" style="margin-top: 2rem;">
        <!-- Message Stats Card -->
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-comments"></i>
          </div>
          <div class="metric-info small-ai-stat">
            <h3>Message Stats</h3>
            <p>Total: ${ai.messages.total || 0}</p>
            <p>Text: ${ai.messages.text || 0} | Audio: ${ai.messages.audio || 0}</p>
          </div>
        </div>

        <!-- TTS Performance Card -->
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-volume-up"></i>
          </div>
          <div class="metric-info small-ai-stat">
            <h3>TTS Performance</h3>
            <p>Total Calls: ${tts.totalCalls}</p>
            <p>Total Duration: ${tts.totalDuration ? (tts.totalDuration / 1000).toFixed(2) : 0} sec</p>
            ${
              (tts.modelUsage && tts.modelUsage.length > 0)
                ? `<ul>
                    ${tts.modelUsage.map(([model, usage]) => {
                      const avg = usage.calls > 0 ? (usage.totalDuration / usage.calls).toFixed(2) : 'N/A';
                      return `<li>
                        <i class="fas fa-${model.toLowerCase()}"></i>
                        <strong>${model}</strong>
                        <span class="badge">${usage.calls} calls</span>
                        | ${usage.totalDuration} ms total
                        | Avg: ${avg} ms
                        | Cost: $${usage.totalCost ? usage.totalCost.toFixed(2) : '0.00'}
                      </li>`;
                    }).join('')}
                   </ul>`
                : '<p>No TTS metrics available</p>'
            }
          </div>
        </div>

        <!-- STT Performance Card -->
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-microphone"></i>
          </div>
          <div class="metric-info small-ai-stat">
            <h3>STT Performance</h3>
            <p>Total Calls: ${stt.totalCalls}</p>
            <p>Total Duration: ${stt.totalDuration ? (stt.totalDuration / 1000).toFixed(2) : 0} sec</p>
            ${
              (stt.modelUsage && stt.modelUsage.length > 0)
                ? `<ul>
                    ${stt.modelUsage.map(([model, usage]) => {
                      const avg = usage.calls > 0 ? (usage.totalDuration / usage.calls).toFixed(2) : 'N/A';
                      return `<li>
                        <i class="fas fa-${model.toLowerCase()}"></i>
                        <strong>${model}</strong>
                        <span class="badge">${usage.calls} calls</span>
                        | ${usage.totalDuration} ms total
                        | Avg: ${avg} ms
                      </li>`;
                    }).join('')}
                   </ul>`
                : '<p>No STT metrics available</p>'
            }
          </div>
        </div>
      </div>
      
      <!-- Full-width Card: General LLM Metrics Table -->
      <div class="metric-item full-width" style="margin-top:2rem;">
        <h3><i class="fas fa-brain spin" style="margin-right:0.5rem;"></i> General LLM Metrics</h3>
        <table>
          <thead>
            <tr>
              <th>Model</th>
              <th>Total Tokens</th>
              <th>Total Cost</th>
              <th>Rate Limit Hits</th>
              <th>Avg Response Time (ms)</th>
            </tr>
          </thead>
          <tbody>
            ${Array.from(modelUsage.entries()).map(([model, stats]) => {
              const avgResponseTime = stats.avgResponseTime ? stats.avgResponseTime.toFixed(2) : 'N/A';
              return `
                <tr>
                  <td>
                  <i class="fas fa-brain" style="margin-right:0.5rem;">
                  ${model}</td>
                  <td>${stats.tokens ? stats.tokens.toLocaleString() : 0}</td>
                  <td>$${stats.cost ? stats.cost.toFixed(2) : '0.00'}</td>
                  <td>${stats.uses || 0}</td>
                  <td>${avgResponseTime}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

/**
 * Render Price Alerts metrics.
 */
function renderPriceAlerts(alerts) {
  if (!alerts) {
    return `
      <section class="metrics-card system-metrics glass-effect">
        <div class="card-header">
          <h2><i class="fas fa-bell pulse-icon"></i> Price Alerts</h2>
          <div class="pulse-indicator warning"></div>
        </div>
        <div class="metrics-grid">
          <p>No price alerts data available</p>
        </div>
      </section>
    `;
  }
  
  return `
    <section class="metrics-card system-metrics glass-effect">
      <div class="card-header">
        <h2><i class="fas fa-bell pulse-icon"></i> Price Alerts</h2>
        <div class="pulse-indicator ${alerts.activeAlerts > 0 ? 'healthy' : 'warning'}"></div>
      </div>
      <div class="metrics-grid">
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-list-check"></i>
          </div>
          <div class="metric-info">
            <h3>Total Alerts</h3>
            <div class="value-display">
              ${alerts.totalAlerts || 0}
            </div>
          </div>
        </div>

        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-play-circle"></i>
          </div>
          <div class="metric-info">
            <h3>Active</h3>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress" style="width: ${(alerts.activeAlerts / alerts.totalAlerts * 100) || 0}%">
                  <div class="progress-glow"></div>
                </div>
              </div>
              <span class="progress-text">${alerts.activeAlerts || 0}</span>
            </div>
          </div>
        </div>

        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-check-circle"></i>
          </div>
          <div class="metric-info">
            <h3>Executed</h3>
            <div class="value-display">
              ${alerts.executedAlerts || 0}
            </div>
          </div>
        </div>

        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-exclamation-triangle"></i>
          </div>
          <div class="metric-info">
            <h3>Failed</h3>
            <div class="value-display error">
              ${alerts.failedAlerts || 0}
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderPumpFunMetrics(pumpFunData) {
  if (!pumpFunData) {
    return `
      <section class="metrics-card system-metrics glass-effect">
        <div class="card-header">
          <h2><i class="fas fa-rocket pulse-icon"></i> PumpFun</h2>
          <div class="pulse-indicator warning"></div>
        </div>
        <div class="metrics-grid">
          <p>No PumpFun data available</p>
        </div>
      </section>
    `;
  }
  
  return `
    <section class="metrics-card system-metrics glass-effect">
      <div class="card-header">
        <h2><i class="fas fa-rocket pulse-icon"></i> PumpFun</h2>
        <div class="pulse-indicator ${pumpFunData.status === 'healthy' ? 'healthy' : 'warning'}"></div>
      </div>
      <div class="metrics-grid">
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-info-circle"></i>
          </div>
          <div class="metric-info">
            <h3>Status</h3>
            <div class="value-display">
              ${pumpFunData.status}
            </div>
          </div>
        </div>
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-layer-group"></i>
          </div>
          <div class="metric-info">
            <h3>Tokens Launched</h3>
            <div class="value-display">
              ${pumpFunData.tokensLaunched}
            </div>
          </div>
        </div>
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-sync-alt"></i>
          </div>
          <div class="metric-info">
            <h3>Reconnect Attempts</h3>
            <div class="value-display">
              ${pumpFunData.reconnectAttempts}
            </div>
          </div>
        </div>
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-database"></i>
          </div>
          <div class="metric-info">
            <h3>Cached Tokens</h3>
            <div class="value-display">
              ${pumpFunData.cachedTokens || 0}
            </div>
          </div>
        </div>
      </div>
      <div class="download-section" style="text-align: center; margin-top: 1rem;">
        <a href="/downloadPumpFunTokens" class="download-link" style="color: var(--primary); text-decoration: underline;">
          Download Last 300 Tokens (JSON)
        </a>
      </div>
    </section>
  `;
}

/**
 * Render function performance metrics as a table.
 */
function renderFunctionMetrics(functions) {
  if (!functions || !Array.isArray(functions) || functions.length === 0) {
    return `
      <section class="metrics-card system-metrics glass-effect">
        <div class="card-header">
          <h2><i class="fas fa-code pulse-icon"></i> Function Performance</h2>
          <div class="pulse-indicator warning"></div>
        </div>
        <div class="metrics-grid">
          <p>No function metrics available</p>
        </div>
      </section>
    `;
  }
  
  // Calculate overall success rate (if needed for styling)
  const overallSuccessRate = functions.reduce((acc, [_, stats]) => {
    return acc + (stats.calls ? (stats.successes / stats.calls * 100) : 0);
  }, 0) / functions.length;

  return `
    <section class="metrics-card system-metrics glass-effect">
      <div class="card-header"> 
        <h2><i class="fas fa-code pulse-icon"></i> Function Performance</h2>
        <div class="pulse-indicator ${overallSuccessRate > 90 ? 'healthy' : 'warning'}"></div>
      </div>
      <div class="metrics-grid fmm-parent">
        ${functions.map(([fname, stats]) => {
          const successRate = stats.calls ? ((stats.successes / stats.calls) * 100).toFixed(1) : '0.0';
          const avg = stats.avgDuration ? stats.avgDuration.toFixed(2) : 'N/A';
          const lastUsed = stats.lastUsed ? new Date(stats.lastUsed).toLocaleString() : 'N/A';
          return `
            <div class="metric-item func-metric-max">
              <div class="metric-icon">
                <i class="fas fa-brain"></i>
              </div>
              <div class="metric-info">
                <h3>${fname}</h3>
                <div class="progress-container">
                  <div class="progress-bar">
                    <div class="progress" style="width: ${successRate}%">
                      <div class="progress-glow"></div>
                    </div>
                  </div>
                  <span class="progress-text data-field">${stats.calls} calls | ${successRate}% success</span>
                </div>
                <div class="function-stats">
                  <span class="duration data-field">Avg: ${avg} ms</span>
                  <span class="last-used data-field">Last: ${lastUsed}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

// ----------------------------------------------------------
// 5) NEW API SECTION MARKUP
// ----------------------------------------------------------
function renderApiSection() {
  return `
    <section class="api-section">
      <div class="section-header">
        <h2><i class="fas fa-code"></i> API Access</h2>
        <p class="intro-text">
          Access D.A.I.L's cutting-edge AI-driven data streams through our modern, RESTful API.
        </p>
      </div>

      <!-- API Key Management -->
      <div class="api-key-management">
        <h3>API Key Management</h3>
        <p>Select a tier to generate your API key:</p>
        <div class="tier-cards">
          <div class="tier-card">
            <h4>Basic</h4>
            <p class="price">$49/month</p>
            <ul>
              <li>1,000 calls/month</li>
              <li>Standard rate limits</li>
              <li>Basic support</li>
            </ul>
            <button class="tier-button" data-tier="basic">Get Basic API Key</button>
          </div>
          <div class="tier-card featured">
            <h4>Pro</h4>
            <p class="price">$199/month</p>
            <ul>
              <li>10,000 calls/month</li>
              <li>Higher rate limits</li>
              <li>Priority support</li>
              <li>Advanced analytics</li>
            </ul>
            <button class="tier-button" data-tier="pro"">Get Pro API Key</button>
          </div>
          <div class="tier-card">
            <h4>Enterprise</h4>
            <p class="price">Custom</p>
            <ul>
              <li>Unlimited calls</li>
              <li>Custom rate limits</li>
              <li>24/7 support</li>
              <li>Dedicated infrastructure</li>
            </ul>
            <button class="tier-button" data-tier="enterprise">Contact Sales</button>
          </div>
        </div>
        <div id="apiKeyDisplay" class="api-key-display hidden">
          <h4>Your API Key</h4>
          <div class="key-container">
            <input type="text" id="apiKeyInput" readonly>
            <button class="copy-button" id="copyKeyButton">
              <i class="fas fa-copy"></i>
            </button>
          </div>
          <p class="warning">Save this key securely. It won’t be shown again!</p>
        </div>
      </div>

      <!-- SentimentScrub API Card -->
      <div class="api-card">
        <div class="api-card-header">
          <h3>SentimentScrub™</h3>
          <div class="api-status" id="sentimentApiStatus">
            <span class="status-dot"></span>
            <span class="status-text">Checking status...</span>
          </div>
        </div>
        <div class="api-card-content">
          <div class="api-card-left">
            <div class="api-card-description">
              <p>
                Our advanced sentiment analysis engine processes real-time market sentiment, social metrics, and engagement data for any token or project.
              </p>
              <div class="api-tags">
                <span class="api-tag"><i class="fas fa-chart-line"></i> Sentiment Analysis</span>
                <span class="api-tag"><i class="fas fa-comments"></i> Social Metrics</span>
                <span class="api-tag"><i class="fas fa-bolt"></i> Real-time Data</span>
              </div>
              <div class="api-documentation">
                <h3>Endpoint</h3>
                <code class="endpoint">POST /api/v1/sentiment</code>
                <h3>Parameters</h3>
                <div class="param-table">
                  <table>
                    <tr>
                      <th>Parameter</th>
                      <th>Type</th>
                      <th>Description</th>
                    </tr>
                    <tr>
                      <td>query</td>
                      <td>string</td>
                      <td>Token symbol or address</td>
                    </tr>
                    <tr>
                      <td>network</td>
                      <td>string</td>
                      <td>Network name (required for addresses)</td>
                    </tr>
                  </table>
                </div>
                <small class="doc-note">Expected Response: A JSON with sentiment score, confidence, metrics, and a timestamp.</small>
              </div>
            </div>
          </div>
          <div class="api-card-right">
            <div class="api-test-form">
              <h4>Test Endpoint</h4>
              <form id="sentimentTestForm">
                <div class="form-group">
                  <label>Query</label>
                  <input type="text" id="sentimentQuery" placeholder="e.g. BRUSH" required>
                </div>
                <div class="form-group">
                  <label>Network</label>
                  <select id="sentimentNetwork">
                    <option value="sonic">Sonic</option>
                    <option value="solana">Solana</option>
                    <option value="base">Base</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>API Key</label>
                  <input type="text" id="sentimentApiKey" placeholder="Enter your API key" required>
                </div>
                <button type="submit" class="test-button">
                  <span class="button-text">Test Endpoint</span>
                </button>
              </form>
              <div id="sentimentResult" class="api-result hidden">
                <div class="result-header">
                  <h4>Response</h4>
                  <button class="copy-button" data-target="sentimentResult">
                    <i class="fas fa-copy"></i>
                  </button>
                </div>
                <pre class="result-content"></pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- TokenScrub API Card -->
      <div class="api-card">
        <div class="api-card-header">
          <h3>TokenScrub™</h3>
          <div class="api-status" id="tokenApiStatus">
            <span class="status-dot"></span>
            <span class="status-text">Checking status...</span>
          </div>
        </div>
        <div class="api-card-content">
          <div class="api-card-left">
            <div class="api-card-description">
              <p>
                Our comprehensive token analytics endpoint merges on-chain data, market metrics, security insights, and social signals into one enriched response.
              </p>
              <div class="api-tags">
                <span class="api-tag"><i class="fas fa-coins"></i> Token Analytics</span>
                <span class="api-tag"><i class="fas fa-chart-bar"></i> Market Data</span>
                <span class="api-tag"><i class="fas fa-shield-alt"></i> Security Analysis</span>
              </div>
              <div class="api-documentation">
                <h3>Endpoint</h3>
                <code class="endpoint">POST /api/v1/token</code>
                <h3>Parameters</h3>
                <div class="param-table">
                  <table>
                    <tr>
                      <th>Parameter</th>
                      <th>Type</th>
                      <th>Description</th>
                    </tr>
                    <tr>
                      <td>token</td>
                      <td>string</td>
                      <td>Token address</td>
                    </tr>
                    <tr>
                      <td>network</td>
                      <td>string</td>
                      <td>Network name</td>
                    </tr>
                  </table>
                </div>
                <small class="doc-note">Expected Response: A JSON with token details, price, market data, security score, and social metrics.</small>
              </div>
            </div>
          </div>
          <div class="api-card-right">
            <div class="api-test-form">
              <h4>Test Endpoint</h4>
              <form id="tokenTestForm">
                <div class="form-group">
                  <label>Token</label>
                  <input type="text" id="tokenAddress" placeholder="e.g. 0xc5ab8d98f9594..." required>
                </div>
                <div class="form-group">
                  <label>Network</label>
                  <select id="tokenNetwork">
                    <option value="sonic">Sonic</option>
                    <option value="solana">Solana</option>
                    <option value="base">Base</option>
                  </select>
                </div>
                <div class="form-group">
                  <label>API Key</label>
                  <input type="text" id="tokenApiKey" placeholder="Enter your API key" required>
                </div>
                <button type="submit" class="test-button">
                  <span class="button-text">Test Endpoint</span>
                </button>
              </form>
              <div id="tokenResult" class="api-result hidden">
                <div class="result-header">
                  <h4>Response</h4>
                  <button class="copy-button" data-target="tokenResult">
                    <i class="fas fa-copy"></i>
                  </button>
                </div>
                <pre class="result-content"></pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

// ----------------------------------------------------------
// 6) getDashboardStyles(): keep your existing styles
// ----------------------------------------------------------
function getDashboardStyles() {
  return `
    <style>
      /* Base Reset & Variables */
      * { margin: 0; padding: 0; box-sizing: border-box; }
      :root {
        --primary: #4caf50;
        --secondary: #2196f3;
        --accent: #ff4081;
        --neon: #0ff;
        --bg: rgb(2, 45, 81);
        --glass: rgba(255, 255, 255, 0.05);
        --text: #fff;
        --text-secondary: rgba(255, 255, 255, 0.7);
        --border-radius: 12px;
        --transition: all 0.3s ease;
      }
      body {
        font-family: 'Space Grotesk', sans-serif;
        background: var(--bg);
        color: var(--text);
        line-height: 1.6;
        overflow-x: hidden;
      }
      /************************************************************
       * Crazy-cool Glass Nav with Neon Glow & 3D Hover Effects
       ************************************************************/
      .glass-nav {
        position: fixed;
        top: 0; left: 0;
        width: 100%;
        padding: 1rem 2rem;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(15px) saturate(150%);
        box-shadow: 0 0 25px rgba(0, 255, 255, 0.3), 
                    0 0 60px rgba(0, 255, 255, 0.2) inset;
        border- bottom: 1px solid rgba(255, 255, 255, 0.2);
        z-index: 1000;
        display: flex;
        align-items: center;
        justify-content: space-between;
        overflow: visible;
        animation: navFadeIn 1s ease;
        position: relative; /* for nav-glow-border */
      }
      @keyframes navFadeIn {
        0% { opacity: 0; transform: translateY(-10px); }
        100% { opacity: 1; transform: translateY(0); }
      }

      /* Additional neon border effect behind the nav */
      .nav-glow-border {
        position: absolute;
        top: -2px; left: -2px; right: -2px; bottom: -2px;
        background: conic-gradient(
          from 180deg,
          var(--accent) 0%,
          var(--primary) 50%,
          var(--secondary) 100%
        );
        background-size: 200% 200%;
        animation: spinGradient 8s linear infinite;
        border-radius: var(--border-radius);
        opacity: 0.25;
        pointer-events: none;
        z-index: -1; /* behind nav content */
      }
      @keyframes spinGradient {
        0% { transform: rotate(0); }
        100% { transform: rotate(360deg); }
      }

      .nav-brand {
        display: flex;
        align-items: center;
        gap: 1rem;
        transition: var(--transition);
        transform-style: preserve-3d;
        perspective: 500px;
      }
      .nav-brand:hover {
        transform: translateZ(10px) rotateX(5deg) rotateY(-5deg) scale(1.03);
      }
      /* Enforceed */
      .nav-brand img.logo {
        height: 40px;       /* fixed height so it's not huge */
        width: auto;        /* keep aspect ratio */
        object-fit: contain;
        filter: drop-shadow(0 0 6px rgba(0, 255, 255, 0.8));
        transition: transform 0.3s ease;
      }
      .nav-brand:hover img.logo {
        transform: rotateY(10deg);
      }
      /* Make it smaller on narrower screens */
      @media (max-width: 600px) {
        .nav-brand img.logo {
          height: 30px;
        }
      }
      .nav-brand h1 {
        font-size: 1.6rem;
        background: linear-gradient(45deg, var(--primary), var(--secondary));
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        text-shadow: 0 0 5px rgba(255,255,255,0.2);
      }

      .nav-links {
        display: flex;
        gap: 2rem;
      }
      .nav-link {
        color: #fff;
        text-decoration: none;
        padding: 0.5rem 1rem;
        border-radius: 8px;
        transition: transform 0.3s ease, background 0.3s ease;
        text-shadow: 0 0 2px rgba(0, 255, 255, 0.8);
        position: relative;
      }
      .nav-link::after {
        content: '';
        position: absolute;
        bottom: 0; left: 50%;
        width: 0; height: 2px;
        background: var(--accent);
        transition: width 0.3s ease, left 0.3s ease;
      }
      .nav-link:hover::after {
        width: 100%;
        left: 0;
      }
      .nav-link:hover {
        transform: scale(1.05) translateY(-2px);
        background: rgba(0, 255, 255, 0.1);
      }

      /* Dashboard Container with Glass & Neon Effects */
      .dashboard-container {
        max-width: 1400px;
        margin: 8rem auto 2rem;
        padding: 2rem;
        background: var(--glass);
        /* backdrop-filter: blur(10px); */
        background: inherit;
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 20px;
        position: relative;
        z-index: 2;
        overflow: hidden;
        box-shadow: 0 0 10px var(--neon);
      }
      .dashboard-container::before {
        content: "";
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: linear-gradient(45deg, transparent 40%, rgba(33,150,243,0.15) 60%);
        mix-blend-mode: overlay;
        pointer-events: none;
      }
      /* Feature Category Styles */
      .feature-category {
        margin-bottom: 4rem;
        position: relative;
        z-index: 1;
        padding: 1.5rem;
        border-radius: var(--border-radius);
        background: rgba(0, 0, 0, 0.2);
        overflow: hidden;
      }
      .feature-category.system { border-left: 4px solid var(--primary); }
      .feature-category.network { border-left: 4px solid var(--secondary); }
      .feature-category.service { border-left: 4px solid var(--accent); }
      .feature-category.ai { border-left: 4px solid var(--primary); }
      .feature-category.price-alerts { border-left: 4px solid var(--secondary); }
      .feature-category.functions { border-left: 4px solid var(--accent); }
      .feature-category h3 {
        font-size: 2.2rem;
        margin-bottom: 1rem;
        text-align: center;
        color: var(--text);
        text-shadow: 0 0 10px var(--neon);
        position: relative;
        z-index: 2;
      }
      .feature-category::after {
        content: "";
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" fill="none" stroke="%2300ffff" stroke-width="0.5"><circle cx="50" cy="50" r="2"/></svg>') repeat;
        opacity: 0.05;
        animation: drift 20s linear infinite;
      }
      @keyframes drift {
        from { transform: translate(0, 0); }
        to { transform: translate(-50px, -50px); }
      }
      .feature-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 2rem;
        justify-content: center;
        width: 100%;
        position: relative;
        z-index: 2;
      }
      /* Feature Card Styles */
      .feature-card {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 15px;
        padding: 2rem;
        border: 1px solid rgba(255, 255, 255, 0.1);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        position: relative;
        overflow: hidden;
        transform-style: preserve-3d;
        perspective: 1000px;
      }
      .feature-card:hover {
        transform: translateY(-10px) rotateX(2deg) rotateY(2deg);
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
        border-color: var(--neon);
      }
      .feature-card h4 {
        font-size: 1.4rem;
        margin-bottom: 1rem;
        color: var(--text);
      }
      .feature-card p {
        font-size: 0.95rem;
        color: var(--text-secondary);
        line-height: 1.4;
      }
      .glow-effect::before {
        content: "";
        position: absolute;
        top: 0;
        left: -100%;
        width: 200%;
        height: 100%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
        transition: 0.5s;
        pointer-events: none;
      }
      .glow-effect:hover::before {
        left: 100%;
      }
      /* Chain Card Icon Styles */
      .chain-card {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-size: 1.2rem;
        color: var(--neon);
      }
      .chain-card i {
        font-size: 1.8rem;
        animation: pulse 2s infinite;
      }
      @keyframes pulse {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.2); }
      }
      /* Test Tube Animation */
      .test-tube {
        position: absolute;
        right: 10%;
        top: 50%;
        transform: translateY(-50%) rotate(-180deg);
        width: 50px;
        height: 220px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 20px 20px 5px 5px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        overflow: hidden;
        backdrop-filter: blur(5px);
        box-shadow: 0 0 20px rgba(33, 150, 243, 0.4), inset 0 0 20px rgba(33, 150, 243, 0.3);
      }
      .test-tube .liquid {
        position: absolute;
        bottom: 0;
        width: 100%;
        height: 60%;
        background: linear-gradient(180deg, rgba(33, 150, 243, 0.8), rgba(33, 150, 243, 0.6));
        animation: liquidFlow 2s ease-in-out infinite;
      }
      @keyframes liquidFlow {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-5px); }
      }
      /* Cyberpunk Background Layers */
      .lab-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: -2;
      }
      .matrix-container {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: -3;
        overflow: hidden;
        pointer-events: none;
        background: transparent;
      }
      .matrix-column {
        position: absolute;
        top: -100%;
        font-family: monospace;
        font-size: 14px;
        color: #6fc2ff;
        white-space: pre;
        animation: matrixFall 10s linear infinite;
      }
      @keyframes matrixFall {
        0% { top: -100%; }
        100% { top: 100%; }
      }
      /* Cyberpunk Glowing Decor */
      .cyberpunk-decor {
        position: absolute;
        width: 200px;
        height: 200px;
        background: radial-gradient(circle, var(--primary) 0%, transparent 70%);
        filter: blur(40px);
        opacity: 0.2;
        animation: neonFloat 8s ease-in-out infinite;
      }
      @keyframes neonFloat {
        0% { transform: translate(0, 0); }
        50% { transform: translate(-20px, 20px); }
        100% { transform: translate(0, 0); }
      }
      /* Modern Glass Card Effect */
      .glass-effect {
        background: rgba(255, 255, 255, 0.05);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 15px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.05);
      }
      /* System Metrics Card Specifics */
      .system-metrics {
        padding: 2rem;
        margin-bottom: 2rem;
        background: rgba(23, 25, 35, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
      }
      .card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 2rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }
      .card-header h2 {
        display: flex;
        align-items: center;
        gap: 1rem;
        font-size: 1.5rem;
        color: var(--text);
      }
      .card-header h2 i {
        color: var(--primary);
      }
      .pulse-icon {
        color: var(--primary);
        animation: pulse 2s infinite;
      }
      .pulse-indicator {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        position: relative;
      }
      .pulse-indicator.healthy {
        background: var(--primary);
        box-shadow: 0 0 0 rgba(76, 175, 80, 0.4);
        animation: pulse-green 2s infinite;
      }
      .pulse-indicator.warning {
        background: #ff9800;
        box-shadow: 0 0 0 rgba(255, 152, 0, 0.4);
        animation: pulse-orange 2s infinite;
      }
      @keyframes pulse-green {
        0% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4); }
        70% { box-shadow: 0 0 0 10px rgba(76, 175, 80, 0); }
        100% { box-shadow: 0 0 0 0 rgba(76, 175, 80, 0); }
      }
      @keyframes pulse-orange {
        0% { box-shadow: 0 0 0 0 rgba(255, 152, 0, 0.4); }
        70% { box-shadow: 0 0 0 10px rgba(255, 152, 0, 0); }
        100% { box-shadow: 0 0 0 0 rgba(255, 152, 0, 0); }
      }
      .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 1.5rem;
      }
      .fmm-parent {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)) !important;
        gap: 1.5rem;
        width: 100% !important; /* Ensure the grid container takes full width */
      }

      /* Falling leaves effect on load
       */
      @keyframes fallingLeaves {
        0% {
          transform: translateY(-100px) rotate(-15deg);
          opacity: 0;
        }
        100% {
          transform: translateY(0) rotate(0deg);
          opacity: 1;
        }
      }

      /* Apply the falling leaves animation to each card */
      .metric-item {
        animation: fallingLeaves 0.8s ease-out forwards;
        opacity: 0; /* Start hidden so the animation is visible */
      }

      /* Stagger the animation delays for children of the parent container.
        For now, we'll define up to 8. 
      */
      .fmm-parent .metric-item:nth-child(1) { animation-delay: 0.1s; }
      .fmm-parent .metric-item:nth-child(2) { animation-delay: 0.2s; }
      .fmm-parent .metric-item:nth-child(3) { animation-delay: 0.3s; }
      .fmm-parent .metric-item:nth-child(4) { animation-delay: 0.4s; }
      .fmm-parent .metric-item:nth-child(5) { animation-delay: 0.5s; }
      .fmm-parent .metric-item:nth-child(6) { animation-delay: 0.6s; }
      .fmm-parent .metric-item:nth-child(7) { animation-delay: 0.7s; }
      .fmm-parent .metric-item:nth-child(8) { animation-delay: 0.8s; }

      .metric-item {
        min-height: 100px;
        display: flex;
        align-items: flex-start;
        padding: 1.5rem;
        gap: 1.5rem;
        background: rgba(255, 255, 255, 0.03);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.05);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
      }
      .func-metric-max {
        min-width: 400px !important;
      }
      .metric-item:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
        border-color: var(--primary);
      }
      /* =============== General LLM Table Upgrades =============== */
      .metric-item.full-width table {
        width: 100%;
        border-collapse: collapse;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
        overflow: hidden;
      }

      .metric-item.full-width th,
      .metric-item.full-width td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .metric-item.full-width th {
        background: rgba(255, 255, 255, 0.1);
        font-weight: bold;
        color: var(--primary);
      }

      .metric-item.full-width tbody tr {
        transition: background 0.3s ease-in-out;
      }

      .metric-item.full-width tbody tr:hover {
        background: rgba(0, 255, 255, 0.1);
      }

      /* =============== TTS & STT Cards Styling =============== */
      .metric-item .metric-info ul {
        list-style: none;
        padding-left: 0;
      }

      .metric-item .metric-info ul li {
        display: flex;
        align-items: center;
        gap: 10px;
        background: rgba(0, 0, 0, 0.3);
        padding: 10px;
        border-radius: 8px;
        margin: 5px 0;
        transition: background 0.3s;
      }

      .metric-item .metric-info ul li:hover {
        background: rgba(0, 255, 255, 0.2);
      }

      .metric-item .metric-info ul li i {
        font-size: 1.2rem;
        color: var(--primary);
        transition: transform 0.3s;
      }

      .metric-item .metric-info ul li:hover i {
        transform: scale(1.2) rotate(10deg);
      }

      .metric-icon {
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        font-size: 1.5rem;
        color: var(--primary);
        transition: all 0.3s ease;
      }
      .metric-item:hover .metric-icon {
        background: var(--primary);
        color: var(--bg);
        transform: rotate(360deg);
      }
      .metric-info.tts-stt .data-field {
        font-size: 1rem;
        font-weight: 500;
        color: var(--text);
        padding: 0.2rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
      }
      .brain-icon {
        color: var(--accent);
      }
      .model-entry {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0.5rem 0;
      }

      .small-ai-stat {
        background: rgba(255, 255, 255, 0.05);
        padding: 4px 6px;
        font-size: 0.85rem;
        margin: 2px 0;
        border-radius: 4px;
      }

      /* AI Metrics Specific Styles */
      .metric-info {
        flex: 1;
        min-width: 0; /* Prevents flex items from overflowing */
      }

      .metric-info h3 {
        font-size: 0.9rem;
        color: var(--text-secondary);
        margin-bottom: 0.5rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .progress-container {
        position: relative;
        width: 100%;
        margin-top: 2.2rem;
      }

      .value-display {
        font-size: 1.2rem;
        font-weight: 500;
        color: var(--text);
        padding: 0.5rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 8px;
        text-align: center;
        margin-top: 0.5rem;
      }

      /* Ensure metric items have consistent height */
      .metric-item {
        min-height: 100px;
        display: flex;
        align-items: flex-start;
        padding: 1.5rem;
      }

      /* Ensure progress bars don't overflow */
      .progress-bar {
        width: 100%;
        height: 8px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        overflow: hidden;
        position: relative;
      }

      /* Add spacing between progress bar and text */
      .progress-text {
        position: absolute;
        left: 0;
        top: -25px;
        font-size: 0.9rem;
        color: var(--text-secondary);
        white-space: nowrap;
      }

      /* Ensure icons are centered and consistent size */
      .metric-icon {
        width: 48px;
        height: 48px;
        min-width: 48px; /* Prevents icon from shrinking */
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        font-size: 1.5rem;
        color: var(--primary);
        transition: all 0.3s ease;
        margin-right: 1rem;
      }

      .progress-bar {
        height: 8px;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 4px;
        overflow: hidden;
        position: relative;
      }
      .progress {
        height: 100%;
        background: linear-gradient(90deg, var(--primary), var(--secondary));
        border-radius: 4px;
        transition: width 0.3s ease;
        position: relative;
      }
      .progress-text {
        position: absolute;
        right: 0;
        top: -25px;
        font-size: 0.9rem;
        color: var(--text-secondary);
      }
      .progress-glow {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2));
        animation: progressGlow 2s ease-in-out infinite;
      }
      @keyframes progressGlow { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
      .uptime-display {
        font-size: 1.2rem;
        font-weight: 500;
        color: var(--text);
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .uptime-display i {
        color: var(--primary);
        animation: serverPulse 2s ease-in-out infinite;
      }
      @keyframes serverPulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.1); opacity: 0.8; } 100% { transform: scale(1); opacity: 1; } }
      
      .spin {
        animation: spin 2s linear infinite;
      }
      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      .badge {
        display: inline-block;
        background: var(--secondary);
        color: #fff;
        border-radius: 4px;
        padding: 0.2rem 0.5rem;
        font-size: 0.75rem;
        margin-left: 0.5rem;
      }
      .metric-info ul {
        list-style: none;
        padding-left: 0;
      }
      .metric-info ul li {
        margin: 0.5rem 0;
      }

      /* =============== PUMPFUN ================================================= */
      .download-section {
        margin-top: 1rem;
        text-align: center;
      }
      .download-link {
        font-size: 1rem;
        color: var(--primary);
        text-decoration: underline;
        transition: color 0.3s ease;
      }
      .download-link:hover {
        color: var(--secondary);
      }

      /* =============== AI Functions - Test Tube & Bacteria Icons =============== */
      .function-card {
        display: flex;
        align-items: center;
        gap: 1rem;
        padding: 15px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        transition: transform 0.3s ease, box-shadow 0.3s ease;
        position: relative;
      }

      .function-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 16px rgba(0, 255, 255, 0.3);
      }

      .function-card .function-icon {
        font-size: 1.8rem;
        color: var(--accent);
      }

      .function-card .function-icon.test-tube {
        animation: liquid-bubble 2s ease-in-out infinite;
      }

      @keyframes liquid-bubble {
        0%, 100% { transform: scale(1); }
        50% { transform: scale(1.1); }
      }

      /* =============== Scrub Cards - Default Values =============== */
      .scrub-card .default-network::after {
        content: "Solana";
        font-weight: bold;
        color: var(--secondary);
      }

      .scrub-card .default-symbol::after {
        content: "PEPE";
        font-weight: bold;
        color: var(--primary);
      }

      /* Particle and Matrix Effects */

      .particles-container {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        z-index: 10;
      }
      .particle {
        position: absolute;
        width: 4px;
        height: 4px;
        background: rgba(192, 247, 194, 0.91);
        border-radius: 50%;
        animation: float-up linear infinite;
      }
      @keyframes float-up {
        0% { transform: translateY(100vh) scale(0); opacity: 0; }
        20% { opacity: 1; }
        90% { opacity: 1; }
        100% { transform: translateY(-20vh) scale(1); opacity: 0; }
      }
      .matrix-rain {
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        z-index: -1;
      }

      /* Status Display */
      .status-display {
        padding: 0.5rem;
        border-radius: 8px;
        font-weight: 500;
        text-align: center;
        transition: all 0.3s ease;
      }

      .status-display.healthy {
        background: rgba(76, 175, 80, 0.2);
        color: #4CAF50;
      }

      .status-display.warning,
      .status-display.unhealthy {
        background: rgba(255, 152, 0, 0.2);
        color: #FFC107;
      }

      .status-display.error {
        background: rgba(244, 67, 54, 0.2);
        color: #F44336;
      }

      /* Error Message */
      .error-message {
        margin-top: 0.5rem;
        padding: 0.5rem;
        background: rgba(244, 67, 54, 0.1);
        border-left: 3px solid #F44336;
        border-radius: 4px;
        font-size: 0.9rem;
        color: #F44336;
      }

      /* Network Card Animations */
      .network-card {
        position: relative;
        overflow: hidden;
      }

      .network-ping-indicator {
        position: absolute;
        top: 10px;
        right: 10px;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--primary);
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .network-card.network-ping {
        animation: networkPing 2s ease-in-out;
      }

      @keyframes networkPing {
        0% {
          transform: translateY(0);
          box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4);
        }
        50% {
          transform: translateY(-5px);
          box-shadow: 0 0 20px 0 rgba(76, 175, 80, 0.6);
        }
        100% {
          transform: translateY(0);
          box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.4);
        }
      }

      /* Value Display Error State */
      .value-display.error {
        color: #f44336;
        background: rgba(244, 67, 54, 0.1);
      }

      /* Function Metrics Additional Styles */
      .function-last-used {
        font-size: 0.8rem;
        color: var(--text-secondary);
        margin-top: 0.5rem;
      }

      /* Function Performance Specific Styles */
      .function-stats {
        display: flex;
        justify-content: space-between;
        margin-top: 0.5rem;
        font-size: 0.85rem;
        color: var(--text-secondary);
      }

      .function-stats span {
        padding: 0.25rem 0.5rem;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
      }

      .duration {
        color: var(--primary);
      }

      .last-used {
        color: var(--secondary);
      }

      /* Add hover effect for function cards */
      .metric-item:hover .function-stats span {
        background: rgba(255, 255, 255, 0.1);
      }

      /* API Section Styles */
      .api-section {
        background: rgba(255, 255, 255, 0.02);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 10px;
        padding: 2rem;
        margin-top: 2rem;
        box-shadow: 0 0 20px rgba(0, 0, 0, 0.5);
      }

      .section-header {
        text-align: center;
        margin-bottom: 2rem;
      }

      .section-header h2 {
        font-size: 2rem;
        margin-bottom: 0.5rem;
      }

      .intro-text {
        font-size: 1.1rem;
        color: var(--text-secondary);
      }
        
      .api-categories {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
        gap: 2rem;
        margin-top: 2rem;
      }

      .tier-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 2rem;
        margin-top: 2rem;
      }

      .tier-card {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        padding: 2rem;
        text-align: center;
        transition: all 0.3s ease;
      }

      .tier-card:hover {
        transform: translateY(-5px);
        box-shadow: 0 10px 30px rgba(0, 255, 255, 0.2);
      }

      .tier-card.featured {
        border: 1px solid var(--primary);
        transform: scale(1.05);
      }

      .tier-card h4 {
        color: var(--primary);
        margin-bottom: 1rem;
      }

      .price {
        font-size: 2rem;
        color: var(--text);
        margin-bottom: 1rem;
      }

      .tier-card ul {
        list-style: none;
        margin: 1rem 0;
        padding: 0;
      }

      .tier-card li {
        margin: 0.5rem 0;
        color: var(--text-secondary);
      }

      .tier-button {
        background: rgba(255, 255, 255, 0.1);
        color: var(--text);
        border: 1px solid var(--primary);
        border-radius: 8px;
        padding: 1rem 2rem;
        margin-top: 1rem;
        cursor: pointer;
        transition: all 0.3s ease;
        position: relative;
        overflow: hidden;
      }

      .tier-button:hover {
        background: var(--primary);
        transform: translateY(-2px);
      }

      .tier-button::after {
        content: '';
        position: absolute;
        top: -50%;
        left: -50%;
        width: 200%;
        height: 200%;
        background: linear-gradient(
          45deg,
          transparent,
          rgba(255, 255, 255, 0.1),
          transparent
        );
        transform: rotate(45deg);
        animation: buttonShine 2s ease-in-out infinite;
      }

      @keyframes buttonShine {
        0% {
          transform: translateX(-200%) rotate(45deg);
        }
        100% {
          transform: translateX(200%) rotate(45deg);
        }
      }

      .api-key-display {
        margin-top: 2rem;
        padding: 1rem;
        background: rgba(0, 0, 0, 0.2);
        border-radius: 10px;
      }

      .key-container {
        display: flex;
        gap: 1rem;
        margin: 1rem 0;
      }

      .key-container input {
        flex: 1;
        padding: 0.5rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 5px;
        color: var(--text);
      }

      .warning {
        color: var(--accent);
        font-size: 0.9rem;
        margin-top: 0.5rem;
      }

      .hidden {
        display: none;
      }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .key-value {
        font-family: monospace;
        background: rgba(0, 0, 0, 0.3);
        padding: 0.5rem;
        border-radius: 4px;
        margin: 0.5rem 0;
        word-break: break-all;
      }

      .copy-button {
        background: var(--primary);
        color: white;
        border: none;
        border-radius: 4px;
        padding: 0.5rem 1rem;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .copy-button:hover {
        background: var(--secondary);
        transform: translateY(-2px);
      }

      .key-details {
        margin-top: 1rem;
        font-size: 0.9rem;
        color: var(--text-secondary);
      }

      /* API Documentation Cards */
      .api-docs {
        margin-top: 3rem;
      }

      .api-card {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 12px;
        padding: 1.5rem;
        margin: 1rem 0;
        cursor: pointer;
        transition: all 0.3s ease;
        cursor: pointer;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .api-card-content {
        display: flex;
        flex-wrap: wrap;
        gap: 2rem;
        overflow: hidden;
        transition: max-height 0.3s ease;
      }

      .api-card-left,
      .api-card-right {
        flex: 1 1 45%;
      }

      .api-card-description {
        background: rgba(0, 0, 0, 0.15);
        padding: 1rem;
        border-radius: 8px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      }

      .api-documentation h3 {
        font-size: 1.1rem;
        margin-bottom: 0.5rem;
        color: var(--primary);
      }

      .api-documentation code.endpoint {
        background: #1a1a1a;
        padding: 0.5rem;
        border-radius: 4px;
        display: block;
        margin-bottom: 1rem;
        font-family: monospace;
      }

      .api-tags {
        margin-top: 1rem;
      }

      .api-tag {
        display: inline-block;
        background: var(--primary);
        color: #fff;
        padding: 0.25rem 0.5rem;
        margin-right: 0.5rem;
        border-radius: 4px;
        font-size: 0.8rem;
      }

      /* Small note styling */
      .doc-note {
        font-size: 0.75rem;
        color: var(--text-secondary);
        margin-top: 0.5rem;
      }

      .api-card:hover {
        background: rgba(255, 255, 255, 0.08);
        transform: translateY(-5px);
        box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        border-color: var(--primary);
      }

      .api-card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 1rem;
      }

      .api-version {
        font-size: 0.8rem;
        color: var(--accent);
        padding: 0.2rem 0.5rem;
        border-radius: 10px;
        background: rgba(255, 64, 129, 0.1);
      }

      .api-description {
        color: var(--text-secondary);
        margin-bottom: 1rem;
      }

      .api-details {
        display: none;
        margin-top: 1rem;
        padding-top: 1rem;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
      }

      .api-details.visible {
        display: block;
      }

      /* ---------- Parameter Table Styling ---------- */
      .param-table {
        width: 100% !important;
        border-collapse: collapse;
        margin: 1rem 0;
        font-size: 0.9rem;
        background-color: rgba(255, 255, 255, 0.02);
      }

      .param-table table {
        width: 100%;
      }

      .param-table th,
      .param-table td {
        border: 1px solid rgba(255, 255, 255, 0.15);
        padding: 0.75rem 1rem;
        text-align: left;
      }

      .param-table th {
        background-color: rgba(255, 255, 255, 0.1);
        color: var(--primary);
        font-weight: 600;
      }

      .param-table td {
        background-color: rgba(255, 255, 255, 0.05);
        color: var(--text);
      }

      .param-table tr:nth-child(even) td {
        background-color: rgba(255, 255, 255, 0.08);
      }

      /* Add a subtle hover effect for rows */
      .param-table tr:hover td {
        background-color: rgba(255, 255, 255, 0.12);
      }

      /* Optional: Rounded corners on the table */
      .param-table {
        border-radius: 8px;
        overflow: hidden;
      }

      .api-params, .api-response {
        margin-bottom: 1.5rem;
      }

      .api-test-form {
        background: rgba(0, 0, 0, 0.2);
        padding: 1rem;
        border-radius: 10px;
      }

      .form-group {
        margin-bottom: 1rem;
      }

      /* =============== Dropdown Styling Fix =============== */
      .form-group select {
        background: rgba(0, 0, 0, 0.6);
        color: white;
        border: 1px solid rgba(255, 255, 255, 0.2);
        padding: 8px;
        border-radius: 5px;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .form-group select:hover {
        background: rgba(0, 255, 255, 0.3);
        color: black;
      }

      .form-group label {
        display: block;
        margin-bottom: 0.5rem;
        color: var(--text-secondary);
      }

      .form-group input, .form-group select {
        width: 100%;
        padding: 0.5rem;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 5px;
        color: var(--text);
      }

      .api-key-management {
        margin-top: 3rem;
        padding: 2rem;
        border-radius: var(--border-radius);
      }

      .api-card pre {
        background: rgba(0, 0, 0, 0.3);
        padding: 1rem;
        border-radius: 8px;
        margin: 1rem 0;
        overflow-x: auto;
      }

      .api-card code {
        font-family: monospace;
        color: var(--text);
      }

      .api-card button {
        background: var(--primary);
        color: white;
        border: none;
        border-radius: 4px;
        padding: 0.5rem 1rem;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .api-card button:hover {
        background: var(--secondary);
        transform: translateY(-2px);
      }
      
      /* Just ensure you have styles for .hidden, .api-result, .result-content, etc. */
      .hidden { display: none; }

      .api-result { margin-top: 1rem; }
      .api-result.visible { display: block; }

      .result-content {
        background: #111;
        color: #eee;
        padding: 1rem;
        border-radius: 8px;
        overflow-x: auto;
      }

      /* Ensure .status-dot.healthy / .status-dot.unhealthy color them differently */
      .status-dot {
        display: inline-block;
        width: 8px;
        height: 8px;
        margin-right: 0.5rem;
        border-radius: 50%;
        background: #ccc;
      }
      .status-dot.healthy { background: #4caf50; }
      .status-dot.unhealthy { background: #ff9800; }
    </style>
  `;
}

// ----------------------------------------------------------
// 7) The revised getDashboardScripts()
// ----------------------------------------------------------
function getDashboardScripts() {
  return `
    <script>
      // We'll wrap everything in an IIFE to avoid polluting global scope
      (() => {
        //
        // 1) INIT WEBSOCKET (Unchanged from your old code)
        //
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host;
        const ws = new WebSocket(\`\${protocol}//\${host}\`);
        ws.onmessage = async (evt) => {
          const data = JSON.parse(evt.data);
          console.log('Live metrics update:', data);
          // Dynamically refresh dashboard fragment without full reload
          try {
            const res = await fetch('/dashboard/fragment');
            const html = await res.text();
            const container = document.getElementById('dashboardContainer');
            if (container) {
              container.innerHTML = html;
            } else {
              console.error('dashboardContainer element not found');
            }
          } catch (err) {
            console.error('Error refreshing fragment:', err);
          }
        };

        //
        // 2) DOMContentLoaded: set up all your event listeners
        //
        document.addEventListener('DOMContentLoaded', () => {
          createMatrixBackground();
          //createLabEffects();
          initParticles();
          initNetworkCardAnimations();

          // ========== A) API KEY GENERATION ==========
          document.querySelectorAll('.tier-button').forEach((btn) => {
            btn.addEventListener('click', async () => {
              try {
                const tier = btn.dataset.tier;
                const response = await fetch('/api/keys', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tier })
                });
                const data = await response.json();
                if (data.success && data.key) {
                  document.getElementById('apiKeyDisplay').classList.remove('hidden');
                  document.getElementById('apiKeyInput').value = data.key;
                } else {
                  alert(data.error || 'Failed to generate API key');
                }
              } catch (err) {
                console.error('Key generation error:', err);
                alert('Error generating API key');
              }
            });
          });

          // Copy the generated key
          const copyBtn = document.getElementById('copyKeyButton');
          copyBtn.addEventListener('click', () => {
            const input = document.getElementById('apiKeyInput');
            input.select();
            document.execCommand('copy');
            alert('API Key copied!');
          });

          // ========== B) SENTIMENT API TEST ==========
          const sentimentForm = document.getElementById('sentimentTestForm');
          sentimentForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const query = document.getElementById('sentimentQuery').value;
            const network = document.getElementById('sentimentNetwork').value;
            const apiKey = document.getElementById('sentimentApiKey').value;
            const resultDiv = document.getElementById('sentimentResult');
            const resultContent = resultDiv.querySelector('.result-content');

            try {
              const response = await fetch('/api/v1/sentiment', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': apiKey
                },
                body: JSON.stringify({ query, network })
              });
              const data = await response.json();
              resultContent.textContent = JSON.stringify(data, null, 2);
              resultDiv.classList.remove('hidden');
            } catch (err) {
              resultContent.textContent = JSON.stringify({ error: err.message }, null, 2);
              resultDiv.classList.remove('hidden');
            }
          });

          // ========== C) TOKEN API TEST ==========
          const tokenForm = document.getElementById('tokenTestForm');
          tokenForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const tokenAddr = document.getElementById('tokenAddress').value;
            const network = document.getElementById('tokenNetwork').value;
            const apiKey = document.getElementById('tokenApiKey').value;
            const resultDiv = document.getElementById('tokenResult');
            const resultContent = resultDiv.querySelector('.result-content');

            try {
              const response = await fetch('/api/v1/token', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': apiKey
                },
                body: JSON.stringify({ token: tokenAddr, network })
              });
              const data = await response.json();
              resultContent.textContent = JSON.stringify(data, null, 2);
              resultDiv.classList.remove('hidden');
            } catch (err) {
              resultContent.textContent = JSON.stringify({ error: err.message }, null, 2);
              resultDiv.classList.remove('hidden');
            }
          });

          // ========== D) COPY RESULT TEXT ==========
          // For the "copy-button" on each result
          document.querySelectorAll('.copy-button[data-target]').forEach((button) => {
            const targetId = button.dataset.target;
            button.addEventListener('click', () => {
              const resultDiv = document.getElementById(targetId);
              const textToCopy = resultDiv.querySelector('.result-content').textContent || '';
              navigator.clipboard.writeText(textToCopy);
              const icon = button.querySelector('i');
              icon.className = 'fas fa-check';
              setTimeout(() => { icon.className = 'fas fa-copy'; }, 1500);
            });
          });

          // ========== F) CHECK API STATUS AT LOAD ==========
          checkApiStatus();
          setInterval(checkApiStatus, 30000);
        });

        //
        // 3) We keep the same createMatrixBackground(), createLabEffects() etc. 
        //
        function createMatrixBackground() {
          const container = document.querySelector('.matrix-container');
          if (!container) return;
          const chars = '01';
          const columnCount = Math.floor(window.innerWidth / 20);

          for (let i = 0; i < columnCount; i++) {
            const col = document.createElement('div');
            col.className = 'matrix-column';
            col.style.left = (i * 20) + 'px';
            col.style.animationDuration = (Math.random() * 3 + 2) + 's';
            // generate random sequence of '0'/'1'
            const length = Math.floor(Math.random() * 25 + 5);
            const textArr = Array(length).fill().map(() => chars[Math.floor(Math.random() * chars.length)]);
            col.textContent = textArr.join('\\n');
            container.appendChild(col);
          }
        }

        function createLabEffects() {
          const container = document.querySelector('.lab-container');
          if (!container) return;

          function createChemical() {
            const c = document.createElement('div');
            c.className = 'chemical';
            c.style.width = '10px';
            c.style.height = '40px';
            c.style.left = Math.random() * 100 + 'vw';
            c.style.top = Math.random() * 100 + 'vh';
            container.appendChild(c);
            setTimeout(() => c.remove(), 2000);
          }

          function createFlask() {
            const f = document.createElement('div');
            f.className = 'flask';
            f.style.width = '20px';
            f.style.height = '60px';
            f.style.left = Math.random() * 100 + 'vw';
            f.style.top = Math.random() * 100 + 'vh';
            container.appendChild(f);
            setTimeout(() => f.remove(), 2500);
          }

          setInterval(createChemical, 3000);
          setInterval(createFlask, 4000);
        }

        function initParticles() {
          const particlesContainer = document.createElement('div');
          particlesContainer.className = 'particles-container';
          document.body.appendChild(particlesContainer);

          for (let i = 0; i < 50; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = Math.random() * 100 + 'vw';
            particle.style.animationDelay = Math.random() * 5 + 's';
            particle.style.animationDuration = Math.random() * 10 + 10 + 's';
            particlesContainer.appendChild(particle);
          }
        }

        function initNetworkCardAnimations() {
          const networkCards = document.querySelectorAll('.network-card');
          if (!networkCards.length) return;

          function animateRandomCard() {
            const randomIndex = Math.floor(Math.random() * networkCards.length);
            const card = networkCards[randomIndex];
            
            card.classList.add('network-ping');
            
            const indicator = card.querySelector('.network-ping-indicator');
            indicator.style.opacity = '1';
            
            setTimeout(() => {
              card.classList.remove('network-ping');
              indicator.style.opacity = '0';
            }, 2000);
          }

          // Animate a random card every 3-7 seconds
          setInterval(() => {
            animateRandomCard();
          }, Math.random() * 4000 + 3000);
        }

        // ========== F) checkApiStatus to update status-dot for each API ========== 
        async function checkApiStatus() {
          try {
            const res = await fetch('/api/status');
            const data = await res.json();
            // D.A.I.L /api/status returns { services: { sentiment: { status: 'healthy' }, token: { status: 'unhealthy' } } }
            const sentimentStatus = data.services?.sentiment?.status || 'unhealthy';
            const tokenStatus = data.services?.token?.status || 'unhealthy';

            updateStatusDot('sentimentApiStatus', sentimentStatus);
            updateStatusDot('tokenApiStatus', tokenStatus);
          } catch (err) {
            console.error('Error checking API status:', err);
          }
        }

        function updateStatusDot(id, status) {
          const el = document.getElementById(id);
          if (!el) return;
          const isHealthy = (status === 'healthy');
          const dotClass = isHealthy ? 'status-dot healthy' : 'status-dot unhealthy';
          const text = isHealthy ? 'Operational' : 'Issues Detected';
          el.innerHTML = \`
            <span class="\${dotClass}"></span>
            <span class="status-text">\${text}</span>
          \`;
        }
      })();
    </script>
  `;
}

/**
 * HELPER UTILITY FUNCTIONS
 */
function formatUptime(seconds) {
  const totalSec = parseInt(seconds, 10);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function getOverallPulse(services) {
  const states = Object.entries(services).map(([svc, s]) => {
    if (typeof s === 'object' && s !== null) {
      if (svc === 'wallets' && s.overall) {
        return s.overall; // for wallets we already aggregate overall status
      } else if ('healthy' in s) {
        return s.healthy ? 'healthy' : 'unhealthy';
      }
    } else if (typeof s === 'string') {
      return s;
    }
    return 'unhealthy';
  });

  // If ANY is 'unhealthy' or 'partial', return warning.
  if (states.includes('unhealthy') || states.includes('partial')) {
    return 'warning';
  }
  return 'healthy';
}

function getServiceIcon(service) {
  const icons = {
    database: 'database',
    wallets: 'wallet',
    pumpFun: 'chart-line',    
    priceAlerts: 'bell',
    twitter: 'twitter-square',
    kolMonitoring: 'user-secret',
    default: 'cube'
  };
  return icons[service] || icons.default;
}

export { dashboardRouter as default, fetchMetrics as startMonitoringDashboard };

export { validateApiKey, trackApiUsage }
