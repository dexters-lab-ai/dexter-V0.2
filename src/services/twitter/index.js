import axios from 'axios';
import { EventEmitter } from 'events';
import { ApifyClient } from 'apify-client';
import { User } from '../../models/User.js';
import { tradeService } from '../trading/TradeService.js';
import { intentProcessor } from '../ai/processors/IntentProcessor.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { config } from '../../core/config.js';
import Bull from 'bull';

////////////////////////////////////////////////////////////////////////////////
// 1. BULL QUEUE SETUP
////////////////////////////////////////////////////////////////////////////////

/**
 * Set up a Bull queue to handle repeated jobs for KOL monitors.
 * Each job runs "checkNewTweets" for a particular userId and handle.
 */
export const kolMonitorQueue = new Bull('kolMonitorQueue', {
  // Provide your Redis connection info here
  redis: {
    host: config.redisHost,
    port: config.redisPort,
    // password: config.redisPassword, // if needed
  },
});

/**
 * The worker/processor function for each KOL monitor job.
 * This is the "heart" of the monitoring logic—Bull will call it automatically
 * at the scheduled interval.
 */
kolMonitorQueue.process(async (job) => {
  // job.data will contain { userId, handle, amount } (plus any other data you add)
  const { userId, handle, amount } = job.data;
  
  try {
    // Create or get an instance of TwitterService
    // (We’re going to assume we have a singleton below)
    await twitterService.checkNewTweets(userId, handle, amount);
  } catch (error) {
    await ErrorHandler.handle(error);
    throw error; // Let Bull handle retries if configured
  }
});

////////////////////////////////////////////////////////////////////////////////
// 2. TWITTER SERVICE CLASS
////////////////////////////////////////////////////////////////////////////////

class TwitterService extends EventEmitter {
  constructor() {
    super();
    this.apifyClient = new ApifyClient({ token: config.apifyApiKey });
    
    // Optional caches & rate-limits
    this.searchCache = new Map();
    this.searchCounts = new Map();
    this.lastResetTime = Date.now();

    // We no longer store activeMonitors in memory for scheduling,
    // because Bull is handling that. We *can* keep track for quick lookups if needed.
    this.activeMonitors = new Map();

    this.initialized = false;
  }

  /**
   * Initialize the TwitterService:
   * - Restores all active KOL monitors from the DB
   * - Schedules them as repeatable Bull jobs (instead of local setInterval)
   */
  async initialize() {
    if (this.initialized) return;
    try {
      await this.restoreActiveMonitors();
      this.initialized = true;
      console.log('✅ TwitterService initialized');
    } catch (error) {
      console.error('❌ Error initializing TwitterService:', error);
      throw error;
    }
  }

  /**
   * Reads all users who have "kol.monitors" with `enabled: true`
   * and schedules them in the job queue if not already scheduled.
   */
  async restoreActiveMonitors() {
    try {
      // Only look for users who have a non-empty KOL monitors array and kol.enabled = true
      const users = await User.find({
        'settings.kol.monitors': { $exists: true, $ne: [] },
        'settings.kol.enabled': true,
      });
  
      for (const user of users) {
        for (const monitor of user.settings.kol.monitors) {
          if (monitor.handle && monitor.handle.trim() && monitor.enabled) {
            await this._scheduleKOLMonitorJob(user.telegramId, monitor.handle, monitor.amount);
          }
        }
      }
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }  

  /**
   * Validate a Twitter handle by calling your Apify client quickly
   */
  async validateHandle(handle) {
    try {
      const run = await this.apifyClient.actor('danek/twitter-timeline').call({
        usernames: [handle],
        maxItems: 1,
      });
      const [profile] = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
      return !!profile;
    } catch (error) {
      return false;
    }
  }

  /**
   * Public method to start (schedule) KOL monitoring for a user & handle.
   * This sets "enabled: true" in the DB and creates a Bull repeatable job.
   */
  async startKOLMonitoring(userId, handle, amount) {
    try {
      // 1. Load the user doc
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user) throw new Error(`User not found: ${userId}`);
  
      // 2. Work only with kol.monitors
      //    (Assume user.settings.kol exists or create it)
      if (!user.settings.kol) {
        user.settings.kol = { enabled: true, monitors: [] };
      }
      let monitorsArray = user.settings.kol.monitors || [];
  
      // 3. Find or create a monitor
      let monitor = monitorsArray.find((m) => m.handle === handle);
      if (!monitor) {
        monitor = { handle, amount: amount || 0, enabled: true };
        monitorsArray.push(monitor);
      }
  
      // 4. Enable it, set amount
      monitor.enabled = true;
      if (amount) {
        monitor.amount = amount;
      }
  
      // 5. PARTIAL UPDATE: write the array back to the DB
      await User.updateOne(
        { telegramId: userId.toString() },
        {
          $set: {
            'settings.kol.enabled': true,
            'settings.kol.monitors': monitorsArray,
          }
        },
        { runValidators: false } // skip entire doc validation
      );
  
      // 6. Schedule job with Bull
      await this._scheduleKOLMonitorJob(userId, handle, monitor.amount);
  
      console.log(`✅ Started monitoring @${handle} for user ${userId}`);
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }
  

  /**
   * Creates or updates a *repeatable* job in Bull to check tweets every minute.
   * If you want a different interval, adjust the repeat `cron` or `every`.
   */
  async _scheduleKOLMonitorJob(userId, handle, amount) {
    // We create a unique job ID so that re-adding the same job
    // won't create duplicates, but it will keep the same schedule.
    const jobId = `kolMonitor:${userId}:${handle}`;
    
    // e.g., run job every 60 seconds
    await kolMonitorQueue.add(
      { userId, handle, amount },
      {
        jobId,
        repeat: { every: 60000 }, // run every 60s
        removeOnComplete: true,
        removeOnFail: false,
      }
    );

    // Optionally store in memory as well if you like
    this.activeMonitors.set(jobId, {
      userId,
      handle,
      amount,
      lastScheduled: new Date(),
    });
  }

  /**
   * The method that the Bull queue processor calls each minute (or your interval).
   * It fetches new tweets since the last check, processes them, and updates `lastChecked`.
   */
  async checkNewTweets(userId, handle, amount) {
    try {
      // 1. Load user & find the relevant monitor
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user) return;
  
      const monitorsArray = user.settings?.kol?.monitors || [];
      const monitor = monitorsArray.find((m) => m.handle === handle);
      if (!monitor || !monitor.enabled) return;
  
      // 2. Compute dates: end is today; start is 1 day ago
      const now = new Date();
      const endDate = now.toISOString().split('T')[0];
      const startDate = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
  
      const input = {
        "cookies": [config.apifyCookieToken],
        "endTime": endDate,
        "maxItems": 20,
        "onlyBuleVerifiedUsers": false,
        "onlyImage": false,
        "onlyQuote": false,
        "onlyReply": false,
        "onlyVerifiedUsers": false,
        "onlyVideo": false,
        "searchTerms": [
            "from:elonmusk"
        ],
        "sortBy": "Latest",
        "startTime": startDate,
      };

      // 3. Fetch tweets  
      const run = await this.apifyClient.actor("apidojo/tweet-scraper").call(input);
      const tweets = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
      if (!tweets || !tweets.length) return;
  
      // 4. Process each new tweet
      const tradeAmount = amount || monitor.amount || 0;
      for (const tweet of tweets) {
        await this.processTweet(userId, tweet, tradeAmount);
      }
  
      // 5. Update lastChecked
      const newestTweetTime = new Date();
  
      // PARTIAL UPDATE with arrayFilters
      await User.updateOne(
        { telegramId: userId.toString(), 'settings.kol.monitors.handle': handle },
        {
          $set: {
            'settings.kol.monitors.$[m].lastChecked': newestTweetTime
          }
        },
        {
          arrayFilters: [{ 'm.handle': handle }],
          runValidators: false
        }
      );
  
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }  

  /**
   * Method to process a single tweet (extract token, buy, etc.)
   */
  async processTweet(userId, tweet, amount, networkOverride) {
    try {
      const tokenInfo = this.extractTokenInfo(tweet.text);
      if (!tokenInfo) return;
      const { symbol, address } = tokenInfo;
  
      // Determine network: use override if provided, else use intentProcessor.
      const network = networkOverride || (await intentProcessor.getTokenNetwork(address));
      if (!network) {
        console.warn(`Could not determine network for token address: ${address}`);
        return;
      }
  
      // Retrieve the wallet for trade.
      const walletObj = await getWalletForTrade(userId, network);
      if (!walletObj) {
        console.warn(`No valid wallet found for user ${userId} on network ${network}`);
        return;
      }
  
      // Build trade parameters.
      const tradeParams = {
        userId,
        network,
        action: 'buy', // Default action for KOL trades.
        tokenAddress: address,
        amount: amount.toString(),
        walletAddress: walletObj.address,
        options: { slippage: 1, autoApprove: true }
      };
  
      // For EVM, tradeService.executeTrade will eventually route to evmQuickNode.startEVMSwap,
      // which expects the wallet signer. For Solana, it routes to jupiterQuickNode.startJupiterSwap.
      await tradeService.executeTrade(tradeParams);
  
      this.emit('kolTrade', {
        userId,
        symbol,
        address,
        network,
        amount,
        tweet: tweet.url,
      });
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  extractTokenInfo(text) {
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/);
    if (!addressMatch) return null;
    const symbolMatch = text.match(/\$([A-Z0-9]+)/);
    return {
      address: addressMatch[0],
      symbol: symbolMatch ? symbolMatch[1] : 'Unknown',
    };
  }

  /**
   * Stop monitoring by removing the repeatable job in Bull and marking `enabled = false`.
   */
  async stopKOLMonitoring(userId, handle) {
    try {
      // Mark the matching handle's monitor as disabled
      await User.updateOne(
        { telegramId: userId.toString(), 'settings.kol.monitors.handle': handle },
        {
          $set: {
            'settings.kol.monitors.$[m].enabled': false,
          }
        },
        {
          arrayFilters: [{ 'm.handle': handle }],
          runValidators: false
        }
      );
  
      // Remove the repeatable Bull job
      const jobId = `kolMonitor:${userId}:${handle}`;
      const repeatableJobs = await kolMonitorQueue.getRepeatableJobs();
      const jobToRemove = repeatableJobs.find((j) => j.id === jobId);
      if (jobToRemove) {
        await kolMonitorQueue.removeRepeatableByKey(jobToRemove.key);
      }
  
      // Remove from local map if present
      this.activeMonitors.delete(jobId);
  
      console.log(`✅ Stopped monitoring @${handle} for user ${userId}`);
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }  

  /////////////////////////////////////////////////////////////////////////////
  // The rest of your existing methods remain mostly unchanged
  /////////////////////////////////////////////////////////////////////////////
  
  /**
   * getTrenchChatter, discoverTrenches, searchTweetsByCashtag, etc.
   * They stay the same, except you can remove references to setInterval or activeMonitors
   * if they appear. Below are direct copies of your existing code with no changes.
   */
  
  async getTrenchChatter() {
    try {
      // Compute dates: end is today; start is 7 days ago
      const now = new Date();
      const endDate = now.toISOString().split('T')[0];
      const startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split('T')[0];
  
      const input = {
        customMapFunction: "(object) => { return {...object} }",
        end: endDate,  // ending date: today
        includeSearchTerms: false,
        maxItems: 100,
        minimumFavorites: 10,
        minimumReplies: 5,
        minimumRetweets: 2,
        onlyImage: false,
        onlyQuote: false,
        onlyTwitterBlue: false,
        onlyVerifiedUsers: false,
        onlyVideo: false,
        searchTerms: [
          "(best) (AI Agents)",
          "(mindshare) (gainers) (agent)",
          "(top) (trending tokens)",
          "crypto market sentiment",
          "(top meme coins) (week)",
          "(DEFAI projects) (top)",
          "(top) (this week) (gains) (tokens) (on Solana)",
          "(GFM) (launches)",
          "(agent) (by mindshare)",
          "(DEFAI) (gaining)",
          "(projects gaining) (infra)",
          "(highest ROI) (this week)",
          "(mooning) (token) (today) (launch)",
          "token watch",
        ],
        sort: "Latest",
        start: startDate,  // starting date: 7 days ago
        startUrls: [
          "https://twitter.com/cookiedotfun",
          "https://twitter.com/MindAIAgent/with_replies",
        ],
        tweetLanguage: "en",
        twitterHandles: [
          "MindAIAgent",
          "cookiedotfun",
          "mobyagent",
          "solana_daily",
        ],
      };
  
      const run = await this.apifyClient.actor("apidojo/tweet-scraper").call(input);
      const { items } = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
  
      items.forEach((tweet, index) => {
        console.log(`[Tweet ${index + 1}]`, JSON.stringify(tweet, null, 2));
      });
  
      const formattedTweets = items.map((tweet) => {
        const mainUrl = tweet.url || `https://twitter.com/i/web/status/${tweet.id}`;
        let text = tweet.text || "";
        if (text.length > 300) {
          text = text.slice(0, 300) + "...";
        }
        return {
          id: tweet.id,
          twitterUrl: mainUrl,
          text,
          retweetCount: tweet.retweetCount || 0,
          replyCount: tweet.replyCount || 0,
          likeCount: tweet.likeCount || 0,
          quoteCount: tweet.quoteCount || 0,
          createdAt: this.getRelativeTime(tweet.createdAt),
        };
      });
  
      console.log("[X] Formatted Tweets:", JSON.stringify(formattedTweets, null, 2));
      return formattedTweets;
    } catch (error) {
      console.error("Error in getTrenchChatter:", error);
      await ErrorHandler.handle(error);
      return [];
    }
  }

  getRelativeTime(timestamp) {
    const tweetDate = new Date(timestamp);
    const now = new Date();
    const diffMs = now - tweetDate;

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remainderHours = hours % 24;
      return `${days} day${days === 1 ? "" : "s"}${
        remainderHours > 0
          ? ", " + remainderHours + " hour" + (remainderHours === 1 ? "" : "s")
          : ""
      } ago`;
    } else if (hours > 0) {
      return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    } else {
      return "just now";
    }
  }

  async searchTweetsByCashtag(userId, cashtag, minLikes = 0, minRetweets = 0, minReplies = 0) {
    try {
      await this.checkRateLimits(userId);
      const cleanCashtag = cashtag.toLowerCase().trim();
      if (!cleanCashtag) {
        console.warn('Cashtag is empty or invalid, skipping search.');
        return [];
      }
  
      console.log("Cleaned cashtag:", cleanCashtag, "minLikes:", minLikes, "minRetweets:", minRetweets, "minReplies:", minReplies);
  
      const input = {
        cashtag: cleanCashtag,
        cookies: [config.apifyCookieToken],
        onlyBuleVerifiedUsers: false,
        onlyVerifiedUsers: false,
        sentimentAnalysis: true,
        sortBy: "Latest",
        maxItems: 50,
        minRetweets,
        minLikes,
        minReplies,
      };
  
      const run = await this.apifyClient
        .actor("fastcrawler/twitter-cashtag-scraper-stock-crypto-sentiment-analysis")
        .call(input);
  
      const { items } = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
  
      const filteredTweets = items.filter(
        (tweet) =>
          tweet.likeCount >= minLikes &&
          tweet.retweetCount >= minRetweets &&
          tweet.replyCount >= minReplies
      );
  
      const limitedTweets = filteredTweets.slice(0, 50);
      const formattedTweets = this.formatTweets(limitedTweets);
  
      this.cacheResults(cleanCashtag, formattedTweets);
  
      return formattedTweets;
    } catch (error) {
      console.error(`❌ Error searching tweets for cashtag "${cashtag}":`, error);
      await ErrorHandler.handle(error);
      return [];
    }
  }

  // Fallback Apify Only multi pattern search
  /**
 * searchTwitter
 * -------------
 * Perform multi-operator queries using Apify, combining:
 * - query (cashtag, phrase, address)
 * - optional date filters (from, to)
 * - optional class: 'content', 'users', 'geo', 'media'
 * - advanced operators array
 * - sortBy: 'Top' or 'Latest'
 * - maxItems: up to how many tweets to fetch
 *
 * Examples:
 *   - "PS5 for sale near:me filter:images" => class=geo, query="PS5 for sale", operators=["near:me","filter:images"]
 *   - "nasa OR esa" => class=content, operators=["nasa OR esa"]
 *   - "pictures from:elonmusk" => class=users, query="pictures", operators=["from:elonmusk","filter:images"] etc.
 */
  async searchTwitter({
    query,
    from,
    to,
    searchClass,      // "content" | "users" | "geo" | "media"
    operators = [],   // e.g. ["nasa OR esa", "near:\"New York\"", "filter:images"]
    sortBy = 'Latest',// "Top" or "Latest"
    maxItems = 100
  }) {
    try {
      // 1) Combine `query` + `operators[]` => baseSearch.
      //    e.g.: "PS5 for sale" + ["near:me","filter:images"] => "PS5 for sale near:me filter:images"
      let operatorString = operators.join(' ');
      const baseSearch = operatorString
        ? `${query} ${operatorString}`
        : query;

      // We'll store modifications in `additionalFilter` or do checks
      let additionalFilter = '';

      // 2) Interpret "class" to auto-add or ensure certain operators if not present
      switch (searchClass) {
        case 'content':
          // content => no default additions
          break;

        case 'users':
          // If user didn't specify "from:" or "to:", let's add a minimal placeholder
          if (
            !operatorString.toLowerCase().includes('from:') &&
            !operatorString.toLowerCase().includes('to:')
          ) {
            additionalFilter += ' from:someUser';
          }
          break;

        case 'geo':
          // For a geo search we might enforce "near:..." if not found
          if (
            !operatorString.toLowerCase().includes('near:') &&
            !operatorString.toLowerCase().includes('geocode:')
          ) {
            additionalFilter += ' near:me';
          }
          break;

        case 'media':
          // If user didn’t specify filter:media/images/videos/spaces, add 'filter:media'
          const opLower = operatorString.toLowerCase();
          if (
            !opLower.includes('filter:media') &&
            !opLower.includes('filter:images') &&
            !opLower.includes('filter:videos') &&
            !opLower.includes('filter:spaces')
          ) {
            additionalFilter += ' filter:media';
          }
          break;

        default:
          // unknown or not specified => do nothing
          break;
      }

      // 3) Construct final query string (trim in case additionalFilter is empty)
      const finalQuery = `${baseSearch}${additionalFilter}`.trim();

    //console.log('[searchTwitter] finalQuery =>', finalQuery);

      // 4) Date defaults (7 days ago -> from, current date -> to)
      const fromDate = from || this._getDefaultFromDate();
      const toDate = to || this._getDefaultToDate();

    //console.log('[searchTwitter] date range =>', fromDate, 'to', toDate, '| sortBy =>', sortBy, '| maxItems =>', maxItems);

      // 5) Build Apify input. We pass the finalQuery in "searchTerms"
      const input = {
        searchTerms: [finalQuery],        
        cookies: [config.apifyCookieToken],
        start: fromDate,
        end: toDate,
        maxItems: maxItems,
        sortBy, // "Latest" or "Top"
        tweetLanguage: "en",
      };

    //console.log('[searchTwitter] Apify input =>', JSON.stringify(input, null, 2));

      // 6) Call your Apify actor
      const run = await this.apifyClient.actor("fastcrawler/tweet-fast-scraper").call(input);
      const { items } = await this.apifyClient.dataset(run.defaultDatasetId).listItems();

    //console.log(`[searchTwitter] fetched ${items.length} results. First few raw items:`);
    //console.log(JSON.stringify(items.slice(0, 3), null, 2));

      // 7) Format results. Example: match your output example
      const formatted = items.map((tw) => ({
        type: tw.type || 'tweet',
        url: tw.url,
        text: tw.text,
        retweetCount: tw.retweetCount,
        replyCount: tw.replyCount,
        likeCount: tw.likeCount,
        quoteCount: tw.quoteCount,
        viewCount: tw.viewCount,
        createdAt: new Date(tw.createdAt).toLocaleString("en-US", { dateStyle: "short", timeStyle: "short" }),
        author: tw.author.username,
        media: tw.media,        
      }));      

      console.log('[searchTwitter] formatted results sample =>', JSON.stringify(formatted.slice(0, 3), null, 2));

      return formatted;
    } catch (error) {
      console.error('❌ [searchTwitter] Error:', error);
      await ErrorHandler.handle(error);
      return [];
    }
  }

  /**
   * _getDefaultFromDate
   * -------------------
   * Returns a YYYY-MM-DD string for 7 days ago
   */
  _getDefaultFromDate() {
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const dateObj = new Date(Date.now() - SEVEN_DAYS);
    return dateObj.toISOString().split('T')[0];
  }

  /**
   * _getDefaultToDate
   * -----------------
   * Returns a YYYY-MM-DD string for today's date
   */
  _getDefaultToDate() {
    const dateObj = new Date();
    return dateObj.toISOString().split('T')[0];
  }

  /**
   * formatTweets
   * -----------------
   * Returns a trimmed cleaned version of a tweet
   */
  formatTweets(tweets) {
    return tweets.map((tweet) => ({
      id: tweet.id,
      text:
        tweet.text.length > 200
          ? `${tweet.text.slice(0, 197)}...`
          : tweet.text,
      url: tweet.url,
      stats: {
        likes: tweet.likeCount || 0,
        retweets: tweet.retweetCount || 0,
        replies: tweet.replyCount || 0,
      },
      sentiment: tweet.sentiment?.trim() || "NA",
    }));
  }

  async checkRateLimits(userId) {
    const now = Date.now();
    const RESET_INTERVAL = 60000;

    if (now - this.lastResetTime > RESET_INTERVAL) {
      this.searchCounts.clear();
      this.lastResetTime = now;
    }

    const currentCount = this.searchCounts.get(userId) || 0;
    const MAX_SEARCHES = 10;

    if (currentCount >= MAX_SEARCHES) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    this.searchCounts.set(userId, currentCount + 1);
  }

  async discoverTrenches() {
    const cacheKey = 'trenches:cashtags';
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log('📦📦📦📦📦📦Returning cached results for discoverTrenches');
      return cached;
    }

    try {
      const accounts = ['solana_daily', 'mobyagent', 'cookiedotfun'];
      const tweetsByAccount = {};

      for (const account of accounts) {
        const accountTweets = await this.fetchTweetsFromAccount(account);
        tweetsByAccount[account] = accountTweets;
      }

      const accountData = accounts.map((account) => {
        const cashtagData = {};
        const relevantTweets = new Map();

        const tweets = tweetsByAccount[account];
        for (const tweet of tweets) {
          const cashtags = this.extractCashtags(tweet);
          if (cashtags.length < 1) continue;

          const weight =
            1 +
            (tweet.favorites || 0) * 0.1 +
            (tweet.retweets || 0) * 0.1 +
            (tweet.replies || 0) * 0.3;

          cashtags.forEach((cashtag) => {
            if (!cashtagData[cashtag]) {
              cashtagData[cashtag] = { score: 0 };
              relevantTweets.set(cashtag, tweet.text);
            }
            cashtagData[cashtag].score += weight;
          });
        }

        return { account, cashtagData, relevantTweets };
      });

      const combinedCashtagData = {};
      const combinedRelevantTweets = new Map();

      for (const { cashtagData, relevantTweets } of accountData) {
        for (const [cashtag, data] of Object.entries(cashtagData)) {
          if (!combinedCashtagData[cashtag]) {
            combinedCashtagData[cashtag] = { score: 0 };
            combinedRelevantTweets.set(cashtag, relevantTweets.get(cashtag));
          }
          combinedCashtagData[cashtag].score += data.score;
        }
      }

      const sortedCashtags = Object.entries(combinedCashtagData)
        .sort(([, a], [, b]) => b.score - a.score)
        .slice(0, 12);

      const cashtagList = sortedCashtags.map(([cashtag, data]) => ({
        cashtag,
        score: Math.round(data.score),
      }));

      const relevantTweetTexts = cashtagList.map(({ cashtag }) =>
        combinedRelevantTweets.get(cashtag)
      );

      const results = { cashtagList, relevantTweetTexts };
      console.log('🔗 Final results:', results);

      this.cacheResults(cacheKey, results);

      return {
        message: 'List of popular tokens/tickers on the Twitter streets/trenches:',
        ...results,
      };
    } catch (error) {
      console.error('❌ Error in discoverTrenches:', error);
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async fetchTweetsFromAccount(account) {
    try {
      console.log(`🔄 Fetching tweets for account: ${account}`);
      const input = {
        username: account,
        max_posts: 20,
      };

      const run = await this.apifyClient.actor('danek/twitter-timeline').call(input);
      const { items } = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
      console.log(`✅ Fetched ${items.length} tweets for ${account}`);
      return items;
    } catch (error) {
      console.error(`❌ Error fetching tweets for ${account}:`, error);
      await ErrorHandler.handle(error);
      return [];
    }
  }

  extractCashtags(tweet) {
    const cashtags = new Set();
    if (tweet.entities?.symbols?.length) {
      tweet.entities.symbols.forEach((symbol) => {
        cashtags.add(`$${symbol.text.toUpperCase()}`);
      });
    }
    const cashtagRegex = /\$[a-z0-9]+/gi;
    const textCashtags = tweet.text.match(cashtagRegex) || [];
    textCashtags.forEach((ct) => cashtags.add(ct.toUpperCase()));
    return Array.from(cashtags);
  }

  getFromCache(key) {
    const cached = this.searchCache.get(key);
    if (cached && Date.now() - cached.timestamp < 60000) {
      return cached.data;
    }
    return null;
  }

  cacheResults(key, data) {
    this.searchCache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  cleanup() {
    // Since Bull handles the intervals, just clear local references:
    this.activeMonitors.clear();
    this.removeAllListeners();
    this.initialized = false;
    console.log('✅ TwitterService cleaned up');
  }
}

////////////////////////////////////////////////////////////////////////////////
// 3. EXPORT SINGLETON
////////////////////////////////////////////////////////////////////////////////

export const twitterService = new TwitterService();
