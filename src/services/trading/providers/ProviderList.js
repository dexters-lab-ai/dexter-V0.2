import { getDefaultProvider } from "ethers";
import dotenv from "dotenv";
import { config } from "../../../core/config.js";
dotenv.config();

/**
 * Quicknode EVM Providers mapping.
 * Ensure that your environment variables (or config file) provide all required endpoints.
 */
export const providers = {
    // Ethereum Mainnet
    ethereum: getDefaultProvider(config.etherEndpoint),
    
    // Avalanche
    avalanche: getDefaultProvider(config.avaxEndpoint),
    
    // Base
    base: getDefaultProvider(config.baseEndpoint),
    
    // Linea (Linear)
    linear: getDefaultProvider(config.linearEndpoint),
    
    // Cyber
    cyber: getDefaultProvider(config.cyberEndpoint),
    
    // Fantom
    fantom: getDefaultProvider(config.fantomEndpoint),
    
    // Arbitrum
    arbitrum: getDefaultProvider(config.arbitrumEndpoint),
    
    // Berachain
    berachain: getDefaultProvider(config.berachainEndpoint),
    
    // Nova (Optimism Nova)
    nova: getDefaultProvider(config.novaEndpoint),
    
    // Optimism
    optimism: getDefaultProvider(config.optimismEndpoint),
    
    // ZKEVM
    zkevm: getDefaultProvider(config.zkevmEndpoint),
    
    // Scroll
    scroll: getDefaultProvider(config.scrollEndpoint),
    
    // Polygon (Matic)
    polygon: getDefaultProvider(config.polygonEndpoint),
    
    // Binance Smart Chain (BSC)
    bsc: getDefaultProvider(config.binanceEndpoint),
    
    // Celo
    celo: getDefaultProvider(config.celoEndpoint),
    
    // Worldchain
    worldchain: getDefaultProvider(config.worldchainEndpoint),
    
    // Mantle
    mantle: getDefaultProvider(config.mantleEndpoint),
    
    // Zksync
    zksync: getDefaultProvider(config.zksyncEndpoint),
    
    // Omni
    omni: getDefaultProvider(config.omniEndpoint),
};