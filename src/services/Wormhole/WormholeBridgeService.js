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

/**
 * chainMap
 * Maps user-friendly chain names -> Wormhole's internal names.
 */
const chainMap = {
  solana: "Solana",
  ethereum: "Ethereum", // e.g. "Ethereum"
  avalanche: "Avalanche"
};

/**
 * tokenSymbolMap
 * For each chain, we define known token symbols => actual token addresses.
 */
const tokenSymbolMap = {
  solana: {
    wSOL: "So11111111111111111111111111111111111111112",
    wETH: "someSPLwETHAddress",
    USDC: "someSPLusdcAddress"
  },
  ethereum: {
    wETH: "0x...", 
    USDC: "0x..."
  },
  avalanche: {
    wETH: "...",
    USDC: "..."
  }
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
  async bridgeTokens(args, bot, chatId) {
    const {
      telegramId,
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
    const sendChain = this.wh.getChain(srcChainName);
    const destChain = this.wh.getChain(dstChainName);

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
}
