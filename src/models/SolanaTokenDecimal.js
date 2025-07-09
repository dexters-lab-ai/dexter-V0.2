import mongoose from "mongoose";

const SolanaTokenDecimalSchema = new mongoose.Schema(
  {
    mintAddress: { type: String, required: true, unique: true },
    decimals: { type: Number, required: true },
    updatedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export const SolanaTokenDecimal = mongoose.model(
  "SolanaTokenDecimal",
  SolanaTokenDecimalSchema
);
