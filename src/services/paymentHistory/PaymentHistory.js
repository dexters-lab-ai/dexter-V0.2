import { RecurringPayment } from '../../models/RecurringPayment.js';

class PaymentHistoryService {
  async getPaymentHistory(userId) {
    return await RecurringPayment.find({ userId });
  }

  async getMerchantPaymentHistory(merchantEmail) {
    return await RecurringPayment.find({ merchantEmail });
  }

  async exportPaymentHistory(userId, format = 'csv') {
    const payments = await this.getPaymentHistory(userId);
    if (format === 'csv') {
      return this.convertToCSV(payments);
    } else if (format === 'pdf') {
      return this.convertToPDF(payments);
    } else {
      throw new Error('Invalid format');
    }
  }

  convertToCSV(payments) {
    // Convert payments to CSV format
  }

  convertToPDF(payments) {
    // Convert payments to PDF format
  }
}

export const paymentHistoryService = new PaymentHistoryService();
