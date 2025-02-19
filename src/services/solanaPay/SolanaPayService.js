import { EventEmitter } from 'events';
import { Connection, PublicKey } from '@solana/web3.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { PaymentSessionManager } from './PaymentSessionManager.js';
import { TransactionMonitor } from './TransactionMonitor.js';
import { WebSocketManager } from './WebSocketManager.js';
import { QRCodeGenerator } from './QRCodeGenerator.js';
import { ReferenceTracker } from './ReferenceTracker.js';
import { cleanupManager } from '../../core/cleanup.js';

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
    this.websocket = new WebSocketManager();
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
        this.websocket.initialize(),
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
    this.sessions.on('statusUpdate', ({ sessionId, status }) => {
      this.websocket.notifyClient(sessionId, { type: 'status', status });
    });

    // Handle transaction confirmations
    this.monitor.on('transactionConfirmed', async ({ sessionId, signature }) => {
      await this.sessions.updateStatus(sessionId, PaymentStatus.COMPLETED);
      this.websocket.notifyClient(sessionId, { 
        type: 'complete',
        signature 
      });
    });

    // Handle errors
    this.monitor.on('error', async ({ sessionId, error }) => {
      await this.sessions.updateStatus(sessionId, PaymentStatus.FAILED);
      this.websocket.notifyClient(sessionId, {
        type: 'error',
        error: error.message
      });
    });
  }

  async createPayment(amount, recipient, label = 'KATZ Payment', message = 'Thanks for your payment!') {
    // Pending Merchant Reg - takes some work
    return "Merchant offline, cant process Solana Payments right now. Contact support/dev guy";
    try {
      // Create payment session
      const session = await this.sessions.create({ amount });

      // Generate payment URL and QR code
      const { url, qrCode } = await this.qrGenerator.generate({
        recipient: new PublicKey(process.env.MERCHANT_WALLET), //change to recipient in future, so users point to merchants they wnt to pay to.
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
    this.websocket.cleanup();
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
// Removed the process.on handlers and register with cleanup manager
cleanupManager.registerService('solanaPay', () => solanaPayService.cleanup());