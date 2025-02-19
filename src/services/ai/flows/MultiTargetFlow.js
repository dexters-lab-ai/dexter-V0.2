import { BaseFlow } from './BaseFlow.js';
import { walletService } from '../../wallet/index.js';
import { timedOrderService } from '../../timedOrders.js';
import { tokenInfoService } from '../../tokens/TokenInfoService.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { networkState } from '../../networkState.js';

export class MultiTargetFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['token', 'amount', 'targets', 'confirmation'];
  }

  async start(initialData = {}) {
    return {
      currentStep: 0,
      data: initialData,
      response: 'Please enter the token address or symbol you want to trade:',
    };
  }

  async processStep(state, input) {
    try {
      const currentStep = this.steps[state.currentStep];

      switch (currentStep) {
        case 'token':
          return this.processTokenStep(input, state);
        case 'amount':
          return this.processAmountStep(input, state);
        case 'targets':
          return this.processTargetsStep(input, state);
        case 'confirmation':
          return this.processConfirmation(input, state);
        default:
          throw new Error('Invalid flow step');
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      return {
        completed: false,
        flowData: state,
        response: 'An error occurred. Please try again or restart the process.',
      };
    }
  }

  async processTokenStep(input, state) {
    try {
      const network = await networkState.getCurrentNetwork(state.userId);

      // Handle token validation
      const tokenInfo = await tokenInfoService.validateToken(network, input.trim());
      if (!tokenInfo) {
        return this.retryStep(state, 'Invalid token. Please provide a valid token address or symbol:');
      }

      return {
        completed: false,
        flowData: {
          ...state,
          currentStep: 1,
          token: tokenInfo,
        },
        response: `Found ${tokenInfo.symbol}. How much would you like to trade initially?`,
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      return this.retryStep(state, 'Error validating token. Please try again:');
    }
  }

  async processAmountStep(input, state) {
    const amount = parseFloat(input);
    if (isNaN(amount) || amount <= 0) {
      return this.retryStep(state, 'Invalid amount. Please enter a valid number greater than 0:');
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 2,
        amount,
      },
      response: `Enter your take-profit targets in this format:\n\n` +
                `50% at 2x, 25% at 3x, 25% at 5x\n` +
                `Or simply: 2x, 3x, 5x for equal splits`,
    };
  }

  async processTargetsStep(input, state) {
    try {
      const targets = this.parseTargets(input);
      if (!targets || targets.length === 0) {
        return this.retryStep(state, 'Invalid targets format. Please try again:');
      }

      return {
        completed: false,
        flowData: {
          ...state,
          currentStep: 3,
          targets,
        },
        response: this.formatConfirmation(state, targets),
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      return this.retryStep(state, 'Error parsing targets. Please ensure the format is correct:');
    }
  }

  async processConfirmation(input, state) {
    const confirmed = input.toLowerCase() === 'yes';

    if (!confirmed) {
      return this.cancel(state, 'Order cancelled. If you want to start over, type `/start`.');
    }

    try {
      const orders = await Promise.all(
        state.targets.map(target =>
          timedOrderService.createOrder(state.userId, {
            tokenAddress: state.token.address,
            network: state.token.network,
            action: 'sell',
            amount: `${target.percentage}%`,
            conditions: {
              targetPrice: target.multiplier * state.token.price,
            },
          })
        )
      );

      return this.complete({
        ...state,
        orders,
      });
    } catch (error) {
      await ErrorHandler.handle(error);
      return this.retryStep(state, 'Error creating orders. Please try again:');
    }
  }

  parseTargets(input) {
    if (input.includes('%')) {
      return input.split(',').map(target => {
        const [percentage, multiplier] = target.trim().split(' at ');
        return {
          percentage: parseFloat(percentage),
          multiplier: parseFloat(multiplier.replace('x', '')),
        };
      });
    }

    const multipliers = input.split(',').map(x => parseFloat(x.trim().replace('x', '')));
    const percentage = 100 / multipliers.length;

    return multipliers.map(multiplier => ({
      percentage,
      multiplier,
    }));
  }

  formatConfirmation(state, targets) {
    return `Please confirm your multi-target order:\n\n` +
           `Token: ${state.token.symbol}\n` +
           `Initial Buy: ${state.amount} ${state.token.symbol}\n\n` +
           `Targets:\n` +
           targets.map(t => `• Sell ${t.percentage}% at ${t.multiplier}x`).join('\n') +
           `\n\nType 'yes' to confirm or 'no' to cancel.`;
  }

  retryStep(state, response) {
    return {
      completed: false,
      flowData: state,
      response,
      keyboard: {
        inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_order' }]],
      },
    };
  }

  cancel(state, response) {
    return {
      completed: true,
      flowData: state,
      response,
    };
  }

  complete(state) {
    return {
      completed: true,
      flowData: state,
      response: 'Order created successfully!',
    };
  }
}
