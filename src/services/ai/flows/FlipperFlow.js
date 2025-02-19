import { BaseFlow } from './BaseFlow.js';
import { flipperMode } from '../../pumpfun/FlipperMode.js';
import { walletService } from '../../wallet/index.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class FlipperFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['wallet', 'config', 'confirmation'];
  }

  async start(initialData) {
    return {
      currentStep: 0,
      data: initialData,
      response: 'Let\'s set up FlipperMode. First, please select or confirm your wallet:'
    };
  }

  async processStep(state, input) {
    try {
      const currentStep = this.steps[state.currentStep];

      switch (currentStep) {
        case 'wallet':
          return await this.handleWalletStep(input, state);
        case 'config':
          return await this.handleConfigStep(input, state);
        case 'confirmation':
          return await this.handleConfirmation(input, state);
        default:
          throw new Error('Invalid flow step');
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async handleWalletStep(input, state) {
    const wallet = await walletService.getWallet(state.userId, input);
    if (!wallet) {
      throw new Error('Invalid wallet address');
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 1,
        wallet
      },
      response: 'Enter FlipperMode configuration:\n' +
                'Format: <maxPositions> <profitTarget> <stopLoss> <timeLimit>\n' +
                'Example: 3 30 15 15 (3 positions, 30% TP, 15% SL, 15min limit)'
    };
  }

  async handleConfigStep(input, state) {
    const [maxPositions, profitTarget, stopLoss, timeLimit] = input.split(' ').map(Number);

    if (!maxPositions || !profitTarget || !stopLoss || !timeLimit) {
      throw new Error('Invalid configuration format');
    }

    const config = {
      maxPositions,
      profitTarget,
      stopLoss,
      timeLimit: timeLimit * 60 * 1000 // Convert to milliseconds
    };

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 2,
        config
      },
      response: this.formatConfirmation(state.wallet, config)
    };
  }

  async handleConfirmation(input, state) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return this.cancel(state);
    }

    const result = await flipperMode.start(
      state.userId,
      state.wallet.address,
      state.config
    );

    return this.complete({
      ...state,
      result
    });
  }

  formatConfirmation(wallet, config) {
    return `Please confirm FlipperMode settings:\n\n` +
           `Wallet: ${wallet.address}\n` +
           `Max Positions: ${config.maxPositions}\n` +
           `Take Profit: ${config.profitTarget}%\n` +
           `Stop Loss: ${config.stopLoss}%\n` +
           `Time Limit: ${config.timeLimit / 60000}min\n\n` +
           `Type 'yes' to confirm or 'no' to cancel`;
  }
}
