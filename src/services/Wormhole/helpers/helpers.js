import { Wormhole, amount } from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import { config } from "../../../core/config.js";
import dotenv from "dotenv";
dotenv.config(); // load .env into process.env

/**
 * getEnv
 * Helper to fetch environment variables or throw if missing
 */
function getEnv(key) {
  const val = config.wormholeKey[key];
  if (!val) {
    throw new Error(`Missing env var: ${key}. Did you set it in .env or config.js?`);
  }
  return val;
}

/**
 * getSigner
 * @param {ChainContext} chain - The Wormhole chain context (EVM or Solana)
 * @returns {Promise<{ chain, signer, address }>}
 */
export async function getSigner(chain) {
  // Identify the platform
  const platform = chain.platform.utils()._platform; // "Solana" or "Evm"

  let signer;
  switch (platform) {
    case "Solana": {
      const solPrivateKey = getEnv("SOL_PRIVATE_KEY");
      signer = await solana.getSigner(await chain.getRpc(), solPrivateKey, {
        debug: true,
        priorityFee: {
          percentile: 0.5,
          percentileMultiple: 2,
          min: 1,
          max: 1000
        }
      });
      break;
    }
    case "Evm": {
      // For EVM, store private key in process.env.ETH_PRIVATE_KEY
      const ethPrivateKey = getEnv("ETH_PRIVATE_KEY");
      signer = await evm.getSigner(await chain.getRpc(), ethPrivateKey, {
        debug: true,
        // optional gas limit constraints
        maxGasLimit: amount.units(amount.parse("0.01", 18))
      });
      break;
    }
    default: {
      throw new Error(`Unsupported platform in getSigner: ${platform}`);
    }
  }

  return {
    chain,
    signer,
    address: Wormhole.chainAddress(chain.chain, signer.address())
  };
}
