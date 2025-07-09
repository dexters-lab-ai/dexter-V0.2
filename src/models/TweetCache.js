// /models/TweetCache.js
import mongoose from 'mongoose';

const TweetCacheSchema = new mongoose.Schema({
  handle: {
    type: String,
    required: true,
    index: true
  },
  // The fetched tweets or items from Apify
  items: {
    type: Array,
    default: []
  },
  // The date we last updated the tweets
  updatedAt: {
    type: Date,
    default: Date.now,
    index: true
  }
});

export const TweetCache = mongoose.model('TweetCache', TweetCacheSchema);
