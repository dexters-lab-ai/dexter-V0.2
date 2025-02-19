import { EventEmitter } from 'events';
import { quickNodeService } from '../../quicknode/QuickNodeService.js';
import { JupiterQuickNode } from '../../trading/JupiterQuickNode.js';
import { ErrorHandler } from '../../../core/errors/index.js';

export class EnhancedPositionMonitor extends EventEmitter {
    constructor() {
        super();
        this.priceFeeds = new Map();
        this.backupOracles = new Map();
        this.updateBuffer = new Map();
        this.reconnectTimeouts = new Map();
        this.jupiterQuickNode = new JupiterQuickNode();
    }

    async setupRedundantPriceFeeds(token) {
        try {
            const isSolanaToken = token.network === 'solana';

            if (isSolanaToken) {
                console.log(`🟢 Setting up JupiterQuickNode price updates for ${token.address}`);

                // Fetch price initially and cache it
                await this.updateSolanaTokenPrice(token.address);

                // Setup periodic updates using Jupiter
                setInterval(async () => {
                    await this.updateSolanaTokenPrice(token.address);
                }, 60000); // Refresh every 1 minute

            } else {
                console.log(`🔵 Setting up QuickNode WebSocket feed for ${token.address}`);
                
                const primaryWs = await quickNodeService.subscribeToTokenUpdates(
                    token.address,
                    (update) => this.handlePriceUpdate(token.address, update)
                );

                const backupOracle = await quickNodeService.setupPriceOracle(token.address);

                this.priceFeeds.set(token.address, primaryWs);
                this.backupOracles.set(token.address, backupOracle);

                this.setupReconnectHandler(token.address, primaryWs);
            }
        } catch (error) {
            await ErrorHandler.handle(error);
            throw error;
        }
    }

    async updateSolanaTokenPrice(tokenAddress) {
        try {
            const outputMint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"; // USDC
            const amount = 1000000000; // 1 unit of token in smallest denomination

            const quote = await this.jupiterQuickNode.getCachedQuote({ inputMint: tokenAddress, outputMint, amount });

            if (quote?.outAmount) {
                const price = parseFloat(quote.outAmount) / amount;
                this.handlePriceUpdate(tokenAddress, { price });
            }
        } catch (error) {
            console.error(`❌ Failed to update price for ${tokenAddress}:`, error.message);
        }
    }

    setupReconnectHandler(tokenAddress, ws) {
        ws.on('close', () => {
            if (!this.reconnectTimeouts.has(tokenAddress)) {
                const timeout = setTimeout(() => {
                    this.setupRedundantPriceFeeds({ address: tokenAddress })
                        .catch(error => ErrorHandler.handle(error));
                }, 1000);
                this.reconnectTimeouts.set(tokenAddress, timeout);
            }
        });
    }

    async handlePriceUpdate(tokenAddress, update) {
        try {
            if (!this.updateBuffer.has(tokenAddress)) {
                this.updateBuffer.set(tokenAddress, []);
            }
            this.updateBuffer.get(tokenAddress).push(update);

            setTimeout(() => {
                this.processBufferedUpdates(tokenAddress);
            }, 100);
        } catch (error) {
            await ErrorHandler.handle(error);
        }
    }

    async processBufferedUpdates(tokenAddress) {
        const updates = this.updateBuffer.get(tokenAddress) || [];
        if (updates.length === 0) return;

        const avgPrice = updates.reduce((sum, update) => sum + update.price, 0) / updates.length;

        this.emit('priceUpdate', {
            tokenAddress,
            price: avgPrice,
            updates: updates.length
        });

        this.updateBuffer.set(tokenAddress, []);
    }

    cleanup() {
        for (const ws of this.priceFeeds.values()) {
            ws.close();
        }
        this.priceFeeds.clear();

        for (const timeout of this.reconnectTimeouts.values()) {
            clearTimeout(timeout);
        }
        this.reconnectTimeouts.clear();

        this.updateBuffer.clear();
        this.backupOracles.clear();
    }
}
