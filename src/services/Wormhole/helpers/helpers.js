// wormhole/helpers/helpers.js

import { Wormhole, amount } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import { config } from "../../../core/config.js";
import { providers } from "../../trading/providers/ProviderList.js";

/**
 * Maps provider network names to Wormhole chain names
 */
const getWormholeChainName = (network) => {
  const provider = providers[network];
  if (!provider?.wormholeEnabled) {
    throw new Error(`Network ${network} is not supported by Wormhole`);
  }
  // Capitalize first letter for Wormhole's expected format
  return network.charAt(0).toUpperCase() + network.slice(1);
};

/**
 * Get signer configuration from provider settings
 */
const getSignerConfig = (network) => {
  const provider = providers[network];
  if (!provider?.wormholeEnabled) {
    throw new Error(`Network ${network} is not Wormhole enabled`);
  }

  // Get private key from config based on network
  const privateKey = config.wormholeKey[network];
  if (!privateKey) {
    throw new Error(`No private key configured for network: ${network}`);
  }

  return {
    privateKey,
    rpcUrl: provider.rpcUrl,
    chainId: provider.chainId,
    // Add any other provider-specific settings
    settings: provider.wormholeSettings || {}
  };
};

/**
 * getSigner
 * @param {ChainContext} chain - The Wormhole chain context
 * @param {string} userId - Optional user ID to get user-specific wallet
 * @returns {Promise<{ chain, signer, address }>}
 */
export async function getSigner(chain, userId = null) {
  // Get network name from chain context
  const network = chain.chain.toString().toLowerCase();
  
  try {
    // Get signer config from provider
    const signerConfig = getSignerConfig(network);

    // Get user's wallet if userId provided
    let privateKey = signerConfig.privateKey;
    if (userId) {
      const userWallet = await getUserWallet(userId, network);
      if (userWallet?.privateKey) {
        privateKey = userWallet.privateKey;
      }
    }

    // Create platform-specific signer
    let signer;
    if (network === 'solana') {
      signer = await solana.getSigner(
        await chain.getRpc(), 
        privateKey,
        {
          debug: true,
          priorityFee: signerConfig.settings.priorityFee || {
            percentile: 0.5,
            percentileMultiple: 2,
            min: 1,
            max: 1000
          }
        }
      );
    } else {
      // Default to EVM signer for all other chains
      signer = await evm.getSigner(
        await chain.getRpc(),
        privateKey,
        {
          debug: true,
          maxGasLimit: amount.units(amount.parse("0.01", 18)),
          ...signerConfig.settings
        }
      );
    }

    return {
      chain,
      signer,
      address: Wormhole.chainAddress(chain.chain, signer.address())
    };

  } catch (error) {
    console.error(`Failed to get signer for ${network}:`, error);
    throw error;
  }
}

/**
 * Get user's wallet for specified network
 */
async function getUserWallet(userId, network) {
  // Implementation to fetch user's wallet from your system
  // This could query your database or wallet management service
  return null; // Return null to fallback to default wallet
}

// Export utility functions
export {
  getWormholeChainName,
  getSignerConfig
};
