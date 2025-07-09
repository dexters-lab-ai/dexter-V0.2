import { RecurringPayment } from '../../models/RecurringPayment.js';

class RecurringPaymentService {
  async createRecurringPayment(userId, merchantEmail, amount, interval) {
    const nextPaymentDate = this.calculateNextPaymentDate(interval);
    const recurringPayment = new RecurringPayment({ userId, merchantEmail, amount, interval, nextPaymentDate });
    await recurringPayment.save();
    return recurringPayment;
  }

  calculateNextPaymentDate(interval) {
    const now = new Date();
    switch (interval) {
      case 'daily':
        return new Date(now.setDate(now.getDate() + 1));
      case 'weekly':
        return new Date(now.setDate(now.getDate() + 7));
      case 'monthly':
        return new Date(now.setMonth(now.getMonth() + 1));
      default:
        throw new Error('Invalid interval');
    }
  }

  async processRecurringPayments() {
    const now = new Date();
    const payments = await RecurringPayment.find({ nextPaymentDate: { $lte: now } });
    for (const payment of payments) {
      // Process payment logic here
      payment.nextPaymentDate = this.calculateNextPaymentDate(payment.interval);
      await payment.save();
    }
  }
}

export const recurringPaymentService = new RecurringPaymentService();
