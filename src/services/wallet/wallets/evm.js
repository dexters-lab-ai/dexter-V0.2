import Moralis from 'moralis';
import { ethers } from 'ethers';

// Mapping from our supported chain keys to Moralis chain identifiers.
const moralisChainMap = {
  "eth": "ethereum",
  "ethereum": "ethereum",
  "base": "base",
  "polygon": "polygon",
  "bsc": "bsc",
  "arbitrum": "arbitrum",
  "optimism": "optimism",
  "linea": "linear",          // Moralis "linea" is mapped to "linear"
  "avalanche": "avalanche",
  "mantle": "mantle",
  "polygon-zkevm": "zkevm",
  "zksync": "zksync",
  "fantom": "fantom",
  "flow": "flow",
  "pulse": "pulse",
};

/**
 * Get the current gas price for the given network using Moralis.
 * @param {string} chain - The chain key (e.g. "ethereum", "base", "avalanche", etc.)
 * @returns {Promise<{price: string, formatted: string}>} Gas price object.
 */
export async function getGasPrice(chain) {
  console.warn("--------------------------chain-----------------", chain)
  const moralisChain = moralisChainMap[chain.toLowerCase()];
  if (!moralisChain) {
    throw new Error(`Chain "${chain}" is not supported by Moralis.`);
  }
  // Query Moralis for gas price.
  const response = await Moralis.EvmApi.utils.getGasPrice({ chain: moralisChain });
  const gasPrice = response.raw.gasPrice;
  return {
    price: gasPrice.toString(),
    formatted: `${ethers.formatUnits(gasPrice, 'gwei')} Gwei`
  };
}

/**
 * Get the latest block number for the given network using Moralis.
 * @param {string} chain - The chain key (e.g. "ethereum", "base", "avalanche", etc.)
 * @returns {Promise<number>} Latest block number.
 */
export async function getBlockNumber(chain) {
  const moralisChain = moralisChainMap[chain.toLowerCase()];
  if (!moralisChain) {
    throw new Error(`Chain "${chain}" is not supported by Moralis.`);
  }
  // Query Moralis for the latest block.
  const response = await Moralis.EvmApi.block.getBlock({ chain: moralisChain, block_number_or_hash: "latest" });
  return parseInt(response.raw.number, 10);
}
