// src/controllers/apiController.js
import {
  getTokenPrice,
  getEVMTokenInfo,
  getSolanaTokenInfo,
  getTokenSnipers,
  getTokenSymbol,
} from '../../../services/tokens/MoralisTokenService.js';
import { dexscreener } from '../../../services/dexscreener/index.js';
import { twitterService } from '../../../services/twitter/index.js';
import { getFullTokenInfoCoinGecko, getLPInfoCoinGecko, searchCoin } from '../../../services/coingecko/CoinGecko.js';
import { getEarlyBuyersAndSellers } from '../../../services/bitQuery/bitquerySnipers.js';

const { getFudTweets } = twitterService;

/**
 * Main token query handler.
 * Retrieves token info from multiple sources (DexScreener, CoinGecko, Bitquery, Twitter),
 * merges extra fields, computes a security score, and computes profitability metrics for each sniper.
 */
export async function handleTokenQuery({ token, network }) {
  // Initialize variables with safe defaults.
  let dexscreenerData = {};
  let coinGeckoData = {};
  let priceData = 0;
  let sniperData = {};
  let lpInfo = {};
  let twitterData = [];
  let fudTweets = [];

  // 1. DexScreener token info (needed for pairAddress, baseToken, etc.)
  try {
    dexscreenerData = await dexscreener.getTokenInfoByAddressBig(token);
  } catch (err) {
    console.warn('DexScreener error:', err);
  }
 // console.log('Dexscreener =========================:', JSON.stringify(dexscreenerData, null, 2));

  // Destructure the main pair data from Dexscreener response.
  const dsPair = dexscreenerData?.pairs?.[0] || {};

  // 2. Use CoinGecko for token info.
  try {
    coinGeckoData = await searchCoin(token);
  } catch (err) {
    console.warn('CoinGecko token info error:', err);
  }
  console.log('✅✅ CoinGecko ✅✅ CoinGecko', JSON.stringify(priceData, null, 2));

  // 3. Token price details (prefer Dexscreener price; fallback to CoinGecko price)
  try {
    // Use dsPair.priceUsd instead of dexscreenerData.price.usd
    priceData = dsPair.priceUsd || 0;
    //console.log('Price Data =========================:', JSON.stringify(priceData, null, 2));
  } catch (err) {
    console.warn('Token price error:', err);
  }

  // 4. Determine token symbol from available data.
  const symbol =
    dsPair.baseToken?.symbol ||
    coinGeckoData?.attributes?.symbol ||
    'N/A';

  // 5. Retrieve sentiment data from Twitter.
  try {
    if (symbol && symbol !== 'N/A') {
      twitterData = await twitterService.searchTweetsByCashtagAPI(symbol);
    }
  } catch (err) {
    console.warn('Twitter error:', err);
    twitterData = [];
  }

  // 6. Retrieve FUD tweets (for phrases like "$SYMBOL scam ...")
  try {
    if (symbol && symbol !== 'N/A') {
      fudTweets = await getFudTweets(symbol);
    }
  } catch (err) {
    console.error('FUD tweets error:', err);
    fudTweets = [];
  }

  // 7. Retrieve sniper info and LP info:
  //    - Use Dexscreener pairAddress for sniper info via getTokenSnipers.
  //    - Get LP lock info from CoinGecko.
  try {
    const pairAddress = dsPair.pairAddress;
    if (pairAddress) {
      try {
        sniperData = await getTokenSnipers(network, pairAddress);
      } catch (err) {
        console.warn('Token snipers error (Moralis):', err);
      }
      try {
        lpInfo = await getLPInfoCoinGecko(pairAddress, network);
      } catch (lpErr) {
        console.warn('LP info error:', lpErr);
        lpInfo = { locked_liquidity_percentage: 'unavailable' };
      }
    }
  } catch (err) {
    console.warn('Token sniper info error:', err);
  }

  // 8. Compute security score using extra metrics:
  //    - Use GT score (gt_score) from CoinGecko.
  //    - LP lock check: if locked_liquidity_percentage is 0 or unavailable, flag as risky.
  //    - Pair creation date: if less than 5 days old, flag as risky.
  //    - Sniper activity: if any sniper shows >3% profit, flag as risky.
  let baseSecurityScore = coinGeckoData?.attributes?.gt_score || 100;
  const securityNotes = [];

  // LP Lock check:
  let lpLockPct = parseFloat(lpInfo.locked_liquidity_percentage) || 0;
  if (lpLockPct === 0) {
    baseSecurityScore -= 20;
    securityNotes.push('No locked liquidity detected.');
  }

  // Pair creation date check:
  const now = Date.now();
  if (dsPair.pairCreatedAt) {
    const pairCreatedAt = new Date(dsPair.pairCreatedAt).getTime();
    const diffDays = (now - pairCreatedAt) / (1000 * 60 * 60 * 24);
    if (diffDays < 5) {
      baseSecurityScore -= 20;
      securityNotes.push('Pair created less than 5 days ago.');
    }
  }

  // Sniper activity check:
  let sniperRisk = false;
  if (Array.isArray(sniperData?.data) && sniperData.data.length > 0) {
    sniperRisk = sniperData.data.some(s => {
      const totalSnipedUsd = Number(s.totalSnipedUsd) || 0;
      const totalSoldUsd = Number(s.totalSoldUsd) || 0;
      const profitUsd = totalSoldUsd - totalSnipedUsd;
      const profitPercentage = totalSnipedUsd > 0 ? (profitUsd / totalSnipedUsd) * 100 : 0;
      return profitPercentage > 3;
    });
    if (sniperRisk) {
      baseSecurityScore -= 20;
      securityNotes.push('Significant sniper activity detected.');
    }
  }
  baseSecurityScore = Math.max(0, Math.min(100, baseSecurityScore));

  // Extract social links from dsPair.info.socials array.
  const socials = dsPair.info?.socials || [];
  const twitterLink =
    socials.find(s => s.type === 'twitter')?.url ||
    coinGeckoData?.attributes?.twitter_handle ||
    'none published';
  const telegramLink =
    socials.find(s => s.type === 'telegram')?.url ||
    'none published';
  const websiteLink =
    dsPair.info?.websites?.[0]?.url ||
    (coinGeckoData?.attributes?.websites ? coinGeckoData.attributes.websites[0] : 'none published');

  // 9. Build and return the final combined response.
  return {
    token: {
      address: token,
      name: dsPair.baseToken?.name || coinGeckoData?.attributes?.name || '',
      symbol,
      decimals: coinGeckoData?.attributes?.decimals || 'N/A',
      network,
      logo: dsPair.info?.imageUrl || coinGeckoData?.attributes?.image_url || '',
      description: dsPair.info?.websites ? '' : coinGeckoData?.attributes?.description || '',
      socials: {
        twitter: twitterLink,
        telegram: telegramLink,
        website: websiteLink,
      },
      extra: {
        gtScore: coinGeckoData?.attributes?.gt_score,
        holders: coinGeckoData?.attributes?.holders,
      }
    },
    price: {
      current: priceData || dsPair.priceUsd || null,
      change24h: dsPair.priceChange?.h24 || null,
      volume24h: dsPair.volume?.h24 || null,
    },
    market: {
      mcap: dsPair.marketCap || null,
      liquidity: dsPair.liquidity?.usd || null,
      pairAddress: dsPair.pairAddress || null,
    },
    security: {
      score: baseSecurityScore,
      notes: securityNotes,
      lpLock: lpInfo.locked_liquidity_percentage || 'unavailable',
      pairCreatedAt: dsPair.pairCreatedAt || 'unavailable',
      issues: detectSecurityIssues({
        mintable: false, // Adjust if you have that data
        proxy: false,
        holders: coinGeckoData?.attributes?.holders?.count || 0,
      }),
      snipers: Array.isArray(sniperData?.data)
        ? sniperData.data.map(sniper => {
            const totalSnipedUsd = Number(sniper.totalSnipedUsd) || 0;
            const totalSoldUsd = Number(sniper.totalSoldUsd) || 0;
            const profitUsd = totalSoldUsd - totalSnipedUsd;
            const profitPercentage = totalSnipedUsd > 0 ? (profitUsd / totalSnipedUsd) * 100 : 0;
            return {
              walletAddress: sniper.walletAddress,
              snipedTransactions: sniper.snipedTransactions,
              sellTransactions: sniper.sellTransactions,
              totalSellTransactions: sniper.totalSellTransactions,
              totalSnipedTransactions: sniper.totalSnipedTransactions,
              totalTokensSniped: sniper.totalTokensSniped,
              totalSnipedUsd: sniper.totalSnipedUsd,
              totalTokensSold: sniper.totalTokensSold,
              totalSoldUsd: sniper.totalSoldUsd,
              currentBalance: sniper.currentBalance,
              currentBalanceUsdValue: sniper.currentBalanceUsdValue,
              realizedProfitUsd:
                typeof sniper.realizedProfitUsd !== 'undefined'
                  ? sniper.realizedProfitUsd
                  : profitUsd,
              realizedProfitPercentage:
                typeof sniper.realizedProfitPercentage !== 'undefined'
                  ? sniper.realizedProfitPercentage
                  : profitPercentage,
            };
          })
        : 'unavailable',
    },
    social: {
      sentiment: {
        score: calculateSentimentFromTweets(twitterData),
        distribution: getSentimentDistribution(twitterData)
      },
      mentions24h: twitterData.length,
      engagement24h: calculateEngagement(twitterData),
      recentTweets: twitterData.slice(0, 5).map(tweet => ({
        text: tweet.text,
        sentiment: tweet.sentiment,
        engagement: (tweet.likeCount || 0) + (tweet.retweetCount || 0),
        url: tweet.url,
      })),
      fud: fudTweets
    },
    timestamp: new Date().toISOString(),
  };
}



// ------------------------------
// HELPER FUNCTIONS
// ------------------------------
function calculateSecurityScore(tokenData) {
  let score = 100;
  if (tokenData.mintable) score -= 10;
  if (tokenData.proxy) score -= 5;
  if (tokenData.holders && tokenData.holders < 100) score -= 20;
  return Math.max(0, score);
}

function detectSecurityIssues(tokenData) {
  const issues = [];
  if (tokenData.mintable) {
    issues.push({
      type: 'warning',
      message: 'Token is mintable – supply can be increased',
    });
  }
  if (tokenData.proxy) {
    issues.push({
      type: 'info',
      message: 'Token uses proxy contract – logic can be upgraded',
    });
  }
  if (tokenData.holders && tokenData.holders.distribution_percentage) {
    const top10 = tokenData.holders.distribution_percentage.top_10;
    if (top10 && parseFloat(top10) > 50) {
      issues.push({
        type: 'warning',
        message: 'Top 10 holders control more than 50% of tokens.',
      });
    }
  }
  return issues;
}

function calculateSentimentFromTweets(tweets) {
  if (!tweets.length) return 0;
  const sentiments = tweets.map(t => {
    const sentiment = t.sentiment?.trim().toLowerCase();
    if (sentiment === 'bullish') return 1;
    if (sentiment === 'bearish') return -1;
    return 0;
  });
  return sentiments.reduce((a, b) => a + b, 0) / tweets.length;
}

function getSentimentDistribution(tweets) {
  return tweets.reduce((acc, tweet) => {
    const s = tweet.sentiment?.trim().toLowerCase();
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});
}

function calculateEngagement(tweets) {
  return tweets.reduce((sum, t) =>
    sum + (t.likeCount || 0) + (t.retweetCount || 0) + (t.replyCount || 0) + (t.quoteCount || 0),
    0
  );
}

function withTimeout(promise, ms, fallbackValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), ms))
  ]);
}

export async function handleSentimentQuery({ query, network }) {
  console.log('🔍 API Call: Sentiment Scrub for >>>> ', query);
  try {
    let symbol = query;
    let tokenInfo = null;

    // If query is an address, use DexScreener to get token info.
    if (query.match(/^0x[a-fA-F0-9]{40}$/) ||
        query.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      tokenInfo = await dexscreener.getTokenInfoByAddress(query);
      console.log('Token info:', tokenInfo);
      symbol = tokenInfo?.symbol;
      if (!symbol) {
        throw new Error('Could not resolve token symbol from address');
      }
    }

    // Use our withTimeout() wrapper so that Twitter calls never hang.
    const twitterData = await withTimeout(
      twitterService.searchTweetsByCashtagAPI(symbol),
      60000,  // 60 seconds timeout
      []      // Fallback empty array if Twitter call times out
    );
    console.log('Twitter Data:', twitterData);

    // Calculate sentiment metrics.
    const sentimentCounts = twitterData.reduce((acc, tweet) => {
      const s = tweet.sentiment?.trim().toLowerCase();
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});

    const totalTweets = twitterData.length;
    const bullishCount = sentimentCounts.bullish || 0;
    const bearishCount = sentimentCounts.bearish || 0;
    const sentimentScore = totalTweets > 0 ? (bullishCount - bearishCount) / totalTweets : 0;

    // Calculate engagement metrics.
    const engagement = twitterData.reduce((acc, tweet) => {
      return acc + tweet.likeCount + tweet.retweetCount + tweet.replyCount + tweet.quoteCount;
    }, 0);

    // Build combined response.
    return {
      token: tokenInfo ? {
        symbol,
        name: tokenInfo.name,
        address: tokenInfo.address,
        network,
        logo: tokenInfo.info?.imageUrl,
        description: tokenInfo.info?.description,
        socials: {
          twitter: tokenInfo.info?.socials?.find(s => s.type === 'twitter')?.url,
          telegram: tokenInfo.info?.socials?.find(s => s.type === 'telegram')?.url,
          website: tokenInfo.info?.websites?.[0]
        }
      } : { symbol },
      sentiment: {
        score: sentimentScore,
        distribution: {
          bullish: bullishCount,
          bearish: bearishCount,
          neutral: totalTweets - bullishCount - bearishCount
        },
        confidence: Math.min(totalTweets / 100, 1)
      },
      metrics: {
        mentions: totalTweets,
        engagement,
        uniqueUsers: new Set(twitterData.map(t => t.id)).size
      },
      tweets: twitterData.map(tweet => ({
        id: tweet.id,
        text: tweet.text,
        sentiment: tweet.sentiment,
        metrics: {
          likes: tweet.likeCount,
          retweets: tweet.retweetCount,
          replies: tweet.replyCount,
          quotes: tweet.quoteCount
        },
        url: tweet.url,
        createdAt: tweet.createdAt
      })),
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Sentiment API Error:', error);
    throw error;
  }
}

/*
OLD DEPRECATED - Backup for Moralis based token info with security scores and risks

import {
  getTokenPrice,
  getEVMTokenInfo,
  getSolanaTokenInfo,
  getTokenSnipers,
  getTokenSymbol,
} from '../../../services/tokens/MoralisTokenService.js';
import { dexscreener } from '../../../services/dexscreener/index.js';
import { twitterService } from '../../../services/twitter/index.js';

// ------------------------------
// TOKEN QUERY HANDLER
// ------------------------------
export async function handleTokenQuery({ token, network }) {
  // Initialize variables with defaults so that if one fetch fails we still have a value.
  let dexscreenerData = {};
  let moralisData = {};
  let priceData = {};
  let sniperData = {};
  let twitterData = [];

  // 1. Dexscreener token info (needed for pairAddress and symbol)
  try {
    dexscreenerData = await dexscreener.getTokenInfoByAddress(token);
  } catch (err) {
    console.error('Dexscreener error:', err);
  }

  // 2. Moralis token metadata (using our service function which converts chain names)
  try {
    if (network.toLowerCase() === 'solana') {
      moralisData = await getSolanaTokenInfo(token);
    } else {
      moralisData = await getEVMTokenInfo(network, token);
    }
  } catch (err) {
    console.error('Moralis token info error:', err);
  }

  // 3. Token price details
  try {
    priceData = await getTokenPrice(network, token);
  } catch (err) {
    console.error('Token price error:', err);
  }

  // 4. Token sniper info – using the pair address from dexscreener if available.
  try {
    const pairAddress = dexscreenerData?.pairAddress;
    if (pairAddress) {
      sniperData = await getTokenSnipers(network, pairAddress);
    }
  } catch (err) {
    console.error('Token snipers error:', err);
  }

  // 5. Determine token symbol using available data.
  const symbol =
    dexscreenerData?.baseToken?.symbol ||
    dexscreenerData?.symbol ||
    moralisData?.data?.token_symbol ||
    '';

  // 6. Retrieve sentiment data from Twitter.
  try {
    twitterData = await twitterService.searchTweetsByCashtag(symbol);
  } catch (err) {
    console.error('Twitter error:', err);
  }

  // 7. Build and return the combined response.
  return {
    token: {
      address: token,
      name: dexscreenerData?.name || moralisData?.data?.name || '',
      symbol,
      network,
      logo: dexscreenerData?.info?.imageUrl || '',
      description: dexscreenerData?.info?.description || '',
      socials: {
        twitter:
          dexscreenerData?.info?.socials?.find((s) => s.type === 'twitter')?.url || '',
        telegram:
          dexscreenerData?.info?.socials?.find((s) => s.type === 'telegram')?.url || '',
        website:
          (dexscreenerData?.info?.websites && dexscreenerData.info.websites[0]) || '',
      },
    },
    price: {
      current: priceData?.data?.priceUsd || dexscreenerData?.priceUsd || null,
      change24h: dexscreenerData?.priceChange?.h24 || null,
      volume24h: dexscreenerData?.volume?.h24 || null,
    },
    market: {
      mcap: dexscreenerData?.marketCap || null,
      liquidity: dexscreenerData?.liquidity?.usd || null,
      holders: moralisData?.data?.holders || null,
      pairAddress: dexscreenerData?.pairAddress || null,
    },
    security: {
      score: calculateSecurityScore(moralisData?.data || {}),
      issues: detectSecurityIssues(moralisData?.data || {}),
      snipers: Array.isArray(sniperData?.data)
        ? sniperData.data.map((sniper) => ({
            walletAddress: sniper.walletAddress,
            snipedTransactions: sniper.snipedTransactions,
            sellTransactions: sniper.sellTransactions,
            totalSellTransactions: sniper.totalSellTransactions,
            totalSnipedTransactions: sniper.totalSnipedTransactions,
            totalTokensSniped: sniper.totalTokensSniped,
            totalSnipedUsd: sniper.totalSnipedUsd,
            totalTokensSold: sniper.totalTokensSold,
            totalSoldUsd: sniper.totalSoldUsd,
            currentBalance: sniper.currentBalance,
            currentBalanceUsdValue: sniper.currentBalanceUsdValue,
            realizedProfitPercentage: sniper.realizedProfitPercentage,
            realizedProfitUsd: sniper.realizedProfitUsd,
          }))
        : [],
    },
    social: {
      sentiment: {
        score: calculateSentimentFromTweets(twitterData),
        distribution: getSentimentDistribution(twitterData),
      },
      mentions24h: twitterData.length,
      engagement24h: calculateEngagement(twitterData),
      recentTweets: twitterData.slice(0, 5).map((tweet) => ({
        text: tweet.text,
        sentiment: tweet.sentiment,
        engagement: tweet.likeCount + tweet.retweetCount,
        url: tweet.url,
      })),
    },
    timestamp: new Date().toISOString(),
  };
}

*/