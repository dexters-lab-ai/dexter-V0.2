import { BaseFlow } from './BaseFlow.js';
import { twitterService } from '../../twitter/index.js';
import { User } from '../../../models/User.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class KOLMonitorFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['twitter_handle', 'trade_amount', 'confirmation'];
  }

  async start(initialData = {}) {
    return {
      currentStep: 0,
      data: initialData,
      response: 'Please enter the Twitter handle of the KOL you want to monitor (e.g. @example):'
    };
  }

  async processStep(state, input) {
    try {
      const currentStep = this.steps[state.currentStep];

      switch (currentStep) {
        case 'twitter_handle':
          return this.processHandleStep(input, state);
        case 'trade_amount':
          return this.processAmountStep(input, state);
        case 'confirmation':
          return this.processConfirmation(input, state);
        default:
          throw new Error('Invalid flow step');
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async processHandleStep(input, state) {
    const handle = input.startsWith('@') ? input.substring(1) : input;
    
    // Validate Twitter handle exists
    const isValid = await twitterService.validateHandle(handle);
    if (!isValid) {
      throw new Error('Invalid Twitter handle');
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 1,
        handle
      },
      response: 'How much SOL would you like to allocate per trade when this KOL mentions a token?'
    };
  }

  async processAmountStep(input, state) {
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Invalid amount');
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 2,
        amount
      },
      response: this.formatConfirmation(state.handle, amount)
    };
  }

  async processConfirmation(input, state) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return this.cancel(state);
    }

    // Save KOL monitoring settings
    await User.updateOne(
      { telegramId: state.userId.toString() },
      {
        $push: {
          'settings.kol.monitors': {
            handle: state.handle,
            amount: state.amount,
            enabled: true,
            createdAt: new Date()
          }
        }
      }
    );

    // Start monitoring
    await twitterService.startKOLMonitoring(state.userId, state.handle);

    return this.complete(state);
  }

  formatConfirmation(handle, amount) {
    return `Please confirm KOL monitoring setup:\n\n` +
           `Twitter Handle: @${handle}\n` +
           `Amount per Trade: ${amount} SOL\n\n` +
           `I will automatically buy tokens mentioned by @${handle} using ${amount} SOL.\n` +
           `Only tweets containing both a token symbol/name AND contract address will trigger trades.\n\n` +
           `Type 'yes' to confirm or 'no' to cancel`;
  }
}