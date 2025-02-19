import { EventEmitter } from 'events';
import axios from 'axios';
import { quickNodeService } from '../quicknode/QuickNodeService.js';
import { dextools } from '../dextools/index.js';
import { ErrorHandler } from '../../core/errors/index.js';

class TokenInfoService extends EventEmitter {
  constructor() {
    super();
    this.initialized = false;
    this.cache = new Map();
    this.CACHE_DURATION = 60000; // 1 minute
    this.axiosInstance = axios.create({
      baseURL: 'https://api.dexscreener.com/latest/dex',
      timeout: 5000
    });
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
  }

  async getTokenInfo(network, input) {
    try {
      // Check cache first
      const cacheKey = `${network}:${input}`;
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;

      // Try address lookup first
      let info = await this.getTokenByAddress(network, input);
      
      // If not found and input looks like a symbol, try symbol search
      if (!info && /^[A-Za-z0-9]+$/.test(input)) {
        info = await this.getTokenBySymbol(network, input);
      }

      if (!info) {
        throw new Error('Token not found');
      }

      // Cache the result
      this.cache.set(cacheKey, {
        data: info,
        timestamp: Date.now()
      });

      return info;
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async getTokenByAddress(network, address) {
    try {
      // Try DexScreener first
      const response = await this.axiosInstance.get(`/tokens/${address}`);
      const pair = response.data?.pairs?.[0];
      
      if (pair) {
        return this.formatDexScreenerPair(pair);
      }

      // Fallback to DexTools
      return await dextools.getTokenInfo(network, address);
    } catch (error) {
      console.warn('Token address lookup failed:', error);
      return null;
    }
  }

  async getTokenBySymbol(network, symbol) {
    try {
      // Try DexScreener search
      const response = await this.axiosInstance.get(`/search?q=${symbol}`);
      const pairs = response.data?.pairs;
      
      if (!pairs?.length) return null;

      // Filter by network and exact symbol match
      const match = pairs.find(pair => 
        pair.chainId.toLowerCase() === network.toLowerCase() &&
        pair.baseToken.symbol.toLowerCase() === symbol.toLowerCase()
      );

      if (match) {
        return this.formatDexScreenerPair(match);
      }

      // Fallback to DexTools search
      return await dextools.getTokenBySymbol(network, symbol);
    } catch (error) {
      console.warn('Symbol search failed:', error);
      return null;
    }
  }

  formatDexScreenerPair(pair) {
    return {
      address: pair.baseToken.address,
      symbol: pair.baseToken.symbol,
      name: pair.baseToken.name,
      decimals: pair.baseToken.decimals,
      price: pair.priceUsd,
      priceNative: pair.priceNative,
      network: pair.chainId.toLowerCase(),
      liquidity: pair.liquidity?.usd,
      volume24h: pair.volume?.h24,
      fdv: pair.fdv,
      marketCap: pair.marketCap,
      info: {
        imageUrl: pair.info?.imageUrl,
        websites: pair.info?.websites,
        socials: pair.info?.socials
      }
    };
  }

  async getTokenAnalysis(network, address) {
    try {
      // Get token metrics from multiple sources
      const [
        dexScreenerInfo,
        dexToolsInfo,
        quickNodeMetrics
      ] = await Promise.all([
        this.getTokenByAddress(network, address),
        dextools.formatTokenAnalysis(network, address),
        this.getQuickNodeMetrics(network, address)
      ]);

      // Combine metrics
      return {
        price: {
          current: dexScreenerInfo?.price || dexToolsInfo?.price,
          change24h: dexScreenerInfo?.priceChange24h,
        },
        liquidity: {
          total: dexScreenerInfo?.liquidity,
          tokenReserve: dexToolsInfo?.liquidity?.reserves?.mainToken,
          pairReserve: dexToolsInfo?.liquidity?.reserves?.sideToken
        },
        volume24h: dexScreenerInfo?.volume24h,
        trades: {
          buys24h: quickNodeMetrics?.buys24h,
          sells24h: quickNodeMetrics?.sells24h
        },
        holders: quickNodeMetrics?.holders,
        score: dexToolsInfo?.score,
        audit: dexToolsInfo?.audit,
        pool: {
          exchange: dexScreenerInfo?.exchange,
          createdAt: dexScreenerInfo?.pairCreatedAt,
          fee: dexToolsInfo?.poolInfo?.fee
        }
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async getQuickNodeMetrics(network, address) {
    try {
      const [holders, transactions] = await Promise.all([
        quickNodeService.getTokenHolders(address),
        quickNodeService.getTokenTransactions(address, 100)
      ]);

      return {
        holders: holders.length,
        buys24h: transactions.filter(tx => tx.isBuy).length,
        sells24h: transactions.filter(tx => !tx.isBuy).length,
        uniqueTraders: new Set(transactions.map(tx => tx.from)).size
      };
    } catch (error) {
      console.warn('Error getting QuickNode metrics:', error);
      return {};
    }
  }

  async subscribeToPriceUpdates(network, address, callback) {
    try {
      // Try DexScreener WebSocket first
      const ws = await this.subscribeToQNodeWebsocket(network, address, callback);
      if (ws) return ws;

    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  // Do manual price checks every minute,
  // OR USE Webhooks when we find one thats cool for prices
  async subscribeToQNodeWebsocket(network, address, callback) {
    try {
      const ws = new WebSocket('wss://lingering-red-liquid.solana-mainnet.quiknode.pro/a2a21741d8c9370d63a0789ab9eb93f926e11764');
      
      ws.on('open', () => {
        ws.send(JSON.stringify({
          type: 'subscribe',
          pairs: [`${network}:${address}`]
        }));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'price') {
            callback(message.price);
          }
        } catch (error) {
          console.warn('Error parsing WebSocket message:', error);
        }
      });

      return ws;
    } catch (error) {
      console.warn('DexScreener WebSocket failed:', error);
      return null;
    }
  }

  async validateToken(network, input) {
    try {
      const tokenInfo = await this.getTokenInfo(network, input);
      return tokenInfo;
    } catch (error) {
      return null;
    }
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.data;
    }
    return null;
  }

  cleanup() {
    this.cache.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const tokenInfoService = new TokenInfoService();