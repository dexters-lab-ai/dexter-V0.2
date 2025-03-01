import express from 'express';
import { paymentHistoryService } from '../services/paymentHistory/PaymentHistory';

const router = express.Router();

router.get('/user/:userId', async (req, res) => {
  try {
    const payments = await paymentHistoryService.getPaymentHistory(req.params.userId);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/merchant/:email', async (req, res) => {
  try {
    const payments = await paymentHistoryService.getMerchantPaymentHistory(req.params.email);
    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/export/:userId', async (req, res) => {
  try {
    const format = req.query.format || 'csv';
    const file = await paymentHistoryService.exportPaymentHistory(req.params.userId, format);
    res.download(file);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
