import express from 'express';
import { validateApiKey, trackApiUsage } from '../middleware/apiAuth.js';
import { 
  handleSentimentQuery,
  handleTokenQuery 
} from '../controllers/apiController.js';

const router = express.Router();

// API Key Management Routes
router.post('/keys', async (req, res) => {
  try {
    const { tier } = req.body;
    const key = await createApiKey(req.user.id, tier);
    res.json({ success: true, key });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Endpoints
router.post('/v1/sentiment', validateApiKey, async (req, res) => {
  try {
    await trackApiUsage(req.apiKey, 'sentiment');
    const result = await handleSentimentQuery(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/v1/token', validateApiKey, async (req, res) => {
  try {
    await trackApiUsage(req.apiKey, 'token');
    const result = await handleTokenQuery(req.body);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;