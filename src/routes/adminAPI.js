import express from 'express';
import { adminAuth } from '../core/monitoring/middleware/adminAuth';
import { ApiKey } from '../core/monitoring/api/models/ApiKey.js';

const router = express.Router();

// Apply admin authentication to all admin routes.
router.use(adminAuth);

// GET /admin/api-keys - List all API keys
router.get('/api-keys', async (req, res) => {
  try {
    const apiKeys = await ApiKey.find();
    res.json({ apiKeys });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /admin/api-keys/:id - Get details for a specific API key by its DB ID
router.get('/api-keys/:id', async (req, res) => {
  try {
    const apiKey = await ApiKey.findById(req.params.id);
    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json({ apiKey });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /admin/api-keys/:id - Deactivate (delete) an API key
router.delete('/api-keys/:id', async (req, res) => {
  try {
    const apiKey = await ApiKey.findById(req.params.id);
    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }
    // Assuming you have an instance method called "deactivate" on your ApiKey model
    await apiKey.deactivate();
    res.json({ success: true, message: 'API key deactivated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// (Optional) PUT /admin/api-keys/:id - Update or reactivate an API key if needed
router.put('/api-keys/:id', async (req, res) => {
  try {
    const updateData = req.body;
    const apiKey = await ApiKey.findByIdAndUpdate(req.params.id, updateData, { new: true });
    if (!apiKey) {
      return res.status(404).json({ error: 'API key not found' });
    }
    res.json({ apiKey });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
