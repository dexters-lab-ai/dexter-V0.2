import { BaseFlow } from './BaseFlow.js';
import { walletService } from '../../wallet/index.js';
import { tradeService } from '../../trading/TradeService.js';
import { networkState } from '../../networkState.js';
import { tokenInfoService } from '../../tokens/TokenInfoService.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class TradeFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['token', 'amount', 'confirmation'];
  }

  async start(initialData) {
    try {
      const input = initialData.naturalLanguageInput?.toLowerCase();
      if (!input) {
        return {
          currentStep: 0,
          data: initialData,
          response: 'Please enter the token address or symbol you want to trade:'
        };
      }

      // Check for multi-target trade patterns
      if (this.isMultiTargetTrade(input)) {
        return {
          completed: true,
          routeTo: 'multiTarget',
          data: initialData
        };
      }

      // Parse initial trade intent
      const parsedIntent = await this.parseTradeIntent(input);
      return {
        currentStep: 0,
        data: {
          ...initialData,
          ...parsedIntent
        },
        response: `Found ${parsedIntent.token.symbol}. Would you like to ${parsedIntent.action} ${parsedIntent.amount} ${parsedIntent.unit || parsedIntent.token.symbol}? (yes/no)`
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  isMultiTargetTrade(input) {
    const multiTargetPatterns = [
      /sell.*at.*[0-9]+x/i,                    // "sell at 2x"
      /sell.*(half|50%|quarter|25%)/i,         // "sell half" or "sell 50%"
      /sell.*rest/i,                           // "sell rest at"
      /(split|divide).*sell/i,                 // "split and sell"
      /sell.*(portion|part)/i,                 // "sell portion"
      /multiple.*(targets|prices)/i,           // "multiple targets"
      /sell.*at.*[0-9]+%.*increase/i,         // "sell at 50% increase"
      /sell.*when.*price.*[0-9]+%/i,          // "sell when price up 50%"
      /sell.*[0-9]+%.*at.*[0-9]+%/i           // "sell 50% at 50%"
    ];

    return multiTargetPatterns.some(pattern => pattern.test(input));
  }
  
  // Helper methods
  convertWordToAmount(word) {
    const wordMap = {
      'half': 0.5,
      'quarter': 0.25,
      'third': 0.333,
      'all': 1,
      'everything': 1,
      'full': 1,
      'entire': 1
    };
    return wordMap[word.toLowerCase()];
  }
  
  createPriceTarget(type, match) {
    switch(type) {
      case 'multiplier':
        return {
          type: 'multiplier',
          value: parseFloat(match[1]),
          relative: true
        };
      case 'percentage':
        return {
          type: 'percentage',
          value: parseFloat(match[1]) / 100,
          relative: true
        };
      case 'absolute':
        return {
          type: 'fixed',
          value: parseFloat(match[1]),
          relative: false
        };
      default:
        return null;
    }
  }
  
  parseTimeTarget(type, match) {
    const now = new Date();
    switch(type) {
      case 'specific':
        const [hours, minutes] = match[2].split(':').map(Number);
        return new Date(now.setHours(hours, minutes));
      case 'relative':
        const amount = parseInt(match[2]);
        const unit = match[3].toLowerCase();
        const ms = {
          minute: 60000,
          hour: 3600000,
          day: 86400000
        }[unit.replace(/s$/, '')] * amount;
        return new Date(now.getTime() + ms);
      case 'named':
        const dayMap = {
          'tomorrow': 1,
          'next week': 7
        };
        return new Date(now.setDate(now.getDate() + (dayMap[match[1]] || 0)));
      default:
        return null;
    }
  }

  async parseTradeIntent(input) {
    // Network patterns
    const networkPatterns = {
      ethereum: /(on|in|at|via)\s+(eth|ethereum)/i,
      base: /(on|in|at|via)\s+base/i,
      solana: /(on|in|at|via)\s+(sol|solana)/i
    };

    // Expanded patterns for amounts
    const amountPatterns = {
      numeric: /([0-9.]+)\s*(sol|usdc|$)?/i,
      words: /(half|quarter|third|all|everything|full|entire)/i,
      percentage: /([0-9.]+)%/i
    };
  
    // Expanded patterns for price targets
    const pricePatterns = {
      multiplier: /([0-9.]+)x/i,
      percentage: /([0-9.]+)%\s*(up|increase|gain|profit)/i,
      relative: /(current|entry)\s*price/i,
      absolute: /\$([0-9.]+)/i
    };
  
    // Time-based patterns
    const timePatterns = {
      specific: /(at|on)\s*([0-9]{1,2}:[0-9]{2})/i,
      relative: /(in|after)\s*([0-9]+)\s*(minutes?|hours?|days?)/i,
      named: /(tomorrow|today|next week)/i
    };
  
    // Extract initial action
    const action = input.match(/\b(buy|sell)\b/i)?.[1].toLowerCase();
    if (!action) throw new Error('No trade action found');
  
    // Extract amount
    let amount, unit;
    const numericMatch = input.match(amountPatterns.numeric);
    const wordMatch = input.match(amountPatterns.words);
    const percentMatch = input.match(amountPatterns.percentage);
  
    if (numericMatch) {
      amount = parseFloat(numericMatch[1]);
      unit = numericMatch[2]?.toUpperCase();
    } else if (wordMatch) {
      amount = this.convertWordToAmount(wordMatch[1]);
    } else if (percentMatch) {
      amount = parseFloat(percentMatch[1]) / 100;
    }
  
    // Extract token
    const tokenMatch = input.match(/\b(?:of|for)\s+([a-zA-Z0-9]+)\b/i);
    if (!tokenMatch) throw new Error('No token found');
    const token = await walletService.validateToken(tokenMatch[1]);
  
    // Extract targets
    const targets = [];
    
    // Check for price targets
    Object.entries(pricePatterns).forEach(([type, pattern]) => {
      const match = input.match(pattern);
      if (match) {
        targets.push(this.createPriceTarget(type, match));
      }
    });
  
    // Check for time-based execution
    let executeAt = null;
    Object.entries(timePatterns).forEach(([type, pattern]) => {
      const match = input.match(pattern);
      if (match) {
        executeAt = this.parseTimeTarget(type, match);
      }
    });
  
    return {
      action,
      amount,
      unit,
      token,
      targets,
      executeAt,
      isMultiTarget: targets.length > 0
    };
  }
  
  async processStep(state, input) {
    try {
      // Check if network switch is needed
      if (state.requestedNetwork) {
        const currentNetwork = await networkState.getCurrentNetwork(state.userId);
        
        if (currentNetwork !== state.requestedNetwork) {
          // Notify user about network switch
          this.emit('networkSwitch', {
            from: currentNetwork,
            to: state.requestedNetwork
          });
  
          // Switch network
          await networkState.setCurrentNetwork(state.userId, state.requestedNetwork);
  
          // Notify about completion
          this.emit('networkSwitched', {
            network: state.requestedNetwork
          });
        }
      }
  
      // Continue with normal flow processing
      const currentStep = this.steps[state.currentStep];
      switch (currentStep) {
        case 'token':
          return await this.processTokenStep(input, state);
        case 'amount':
          return await this.processAmountStep(input, state);
        case 'confirmation':
          return await this.processConfirmation(input, state);
        default:
          throw new Error('Invalid flow step');
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async processTokenStep(ctx, input, state) {
    try {
      // If token info is already available from natural language parsing
      if (state.token) {
        await ctx.reply(
          `Great! How much ${state.token.symbol} would you like to trade?`
        );
        return {
          completed: false,
          flowData: {
            ...state,
            currentStep: 1,
          },
        };
      }
  
      // Validate manual token input
      const network = await networkState.getCurrentNetwork(ctx.from.id);
      const tokenInfo = await tokenInfoService.validateToken(network, input);
  
      await ctx.reply(
        `Great! How much ${tokenInfo.symbol} would you like to trade?`
      );
  
      return {
        completed: false,
        flowData: {
          ...state,
          currentStep: 1,
          token: tokenInfo,
        },
      };
    } catch (error) {
      await ctx.reply(
        'Invalid token. Please provide a valid token address or symbol:',
        {
          reply_markup: {
            inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_trade' }]],
          },
        }
      );
  
      return {
        completed: false,
        flowData: state,
      };
    }
  }
  
  async processAmountStep(ctx, input, state) {
    // If amount is already available from natural language parsing
    if (state.amount) {
      await ctx.reply(this.formatConfirmation(state));
      return {
        completed: false,
        flowData: {
          ...state,
          currentStep: 2,
        },
      };
    }
  
    const amount = parseFloat(input);
  
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('Invalid amount. Please enter a valid number:', {
        reply_markup: {
          inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'cancel_trade' }]],
        },
      });
  
      return {
        completed: false,
        flowData: state,
      };
    }
  
    await ctx.reply(this.formatConfirmation({ ...state, amount }));
  
    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 2,
        amount,
      },
    };
  }  

  formatConfirmation(state) {
    const { action, amount, token, unit } = state;
    return `Ready to ${action} ${amount} ${unit || token.symbol} of ${token.symbol}. Confirm? (yes/no)`;
  }

  async processConfirmation(input, state) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return this.cancel(state);
    }

    // Execute trade
    const result = await tradeService.executeTrade({
      network: state.token.network,
      action: state.action,
      tokenAddress: state.token.address,
      amount: state.amount.toString(),
      walletAddress: state.walletAddress,
      options: {
        slippage: 1,
        autoApprove: true
      }
    });

    return this.complete({
      ...state,
      result
    });
  }
}