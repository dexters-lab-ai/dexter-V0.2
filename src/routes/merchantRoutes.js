import express from 'express';
import { merchantService } from '../services/merchant/MerchantService.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { name, email, walletAddress } = req.body;
    const merchant = await merchantService.registerMerchant(name, email, walletAddress);
    res.status(201).json(merchant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:email', async (req, res) => {
  try {
    const merchant = await merchantService.getMerchantByEmail(req.params.email);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    res.json(merchant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:email', async (req, res) => {
  try {
    const updateData = req.body;
    const merchant = await merchantService.updateMerchant(req.params.email, updateData);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    res.json(merchant);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:email', async (req, res) => {
  try {
    const merchant = await merchantService.deleteMerchant(req.params.email);
    if (!merchant) {
      return res.status(404).json({ error: 'Merchant not found' });
    }
    res.json({ message: 'Merchant deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
