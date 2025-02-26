import {
    Connection,
    PublicKey,
    VersionedTransaction,
    TransactionInstruction,
    TransactionMessage,
    AddressLookupTableAccount
  } from "@solana/web3.js";
import JupiterApi from '@jup-ag/api';
import { TOKEN_PROGRAM_ID, getAccount, getMint } from "@solana/spl-token";
import dotenv from "dotenv";
import * as fs from 'fs';
import * as path from 'path';
import { config } from "../../core/config.js";
import { User } from "../../models/User.js";
import { JupiterQuote } from "../../models/JupiterQuote.js";
import { SolanaTokenDecimal } from "../../models/SolanaTokenDecimal.js"; 

  
    dotenv.config();
    
    const defaultConfig = {
        solanaEndpoint: config.solanaEndpoint,
        jupiterEndpoint: config.jupiterEndpoint,
        jupiterQuoteRPC: config.jupiterQuoteRPC,
    };
    const mintDecimalsCache = {}; // Global Decimals Cache
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    
    /**
     * Safely converts a base64 string to a Buffer.
     * Pads the string if its length isn’t a multiple of 4.
     */
    function safeBufferFromBase64(base64String) {
        if (typeof base64String !== 'string') {
        throw new Error("Input is not a string");
        }
        base64String = base64String.trim();
        const padLength = (4 - (base64String.length % 4)) % 4;
        const padded = base64String + '='.repeat(padLength);
        return Buffer.from(padded, 'base64');
    }
    
    /**
     * Custom confirmation helper that polls for transaction confirmation.
     * Waits until the transaction is 'confirmed' (or 'finalized') or until timeout.
     */
    async function confirmTransaction(
        connection,
        signature,
        desiredConfirmationStatus = 'confirmed',
        timeout = 30000,
        pollInterval = 1000
    ) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
        const { value: statuses } = await connection.getSignatureStatuses([signature]);
        if (!statuses || statuses.length === 0) {
            throw new Error('Failed to get signature status');
        }
        const status = statuses[0];
        if (status === null) {
            await sleep(pollInterval);
            continue;
        }
        if (status.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        if (status.confirmationStatus && status.confirmationStatus === desiredConfirmationStatus) {
            return status;
        }
        if (status.confirmationStatus === 'finalized') {
            return status;
        }
        await sleep(pollInterval);
        }
        throw new Error(`Transaction confirmation timeout after ${timeout}ms`);
    }
    
    /**
     * Checks whether the current blockhash is expired.
     * Returns true if current block height > (lastValidBlockHeight - 150)
     */
    async function isBlockhashExpired(connection, lastValidBlockHeight) {
        const currentBlockHeight = await connection.getBlockHeight('finalized');
        return currentBlockHeight > (lastValidBlockHeight - 150);
    }

    /**
     * Fetch token decimals with caching and persistence.
     * - First checks **cache**
     * - If expired (>1 min) or missing, checks **MongoDB**
     * - If still missing, **fetches live from Solana**
     */
    async function getTokenDecimalsCached(mintAddress, connection) {
        const now = Date.now();

        if (mintAddress === "So11111111111111111111111111111111111111112") {
            mintDecimalsCache[mintAddress] = 9;
            return 9;
        }
    
        // ✅ Step 1: Check In-Memory Cache
        if (
        mintDecimalsCache[mintAddress] &&
        now - mintDecimalsCache[mintAddress].timestamp < 60000 // 1 min cache expiry
        ) {
        return mintDecimalsCache[mintAddress].decimals;
        }
    
        // ✅ Step 2: Check MongoDB
        try {
        const tokenData = await SolanaTokenDecimal.findOne({ mintAddress }).lean();
        if (tokenData && now - new Date(tokenData.updatedAt).getTime() < 60000) {
            // Store in cache
            mintDecimalsCache[mintAddress] = {
            decimals: tokenData.decimals,
            timestamp: now
            };
            return tokenData.decimals;
        }
        } catch (mongoErr) {
        console.error(`MongoDB Error fetching decimals for ${mintAddress}:`, mongoErr);
        }
    
        // ✅ Step 3: Fetch from Solana if no valid cache exists
        try {
        const mintInfo = await getMint(connection, new PublicKey(mintAddress));
        const decimals = mintInfo.decimals;
    
        // Save to MongoDB
        await SolanaTokenDecimal.updateOne(
            { mintAddress },
            { $set: { decimals, updatedAt: new Date() } },
            { upsert: true }
        );
    
        // Save to in-memory cache
        mintDecimalsCache[mintAddress] = {
            decimals,
            timestamp: now
        };
    
        return decimals;
        } catch (err) {
        console.error(`Error fetching decimals for ${mintAddress}:`, err);
        throw err;
        }
    }
  
    /**
     * Format token amounts using cached decimals.
     */
    async function formatTokenAmount(amount, mintAddress, connection) {
        const decimals = await getTokenDecimalsCached(mintAddress, connection);
        const raw = Number(amount);
        if (isNaN(raw)) return "0";
        const humanAmount = raw / Math.pow(10, decimals);
        return humanAmount.toLocaleString('en-US', {
        minimumFractionDigits: Math.min(6, decimals),
        maximumFractionDigits: Math.min(6, decimals)
        });
    }
  
    /**
     * Returns a truncated version of a token mint address.
     * For example, "EPjFWdd5AufqSSqeM2qN1xzybapC8wEGGkZwyTDt1v" becomes "EPjF...Dt1v".
     */
    function getTruncatedAddress(mintAddress) {
        const str = mintAddress.toString();
        if (str.length <= 10) return str;
        return `${str.substring(0, 4)}...${str.substring(str.length - 4)}`;
    }

    /**
     * Fetches and returns token transfer transactions (i.e. instructions from the SPL Token program)
     * for the provided Solana wallet address.
     *
     * @param {string} walletAddress - The wallet's public key as a string.
     * @param {object} options - Options for pagination.
     *   @param {number} [options.page=1] - Which page of transactions to return.
     *   @param {number} [options.perPage=10] - How many transaction signatures per page.
     *   @param {Connection} [options.connection] - Optionally provide a Connection instance.
     *
     * @returns {Promise<Array<Object>>} An array of transfer objects with details such as:
     *   - signature: Transaction signature
     *   - slot: Slot number
     *   - blockTime: Unix timestamp of the block (if available)
     *   - type: The instruction type (e.g. "transfer" or "transferChecked")
     *   - mint: The SPL token mint address
     *   - source: Source account public key (as a string)
     *   - destination: Destination account public key (as a string)
     *   - amount: Raw token amount (as a string)
     */
    async function getAllSPLTokenTransactions(walletAddress, options = {}) {
        const connection =
            options.connection ||
            new Connection(process.env.SOLANA_ENDPOINT || "https://api.mainnet-beta.solana.com", "confirmed");
        const walletPubKey = new PublicKey(walletAddress);
        const page = options.page || 1;
        const perPage = options.perPage || 10;

        // Paginate through signatures until we reach the desired page.
        let sigs = [];
        let lastSig;
        for (let i = 1; i <= page; i++) {
            const params = { limit: perPage, ...(lastSig ? { before: lastSig } : {}) };
            const sigInfos = await connection.getSignaturesForAddress(walletPubKey, params);
            if (i === page) sigs = sigInfos;
            lastSig = sigInfos[sigInfos.length - 1]?.signature;
            if (!lastSig) break;
        }

        // Process transactions in parallel and filter for token transfers.
        const transfers = await Promise.all(
            sigs.map(async ({ signature, slot }) => {
            const tx = await connection.getParsedTransaction(signature, { commitment: "confirmed" });
            if (!tx) return [];
            return tx.transaction.message.instructions
                .filter(
                (instr) =>
                    instr.program === "spl-token" &&
                    instr.parsed &&
                    (instr.parsed.type === "transfer" || instr.parsed.type === "transferChecked")
                )
                .map((instr) => ({
                signature,
                slot,
                blockTime: tx.blockTime,
                type: instr.parsed.type,
                mint: instr.parsed.info.mint,
                source: instr.parsed.info.source,
                destination: instr.parsed.info.destination,
                amount: instr.parsed.info.amount,
                }));
            })
        );

        return transfers.flat();
    }
  
    /**
     * Retrieves detailed formatted balances as an array of objects.
     * Each object includes { symbol, mint, balance } where symbol is the truncated mint address as a Markdown link.
     */
    async function getDetailedFormattedBalancesSOL(wallet, connection) {
        const rawBalances = { solBalance: 0, tokenBalances: {} };
        try {
        rawBalances.solBalance = await connection.getBalance(wallet.publicKey);
        const tokenAccounts = await connection.getTokenAccountsByOwner(wallet.publicKey, {
            programId: TOKEN_PROGRAM_ID,
        });
        for (const tokenAccount of tokenAccounts.value) {
            const accountInfo = await getAccount(connection, tokenAccount.pubkey);
            rawBalances.tokenBalances[accountInfo.mint.toBase58()] = Number(accountInfo.amount);
        }
        } catch (error) {
        console.error('Error fetching raw balances:', error);
        }
        const result = [];
        // For SOL:
        const solFormatted = await formatTokenAmount(rawBalances.solBalance, "So11111111111111111111111111111111111111112", connection);
        result.push({
        symbol: `[**SOL**](https://solscan.io/token/So11111111111111111111111111111111111111112)`,
        mint: "So11111111111111111111111111111111111111112",
        balance: solFormatted
        });
        // For each token:
        for (const [mint, balance] of Object.entries(rawBalances.tokenBalances)) {
        const truncated = getTruncatedAddress(mint);
        const symbolDisplay = `[**${truncated}**](https://solscan.io/token/${mint})`;
        const formattedBalance = await formatTokenAmount(balance, mint, connection);
        result.push({
            symbol: symbolDisplay,
            mint,
            balance: formattedBalance
        });
        }
        return result;
    }
  
    /**
     * Sends a formatted swap quote message to the user.
     */
    async function sendQuoteDetails(bot, connection, userId, quote, inputMint, outputMint) {
        try {
        const formattedInput = await formatTokenAmount(quote.inAmount, inputMint, connection);
        const formattedOutput = await formatTokenAmount(quote.outAmount, outputMint, connection);
        const message = `📜 **Swap Quote Details:**\n\n` +
            `• **Input Amount:** ${formattedInput}\n\n` +
            `• **Expected Output:** ${formattedOutput}\n\n` +
            `• **Static Slippage:** ${quote.slippageBps} bps\n\n` +
            `• **Dynamic Slippage Range:** ${quote.dynamicSlippage ? `${quote.dynamicSlippage.minBps}-${quote.dynamicSlippage.maxBps} bps` : 'N/A'}`;
        await bot.sendMessage(userId, message, { parse_mode: "Markdown" });
        } catch (error) {
        console.error("Error sending quote details:", error.message);
        }
    }
    /* =======================================================
        End Formatting Helpers
    ======================================================= */
  
export { getTokenDecimalsCached as getTokenDecimals, formatTokenAmount, getDetailedFormattedBalancesSOL, getAllSPLTokenTransactions, sendQuoteDetails };
  
/**
 * Jupiter QuickNode Class for Swaps (without WebSockets for quotes) 
*/
export class JupiterQuickNode {
    constructor(bot) {
        this.bot = bot;
        this.solanaConnection = new Connection(defaultConfig.solanaEndpoint);
        const { createJupiterApiClient } = JupiterApi;
        this.jupiterApi = createJupiterApiClient({
        basePath: defaultConfig.jupiterEndpoint,
        });
        this.checkInterval = 10000;
        // Use process.cwd() for file logging (ES module–friendly)
        this.logFilePath = path.join(process.cwd(), 'history', 'swapLogs.json');
    }

    async refreshBalances(wallet) {
        const balances = { solBalance: 0, tokenBalances: {} };
        try {
        balances.solBalance = await this.solanaConnection.getBalance(wallet.publicKey);
        const tokenAccounts = await this.solanaConnection.getTokenAccountsByOwner(wallet.publicKey, {
            programId: TOKEN_PROGRAM_ID,
        });
        for (const tokenAccount of tokenAccounts.value) {
            const accountInfo = await getAccount(this.solanaConnection, tokenAccount.pubkey);
            balances.tokenBalances[accountInfo.mint.toBase58()] = Number(accountInfo.amount);
        }
        } catch (error) {
        console.error('Error refreshing balances:', error);
        }
        return balances;
    }

    /**
     * Fetches a cached quote if available within the last 1 minute.
     * Otherwise, it requests a fresh quote from Jupiter and caches it.
     */
    async getCachedQuote(quoteRequest) {
        try {
        const { inputMint, outputMint, inAmount } = quoteRequest;

        // Check if we have a cached quote within the last 60 seconds
        const oneMinuteAgo = new Date(Date.now() - 60 * 1000);
        const cachedQuote = await JupiterQuote.findOne({
            inputMint,
            outputMint,
            inAmount,
            timestamp: { $gte: oneMinuteAgo }
        });

        if (cachedQuote) {
            console.log("✅ Returning Cached Quote:", cachedQuote);
            return cachedQuote;
        }

        // console.log("⚡ Fetching new quote from Jupiter...");
        const newQuote = await this.getQuote(quoteRequest);

        // Store the fresh quote in MongoDB
        await JupiterQuote.findOneAndUpdate(
            { inputMint, outputMint, inAmount },
            { ...newQuote, timestamp: new Date() },
            { upsert: true, new: true }
        );

        return newQuote;
        } catch (error) {
        console.error("❌ Error in getCachedQuote:", error.message);
        throw error;
        }
    }

    /**
     * Wrapper for quoteGet that applies restrictions and dynamic slippage.
     */
    async getQuote(quoteRequest) {
        const request = {
        ...quoteRequest,
        restrictIntermediateTokens: true,
        slippageBps: 5,
        dynamicSlippage: { minBps: 50, maxBps: 1500 }
        };

        return await this.getQuoteWithRetries(request);
    }

    /**
     * Attempts to fetch a quote with retries.
     */
    async getQuoteWithRetries(quoteRequest, maxRetries = 3, delay = 5000) {
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const quote = await this.jupiterApi.quoteGet(quoteRequest);
            if (!quote) throw new Error("No quote found");
            //console.log("📜 Jupiter Quote:", quote);
            return quote;
        } catch (error) {
            console.error(`Quote fetch attempt ${attempt} failed: ${error.message}`);
            if (attempt < maxRetries) await sleep(delay);
            else throw error;
        }
        }
    }

    instructionDataToTransactionInstruction(instruction) {
        if (!instruction) return null;
        if (typeof instruction.data !== 'string' || instruction.data.length === 0) {
        console.warn("Invalid instruction data:", instruction.data);
        return null;
        }
        try {
        return new TransactionInstruction({
            programId: new PublicKey(instruction.programId),
            keys: instruction.accounts.map((key) => ({
            pubkey: new PublicKey(key.pubkey),
            isSigner: key.isSigner,
            isWritable: key.isWritable,
            })),
            data: safeBufferFromBase64(instruction.data),
        });
        } catch (err) {
        console.error("Error converting instruction:", err);
        return null;
        }
    }

    /**
     * Fetches and deserializes ALT accounts from provided keys.
     * Returns only ALT accounts with a valid state.addresses array.
     */
    async getAddressLookupTableAccounts(keys, connection) {
        try {
        const publicKeys = keys.map(key => new PublicKey(key));
        const accountInfos = await connection.getMultipleAccountsInfo(publicKeys);
        const altAccounts = [];
        for (let i = 0; i < accountInfos.length; i++) {
            const info = accountInfos[i];
            if (info && info.data) {
            try {
                const altAccount = AddressLookupTableAccount.deserialize(info.data);
                if (altAccount && altAccount.state && Array.isArray(altAccount.state.addresses)) {
                altAccount.key = publicKeys[i];
                altAccounts.push(altAccount);
                } else {
                console.warn(`ALT at ${publicKeys[i].toBase58()} missing valid addresses; skipping.`);
                }
            } catch (err) {
                console.warn(`Error deserializing ALT for ${publicKeys[i].toBase58()}:`, err);
            }
            }
        }
        return altAccounts;
        } catch (error) {
        console.error("Error fetching ALT accounts:", error);
        return [];
        }
    }

    /**
     * Executes the swap transaction.
     * This function:
     *  - Requests swap instructions (with custom priority fee parameters and dynamic compute unit limit).
     *  - Builds a version‑0 transaction using ALT accounts if available.
     *  - Sends the transaction once and then waits for confirmation using the custom confirmTransaction helper.
     *  - Retries up to 3 times if the transaction times out or blockhash expires.
     */
    async executeSwap({ route, wallet }) {
        try {
          const swapInstructions = await this.jupiterApi.swapInstructionsPost({
              swapRequest: {
                quoteResponse: route,
                userPublicKey: wallet.publicKey.toBase58(),
                prioritizationFeeLamports: {
                    priorityLevelWithMaxLamports: {
                      maxLamports: 150000,
                      global: false,
                      priorityLevel: "veryHigh"
                    }
                },
                dynamicComputeUnitLimit: true,
              },
          });
          
          const instructions = [
              ...swapInstructions.computeBudgetInstructions.map(instr => this.instructionDataToTransactionInstruction(instr)),
              ...swapInstructions.setupInstructions.map(instr => this.instructionDataToTransactionInstruction(instr)),
              this.instructionDataToTransactionInstruction(swapInstructions.swapInstruction),
              this.instructionDataToTransactionInstruction(swapInstructions.cleanupInstruction)
          ].filter(Boolean);
          
          let altAccounts = [];
          if (swapInstructions.addressLookupTableAddresses && swapInstructions.addressLookupTableAddresses.length > 0) {
              altAccounts = await this.getAddressLookupTableAccounts(swapInstructions.addressLookupTableAddresses, this.solanaConnection);
          }
          
          const maxRetries = 3;
          let attempt = 0;
          let txResult;
          while (attempt < maxRetries) {
              attempt++;
              try {
                // Get a fresh blockhash.
                const { blockhash, lastValidBlockHeight } = await this.solanaConnection.getLatestBlockhash();
                
                // Build the transaction message (using ALTs if available).
                const transactionMessage = new TransactionMessage({
                    payerKey: wallet.publicKey,
                    recentBlockhash: blockhash,
                    instructions,
                }).compileToV0Message(altAccounts);
                
                const transaction = new VersionedTransaction(transactionMessage);
                transaction.sign([wallet]);
                const rawTransaction = transaction.serialize();
                
                // Send the transaction once.
                let txId = await this.solanaConnection.sendRawTransaction(rawTransaction, { skipPreflight: true, maxRetries: 7 });
                if (typeof txId !== 'string') {
                    txId = txId.result;
                }
                
                // Wait for confirmation using our helper.
                const confirmation = await confirmTransaction(this.solanaConnection, txId, 'confirmed', 30000, 1000);
                txResult = { txId, confirmation };
                break; // Transaction confirmed.
              } catch (error) {
                console.warn(`Attempt ${attempt} error: ${error.message}`);
                const { lastValidBlockHeight } = await this.solanaConnection.getLatestBlockhash();
                const expired = await isBlockhashExpired(this.solanaConnection, lastValidBlockHeight);
                if (expired) {
                    console.warn(`Attempt ${attempt} expired due to blockhash expiration. Retrying with fresh blockhash...`);
                    continue;
                }
                throw error;
              }
          }
          if (!txResult) {
              throw new Error("Transaction failed after maximum retries due to blockhash expiration.");
          }
          return txResult;
        } catch (error) {
          let detailedMessage = error.message;
          if (error.response) {
              console.error("Error response status:", error.response.status);
              console.error("Error response data:", error.response.data);
              try {
                const responseBody = typeof error.response.body === 'string'
                    ? error.response.body
                    : JSON.stringify(error.response.body);
                detailedMessage += ` | Response: ${responseBody}`;
              } catch (jsonErr) {
                detailedMessage += ' | (Additional response details unavailable)';
              }
          }
          console.error('Error during swap execution:', detailedMessage);
          throw new Error(detailedMessage);
        }
    }

    async startJupiterSwap({ wallet, inputMint, outputMint, amount, userId }) {
        let swapResult = null;
        try {
          await this.sendSwapUpdate(userId, "fetching_quote", { inputMint, outputMint });
          console.log('🔄 Fetching swap quote from Jupiter API...');
          const quote = await this.getQuote({ inputMint, outputMint, amount: amount.toString() });
          
          // Send the formatted quote details to the user before proceeding.
          await sendQuoteDetails(this.bot, this.solanaConnection, userId, quote, inputMint, outputMint);
          
          await this.sendSwapUpdate(userId, "executing_swap", { inputMint, outputMint, amount });
          console.log('🔄 Executing swap transaction...');
          swapResult = await this.executeSwap({ route: quote, wallet });
          console.log('✅ Swap executed:', swapResult);
          
          // Only proceed with success message if we have a valid swapResult
          if (swapResult && swapResult.txId) {
            await this.sendSwapUpdate(userId, "swap_success", {
              inputMint,
              inAmount: await formatTokenAmount(amount, inputMint, this.solanaConnection),
              outputMint,
              outAmount: await formatTokenAmount(quote.outAmount, outputMint, this.solanaConnection),
              txId: swapResult.txId,
            });
            
            await this.logSwap({
              inputToken: inputMint,
              inAmount: amount,
              outputToken: outputMint,
              outAmount: quote.outAmount,
              txId: swapResult.txId,
              timestamp: new Date().toISOString(),
            });
          }
      
          // Return a richer result: both the confirmation and the original quote.
          return {
            confirmation: swapResult?.confirmation,
            expectedOutput: quote.outAmount,
            slippageBps: quote.slippageBps,
            dynamicSlippage: quote.dynamicSlippage,
            txId: swapResult?.txId
          };
      
        } catch (error) {
          console.error('❌ Error during swap execution:', error.message);
          await this.sendSwapUpdate(userId, "swap_failed", { errorMessage: error.message });
          throw error;
        }
    }      

    async sendSwapUpdate(userId, stage, details = {}) {
        try {
          let message = "";
          switch (stage) {
              case "fetching_quote":
                message = `🔄 **Fetching Swap Quote...**\n\n💱 **From:** \`${details.inputMint.slice(0, 4)}...${details.inputMint.slice(-4)}\`\n🔹 **To:** \`${details.outputMint.slice(0, 4)}...${details.outputMint.slice(-4)}\`\n\n⏳ Retrieving the best rates...`;
                break;
              case "executing_swap":
                message = `⚡ **Executing Swap Transaction...**\n\n💰 **Amount:** \`${await formatTokenAmount(details.amount, details.inputMint, this.solanaConnection)}\` tokens\n🪙 **Swapping:** [${details.inputMint.slice(0, 4)}...${details.inputMint.slice(-4)}](https://solscan.io/address/${details.inputMint}) → [${details.outputMint.slice(0, 4)}...${details.outputMint.slice(-4)}](https://solscan.io/address/${details.outputMint})\n\n🚀 Processing...`;
                break;
              case "quote_details":
                message = `📜 **Swap Quote Details:**\n${details.message}`;
                break;
              case "swap_success":
                message = `🎉 **Swap Successful!**\n\n🔁 **Swap Summary:**\n🔹 **From:** [${details.inputMint.slice(0, 4)}...${details.inputMint.slice(-4)}](https://solscan.io/address/${details.inputMint})\n💰 **Amount Sent:** \`${details.inAmount}\`\n🔹 **To:** [${details.outputMint.slice(0, 4)}...${details.outputMint.slice(-4)}](https://solscan.io/address/${details.outputMint})\n💎 **Amount Received:** \`${details.outAmount}\`\n\n🔗 **[View Transaction](https://solscan.io/tx/${details.txId})**`;
                break;
              case "balance_update": {
                let balanceMessage = "";
                try {
                    const balancesArray = typeof details.message === 'string' ? JSON.parse(details.message) : details.message;
                    for (const entry of balancesArray) {
                      balanceMessage += `${entry.symbol}: ${entry.balance}\n\n`;
                    }
                } catch (err) {
                    balanceMessage = details.message;
                }
                message = `🏦 **Updated Balances:**\n\n${balanceMessage}`;
                break;
              }
              case "swap_failed":
                message = ` ~ Oopsy from JupiterV6...`;
                break;
              default:
                message = `ℹ️ **Status Update:** ${stage}`;
                break;
          }

          // Wrap message sending in a try-catch to prevent crashes
          if (this.bot && typeof this.bot.sendMessage === 'function') {
              await this.bot.sendMessage(userId, message, { 
                  parse_mode: "Markdown",
                  disable_web_page_preview: true 
              }).catch(err => {
                  console.error("Failed to send message:", err);
              });
          }
        } catch (err) {
          console.error("❌ Error sending swap update:", err.message);
        }
    }

    formatNumber(num, options = {}) {
        const { maximumFractionDigits = 2, locale = 'en-US' } = options;
        const number = typeof num === 'number' ? num : parseFloat(num);
        if (isNaN(number)) return '0';
        return number.toLocaleString(locale, { maximumFractionDigits });
    }

    async logSwap(logArgs) {
        try {
        const dirPath = path.join(process.cwd(), 'history');
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }
        const filePath = path.join(dirPath, 'swapLogs.json');
        const data = { ...logArgs };
        if (fs.existsSync(filePath)) {
            let fileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            if (Array.isArray(fileData)) {
            fileData.push(data);
            } else {
            console.warn('Unexpected log file format. Resetting log file.');
            fileData = [data];
            }
            fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2));
        } else {
            fs.writeFileSync(filePath, JSON.stringify([data], null, 2));
        }
        } catch (error) {
        console.error('Error logging swap:', error);
        }
    }
}
  