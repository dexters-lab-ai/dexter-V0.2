import mongoose from 'mongoose';

const CacheSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  expiresAt: { type: Date, required: true }
});

// TTL index: MongoDB will automatically remove documents past the expiresAt time.
CacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const CacheEntry = mongoose.model('CacheEntry', CacheSchema);
export default CacheEntry;
