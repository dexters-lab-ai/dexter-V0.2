import { twitterService } from '../../../services/twitter/index.js';
import { dexscreener } from '../../../services/dexscreener/index.js';
import Moralis from 'moralis';

export async function handleSentimentQuery({ query, network }) {
  try {
    let symbol = query;
    let tokenInfo = null;

    // If query is an address, get symbol and info from dexscreener
    if (query.match(/^0x[a-fA-F0-9]{40}$/) || query.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      tokenInfo = await dexscreener.getTokenInfoByAddress(query);
      symbol = tokenInfo?.symbol;
      if (!symbol) {
        throw new Error('Could not resolve token symbol from address');
      }
    }

    // Get sentiment data using searchTweetsByCashtag
    const twitterData = await twitterService.searchTweetsByCashtag(symbol);

    // Calculate sentiment metrics
    const sentimentCounts = twitterData.reduce((acc, tweet) => {
      const sentiment = tweet.sentiment?.trim().toLowerCase();
      acc[sentiment] = (acc[sentiment] || 0) + 1;
      return acc;
    }, {});

    const totalTweets = twitterData.length;
    const bullishCount = sentimentCounts.bullish || 0;
    const bearishCount = sentimentCounts.bearish || 0;
    const sentimentScore = totalTweets > 0 ? (bullishCount - bearishCount) / totalTweets : 0;

    // Calculate engagement metrics
    const engagement = twitterData.reduce((acc, tweet) => {
      return acc + tweet.likeCount + tweet.retweetCount + tweet.replyCount + tweet.quoteCount;
    }, 0);

    // Format response
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

export async function handleTokenQuery({ token, network }) {
  try {
    // Get detailed token info from dexscreener
    const dexscreenerData = await dexscreener.getTokenInfoByAddress(token);
    
    // Get Moralis data including sniper info
    const moralisData = await Moralis.EvmApi.token.getTokenMetadata({
      addresses: [token],
      chain: network
    });

    // Get sniper data if EVM network
    let sniperData = null;
    if (network !== 'solana') {
      sniperData = await Moralis.EvmApi.token.getTokenSnipers({
        chain: network,
        token: token
      });
    }

    // Get sentiment data
    const symbol = dexscreenerData?.symbol || moralisData?.symbol;
    const twitterData = await twitterService.searchTweetsByCashtag(symbol);

    // Format response
    return {
      token: {
        address: token,
        name: dexscreenerData?.name || moralisData?.name,
        symbol: symbol,
        network,
        logo: dexscreenerData?.info?.imageUrl,
        description: dexscreenerData?.info?.description,
        socials: {
          twitter: dexscreenerData?.info?.socials?.find(s => s.type === 'twitter')?.url,
          telegram: dexscreenerData?.info?.socials?.find(s => s.type === 'telegram')?.url,
          website: dexscreenerData?.info?.websites?.[0]
        }
      },
      price: {
        current: dexscreenerData?.price,
        change24h: dexscreenerData?.priceChange24h,
        volume24h: dexscreenerData?.volume24h
      },
      market: {
        mcap: dexscreenerData?.marketCap,
        liquidity: dexscreenerData?.liquidity?.usd,
        holders: moralisData?.holders,
        pairAddress: dexscreenerData?.pairAddress
      },
      security: {
        score: calculateSecurityScore(moralisData),
        issues: detectSecurityIssues(moralisData),
        snipers: sniperData?.result?.map(sniper => ({
          address: sniper.address,
          totalBuys: sniper.totalBuys,
          totalSells: sniper.totalSells,
          profitLoss: sniper.profitLoss,
          firstBuy: sniper.firstBuy,
          avgHoldTime: sniper.avgHoldTime
        })) || []
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
          engagement: tweet.likeCount + tweet.retweetCount,
          url: tweet.url
        }))
      },
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error('Token API Error:', error);
    throw error;
  }
}

// Helper functions
function calculateSecurityScore(tokenData) {
  // Implement security scoring based on contract analysis
  let score = 100;
  
  // Deduct points for various risk factors
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
      message: 'Token is mintable - supply can be increased'
    });
  }
  
  if (tokenData.proxy) {
    issues.push({
      type: 'info',
      message: 'Token uses proxy contract - logic can be upgraded'
    });
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
    const sentiment = tweet.sentiment?.trim().toLowerCase();
    acc[sentiment] = (acc[sentiment] || 0) + 1;
    return acc;
  }, {});
}

function calculateEngagement(tweets) {
  return tweets.reduce((sum, t) => {
    return sum + t.likeCount + t.retweetCount + t.replyCount + t.quoteCount;
  }, 0);
}
