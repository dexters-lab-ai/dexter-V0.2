import mongoose from "mongoose";

const JupiterQuoteSchema = new mongoose.Schema({
  inputMint: { type: String, required: true },
  outputMint: { type: String, required: true },
  inAmount: { type: String, required: true },
  outAmount: { type: String, required: true },
  slippageBps: { type: Number, required: true },
  routePlan: { type: Array, required: true },
  priceImpactPct: { type: String, required: true },
  swapUsdValue: { type: String, required: true },
  timestamp: { type: Date, default: Date.now } // Auto-store when it was cached
});

JupiterQuoteSchema.index({ inputMint: 1, outputMint: 1 }, { unique: true });

export const JupiterQuote = mongoose.model("JupiterQuote", JupiterQuoteSchema);
