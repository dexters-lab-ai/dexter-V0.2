import { walletService } from '../wallet/index.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { EventEmitter } from 'events';
import { circuitBreakers } from '../../core/circuit-breaker/index.js';
import { BREAKER_CONFIGS } from '../../core/circuit-breaker/index.js';
import { ethers } from 'ethers';
import { getGasPrice as gsMaster } from '../wallet/wallets/evm.js';

const { BigNumber } = ethers;

class GasEstimationService extends EventEmitter {
  constructor() {
    super();
    this.gasPriceCache = new Map();
    this.cacheDuration = 30000; // 30 seconds
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await walletService.initialize();
      this.initialized = true;
      console.log('✅ GasEstimationService initialized');
    } catch (error) {
      console.error('❌ Error initializing GasEstimationService:', error);
      throw error;
    }
  }

  async getGasPrice(network) {
    if (!this.initialized) {
      await this.initialize();
    }
  
    const cached = this.gasPriceCache.get(network);
    if (cached && Date.now() - cached.timestamp < this.cacheDuration) {
      return cached.price;
    }
  
    return circuitBreakers.executeWithBreaker(
      network,
      async () => {
        try {
          let rawPrice;
          if (network === 'avalanche') {
            const feeState = await walletService.getAvalancheFeeState();
            // For Avalanche, convert feeState.price to a BigInt:
            rawPrice = BigInt(feeState.price);
          } else {
            const provider = await walletService.getProvider(network);
            rawPrice = await gsMaster(); // Returns an object with a 'price' property
          }
  
          // Normalize using our helper:
          const normalizedPrice = this.normalizeGasPrice(rawPrice, network);
  
          console.log(`🔥 Gas Price est for ${network}: ${this._formatTotalCost(normalizedPrice, network)}`);
  
          this.gasPriceCache.set(network, {
            price: normalizedPrice,
            timestamp: Date.now()
          });
  
          return normalizedPrice;
        } catch (error) {
          await ErrorHandler.handle(error);
          throw error;
        }
      },
      BREAKER_CONFIGS.network
    );
  }

  async getRecommendedGasPrices(network) {
    if (!this.initialized) {
      await this.initialize();
    }
  
    return circuitBreakers.executeWithBreaker(
      network,
      async () => {
        try {
          const basePrice = await this.getGasPrice(network);
          return {
            slow: basePrice,
            standard: (BigInt(basePrice) * BigInt(12) / BigInt(10)).toString(), // 1.2x
            fast: (BigInt(basePrice) * BigInt(15) / BigInt(10)).toString(),   // 1.5x
            timestamp: Date.now()
          };
        } catch (error) {
          await ErrorHandler.handle(error);
          throw error;
        }
      },
      BREAKER_CONFIGS.network
    );
  }
  
  async estimateGas(network, params) {
    if (!this.initialized) {
      await this.initialize();
    }
  
    return circuitBreakers.executeWithBreaker(
      network,
      async () => {
        try {
          const provider = await walletService.getProvider(network);
          const [gasEstimate, gasPrice] = await Promise.all([
            this._getGasEstimate(provider, network, params),
            this.getGasPrice(network)
          ]);
  
          const totalCost = gasEstimate * BigInt(gasPrice);
  
          return {
            gasLimit: gasEstimate.toString(),
            gasPrice: gasPrice,
            totalCost: totalCost.toString(),
            formatted: this._formatTotalCost(totalCost, network),
            network
          };
        } catch (error) {
          await ErrorHandler.handle(error);
          throw error;
        }
      },
      BREAKER_CONFIGS.network
    );
  }
  
  async _getGasEstimate(provider, network, params) {
    if (network === 'solana') {
      return BigInt(5000); // Placeholder, adjust based on actual usage
    }
    if (network === 'avalanche') {
      return BigInt(21000); // Avalanche uses static gas limits for transfers
    }
    return provider.estimateGas(params);
  }
  
  _formatTotalCost(totalCost, network) {
    if (network === 'solana') {
      return `${(Number(totalCost) / 1e9).toFixed(9)} SOL`;
    }
    if (network === 'avalanche') {
      return `${(Number(totalCost) / 1e9).toFixed(9)} AVAX`;
    }
    return `${(Number(totalCost) / 1e18).toFixed(18)} ETH`;
  }

  /**
   * Normalizes the raw gas price value into a plain numeric string.
   * For Avalanche (where raw is a BigInt), return raw.toString().
   * For other networks, if raw is an object with a 'price' property, return that property.
   * Otherwise, just use toString().
   */
  normalizeGasPrice(raw, network) {
    if (network === 'avalanche') {
      // For avalanche, raw is a BigInt.
      return raw.toString();
    }
    // If raw is a plain object and has a 'price' property, return that value.
    if (typeof raw === 'object' && raw !== null && 'price' in raw) {
      return raw.price;
    }
    // Otherwise, just call toString().
    return raw.toString();
  }
  
  cleanup() {
    this.gasPriceCache.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const gasEstimationService = new GasEstimationService();
