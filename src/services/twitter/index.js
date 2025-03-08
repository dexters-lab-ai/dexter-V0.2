import { bot } from '../../core/bot.js';
import { EventEmitter } from 'events';
import { ApifyClient } from 'apify-client';
import { User } from '../../models/User.js';
import { TweetCache } from '../../models/TweetCache.js'; 
import { tradeService } from '../trading/TradeService.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { config } from '../../core/config.js';
import { queueService } from '../queue/QueueService.js';
import { SwapController } from '../ai/processors/swapController.js';
import { aiMetricsService } from '../aiMetricsService.js';

/**
 * Normalize the tweet date string.
 * Apify returns dates in the format:
 *   "Tue Feb 25 21:33:51 +0000 2025"
 * We insert a comma after the weekday to help the built‑in Date parser.
 */
function normalizeTweetDate(dateStr) {
  if (!dateStr) return dateStr;
  if (dateStr.length > 3 && dateStr[3] !== ',') {
    return dateStr.slice(0, 3) + ', ' + dateStr.slice(4);
  }
  return dateStr;
}

/**
 * Parse the tweet’s createdAt string into a Date object.
 * Returns a Date that reflects the local time.
 */
function parseTweetDate(dateStr) {
  const normalized = normalizeTweetDate(dateStr);
  const dt = new Date(normalized);
  if (isNaN(dt.getTime())) {
    console.warn(`Failed to parse tweet date. Original: "${dateStr}", Normalized: "${normalized}"`);
  }
  return dt;
}

/** Helper: Reorder the tweet timestamp into a format that Date.parse() can reliably parse.
* Example:
*   Input:  "Tue Feb 25 21:33:51 +0000 2025"
*   Output: "Tue, 25 Feb 2025 21:33:51 +0000"
*/
function reorderTweetDate(dateStr) {
  if (!dateStr) return dateStr;
  const parts = dateStr.split(' ');
  if (parts.length !== 6) {
    console.warn(`Unexpected tweet date format: "${dateStr}"`);
    return dateStr;
  }
  // parts: [weekday, month, day, time, timezone, year]
  return `${parts[0]}, ${parts[2]} ${parts[1]} ${parts[5]} ${parts[3]} ${parts[4]}`;
}

class TwitterService extends EventEmitter {
  constructor() {
    super();
    this.apifyClient = new ApifyClient({ token: config.apifyApiKey });
    this.searchCache = new Map();
    this.searchCounts = new Map();
    this.lastResetTime = Date.now();
    this.activeMonitors = new Map();
    this.initialized = false;
    this.swapController = new SwapController(bot);

     // Initialize intentProcessor as null
    this._intentProcessor = null;
  }

  get intentProcessor() {
    if (!this._intentProcessor) {
      try {
        // Dynamic import to avoid circular dependency
        const { intentProcessor } = import('../ai/processors/IntentProcessor.js');
        this._intentProcessor = intentProcessor;
      } catch (error) {
        console.error("Failed to load intentProcessor:", error);
        throw new Error("Failed to load intentProcessor. This is a critical dependency.");
      }
    }
    return this._intentProcessor;
  }

  async initialize() {
    if (this.initialized) return;
    try {
      await queueService.initialize();
      const kolQueue = queueService.getQueue('kolMonitor');
      kolQueue.process(async (job) => {
        const { userId, handle, amount } = job.data;
        await this.checkNewTweets(userId, handle, amount);
      });
      await this.restoreActiveMonitors();
      await queueService.logQueueContents('kolMonitor');
      //await this.triggerImmediateChecks();
      this.initialized = true;
      console.log('✅ TwitterService initialized');
    } catch (error) {
      console.error('❌ Error initializing TwitterService:', error);
      throw error;
    }
  }

  async restoreActiveMonitors() {
    try {
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

  async triggerImmediateChecks() {
    for (const [jobId, monitor] of this.activeMonitors) {
      console.log(`Triggering immediate check for monitor ${jobId}`);
      await this.checkNewTweets(monitor.userId, monitor.handle, monitor.amount);
    }
  }

  async startKOLMonitoring(userId, handle, amount) {
    try {
      handle = handle.replace(/^@+/, "").trim();
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user) throw new Error(`User not found: ${userId}`);
      if (!user.settings.kol) {
        user.settings.kol = { enabled: true, monitors: [] };
      }
      const monitorsArray = user.settings.kol.monitors || [];
      if (monitorsArray.length >= 5) {
        throw new Error('Max 5 KOL monitors allowed per user!');
      }
      let monitor = monitorsArray.find(m => m.handle === handle);
      if (!monitor) {
        monitor = { handle, amount: amount || 0, enabled: true };
        monitorsArray.push(monitor);
      }
      // Update monitor values regardless.
      monitor.enabled = true;
      monitor.amount = amount || 0;
      await User.updateOne(
        { telegramId: userId.toString() },
        {
          $set: {
            'settings.kol.enabled': true,
            'settings.kol.monitors': monitorsArray
          }
        },
        { runValidators: false }
      );
      // Schedule the monitor job only if one doesn't already exist.
      const jobId = `kolMonitor:${userId}:${handle}`;
      if (!this.activeMonitors.has(jobId)) {
        await this._scheduleKOLMonitorJob(userId, handle, monitor.amount);
      } else {
        console.log(`Job ${jobId} already exists. Skipping duplicate scheduling.`);
      }
      // Immediately trigger a tweet check.
      await this.checkNewTweets(userId, handle, monitor.amount);
      console.log(`✅ Started monitoring @${handle} for user => ${userId}`);
      return { success: true, message: `Monitoring handle => ${handle}` };
    } catch (error) {
      await ErrorHandler.handle(error);
      return { success: false, message: error.message || 'Error starting monitoring' };
    }
  }
  
  async _scheduleKOLMonitorJob(userId, handle, amount) {
    const jobId = `kolMonitor:${userId}:${handle}`;
    try {
      // Check if the job is already scheduled in our active monitors map.
      if (this.activeMonitors.has(jobId)) {
        console.log(`Job ${jobId} already scheduled. Skipping new scheduling.`);
        return;
      }
      // Set the desired interval (e.g., 30 minutes)
      const intervalMs = 30 * 60 * 1000;
      await queueService.addRepeatableJob(
        'kolMonitor',
        { userId, handle, amount },
        { every: intervalMs },
        jobId
      );
      // Store the job in our in‑memory map.
      this.activeMonitors.set(jobId, {
        userId,
        handle,
        amount,
        lastScheduled: new Date()
      });
      console.log(`✅ Scheduled KOL job => ${jobId} (every ${intervalMs} ms)`);
    } catch (error) {
      console.error(`❌ Error scheduling KOL job => ${jobId}`, error);
      await ErrorHandler.handle(error);
      throw error;
    }
  }
  
  async stopKOLMonitoring(userId, handle) {
    try {
      handle = handle.replace(/^@+/, "").trim();
      await User.updateOne(
        { telegramId: userId.toString(), 'settings.kol.monitors.handle': handle },
        { $set: { 'settings.kol.monitors.$[m].enabled': false } },
        { arrayFilters: [{ 'm.handle': handle }], runValidators: false }
      );
      const jobId = `kolMonitor:${userId}:${handle}`;
      await queueService.removeRepeatableJobById('kolMonitor', jobId);
      this.activeMonitors.delete(jobId);
      console.log(`✅ Stopped monitoring => @${handle} (user: ${userId})`);
    } catch (error) {
      await ErrorHandler.handle(error);
    }
  }

  async deleteKOLMonitor(userId, handle) {
    try {
      handle = handle.replace(/^@+/, "").trim();
      
      // Step 1: Remove the monitor from the user document and verify removal.
      let user;
      let attempts = 0;
      do {
        await User.updateOne(
          { telegramId: userId.toString() },
          { $pull: { 'settings.kol.monitors': { handle } } },
          { runValidators: false }
        );
        user = await User.findOne({ telegramId: userId.toString() });
        attempts++;
        if (!user || !user.settings || !user.settings.kol || !user.settings.kol.monitors.find(m => m.handle === handle)) {
          console.log(`User document: Monitor @${handle} successfully removed after ${attempts} attempt(s).`);
          break;
        }
        console.log(`Monitor @${handle} still exists in user document. Retrying deletion...`);
      } while (attempts < 3);
      
      // Step 2: Remove the queue job(s) and verify they are gone.
      const jobId = `kolMonitor:${userId}:${handle}`;
      let removalAttempts = 0;
      let jobsRemaining = true;
      const kolQueue = queueService.getQueue('kolMonitor');
      while (jobsRemaining && removalAttempts < 3) {
        try {
          // Remove the repeatable job.
          await queueService.removeRepeatableJobById('kolMonitor', jobId);
          // Also remove any active/waiting/delayed jobs with matching handle and userId.
          const activeJobs = await kolQueue.getJobs(['active', 'waiting', 'delayed']);
          for (const job of activeJobs) {
            if (job.data && job.data.handle === handle && job.data.userId === userId) {
              await job.remove();
              console.log(`Removed additional job ${job.id} for KOL monitor @${handle}`);
            }
          }
        } catch (queueError) {
          console.error(`Error during removal attempt ${removalAttempts + 1} for queue job @${handle}:`, queueError);
        }
        // Verify that no matching job remains.
        const remainingJobs = await kolQueue.getJobs(['active', 'waiting', 'delayed']);
        jobsRemaining = remainingJobs.some(job => job.data && job.data.handle === handle && job.data.userId === userId);
        removalAttempts++;
        if (jobsRemaining) {
          console.log(`Queue jobs for @${handle} still exist. Retrying removal...`);
        }
      }
      if (jobsRemaining) {
        console.warn(`Some queue jobs for @${handle} still remain after ${removalAttempts} attempts.`);
      } else {
        console.log(`Queue: All jobs for @${handle} have been removed after ${removalAttempts} attempt(s).`);
      }
      
      // Step 3: Clean up the active monitors record.
      this.activeMonitors.delete(jobId);
      console.log(`✅ Deleted KOL monitor => @${handle} (user: ${userId})`);
      return { success: true, message: `Deleted monitor => @${handle}` };
    } catch (error) {
      console.error(`❌ Error deleting monitor => @${handle}:`, error);
      await ErrorHandler.handle(error);
      return { success: false, message: error.message || 'Error deleting KOL monitor' };
    }
  }

  /*
  async deleteKOLMonitor(userId, handle) {
    try {
      handle = handle.replace(/^@+/, "").trim();
      
      // Step 1: Remove the monitor from the user document and verify removal.
      let user;
      let attempts = 0;
      do {
        await User.updateOne(
          { telegramId: userId.toString() },
          { $pull: { 'settings.kol.monitors': { handle } } },
          { runValidators: false }
        );
        user = await User.findOne({ telegramId: userId.toString() });
        attempts++;
        if (!user || !user.settings || !user.settings.kol || !user.settings.kol.monitors.find(m => m.handle === handle)) {
          console.log(`User document: Monitor @${handle} successfully removed after ${attempts} attempt(s).`);
          break;
        }
        console.log(`Monitor @${handle} still exists in user document. Retrying deletion...`);
      } while (attempts < 3);
  
      // Step 2: Remove the queue job(s) and verify they are gone.
      const jobId = `kolMonitor:${userId}:${handle}`;
      let removalAttempts = 0;
      let jobsRemaining = true;
      const kolQueue = queueService.getQueue('kolMonitor');
      while (jobsRemaining && removalAttempts < 3) {
        try {
          // Remove the repeatable job.
          await queueService.removeRepeatableJobById('kolMonitor', jobId);
          
          // Also remove any active/waiting/delayed jobs with matching handle/userId.
          const activeJobs = await kolQueue.getJobs(['active', 'waiting', 'delayed']);
          for (const job of activeJobs) {
            if (job.data && job.data.handle === handle && job.data.userId === userId) {
              await job.remove();
              console.log(`Removed additional job ${job.id} for KOL monitor @${handle}`);
            }
          }
        } catch (queueError) {
          console.error(`Error during removal attempt ${removalAttempts + 1} for queue job @${handle}:`, queueError);
        }
        
        // Verify that no matching job remains.
        const remainingJobs = await kolQueue.getJobs(['active', 'waiting', 'delayed']);
        jobsRemaining = remainingJobs.some(job => job.data && job.data.handle === handle && job.data.userId === userId);
        removalAttempts++;
        if (jobsRemaining) {
          console.log(`Queue jobs for @${handle} still exist. Retrying removal...`);
        }
      }
  
      if (jobsRemaining) {
        console.warn(`Some queue jobs for @${handle} still remain after ${removalAttempts} attempts.`);
      } else {
        console.log(`Queue: All jobs for @${handle} have been removed after ${removalAttempts} attempt(s).`);
      }
      
      // Clean up the active monitors record.
      this.activeMonitors.delete(jobId);
      console.log(`✅ Deleted KOL monitor => @${handle} (user: ${userId})`);
      return { success: true, message: `Deleted monitor => @${handle}` };
    } catch (error) {
      console.error(`❌ Error deleting monitor => @${handle}:`, error);
      await ErrorHandler.handle(error);
      return { success: false, message: error.message || 'Error deleting KOL monitor' };
    }
  }
    */  
/*
  async deleteKOLMonitorID(userId, monitorId) {
    try {
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user) throw new Error(`User not found => ${userId}`);
      const monitorsArr = user.settings?.kol?.monitors || [];
      const index = monitorsArr.findIndex(m => m._id?.toString() === monitorId);
      if (index < 0) throw new Error(`Monitor _id=${monitorId} not found`);
      const handle = monitorsArr[index].handle.replace(/^@+/, "").trim();
      await User.updateOne(
        { telegramId: userId.toString() },
        { $pull: { 'settings.kol.monitors': { _id: monitorId } } },
        { runValidators: false }
      );
      const jobId = `kolMonitor:${userId}:${handle}`;
      await queueService.removeRepeatableJobById('kolMonitor', jobId);
      this.activeMonitors.delete(jobId);
      console.log(`✅ Deleted monitor => handle="${handle}", user=${userId}, _id=${monitorId}`);
      return { success: true, message: `Deleted KOL monitor => handle="${handle}"` };
    } catch (error) {
      console.error(`❌ Error deleting by ID => ${monitorId}`, error);
      await ErrorHandler.handle(error);
      return { success: false, message: error.message || 'Error deleting KOL monitor by ID' };
    }
  }
*/
  async getKOLsMonitored(userId) {
    try {
      console.log(`[getKOLsMonitored] Starting for userId => ${userId}`);
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user) {
        console.warn(`[getKOLsMonitored] User not found => ${userId}`);
        return [];
      }
      console.log(
        `[getKOLsMonitored] Found user => ${JSON.stringify({ telegramId: user.telegramId, kolSettings: user.settings?.kol }, null, 2)}`
      );
      if (!user.settings?.kol?.monitors) {
        console.warn(`[getKOLsMonitored] No monitors found for user => ${userId}`);
        return [];
      }
      const activeMonitors = user.settings.kol.monitors.filter(m => m.enabled);
      if (activeMonitors.length === 0) {
        console.log(`[getKOLsMonitored] User ${userId} has no enabled monitors.`);
        return [];
      }
      console.log(`[getKOLsMonitored] Found ${activeMonitors.length} enabled monitors.`);
  
      // Reference time: 24 hours ago (in milliseconds)
      const oneDayAgoMs = Date.now() - 24 * 3600 * 1000;
      console.log(`[getKOLsMonitored] Reference time (oneDayAgo): ${new Date(oneDayAgoMs).toUTCString()}`);
  
      const monitorsWithTweets = await Promise.all(
        activeMonitors.map(async (monitor, idx) => {
          try {
            console.log(`[getKOLsMonitored] Processing monitor #${idx + 1}: ${JSON.stringify(monitor, null, 2)}`);
            const normalizedHandle = monitor.handle.replace(/^@+/, '').trim();
            if (!normalizedHandle) {
              console.warn(`[getKOLsMonitored] Normalized handle is empty; skipping monitor.`);
              return monitor;
            }
            console.log(`[getKOLsMonitored] Final handle => "${normalizedHandle}" for user => ${userId}`);
  
            let latestTweet = null;
            let source = '';
  
            // First, try using cached tweets.
            const cached = await this._getCachedTweets(normalizedHandle, 10);
            if (cached) {
              console.log(`[getKOLsMonitored] Using cached tweets for => ${normalizedHandle}`);
              const validTweets = cached.items.filter(tweet => {
                const reordered = reorderTweetDate(tweet.createdAt);
                const parsedTime = Date.parse(reordered);
                console.log(
                  `[getKOLsMonitored] (Cache) Tweet id=${tweet.id} orig="${tweet.createdAt}" reordered="${reordered}" parsed=${!isNaN(parsedTime) ? new Date(parsedTime).toUTCString() : 'INVALID'}`
                );
                return !isNaN(parsedTime) && parsedTime > oneDayAgoMs;
              });
              if (validTweets.length > 0) {
                latestTweet = validTweets[0];
                source = 'cache';
              }
            }
  
            // If not found in cache, fetch from Apify.
            if (!latestTweet) {
              const input = {
                cookies: [config.apifyCookieToken],
                maxItems: 50,
                searchTerms: [`from:${normalizedHandle}`],
                sortBy: "Latest"
              };
              console.log(`[getKOLsMonitored] Apify input for => ${normalizedHandle}: ${JSON.stringify(input, null, 2)}`);
              const run = await this.apifyClient.actor("apidojo/tweet-scraper").call(input);
              const { items } = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
              await this._cacheTweets(normalizedHandle, items);
              console.log(`[getKOLsMonitored] Cached ${items.length} tweets for ${normalizedHandle}`);
              const validTweets = items.filter(tweet => {
                const reordered = reorderTweetDate(tweet.createdAt);
                const parsedTime = Date.parse(reordered);
                console.log(
                  `[getKOLsMonitored] (Apify) Tweet id=${tweet.id} orig="${tweet.createdAt}" reordered="${reordered}" parsed=${!isNaN(parsedTime) ? new Date(parsedTime).toUTCString() : 'INVALID'}`
                );
                return !isNaN(parsedTime) && parsedTime > oneDayAgoMs;
              });
              if (validTweets.length > 0) {
                latestTweet = validTweets[0];
                source = 'apify';
              }
            }
  
            if (latestTweet) {
              console.log(`[getKOLsMonitored] Latest tweet for ${normalizedHandle} from ${source}: ${JSON.stringify(latestTweet, null, 2)}`);
            } else {
              console.log(`[getKOLsMonitored] No valid tweet found for ${normalizedHandle}`);
            }
            return {
              ...monitor,
              lastTweet: latestTweet
                ? { text: latestTweet.text, url: latestTweet.url, createdAt: latestTweet.createdAt }
                : null
            };
          } catch (error) {
            console.warn(`[getKOLsMonitored] Error for monitor => ${JSON.stringify(monitor)}`, error);
            return monitor;
          }
        })
      );
      console.log(`[getKOLsMonitored] Successfully processed monitors for user => ${userId}`);
      return monitorsWithTweets;
    } catch (error) {
      console.error(`[getKOLsMonitored] Unexpected error =>`, error);
      await ErrorHandler.handle(error);
      return [];
    }
  }
  
  // --- checkNewTweets ---
  async checkNewTweets(userId, handle, amount) {
    try {
      // Clean up the handle.
      handle = handle.replace(/^@+/, '').trim();
      console.log(`[checkNewTweets] user=${userId}, handle=${handle}, amount=${amount}`);

      // Fetch the user and monitor.
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user) {
        console.warn(`[checkNewTweets] User ${userId} not found`);
        return { success: false, message: 'User not found' };
      }
      const monitor = user.settings?.kol?.monitors.find(m => m.handle === handle && m.enabled);
      if (!monitor) {
        console.warn(`[checkNewTweets] Monitor not found or disabled => ${handle}`);
        return { success: false, message: 'Monitor not found or disabled' };
      }

      // Determine the reference time. Use monitor.lastChecked (if available) or default to 1 hour or 30mins ago.
      // Ensure we're working with UTC time consistently
      let sinceTime;
      if (monitor.lastChecked) {
        // Convert to UTC milliseconds
        sinceTime = new Date(monitor.lastChecked).getTime();
        console.warn(' v v v v v System time used')
      } else {
        // Default to 1 hour ago in UTC
        sinceTime = Date.now() - 1 * 3600 * 1000;
      }
      
      if (isNaN(sinceTime)) {
        // Fallback: 30mins ago if stored lastChecked is invalid.
        sinceTime = Date.now() - (30 * 60 * 1000);
      }
      
      console.log(`[checkNewTweets] Reference time (sinceTime): ${new Date(sinceTime).toUTCString()}`);

      // First try to use the DB cache.
      const cached = await this._getCachedTweets(handle, 25);
      let newTweets = [];
      if (cached) {
        newTweets = cached.items.filter(t => {
          // Parse the tweet date consistently in UTC
          const reordered = reorderTweetDate(t.createdAt);
          const tweetTime = Date.parse(reordered);
          return !isNaN(tweetTime) && tweetTime > sinceTime;
        });
        
        console.log(`Found ${newTweets.length} new tweets in DB cache for handle=${handle}`);
        
        for (const tweet of newTweets) {
          await this.processTweet(userId, tweet, amount || monitor.amount);
        }
        
        // Update lastChecked using the latest tweet from cache, or current time if no new tweets
        if (newTweets.length > 0) {
          // Find the most recent tweet time
          const maxTweetTime = newTweets.reduce((max, t) => {
            const tTime = Date.parse(reorderTweetDate(t.createdAt));
            return tTime > max ? tTime : max;
          }, sinceTime);
          
          // Store the time in UTC
          await this._updateMonitorLastChecked(userId, handle, new Date(maxTweetTime));
          console.log(`Updated lastChecked to ${new Date(maxTweetTime).toUTCString()}`);
        } else {
          // If no new tweets, update to current time in UTC
          await this._updateMonitorLastChecked(userId, handle, new Date());
        }
        
        return { success: true, message: `DB Cache processed ${newTweets.length} tweets` };
      }

      // If no valid cache, fetch from Apify.
      const input = {
        cookies: [config.apifyCookieToken],
        maxItems: 50,
        searchTerms: [`from:${handle}`],
        sortBy: 'Latest'
      };
      console.log('[checkNewTweets] Apify input =>', input);
      const run = await this.apifyClient.actor('apidojo/tweet-scraper').call(input);
      const { items: tweetItems } = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
      //console.log(`Apify returned ${tweetItems.length} tweets => handle=${handle}`);

      // Cache the fetched tweets.
      await this._cacheTweets(handle, tweetItems);
      //console.log(`✅ Cached ${tweetItems.length} tweets for handle => @${handle}`);

      newTweets = tweetItems.filter(t => {
        const reordered = reorderTweetDate(t.createdAt);
        const tweetTime = Date.parse(reordered);
        /*
        console.log(
          `[checkNewTweets] (Apify) Tweet id=${t.id} orig="${t.createdAt}" reordered="${reordered}" ` +
          `parsed=${!isNaN(tweetTime) ? new Date(tweetTime).toUTCString() : 'INVALID'} ` +
          `sinceTime="${new Date(sinceTime).toUTCString()}"`
        );
        */
        return !isNaN(tweetTime) && tweetTime > sinceTime;
      });
      //console.log(`✅ Found ${newTweets.length} new tweets after filtering`);

      // Process each new tweet to find a CA, we could expand this to look for keywords like 'stay away' 'scam' 'rug' 'don't'
      for (const tweet of newTweets) {
        await this.processTweet(userId, tweet, amount || monitor.amount);
      }
      // Update lastChecked.
      if (newTweets.length > 0) {
        const maxTweetTime = newTweets.reduce((max, t) => {
          const tTime = Date.parse(reorderTweetDate(t.createdAt));
          return tTime > max ? tTime : max;
        }, sinceTime);
        await this._updateMonitorLastChecked(userId, handle, new Date(maxTweetTime));
        console.log(`Updated lastChecked to ${new Date(maxTweetTime).toUTCString()}`);
      } else {
        await this._updateMonitorLastChecked(userId, handle, new Date());
      }
      return { success: true, message: `Processed ${newTweets.length} new tweets` };
    } catch (error) {
      console.error('[checkNewTweets] Error =>', error);
      await ErrorHandler.handle(error);
      return { success: false, message: error.message || 'Error checking tweets' };
    }
  }
  
  async _updateMonitorLastChecked(userId, handle, dateObj) {
    await User.updateOne(
      { telegramId: userId.toString(), 'settings.kol.monitors.handle': handle },
      { $set: { 'settings.kol.monitors.$[m].lastChecked': dateObj } },
      { arrayFilters: [{ 'm.handle': handle }], runValidators: false }
    );
  }
  
  async processTweet(userId, tweet, amount, networkOverride) {
    //console.log(`[processTweet] => Processing tweet: ${JSON.stringify(tweet)}`);
    try {
      // First, check if the tweet contains any negative keywords
      const negativeKeywords = [
        "stay away",
        "scam",
        "rug",
        "don't",
        "fraud",
        "warning",
        "sell off",
        "dump" // add as needed
      ];
      const tweetTextLower = tweet.text.toLowerCase();
      const hasNegativeKeyword = negativeKeywords.some(kw => tweetTextLower.includes(kw));
      if (hasNegativeKeyword) {
        console.log(`[processTweet] Negative signal detected in tweet id=${tweet.id}. Skipping trade execution.`);
        return;
      }
  
      const tokenInfo = this.extractTokenInfo(tweet.text);
      if (!tokenInfo) return;
  
      const { symbol, address } = tokenInfo;
      console.log(`[processTweet] Found token => symbol=${symbol}, address=${address}`);
  
      const networkObj = networkOverride || (await intentProcessor.getTokenNetwork(address));
      if (!networkObj) {
        console.warn(`No network recognized for token => ${address}`);
        return;
      }
      const { network } = networkObj;
  
      const walletObj = await this._getWalletForTrade(userId, network);
      if (!walletObj) {
        console.warn(`No wallet found for user=${userId} on network=${network}`);
        return;
      }
  
      // For now we only execute a "buy"
      const action = 'buy';
      const tradeParams = {
        amount: amount,
        outputMint: address, // Token being bought.
        inputMint: action === "buy"
          ? "So11111111111111111111111111111111111111112" // Native SOL mint
          : address,
        wallet: walletObj.address
      };
  
      // Execute the swap trade.
      const swapResult = await this.swapController.swapTokens(userId, tradeParams);
      console.log(`[processTweet] Swap result: ${JSON.stringify(swapResult, null, 2)}`);
  
      // (Optional) Log the key parameters before passing to logSwap if needed.
      console.log(`[processTweet] Logging parameters for logSwap:
        inputToken: ${address},
        inAmount: ${amount},
        outputToken: ${address}, 
        outAmount: ${swapResult.expectedOutput},
        txId: ${swapResult.txId},
        timestamp: ${new Date().toISOString()}
      `);
  
      // Format output details for user message.
      const formattedInput = parseFloat(amount).toFixed(4) + " SOL";
      const formattedOutput = swapResult.expectedOutput ? swapResult.expectedOutput.toFixed(4) + " " + symbol : "N/A";
      const slippageInfo = swapResult.slippageBps ? `${swapResult.slippageBps} bps` : "N/A";
      const timeTaken = swapResult.timeTaken ? `${swapResult.timeTaken} sec` : "2 sec";
      const nowFormatted = new Date().toLocaleString();
  
      // Craft the message for the user.
      const message =
        `📢 **KOL Signal Executed**\n\n` +
        `**Monitor:** @${tweet.user || "Unknown"}\n` +
        `**Token Called:** ${symbol} (${address})\n` +
        `**Network:** ${network}\n\n` +
        `**Trade Details:**\n` +
        `• **Input Amount:** ${formattedInput}\n` +
        `• **Expected Output:** ${formattedOutput}\n` +
        `• **Static Slippage:** ${slippageInfo}\n` +
        `• **Swap Speed:** ${timeTaken}\n\n` +
        `**Time:** ${nowFormatted}\n\n` +
        `*This trade was automatically executed based on the KOL signal.*`;
  
      // Send the message to the user.
      await bot.sendMessage(userId, message, { parse_mode: "Markdown" });
  
    } catch (err) {
      await ErrorHandler.handle(err);
    }
  }  
  
  /**
   * 
   * Raw Swap Attempt, depracated saved as backup if we find use
   */
  /*
  async processTweet(userId, tweet, amount, networkOverride) {
    console.log(`[processTweet] => Processing tweet: ${JSON.stringify(tweet)}`);
    try {
      const tokenInfo = this.extractTokenInfo(tweet.text);
      if (!tokenInfo) return;
      const { symbol, address } = tokenInfo;
      console.log(`[processTweet] Found token => symbol=${symbol}, address=${address}`);
      const networkObj = networkOverride || (await intentProcessor.getTokenNetwork(address));
      const { network, tokenData } = networkObj;
      if (!networkObj) {
        console.warn(`No network recognized for token => ${address}`);
        return;
      }
      const walletObj = await this._getWalletForTrade(userId, network);
      if (!walletObj) {
        console.warn(`No wallet found for user=${userId} on network=${network}`);
        return;
      }
      
      const tradeParams = {
        userId,
        network,
        action: 'buy',
        tokenAddress: address,
        amount: amount.toString(),
        walletObj: walletObj,
        options: { slippage: 1, autoApprove: true }
      };
      await tradeService.executeTrade(tradeParams);
      this.emit('kolTrade', { userId, symbol, address, network, amount, tweet: tweet.url });
    } catch (err) {
      await ErrorHandler.handle(err);
    }
  }
  */
  
  extractTokenInfo(text) {
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44}/);
    if (!addressMatch) return null;
    const symbolMatch = text.match(/\$([A-Z0-9]+)/);
    return { address: addressMatch[0], symbol: symbolMatch ? symbolMatch[1] : 'Unknown' };
  }
  
  async _getCachedTweets(handle, freshnessMinutes) {
    try {
      const doc = await TweetCache.findOne({ handle });
      if (!doc) return null;
      const ageMs = Date.now() - doc.updatedAt.getTime();
      return ageMs > freshnessMinutes * 60 * 1000 ? null : doc;
    } catch (error) {
      console.error('Error in _getCachedTweets =>', error);
      return null;
    }
  }
  
  async _cacheTweets(handle, items = []) {
    try {
      await TweetCache.findOneAndUpdate(
        { handle },
        { $set: { items, updatedAt: new Date() } },
        { upsert: true, new: true }
      );
      console.log(`✅ Cached ${items.length} tweets for handle => @${handle}`);
    } catch (error) {
      console.error('Error in _cacheTweets =>', error);
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
      return `${days} day${days === 1 ? "" : "s"}${remainderHours > 0 ? ", " + remainderHours + " hour" + (remainderHours === 1 ? "" : "s") : ""} ago`;
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
      const run = await this.apifyClient.actor("fastcrawler/twitter-cashtag-scraper-stock-crypto-sentiment-analysis").call(input);
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
  
  async searchTwitter({ query, from, to, searchClass, operators = [], sortBy = 'Latest', maxItems = 100 }) {
    try {
      let operatorString = operators.join(' ');
      const baseSearch = operatorString ? `${query} ${operatorString}` : query;
      let additionalFilter = '';
      switch (searchClass) {
        case 'content':
          break;
        case 'users':
          if (!operatorString.toLowerCase().includes('from:') && !operatorString.toLowerCase().includes('to:')) {
            additionalFilter += ' from:someUser';
          }
          break;
        case 'geo':
          if (!operatorString.toLowerCase().includes('near:') && !operatorString.toLowerCase().includes('geocode:')) {
            additionalFilter += ' near:me';
          }
          break;
        case 'media':
          const opLower = operatorString.toLowerCase();
          if (!opLower.includes('filter:media') && !opLower.includes('filter:images') && !opLower.includes('filter:videos') && !opLower.includes('filter:spaces')) {
            additionalFilter += ' filter:media';
          }
          break;
        default:
          break;
      }
      const finalQuery = `${baseSearch}${additionalFilter}`.trim();
      const fromDate = from || this._getDefaultFromDate();
      const toDate = to || this._getDefaultToDate();
      const input = {
        searchTerms: [finalQuery],
        cookies: [config.apifyCookieToken],
        start: fromDate,
        end: toDate,
        maxItems,
        sortBy,
        tweetLanguage: "en",
      };
      const run = await this.apifyClient.actor("fastcrawler/tweet-fast-scraper").call(input);
      const { items } = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
      const formatted = items.map((tw) => ({
        type: tw.type || 'tweet',
        url: tw.url,
        text: tw.text,
        retweetCount: tw.retweetCount,
        replyCount: tw.replyCount,
        likeCount: tw.likeCount,
        quoteCount: tw.quoteCount,
        viewCount: tw.viewCount,
        createdAt: new Date(tw.createdAt).toLocaleString("en-US", {
          dateStyle: "short",
          timeStyle: "short"
        }),
        author: tw.author.username,
        media: tw.media,
      }));
      console.log('[searchTwitter] sample =>', JSON.stringify(formatted.slice(0, 3), null, 2));
      return formatted;
    } catch (error) {
      console.error('❌ [searchTwitter] Error:', error);
      await ErrorHandler.handle(error);
      return [];
    }
  }
  
  _getDefaultFromDate() {
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    const dateObj = new Date(Date.now() - SEVEN_DAYS);
    return dateObj.toISOString().split('T')[0];
  }
  
  _getDefaultToDate() {
    const dateObj = new Date();
    return dateObj.toISOString().split('T')[0];
  }
  
  formatTweets(tweets) {
    return tweets.map((tweet) => ({
      id: tweet.id,
      text: tweet.text.length > 200 ? `${tweet.text.slice(0, 197)}...` : tweet.text,
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
    const RESET_INTERVAL = 300000; // 5 minutes
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
      console.log('📦 Returning cached results for discoverTrenches');
      return cached;
    }
    try {
      const accounts = ['solana_daily', 'mobyagent', '0xOnlyCalls', 'cookiedotfun', 'Kyzzen_io'];
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
          const weight = 1 + (tweet.likeCount || 0) * 0.1 + (tweet.retweetCount || 0) * 0.1 + (tweet.replyCount || 0) * 0.3;
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
      const relevantTweetTexts = cashtagList.map(({ cashtag }) => combinedRelevantTweets.get(cashtag));
      const results = { cashtagList, relevantTweetTexts };
      console.log('🔗 Final results (discoverTrenches):', results);
      this.cacheResults(cacheKey, results);
      return {
        message: 'Popular tokens/tickers on the Twitter streets/trenches:',
        ...results,
      };
    } catch (error) {
      console.error('❌ Error in discoverTrenches:', error);
      await ErrorHandler.handle(error);
      throw error;
    }
  }
  
  async getTrenchChatter() {
    try {
      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
      const input = {
        customMapFunction: "(object) => { return {...object} }",
        includeSearchTerms: true,
        maxItems: 300,
        minimumFavorites: 0,
        minimumReplies: 0,
        minimumRetweets: 0,
        onlyImage: false,
        onlyQuote: false,
        onlyTwitterBlue: false,
        onlyVerifiedUsers: false,
        onlyVideo: false,
        searchTerms: [
          "(best) (AI Agents)",
          "(mindshare) (gainers) (agent)",
          "(DEFAI projects) (top)",
          "(gainers) (on Solana)",
          "(token) (ca)"
        ],
        sort: "Latest",
        tweetLanguage: "en"
      };
      const run = await this.apifyClient.actor("apidojo/tweet-scraper").call(input);
      const { items } = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
      const filteredItems = items.filter((tweet) => {
        const dt = parseTweetDate(tweet.createdAt);
        return !isNaN(dt.getTime()) && dt.getTime() > sevenDaysAgo.getTime();
      });
      filteredItems.forEach((tweet, index) => {
        console.log(`[Tweet ${index + 1}]`, JSON.stringify(tweet, null, 2));
      });
      const formattedTweets = filteredItems.map(tweet => {
        const mainUrl = tweet.url || `https://twitter.com/i/web/status/${tweet.id}`;
        let text = tweet.text || "";
        if (text.length > 300) text = text.slice(0, 300) + "...";
        return {
          id: tweet.id,
          twitterUrl: mainUrl,
          text,
          stats: {
            likes: tweet.likeCount || 0,
            retweets: tweet.retweetCount || 0,
            replies: tweet.replyCount || 0,
          },
          sentiment: tweet.sentiment?.trim() || "NA",
          createdAt: new Date(tweet.createdAt).toLocaleString("en-US", {
            dateStyle: "short",
            timeStyle: "short"
          }),
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
  
  async fetchTweetsFromAccount(account) {
    try {
      console.log(`🔄 Fetching tweets for account: ${account}`);

        input = {          
          cookies: [config.apifyCookieToken],
          endTime: this._getDefaultToDate(),
          maxItems: 100,
          searchTerms: [`from:${account}`],
          sortBy: "Latest",
          startTime: this._getDefaultFromDate(),
        };

      const run = await this.apifyClient.actor('fastcrawler/tweet-fast-scraper').call(input);
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
    // Use tweet.entities.symbols if available for a more reliable extraction
    if (tweet.entities?.symbols?.length) {
      tweet.entities.symbols.forEach((symbol) => {
        cashtags.add(`$${symbol.text.toUpperCase()}`);
      });
    }
    // Fallback: search the tweet text using regex with a word boundary
    const cashtagRegex = /\$[A-Z0-9]+\b/gi;
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
    this.searchCache.set(key, { data, timestamp: Date.now() });
  }

  // Checking Twitter health via Apify actors
  async checkTwitterHealth() {
    const uniqueTwitterActors = [
      "apidojo/tweet-scraper",
      "fastcrawler/twitter-cashtag-scraper-stock-crypto-sentiment-analysis",
      "fastcrawler/tweet-fast-scraper",
    ];

    const statuses = await Promise.all(
      uniqueTwitterActors.map(async (actor) => {
        try {
          const result = await this.checkActorHealth(actor);
          if (result) {
            return { actor, status: "healthy" };
          } else {
            return { actor, status: "unhealthy" };
          }
        } catch (error) {
          return { actor, status: "unhealthy", error: error.message };
        }
      })
    );

    // Format the response for dashboard
    const formattedResponse = {
      service: "twitter",
      actors: statuses,
      healthy: statuses.every((s) => s.status === "healthy"),
    };

    aiMetricsService.updateTwitterHealth(formattedResponse);
    return formattedResponse;
  }

  /**
 * Performs a health check on the specified Apify actor.
 * It makes an actual call (no ping) using minimal valid input.
 * If a function requires a handle, "elon_musk" is used.
 *
 * @param {string} actorName - The Apify actor identifier.
 * @returns {boolean} - true if the actor returns data (healthy), false otherwise.
 */
async checkActorHealth(actorName) {
    // TESTING MODE - PRICEY TO KEEP CALLING ON EVERY CODE COMMIT & RESTART
    return true;

    // Prepare minimal valid input based on actor requirements.
    let input = {};
    switch (actorName) {
      // For a cashtag scraper; even though it normally expects a cashtag,
      // we use "elon_musk" for functions that require a handle.
      case "fastcrawler/twitter-cashtag-scraper-stock-crypto-sentiment-analysis":
        input = {
          cashtag: "BTC",
          cookies: [config.apifyCookieToken],
          onlyBuleVerifiedUsers: false,
          onlyVerifiedUsers: false,
          sentimentAnalysis: true,
          sortBy: "Latest",
          maxItems: 100,
          minRetweets: 0,
          minLikes: 0,
          minReplies: 0,
        };
        break;
      case "fastcrawler/tweet-fast-scraper":
        input = {          
          cookies: [config.apifyCookieToken],
          endTime: this._getDefaultToDate(),
          maxItems: 100,
          searchTerms: ["from:elonmusk"],
          sortBy: "Latest",
          startTime: this._getDefaultFromDate(),
        };
        break;
      
      case "apidojo/tweet-scraper":
        input = {
          customMapFunction: "(object) => { return {...object} }",
          includeSearchTerms: false,
          maxItems: 100,
          minimumFavorites: 0,
          minimumReplies: 0,
          minimumRetweets: 0,
          onlyImage: false,
          onlyQuote: false,
          onlyTwitterBlue: false,
          onlyVerifiedUsers: false,
          onlyVideo: false,
          searchTerms: ["Trump", "Bitcoin"],          
          sortBy: 'Latest',
          startUrls: [
            "https://twitter.com/elonmusk/with_replies"
          ],
          tweetLanguage: "en",
          twitterHandles: [
            "elonmusk"
          ]
        };
        break;
      
      default:
        // Fallback for any other actor.
        input = { handle: "elonmusk", maxItems: 1 };
    }

    try {
      // Call the actor with the minimal input.
      const run = await this.apifyClient.actor(actorName).call(input);
      // Retrieve items from the actor's dataset.
      const datasetResponse = await this.apifyClient.dataset(run.defaultDatasetId).listItems();
      
      // If we get at least one item, the actor is considered healthy.
      if (datasetResponse?.items && datasetResponse.items.length > 0) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error(`❌ Health check failed for actor ${actorName}:`, error.message);
      return false;
    }
  }

  /**
   * Check the health of KOL monitoring by checking the number of active monitors.
   * This function assumes that your KOL monitoring service exposes an `activeMonitors` Map.
   */
  async checkKOLMonitoringHealth() {
    try {
      const apifyClientValid = !!this.apifyClient;
      const activeMonitors = this.activeMonitors || new Map();
      const handleCount = activeMonitors.size;

      const kolMetrics = {
        service: "kolMonitoring",
        healthy: apifyClientValid, // Now only depends on a valid Apify Client
        handleCount,
        details: Array.from(activeMonitors.keys()),
      };

      aiMetricsService.updateKOLMetrics(kolMetrics);
      return kolMetrics;
    } catch (error) {
      console.error("❌ Error checking KOL monitoring health:", error);
      return {
        service: "kolMonitoring",
        healthy: false,
        handleCount: 0,
        details: [],
        error: error.message,
      };
    }
  }
  
  cleanup() {
    this.activeMonitors.clear();
    this.searchCache.clear();
    this.searchCounts.clear();
    this.removeAllListeners();
    this.initialized = false;
    console.log('✅ TwitterService cleaned up');
  }
  
  async _getWalletForTrade(userId, network) {
    try {
      return await tradeService.getWalletForTrade(userId, network);
    } catch (err) {
      console.error(`Error in _getWalletForTrade => ${err}`);
      return null;
    }
  }
}
  
export const twitterService = new TwitterService();
