import express from 'express';
import { recurringPaymentService } from '../services/recurringPayments/RecurringPayments.js';

const router = express.Router();

router.post('/create', async (req, res) => {
  try {
    const { userId, merchantEmail, amount, interval } = req.body;
    const recurringPayment = await recurringPaymentService.createRecurringPayment(userId, merchantEmail, amount, interval);
    res.status(201).json(recurringPayment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
