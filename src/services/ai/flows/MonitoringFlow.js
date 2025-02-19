import { BaseFlow } from './BaseFlow.js';
import { priceAlertService } from '../../priceAlerts.js';
import { timedOrderService } from '../../timedOrders.js';
import { flipperMode } from '../../pumpfun/FlipperMode.js';
import { dextools } from '../../dextools/index.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class MonitoringFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['type', 'configure', 'notifications', 'confirmation'];
  }

  async start(initialData) {
    return {
      currentStep: 0,
      data: initialData,
      response: 'What would you like to monitor?\n\n' +
                '1. Price Alerts\n' +
                '2. Timed Orders\n' +
                '3. Active Positions\n' +
                '4. All Activity'
    };
  }

  async processStep(state, input) {
    try {
      const currentStep = this.steps[state.currentStep];

      switch (currentStep) {
        case 'type':
          return await this.handleTypeSelection(input, state);
        case 'configure':
          return await this.handleConfiguration(input, state);
        case 'notifications':
          return await this.handleNotifications(input, state);
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

  async handleTypeSelection(input, state) {
    const types = ['alerts', 'orders', 'positions', 'all'];
    const type = types[parseInt(input) - 1];

    if (!type) {
      throw new Error('Invalid monitoring type selection');
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 1,
        type
      },
      response: await this.getConfigPrompt(type)
    };
  }

  async handleConfiguration(input, state) {
    const config = await this.parseConfig(input, state.type);

    // Get current status
    const status = await this.getCurrentStatus(state.type, state.userId);

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 2,
        config,
        status
      },
      response: this.getNotificationPrompt(state.type)
    };
  }

  async handleNotifications(input, state) {
    const notificationConfig = this.parseNotificationSettings(input);

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 3,
        notifications: notificationConfig
      },
      response: this.formatConfirmation(state)
    };
  }

  async handleConfirmation(input, state) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return this.cancel(state);
    }

    // Start monitoring based on type
    await this.startMonitoring(state);

    return this.complete(state);
  }

  async getConfigPrompt(type) {
    switch (type) {
      case 'alerts':
        return 'Enter alert configuration:\n' +
               'Format: <token_address> <price> <above|below>';
      case 'orders':
        return 'Enter order monitoring settings:\n' +
               'Format: <timeframe_minutes> <status_updates>';
      case 'positions':
        return 'Enter position monitoring settings:\n' +
               'Format: <update_frequency> <min_change_%>';
      case 'all':
        return 'Enter general monitoring settings:\n' +
               'Format: <update_frequency> <min_importance>';
      default:
        throw new Error('Invalid monitoring type');
    }
  }

  async getCurrentStatus(type, userId) {
    try {
      switch (type) {
        case 'alerts':
          return await priceAlertService.getActiveAlerts(userId);
        case 'orders':
          return await timedOrderService.getActiveOrders(userId);
        case 'positions':
          return await flipperMode.getOpenPositions();
        case 'all':
          return {
            alerts: await priceAlertService.getActiveAlerts(userId),
            orders: await timedOrderService.getActiveOrders(userId),
            positions: await flipperMode.getOpenPositions()
          };
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      return null;
    }
  }

  parseNotificationSettings(input) {
    const [channel, frequency] = input.split(' ');
    return {
      channel: channel || 'telegram',
      frequency: parseInt(frequency) || 5,
      enabled: true
    };
  }

  async startMonitoring(state) {
    try {
      switch (state.type) {
        case 'alerts':
          await priceAlertService.startMonitoring(
            state.userId,
            state.config,
            state.notifications
          );
          break;
        case 'orders':
          await timedOrderService.startMonitoring(
            state.userId,
            state.config,
            state.notifications
          );
          break;
        case 'positions':
          await flipperMode.startMonitoring(
            state.userId,
            state.config,
            state.notifications
          );
          break;
        case 'all':
          await Promise.all([
            priceAlertService.startMonitoring(state.userId, state.config),
            timedOrderService.startMonitoring(state.userId, state.config),
            flipperMode.startMonitoring(state.userId, state.config)
          ]);
          break;
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  formatConfirmation(state) {
    return `*Confirm Monitoring Setup* ✅\n\n` +
           `Type: ${state.type}\n` +
           `Configuration: ${JSON.stringify(state.config, null, 2)}\n` +
           `Notifications: ${JSON.stringify(state.notifications, null, 2)}\n\n` +
           `Type 'yes' to confirm or 'no' to cancel`;
  }
}