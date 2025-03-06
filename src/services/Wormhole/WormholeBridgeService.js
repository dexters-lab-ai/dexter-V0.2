/****************************************************
 * WormholeBridgeService.js
 ****************************************************/
import { v4 as uuidv4 } from "uuid";
import {
  wormhole,
  Wormhole,
  routes,
  canonicalAddress
} from "@wormhole-foundation/sdk";
import evm from "@wormhole-foundation/sdk/evm";
import solana from "@wormhole-foundation/sdk/solana";
import { User } from "../../models/User.js";
import { getSigner } from "./helpers/index.js";
import { providers } from "../trading/providers/ProviderList.js";

/**
 * chainMap
 * Maps user-friendly chain names -> Wormhole's internal names.
 */
const chainMap = Object.entries(providers).reduce((acc, [network, provider]) => {
  // Only include networks that support Wormhole bridging
  if (provider.wormholeEnabled) {
    // Map network names to Wormhole's expected format (capitalize first letter)
    const wormholeChainName = network.charAt(0).toUpperCase() + network.slice(1);
    acc[network] = wormholeChainName;
  }
  return acc;
}, {});


/**
 * tokenSymbolMap
 * For each chain, we define known token symbols => actual token addresses.
 */
export const tokenSymbolMap = {
  // --------------------------------------------------
  // 1) Solana (Not EVM, but specifically requested)
  // --------------------------------------------------
  solana: {
    wSOL: "So11111111111111111111111111111111111111112", 
    // Primary stable on Solana is usually USDC (via SPL)
    USDC: "Es9vMFrzrDdrn9T2pdr9z2hp3yDAm7tFkb6P6hUEh5iq",
  },

  // --------------------------------------------------
  // 2) Ethereum (chainId: 1)
  // --------------------------------------------------
  ethereum: {
    // Wrapped ETH
    WETH:  "0xC02aaA39b223FE8D0A0e5C4F27eAd9083C756Cc2",
    // USDC
    USDC:  "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  },

  // --------------------------------------------------
  // 4) BSC (Binance Smart Chain)
  // --------------------------------------------------
  bsc: {
    // Wrapped BNB (WBNB)
    WBNB:  "0xbb4CdB9CBd36B01BD1cBaEBF2De08d9173bc095c",
    // BSC does have bridged USDC
    USDC:  "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
  },

  // --------------------------------------------------
  // 5) Polygon
  // --------------------------------------------------
  polygon: {
    // Wrapped MATIC
    WMATIC: "0x0d500B1d8E8EF31E21C99d1Db9A6444d3ADf1270",
    // USDC on Polygon
    USDC:   "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
  },

  // --------------------------------------------------
  // 6) Avalanche
  // --------------------------------------------------
  avalanche: {
    // Wrapped AVAX
    WAVAX:  "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    // USDC on Avalanche
    USDC:   "0xB97EF9ef8734C71904D8002F8b6BC66Dd9c48a6E",
  },

  // --------------------------------------------------
  // 9) Aurora
  // --------------------------------------------------
  aurora: {
    // Wrapped ETH on Aurora
    WETH: "0xC9BdeEd33CD01541e1eeD10f90519d2C06Fe3feB",
    // USDC on Aurora
    USDC: "0xB12BFcA5A55806AaF64E99521918A4bf0fC40802",
  },

  // --------------------------------------------------
  // 10) Fantom
  // --------------------------------------------------
  fantom: {
    // Wrapped FTM
    WFTM: "0x21be370d5312f44cb42ce377bc9b8a0cef1a4c83",
    // Native USDC on Fantom
    USDC: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75",
  },

  // --------------------------------------------------
  // 14) Celo
  // --------------------------------------------------
  celo: {
    // Wrapped CELO
    WCELO: "0x471EcE3750Da237f93B8E339c536989b8978a438",
    // USDC on Celo
    USDC:  "0x37f750b7cc259a2f741af45294f6a16572cf5cad",
  },

  // --------------------------------------------------
  // 16) Moonbeam
  // --------------------------------------------------
  moonbeam: {
    // Wrapped GLMR
    WGLMR: "0xAcc15dC74880C9944775448304B263D191c6077F",
    // USDC on Moonbeam
    USDC:  "0x818ec0A7Fe18Ff94269904fCED6AE3DaE6d6dC0b",
  },

  // --------------------------------------------------
  // 23) Arbitrum
  // --------------------------------------------------
  arbitrum: {
    // WETH on Arbitrum
    WETH: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
    // Native USDC on Arbitrum
    USDC: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    // (Alternate bridging USDC: 0xFF970A61A04b1cA14834A43f5de4533ebddb5CC8)
  },

  // --------------------------------------------------
  // 24) Optimism
  // --------------------------------------------------
  optimism: {
    // WETH on Optimism
    WETH: "0x4200000000000000000000000000000000000006",
    // USDC on Optimism
    USDC: "0x7f5c764cbc14f9669b88837ca1490cca17c31607",
  },

  // --------------------------------------------------
  // 25) Gnosis (xDai)
  // --------------------------------------------------
  gnosis: {
    // wXDAI
    WXDAI: "0x6a023ccd1ff6f2045c3309768ead9e68f978f6e1",
    // USDC bridging on Gnosis
    USDC:  "0xddafbb505ad214d7b80b1f830fccc89b60fb7a83",
  },

  // --------------------------------------------------
  // 30) Base
  // --------------------------------------------------
  base: {
    // WETH on Base (official canonical WETH)
    WETH: "0x4200000000000000000000000000000000000006",
    // USDC on Base (Circle)
    USDC: "0xd9f7d76366610a8799f1c54c6c79fa6b9df6b414", 
    // [Check official references, addresses may vary in mainnet]
  },

  // --------------------------------------------------
  // 34) Scroll (Testnet, uncertain addresses)
  // --------------------------------------------------
  scroll: {
    // WETH (Placeholder)
    WETH: "0x0000000000000000000000000000000000000000",
    // USDC (Placeholder)
    USDC: "0x0000000000000000000000000000000000000000",
  },

  // --------------------------------------------------
  // 35) Mantle
  // --------------------------------------------------
  mantle: {
    // WETH (Placeholder)
    WETH: "0x0000000000000000000000000000000000000000",
    // USDC (Placeholder)
    USDC: "0x0000000000000000000000000000000000000000",
  },

  // --------------------------------------------------
  // 38) Linea
  // --------------------------------------------------
  linea: {
    // WETH (Placeholder)
    WETH: "0x0000000000000000000000000000000000000000",
    // USDC (Placeholder)
    USDC: "0x0000000000000000000000000000000000000000",
  },

  // --------------------------------------------------
  // 39) Berachain
  // --------------------------------------------------
  berachain: {
    // WETH (Placeholder)
    WETH: "0x0000000000000000000000000000000000000000",
    // USDC (Placeholder)
    USDC: "0x0000000000000000000000000000000000000000",
  },
};

export default class WormholeBridgeService {
  constructor() {
    this.wh = null;       // Wormhole instance
    this.resolver = null; // Route resolver
    this.initialized = false;
  }

  /**
   * initialize
   * Sets up Wormhole with EVM & Solana (Mainnet in this example).
   */
  async initialize() {
    if (this.initialized) return;
    try {
      this.wh = await wormhole("Mainnet", [evm, solana]);
      this.resolver = this.wh.resolver([
        routes.TokenBridgeRoute,
        routes.AutomaticTokenBridgeRoute,
        routes.CCTPRoute,
        routes.AutomaticCCTPRoute,
        routes.AutomaticPorticoRoute
      ]);
      this.initialized = true;
      console.log("✅ WormholeBridgeService initialized for Mainnet");
    } catch (err) {
      console.error("❌ Error initializing WormholeBridgeService:", err.message);
      throw err;
    }
  }

  /**
   * bridgeTokens
   * ------------
   * A unified entry point that:
   * 1) Maps chain names
   * 2) Finds user & logs bridging in DB
   * 3) Resolves the best route, obtains a quote, and initiates bridging
   * 4) Tracks the transfer steps and updates the DB
   * 5) Logs progress to Telegram and returns the final result
   *
   * Expected arguments (passed in args):
   * {
   *   telegramId,      // user's Telegram ID (for logging and DB records)
   *   sourceChain,     // e.g. "solana", "ethereum", "avalanche"
   *   targetChain,     // e.g. "solana", "ethereum", "avalanche"
   *   tokenAddress,    // either "native" or a token symbol/address
   *   amount,          // amount as a decimal string (e.g. "0.05")
   *   recipientAddress,// recipient address on the target chain
   *   roundTrip        // (optional) boolean; default is true to enable round-trip
   * }
   */
  async bridgeTokens(telegramId, args, bot, chatId) {
    const {
      sourceChain,
      targetChain,
      tokenAddress, // could be "native" or token symbol/address
      amount,
      recipientAddress,
      roundTrip = true  // enable round-trip by default
    } = args;

    // 1) Basic checks
    if (!telegramId) {
      throw new Error("telegramId is required to store bridging receipts");
    }
    if (!sourceChain || !targetChain) {
      throw new Error(`Invalid chain input: ${sourceChain}, ${targetChain}`);
    }

    // 2) Initialize Wormhole if needed
    await this.initialize();

    // 3) Map chain strings to Wormhole chain objects
    const srcChainName = chainMap[sourceChain.toLowerCase()];
    const dstChainName = chainMap[targetChain.toLowerCase()];
    if (!srcChainName || !dstChainName) {
      throw new Error(`Unsupported chain combination: ${sourceChain} -> ${targetChain}`);
    }
    const sendChain = this.wh.getChain(sourceChain);
    const destChain = this.wh.getChain(targetChain);

    // 4) Load user and create a bridging record in the DB
    const user = await User.findByTelegramId(telegramId);
    if (!user) {
      throw new Error(`User not found for telegramId: ${telegramId}`);
    }

    const bridgingId = uuidv4();
    const bridgingRecord = {
      bridgingId,
      sourceChain,
      targetChain,
      tokenSymbol: tokenAddress,
      amount,
      status: "PENDING",
      logs: [`[${new Date().toISOString()}] Initiating bridging from ${sourceChain} to ${targetChain}...`],
    };
    await user.addBridgingRecord(bridgingRecord);

    // 5) Log progress to Telegram & DB
    await bot.sendMessage(
      chatId,
      `Bridging started. ID: ${bridgingId}\nFrom: ${sourceChain} -> ${targetChain}`
    );
    await user.addBridgingLog(bridgingId, "Resolving bridging route...");

    // 6) Get signers for source & destination chains
    const sender = await getSigner(sendChain);
    const receiver = await getSigner(destChain);

    // 7) Resolve the actual token address from tokenSymbolMap (if applicable)
    let actualTokenAddr;
    if (tokenAddress.toLowerCase() === "native") {
      actualTokenAddr = "native";
    } else if (tokenSymbolMap[sourceChain.toLowerCase()]?.[tokenAddress]) {
      actualTokenAddr = tokenSymbolMap[sourceChain.toLowerCase()][tokenAddress];
    } else {
      // Assume the user provided a direct address if not in the map
      actualTokenAddr = tokenAddress;
    }

    // 8) Build the Wormhole tokenId for the source chain token
    let sendToken;
    if (actualTokenAddr === "native") {
      sendToken = Wormhole.tokenId(sendChain.chain, "native");
    } else {
      sendToken = Wormhole.tokenId(sendChain.chain, actualTokenAddr);
    }

    // 9) Check for supported destination tokens
    const destTokens = await this.resolver.supportedDestinationTokens(sendToken, sendChain, destChain);
    if (!destTokens.length) {
      throw new Error(`No bridging route found for token ${tokenAddress} from ${sourceChain} -> ${targetChain}`);
    }
    const destinationToken = destTokens[0];

    // 10) Create a RouteTransferRequest
    const transferRequest = await routes.RouteTransferRequest.create(this.wh, {
      source: sendToken,
      destination: destinationToken
    });

    // 11) Find bridging routes
    const foundRoutes = await this.resolver.findRoutes(transferRequest);
    if (!foundRoutes.length) {
      throw new Error("No bridging routes found for these parameters. Abort.");
    }
    const bestRoute = foundRoutes[0];
    await bot.sendMessage(chatId, `Selecting best route: ${bestRoute.constructor.name}`);
    await user.addBridgingLog(bridgingId, `Best route: ${bestRoute.constructor.name}`);

    // 12) Validate & quote using automatic mode (nativeGas set to 0)
    const transferParams = {
      amount,
      options: { automatic: true, nativeGas: 0 }
    };
    const validated = await bestRoute.validate(transferRequest, transferParams);
    if (!validated.valid) throw validated.error;

    const quote = await bestRoute.quote(transferRequest, validated.params);
    if (!quote.success) throw quote.error;
    const msgFees = `Quoted cost: ~${quote.estimate.fees} in fees, ~${quote.estimate.gas} gas.`;
    await bot.sendMessage(chatId, msgFees);
    await user.addBridgingLog(bridgingId, msgFees);

    // 13) Initiate bridging (using automatic mode)
    await bot.sendMessage(chatId, `Initiating bridging of ${amount} tokens now...`);
    const receipt = await bestRoute.initiate(transferRequest, sender.signer, quote, receiver.address);
    const logMsg = `[${new Date().toISOString()}] Bridge initiated => ${JSON.stringify(receipt)}`;
    await user.addBridgingLog(bridgingId, logMsg);

    // Store partial receipt in DB
    await user.updateBridgingRecord(bridgingId, {
      routeUsed: bestRoute.constructor.name,
      txReceipt: { partial: receipt }
    });

    // 14) Wait for finalization (this automatically completes the transfer)
    await routes.checkAndCompleteTransfer(bestRoute, receipt, receiver.signer);
    await user.addBridgingLog(bridgingId, `[${new Date().toISOString()}] checkAndCompleteTransfer done.`);

    // 15) If round-trip is enabled, perform a reverse transfer
    if (roundTrip) {
      await bot.sendMessage(chatId, "Initiating round-trip bridging...");
      await user.addBridgingLog(bridgingId, "Initiating round-trip bridging...");

      // Create a new transfer request for the round-trip (reverse direction)
      const roundTripRequest = await routes.RouteTransferRequest.create(this.wh, {
        source: destinationToken.token, // token on destination chain
        destination: sendToken          // original token on source chain
      });

      const roundTripRoutes = await this.resolver.findRoutes(roundTripRequest);
      if (!roundTripRoutes.length) {
        await bot.sendMessage(chatId, "No round-trip route found. Skipping round-trip.");
        await user.addBridgingLog(bridgingId, "No round-trip route found.");
      } else {
        const roundTripBestRoute = roundTripRoutes[0];
        await bot.sendMessage(chatId, `Round-trip route: ${roundTripBestRoute.constructor.name}`);
        await user.addBridgingLog(bridgingId, `Round-trip route: ${roundTripBestRoute.constructor.name}`);

        const roundTripTransferParams = {
          amount,
          options: { automatic: true, nativeGas: 0 }
        };
        const roundTripValidated = await roundTripBestRoute.validate(roundTripRequest, roundTripTransferParams);
        if (!roundTripValidated.valid) {
          await bot.sendMessage(chatId, `Round-trip validation error: ${roundTripValidated.error}`);
          await user.addBridgingLog(bridgingId, `Round-trip validation error: ${roundTripValidated.error}`);
        } else {
          const roundTripQuote = await roundTripBestRoute.quote(roundTripRequest, roundTripValidated.params);
          if (!roundTripQuote.success) {
            await bot.sendMessage(chatId, `Round-trip quote error: ${roundTripQuote.error}`);
            await user.addBridgingLog(bridgingId, `Round-trip quote error: ${roundTripQuote.error}`);
          } else {
            const rtMsgFees = `Round-trip quote: ~${roundTripQuote.estimate.fees} in fees, ~${roundTripQuote.estimate.gas} gas.`;
            await bot.sendMessage(chatId, rtMsgFees);
            await user.addBridgingLog(bridgingId, rtMsgFees);

            // For round-trip, reverse the roles: use the destination signer as source and vice versa.
            const roundTripReceipt = await roundTripBestRoute.initiate(
              roundTripRequest,
              receiver.signer,  // now signing from the original destination chain
              roundTripQuote,
              sender.address    // sending back to the original sender
            );
            await user.addBridgingLog(bridgingId, `Round-trip initiated: ${JSON.stringify(roundTripReceipt)}`);
            await routes.checkAndCompleteTransfer(roundTripBestRoute, roundTripReceipt, sender.signer);
            await user.addBridgingLog(bridgingId, "Round-trip complete.");
            await bot.sendMessage(chatId, `Round-trip bridging completed.`);
          }
        }
      }
    }

    // 16) Mark success in the DB & Telegram
    await user.updateBridgingRecord(bridgingId, {
      status: "COMPLETED",
      txReceipt: { final: "some final data" },
      completedAt: new Date()
    });
    await bot.sendMessage(chatId, `✅ Bridging completed. ID: ${bridgingId}`);

    // 17) Return final result
    return {
      bridgingId,
      success: true,
      message: `Bridged ${amount} of token [${tokenAddress}] from ${sourceChain} to ${targetChain}` +
               (roundTrip ? " with round-trip enabled." : "")
    };
  }

  async trackBridgeTransaction(bridgeId, data) {
    try {
      // Store in DB
      await this.bridgeTransactions.insertOne({
        bridgeId,
        ...data,
        status: 'PENDING',
        createdAt: new Date()
      });

      // Emit event for real-time updates
      this.emit('bridgeUpdate', {
        type: 'NEW_BRIDGE',
        bridgeId,
        data
      });
    } catch (error) {
      console.error('Failed to track bridge transaction:', error);
    }
  }

  async updateBridgeStatus(bridgeId, status, receipt) {
    try {
      await this.bridgeTransactions.updateOne(
        { bridgeId },
        {
          $set: {
            status,
            receipt,
            updatedAt: new Date()
          }
        }
      );
  
      this.emit('bridgeUpdate', {
        type: 'STATUS_UPDATE',
        bridgeId,
        status,
        receipt 
      });
    } catch (error) {
      console.error('Failed to update bridge status:', error);
    }
  }

  async verifyBridgeCompletion(receipt, destChain) {
    try {
      // Verify the transaction was completed on destination chain
      const verified = await this.wh.verifyTransfer(receipt, destChain);
      
      if (verified) {
        await this.updateBridgeStatus(receipt.bridgeId, 'COMPLETED', receipt);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Failed to verify bridge completion:', error);
      return false;
    }
  }
  
  async notifyUser(userId, message) {
    try {
      await this.bot.sendMessage(userId, message);
    } catch (error) {
      console.error('Failed to notify user:', error);
    }
  }
  

}
