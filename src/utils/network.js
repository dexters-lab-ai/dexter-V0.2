export function getNetworkSegment(network) {
    const networkMap = {
      ethereum: 'ether',
      base: 'base',
      solana: 'solana',
      avalanche: 'avalanche',
    };
  
    return networkMap[network.toLowerCase()] || 'unknown';
  }
  