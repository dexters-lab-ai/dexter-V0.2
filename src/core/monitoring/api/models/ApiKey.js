import mongoose from 'mongoose';

const ApiKeySchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  tier: {
    type: String,
    enum: ['basic', 'pro', 'enterprise'],
    default: 'basic'
  },
  quotaLimit: {
    type: Number,
    required: true
  },
  usageCount: {
    type: Number,
    default: 0
  },
  active: {
    type: Boolean,
    default: true
  },
  lastUsed: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  }
});

// Add index for quota checking
ApiKeySchema.index({ active: 1, usageCount: 1, quotaLimit: 1 });

// Add index for expiration
ApiKeySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Methods
ApiKeySchema.methods.incrementUsage = async function() {
  this.usageCount += 1;
  this.lastUsed = new Date();
  await this.save();
};

ApiKeySchema.methods.checkQuota = function() {
  return this.usageCount < this.quotaLimit;
};

ApiKeySchema.methods.deactivate = async function() {
  this.active = false;
  await this.save();
};

// Statics: Use $expr to compare usageCount and quotaLimit fields
ApiKeySchema.statics.findValidKey = async function(key) {
  return this.findOne({
    key,
    active: true,
    expiresAt: { $gt: new Date() },
    $expr: { $lt: [ "$usageCount", "$quotaLimit" ] }
  });
};

export const ApiKey = mongoose.model('ApiKey', ApiKeySchema);
