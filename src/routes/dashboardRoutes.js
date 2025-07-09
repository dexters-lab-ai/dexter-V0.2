import express from 'express';
import { startMonitoringDashboard } from '../core/monitoring/Dashboard.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    await startMonitoringDashboard();
    res.status(200).json({ message: 'Monitoring dashboard started successfully' });
  } catch (error) {
    console.error('Error starting dashboard:', error);
    res.status(500).json({ error: 'Failed to start monitoring dashboard' });
  }
});

export default router;
