import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';
import { ErrorHandler } from '../../core/errors/index.js';

export class TransactionMonitor extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.monitoringIntervals = new Map();
  }

  async initialize(connection) {
    this.connection = connection;
    return true;
  }

  async startMonitoring(sessionId) {
    if (this.monitoringIntervals.has(sessionId)) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const signature = await this.findTransactionSignature(sessionId);
        if (signature) {
          await this.validateAndConfirm(sessionId, signature);
          this.stopMonitoring(sessionId);
        }
      } catch (error) {
        await ErrorHandler.handle(error);
        this.emit('error', { sessionId, error });
      }
    }, 1000);

    this.monitoringIntervals.set(sessionId, interval);
  }

  async findTransactionSignature(sessionId) {
    const signatures = await this.connection.getSignaturesForAddress(
      new PublicKey(sessionId),
      { limit: 1 }
    );
    return signatures[0]?.signature;
  }

  async validateAndConfirm(sessionId, signature) {
    const tx = await this.connection.getTransaction(signature);
    if (!tx) throw new Error('Transaction not found');

    // Add validation logic here

    this.emit('transactionConfirmed', { sessionId, signature });
  }

  stopMonitoring(sessionId) {
    const interval = this.monitoringIntervals.get(sessionId);
    if (interval) {
      clearInterval(interval);
      this.monitoringIntervals.delete(sessionId);
    }
  }

  cleanup() {
    for (const interval of this.monitoringIntervals.values()) {
      clearInterval(interval);
    }
    this.monitoringIntervals.clear();
    this.removeAllListeners();
  }
}