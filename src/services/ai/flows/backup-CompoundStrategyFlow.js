export class CompoundStrategyFlow extends BaseFlow {
  constructor() {
    super();
    // Add riskCheck as first step
    this.steps = ['riskCheck', 'scan', 'sentiment', 'trade', 'targets', 'confirmation'];
  }

  async start(initialData) {
    try {
      // Parse strategy from natural language
      const strategy = await this.parseStrategy(initialData.naturalLanguageInput);
      
      return {
        currentStep: 0,
        data: {
          ...initialData,
          strategy
        },
        response: 'Starting strategy execution with risk check...'
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async parseStrategy(input) {
    // Parse complex strategy from natural language
    const strategy = {
      token: input.match(/\$?([A-Z0-9]+)/i)?.[1], // Extract token symbol
      buyAmount: parseFloat(input.match(/buy\s+([\d.]+)\s*SOL/i)?.[1]), // Extract buy amount
      targets: this.parseTargets(input),
      stopLoss: parseFloat(input.match(/stop\s*loss\s*(?:of|at)?\s*([\d.]+)%/i)?.[1]), // Extract stop loss
      // Add risk limit parsing
      riskLimit: parseFloat(input.match(/risk\s*(?:less than|under|max|maximum)?\s*([\d.]+)%/i)?.[1]) || 10 // Default 10%
    };

    if (!strategy.token || !strategy.buyAmount || !strategy.targets || !strategy.stopLoss) {
      throw new Error('Invalid strategy format');
    }

    return strategy;
  }

  async processStep(state, input) {
    try {
      const currentStep = this.steps[state.currentStep];
      
      switch (currentStep) {
        case 'riskCheck':
          return await this.handleRiskCheck(state);
        case 'scan':
          return await this.handleScan(state);
        case 'sentiment':
          return await this.handleSentiment(state);
        case 'trade':
          return await this.handleTrade(state);
        case 'targets':
          return await this.handleTargets(state);
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

  async handleRiskCheck(state) {
    try {
      const { strategy, userId } = state;

      // Get portfolio value
      const portfolio = await walletService.getPortfolioValue(userId);
      
      // Calculate risk exposure
      const exposure = (strategy.buyAmount / portfolio.total) * 100;
      
      // Check against risk limit
      if (exposure > strategy.riskLimit) {
        return {
          completed: true,
          response: `❌ Trade cancelled: Would exceed risk limit of ${strategy.riskLimit}%\n` +
                   `Current exposure would be ${exposure.toFixed(2)}%\n` +
                   `Maximum trade size allowed: ${((portfolio.total * strategy.riskLimit) / 100).toFixed(2)} SOL`
        };
      }

      return {
        completed: false,
        flowData: {
          ...state,
          currentStep: 1,
          portfolio
        },
        response: 'Risk check passed. Starting token scan...'
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // Rest of existing methods remain unchanged
  parseTargets(input) {
    const targets = [];
    
    // Match "sell 50% at 2x"
    const matches = input.matchAll(/sell\s*([\d.]+)%?\s*(?:at|when)?\s*([\d.]+)x/gi);
    
    for (const match of matches) {
      targets.push({
        percentage: parseFloat(match[1]),
        multiplier: parseFloat(match[2])
      });
    }

    return targets;
  }

  async handleScan(state) {
    const { token } = state.strategy;
    
    // Get token info
    const tokenInfo = await tokenInfoService.getTokenInfo('solana', token);
    if (!tokenInfo) {
      throw new Error('Token not found');
    }

    // Get analysis
    const analysis = await tokenInfoService.getTokenAnalysis('solana', tokenInfo.address);

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 2,
        tokenInfo,
        analysis
      },
      response: 'Token analyzed. Checking sentiment...'
    };
  }

  async handleSentiment(state) {
    const tweets = await twitterService.searchTweets(state.tokenInfo.symbol);
    const sentiment = this.analyzeSentiment(tweets);
    
    // If not bullish, end flow
    if (sentiment.score < 60) {
      return {
        completed: true,
        response: 'Strategy cancelled: Sentiment not bullish enough.'
      };
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 3,
        sentiment
      },
      response: 'Sentiment is bullish. Preparing trade...'
    };
  }

  async handleTrade(state) {
    const { tokenInfo, strategy } = state;
    
    // Execute buy
    const tradeResult = await tradeService.executeTrade({
      network: 'solana',
      action: 'buy',
      tokenAddress: tokenInfo.address,
      amount: strategy.buyAmount,
      walletAddress: state.walletAddress
    });

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 4,
        tradeResult
      },
      response: 'Trade executed. Setting up targets...'
    };
  }

  async handleTargets(state) {
    const { tokenInfo, strategy, tradeResult } = state;
    
    // Create multi-target sell order
    const order = await timedOrderService.createAdvancedOrder(state.userId, {
      tokenAddress: tokenInfo.address,
      type: 'multi',
      targets: strategy.targets,
      stopLoss: strategy.stopLoss,
      entryPrice: tradeResult.price
    });

    // Create price alerts
    const alerts = await Promise.all(
      strategy.targets.map(target =>
        priceAlertService.createAlert(state.userId, {
          tokenAddress: tokenInfo.address,
          targetPrice: tradeResult.price * target.multiplier,
          condition: 'above'
        })
      )
    );

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 5,
        order,
        alerts
      },
      response: this.formatConfirmation(state)
    };
  }

  async handleConfirmation(input, state) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return this.cancel(state);
    }

    return this.complete(state);
  }

  analyzeSentiment(tweets) {
    const totalEngagement = tweets.reduce((sum, t) => 
      sum + t.stats.likes + t.stats.retweets, 0
    );
    
    const score = (totalEngagement / tweets.length) * 0.8;
    return {
      score,
      isBullish: score >= 60,
      tweets: tweets.length,
      engagement: totalEngagement
    };
  }

  formatConfirmation(state) {
    const { tokenInfo, strategy, tradeResult, order, alerts } = state;
    
    return `*Strategy Summary* ✅\n\n` +
           `Token: ${tokenInfo.symbol}\n` +
           `Entry: $${tradeResult.price}\n\n` +
           `Targets:\n` +
           strategy.targets.map((t, i) =>
             `${i+1}. Sell ${t.percentage}% at ${t.multiplier}x`
           ).join('\n') +
           `\nStop Loss: ${strategy.stopLoss}%\n` +
           `Risk Limit: ${strategy.riskLimit}%\n\n` +
           `Alerts set for:\n` +
           alerts.map(a => `• $${a.targetPrice}`).join('\n') +
           `\n\nConfirm strategy? (yes/no)`;
  }
}