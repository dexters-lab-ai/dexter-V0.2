export const AIFunctions = [
    // Switch AI Model
    {
      name: "toggle_llm",
      description: "Switch the default AI model between OpenAI and DeepSeek for the user.",
      parameters: {
        type: "object",
        properties: {},
        required: []
      }
    },

    // Wallet Balances
    {
      name: "get_wallet_balances",
      description: "Fetches detailed formatted balances for a user's wallet. Supports EVM networks ('ethereum', 'avalanche', 'base') and Solana ('solana'). For EVM networks, an optional tokenList parameter can be provided to specify ERC20 token addresses (ignored for avalanche and Solana).",
      parameters: {
        type: "object",
        properties: {
          network: {
            type: "string",
            description: "Blockchain network identifier in lowercase. Leave network unspecified in parameters to query all networks, unless user specifies network.",
            enum: ["ethereum", "avalanche", "base", "solana"]
          },
          tokenList: {
            type: "array",
            description: "Optional list of ERC20 token contract addresses for EVM networks. Ignored when network is 'solana'.",
            default: [],
            items: {
              type: "string"
            }
          }
        },
        required: []
      }
    },    
    
    // Wallet Transactions
    {
      name: "get_wallet_token_transactions",
      description: "Fetches all token transactions for a user's wallet across supported networks. Supports 'ethereum', 'base', 'avalanche', and 'solana'. For ethereum, base, and avalanche, wallet addresses should be full hex strings (starting with '0x'); for solana, provide the base58 encoded public key.",
      parameters: {
        type: "object",
        properties: {
          network: {
            type: "string",
            description: "Blockchain network identifier in lowercase. Allowed values: 'ethereum', 'base', 'avalanche', 'solana'.",
            enum: ["ethereum", "base", "avalanche", "solana"],
            default: "ethereum"
          },
          walletAddress: {
            type: "string",
            description: "Wallet address as a string. Examples:\n- Ethereum: '0x1234567890abcdef1234567890abcdef12345678'\n- Base: '0xBASEWALLETADDRESSEXAMPLE1234567890'\n- Avalanche: '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD'\n- Solana: '4Nd1m1cNQuNzB8m8HhK1X6rf6NnUF1FxXzW9nB7QJYzF'",
            example: "0x1234567890abcdef1234567890abcdef12345678"
          }
        },
        required: ["network", "walletAddress"]
      }
    },
    
    // Portfolio Management
    {
      name: "get_portfolio",
      description: "Get user's portfolio and token positions across their built-in wallets created inside the Agent. Use this first before calling any trade execution function or order placing function.",
      parameters: {
      type: "object",
      properties: {
          network: { type: "string", enum: ["ethereum", "base", "solana", "avalanche", "etc"], description: "Leave empty to fetch combined portfolio. Only use chain is user specifies chain." }
      },        
      required: []    // No required parameters
      }
    },

    // Token Approval Functions
    {
        name: "approve_token",
        description: "Approve token spending on EVM networks.",
        parameters: {
          type: "object",
          properties: {
            network: { type: "string", enum: ["ethereum", "base"], description: "Network name." },
            tokenAddress: { type: "string", description: "Token contract address." },
            spenderAddress: { type: "string", description: "Address to approve." },
            amount: { type: "string", description: "Approval amount." },
            walletAddress: { type: "string", description: "Wallet address for approval." }
          },
          required: ["network", "tokenAddress", "spenderAddress", "walletAddress"]
        }
      },
      
      {
        name: "revoke_token_approval",
        description: "Revoke token approval for EVM networks.",
        parameters: {
          type: "object",
          properties: {
            network: { type: "string", enum: ["ethereum", "base"], description: "Network name." },
            tokenAddress: { type: "string", description: "Token contract address." },
            spenderAddress: { type: "string", description: "Spender address." },
            walletAddress: { type: "string", description: "Wallet address." }
          },
          required: ["network", "tokenAddress", "spenderAddress", "walletAddress"]
        }
      },
      
      // Solana Pay Functions
      {
          name: "create_solana_payment",
          description: "Create a Solana Pay payment request",
          parameters: {
          type: "object",
          properties: {
              amount: { type: "number", description: "Payment amount" },
              recipient: { type: "string", description: "Recipient address" },
              reference: { type: "string", description: "Payment reference" },
              label: { type: "string", description: "Payment label" }
          },
          required: ["amount", "recipient"]
          }
      },
      
      // Market Analysis Functions
      {
          name: "get_market_conditions",
          description: "Get current overall market conditions to factor into investment advise",
          parameters: {
          type: "object",
          properties: {
              includeDefi: { type: "boolean", description: "Include DeFi metrics" },
              includeSentiment: { type: "boolean", description: "Include market sentiment" }
          }
          }
      },

      // Shopify Integration
      {
          name: "search_products",
          description: "Search Shopify store products by product name od ID",
          parameters: {
          type: "object",
          properties: {
              query: { type: "string" },
              limit: { type: "number" }
          },
          required: ["query"]
          }
      },
      
      // Product Reference Functions
      {
          name: "handle_product_reference",
          description: "Handle a reference to a specific product",
          parameters: {
          type: "object",
          properties: {
              userId: { type: "string" },
              productId: { type: "string", description: "Product reference ID" }
          },
          required: ["userId", "productId"]
          }
      }, 

      // Wormholde Bridging service to 14 chains
      {
        name: "process_bridge_intent",
        description:
          "Triggers the token bridging process using WormholeBridgeService supporting over 30 Blockchains. This function accepts a set of parameters that describe the bridging operation, including source and target chains, token information, and the amount to bridge. It passes these parameters to the underlying WormholeBridgeService.bridgeTokens method.",
        parameters: {
          type: "object",
          properties: {
            sourceChain: {
              type: "string",
              description: "The source chain for bridging (e.g., 'solana', 'ethereum', 'avalanche', 'base')."
            },
            targetChain: {
              type: "string",
              description: "The destination chain for bridging (e.g., 'solana', 'ethereum', 'avalanche', 'base')."
            },
            tokenAddress: {
              type: "string",
              description:
                "Token identifier to bridge. Can be 'native' or a token symbol/address (e.g., 'wSOL', 'wAvax', 'USDC')."
            },
            amount: {
              type: "string",
              description:
                "The amount of tokens to bridge, represented as a decimal string (e.g., '0.05')."
            },
            recipientAddress: {
              type: "string",
              description: "The recipient address on the target chain."
            },
            roundTrip: {
              type: "boolean",
              description:
                "Optional flag to enable round-trip bridging. Defaults to true.",
              default: true
            }
          },
          required: [
            "sourceChain",
            "targetChain",
            "tokenAddress",
            "amount",
            "recipientAddress"
          ]
        }
      },

      // Fetch bridge receipts from wormhole
      {
        name: "fetch_bridge_receipts",
        description: "Fetch the user's bridging records from DB, optionally limit the number of results.",
        parameters: {
          type: "object",
          properties: {
            telegramId: {
              type: "string",
              description: "User's telegram ID"
            },
            limit: {
              type: "number",
              description: "Number of records to return (default 10)"
            }
          },
          required: ["telegramId"]
        }
      },
        
      // Trading Functions
      {
        name: "execute_solana_swap",
        description: `
          Swap tokens on Solana using Jupiter. 
          Retrieve User's Solana wallet from get_portfolio function first.
          Retrieve token address to sell or buy from user wallet balances or context results.
          Provide a valid wallet address, the input SPL mint, the output SPL mint, 
          and the amount in normals decimals for example: 0.01 SOL, 2.45 SOL, 1.23 ETH, 10 USDC, 150000 SNAI
        `,
        parameters: {
          type: "object",
          properties: {
            wallet: {
              type: "string",
              description: `
                The Solana wallet belonging to the User to user for the swap`
            },
            inputMint: {
              type: "string",
              description: "SPL mint address of the token to swap from. Default is SOL/native address, So11111111111111111111111111111111111111112"
            },
            outputMint: {
              type: "string",
              description: "SPL mint address of the token to swap to. Provided by user or in context."
            },
            amount: {
              type: "string",
              description: `
                The amount in human readable number format to swap.`
            }
          },
          required: ["wallet", "inputMint", "outputMint", "amount"]
        }
      },
      
      {
        name: "execute_avalanche_swap",
        description: "Swap tokens on the Avalanche blockchain using QuickNode. Retrieves the user's Avalanche wallet (or its derived key), the input token address (use 'AVAX' for native AVAX), the output token address, and the amount in the smallest unit (wei for AVAX or the token’s minimal unit). For example, if the user wants to swap 0.1 AVAX, convert it to 100000000000000000 wei.",
        parameters: {
          type: "object",
          properties: {
            wallet: {
              type: "string",
              description: "The Avalanche wallet address (or user ID from which the wallet is derived)."
            },
            inputToken: {
              type: "string",
              description: "The ERC-20 token address to swap from. Use 'AVAX' for the native token."
            },
            outputToken: {
              type: "string",
              description: "The ERC-20 token address to swap to."
            },
            amount: {
              type: "string",
              description: "The amount in the smallest unit (wei for AVAX, or the token’s minimal unit) to swap."
            }
          },
          required: ["wallet", "inputToken", "outputToken", "amount"]
        }
      },

      // Transfers
      {
        name: "evm_token_swap",
        description: "Swap tokens on EVM chains through Paraswap & Quicknode. Confirm network string with user first before proceeding.",
        parameters: {
          type: "object",
          properties: {
            network: {
              type: "string",
              enum: ["ethereum","avalanche","base","linear","cyber","fantom","arbitrum","berachain","nova","optimism","zkevm","scroll","polygon","bsc","celo","worldchain","mantle","zksync","omni"],
              description: "The blockchain network to use."
            },
            action: {
              type: "string",
              enum: ["buy", "sell"],
              description: "Trade action: 'buy' to swap native token for ERC‑20 tokens, 'sell' to swap ERC‑20 tokens for native coin."
            },
            inputToken: {
              type: "string",
              description: "The address of the input token. For native swaps, use a reserved keyword (e.g., 'BASE_NATIVE' for Base native coin or 'ETH_NATIVE' for Ether)."
            },
            outputToken: {
              type: "string",
              description: "The address of the output token (ERC‑20 token address)."
            },
            amount: {
              type: "string",
              description: "The amount to swap (in full decimals, not wei)."
            },
            walletAddress: {
              type: "string",
              description: "User's wallet address for the transaction."
            },
            deadlineSeconds: {
              type: "number",
              description: "Optional deadline (in seconds from now) after which the transaction will revert.",
              default: 1200
            },
            options: {
              type: "object",
              properties: {
                slippage: {
                  type: "number",
                  default: 50,
                  description: "Slippage tolerance in basis points (e.g., 50 means 0.50%)."
                }
              },
              additionalProperties: false
            }
          },
          required: ["network", "action", "inputToken", "outputToken", "amount", "walletAddress"]
        }
      },

      {
        name: "ethereum_base_token_transfer",
        description: "Send/Transfer tokens or native assets on Ethereum or Base",
        parameters: {
          type: "object",
          properties: {
            network: { type: "string", enum: ["ethereum", "base"], description: "The blockchain network" },
            tokenAddress: { type: "string", description: "Contract address of token (or 'native' for ETH/Base)" },
            amount: { type: "string", description: "Amount of token to send (full decimals, not wei)" },
            walletAddress: { type: "string", description: "Sender's wallet address" },
            recipient: { type: "string", description: "Recipient wallet address" }
          },
          required: ["network", "tokenAddress", "amount", "walletAddress", "recipient"]
        }
      },
      {
        name: "avalanche_send",
        description: "Send tokens on the Avalanche blockchain to another wallet.",
        parameters: {
          type: "object",
          properties: {
            wallet: { type: "string", description: "The Avalanche wallet address of the User to send from." },
            token: { type: "string", description: "ERC-20 token contract address to send. Use 'AVAX' for native AVAX." },
            recipient: { type: "string", description: "Wallet address of the recipient." },
            amount: { type: "string", description: "Amount to send in the smallest unit (wei for AVAX or token’s minimal unit)." }
          },
          required: ["wallet", "token", "recipient", "amount"]
        }
      },      

      // Cookie Mindshare and Sentiment and Narratives searching per ticker or token address
      {
        name: "search_token_by_twitterusername",
        description: "Search for Agent by Twitter username for an optional interval. Returns market mindshare AI based metrics, market metrics, contracts, and social statistics.",
        parameters: {
          type: "object",
          properties: {
            twitterUsername: {
              type: "string",
              description: "Twitter username of the agent/project (case-insensitive). E.g. 'cookiedotfun'. Only provided in twitter urls from token results or by user as raw handle '@cookiedotfun'. Never assume handles if not in results as full URL or @handle"
            },
            interval: {
              type: "string",
              description: "Interval for stats (e.g. '_7Days' or '_3Days'). Defaults to '_7Days' if not provided.",
              default: "_7Days"
            }
          },
          required: ["twitterUsername"]
        }
      },
    
      {
        name: "check_token_mindshare_on_market",
        description: "Analyze token's or agent's market share or mindshare in the market from Cookie.fun AI data contracts. Use mindshare as measure of interest in token compared to overall tokens in the market. Real investor interest check. Returns combined social and market metrics from token address. Includes holders, mindshare, price changes, etc.",
        parameters: {
          type: "object",
          properties: {
            contractAddress: {
              type: "string",
              description: "Token address (case-insensitive). E.g. '0xc0041ef357b183448b235a8ea73ce4e4ec8c265f'"
            },
            interval: {
              type: "string",
              description: "Interval for stats (e.g. '_3Days' or '_7Days'). Default '_3Days' if omitted.",
              default: "_3Days"
            }
          },
          required: ["contractAddress"]
        }
      },
    
      {
        name: "suggest_token_investments_dominating",
        description: "Suggest top perfomers by mindshare dominance. Discovers tokens in narratives gaining traction. Fetch traction and mindshare growing tokens from CookieDAO API. Returns a paged list of tokens sorted by mindshare / dominance.",
        parameters: {
          type: "object",
          properties: {
            interval: {
              type: "string",
              description: "Interval for stats (e.g. '_7Days' or '_3Days'). Default '_7Days'.",
              default: "_7Days"
            },
            page: {
              type: "number",
              description: "Page number (starts at 1). Default is 1.",
              default: 1
            },
            pageSize: {
              type: "number",
              description: "Number of agents per page (1-25). Default is 25.",
              default: 25
            }
          },
          required: []
        }
      },
    /*
      {
        name: "search_twitter_by_address",
        description: "Search social tweets and opinions using token address. Google using a phrase prompting 'what' you want to know and targeting 'what' e.g., 'snai community growth'. Use fetch_tweets_for_symbol for search using symbol or cashtag only as query.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "contract address to search in tweets. E.g. '0xc0041ef357b183448b235a8ea73ce4e4ec8c265f'."
            },
            from: {
              type: "string",
              description: "Start date (YYYY-MM-DD). Defaults to 7 days ago if not specified.",
              default: "calculated as 7 days ago"
            },
            to: {
              type: "string",
              description: "End date (YYYY-MM-DD). Defaults to current date if not specified.",
              default: "calculated as today"
            }
          },
          required: ["query"]
        }
      },
    */
      {
        name: "get_token_market_sentiment_changes",
        description: "Deep dive into a token combined data from price to socials to market interest. Combined rich fundamental social & price metrics which influence sentiment on token/symbol/ticker. Aggregates sentiment data for a ticker, cashtag, or token address over a time interval. Merges Agents Paged, Tweet searches, and more.",
        parameters: {
          type: "object",
          properties: {
            queryStr: {
              type: "string",
              description: "Ticker/cashtag/address for sentiment. E.g. 'SNAI', '$SNAI', or '0xabcdef'."
            },
            interval: {
              type: "string",
              description: "Interval for agent stats to measure combined metrics change (e.g. '_7Days' or '_3Days'). Defaults '_7Days'.",
              default: "_7Days"
            }
          },
          required: ["queryStr"]
        }
      },
    
      {
        name: "get_cookiedao_api_authorization_status",
        description: "Checks the CookieDAO API key authorization and quota status by calling /authorization.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },     

      // Twitter Search Integration
      {
        name: "fetch_tweets_for_symbol",
        description: "Fetches tweets matching token Symbol or Cashtag and returns a list of matching tweets and sentiment for each tweet. Not for trending or mindshare. Used to find sentiment on symbol or token or cashtag",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The token symbol or cashtag to search for (e.g., 'SNAI', or 'BTC', or 'griffain'). Should be lowercase and without $ or spaces"
            },
            minLikes: {
              type: "number",
              description: "Use 0 unless specified by user. Minimum number of likes a tweet must have to be included",
              default: 0
            },
            minRetweets: {
              type: "number",
              description: "Use 0 unless specified by user. Minimum number of retweets a tweet must have to be included",
              default: 0
            },
            minReplies: {
              type: "number",
              description: "Use 0 unless specified by user. Minimum number of replies a tweet must have to be included",
              default: 0
            }
          },
          required: ["query"]
        }
      },

      // multiDimensionalTwitterSchema 
      {
        name: "search_twitter_using_multi_parameter_options",
        description: "Perform advanced multi-dimensional Twitter queries. Accepts fallback from search_twitter_by_address, plus new parameters for multi-operator searches and sorting. IMPORTANT: If the user statement includes advanced filters or location hints (e.g. 'with pictures', 'near me'), parse them into 'operators' or 'class' instead of putting them all in 'query'.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: `Main search phrase/cashtag/token or contract address. E.g. '$SNAI', 'cookie token utility', or 'CA: 0xc0041ef357b183448b235a8ea73ce4e4ec8c265f' etc.
      IMPORTANT: Do NOT include advanced operators (like near:city, filter:images) in 'query' if the user mentions them—put those in 'operators' or use 'class'.`
            },
            from: {
              type: "string",
              description: "Start date (YYYY-MM-DD). Defaults to ~7 days ago if not specified."
            },
            to: {
              type: "string",
              description: "End date (YYYY-MM-DD). Defaults to the current date if not specified."
            },
            class: {
              type: "string",
              description: `Which dimension to search:
      - "content": search tweet text, hashtags, cashtags, etc.
      - "users": search for tweets "from:user" or "to:user" or mentions, can combine with operators
      - "geo": search "near:city" or "within:5mi"
      - "media": search "filter:media", "filter:images", "filter:spaces".`,
              enum: ["content", "users", "geo", "media"]
            },
            operators: {
              type: "array",
              description: `Optional array of advanced Twitter operators. E.g. ["nasa OR esa","from:NASA","filter:videos","near:\\"New York\\"","-#asteroid"].
      Try to parse user hints like 'with pictures' => filter:images, or 'near me' => near:me, here.`,
              items: {
                type: "string"
              }
            },
            sortBy: {
              type: "string",
              description: "Sort order: 'Top' or 'Latest'. Defaults to 'Latest'.",
              enum: ["Top", "Latest"],
              default: "Latest"
            },
            maxItems: {
              type: "integer",
              description: "Maximum number of tweets to return. Defaults to 100.",
              default: 100
            }
          },
          required: ["query"]
        }
      },     

      {
        name: "get_trench_chatter",
        description: "Vibe check for the day. Fetch latest chatter from Crypto Twitter trading trenches, discover discussions around narratives. Learn the latest crypto discussions. Returns a list of tweets from all big opnions leaders, narrative shapers, crypto players.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      }, 

      // Brave Search Integration
      {
        name: "search_internet",
        description: "Search the internet for the latest info, news, market updates, blogs, events, announcements. reports, and research using the Brave Search API.  Both 'query' and 'queries' cannot be present for 'search_internet'. Use one: choose query for single string search, use queries for batch/multi strings searches.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search term for internet queries, e.g., 'latest trump news' or 'bloomberg financial news on Crypto and AI'."
            },
            queries: {
              type: "array",
              items: { type: "string" },
              description: "Array of search terms for batch processing, e.g., ['latest trump news', 'bloomberg financial news on Crypto and AI', 'Sony Wireless Headphones 2025 best']."
            }
          },
          required: []
        }
      }, 
  
      // Market Analysis Functions
      {
        name: "fetch_trending_tokens_by_chain",
        description: `Fetches trending tokens for a specific blockchain network.
        Chains supported, match this format or keywords when preparing network query:
        - solana, base, avalanche, ethereum, bsc, sui, ton, pulsechain, berachain, arbitrum, fantom, mode, zksync, tron, polygon`,
        parameters: {
          type: "object",
          properties: {
            network: {
              type: "string",
              enum: ["ethereum", "base", "solana", "avalanche"],
              description: "The blockchain network to fetch trending tokens for."
            }
          },
          required: ["network"]
        },
        returns: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Token name" },
              address: { type: "string", description: "Token address on the specified network" },
              network: { type: "string", description: "Blockchain network" },
              volume24h: { type: "number", description: "24-hour trading volume of the token" },
              description: { type: "string", description: "Short description of the token" },
              links: {
                type: "object",
                properties: {
                  website: { type: "string", description: "Official website URL" },
                  twitter: { type: "string", description: "Twitter URL" },
                  telegram: { type: "string", description: "Telegram group URL" }
                }
              },
              sources: {
                type: "array",
                items: { type: "string", description: "Source where the token is trending (e.g., 'dextools', 'dexscreener')" }
              }
            }
          }
        }
      }, 
  
      {
        name: "fetch_trending_tokens_unified",
        description: "Fetch top 25 trending/popular tokens combined from multiple sources: dextools, dexscreener, coingecko, and twitter.",
        parameters: {
          type: "object",
          properties: {
            sources: {
              type: "array",
              items: { type: "string", enum: ["dextools", "dexscreener", "coingecko", "twitter"] },
              description: "Optional list of sources to fetch trending tokens from. Defaults to all sources."
            }
          },
          required: [] // `sources` is optional
        }
      },   
  
      {
        name: "fetch_trending_tokens_coingecko",
        description: "Fetch popular/trending tokens from CoinGecko based on token search popularity.  No parameters required to call this.",
        parameters: { type: "object", properties: {}, required: [] }
      },
      
      {
        name: "fetch_trending_tokens_dextools",
        description: "Fetch Ethereum or Base blockchain trending tokens on Dextools.  No parameters required to call this.",
        parameters: { type: "object", properties: {}, required: [] }
      },
  
      {
        name: "fetch_trending_tokens_dexscreener",
        description: "Fetch trending tokens from DexScreener. Solana trending tokens main source. No parameters required to call this.",
        parameters: { type: "object", properties: {}, required: [] }
      },
  
      {
        name: "fetch_trending_tokens_twitter",
        description: "Discover new tokens/trends/narratives/what to buy from Twitter tweets. No parameters required to call this.",
        parameters: { type: "object", properties: {}, required: [] }
      },
  
      {
        name: "fetch_trending_tokens_solscan",
        description: "Fetch Solana trending tokens only, using Solscan. No parameters required to call this.",
        parameters: { type: "object", properties: {}, required: [] }
      },
      
      {
        name: "fetch_market_category_metrics",
        description: "Fetch and analyze key metrics for market categories. No parameters required to call this.",
        parameters: { type: "object", properties: {}, required: [] }
      }, 
  
      {
        name: "fetch_market_categories",
        description: "Fetch a list of all market/coin/token category IDs from CoinGecko.",
        parameters: {
          type: "object",
          properties: {},
          required: []
        },
        returns: {
          type: "array",
          items: {
            type: "string",
            description: "A unique identifier for a market/coin/token category, category id eg: ai-agents"
          }
        }
      },   
  
      {
        name: "fetch_coins_by_category",
        description: "Fetch coins and details by a specific market category ID returned from fetch_market_categories or provided already.",
        parameters: {
          type: "object",
          properties: {
            categoryId: {
              type: "string",
              description: "The unique category ID to search for."
            }
          },
          required: ["categoryId"]
        },
        returns: {
          type: "object",
          properties: {
            category: {
              type: "object",
              properties: {
                id: { "type": "string", "description": "Category ID" },
                name: { "type": "string", "description": "Category name" }
              }
            },
            coins: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { "type": "string", "description": "Coin ID" },
                  name: { "type": "string", "description": "Coin name" },
                  symbol: { "type": "string", "description": "Coin symbol" },
                  thumb: { "type": "string", "description": "Thumbnail image URL" },
                  large: { "type": "string", "description": "Large image URL" },
                  market_cap_rank: { "type": "integer", "description": "Market cap rank" }
                }
              }
            }
          }
        }
      },
  
      // Price Alerts
      {
          name: "create_price_alert",
          description: "Create a price alert for a token",
          parameters: {
          type: "object",
          properties: {
              tokenAddress: { 
                type: "string", 
                description: `When processing function call results, extract only the wallet address or token address from returned URLs. Do not use full links; extract only the address part from the URL.
              - If an EVM address, it will be a 42-character hexadecimal string (0xB24C..)
              - If a Solana address, it will be a Base58 string (typically 32-44 characters eg HwQfC1W3Fuvp8Cqay).
              - If any other blockchain format is present, ignore it unless explicitly required.
              - Example:
                  - Given: "https://etherscan.io/token/0x123456789abcdef..."
                  - Extracted: "0x123456789abcdef"
                  - Given: "https://solscan.io/token/HwQfC1W3Fuvp8Cqay..."
                  - Extracted: "HwQfC1W3Fuvp8Cqay..."
              `},
              targetPrice: { type: "number", description: "Target price" },
              condition: { type: "string", enum: ["above", "below"] },
              swapAction: {
              type: "object",
              properties: {
                  enabled: { type: "boolean" },
                  type: { type: "string", enum: ["buy", "sell"] },
                  amount: { type: "string" }
              }
              }
          },
          required: ["tokenAddress", "targetPrice", "condition"]
          }
      },
  
      {
          name: "view_price_alerts",
          description: "View all price alerts for the current user",
          parameters: { type: "object", properties: {}, required: [] }
      },
  
      {
        name: "view_price_alert",
        description: "Retrieve details of a specific price alert by its ID.",
        parameters: {
          type: "object",
          properties: {
            alertId: {
              type: "string",
              description: "The ID of the price alert to retrieve."
            }
          },
          required: ["alertId"]
        }
      },   
  
      {
        name: "edit_price_alert",
        description: "Edit an existing price alert",
        parameters: {
          type: "object",
          properties: {
            alertId: {
              type: "string",
              description: "The ID of the alert to edit"
            },
            updatedData: {
              type: "object",
              description: "Fields to update",
              properties: {
                targetPrice: {
                  type: "number",
                  description: "The new target price for the alert"
                },
                condition: {
                  type: "string",
                  enum: ["above", "below"],
                  description: "The new condition for the alert (above/below)"
                },
                isActive: {
                  type: "boolean",
                  description: "Set whether the alert is active or not"
                }
              }
            }
          },
          required: ["alertId"]
        }
      },   
  
      {
          name: "delete_price_alert",
          description: "Delete an alert by its ID",
          parameters: {
            type: "object",
              properties: {
                alertId: {
                    type: "string",
                    description: "The ID of the alert to delete" 
                }
              },
              required: ["alertId"]
          }
      },  

      // Flipper Mode
      {
          name: "start_flipper_mode",
          description: "Start automated FlipperMode trading. Auto buy trending tokens when market turns bullish. Data from Cookie.fun APIs",
          parameters: {
          type: "object",
          properties: {
              maxPositions: { type: "number", description: "Number of max positions you want to open eg: 4"  },
              profitTarget: { type: "number", description: "Profit target percentage for each position we open, e.g: 20%"  },
              stopLoss: { type: "number", description: "Max Loss Percentage for each position we open e.g: 20%"  },
              timeLimit: { type: "number", description: "How long you want to run Flipper Mode, in minutes only eg: 60 mins."  }
          },
          required: ["walletAddress"]
          }
      },
  
      {
          name: "stop_flipper_mode",
          description: "Stop automated FlipperMode trading on Pumpfun Solana",
          parameters: {
              type: "object",
              properties: {}, // No parameters
              required: []    // No required parameters
          },
      },
  
      {
          name: "setup_flipper_mode",
          description: "Setup/configure custom automated FlipperMode trading on Solana Pumpfun",
          parameters: {
          type: "object",
          properties: {
              maxPositions: { type: "number" },
              profitTarget: { type: "number" },
              stopLoss: { type: "number" },
              timeLimit: { type: "number" }
          },
          required: [] //No required parameters
          }
      },
  
      {
          name: "fetch_flipper_mode_metrics",
          description: "Monitor user's automated FlipperMode trading on Solana Pumpfun.",
          parameters: {
              type: "object",
              properties: {}, // No parameters
              required: []    // No required parameters
          },
      },
  
      // KOL Monitoring
      {
          name: "monitor_kol",
          description: "Start monitoring a KOL account on Twitter for trading signals, buy any token address they call immediately",
          parameters: {
          type: "object",
          properties: {
              query: { type: "string", description: "Twitter handle" },
              amount: { type: "number", description: "Amount per trade" }
          },
          required: ["query", "amount"]
          }
      },

      {
        name: "get_kol_monitor_positions",
        description: "Retrieves active KOL monitor positions for a user",
        parameters: {
          type: "object",
          properties: {},
          required: []
        }
      },

      {
        name: "delete_kol_monitor_position",
        description: "Delete KOL monitor position for a user",
        parameters: {
          type: "object",
          properties: {
            handle: { type: "string", description: "Twitter handle" },},
          required: ["handle"]
        }
      },
      /*
      {
        name: "delete_kol_monitor_position_by_id",
        description: "Delete KOL monitor position for a user using the Mangoose DB Id",
        parameters: {
          type: "object",
          properties: {
            id: { type: "string", description: "Monitoring id" },},
          required: ["id"]
        }
      },
      */
      {
          name: "stop_monitor_kol",
          description: "Stop monitoring KOL tweets for trading signals",
          parameters: {
          type: "object",
          properties: {
              handle: { type: "string", description: "Twitter handle" }
          },
          required: ["handle"]
          }
      },
  
      // Model Guidelines/Rules/Manners from User
      {
          name: "set_guidelines_manners_rules",
          description: "Save instructions, manners, rules, guidelines to follow when interacting with user. Use this to remember something the User tells you to remember next time",
          parameters: {
          type: "object",
          properties: {
              query: { type: "string" }
          },
          required: ["query"]
          }
      },
  
      {
          name: "get_guidelines_manners_rules",
          description: "Retrieve or remember or verify: instructions, manners, rules, guidelines set by User to follow during interactions.",
          parameters: {
              type: "object",
              properties: {}, // No parameters
              required: []    // No required parameters
          },
      },
  
      // Chat History
      {
          name: "get_30day_chat_history",
          description: "Fetch the chat history between you and User the past 30 days.Use it when User wants to discuss or revisit an old topic/subject/discussion",
          parameters: {
              type: "object",
              properties: {}, // No parameters
              required: []    // No required parameters
          },
      },  
  
      // Token Price Search Integration
      {
        name: "token_price_dexscreener",
        description: "Fetch token prices using DexScreener. Use for tokens with known activity on DexScreener. Both 'query' and 'queries' cannot be present for 'token_price_dexscreener'. Use one: choose query for single string search, use queries for batch/multi strings searches",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Token symbol or address for single query, e.g., 'BTC' or '0xc0041ef357b183448b235a8ea73ce4e4ec8c265f'."
            },
            queries: {
              type: "array",
              items: { type: "string" },
              description: "Array of token symbols or addresses for batch processing, e.g., ['BTC', 'FTM', 'BNB']."
            }
          },
          required: []
        }
      },
  
      {
        name: "token_price_coingecko",
        description: "Fetch token prices from CoinGecko as the primary source. Use for most token queries. Both 'query' and 'queries' cannot be present for 'token_price_coingecko'. Use one: choose query for single string search, use queries for batch/multi strings searches",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Token symbol or full token address for single query, e.g., 'BTC' or '0xc0041ef357b183448b235a8ea73ce4e4ec8c265f'."
            }
          },
          required: ["query"]
        }
      },

      // Token Symbol to Address Mapping
      {
        name: "fetch_tokenaddress_fromsymbol",
        description: "Fetch token address using the provided symbol from swap transactions and confirm with user if it's the correct token address they want to swap to or from.",
        parameters: {
          type: "object",
          properties: {
            tokenSymbol: {
              type: "string",
              description: "Token symbol, e.g., 'SNAI or snai'. For Solana, Ethereum, Base and Avalanche addresses only."
            }
          },
          required: ["tokenSymbol"]
        }
      },
  
      // Token Analysis Functions
      {
        name: "analyze_token_by_symbol",
        description: "Fetch token metadata by symbol including price, volume, liquidity, and social info. Parameters 'tokenSymbol'",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Token symbol, e.g., 'BTC'. Usage: choose tokenSymbol for single string search."
            },            
            queries: {
              type: "array",
              items: { type: "string" },
              description: "Array of search symbols for batch processing, e.g., ['SNAI', 'BTC', 'SOL']."
            },
          },
          required: []
        }
      },
  
      {
        name: "analyze_token_by_address",
        description: "Fetch token metadata by address including price, volume, liquidity, and social info. Both 'tokenAddress' and 'tokenAddresses' cannot be present for 'analyze_token_by_address'. Use one: choose tokenAddress for single string search, use tokenAddresses for batch/multi strings searches",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Token address, e.g., '0xabc...'."
            },
            queries: {
              type: "array",
              items: { type: "string" },
              description: "Array of token addresses for batch processing."
            }
          },
          required: []
        }
      },

      {
        name: "fetch_token_snipers",
        description:
          "Fetch token sniper data for a given blockchain and pair address. Returns the data if found, or a message if no snipers are available.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The pair address for which to retrieve token sniper data. Request from user is not available. Pair address is not token address!"
            },
            blocksAfterCreation: {
              type: "number",
              description: "The number of blocks after creation to consider. Defaults to 1000 if not provided.",
              default: 1000
            }
          },
          required: ["query"]
        }
      },

      // Token Security Scan: score, liquidity locks, volume bots
  
      // Token paste with no instruction
      {
        name: "handle_address_only_pasted",
        description: "Handle random address pasting by user with no instructions: fetches token infor, price, holders, snipers and validates it, and suggests available actions to the user.",
        parameters: {
          type: "object",
          properties: {
            address: {
              type: "string",
              description: "The token or wallet address provided by the user. Can be Ethereum or Solana."
            }
          },
          required: ["address"]
        },
        returns: {
          type: "object",
          properties: {
            network: {
              type: "string",
              description: "The blockchain network detected for the address (e.g., ethereum, solana)."
            },
            actions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    description: "Type of the action (e.g., scan, get_price, get_sentiment)."
                  },
                  name: {
                    type: "string",
                    description: "Display name of the action."
                  },
                  description: {
                    type: "string",
                    description: "Description of what the action does."
                  }
                }
              }
            },
            tokenInfo: {
              type: "object",
              properties: {
                symbol: {
                  type: "string",
                  description: "Symbol of the token."
                },
                price: {
                  type: "number",
                  description: "Current price of the token (optional)."
                },
                sentiment: {
                  type: "string",
                  description: "Sentiment for the token (if fetched)."
                }
              }
            },
            message: {
              type: "string",
              description: "Formatted message describing the available actions."
            }
          }
        }
      },    
  
      // Butler Assistant
      {
          name: "set_reminder",
          description: "Connect User Google Email, Google Drive, Google Calender services. Save Email, Pictures and Calender reminders to User Google accounts",
          parameters: {
          type: "object",
          properties: {
              text: { type: "string" },
              time: { type: "string", format: "date-time" },
              recurring: { type: "boolean" }
          },
          required: ["text"]
          }
      },
  
      {
          name: "start_monitoring_reminders",
          description: "Start monitoring user's Google Services Email and Calender reminders",
          parameters: {
          type: "object",
          properties: {
              text: { type: "string" }
          },
          required: ["text"]
          }
      },
  
      {
          name: "generate_google_report",
          description: "Generate a report on User Google Emails and Calender events",
          parameters: {
              type: "object",
              properties: {}, // No parameters
              required: []    // No required parameters
          },
      },  
  
      // Strategy Management
      {
          name: "save_strategy",
          description: "Save a trading strategy",
          parameters: {
          type: "object",
          properties: {
              name: { type: "string" },
              description: { type: "string" },
              parameters: { type: "object" }
          },
          required: ["name", "description", "parameters"]
          }
      },
  
      // Bitrefill Giftcard Shopping
      {
        name: "start_bitrefill_shopping_flow",
        description: "Start the shopping process for Bitrefill gift cards.",
        parameters: {
          type: "object",
          properties: {
            email: { type: "string", description: "User's email address (optional)" },
          },
        }
      },
  
      {
        name: "check_bitrefill_payment_status",
        description: "Check the payment status of a Bitrefill order.",
        parameters: {
          type: "object",
          properties: {
            invoiceId: { type: "string", description: "Invoice ID for the order" },
          },
          required: ["invoiceId"],
        }
      },

      {
        name: "create_evm_wallet",
        description: "Create a EVM Wallet only once for user and return wallet and private key",
        parameters: {
          type: "object",
          properties: {
            network: {
              type: "string",
              enum: ["ethereum","avalanche","base","linear","cyber","fantom","arbitrum","berachain","nova","optimism","zkevm","scroll","polygon","bsc","celo","worldchain","mantle","zksync","omin"],
              description: "The blockchain network to use."
            },
          },        
          required: ["network"],
          }
      },

      // Research 
      {
        name: "save_research",
        description:
          "Saves research content using the user's conversation context. The AI model should pass all results from its last messages as the content and include a comment summarizing the research. Keywords will be auto-selected if not provided.",
        parameters: {
          type: "object",
          properties: {
            content: {
              type: "string",
              description: "The research content (e.g., the AI's last messages) to save."
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "Optional list of keywords. If not provided, they will be auto-selected.",
              default: []
            },
            notes: {
              type: "string",
              description: "Optional comment summarizing what the research is about.",
              default: ""
            }
          },
          required: ["content"]
        }
      },

      {
        name: "retrieve_research",
        description:
          "Retrieves research records for a user. If 'researchId' is provided, returns that specific record. If 'keyword' is provided, returns all records matching the keyword. If neither is provided, returns all research records for the user.",
        parameters: {
          type: "object",
          properties: {
            researchId: {
              type: "string",
              description: "Optional research record ID to retrieve a specific record."
            },
            keyword: {
              type: "string",
              description: "Optional keyword to filter research records."
            }
          },
          required: []
        }
      },

      {
        name: "delete_research",
        description:
          "Deletes a specific research record by its ID for a given user.",
        parameters: {
          type: "object",
          properties: {
            researchId: {
              type: "string",
              description: "The ID of the research record to delete."
            }
          },
          required: ["researchId"]
        }
      },

      // Tasks
      {
        "name": "save_task",
        "description": "Create or save a one time or periodic task given by the User. The AI model should pass its conversation context as the content. The task will be saved with a default heading: 'Execute this task now, pull all resources required first, execute now dont reply'. Parameters include telegramId, content, dueTime (ISO string or Date), and an optional recurrence which can be 'none', 'daily', or a custom interval in minutes (minimum 5).",
        "parameters": {
          "type": "object",
          "properties": {
            "content": {
              "type": "string",
              "description": "The full task content, e.g. 'search the internet for Trump latest news'. Or 'check the mindshare and setniment on $SNAI, buy 0.001SOL worth SNAI if mindhare result is over 70'."
            },
            "dueTime": {
              "type": "string",
              "description": "ISO date string when the task is due."
            },
            "recurrence": {
              "anyOf": [
                {
                  "type": "string",
                  "enum": ["none", "daily"],
                  "default": "none"
                },
                {
                  "type": "number",
                  "minimum": 5,
                  "description": "Custom recurrence interval in minutes (minimum 5)."
                }
              ],
              "description": `Optional recurrence. Can be 'none', 'daily', or a custom interval in minutes (minimum 5). 
              When saving a task, if the user intends the task to run only once, set "recurrence": "none".
              Only use a numeric value (or "daily") if the task is meant to recur. 
              For instance, if the user says "check the price of BTC in 10 mins" and they intend it to run only once, you must set "recurrence": "none" even though the due time is 10 minutes in the future.`
            },
            "heading": {
              "type": "string",
              "description": "Optional custom heading. If omitted, a default is used."
            }
          },
          "required": ["content", "dueTime"]
        }
      },      

      {
        name: "retrieve_task",
        description:
          "Retrieves tasks for a user. If 'taskId' is provided, returns that specific task. " +
          "Otherwise, returns all tasks for the user.",
        parameters: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "Optional task ID to retrieve a specific task."
            }
          },
          required: []
        }
      },

      {
        name: "execute_task",
        description:
          "Executes a due task for a user. This marks the task as completed and saves the execution result. " +
          "The AI model should pass the taskId and the result details.",
        parameters: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The ID of the task to execute."
            },
            result: {
              type: "string",
              description: "The result or output from executing the task."
            }
          },
          required: ["taskId", "result"]
        }
      },      

      {
        name: "delete_task",
        description:
          "Deletes a task for the user. The AI model should pass the taskId. Retrieve task id first " +
          "The specified task will be removed from the database.",
        parameters: {
          type: "object",
          properties: {
            taskId: {
              type: "string",
              description: "The ID of the task to delete."
            }
          },
          required: ["taskId"]
        }
      },      
      
      
];
