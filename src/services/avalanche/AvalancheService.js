import { ethers } from "ethers";
import { config } from "../../core/config.js";
import { ErrorHandler } from "../../core/errors/index.js";
import { decrypt } from "../../utils/encryption.js";
import { User } from "../../models/User.js";

const SWAP_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)"
];

class AvalancheService {
  constructor() {
    this.provider = new ethers.JsonRpcProvider(config.avaxRpcUrl);
  }

  async swapTokens(userId, inputToken, outputToken, amount, slippage = 0.5) {
    try {
      // 🔹 Fetch & decrypt wallet
      const user = await User.findOne({ telegramId: userId });
      if (!user || !user.wallets || !user.wallets.ethereum) {
        throw new Error("User Avalanche wallet not found.");
      }
      const privateKey = decrypt(user.wallets.ethereum[0]?.encryptedPrivateKey);
      if (!privateKey) throw new Error("Failed to decrypt private key.");

      console.log(`🔹 Swapping ${amount} ${inputToken} → ${outputToken} on Avalanche`);

      const wallet = new ethers.Wallet(privateKey, this.provider);
      const swapRouterAddress = config.avaxSwapRouter;
      const swapContract = new ethers.Contract(swapRouterAddress, SWAP_ABI, wallet);

      const path = [inputToken, outputToken];
      const deadline = Math.floor(Date.now() / 1000) + 60 * 20;
      const amountInWei = ethers.parseUnits(amount, 18);
      const amountOutMin = amountInWei.mul(100 - slippage).div(100);

      // 🔥 Submit Swap Transaction
      const tx = await swapContract.swapExactTokensForTokens(
        amountInWei,
        amountOutMin,
        path,
        wallet.address,
        deadline
      );

      console.log(`✅ Swap Tx Submitted: ${tx.hash}`);

      // ⏳ Check Transaction Status
      const status = await this.waitForTransaction(tx.hash);
      console.log(`📢 Swap Transaction Status: ${status}`);
      return { txHash: tx.hash, status };
    } catch (error) {
      console.error("❌ Avalanche Swap Error:", error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async sendTokens(userId, token, recipient, amount) {
    try {
      const user = await User.findOne({ telegramId: userId });
      if (!user || !user.wallets || !user.wallets.ethereum) {
        throw new Error("User Avalanche wallet not found.");
      }
      const privateKey = decrypt(user.wallets.ethereum[0]?.encryptedPrivateKey);
      if (!privateKey) throw new Error("Failed to decrypt private key.");

      console.log(`🔹 Sending ${amount} ${token} to ${recipient} on Avalanche`);

      const wallet = new ethers.Wallet(privateKey, this.provider);
      const tokenContract = new ethers.Contract(token, ["function transfer(address to, uint256 value)"], wallet);
      const amountWei = ethers.parseUnits(amount, 18);

      // 🔥 Submit Send Transaction
      const tx = await tokenContract.transfer(recipient, amountWei);
      console.log(`✅ Send Tx Submitted: ${tx.hash}`);

      // ⏳ Check Transaction Status
      const status = await this.waitForTransaction(tx.hash);
      console.log(`📢 Send Transaction Status: ${status}`);
      return { txHash: tx.hash, status };
    } catch (error) {
      console.error("❌ Avalanche Send Error:", error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async checkGasFees() {
    try {
      const gasPrice = await this.provider.getGasPrice();
      console.log(`⛽ Current Gas Price: ${ethers.formatUnits(gasPrice, "gwei")} Gwei`);
      return gasPrice;
    } catch (error) {
      console.error("❌ Error fetching gas fees:", error.message);
      throw error;
    }
  }

  async issuePlatformTx(userId, rawTxHex) {
    try {
      console.log(`🔹 Issuing AVAX platform transaction for user: ${userId}`);

      const params = {
        tx: rawTxHex,
        encoding: "hex",
      };

      const result = await this.provider.send("platform.issueTx", params);
      console.log(`✅ Issued Platform TX: ${result}`);

      // ⏳ Check Transaction Status
      const status = await this.getTransactionStatus(result);
      console.log(`📢 Platform Transaction Status: ${status}`);
      return { txId: result, status };
    } catch (error) {
      console.error("❌ Error issuing AVAX platform transaction:", error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async getTransactionStatus(txId) {
    try {
      const params = { txID: txId };
      const result = await this.provider.send("platform.getTxStatus", params);
      console.log(`🔍 Transaction ${txId} Status: ${result.status}`);
      return result.status;
    } catch (error) {
      console.error("❌ Error fetching transaction status:", error.message);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async waitForTransaction(txId, maxRetries = 10, delayMs = 5000) {
    try {
      for (let i = 0; i < maxRetries; i++) {
        const status = await this.getTransactionStatus(txId);
        if (status === "committed") {
          return "✅ Transaction Confirmed!";
        } else if (status === "dropped" || status === "unknown") {
          return "❌ Transaction Failed!";
        }
        console.log(`⏳ Checking status... [Attempt ${i + 1}]`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      return "⚠️ Transaction Timed Out!";
    } catch (error) {
      console.error("❌ Error waiting for transaction:", error.message);
      throw error;
    }
  }
}

export const avalancheService = new AvalancheService();
