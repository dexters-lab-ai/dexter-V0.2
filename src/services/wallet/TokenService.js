import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ethers } from "ethers";
import { walletService } from "./index.js";
import { tokenInfoService } from "../tokens/TokenInfoService.js";
import { getSolanaTokenInfo } from "../solana/solanaService.js";
import { config } from "../../core/config.js";
import { ErrorHandler } from "../../core/errors/index.js";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

class TokenService {
  constructor() {
    this.solanaConnection = new Connection(config.networks.solana.rpcUrl, {
      commitment: "confirmed",
    });

    this.defaultTokens = {
      ethereum: [
        { symbol: "ETH", address: "native" },
        { symbol: "DAI", address: "0x6b175474e89094c44da98b954eedeac495271d0f" },
        { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" },
      ],
      base: [
        { symbol: "ETH", address: "native" },
        { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
      ],
      solana: [
        { symbol: "SOL", address: "native" },
        { symbol: "USDC", address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
      ],
    };
  }

  // --------------------------------------------------------
  // EVM TOKEN BALANCES
  // --------------------------------------------------------
  async getEvmTokenBalances(network, address) {
    try {
      const provider = await walletService.getProvider(network);
      const defaultTokens = this.defaultTokens[network];
      const balances = [];

      // 1) Add native token
      const nativeBalance = await provider.getBalance(address);
      balances.push({
        symbol: network === "ethereum" ? "ETH" : "ETH",
        balance: ethers.formatEther(nativeBalance),
        address: "native",
      });

      // 2) For default token addresses
      for (const token of defaultTokens) {
        if (token.address === "native") continue;

        try {
          const contract = new ethers.Contract(token.address, ERC20_ABI, provider);
          const balance = await contract.balanceOf(address);
          const decimals = await contract.decimals();

          balances.push({
            symbol: token.symbol,
            balance: ethers.formatUnits(balance, decimals),
            address: token.address,
          });
        } catch (err) {
          console.warn(`Failed to fetch EVM token ${token.symbol} at ${token.address}:`, err);
          balances.push({ symbol: token.symbol, balance: "0", address: token.address });
        }
      }

      return balances;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // --------------------------------------------------------
  // SOLANA TOKEN BALANCES
  // --------------------------------------------------------
  async getSolanaTokenBalances(address) {
    try {
      const publicKey = new PublicKey(address);
      const balances = [];

      // 1) Native SOL
      const lamports = await this.solanaConnection.getBalance(publicKey);
      balances.push({
        symbol: "SOL",
        balance: (lamports / 1e9).toFixed(9),
        address: "native",
      });

      // 2) Get token accounts via getParsedTokenAccountsByOwner
      const parsedTokenAccounts = await this.solanaConnection.getParsedTokenAccountsByOwner(
        publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      const accountedFor = new Set();

      for (const { account } of parsedTokenAccounts.value) {
        const tokenData = account.data.parsed?.info;
        if (!tokenData) continue;

        const mintAddress = tokenData.mint;
        // Skip "wrapped SOL" special mint
        if (mintAddress === "So11111111111111111111111111111111111111112") continue;

        const uiAmount = tokenData.tokenAmount?.uiAmount || 0;

        // Attempt to fetch symbol/decimals from metadata
        let symbol = "Unknown";
        try {
          const meta = await this.getSolanaTokenInfo(mintAddress);
          // meta may be null or not array, so handle gracefully in .getSolanaTokenInfo
          symbol = meta.symbol || symbol;
        } catch (metaErr) {
          console.warn(
            `Failed to fetch metadata for token ${mintAddress}:`,
            metaErr.message
          );
        }

        balances.push({
          symbol,
          balance: uiAmount.toString(),
          address: mintAddress,
        });
        accountedFor.add(mintAddress);
      }

      // 3) Add default tokens with zero balance if not discovered
      const defaultTokens = this.defaultTokens.solana;
      for (const token of defaultTokens) {
        if (token.address === "native") continue; // SOL done
        if (!accountedFor.has(token.address)) {
          balances.push({
            symbol: token.symbol,
            balance: "0",
            address: token.address,
          });
        }
      }

      return balances;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // --------------------------------------------------------
  // TOKEN INFO
  // --------------------------------------------------------
  async getTokenInfo(network, tokenAddress) {
    if (tokenAddress === "native") {
      return {
        symbol: network === "solana" ? "SOL" : "ETH",
        address: "native",
        decimals: network === "solana" ? 9 : 18,
      };
    }
    return tokenInfoService.getTokenInfo(network, tokenAddress);
  }

  async getEvmTokenInfo(network, tokenAddress) {
    const provider = await walletService.getProvider(network);
    const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);

    const [symbol, decimals] = await Promise.all([
      contract.symbol(),
      contract.decimals(),
    ]);

    return { symbol, address: tokenAddress, decimals };
  }

  /**
   * Enhanced method: gracefully handle returned data from getSolanaTokenInfo.
   * If it returns array [symbol, name, decimals], do that. Otherwise fallback.
   */
  async getSolanaTokenInfo(tokenAddress) {
    let result;
    try {
      result = await getSolanaTokenInfo(tokenAddress);
    } catch (err) {
      console.warn(`Error calling getSolanaTokenInfo(${tokenAddress}):`, err.message);
      return { symbol: "Unknown", address: tokenAddress, decimals: 0 };
    }

    // If result is not an array of length >= 2
    if (!Array.isArray(result) || result.length < 3) {
      console.warn(
        `getSolanaTokenInfo returned non-array or incomplete data for token ${tokenAddress}. Got:`,
        result
      );
      return { symbol: "Unknown", address: tokenAddress, decimals: 0 };
    }

    const [symbol, name, decimals] = result;
    if (typeof decimals !== "number") {
      console.warn(`Decimals for token ${tokenAddress} unknown: ${decimals}`);
    }

    return {
      symbol: symbol || "Unknown",
      address: tokenAddress,
      decimals: typeof decimals === "number" ? decimals : 0,
    };
  }
}

export const tokenService = new TokenService();
