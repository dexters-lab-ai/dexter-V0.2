import { ApiKey } from '../models/ApiKey.js';
import { v4 as uuidv4 } from 'uuid';
import { encrypt } from '../../../../utils/encryption.js';

const TIER_CONFIGS = {
  basic: {
    quotaLimit: 1000,
    validityDays: 30,
    rateLimit: 60 // per minute
  },
  pro: {
    quotaLimit: 10000,
    validityDays: 30,
    rateLimit: 300 // per minute
  },
  enterprise: {
    quotaLimit: 100000,
    validityDays: 30, //30 days validity
    rateLimit: 1000 // per minute
  }
};

export class ApiKeyService {
  static async generateKey(userId, tier = 'basic') {
    const config = TIER_CONFIGS[tier];
    if (!config) {
      throw new Error(`Invalid tier: ${tier}`);
    }

    const key = `dail_${uuidv4()}`;
    const encryptedKey = encrypt(key);
    
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + config.validityDays);

    const apiKey = new ApiKey({
      key: encryptedKey,
      userId,
      tier,
      quotaLimit: config.quotaLimit,
      expiresAt
    });

    await apiKey.save();
    return key;
  }

  static async validateKey(key) {
    const apiKey = await ApiKey.findValidKey(key);
    if (!apiKey) return false;
  
    // Ensure expiration check
    if (new Date() > apiKey.expiresAt) {
      await apiKey.deactivate();
      return false;
    }
  
    // Check rate limit
    const recentUsage = await this.getRecentUsage(key);
    const config = TIER_CONFIGS[apiKey.tier];
  
    if (recentUsage >= config.rateLimit) {
      return false;
    }
  
    return true;
  }  

  static async getRecentUsage(key, timeWindowMs = 60000) {
    const since = new Date(Date.now() - timeWindowMs);
    
    const usage = await ApiUsage.countDocuments({
      apiKey: key,
      timestamp: { $gte: since }
    });

    return usage;
  }

  static async deactivateKey(key) {
    const apiKey = await ApiKey.findOne({ key: encrypt(key) });
    if (apiKey) {
      await apiKey.deactivate();
      return true;
    }
    return false;
  }

  static async getUserKeys(userId) {
    return ApiKey.find({ 
      userId,
      active: true,
      expiresAt: { $gt: new Date() }
    }).select('-key');
  }

  static async getKeyMetrics(key) {
    const apiKey = await ApiKey.findOne({ key: encrypt(key) });
    if (!apiKey) return null;

    const usage = await ApiUsage.aggregate([
      {
        $match: { apiKey: key }
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          totalCost: { $sum: '$cost' },
          avgResponseTime: { $avg: '$responseTime' },
          totalDataSize: { $sum: '$dataSize' }
        }
      }
    ]);

    return {
      tier: apiKey.tier,
      quotaUsed: apiKey.usageCount,
      quotaLimit: apiKey.quotaLimit,
      metrics: usage[0] || {
        totalCalls: 0,
        totalCost: 0,
        avgResponseTime: 0,
        totalDataSize: 0
      }
    };
  }
}