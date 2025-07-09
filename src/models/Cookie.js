import mongoose from 'mongoose';

const CookieCacheSchema = new mongoose.Schema({
  endpoint: { type: String, required: true },
  queryKey: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true },
  createdAt: { type: Date, default: Date.now },
});

// Ensure that for each endpoint and queryKey (which includes the date), we have only one document.
CookieCacheSchema.index({ endpoint: 1, queryKey: 1 }, { unique: true });

export default mongoose.model('CookieCache', CookieCacheSchema);
