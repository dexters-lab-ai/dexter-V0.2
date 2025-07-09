import { BaseFlow } from './BaseFlow.js';
import { EventEmitter } from 'events';
import { priceAlertService } from '../../priceAlerts.js';
import { tokenInfoService } from '../../tokens/TokenInfoService.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class AlertFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['token', 'price', 'action', 'confirmation'];
  }

  async processStep(flowData, input) {
    try {
      const currentStep = flowData.currentStep || 0;

      switch (this.steps[currentStep]) {
        case 'token':
          return this.processTokenStep(input);
        case 'price':
          return this.processPriceStep(flowData, input);
        case 'action':
          return this.processActionStep(flowData, input);
        case 'confirmation':
          return this.processConfirmation(flowData, input);
        default:
          throw new Error('Invalid alert flow step');
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async processTokenStep(input) {
    const tokenInfo = await tokenInfoService.getTokenInfo(
      this.network,
      input.trim()
    );
    
    if (!tokenInfo) {
      throw new Error('Invalid token');
    }
  
    return {
      completed: false,
      nextStep: 'price',
      flowData: {
        currentStep: 1,
        token: tokenInfo
      },
      response: `What price would you like to be alerted at for ${tokenInfo.symbol}?`
    };
  }

  async processPriceStep(flowData, input) {
    const price = parseFloat(input);
    if (isNaN(price) || price <= 0) {
      throw new Error('Invalid price');
    }

    return {
      completed: false,
      nextStep: 'action',
      flowData: {
        ...flowData,
        currentStep: 2,
        price
      },
      response: 'Would you like to auto-trade when the alert triggers? (yes/no)'
    };
  }

  async processActionStep(flowData, input) {
    const autoTrade = input.toLowerCase() === 'yes';

    return {
      completed: false,
      nextStep: 'confirmation',
      flowData: {
        ...flowData,
        currentStep: 3,
        autoTrade
      },
      response: `Ready to create alert for ${flowData.token.symbol} at $${flowData.price}` +
                `${autoTrade ? ' with auto-trade' : ''}. Confirm? (yes/no)`
    };
  }

  async processConfirmation(flowData, input) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return {
        completed: true,
        response: 'Alert creation cancelled.'
      };
    }

    // Create alert
    const alert = await priceAlertService.createAlert(flowData.userId, {
      tokenAddress: flowData.token.address,
      targetPrice: flowData.price,
      autoTrade: flowData.autoTrade
    });

    return {
      completed: true,
      alert,
      response: `Alert created! You'll be notified when ${flowData.token.symbol} ` +
                `reaches $${flowData.price}`
    };
  }
}