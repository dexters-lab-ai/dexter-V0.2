# 🐱 Welcome to KATZ - Your AI-Powered Crypto & Life Assistant

## Introduction

KATZ is the first truly autonomous cross-platform AI Agent accessible through Telegram. Unlike traditional bots, KATZ understands natural language - just chat with it like you would with a human assistant. No need to remember rigid commands or syntax!

KATZ is designed to be your all-in-one assistant for crypto trading, monitoring, research, and much more. Simply express what you need in plain English, and KATZ will understand and execute the appropriate function to fulfill your request.

## How KATZ Works

### Natural Language Understanding

Instead of typing rigid commands like `/get_price BTC`, you can simply say:
- "What's the current price of Bitcoin?"
- "Show me how BTC is doing right now"
- "Has Bitcoin's price changed much since yesterday?"

KATZ's powerful AI understands your intent and maps it to the appropriate function in the background.

### Function Mapping

When you send a message to KATZ:

1. **Natural Language Processing**: KATZ analyzes your message to determine your intent
2. **Function Selection**: It selects the appropriate function to handle your request
3. **Parameter Extraction**: It identifies the required information from your message
4. **Execution**: It runs the function and returns your results
5. **Follow-up**: KATZ remembers context, so follow-up questions work naturally

## Special Features

### 🗣️ Voice Input and Output

KATZ supports both voice messages and text. Send a voice message and KATZ will:
- Transcribe your message
- Process your request
- Respond with text (or voice if you prefer)

Simply say "Enable voice responses" to switch to voice output mode.

### ⏰ Scheduled Tasks & Monitoring

One of KATZ's most powerful features is its ability to schedule and automate tasks:

- **Token Monitoring**: "Alert me when PEPE drops below $0.00001"
- **Regular Updates**: "Send me BTC price updates every 4 hours"
- **Event Scheduling**: "Remind me about the Solana hackathon on Friday"
- **Breaking News**: "Let me know when there's major news about Ethereum"

KATZ's scheduling system runs your requests at the specified times, continuously monitoring markets, prices, social media, and more. No need to constantly check - KATZ will notify you when something important happens!

### 🔒 Security and Account Management

- **Exclusive Access**: Your Telegram ID is tied to your KATZ account and cannot be shared or accessed by any other Telegram account.
- **Protected Communication**: KATZ only accepts commands from your registered Telegram account, rejecting all other message sources for enhanced security.
- **Automatic Wallets**: During account creation, KATZ creates blockchain wallets for you. Keep these credentials safe!
- **Lightning Wallet**: For Meme Launchpad tools, register a lightning wallet (a specialized Solana wallet) to create transactions/programs through platforms like Pump.fun, Bonkfun, and Moonshot.
- **Unlimited Accounts**: Create as many accounts as you want - even a new wallet for every token launch. KATZ handles it all! Simply ask "delete my lightning account" if you want to remove one.

## Command Reference

Here is a detailed breakdown of the functions KATZ can perform. For each function, you'll find its purpose, the parameters it accepts, and examples of how to use it with natural language.

### 🤖 AI Model

#### **Toggle LLM**
- **Description**: Switch the default AI model between OpenAI and DeepSeek.
- **Function**: `toggle_llm`
- **Parameters**: None
- **Examples**:
  - "Switch to the DeepSeek model."
  - "Use OpenAI for a bit."

### 💼 Wallet & Portfolio

#### **Get Wallet Balances**
- **Description**: Fetches detailed balances for your wallets on various networks.
- **Function**: `get_wallet_balances`
- **Parameters**:
  - `network` (optional): `ethereum`, `avalanche`, `base`, `solana`. Leave empty to query all.
  - `tokenList` (optional): A list of specific ERC20 token addresses to check.
- **Examples**:
  - "Show me my wallet balances on Solana."
  - "How much ETH do I have?"

#### **Get Wallet Transactions**
- **Description**: Fetches all token transactions for a specific wallet.
- **Function**: `get_wallet_token_transactions`
- **Parameters**:
  - `network` (required): `ethereum`, `base`, `avalanche`, `solana`.
  - `walletAddress` (required): The address of the wallet to check.
- **Examples**:
  - "Get the latest transactions for my Ethereum wallet 0x123..."
  - "Show me my recent SOL transactions."

#### **Get Portfolio**
- **Description**: Get your token portfolio across all your wallets.
- **Function**: `get_portfolio`
- **Parameters**:
  - `network` (optional): `ethereum`, `base`, `solana`, `avalanche`, `etc`. Leave empty for a combined view.
- **Examples**:
  - "What does my portfolio look like?"
  - "How are my investments doing?"

### 📈 Market & Token Analysis

#### **Get Market Conditions**
- **Description**: Get an overview of current market conditions.
- **Function**: `get_market_conditions`
- **Parameters**:
  - `includeDefi` (optional): Include DeFi metrics.
  - `includeSentiment` (optional): Include market sentiment.
- **Examples**:
  - "What are the current market conditions? Include DeFi stats."
  - "Is the market bullish or bearish today?"

#### **Get Trending Tokens by Chain**
- **Description**: Fetches trending tokens for a specific blockchain.
- **Function**: `fetch_trending_tokens_by_chain`
- **Parameters**:
  - `query` (optional): A single chain to search (e.g., `solana`).
  - `queries` (optional): A list of chains to search (e.g., `['ethereum', 'base']`).
- **Examples**:
  - "What tokens are trending on Base right now?"
  - "Show me the hottest coins on Solana and Ethereum."

#### **Get Trending Tokens from All Sources**
- **Description**: Fetches top trending tokens from Dextools, Dexscreener, CoinGecko, and Twitter.
- **Function**: `fetch_trending_tokens_all_sources`
- **Parameters**: None
- **Examples**:
  - "Show me the top trending tokens overall."
  - "What's popping in the crypto world?"

### 🚀 Pump.fun & Memecoin Tools

#### **Get Pump.fun Bonding Status**
- **Description**: Get detailed bonding status for a Pump.fun token.
- **Function**: `get_pumpfun_token_bonding_status`
- **Parameters**:
  - `tokenAddress` (required): The token's mint address.
- **Examples**:
  - "What's the bonding status for token H2p8S..."
  - "Is this token about to graduate?"

#### **Create Pump.fun Token**
- **Description**: Create a new token on Pump.fun.
- **Function**: `create_pumpfun_token`
- **Parameters**:
  - `lightningWalletId` (required): The ID of your Lightning wallet.
  - `name`, `symbol`, `description`, `twitter`, `telegram`, `website` (required)
  - `amount`, `slippage`, `priorityFee` (optional)
- **Examples**:
  - "Create a new pump.fun token named 'KatzCoin' with the symbol 'KATZ'."
  - "Let's launch a memecoin on pump.fun."

#### **Create Moonshot Token**
- **Description**: Create a new token on Moonshot.
- **Function**: `create_moonshot_token`
- **Parameters**:
  - `lightningWalletId` (required): The ID of your Lightning wallet.
  - `name`, `symbol`, `description`, `website` (required)
  - `amount`, `slippage`, `priorityFee` (optional)
- **Examples**:
  - "Launch a new token on Moonshot called 'GalaxyQuest'."
  - "I want to make a Moonshot token."

#### **Create Bonk Token**
- **Description**: Create a new token on Bonk.
- **Function**: `create_bonk_token`
- **Parameters**:
  - `lightningWalletId` (required): The ID of your Lightning wallet.
  - `name`, `symbol`, `description`, `website` (required)
  - `amount`, `slippage`, `priorityFee` (optional)
- **Examples**:
  - "I want to create a Bonk token called 'MemeLord'."
  - "Help me make a Bonk coin."

### ⛓️ Trading & Swaps

#### **Execute Solana Swap**
- **Description**: Swap tokens on Solana using Jupiter.
- **Function**: `execute_solana_swap`
- **Parameters**:
  - `wallet` (required): Your Solana wallet address.
  - `inputMint` (required): Token to sell (use `So11111111111111111111111111111111111111112` for SOL).
  - `outputMint` (required): Token to buy.
  - `amount` (required): Amount to swap.
- **Examples**:
  - "Swap 0.5 SOL for USDC in my main wallet."
  - "Buy some WIF with my SOL."

#### **Execute EVM Swap**
- **Description**: Swap tokens on various EVM chains.
- **Function**: `evm_token_swap`
- **Parameters**:
  - `network` (required): e.g., `ethereum`, `base`, `avalanche`.
  - `action` (required): `buy` or `sell`.
  - `inputToken`, `outputToken`, `amount`, `walletAddress` (required)
- **Examples**:
  - "On the Base network, sell 1000 DEGEN for ETH from wallet 0xabc..."
  - "Buy some PEPE on Ethereum."

### 🌉 Bridging

#### **Bridge Tokens**
- **Description**: Bridge tokens between over 30 different blockchains.
- **Function**: `process_bridge_intent`
- **Parameters**:
  - `sourceChain`, `targetChain`, `tokenAddress`, `amount`, `recipientAddress` (required)
- **Examples**:
  - "Bridge 0.1 ETH from Ethereum to Solana. Send it to my wallet there."
  - "I need to move some USDC from Base to Avalanche."

#### **Fetch Bridge Receipts**
- **Description**: Get a list of your past bridging transactions.
- **Function**: `fetch_bridge_receipts`
- **Parameters**:
  - `telegramId` (required): Your Telegram ID.
  - `limit` (optional): Number of records to return.
- **Examples**:
  - "Show me my last 5 bridge transactions."
  - "Did my last bridge go through?"

### 🔔 Price Alerts

#### **Create Price Alert**
- **Description**: Set up a price alert for a token, with an optional automatic swap.
- **Function**: `create_price_alert`
- **Parameters**:
  - `walletAddress`, `tokenAddress`, `targetPrice`, `condition` (`above` or `below`) (required)
  - `swapAction` (optional): An object to define a buy/sell action when the price is hit.
- **Examples**:
  - "Alert me if SOL goes below $150. If it does, sell 2 SOL from my wallet FQKR..."
  - "Let me know when ETH hits $4000."

#### **View/Edit/Delete Price Alerts**
- **Description**: Manage your existing price alerts.
- **Functions**: `view_price_alerts`, `view_price_alert`, `edit_price_alert`, `delete_price_alert`
- **Parameters**:
  - `alertId` (required for view, edit, delete)
- **Examples**:
  - "Show me all my price alerts."
  - "Delete the price alert for Bitcoin."
  - "Change my SOL alert to $200."

### 📱 Social Media & Web

#### **Search Twitter**
- **Description**: Perform advanced searches on Twitter for tweets about tokens, users, or topics.
- **Function**: `search_twitter_using_multi_parameter_options`
- **Parameters**:
  - `query` (required): The main search term.
  - `from`, `to`, `class`, `operators`, `sortBy`, `maxItems` (optional)
- **Examples**:
  - "Find recent tweets from @elonmusk that mention 'doge'."
  - "Find a PS5 for sale in my area from Twitter."
  - "What are people saying about the new Taylor Swift album?"

#### **Get Trench Chatter**
- **Description**: Get a vibe check of the latest crypto discussions from influential traders on Twitter.
- **Function**: `get_trench_chatter`
- **Parameters**: None
- **Examples**:
  - "What's the chatter in the trenches today?"
  - "What's the alpha?"

#### **Search the Internet**
- **Description**: Search the web using the Brave Search API.
- **Function**: `search_internet`
- **Parameters**:
  - `query` (optional): A single search query.
  - `queries` (optional): A list of search queries.
- **Examples**:
  - "Search for the latest news on AI and crypto."
  - "What's the latest news on Trump?"
  - "Find me a good recipe for lasagna."

### 🛍️ Shopping & Payments (Coming Soon)

*The following features are under development and will be available soon.*

#### **Search Products (Shopify)**
- **Description**: Search for products in a Shopify store.
- **Function**: `search_products`

#### **Create Solana Payment**
- **Description**: Create a Solana Pay payment request.
- **Function**: `create_solana_payment`

#### **Start Bitrefill Shopping**
- **Description**: Start a shopping flow on Bitrefill to buy gift cards with crypto.
- **Function**: `start_bitrefill_shopping_flow`

### 🚀 Unleash the Power of Chained Commands

KATZ isn't just for single tasks; it's a true autonomous agent that can handle a series of commands all at once. Just describe what you want to achieve in one continuous thought, and KATZ will break it down and execute each step in sequence. During our testing, we've found that KATZ can reliably handle up to 5 chained tasks in a single command! 

This opens up a new world of possibilities. Be creative and experiment! Here are a few examples to get you started:

- **Crypto Market Research**:
  > "Go check what's trending on Solana, pick the top token, and search what people are saying about it on X using its cashtag. Then tell me if the sentiment looks bullish enough to buy right now."

- **Automated Trading Setup**:
  > "Find the top 3 trending tokens on Base, do a quick analysis of each one, and then create a price alert for the one with the highest 24-hour volume to notify me if it drops by 10%."

- **Daily Briefing**:
  > "Give me the latest news about Trump, check the weather in Miami, and then show me my portfolio balance."

- **Entertainment Planning**:
  > "Find out what time the new Dune movie is playing near me, check the reviews on Rotten Tomatoes, and then search Twitter to see if people think it's good."

Don't be afraid to push the limits. Sometimes it needs a nudge, like get the url first from the results then go open it on rotten tommatoes and find out what i asked about the movie". Sometimes, push it around until it gets things right. The more you experiment, the more you'll discover what your AI assistant is truly capable of.

## Conclusion

KATZ is continuously evolving with new features and capabilities. Simply chat naturally with KATZ about what you need, and it will handle the rest! For any function not explicitly covered here, just ask KATZ and it will guide you through the process.

**Try KATZ today: [@KATZlifeBot](https://t.me/ai_trench_bot) 🐱**

Remember, KATZ is powered by natural language - no need to memorize commands or syntax. Just talk to KATZ like you would to a friend who happens to be a crypto expert!
