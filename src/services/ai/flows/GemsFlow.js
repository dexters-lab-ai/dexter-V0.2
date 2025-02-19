import { BaseFlow } from './BaseFlow.js';
import { gemsService } from '../../gems/GemsService.js';
import { dextools } from '../../dextools/index.js';
import { twitterService } from '../../twitter/index.js';
import { tradeService } from '../../trading/TradeService.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class GemsFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['scan', 'analyze', 'social', 'trade', 'confirmation'];
  }

  async start(initialData) {
    return {
      currentStep: 0,
      data: initialData,
      response: 'Starting gem scan...'
    };
  }

  async processStep(state, input) {
    try {
      const currentStep = this.steps[state.currentStep];

      switch (currentStep) {
        case 'scan':
          return await this.handleScan(state);
        case 'analyze':
          return await this.handleAnalysis(input, state);
        case 'social':
          return await this.handleSocialAnalysis(state);
        case 'trade':
          return await this.handleTradeSetup(input, state);
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

  async handleScan(state) {
    const gems = await gemsService.scanGems();
    if (!gems?.length) {
      return {
        completed: true,
        response: 'No gems found at the moment. Try again later.'
      };
    }

    // Sort by rating and get top 5
    const topGems = gems
      .sort((a, b) => b.metrics.rating - a.metrics.rating)
      .slice(0, 5);

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 1,
        gems: topGems
      },
      response: this.formatGemsList(topGems)
    };
  }

  async handleAnalysis(input, state) {
    const selectedIndex = parseInt(input) - 1;
    if (isNaN(selectedIndex) || !state.gems[selectedIndex]) {
      throw new Error('Invalid gem selection');
    }

    const gem = state.gems[selectedIndex];
    const analysis = await dextools.formatTokenAnalysis(
      gem.network,
      gem.address
    );

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 2,
        selectedGem: gem,
        analysis
      },
      response: `${analysis}\n\nAnalyzing social metrics...`
    };
  }

  async handleSocialAnalysis(state) {
    const { selectedGem } = state;
    const tweets = await twitterService.searchTweets(selectedGem.symbol);
    
    const socialMetrics = {
      tweetCount: tweets.length,
      engagement: tweets.reduce((sum, t) => sum + t.stats.likes + t.stats.retweets, 0),
      sentiment: this.calculateSentiment(tweets)
    };

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 3,
        socialMetrics
      },
      response: this.formatTradePrompt(selectedGem, socialMetrics)
    };
  }

  async handleTradeSetup(input, state) {
    if (input.toLowerCase() === 'no') {
      return {
        completed: true,
        response: 'Maybe next time! Let me know if you want to scan more gems.'
      };
    }

    const amount = this.parseTradeAmount(input);
    if (!amount) {
      throw new Error('Invalid trade amount');
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 4,
        tradeAmount: amount
      },
      response: this.formatConfirmation(state.selectedGem, amount)
    };
  }

  async handleConfirmation(input, state) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return this.cancel(state);
    }

    const result = await tradeService.executeTrade({
      network: state.selectedGem.network,
      action: 'buy',
      tokenAddress: state.selectedGem.address,
      amount: state.tradeAmount.toString(),
      walletAddress: null,
    });

    return this.complete({
      ...state,
      result
    });
  }

  formatGemsList(gems) {
    return '*Today\'s Top Gems* 💎\n\n' +
           gems.map((gem, i) => 
             `${i + 1}. *${gem.symbol}*\n` +
             `• Rating: ${gem.metrics.rating}/10\n` +
             `• Network: ${gem.network}\n` +
             `• Social Interest: ${this.formatSocialMetrics(gem.metrics)}\n`
           ).join('\n') +
           '\nEnter a number (1-5) to analyze a gem:';
  }

  formatSocialMetrics(metrics) {
    return `👁 ${metrics.impressions} | ♥️ ${metrics.likes} | 🔄 ${metrics.retweets}`;
  }

  calculateSentiment(tweets) {
    // Simple sentiment calculation
    const total = tweets.reduce((sum, t) => {
      const engagement = t.stats.likes + t.stats.retweets;
      return sum + engagement;
    }, 0);
    return total / tweets.length;
  }

  formatTradePrompt(gem, socialMetrics) {
    return `*Social Analysis* 📊\n\n` +
           `• Tweets: ${socialMetrics.tweetCount}\n` +
           `• Engagement: ${socialMetrics.engagement}\n` +
           `• Sentiment: ${socialMetrics.sentiment > 50 ? '🟢 Positive' : '🔴 Negative'}\n\n` +
           `Would you like to trade this gem?\n` +
           `Enter amount in SOL or 'no' to cancel:`;
  }

  formatConfirmation(gem, amount) {
    return `*Confirm Trade* ✅\n\n` +
           `Token: ${gem.symbol}\n` +
           `Amount: ${amount} SOL\n` +
           `Network: ${gem.network}\n\n` +
           `Type 'yes' to confirm or 'no' to cancel`;
  }

  parseTradeAmount(input) {
    const amount = parseFloat(input);
    return !isNaN(amount) && amount > 0 ? amount : null;
  }
}