import { EventEmitter } from 'events';
import { dextools } from '../../dextools/index.js';
import { walletService } from '../../wallet/index.js';
import { solanaPayService } from '../../solanaPay/SolanaPayService.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class TokenAddressHandler extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
  }

  async handleTokenAddress(address, userId) {
    try {
      // Validate address format
      const network = this.detectNetwork(address);
      if (!network) {
        throw new Error('Invalid token address format');
      }

      // Get token info
      const tokenInfo = await dextools.getTokenInfo(network, address);
      
      // Format available actions
      const actions = await this.getAvailableActions(network, address, userId);

      return {
        token: tokenInfo,
        network,
        actions,
        message: this.formatResponse(tokenInfo, actions)
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  detectNetwork(address) {
    // Detect network from address format
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return 'ethereum'; // or 'base' - will need additional logic
    } else if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return 'solana';
    }
    return null;
  }

  async getAvailableActions(network, address, userId) {
    const actions = [];

    try {
      // Check if user has wallet for this network
      const hasWallet = await this.userHasWallet(userId, network);

      // Add available actions
      actions.push({
        type: 'scan',
        name: '🔍 Scan Token',
        description: 'Analyze token metrics and risks'
      });

      if (hasWallet) {
        actions.push({
          type: 'buy',
          name: '💰 Buy Token',
          description: 'Purchase this token'
        });

        const balance = await this.getTokenBalance(userId, network, address);
        if (balance > 0) {
          actions.push({
            type: 'sell',
            name: '💱 Sell Token',
            description: `Sell your ${balance} tokens`
          });
        }

        if (network === 'solana') {
          actions.push({
            type: 'solana_pay',
            name: '💸 Solana Pay',
            description: 'Send/receive using Solana Pay'
          });
        } else {
          actions.push({
            type: 'transfer',
            name: '📤 Transfer',
            description: 'Send tokens to another address'
          });
        }
      }

      return actions;
    } catch (error) {
      await ErrorHandler.handle(error);
      return actions; // Return whatever actions we collected
    }
  }

  async userHasWallet(userId, network) {
    try {
      const wallets = await walletService.getWallets(userId);
      return wallets.some(w => w.network === network);
    } catch (error) {
      return false;
    }
  }

  async getTokenBalance(userId, network, address) {
    try {
      const wallets = await walletService.getWallets(userId);
      const wallet = wallets.find(w => w.network === network);
      if (!wallet) return 0;

      const balance = await walletService.getTokenBalance(
        userId,
        wallet.address,
        address
      );
      return balance;
    } catch (error) {
      return 0;
    }
  }

  formatResponse(token, actions) {
    return `*Token Detected* 🪙\n\n` +
           `Symbol: ${token.symbol}\n` +
           `Network: ${token.network}\n` +
           `Price: $${token.price || 'Unknown'}\n\n` +
           `*Available Actions:*\n` +
           actions.map(action => 
             `• ${action.name}: ${action.description}`
           ).join('\n');
  }

  cleanup() {
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const tokenAddressHandler = new TokenAddressHandler();