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

// ------------------------------
// HELPER FUNCTIONS (unchanged)
// ------------------------------
function calculateSecurityScore(tokenData) {
  let score = 100;
  if (tokenData.mintable) score -= 10;
  if (tokenData.proxy) score -= 5;
  if (tokenData.holders < 100) score -= 20;
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
  return issues;
}

function calculateSentimentFromTweets(tweets) {
  if (!tweets.length) return 0;
  const sentiments = tweets.map((t) => {
    const sentiment = t.sentiment?.trim().toLowerCase();
    if (sentiment === 'bullish') return 1;
    if (sentiment === 'bearish') return -1;
    return 0;
  });
  return sentiments.reduce((a, b) => a + b, 0) / tweets.length;
}

function getSentimentDistribution(tweets) {
  return tweets.reduce((acc, tweet) => {
    const sentiment = tweet.sentiment?.trim().toLowerCase();
    acc[sentiment] = (acc[sentiment] || 0) + 1;
    return acc;
  }, {});
}

function calculateEngagement(tweets) {
  return tweets.reduce(
    (sum, t) =>
      sum + t.likeCount + t.retweetCount + t.replyCount + t.quoteCount,
    0
  );
}


// Helper: Returns promise resolution or fallback after ms milliseconds.
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
