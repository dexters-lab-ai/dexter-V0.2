import mongoose from 'mongoose';

const RecurringPaymentSchema = new mongoose.Schema({
  userId: { type: String, required: true },
  merchantEmail: { type: String, required: true },
  amount: { type: Number, required: true },
  interval: { type: String, required: true }, // e.g., 'daily', 'weekly', 'monthly'
  nextPaymentDate: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

export const RecurringPayment = mongoose.model('RecurringPayment', RecurringPaymentSchema);
