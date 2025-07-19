```plaintext
{{ ... }}

🔥 **KATZ! (O.P.E.R.A.T.O.R-TG)** 🔥
```

# KATZ! (O.P.E.R.A.T.O.R-TG)

## 🤖 The Flagship Implementation of Dexter AI

KATZ! is the premier implementation of the Dexter AI platform, a sophisticated autonomous agent that processes natural language inputs to perform complex tasks across multiple blockchains and platforms. Powered by a custom engine, KATZ! understands context, maintains conversation state, and executes multi-step workflows with ease.

![KATZ! Banner](assets/images/O.P.E.R.A.T.O.R-TG-logo.jpg)

## 🏆 Competitive Edge

KATZ! stands out from traditional AI agents because it:

- ✅ Executes complex multi-step tasks from a single prompt (research, analytics, sentiment assessments, swaps, approvals, bridging, payments)
- ✅ Analyzes and interprets data in a structured logic tree with dependency categorization
- ✅ Integrates with both Web2 & Web3 services through a simple Telegram interface
- ✅ Handles voice commands for full hands-free execution
- ✅ Supports customization for adaptive use and growth
- ✅ Maintains persistent user information and context awareness

## 🌍 Core Capabilities

### 🌐 Multi-Chain Support
- **Ethereum** (Mainnet, Goerli)
- **Solana** (Mainnet, Devnet)
- **Polygon** (Mainnet, Mumbai)
- **BSC** (Mainnet, Testnet)
- **Avalanche** (C-Chain, Fuji)
- **Arbitrum** (One, Nova)
- **Optimism**
- **Fantom**

### 🔄 Key Features
- Natural language understanding and processing
- Multi-step task execution with context awareness
- Cross-chain token swaps and transfers
- Portfolio tracking and management
- Advanced token analysis and research
- Voice command support (TTS/STT)
- Automated trading strategies
- Price alerts and monitoring
- Smart contract interactions

## 🛠 Available Functions

### 🔍 Token Operations
- `approve_token` - Approve token spending
- `revoke_token_approval` - Revoke token approvals
- `analyze_token_by_symbol` - Get token information by symbol
- `analyze_token_by_address` - Get token information by contract address
- `fetch_tokenaddress_fromsymbol` - Find token address by symbol

### 🔄 Trading & Swaps
- `evm_token_swap` - Swap tokens on EVM chains
- `execute_solana_swap` - Swap tokens on Solana via Jupiter
- `execute_avalanche_swap` - Swap tokens on Avalanche
- `ethereum_base_token_transfer` - Transfer tokens on EVM chains
- `process_bridge_intent` - Bridge tokens between chains

### 📊 Market Data
- `get_market_conditions` - Get current market conditions
- `fetch_market_categories` - List market categories
- `fetch_market_category_metrics` - Get metrics for market categories
- `fetch_coins_by_category` - List coins by category
- `fetch_trending_tokens_all_sources` - Get trending tokens across all sources
- `fetch_trending_tokens_by_chain` - Get trending tokens by blockchain

### 💰 Portfolio & Wallet Management
- `get_portfolio` - View portfolio summary
- `get_wallet_balances` - Check wallet token balances
- `get_wallet_token_transactions` - View token transaction history
- `create_price_alert` - Set up price alerts
- `view_price_alerts` - View active price alerts
- `getLightningWallets` - View all Lightning wallets
- `removeLightningWallet` - Remove a Lightning wallet from your account

### 🚀 Token Launch & Management
- `createLightningWallet` - Create a new Lightning wallet for token operations
- `removeLightningWallet` - Remove a wallet from your account
- `getLightningWallets` - View all your Lightning wallets

**Supported Launchpads:**

#### 🚀 Pump.fun
- Create viral meme tokens with built-in DEX support
- Automatic liquidity management via bonding curve
- Graduation to Raydium DEX at 50K liquidity
- Real-time price and volume tracking

#### 🐶 Bonk.fun
- Meme tokens with native NFT integration
- Perfect for community-driven projects
- Active degens community
- Built on Solana for fast, low-cost transactions

#### 🌕 Moonshot
- USDC-denominated stable launches
- Fast deployment with stable value
- Clean, simple interface
- Ideal for serious projects

#### 🔄 Token Management
- Create and manage multiple tokens
- Track token performance
- Monitor liquidity and trading volume
- Seamless cross-platform operations

### 🎯 Trading Automation
- `setup_flipper_mode` - Configure automated trading mode
- `start_flipper_mode` - Start automated trading
- `stop_flipper_mode` - Stop automated trading
- `monitor_kol` - Monitor key opinion leader wallets
- `get_kol_monitor_positions` - View KOL monitoring positions

### 🔍 Research & Analysis
- `search_token_by_twitterusername` - Research tokens by Twitter handle
- `check_token_mindshare_on_market` - Analyze token market sentiment
- `suggest_token_investments_dominating` - Get token investment suggestions
- `search_twitter_by_address` - Search Twitter for token addresses
- `get_token_market_sentiment_changes` - Track sentiment changes

### 📧 Communication
- `send_email` - Send emails
- `search_emails` - Search email history
- `read_email` - Read specific emails
- `reply_email` - Reply to emails
- `manage_calendar_event` - Manage calendar events


## 🌍 Overview 

O.P.E.R.A.T.O.R-TG is designed to be an intelligent, natural language–driven agent that performs complex tasks with minimal user intervention. It converts everyday language into intricate sequences of function calls, processes multi-step tasks with error-resilient logic, and returns comprehensive results—all while continuously tracking context to inform follow-up actions. Whether you need to execute a crypto swap, monitor market sentiment, set up price alerts, or even manage your schedule, O.P.E.R.A.T.O.R-TG is built to handle it all. 

O.P.E.R.A.T.O.R-TG’s ability to manage dependencies and execute multiple actions in a structured, logical order makes it a powerful AI assistant capable of tackling real-world problems. By integrating seamlessly with multiple blockchain networks, API services, and external applications, O.P.E.R.A.T.O.R-TG extends beyond basic AI chatbots into a fully functional digital agent. 

---

## 🔑 Key Functions 

### **Multi-Stage Processing Pipeline**
1. **processMessage**: Gathers conversation context, composes comprehensive instructions, and routes user requests to the right function. 
2. **getFunctionResponse**: Uses recent context and execution results in a dynamic tree approach to determine if further function calls are needed or what hasnt been done yet regarding a task. 
3. **generateAIResponse**: Produces a final, user-friendly output summarizing results and next steps. 

### **Advanced Context Management**
- Maintains a robust conversation history (user, assistant, and function messages) with intelligent trimming to optimize token usage. 
- Stores results from every function call (both successful and error responses) so that the system can determine follow-up actions based on the latest data. 
- Ensures that dependent tasks are executed in the correct order, preventing redundant actions and optimizing response time. 

### **Function Calling & Retry Logic**
- Supports dynamic task trees with dependency resolution. Mnetioned above, this is what shows the "noodling" updates when tasks are running revealing what it is doing behind the scenes. 
- Implements robust error handling and retry logic with user confirmation prompts. 
- Automatically converts blockchain-specific units (e.g., lamports) into human-readable formats for clarity.

### **Media Interactions**

#### 🖼️ Image Processing
- **AI Image Generation**: Create custom images using natural language prompts
- **Image Editing**: Modify existing images with text-based instructions
- **Image Variations**: Generate multiple variations of an existing image
- **Image Analysis**: Get detailed descriptions of image contents
- **Media Processing**: Handle various image formats and sizes with automatic optimization

#### 🎙️ Voice Interaction
O.P.E.R.A.T.O.R-TG supports full voice interaction for hands-free execution using Whisper AI for transcription and Google TTS.

**Features**:
- 🎤 Voice commands (e.g., "Buy 1 ETH worth of SOL")
- 🔊 Spoken responses (e.g., "Your trade has been executed")
- 🎧 Hands-free interaction

**Technical Implementation**:
```javascript
const processedText = await this.voiceService.transcribeVoiceWhisp(fileUrl);
const audioBuffer = await this.voiceService.synthesizeGoogle(responseText);
```

### **Extensible & Modular Design**
- Provides a comprehensive suite of functions on multiple networks (Solana, Ethereum, Avalanche, Base), market analysis, price alerts, limit orders, swaps, bridging, transfers, payments, staking(soon), wallet access, portfolio management, strategy discussion and saving, and more. 
- Built to integrate with external services such as QuickNode, CoinGecko, DexScreener, Brave Search, and pretty much any service that is willing to offer a user case and an API for our users. 

#### Image Generation & Editing Examples

```javascript
// Generate a new image
const response = await openAIService.createImage({
  prompt: 'A futuristic city skyline at sunset',
  n: 1,
  size: '1024x1024'
});

// Edit an existing image
const editedImage = await openAIService.createImageEdit({
  image: imageBuffer,  // Original image buffer
  mask: maskBuffer,    // Optional mask for selective editing
  prompt: 'Add a flying car to the sky',
  n: 1,
  size: '1024x1024'
});

// Generate variations of an image
const variations = await openAIService.createImageVariation({
  image: imageBuffer,
  n: 3,  // Generate 3 variations
  size: '1024x1024'
});
```

###📜 **Function Definitions Insights**

O.P.E.R.A.T.O.R-TG includes a large suite of executable functions across multiple domains, including advanced media processing capabilities. They look like this:

### Trading & Portfolio Management example

```json
{
  "name": "execute_solana_swap",
  "description": "Swap tokens on Solana using Jupiter.",
  "parameters": {
    "wallet": "string",
    "inputMint": "string",
    "outputMint": "string",
    "amount": "string"
  },
  "required": ["wallet", "inputMint", "outputMint", "amount"]
}
{
  "name": "approve_token",
  "description": "Approve token spending on EVM networks.",
  "parameters": {
    "network": "string",
    "tokenAddress": "string",
    "spenderAddress": "string",
    "amount": "string",
    "walletAddress": "string"
  },
  "required": ["network", "tokenAddress", "spenderAddress", "walletAddress"]
}
```

### Market Analysis & Sentiment Tracking example
```json
{
  "name": "fetch_trending_tokens_all_sources",
  "description": "Fetch top trending tokens across sources: dextools, dexscreener, coingecko, Twitter.",
  "parameters": { "sources": "array" },
  "required": []
}
```

### 🔬 Future Plans 

- **Open Sourcing** 
- **Autonomous Referencing** 
- **Expanded Integrations: Shopify, Amazon, Travel, Liquid Staking** 
- **Advanced KOL Monitoring & Sentiment-Based Trading** 
- **O.P.E.R.A.T.O.R-WebApp Integration**: Allow O.P.E.R.A.T.O.R-TG to send and receive commands to/from your localhost Agent on PC. 
- **Improved Trading Execution Strategies**: Leverage machine learning for smarter, data-driven trading decisions. 

---

KATZ! is more than just an assistant—it’s your intelligent, versatile partner for navigating the complexities of crypto trading and beyond. 

---

## **🚀 More Features**

### **🎯 FlipMode: Automated Trading**
- **Buy Low, Sell High**: Implements entry, take-profit, and stop-loss automatically.  
- **Live Monitoring**: Tracks every token position with real-time updates.  
- **Dynamic Risk Management**: Adjusts to market conditions and user-defined profit/loss targets.  
- **Timeouts**: Closes trades if positions stay open for too long.

### **🕒 Timed Orders**
- **Schedule Trades**: Execute buy/sell orders at specific times.  
- **Custom Strategies**: Build recurring or one-time schedules.  
- **Perfect Timing**: Let KATZ! [O.P.E.R.A.T.O.R-TG] handle late-night or early-morning trades.

### **📈 Custom Alerts**
- **Price Alerts**: Get notified when a token hits your target price.  
- **Actionable Alerts**: Enable one-click execution for buy/sell when triggered.  
- **Multi-Network Compatibility**: Works seamlessly across Ethereum, Solana, and Base.

### **🔮 AI-Powered Scanning**
- **Gem Scanner**: Detects trending tokens with advanced AI.  
- **Duplicate Removal**: Filters out noise and focuses on unique opportunities.  
- **KOL Monitoring**: Tracks Key Opinion Leaders (KOLs) for token recommendations.  
- **Sentiment Analysis**: Gauges market buzz and token viability.

### **🗣️ Voice Commands**
- **Hands-Free Control**: Issue voice commands for for pretty much anything you need done.  
- **Natural Language Processing (NLP)**: Speak like a human; KATZ! [O.P.E.R.A.T.O.R-TG] understands.  
- **Multilingual**: Supports voice commands in multiple languages.

### **⚡ Custom Orders**
- **Flexible Parameters**: Choose trade amounts, slippage, and wallet type.  
- **Percentage-Based Actions**: Trade a percentage of your portfolio.  
- **Multi-Wallet Support**: Works with WalletConnect, internal wallets, and external APIs.

### **🌐 Real-Time WebSocket Connections**
- **PumpPortal Integration**: Subscribe to token trade updates and new token listings.  
- **Efficient Connections**: Keeps a single WebSocket connection alive for all subscriptions.  
- **Error Handling**: Reconnects automatically when things go south.

### **📊 Metrics and Analytics**
- **Live System Metrics**: Tracks trade counts, profits, and performance metrics.  
- **User-Level Metrics**: Monitors individual trading stats like win rates and hold times.  
- **Dashboards**: Displays real-time and aggregated performance data.  

### 🔒 Secure Wallet Management
- **Encryption**: Keeps private keys safe with advanced encryption.  
- **Multi-Network Wallets**: Manage Ethereum, Solana, and Base wallets effortlessly.  
- **Approval Handling**: Requests and manages token approvals for trades.  

---

### 🪱 Wormhole Bridging Service
O.P.E.R.A.T.O.R-TG integrates **Wormhole** to facilitate cross-chain bridging between **Solana, Ethereum, and Avalanche**.  
- Users can **bridge tokens seamlessly** between these chains, unlocking arbitrage opportunities and cross-ecosystem transfers.  
- The agent **automates bridging decisions** based on **real-time market conditions**, fee structures, and token availability.  
- This integration enhances **DeFi accessibility**, allowing users to interact with multiple blockchains effortlessly.  

---

### 💰 Solana Pay for Payments [WIP]
O.P.E.R.A.T.O.R-TG features full integration with **Solana Pay**, enabling instant, low-cost crypto payments.  
- Users can generate **QR codes** for seamless transactions.  
- Payments are verified in **real-time**, ensuring secure and efficient transfers.  
- Invoice generation and **payment history tracking** provide a smooth experience for crypto commerce.  

---

### 🛒 Shopping & E-Commerce [WIP]
#### 🛍️ Shopify Integration
- Direct **product search and purchase** from Shopify stores via API access.  
- O.P.E.R.A.T.O.R-TG will source products, **track order status**, and manage cart-based transactions.  
- Future plans include **aggregating Shopify-listed products** into a **curated shopping experience** within O.P.E.R.A.T.O.R-TG.  

#### 📦 Amazon Purchases via Crypto [WIP]
- While **Amazon does not natively accept crypto**, O.P.E.R.A.T.O.R-TG **integrates Bitrefill**, allowing users to **buy Amazon gift cards with crypto**.  
- Users can purchase **gift cards** in various denominations, apply them instantly, and receive real-time confirmation.  
- This extends to **other e-commerce platforms**, creating a **crypto-to-fiat bridge** for mainstream purchases.  
---

🛠️ Tech Stack

    Backend: Node.js
    Database: MongoDB (Atlas)
    Blockchain: Ethereum (via Ethers.js), Solana, Avalanche, Base
    Real-Time Data: WebSocket APIs for token data streams
    AI/ML: NLP, sentiment analysis, and AI-powered execution
    Voice Processing: Google Cloud Speech-to-Text, ElevenLabs, Whisper
    Libraries:
        - Mongoose (Database ORM)
        - PQueue (Task Management)
        - Axios (API Requests)
        - Alchemy SDK (Blockchain API Integration)
        - Telegraf (Telegram Bot Framework)

📦 Dependencies

O.P.E.R.A.T.O.R-TG relies on a robust suite of dependencies to handle blockchain interactions, AI-based processing, real-time data retrieval, and automation.

🔗 Core Dependencies

| Dependency   | Version  | Purpose                                     |
|-------------|---------|---------------------------------------------|
| express     | ^4.18.2 | Web server framework for API interactions  |
| mongoose    | ^8.0.3  | MongoDB ORM for efficient data handling    |
| redis       | ^4.7.0  | High-speed caching layer                   |
| dotenv      | ^16.4.7 | Environment variable management            |
| p-queue     | ^7.4.1  | Task queue management for async processing |
| p-retry     | ^6.2.1  | Automatic retry logic for API calls        |
| node-fetch  | ^3.3.2  | HTTP request handling                      |
| axios       | ^1.6.2  | API interaction and HTTP requests          |

🧠 AI & Machine Learning

| Dependency                       | Version  | Purpose                                   |
|----------------------------------|---------|-------------------------------------------|
| @google-cloud/speech            | ^6.7.0  | Speech-to-Text processing                |
| @google-cloud/text-to-speech     | ^5.8.0  | AI-powered text-to-speech synthesis      |
| @google-cloud/aiplatform        | ^3.34.0  | AI model management and ML processing    |
| openai                          | ^4.20.1 | AI-powered NLP and intent processing     |
| elevenlabs                       | ^1.50.2 | High-quality voice synthesis for AI responses |

🔗 Blockchain & Web3

| Dependency                      | Version  | Purpose                                  |
|---------------------------------|---------|------------------------------------------|
| ethers                          | ^6.13.5 | Ethereum blockchain interactions         |
| @solana/web3.js                 | ^1.98.0 | Solana blockchain interactions          |
| @solana/spl-token               | ^0.4.9  | Solana token utilities                   |
| alchemy-sdk                     | ^3.1.0  | Alchemy API for blockchain analytics    |
| @quicknode/sdk                  | ^2.4.0  | QuickNode API integration               |
| @wormhole-foundation/sdk        | ^1.4.5  | Cross-chain bridging using Wormhole     |
| @walletconnect/sign-client      | ^2.17.2 | WalletConnect signing and authentication |
| @solana/pay                     | ^0.2.5  | Solana Pay integration                  |

📊 Market Data & Analysis

| Dependency                       | Version  | Purpose                                  |
|----------------------------------|---------|------------------------------------------|
| @jup-ag/api                     | ^6.0.36 | Jupiter Aggregator for Solana token swaps |
| dexscreener                      | ^1.0.0  | DexScreener API integration             |
| coingecko-api                    | ^2.0.0  | CoinGecko API for price & market data   |
| apify-client                     | ^2.8.4  | Web scraping for trend tracking         |
| bip39                            | ^3.1.0  | Mnemonic phrase handling                |

🎨 Visual & Charting

| Dependency                      | Version  | Purpose                                  |
|---------------------------------|---------|------------------------------------------|
| chartjs-node-canvas             | ^4.1.6  | Generating on-demand trading charts     |
| canvas-multiline-text           | ^1.0.3  | Dynamic text rendering for image outputs |
| sharp                           | ^0.33.5 | High-performance image processing       |

🔌 Telegram Bot & WebSockets

| Dependency                      | Version  | Purpose                                  |
|---------------------------------|---------|------------------------------------------|
| telegraf                        | ^4.16.3 | Telegram bot framework                  |
| node-telegram-bot-api           | ^0.64.0 | Telegram API integration                |
| ws                              | ^8.14.2 | WebSocket API for real-time event handling |

🧑‍💻 Developer & Testing Dependencies

| Dependency                      | Version  | Purpose                                  |
|---------------------------------|---------|------------------------------------------|
| nodemon                         | ^3.0.2  | Automatic server restarts during development |
| vitest                          | ^0.34.6 | Unit testing framework                   |
| esbuild                         | ^0.19.8 | Fast JavaScript bundler for builds       |

📜 Installation & Setup

O.P.E.R.A.T.O.R-TG requires Node.js >= 18.0.0. Follow these steps to install and configure your environment.

```sh
# Clone the repo
git clone https://github.com/dexters-lab-ai/dexter-V0.2.git

# Navigate to the directory
cd dexter-V0.2

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Populate .env with your API keys, QuickNode, OpenAI, MongoDB URI, and configuration.

# Start the bot
npm start

```

---

## **💻 API Integrations Outlined**

- **OpenAI API**: Advanced LLM Model prompting.
- **DeepSeek API**: Advanced LLM Model prompting.
- **Google Cloud API**: Enhanced cloud services.
- **Vertex AI API**: Fully-managed, unified AI development platform.
- **QuickNode API**: Enhanced Web3 infrastructure.
- **Solana API**: Enhanced Web3 infrastructure.
- **Jupiter API**: Enhanced Web3 trading.
- **CookieDAO API**: Enhanced Web3 and socialFi analytical data.
- **Apify API**: Enhanced Web crawling capabilities.
- **Brave Search API**: Enhanced Web search and browsing capabilities.
- **PumpPortal WebSocket**: Real-time token updates.  
- **DEXTools API**: Token scanning and sentiment analysis.
- **CoinGecko API**: Token scanning and sentiment analysis.
- **Dexscreener API**: Token scanning and sentiment analysis.
- **Shopify API**: Product shopping from online stores.
- **Bitrefill API**: Cryptocurrency purchases online.
- **Solana Pay API**: Crypto currency payments on Solana.
- **Wormhole API**: Enhanced token bridging services.
- **Alchemy API**: Enhanced Web3 capabilities.
- **ElevenLabs API**: Enhanced AI voice transcription and sythesizing.

---

## **📜 Usage Examples**

### **Start Flipping Mode**
```javascript
import { flipperMode } from './services/trading/flipper.js';
await flipperMode.start(userId, walletAddress, { profitTarget: 50, stopLoss: 10 });
```

### **Create a Timed Order**
```javascript
import { timedOrderService } from './services/timedOrders.js';
await timedOrderService.scheduleOrder({ token: '0xToken', action: 'buy', time: '2024-12-25T00:00:00Z' });
```

### **Set a Price Alert**
```javascript
import { priceAlertService } from './services/alerts/priceAlerts.js';
await priceAlertService.createAlert(userId, { tokenAddress: '0xToken', targetPrice: 100, condition: 'above' });
```

---

---

## **🤝 Contributing**

We'd love your contributions!  

1. Fork the repository.  
2. Create your feature branch: `git checkout -b feature/cool-feature`.  
3. Commit your changes: `git commit -m 'Add a cool feature'`.  
4. Push to the branch: `git push origin feature/cool-feature`.  
5. Open a Pull Request.  

---

## **💻 Code Access**
Currently, GitHub is private to maintain a competitive edge over projects like SENDAI, which are in early stages of building similar Iron Man-style AI assistants. Open-source release plans are post-product launch with an SDK version for developers who want to extend O.P.E.R.A.T.O.R-TG without running the full agent code locally.
---

## **📜 License**

**MIT License**  
Latest repo is private. Feel free to fork the public repos, improve, or remix—just give credit where it's due. ❤️
