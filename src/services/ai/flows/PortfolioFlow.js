import { BaseFlow } from './BaseFlow.js';
import { walletService } from '../../wallet/index.js';
import { tokenService } from '../../wallet/TokenService.js';
import { dextools } from '../../dextools/index.js';
import { networkState } from '../../networkState.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class PortfolioFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['view', 'details', 'actions', 'confirmation'];
  }

  async start(initialData) {
    return {
      currentStep: 0,
      data: initialData,
      response: 'Select portfolio view:\n\n' +
                '1. Overview\n' +
                '2. Token Details\n' +
                '3. Performance\n' +
                '4. Trade History'
    };
  }

  async processStep(state, input) {
    try {
      const currentStep = this.steps[state.currentStep];

      switch (currentStep) {
        case 'view':
          return await this.handleViewSelection(input, state);
        case 'details':
          return await this.handleDetails(input, state);
        case 'actions':
          return await this.handleActions(input, state);
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

  async handleViewSelection(input, state) {
    const views = ['overview', 'tokens', 'performance', 'history'];
    const view = views[parseInt(input) - 1];

    if (!view) {
      throw new Error('Invalid view selection');
    }

    const network = await networkState.getCurrentNetwork(state.userId);
    const wallets = await walletService.getWallets(state.userId);

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 1,
        view,
        network,
        wallets
      },
      response: await this.getViewData(view, network, wallets)
    };
  }

  async handleDetails(input, state) {
    if (input.toLowerCase() === 'back') {
      return {
        completed: true,
        response: 'Returning to main menu.'
      };
    }

    const details = await this.getTokenDetails(input, state);

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 2,
        selectedToken: details
      },
      response: this.formatActionPrompt(details)
    };
  }

  async handleActions(input, state) {
    if (input.toLowerCase() === 'back') {
      return await this.handleViewSelection('1', state);
    }

    const action = this.parseAction(input);
    if (!action) {
      throw new Error('Invalid action selection');
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 3,
        action
      },
      response: this.formatConfirmation(state.selectedToken, action)
    };
  }

  async handleConfirmation(input, state) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return this.cancel(state);
    }

    const result = await this.executeAction(state.action, state.selectedToken);
    return this.complete({
      ...state,
      result
    });
  }

  async getViewData(view, network, wallets) {
    try {
      switch (view) {
        case 'overview':
          return await this.getPortfolioOverview(wallets);
        case 'tokens':
          return await this.getTokenList(wallets, network);
        case 'performance':
          return await this.getPerformanceMetrics(wallets);
        case 'history':
          return await this.getTradeHistory(wallets);
        default:
          throw new Error('Invalid view type');
      }
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async getPortfolioOverview(wallets) {
    const overview = await Promise.all(
      wallets.map(async wallet => {
        const balance = await walletService.getBalance(wallet.userId, wallet.address);
        const tokens = await tokenService.getTokenBalances(wallet.network, wallet.address);
        return { wallet, balance, tokens };
      })
    );

    return this.formatPortfolioOverview(overview);
  }

  async getTokenList(wallets, network) {
    const tokens = [];
    for (const wallet of wallets) {
      if (wallet.network === network) {
        const balances = await tokenService.getTokenBalances(network, wallet.address);
        tokens.push(...balances);
      }
    }

    return this.formatTokenList(tokens);
  }

  async getPerformanceMetrics(wallets) {
    const metrics = await Promise.all(
      wallets.map(async wallet => {
        const trades = await walletService.getTradeHistory(wallet.userId);
        return this.calculatePerformance(trades);
      })
    );

    return this.formatPerformanceMetrics(metrics);
  }

  async getTradeHistory(wallets) {
    const history = await Promise.all(
      wallets.map(wallet => 
        walletService.getTradeHistory(wallet.userId)
      )
    );

    return this.formatTradeHistory(history.flat());
  }

  async getTokenDetails(tokenAddress, state) {
    const token = await tokenService.getTokenInfo(state.network, tokenAddress);
    const price = await dextools.getTokenPrice(state.network, tokenAddress);
    
    return {
      ...token,
      price,
      network: state.network
    };
  }

  parseAction(input) {
    const actions = {
      '1': 'trade',
      '2': 'transfer',
      '3': 'monitor'
    };
    return actions[input];
  }

  async executeAction(action, token) {
    switch (action) {
      case 'trade':
        return { type: 'trade', token };
      case 'transfer':
        return { type: 'transfer', token };
      case 'monitor':
        return { type: 'monitor', token };
      default:
        throw new Error('Invalid action');
    }
  }

  formatPortfolioOverview(overview) {
    return '*Portfolio Overview* 📊\n\n' +
           overview.map(({ wallet, balance, tokens }) =>
             `*${networkState.getNetworkDisplay(wallet.network)}*\n` +
             `Balance: ${balance}\n` +
             `Tokens: ${tokens.length}\n`
           ).join('\n');
  }

  formatTokenList(tokens) {
    return '*Token Holdings* 💰\n\n' +
           tokens.map(token =>
             `• ${token.symbol}: ${token.balance}\n` +
             `  Value: $${token.value}\n`
           ).join('\n');
  }

  formatPerformanceMetrics(metrics) {
    const totals = metrics.reduce((acc, m) => ({
      trades: acc.trades + m.totalTrades,
      profit: acc.profit + m.totalProfit,
      volume: acc.volume + m.totalVolume
    }), { trades: 0, profit: 0, volume: 0 });

    return '*Performance Metrics* 📈\n\n' +
           `Total Trades: ${totals.trades}\n` +
           `Total Profit: $${totals.profit.toFixed(2)}\n` +
           `Total Volume: $${totals.volume.toFixed(2)}`;
  }

  formatTradeHistory(trades) {
    return '*Trade History* 📜\n\n' +
           trades.map(trade =>
             `${trade.action} ${trade.amount} ${trade.symbol}\n` +
             `Price: $${trade.price}\n` +
             `Time: ${new Date(trade.timestamp).toLocaleString()}\n`
           ).join('\n');
  }

  formatActionPrompt(token) {
    return '*Available Actions* 🎯\n\n' +
           '1. Trade\n' +
           '2. Transfer\n' +
           '3. Monitor\n\n' +
           'Select an action or type "back":';
  }

  formatConfirmation(token, action) {
    return `*Confirm Action* ✅\n\n` +
           `Token: ${token.symbol}\n` +
           `Action: ${action}\n` +
           `Network: ${token.network}\n\n` +
           `Type 'yes' to confirm or 'no' to cancel`;
  }

  calculatePerformance(trades) {
    return trades.reduce((acc, trade) => ({
      totalTrades: acc.totalTrades + 1,
      totalProfit: acc.totalProfit + trade.profit,
      totalVolume: acc.totalVolume + trade.amount * trade.price
    }), { totalTrades: 0, totalProfit: 0, totalVolume: 0 });
  }
}