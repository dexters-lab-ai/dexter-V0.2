import { Merchant } from '../../models/Merchant.js';

class MerchantService {
  async registerMerchant(name, email, walletAddress) {
    const merchant = new Merchant({ name, email, walletAddress });
    await merchant.save();
    return merchant;
  }

  async getMerchantByEmail(email) {
    return await Merchant.findOne({ email });
  }

  async updateMerchant(email, updateData) {
    return await Merchant.findOneAndUpdate({ email }, updateData, { new: true });
  }

  async deleteMerchant(email) {
    return await Merchant.findOneAndDelete({ email });
  }
}

export const merchantService = new MerchantService();
