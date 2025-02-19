import { EventEmitter } from 'events';
import { twitterService } from '../../twitter/index.js';
import { dextools } from '../../dextools/index.js';
import { braveSearch } from '../../brave/BraveSearchService.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class DemoManager extends EventEmitter {
  constructor() {
    super();
    this.demos = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    
    try {
      // Register available demos
      this.registerDemos();
      this.initialized = true;
      console.log('✅ DemoManager initialized');
    } catch (error) {
      console.error('❌ Error initializing DemoManager:', error);
      throw error;
    }
  }

  registerDemos() {
    // Register demo capabilities
    this.demos.set('twitter_search', this.demoTwitterSearch.bind(this));
    this.demos.set('token_analysis', this.demoTokenAnalysis.bind(this));
    this.demos.set('news_search', this.demoNewsSearch.bind(this));
    this.demos.set('market_analysis', this.demoMarketAnalysis.bind(this));
  }

  async runRandomDemo() {
    const demos = Array.from(this.demos.keys());
    const randomDemo = demos[Math.floor(Math.random() * demos.length)];
    return this.runDemo(randomDemo);
  }

  async runDemo(demoType) {
    const demo = this.demos.get(demoType);
    if (!demo) throw new Error('Demo not found');
    
    return demo();
  }

  // Demo implementations
  async demoTwitterSearch() {
    try {
      const tweets = await twitterService.searchTweets('CHILLGUY');
      return {
        type: 'twitter_search',
        title: '🐦 Twitter Search Demo',
        description: 'Searching for trending crypto discussions...',
        results: tweets.slice(0, 3).map(tweet => ({
          text: tweet.text,
          author: tweet.author.username,
          stats: tweet.stats
        }))
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async demoTokenAnalysis() {
    try {
      const analysis = await dextools.formatTokenAnalysis(
        'solana',
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // USDC
      );
      return {
        type: 'token_analysis',
        title: '🔍 Token Analysis Demo',
        description: 'Analyzing token metrics and social data...',
        results: analysis
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async demoNewsSearch() {
    try {
      const news = await braveSearch.search('latest crypto news');
      return {
        type: 'news_search',
        title: '📰 News Search Demo',
        description: 'Fetching latest crypto news...',
        results: news.slice(0, 3)
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async demoMarketAnalysis() {
    try {
      const [eth, base, sol] = await Promise.all([
        dextools.fetchTrendingTokens('ethereum'),
        dextools.fetchTrendingTokens('base'),
        dextools.fetchTrendingTokens('solana')
      ]);

      return {
        type: 'market_analysis',
        title: '📊 Market Analysis Demo',
        description: 'Analyzing trending tokens across chains...',
        results: {
          ethereum: eth.slice(0, 3),
          base: base.slice(0, 3),
          solana: sol.slice(0, 3)
        }
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  cleanup() {
    this.demos.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const demoManager = new DemoManager();