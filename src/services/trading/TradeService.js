import { EventEmitter } from "events";
import { walletService } from "../wallet/index.js";
import { tokenService } from "../wallet/TokenService.js";
import { tokenInfoService } from "../tokens/TokenInfoService.js";
import { gasEstimationService } from "../gas/GasEstimationService.js";
import { tokenApprovalService } from "../tokens/TokenApprovalService.js";
import { quickNodeService } from "../quicknode/QuickNodeService.js";
import { ErrorHandler } from "../../core/errors/index.js";

export class TradeService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;

    // EVM router addresses
    this.routerAddress = {
      ethereum: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Universal Router
      base: "0x4752ba5dbc23f44d87826276bf6fd6b1c372ad24", // Uniswap V2 Router
    };    
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
  }

  /**
   * Main entry: Execute a "trade" or "transfer"
   * @param {Object} params
   * @param {string} params.network - ("ethereum"|"base"|"solana")
   * @param {string} params.action - ("buy"|"sell"|"transfer")
   * @param {string} params.tokenAddress - e.g. "native" or actual address
   * @param {string} params.amount - decimal string
   * @param {string} params.walletAddress - user's wallet (sender)
   * @param {string} [params.recipient] - needed if action="transfer"
   * @param {Object} [params.options] - slippage, autoApprove, etc.
   * @returns {Promise<Object>} => { hash, success, link?, ... }
   */
  async executeTrade(params) {
    try {
      // Validate the base fields
      await this.validateTradeParams(params);

      // Optional: pre-execution "simulateTransaction"
      const simulation = await quickNodeService.simulateTransaction({
        network: params.network,
        action: params.action,
        tokenAddress: params.tokenAddress,
        amount: params.amount,
        // ...any other fields
        dryRun: true,
      });
      if (!simulation.success) {
        throw new Error(`Trade validation failed: ${simulation.error}`);
      }

      // Route the trade to EVM or Solana logic
      if (["ethereum", "base"].includes(params.network)) {
        return await this.executeEvmFlow(params);
      } else if (params.network === "solana") {
        return await this.executeSolanaFlow(params);
      } else {
        //throw new Error(`Invalid network: ${params.network}`);
        return ('time ran out.. fix coming');
      }

    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // -----------------------------------------------
  // E V M   F L O W
  // -----------------------------------------------
  async executeEvmFlow(params) {
    if (params.action === "transfer") {
      return await this.executeEvmTransfer(params);
    } else {
      // buy / sell => do typical swap logic
      return await this.executeEvmTrade(params);
    }
  }

  /**
   * Execute an EVM token or native transfer
   */
  async executeEvmTransfer(params) {
    if (!params.recipient) {
      throw new Error("Recipient is required for an EVM transfer");
    }

    const provider = await walletService.getProvider(params.network);

    // If "native", do a native transfer
    if (params.tokenAddress === "native") {
      const result = await quickNodeService.evm.sendNativeTransfer({
        provider,
        from: params.walletAddress,
        to: params.recipient,
        amount: params.amount, // decimal string
      });

      return {
        hash: result.txHash,
        success: true,
        link: this.buildBlockExplorerLink(params.network, result.txHash),
      };
    } else {
      // ERC20 transfer
      const result = await quickNodeService.evm.sendTokenTransfer({
        provider,
        from: params.walletAddress,
        to: params.recipient,
        tokenAddress: params.tokenAddress,
        amount: params.amount,
      });

      return {
        hash: result.txHash,
        success: true,
        link: this.buildBlockExplorerLink(params.network, result.txHash),
      };
    }
  }

  /**
   * EVM buy/sell (swapping tokens) logic
   */
  async executeEvmTrade(params) {
    const provider = await walletService.getProvider(params.network);

    // 1) Possibly handle token approvals if selling
    if (params.action === "sell" && params.options?.autoApprove) {
      const spender = this.routerAddress[params.network];
      if (!spender) {
        throw new Error(`No router address configured for ${params.network}`);
      }

      const approved = await tokenApprovalService.checkAllowance(params.network, {
        tokenAddress: params.tokenAddress,
        ownerAddress: params.walletAddress,
        spenderAddress: spender,
      });
      if (!approved.hasApproval) {
        await tokenApprovalService.approveToken(params.network, {
          tokenAddress: params.tokenAddress,
          spenderAddress: spender,
          amount: params.amount,
          walletAddress: params.walletAddress,
        });
      }
    }

    // 2) Build & send the swap transaction via quickNodeService
    const tx = await quickNodeService.evm.buildSwapTransaction({
      network: params.network,
      from: params.walletAddress,
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      action: params.action, // "buy" or "sell"
      slippage: params.options?.slippage ?? 1,
    });

    // 3) Send
    const receipt = await quickNodeService.evm.sendRawTransaction(tx);

    return {
      hash: receipt.txHash,
      success: true,
      link: this.buildBlockExplorerLink(params.network, receipt.txHash),
    };
  }

  // -----------------------------------------------
  // S O L A N A   F L O W
  // -----------------------------------------------
  async executeSolanaFlow(params) {
    if (params.action === "transfer") {
      return await this.transferSolana(params);
    } else {
      return await this.executeSolanaTrade(params);
    }
  }

  /**
   * Transfer on Solana (native SOL or SPL token)
   */
  async transferSolana(params) {
    //  direct “sendSOL” or “sendSPLToken” via quickNodeService
    if (!params.recipient) {
      throw new Error("Recipient is required for a Solana transfer");
    }
    const result = await quickNodeService.solana.sendTransfer({
      fromPubkey: params.walletAddress,
      toPubkey: params.recipient,
      tokenMint: params.tokenAddress, // "native" => handle in quicknode
      amount: params.amount,
    });

    return {
      hash: result.signature,
      success: true,
      link: `https://solscan.io/tx/${result.signature}`,
    };
  }

  /**
   * Solana buy/sell logic (ex: Jupiter or a QuickNode-based aggregator)
   */
  async executeSolanaTrade(params) {
    // Example approach
    const result = await quickNodeService.solana.swapTokens({
      fromPubkey: params.walletAddress,
      tokenAddress: params.tokenAddress,
      amount: params.amount,
      slippage: params.options?.slippage ?? 1,
      action: params.action, 
    });

    return {
      hash: result.signature,
      success: true,
      link: `https://solscan.io/tx/${result.signature}`,
    };
  }

  // -----------------------------------------------
  // M U L T I P L E   S W A P S   (S O L A N A)
  // -----------------------------------------------
  async executeMultipleSwaps(swaps) {
    try {
      if (!swaps.every((s) => s.network === "solana")) {
        throw new Error("Multiple swaps only supported on Solana");
      }

      // Possibly do a “Jito / QuickNode” bundling approach
      // Example:
      const results = [];
      for (const swap of swaps) {
        const singleResult = await this.executeSolanaTrade(swap);
        results.push({ swap, success: true, hash: singleResult.hash });
      }
      return results;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // -----------------------------------------------
  // H E L P E R S
  // -----------------------------------------------
  async validateTradeParams(params) {
    const required = ["network", "action", "tokenAddress", "amount", "walletAddress"];
    const missing = required.filter((field) => !params[field]);
    if (missing.length > 0) {
      throw new Error(`Missing required parameters: ${missing.join(", ")}`);
    }

    // Now we allow "buy", "sell", or "transfer"
    if (!["buy", "sell", "transfer"].includes(params.action)) {
      throw new Error('Invalid action. Must be "buy", "sell", or "transfer"');
    }

    if (!["ethereum", "base", "solana"].includes(params.network)) {
      throw new Error("Invalid network");
    }
  }

  /**
   * Optionally build an explorer link for user convenience
   */
  buildBlockExplorerLink(network, txHash) {
    switch (network) {
      case "ethereum":
        return `https://etherscan.io/tx/${txHash}`;
      case "base":
        return `https://basescan.org/tx/${txHash}`;
      default:
        return "";
    }
  }
}

export const tradeService = new TradeService();
