import { EventEmitter } from 'events';
import { Connection, PublicKey } from '@solana/web3.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { PaymentSessionManager } from './PaymentSessionManager.js';
import { TransactionMonitor } from './TransactionMonitor.js';

import { QRCodeGenerator } from './QRCodeGenerator.js';
import { ReferenceTracker } from './ReferenceTracker.js';
import { cleanupManager } from '../../core/cleanup.js';
import { merchantService } from '../../services/merchant/MerchantService.js';
import { notificationService } from '../../services/notification/NotificationService.js';

export const PaymentStatus = {
  INITIALIZED: 'initialized',
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

class SolanaPayService extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.initialized = false;
    
    // Initialize sub-modules
    this.sessions = new PaymentSessionManager();
    this.monitor = new TransactionMonitor();

    this.qrGenerator = new QRCodeGenerator();
    this.referenceTracker = new ReferenceTracker();
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Initialize Solana connection
      this.connection = new Connection(process.env.SOLANA_RPC_URL);

      // Initialize all sub-modules
      await Promise.all([
        this.sessions.initialize(),
        this.monitor.initialize(this.connection),

        this.qrGenerator.initialize(),
        this.referenceTracker.initialize()
      ]);

      // Set up event handlers
      this.setupEventHandlers();

      this.initialized = true;
      console.log('✅ SolanaPay service initialized');
    } catch (error) {
      console.error('❌ Error initializing SolanaPay service:', error);
      throw error;
    }
  }

  setupEventHandlers() {
    // Handle payment status updates
    this.sessions.on('statusUpdate', async ({ sessionId, status }) => {
      this.emit('paymentUpdate', { sessionId, data: { type: 'status', status } });
      const session = await this.sessions.getSession(sessionId);
      const merchant = await merchantService.getMerchantByEmail(session.merchantEmail);
      if (merchant) {
        await notificationService.sendEmail(merchant.email, 'Payment Status Update', `Your payment status is now ${status}`);
      }
    });

    // Handle transaction confirmations
    this.monitor.on('transactionConfirmed', async ({ sessionId, signature }) => {
      await this.sessions.updateStatus(sessionId, PaymentStatus.COMPLETED);
      this.emit('paymentUpdate', { sessionId, data: { type: 'complete', signature } });
      const session = await this.sessions.getSession(sessionId);
      const merchant = await merchantService.getMerchantByEmail(session.merchantEmail);
      if (merchant) {
        await notificationService.sendEmail(merchant.email, 'Payment Completed', `Your payment has been completed. Transaction ID: ${signature}`);
      }
    });

    // Handle errors
    this.monitor.on('error', async ({ sessionId, error }) => {
      await this.sessions.updateStatus(sessionId, PaymentStatus.FAILED);
      this.emit('paymentUpdate', { sessionId, data: { type: 'error', error: error.message } });
      const session = await this.sessions.getSession(sessionId);
      const merchant = await merchantService.getMerchantByEmail(session.merchantEmail);
      if (merchant) {
        await notificationService.sendEmail(merchant.email, 'Payment Failed', `Your payment has failed. Error: ${error.message}`);
      }
    });
  }

  async createPayment(amount, recipientEmail, label = 'KATZ! [O.P.E.R.A.T.O.R-TG] Payment', message = 'Thanks for your payment!') {
    try {
      // Fetch merchant details
      const merchant = await merchantService.getMerchantByEmail(recipientEmail);
      if (!merchant) {
        throw new Error('Merchant not found');
      }

      // Create payment session
      const session = await this.sessions.create({ amount });

      // Generate payment URL and QR code
      const { url, qrCode } = await this.qrGenerator.generate({
        recipient: new PublicKey(merchant.walletAddress),
        amount,
        reference: new PublicKey(session.id),
        label,
        message
      });

      // Start monitoring for payment
      await this.monitor.startMonitoring(session.id);

      return {
        sessionId: session.id,
        paymentUrl: url.toString(),
        qrCode,
        status: session.status
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async getPaymentStatus(sessionId) {
    return this.sessions.getStatus(sessionId);
  }

  async validatePayment(signature) {
    try {
      const tx = await this.connection.getTransaction(signature);
      if (!tx) throw new Error('Transaction not found');

      // Add validation logic here
      return {
        valid: true,
        amount: tx.meta?.postBalances[0] - tx.meta?.preBalances[0]
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  cleanup() {
    // Cleanup all sub-modules
    this.sessions.cleanup();
    this.monitor.cleanup();

    this.qrGenerator.cleanup();
    this.referenceTracker.cleanup();

    // Remove all listeners
    this.removeAllListeners();
    
    this.initialized = false;
    console.log('✅ SolanaPay service cleaned up');
  }
}

export const solanaPayService = new SolanaPayService();

// Initialize service
solanaPayService.initialize().catch(console.error);

// Handle cleanup on process termination
cleanupManager.registerService('solanaPay', async () => {
  await solanaPayService.cleanup();
  console.log('SolanaPayService cleanup complete.');
});

