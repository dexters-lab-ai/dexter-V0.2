import PQueue from 'p-queue';
import { config } from '../../core/config.js';
import { EventEmitter } from 'events';
import axios from 'axios';
import { providers } from '../trading/providers/ProviderList.js';
import { tokenApprovalService } from '../../services/tokens/TokenApprovalService.js';
import { TransactionProcessor } from './processors/TransactionProcessor.js';
import { circuitBreakers, BREAKER_CONFIGS } from '../../core/circuit-breaker/index.js';
import { quickNodeService } from '../../services/quicknode/QuickNodeService.js';
import { ErrorHandler } from '../../core/errors/index.js';

/**
 * Returns dynamic network resources:
 *  - provider: retrieved from the providers mapping.
 *  - endpoint: from config using the `${network}Endpoint` key.
 *  - axiosInstance: using the endpoint.
 *
 * @param {string} network - Network name.
 * @returns {Object} { provider, endpoint, axiosInstance }
 */
function getNetworkResources(network) {
  const networkKey = network.toLowerCase();
  const provider = providers[networkKey];
  if (!provider) throw new Error(`No provider configured for network: ${network}`);
  const endpointKey = `${networkKey}Endpoint`;
  const endpoint = config[endpointKey];
  if (!endpoint) throw new Error(`No endpoint configured in config for network: ${network}`);
  const axiosInstance = axios.create({
    baseURL: endpoint,
    headers: { 'Content-Type': 'application/json' }
  });
  return { provider, endpoint, axiosInstance };
}

/**
 * Normalizes the network name to lower-case.
 * Extend this to support aliases if needed.
 *
 * @param {string} network
 * @returns {string}
 */
function normalizeNetwork(network) {
  if (!network) throw new Error('Network value is required');
  return network.toLowerCase();
}

class TransactionQueue extends EventEmitter {
  constructor() {
    super();

    // Dynamically create network-specific queues using all networks defined in config.
    this.queues = {};
    const defaultInterval = 1000; // ms
    const customIntervals = { solana: 500 }; // e.g. solana gets a faster interval
    for (const network of Object.keys(config.networks)) {
      const normalized = normalizeNetwork(network);
      const interval = customIntervals[normalized] || defaultInterval;
      this.queues[normalized] = new PQueue({
        concurrency: 1,
        interval,
        intervalCap: 1
      });
    }
    this.emit('queuesInitialized');

    // Instantiate a TransactionProcessor (encapsulating further processing logic)
    this.processor = new TransactionProcessor(this);

    // Map to track pending transactions.
    this.pendingTransactions = new Map();

    // (Gas price functionality removed)
  }

  /**
   * Returns the queue instance for the given network.
   * If a queue for that network doesn't exist, it is created on the fly.
   *
   * @param {string} network
   * @returns {PQueue}
   */
  getQueue(network) {
    const normalized = normalizeNetwork(network);
    if (!this.queues[normalized]) {
      this.queues[normalized] = new PQueue({
        concurrency: 1,
        interval: 1000,
        intervalCap: 1
      });
    }
    return this.queues[normalized];
  }

  /**
   * Adds a transaction to the appropriate network queue.
   * Validates the transaction and tracks its status.
   *
   * @param {Object} tx - Transaction object.
   */
  async addTransaction(tx) {
    this.validateTransaction(tx);
    const normalizedNetwork = normalizeNetwork(tx.network);
    // Mark the transaction as pending.
    this.pendingTransactions.set(tx.id, {
      ...tx,
      status: 'pending',
      addedAt: Date.now()
    });
    try {
      const result = await this.getQueue(normalizedNetwork).add(
        () => this.processTransaction(tx),
        { priority: tx.priority || 0 }
      );
      this._updateTransactionStatus(tx.id, 'complete', result);
      this.emit('transactionComplete', { id: tx.id, result });
      return result;
    } catch (error) {
      this._updateTransactionStatus(tx.id, 'failed', null, error.message);
      this.emit('transactionFailed', { id: tx.id, error });
      console.error(`❌ Error processing transaction ${tx.id}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validates that the transaction contains required properties 
   * and that its network is supported.
   *
   * @param {Object} tx - Transaction object.
   */
  validateTransaction(tx) {
    if (!tx.id || !tx.type || !tx.network || !tx.userId) {
      throw new Error('Invalid transaction format');
    }
    const normalized = normalizeNetwork(tx.network);
    if (!this.queues[normalized]) {
      throw new Error(`Unsupported network: ${tx.network}`);
    }
  }

  /**
   * Processes a transaction by:
   *  1. Simulating it via quickNodeService.
   *  2. Fetching an optimal priority fee.
   *  3. Preparing and sending the smart transaction.
   *
   * @param {Object} tx - Transaction object.
   */
  async processTransaction(tx) {
    try {
      // Simulate the transaction.
      const simulation = await quickNodeService.simulateTransaction(tx);
      if (!simulation.success) {
        throw new Error(`Simulation failed: ${simulation.error}`);
      }
      // Get optimal priority fee.
      const priorityFee = await quickNodeService.fetchEstimatePriorityFees();
      // Prepare the final smart transaction.
      const finalTx = await quickNodeService.prepareSmartTransaction({
        ...tx,
        priorityFee,
        options: { maxRetries: 3, skipPreflight: false }
      });
      // Execute the transaction.
      return await quickNodeService.sendSmartTransaction(finalTx);
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * Executes multiple orders by sorting them by priority and processing
   * them in batches of 3 sequentially.
   *
   * @param {Array} orders - Array of transaction orders.
   */
  async executeMultipleOrders(orders) {
    try {
      const sortedOrders = orders.sort((a, b) => b.priority - a.priority);
      const batches = [];
      for (let i = 0; i < sortedOrders.length; i += 3) {
        batches.push(sortedOrders.slice(i, i + 3));
      }
      const results = [];
      for (const batch of batches) {
        const batchResults = await Promise.all(
          batch.map(order => this.processTransaction(order))
        );
        results.push(...batchResults);
      }
      return results;
    } catch (error) {
      console.error('Error executing multiple orders:', error);
      throw error;
    }
  }

  /**
   * Updates the status of a pending transaction.
   *
   * @param {string} id - Transaction ID.
   * @param {string} status - New status.
   * @param {any} result - Result data (if any).
   * @param {string} [error] - Error message (if any).
   */
  _updateTransactionStatus(id, status, result = null, error = null) {
    const transaction = this.pendingTransactions.get(id);
    if (transaction) {
      this.pendingTransactions.set(id, {
        ...transaction,
        status,
        result,
        error,
        completedAt: Date.now()
      });
    }
  }

  /**
   * Returns the queue status for a given network.
   *
   * @param {string} network
   * @returns {Object} { pending, size }
   */
  getQueueStatus(network) {
    const normalized = normalizeNetwork(network);
    return {
      pending: this.queues[normalized]?.pending || 0,
      size: this.queues[normalized]?.size || 0,
    };
  }

  /**
   * Retrieves all pending transactions for a given user.
   *
   * @param {string|number} userId
   * @returns {Array} List of pending transactions.
   */
  getPendingTransactions(userId) {
    return Array.from(this.pendingTransactions.values()).filter(
      (tx) => tx.userId === userId && tx.status === 'pending'
    );
  }

  /**
   * Pauses the queue for the specified network.
   *
   * @param {string} network
   */
  pauseNetwork(network) {
    const normalized = normalizeNetwork(network);
    this.queues[normalized]?.pause();
    this.emit('queuePaused', { network: normalized });
    console.log(`⚠️ Queue paused for ${normalized}`);
  }

  /**
   * Resumes the queue for the specified network.
   *
   * @param {string} network
   */
  resumeNetwork(network) {
    const normalized = normalizeNetwork(network);
    this.queues[normalized]?.start();
    this.emit('queueResumed', { network: normalized });
    console.log(`✅ Queue resumed for ${normalized}`);
  }

  /**
   * Clears all queues, pending transactions.
   */
  cleanup() {
    Object.values(this.queues).forEach((queue) => queue.clear());
    this.pendingTransactions.clear();
    this.removeAllListeners();
    console.log('🧹 Transaction queues cleaned up');
  }

  /**
   * Performs a health check on all network providers.
   * Uses getNetworkResources to retrieve each provider and performs a simple test.
   *
   * @returns {Array} Health status for each network.
   */
  async checkHealth() {
    const results = [];
    for (const network of Object.keys(config.networks)) {
      const normalized = normalizeNetwork(network);
      try {
        const { provider } = getNetworkResources(normalized);
        // Basic health check: if provider supports getBlockNumber, try calling it.
        if (typeof provider.getBlockNumber === 'function') {
          await provider.getBlockNumber();
        }
        results.push({ network: normalized, status: 'healthy' });
      } catch (error) {
        results.push({ network: normalized, status: 'unhealthy', error: error.message });
        console.error(`❌ Health check failed for ${normalized}: ${error.message}`);
      }
    }
    return results;
  }
}

export const transactionQueue = new TransactionQueue();

/** Clean up on process exit */
process.on('SIGINT', () => transactionQueue.cleanup());
process.on('SIGTERM', () => transactionQueue.cleanup());
