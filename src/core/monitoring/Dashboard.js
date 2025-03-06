// src/core/monitoring/Dashboard.js
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

const dashboardRouter = express.Router();

/**
 * Fetch and format all metrics.
 */
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
    // Destructure the results in order
    const [
      pumpFunMetrics,
      aiMetrics,
      flipperMetrics,
      walletHealth,
      databaseHealth,
      priceAlertMetrics,
      twitterHealth,
      kolMetrics
    ] = results;

    const systemMetrics = {
      uptime: process.uptime().toFixed(2),
      memoryUsage: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2),
      cpuUsage: os.loadavg()[0].toFixed(2),
      osLoadAvg: os.loadavg(),
    };

    const formatResult = (result) =>
      result.status === 'fulfilled' ? result.value : (console.error('Error in result:', result.reason), null);

    return {
      system: systemMetrics,
      services: {
        database: formatResult(databaseHealth),
        wallets: aggregateWalletStatus(formatResult(walletHealth)),
        pumpFun: formatResult(pumpFunMetrics),
        priceAlerts: formatResult(priceAlertMetrics),
        twitter: formatResult(twitterHealth),
        kolMonitoring: formatResult(kolMetrics)
      },
      ai: formatResult(aiMetrics),
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

function aggregateWalletStatus(walletArray) {
  // If walletArray is null or not an array, fail gracefully
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
  
  // Decide overall 
  let overall = 'unhealthy'; 
  // If all healthy => overall healthy
  if (healthyCount === total) {
    overall = 'healthy';
  } 
  // If at least 1 healthy but not all => partial
  else if (healthyCount > 0) {
    overall = 'partial'; 
  }

  return {
    overall,          // 'healthy', 'partial', or 'unhealthy'
    details: walletArray, 
    total,
    healthyCount,
    failCount
  };
}

/**
 * Check database health.
 */
async function checkDatabaseStatus() {
  try {
    await db.checkHealth();
    return 'healthy';
  } catch (error) {
    console.error('Database health check failed:', error);
    return 'unhealthy';
  }
}

dashboardRouter.get('/', async (req, res) => {
  try {
    const metrics = await fetchMetrics();
    if (metrics.error) {
      throw new Error(metrics.error);
    }

    // Render HTML
    res.send(`
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

        <div class="dashboard-container">
          ${renderSystemMetrics(metrics.system)}
          ${renderNetworkStatus(metrics.services.wallets?.details || [])}
          ${renderServiceStatus(metrics.services)}
          ${renderAIMetrics(metrics.ai)}
          ${renderPriceAlerts(metrics.services.priceAlerts)}
          ${renderFunctionMetrics(metrics.ai?.functions || [])}
        </div>

        ${getDashboardScripts()}
      </body>
      </html>
    `);
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

/**
 * Render the lab-themed glass menu (outside the main container).
 */
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
    <!-- Spacer to offset fixed nav -->
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

function renderGenericService(svc, status) {
  const icon = getServiceIcon(svc);
  let state = 'unhealthy';
  if (typeof status === 'object' && status !== null) {
    // If the object has a healthy property, use it.
    state = status.healthy ? 'healthy' : 'unhealthy';
  } else if (typeof status === 'string') {
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
    twitter: 'twitter',
    kolMonitoring: 'user-secret',
    default: 'cube'
  };
  return icons[service] || icons.default;
}


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

/**
 * Render AI metrics such as OpenAI usage and context stats.
 */
function renderAIMetrics(ai) {
  if (!ai || !ai.openai) return '';
  
  return `
    <section class="metrics-card system-metrics glass-effect">
      <div class="card-header">
        <h2><i class="fas fa-robot pulse-icon"></i> AI Performance</h2>
        <div class="pulse-indicator ${ai.openai.rateLimitHits > 10 ? 'warning' : 'healthy'}"></div>
      </div>
      
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
                <div class="progress" style="width: ${Math.min((ai.context?.cacheHits / (ai.context?.cacheHits + ai.context?.cacheMisses || 1)) * 100, 100)}%">
                  <div class="progress-glow"></div>
                </div>
              </div>
              <span class="progress-text">Hits: ${ai.context?.cacheHits || 0} / Misses: ${ai.context?.cacheMisses || 0}</span>
            </div>
          </div>
        </div>

        <!-- Memory Usage -->
        <div class="metric-item">
          <div class="metric-icon">
            <i class="fas fa-database"></i>
          </div>
          <div class="metric-info">
            <h3>Memory Usage</h3>
            <div class="progress-container">
              <div class="progress-bar">
                <div class="progress" style="width: ${Math.min((ai.context?.memoryUsage / (1024 * 1024 * 1024)) * 100, 100)}%">
                  <div class="progress-glow"></div>
                </div>
              </div>
              <span class="progress-text">${((ai.context?.memoryUsage || 0) / 1024 / 1024).toFixed(2)} MB</span>
            </div>
          </div>
        </div>
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

/**
 * Render function performance metrics as a table.
 */
function renderFunctionMetrics(functions) {
  if (!functions || !functions.length) {
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

  // Calculate overall success rate for the pulse indicator
  const overallSuccessRate = Array.from(functions).reduce((acc, [_, stats]) => {
    return acc + (stats.successes / stats.calls * 100);
  }, 0) / functions.length;

  return `
    <section class="metrics-card system-metrics glass-effect">
      <div class="card-header">
        <h2><i class="fas fa-code pulse-icon"></i> Function Performance</h2>
        <div class="pulse-indicator ${overallSuccessRate > 90 ? 'healthy' : 'warning'}"></div>
      </div>
      <div class="metrics-grid">
        ${Array.from(functions).map(([fname, stats]) => {
          const successRate = stats.calls ? ((stats.successes / stats.calls) * 100).toFixed(1) : '0.0';
          return `
            <div class="metric-item">
              <div class="metric-icon">
                <i class="fas fa-function"></i>
              </div>
              <div class="metric-info">
                <h3>${fname}</h3>
                <div class="progress-container">
                  <div class="progress-bar">
                    <div class="progress" style="width: ${successRate}%">
                      <div class="progress-glow"></div>
                    </div>
                  </div>
                  <span class="progress-text">
                    ${stats.calls} calls | ${successRate}% success
                  </span>
                </div>
                <div class="function-stats">
                  <span class="duration">Avg: ${stats.avgDuration.toFixed(2)}ms</span>
                  <span class="last-used">Last: ${new Date(stats.lastUsed).toLocaleString()}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

/**
 * Format uptime (in seconds) as "Xd Yh Zm".
 */
function formatUptime(seconds) {
  const totalSec = parseInt(seconds, 10);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

/**
 * Return the CSS styles for the dashboard.
 */
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
        --bg: #000;
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
        border-bottom: 1px solid rgba(255, 255, 255, 0.2);
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
        backdrop-filter: blur(10px);
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
      .metric-item:hover {
        transform: translateY(-5px);
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.2);
        border-color: var(--primary);
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

    </style>
  `;
}

/**
 * Return the dashboard scripts: matrix background, lab effects, and particles.
 */
function getDashboardScripts() {
  return `
    <script>
      const ws = new WebSocket('ws://localhost:4001');
      ws.onmessage = (evt) => {
        const data = JSON.parse(evt.data);
        console.log('Live metrics update:', data);
      };

      function createMatrixBackground() {
        const container = document.querySelector('.matrix-container');
        if (!container) return;
        const chars = '01';
        const columnCount = Math.floor(window.innerWidth / 20);
        for (let i = 0; i < columnCount; i++) {
          const col = document.createElement('div');
          col.className = 'matrix-column';
          col.style.left = (i * 20) + 'px';
          col.style.animationDuration = (Math.random() * 3 + 2) + 's'; // Slower animation
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
          
          // ping animation class
          card.classList.add('network-ping');
          
          // Show ping indicator
          const indicator = card.querySelector('.network-ping-indicator');
          indicator.style.opacity = '1';
          
          // Remove animation after completion
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

      window.addEventListener('DOMContentLoaded', () => {
        createMatrixBackground();
        createLabEffects();
        initParticles();
        initNetworkCardAnimations();
      });

    </script>
  `;
}

const wss = new WebSocketServer({ port: 4001 });
wss.on('connection', (client) => {
  console.log('Client connected to WebSocket');
  client.on('message', (msg) => console.log('Received:', msg));
  client.on('close', () => console.log('Client disconnected'));
});

// Broadcast updated metrics every 15 mins
setInterval(async () => {
  const metrics = await fetchMetrics();
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(metrics));
    }
  });
}, 900000);

export { dashboardRouter as default, fetchMetrics as startMonitoringDashboard };
