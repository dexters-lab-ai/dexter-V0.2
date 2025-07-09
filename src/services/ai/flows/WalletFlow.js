import { BaseFlow } from './BaseFlow.js';
import { walletService } from '../../wallet/index.js';
import { networkState } from '../../networkState.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class WalletFlow extends BaseFlow {
  constructor() {
    super();
    this.steps = ['network', 'type', 'autonomous', 'confirmation'];
  }

  async start(initialData) {
    return {
      currentStep: 0,
      data: initialData,
      response: 'Let\'s set up your wallet. First, select a network:\n\n' +
                '1. Ethereum\n2. Base\n3. Solana'
    };
  }

  async processStep(state, input) {
    try {
      const currentStep = this.steps[state.currentStep];

      switch (currentStep) {
        case 'network':
          return await this.handleNetworkSelection(input, state);
        case 'type':
          return await this.handleWalletType(input, state);
        case 'autonomous':
          return await this.handleAutonomousSetting(input, state);
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

  async handleNetworkSelection(input, state) {
    const networks = { '1': 'ethereum', '2': 'base', '3': 'solana' };
    const network = networks[input];
    
    if (!network) {
      throw new Error('Invalid network selection');
    }

    await networkState.setCurrentNetwork(state.userId, network);

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 1,
        network
      },
      response: 'Choose wallet type:\n\n1. Create New\n2. Import Existing'
    };
  }

  async handleWalletType(input, state) {
    const isCreate = input === '1';
    let wallet;

    if (isCreate) {
      wallet = await walletService.createWallet(state.userId, state.network);
    } else if (input === '2') {
      return {
        completed: false,
        flowData: {
          ...state,
          currentStep: 1,
          waitingForMnemonic: true
        },
        response: 'Please enter your recovery phrase or private key:'
      };
    } else {
      throw new Error('Invalid wallet type selection');
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 2,
        wallet
      },
      response: 'Enable autonomous trading for this wallet? (yes/no)'
    };
  }

  async handleAutonomousSetting(input, state) {
    const isAutonomous = input.toLowerCase() === 'yes';

    if (isAutonomous) {
      await walletService.setAutonomousWallet(state.userId, state.wallet.address);
    }

    return {
      completed: false,
      flowData: {
        ...state,
        currentStep: 3,
        isAutonomous
      },
      response: this.formatConfirmation(state.wallet, state.network, isAutonomous)
    };
  }

  async handleConfirmation(input, state) {
    const confirmed = input.toLowerCase() === 'yes';
    
    if (!confirmed) {
      return this.cancel(state);
    }

    return this.complete(state);
  }

  formatConfirmation(wallet, network, isAutonomous) {
    return `Please confirm wallet setup:\n\n` +
           `Network: ${networkState.getNetworkDisplay(network)}\n` +
           `Address: ${wallet.address}\n` +
           `Autonomous: ${isAutonomous ? 'Yes' : 'No'}\n\n` +
           `Type 'yes' to confirm or 'no' to cancel`;
  }
}