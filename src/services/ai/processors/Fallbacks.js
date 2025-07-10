/**
 * fallbackMap.js
 * --------------
 * Priority-based fallback options for each function.
 * The system tries each function in the array if the primary fails or returns insufficient data.
 */
export const fallbackMap = {

    /**
    * Address Input Handling, 
    * Primary: start of by structured handling handle_address_only_pasted
    * Fallbacks: fetch_token_price_in_usd, analyze_token_by_address
    */
    handle_address_only_pasted: [
      "fetch_token_price_in_usd",
      "analyze_token_by_address",
    ],

    /**
    * Symbol analysis
    * Primary: structured handling analyze_token_by_symbol
    * Fallbacks: cookiedao search_twitter_by_address symbol search, fetch_tweets_for_symbol Apify actor, structured fetch_tokenaddress_fromsymbol
    */
    analyze_token_by_symbol: [
      "fetch_tokenaddress_fromsymbol",
      "fetch_tweets_for_symbol",
      "search_twitter_by_address",
    ],

    /**
     * Token Price Functions
     * Primary: token_price_coingecko
     * Fallbacks: DexScreener, Dextools
     */
    token_price_coingecko: [
      "fetch_token_price_in_usd",
      "check_token_mindshare_on_market",
      "search_twitter_by_address",
    ],
  
    /**
     * If DexScreener price check fails, fallback to Coingecko or Dextools
     */
    fetch_token_price_in_usd: [
      "token_price_coingecko",
      "check_token_mindshare_on_market",
      "search_twitter_by_address",
    ],
  
    /**
     * If user calls token_price_dextools (assuming it exists),
     * fallback to DexScreener or Coingecko
     */
    token_price_dextools: [
      "fetch_token_price_in_usd",
      "token_price_coingecko",
      "check_token_mindshare_on_market",
    ],
  
    /**
     * For market sentiment checks (e.g., fetch_tweets_for_symbol),
     * fallback to a broad internet search for possible sentiment sources
     */
    fetch_tweets_for_symbol: [
      //"search_twitter_by_address",
      "search_twitter_using_multi_parameter_options",
      "search_internet"
    ],

    search_twitter_by_address: [
      "search_twitter_using_multi_parameter_options",
      "fetch_tweets_for_symbol",
    ],

    search_twitter_using_multi_parameter_options: [
      "fetch_tweets_for_symbol",
    ],

    // fetch_trending_tokens_twitter is defined later with more comprehensive fallbacks
  
    /**
     * Market Categories & Metrics
     * If fetching categories fails, fallback to metrics or a general internet search
     */
    fetch_market_categories: [
      "fetch_market_category_metrics",
      "search_internet"
    ],
    fetch_market_category_metrics: [
      "search_internet"
    ],
  
    /**
     * If a user wants trending tokens from Coingecko fails, 
     * fallback to DexScreener, Dextools, or a "unified" aggregator
     */
    fetch_trending_tokens_coingecko: [
      "fetch_trending_tokens_dexscreener",
      "fetch_trending_tokens_all_sources"
    ],
  
    /**
     * If Dextools trending fails, fallback to DexScreener or Coingecko or unified aggregator
     */
    fetch_trending_tokens_dextools: [
      "fetch_trending_tokens_dexscreener",
      "fetch_trending_tokens_all_sources"
    ],
  
    /**
     * If DexScreener trending fails, fallback to Dextools or Coingecko or unified aggregator
     */
    fetch_trending_tokens_dexscreener: [
      "fetch_trending_tokens_dextools",
      "fetch_trending_tokens_coingecko",
    ],
  
    /**
     * If the "unified" aggregator fails, fallback to direct sources
     */
    fetch_trending_tokens_all_sources: [
      "fetch_trending_tokens_coingecko",
      "fetch_trending_tokens_twitter"
    ],
  
    /**
     * If Twitter trending fails, fallback to internet search
     */
    fetch_trending_tokens_twitter: [
      "suggest_token_investments_dominating",
      "search_internet",
      "fetch_trending_tokens_coingecko", //based on search popularity so it applies as social check fallback
    ],
  
    /**
     * Searching Shopify store products fails => fallback to a general internet search
     */
    search_products: [
      "search_internet"
    ],
  
    /**
     * If "search_internet" fails => we might fallback to "fetch_trending_tokens_all_sources",
     * or "fetch_trending_tokens_twitter" if user is looking for public sentiment.
     */
    search_internet: [
      "search_internet"
    ],
  
    /**
     * Example: if we try "monitor_kol" but Twitter is down,
     * fallback to a broad internet search to find KOL news, or use fetch_tweets_for_symbol
     * (Just an example, you can remove if not relevant.)
     */
    monitor_kol: [
      "fetch_tweets_for_symbol",
      "search_internet"
    ],
  
    /**
     * If "handle_product_reference" fails, maybe fallback
     * to "search_products"? It's up to your logic. 
     */
    handle_product_reference: [
      "search_products"
    ],
  
    /**
     * If we wanted to fallback from "get_market_conditions" to 
     * "search_internet" in case the user’s API is offline
     */
    get_market_conditions: [
      "search_internet",
      "suggest_token_investments_dominating"
    ],
  
    /**
     * If "fetch_coins_by_category" fails, we might do 
     * a broader search_internet or fetch_market_categories
     */
    fetch_coins_by_category: [
      "fetch_market_categories",
      "search_internet"
    ],
  
    // ... add more as needed ...
  };
  