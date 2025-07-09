import mongoose from 'mongoose';

const ApiUsageSchema = new mongoose.Schema({
  apiKey: {
    type: String,
    required: true,
    index: true
  },
  endpoint: {
    type: String,
    required: true,
    index: true
  },
  responseTime: {
    type: Number,
    required: true
  },
  statusCode: {
    type: Number,
    required: true
  },
  dataSize: {
    type: Number,
    required: true
  },
  cost: {
    type: Number,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  }
});

// Add compound index for analytics
ApiUsageSchema.index({ apiKey: 1, endpoint: 1, timestamp: 1 });

// Methods for analytics
ApiUsageSchema.statics.getDailyUsage = async function(apiKey, date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  return this.aggregate([
    {
      $match: {
        apiKey,
        timestamp: {
          $gte: startOfDay,
          $lte: endOfDay
        }
      }
    },
    {
      $group: {
        _id: '$endpoint',
        count: { $sum: 1 },
        totalCost: { $sum: '$cost' },
        avgResponseTime: { $avg: '$responseTime' },
        totalDataSize: { $sum: '$dataSize' }
      }
    }
  ]);
};

ApiUsageSchema.statics.getMonthlyUsage = async function(apiKey, year, month) {
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  return this.aggregate([
    {
      $match: {
        apiKey,
        timestamp: {
          $gte: startOfMonth,
          $lte: endOfMonth
        }
      }
    },
    {
      $group: {
        _id: {
          day: { $dayOfMonth: '$timestamp' },
          endpoint: '$endpoint'
        },
        count: { $sum: 1 },
        totalCost: { $sum: '$cost' }
      }
    },
    {
      $sort: {
        '_id.day': 1
      }
    }
  ]);
};

export const ApiUsage = mongoose.model('ApiUsage', ApiUsageSchema);