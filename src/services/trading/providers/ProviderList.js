import dotenv from "dotenv";
import { ethers, getDefaultProvider } from "ethers";
import { config } from "../../../core/config.js";
dotenv.config();

// Define the Sonic RPC endpoint & Create endpoint
const SONIC_RPC_URL = config.sonicEndpoint;
const sonicMainnetProvider = new ethers.JsonRpcProvider(SONIC_RPC_URL);


/**
 * Quicknode EVM Providers mapping.
 * Some chains are not supported on getDefaultProvider which is meant for ETH, so we declare manual
 * Sonic First! Avax second it did not work with getDefaultProvider for me but used ports instead(config with host &port to get xChain & keyPair)
 */

const providers = {
    // Sonic
    sonic: sonicMainnetProvider,

    // Ethereum Mainnet
    ethereum: getDefaultProvider(config.ethereumEndpoint),
    
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
    bsc: getDefaultProvider(config.bscEndpoint),
    
    // Binance Smart Chain (BSC)
    binance: getDefaultProvider(config.bscEndpoint),
    
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

// Validate provider initialization
Object.entries(providers).forEach(([network, provider]) => {
    if (!provider) {
        console.warn(`⚠️ No provider configured for network: ${network}`);
    }
});

export { providers };