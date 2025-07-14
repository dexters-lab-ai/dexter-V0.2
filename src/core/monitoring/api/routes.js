import express from 'express';
import { db } from '../../database.js';
import { validateApiKey, trackAndContinue } from '../middleware/apiAuth.js';
import { 
  handleSentimentQuery,
  handleTokenQuery 
} from '../controllers/apiController.js';
import { ApiKeyService } from './services/ApiKeyService.js';

const router = express.Router();

/**
 * GET /ping
 * A quick connectivity test that returns "pong" and a timestamp.
 */
router.get('/ping', (req, res) => {
  res.json({ message: 'pong', timestamp: new Date().toISOString() });
});

/**
 * GET /version
 * Returns the API version and build/environment info.
 */
router.get('/version', (req, res) => {
  res.json({
    version: "1.3.0", //KATZ! [O.P.E.R.A.T.O.R-TG]life is 1.3 after Boot and Skin versions. D.A.I.L is 1.4.0 public release
    environment: process.env.NODE_ENV || 'development',
    build: process.env.BUILD_NUMBER || 'testnet'
  });
});

/**
 * POST /keys
 * API Key Management - Generate a new API key.
 * Uses the ApiKeyService.
 */
router.post('/keys', async (req, res) => {
  try {
    const { tier } = req.body;
    // Testing: generate a random ID
    const userId = Math.floor(Math.random() * 1000000).toString();
    const key = await ApiKeyService.generateKey(userId, tier);
    res.json({ success: true, key });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/sentiment
 * Sentiment Analysis Endpoint, key product for the API service
 */
router.post('/v1/sentiment', validateApiKey, trackAndContinue, async (req, res) => {
  try {
    const result = await handleSentimentQuery(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /v1/token
 * Token Analysis Endpoint, key product for the API service
 */
router.post('/v1/token', validateApiKey, trackAndContinue, async (req, res) => {
  try {
    const result = await handleTokenQuery(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /downloadPumpFunTokens
 * Download the last 300 PumpFun tokens as JSON.
router.get('/downloadPumpFunTokens', async (req, res) => {
  try {
    const tokensResult = await pumpFunService.getTokensByPeriod(new Date(0), new Date());
    if (!tokensResult.success) {
      throw new Error(tokensResult.error);
    }
    const tokens = tokensResult.tokens
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 300)
      .reverse();
    console.log(`📥 Downloading ${tokens.length} PumpFun tokens from DB`);
    res.setHeader('Content-Disposition', 'attachment; filename=pumpfun_tokens.json');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(tokens, null, 2));
  } catch (error) {
    console.error('❌ Error in /downloadPumpFunTokens:', error);
    res.status(500).send({ error: error.message });
  }
});
 */

/**
 * GET /status
 * Returns the health status of various services and system uptime.
*/
router.get('/status', async (req, res) => {
  try {
    const dbStatus = await db.checkHealth();     
    const sentimentStatus = 'healthy'; // Replace with real logic when available
    const tokenStatus = 'healthy';     // Replace with real logic when available

    const status = {
      services: {
        sentiment: { status: sentimentStatus },
        token: { status: tokenStatus },
        database: { status: dbStatus.status }
      },
      system: {
        uptime: process.uptime().toFixed(2)
      }
    };

    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
