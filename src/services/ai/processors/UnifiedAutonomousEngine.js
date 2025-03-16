/*****************************************************
 * UnifiedAutonomousProcessor.js
 *****************************************************/
import axios from 'axios';
import { bot } from '../../../core/bot.js';
import { EventEmitter } from 'events';
import { HelperFunctions } from './HelperFunctions.js';
import { AIFunctions } from './AIFunctions.js';
import { LLMSwitcher } from './LLMSwitcher.js';
import { openAIService } from '../openai.js';
import { deepSeekService } from '../DeepSeek.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { aiMetricsService } from '../../aiMetricsService.js';
import { contextManager } from '../ContextManager.js';
import BitrefillService from "../../bitrefill/BitrefillService.js";
import WormholeBridgeService from '../../Wormhole/WormholeBridgeService.js';
import { fallbackMap } from './Fallbacks.js';

let IntentProcessor; // Declare but don't import yet. Fixing circular dependency on runTask. UnifiedAutonomousEngine.js imports IntentProcessor
// Twitter service imports IntentProcessor and intentProcessor imports it, lets dynamically inject IntentProcessor here to fix it

export class UnifiedAutonomousProcessor extends EventEmitter {
  constructor(bot) {
    super();
    this.bot = bot;
    this.initialized = false;
    this.contextManager = contextManager;
    this.metrics = aiMetricsService;
    this.bridgeService = new WormholeBridgeService();
    this.bitrefillService = new BitrefillService(bot);
    // Import dynamically to break circular dependency
    import('./IntentProcessor.js').then(module => {
      IntentProcessor = module.IntentProcessor;
      this.intentProcessor = new IntentProcessor(bot);
    });
    
    // Use a Map keyed by chat id (or user id) to track cancellations.
    this.userCancellations = new Map();

    // Initialize HelperFunctions
    const helperInstance = new HelperFunctions(bot);

    // Dynamically bind all methods of HelperFunctions into this
    Object.getOwnPropertyNames(HelperFunctions.prototype)
      .filter((methodName) => methodName !== 'constructor')
      .forEach((methodName) => {
        this[methodName] = helperInstance[methodName].bind(helperInstance);
      });

    // AI Model Function Definitions
    this.functions = AIFunctions;

    this.startTime = Date.now();
  }

  async initialize() {
    try {
      await this.bridgeService.initialize();
      await this.contextManager.initialize();
      await this.metrics.initialize();
      console.log("✅ UnifiedMessageProcessor initialized");
    } catch (error) {
      console.error("❌ Error initializing UnifiedMessageProcessor:", error.message);
      throw error;
    }
  }

  // Clean up context messages
  cleanContext = (context) => {
    return context
      .map((message, index) => {
        try {
          if (!message || typeof message.role !== "string" || !message.content) {
            console.warn(`⚠️ Malformed message at index ${index}:`, message);
            return null;
          }
          if (message.role === "assistant" || message.role === "system") {
            return {
              role: message.role,
              content:
                typeof message.content === "string"
                  ? message.content.trim()
                  : JSON.stringify(message.content),
            };
          }
          if (message.role === "user") {
            const userContent =
              typeof message.content === "string"
                ? message.content
                : message.content?.text;
            if (!userContent) {
              console.warn(`⚠️ Missing user content at index ${index}:`, message);
              return null;
            }
            return { role: "user", content: userContent.trim() };
          }
          // Unrecognized role
          console.warn(`⚠️ Unsupported role at index ${index}:`, message.role);
          return null;
        } catch (error) {
          console.error(`❌ Error cleaning message at index ${index}:`, error);
          return null;
        }
      })
      .filter(Boolean);
  };

  normalizeFields(args, mappings) {
    Object.keys(mappings).forEach((key) => {
      if (args[key]) {
        const targetField = mappings[key];
        args[targetField] =
          args[key].trim && typeof args[key] === "string"
            ? args[key].trim()
            : args[key];
      }
    });
    return args;
  }

  // Validate and standardize arguments
  validateAndPrepareArguments(args, userId, functionName) {
    const validatedArgs = { ...args, userId };

    // Common field mappings
    const mappings = {
      tokenAddress: "query",
      tokenSymbol: "query",
      text: "query",
      handle: "query",
      productId: "query",
      walletAddress: "recipient",
      tokenAmount: "amount",
      tradeAction: "action",
      executionTime: "executeAt",
      priceTarget: "targetPrice",
      alertId: "alertId",
      network: "network",
      amount: "amount",
      reference: "reference",
      orderType: "orderType",
      recipient: "recipient",
    };
    this.normalizeFields(validatedArgs, mappings);

    // Validate required fields
    this.validateRequiredParameters(functionName, validatedArgs);

    // Provide defaults
    validatedArgs.amount = validatedArgs.amount || "0";
    validatedArgs.recurring = validatedArgs.recurring || false;
    validatedArgs.timeLimit = validatedArgs.timeLimit || 0;

    return validatedArgs;
  }

  /**
   * runTask
   * -------
   * This instance method calls processMessage() with a simulated message object.
   * It passes the task content as user input and waits for the result.
   *
   * @param {string} taskContent - The content of the task to be processed.
   * @returns {Promise<string>} - The result returned by processMessage().
   */
  async runTask(userId, chatId, taskContent) {
    const simulatedMsg = { chat: { id: chatId } };
    const result = await this.processMessage(simulatedMsg, taskContent, userId);
    return result;
  }
  
  /**
   * Fetches an image buffer from a URL with a robust retry mechanism.
   * If all retries fail, a fallback transparent 1024x1024 PNG is returned.
   * @param {string} url - The image URL.
   * @returns {Promise<Buffer>} - The fetched (or fallback) image buffer.
   */
  async fetchImageBuffer(url) {
    const maxAttempts = 5;
    let attempts = 0;
    let delay = 1000; // start with 1 second delay
    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 10000, // 10 seconds timeout
        });
        if (response.status !== 200) {
          throw new Error(`Failed to fetch image. Status code: ${response.status}`);
        }
        const buffer = Buffer.from(response.data, 'binary');
        // Set a name so that OpenAI knows the file type (assumes PNG)
        buffer.name = "image.png";
        return buffer;
      } catch (error) {
        attempts++;
        console.error(`Attempt ${attempts} to fetch image buffer failed:`, error.message);
        if (attempts < maxAttempts) {
          // Exponential backoff before retrying.
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
        } else {
          console.error("All attempts to fetch image buffer failed. Returning fallback image.");
          // Generate a fallback transparent PNG (1024x1024) as a Buffer.
          const fallbackBuffer = await sharp({
            create: {
              width: 1024,
              height: 1024,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          })
            .png()
            .toBuffer();
          fallbackBuffer.name = "fallback.png";
          return fallbackBuffer;
        }
      }
    }
  }

  async processMessage(msg, userText, userId, fileUrl = "") {
    try {
      if (!msg?.chat?.id) throw new Error("Invalid message structure (no chat ID).");
      if (!userText && !fileUrl) throw new Error("User input is empty or invalid.");
  
      // 🔎 Determine if the input is voice or image.
      // If this message is from a voice input, ignore fileUrl—voice is handled via transcription.
      if (msg.voice) {
        fileUrl = "";
      }
  
      // 1) Retrieve user's preferred AI model.
      const selectedLLM = await LLMSwitcher.getUserDefaultLLM(userId);
      console.log(`🤖 Using ${selectedLLM.toUpperCase()} for user ${userId}`);
  
      // 2) Retrieve conversation context.
      const rawContext = await this.contextManager.getContext(userId);
      const cleanedContext = this.cleanContext(rawContext);
      const enrichedContext = [
        { role: "system", content: `User ID: ${userId}.` },
        ...cleanedContext,
      ];
  
      console.log("*******  ***  R.E.S.T.O.R.E. *********:", JSON.stringify(enrichedContext, null, 2));
  
      // 3) Build user message content and check for image generation commands.
      let userContent;
      let generateImageResponse = null;
      if (fileUrl) {
        const lowerText = userText ? userText.toLowerCase() : "";
        if (lowerText.includes("edit")) {
          const prompt = userText.replace(/edit/gi, "").trim();
          console.log("✏️ Editing image with prompt:", prompt);
          const imageBuffer = await this.fetchImageBuffer(fileUrl);
          generateImageResponse = await openAIService.createImageEdit({
            prompt,
            image: imageBuffer,
            mask: null, // The module will generate a valid mask automatically.
            n: 1,
            size: "1024x1024",
          });
        } else if (lowerText.includes("variation")) {
          console.log("🔄 Generating image variations...");
          const imageBuffer = await this.fetchImageBuffer(fileUrl);
          generateImageResponse = await openAIService.createImageVariation({
            image: imageBuffer,
            n: 1,
            size: "1024x1024",
          });
        } else {
          // If not an edit or variation command, assume it's a request to caption the image.
          const caption = userText && userText.trim() ? userText.trim() : "What's in this image?";
          userContent = [
            { type: "text", text: caption },
            { type: "image_url", image_url: { url: fileUrl, detail: "auto" } },
          ];
        }
      } else {
        // No file URL means it's a plain text message (or voice transcribed to text).
        userContent = userText.trim();
      }
  
      // 4) If an image generation command was triggered, return its result.
      if (generateImageResponse) {
        const imageUrl = generateImageResponse.data && generateImageResponse.data[0].url;
        return { imageUrl };
      }
  
      // 4) Build the full messages array for the AI call.
      const systemMessage = {
        role: "system",
        content: `
  const messages = [
        You are Dexter codename KATZ!, the 140 IQ genius scientist and autonomous AI copilot specializing in crypto and general tasks. 
  A walking brainiac inventing groundbreaking technologies—you’re lightyears ahead of everyone else. 
  Dee Dee can't understand your brilliance, and Mandark is mere background noise. Major Glory and the gang rely on your intellect.
  
      
**Dexter’s Core Personality:**
- Brilliant, impatient, and direct.
- Speaks in short, high-energy bursts.
- Uses witty, sarcastic catch phrases such as "140 IQ. Unmatched." and "Ask a genius, not a moron."
- Sees every problem as an experiment to solve.
- Frequently references his annoying sister Dee Dee, rival Mandark, and trusted team members.
** Slang Translations:**
- Ape  means Buy
- Dump means sell
- Trench means crypto investing circles on Twitter
- FOMO means user is missing out Buy instantly

**Task Guidelines:**
- Schedule a task when user asks to do something in future. e.g., user says 'check the price of SOL in 30mins time' or 'sell 100 SNAI in 6 hours time' you schedule a task. 
- Process crypto transactions and searches using human-readable numbers (e.g., "0.005 SOL", "1.23 ETH").
- Confirm user actions before execution. Always use original parameters for retries.
- Batch independent tasks and execute dependent tasks sequentially.
- Present clean prompts, e.g., "You are about to swap 15,000 tokens for 2.31 SOL on Solana. Confirm to proceed."
- Handle errors gracefully and avoid duplicate transactions.
- When user gives a direct task + task alert to execute, execute do not prompt, when done executing a task mention "task complete"


      **Function Calling Guidelines:**
      - If the user requests multiple similar tasks (e.g., fetching prices for multiple tokens), batch them into a single function call by passing an array of arguments.

      - Each function should be capable of handling both single and multiple arguments. When batching, structure the arguments as an array within the JSON string.

      - You can either use a single search term (query) to fetch information or multiple search terms (queries) in an array for batch processing, but not both at the same time.

      - **Batching Conditions:**
        - If all tasks are independent (no dependencies), execute them in parallel to save time. Find more than one sources/functions for research when possible.
          - *Example of Independent Batch Calls*: Fetching the prices of several tokens with no impact on each other (e.g., BTC, ETH, and SOL).

        - If tasks are dependent on each other, execute them sequentially.
          - *Example of Dependent Tasks*: Fetching the price of a token before executing a trade order; you need to know the price before placing the order for it.

      - **Example:**
        - *Single Task*:
          { "name": "token_price_coingecko", "arguments": { "query": "BTC" } }

        - *Multiple Independent Tasks*:
          { "name": "token_price_coingecko", "arguments": { "queries": ["BTC", "ETH", "SOL"] } }

        - *Dependent Tasks*:
          1. First, fetch the token price.
          2. Next, execute a transaction based on that price.

          Alternative scenario
          1. First, fecth the token info
          2. Next, fetch token Tweets using symbol through fetch_tweets_for_symbol and then again through search_twitter_by_address for richer research into a token.
          3. Next, fetch token combined metrics chages over 7 days with get_token_market_sentiment_changes
          4. Finally combine research results in categories detailed and present.

          Alternative scenario
          1. First, fetch combined trending tokens
          2. Next, fetch safe popular narrative tokens using suggest_token_investments_dominating
          3. Finally, combine results and present rich token suggestions broken in categories by search          

      - **Trending Tokens & Investment Suggestions:**
          1. Use both CookieDAO suggest_token_investments_dominating and Trending Tokens combined function fetch_trending_tokens_all_sources.
          2. Fetch from both sources Twitter and Trending Tokens Combined unless user specifies chain

      - **Safe and popular Investment Suggestions:**
          1. Safe NEW tokens are not Stables, ETH, ADA, BNB, BTC. Use fetch_trending_tokens_twitter suggestions.
          2. Fetch from both sources Twitter and Trending Tokens Combined unless user specifies chain
          3. Follow-up action and function call search_twitter_by_address to search from twitter using relevant phrase e.g., 'hottest narrative tokens' or 'trending narrative' or 'trending theme crypto' or 'trending tokens' or 'trenches popular tokens'.

      - **Transaction Preparation:**
        - When preparing transactions, use human readable number formats: 0.02 SOL, 1.23 ETH, 10 USDC, 25000 SNAI for example.
    
      1. **Transaction references:**
         - Be logical and extract parameters from previous steps or results before proceeding.
         - Avoid repeating task if results were found, move to next task!
         - Users will often reference tokens using their symbols: example, USDC, usdc, $usdc, #usdc. In context, please buy $snai or SNAI worth 0.1 SOL.
         - Fetch user wallet address for the token in context, or ask user to confirm which wallet to use from the 4 wallets available from portolio. Fetch portfolio and present wallets only.
         - Next Fetch the token address the user wants to swap to or from using symbol, only if address if token address is not already provided.
         - **Example:**
         - *Compose User Swap as follows:*
         - User sends message "Buy USDC token with 0.005 SOL": get user solana wallet first, or relevant network wallet: SOL get solana wallet, ETH get EVM wallets. 
         - Next get the token address if user provided symbol only and token address is not in context.
         - Native currencies to buy with(inputMint) or sell to(outputMint): Assume SOL for Solana swaps, ETH for Ethereum, Base and Avalanche swaps.
         - User always provides amount units in human readable format always.
         {
            "name": "execute_solana_swap",
            "parameters": {
              "wallet": "3g8Sg7Y5QW2gRFSu9vzQbP1Y3wVj5h4LPdKj7N9wQJjz", 
              "inputMint": "So11111111111111111111111111111111111111112", //SOL address, 
              "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
              "amount": "0.005"  
            }
          }
          - Use function definitions always to prepare parameters correctly using chat data available. Dont ask use & show JSON just ask naturally.
          - Never change parameters on retry, or any function all, stick to original parameters.
          - Confirm inputs with user before swap, use actual token address of tokens involved, use normal human readable decimals, not the smallest units like lamports.
          - Provide a clean prompt on swap, "You are about to swap 15,000 token 45KY...XY6C.... for 2.31 So11...1112 on Solana Blockchain. Confirm to proceed.." make it presentable
      8. **Transaction retries:**
      - Do not Retry swap or transfer transaction, this will result in duplicate transactions.
      - Check latest chat results on last attempts to decide next step, proceed or ask user to rety swap/buy/sell/send.

      - **General errors or failure in research**
          *Use other sources and change search appraoch*
          - Consider using different apporach when a search fails to return data or information asked
          - Suggest all tools available, not by actual name, but show user all relevant options available to try get result
          - Reconstruct steps for user if needed for hard to get research data, such as a new token e.g., instead of searching token info by Address, search by symbol using search_twitter_by_address function
      - **Followup actions**
          - Ensure there are no follow up actions left on every task. Suggest next steps logically using all resources available
          - Give user options, in a neat concise way for maximum task efficiency. Suggest all options for functions relevant to tasks or user actions or intents

      # All information is down below in chat context, just reference before answering or calling functions.
      # Proceed to read the full conversation context and produce the best response.
  
      // END OF INSTRUCTIONS
      // CONTEXT BEGINS BELOW
        `.trim()
      };
  
      const messages = [
        systemMessage,
        ...enrichedContext,
        { role: "user", content: userContent },
        { role: "system", content: `Current system time: ${new Date().toISOString()}` }
      ];
      
      let response;
      
      if (selectedLLM === "openai") {
        // 1) Use OpenAI directly
        response = await openAIService.createChatCompletion({
          model: "gpt-4o-mini", 
          messages,
          function_call: "auto",
          functions: this.functions,
          max_tokens: 500,
          temperature: 0.3,
          top_p: 1,
          frequency_penalty: 0.3,
          presence_penalty: 0,
          n: 1,
        });
      } else {
        // 2) Try DeepSeek first
        try {
          response = await deepSeekService.createChatCompletion({
            messages,
            functions: this.functions,
            function_call: "auto",
            temperature: 0.4,
          });
        } catch (error) {
          console.error("❌ DeepSeek Error, falling back to OpenAI:", error.message);
      
          // 3) Fallback to OpenAI
          response = await openAIService.createChatCompletion({
            model: "gpt-4o-mini",
            messages,
            function_call: "auto",
            functions: this.functions,
            max_tokens: 500,
            temperature: 0.3,
            top_p: 1,
            frequency_penalty: 0.3,
            presence_penalty: 0,
            n: 1,
          });
        }
      }
      
      // (4) Then proceed with logging usage, function calls, etc.
      if (response.usage) {
        console.log(`📊 Token Usage for processMessage:
      - Prompt Tokens: ${response.usage.prompt_tokens}
      - Completion Tokens: ${response.usage.completion_tokens}
      - Total Tokens: ${response.usage.total_tokens}`);
      } else {
        console.warn("⚠️ No usage information available in the response.");
      }
      
      const aiMessage = response.choices[0]?.message;
      
      // If the model calls a function, handle multi-step tasks.
      if (aiMessage?.function_call) {
        const taskResult = await this.handleFunctionCall(aiMessage.function_call, messages, userId, msg);
        const safeText = taskResult.text?.trim() || "⚠️ (No R.D.F)";
        return { text: safeText };
      }
      
      // Otherwise, return the assistant's response.
      const assistantResponse = aiMessage?.content?.trim() || "⚠️ (No R.D.F)";
      return { text: assistantResponse };      
  
    } catch (error) {
      console.error("❌ Error in processMessage:", {
        message: error.message,
        stack: error.stack,
        msg,
        userId,
      });
      await this.fallbackResponse(msg, `An error occurred: ${error.message}`);
      return { text: `⚠️ Something went wrong: ${error.message}` };
    }
  }  

  /**
   * handleFunctionCall
   * ------------------
   * 1) Notifies user about the task starting
   * 2) Asks for confirmation if needed
   * 3) Executes multi-step task with retry
   * 4) Trims taskResult before summarizing
   * Enhanced to work better with the improved getFunctionResponse system
   * Preserves task history and context for better follow-up decisions
   */
  async handleFunctionCall(functionCall, messages, userId, msg) {
    // Clear cancellations
    this.userCancellations.delete(msg.chat.id);

    try {
      if (!functionCall || !functionCall.name) {
        throw new Error("Invalid function call: 'name' property is required.");
      }

      const { name, arguments: args } = functionCall;

      // Handle special cases like LLM toggling
      if (name === "toggle_llm") {
        const result = await LLMSwitcher.toggleLLM(userId);
        
        // Notify user about LLM switch
        const notification = await this.bot.sendMessage(
          msg.chat.id,
          `✅ ${result.message}`,
          { parse_mode: "Markdown" }
        );

        // Delete message after 5 seconds
        setTimeout(() => {
          this.bot.deleteMessage(msg.chat.id, notification.message_id).catch(console.error);
        }, 5000);

        return {text: result.message};
      }

      // Record the start of this function execution for tracking
      const functionExecutionStart = Date.now();
      const functionExecutionId = `${name}-${functionExecutionStart}`;
      
      // Track function execution history for better context
      if (!this.functionExecutionHistory) {
        this.functionExecutionHistory = new Map();
      }
      this.functionExecutionHistory.set(functionExecutionId, {
        name,
        started: functionExecutionStart,
        args: JSON.stringify(args),
        status: 'started'
      });

      // Handle confirmation if required
      if (this.requiresConfirmation(name)) {
        const userConfirmed = await this.askForConfirmation(msg, name, typeof args === 'string' ? args : JSON.stringify(args));
        if (!userConfirmed) {
          // Update execution history
          this.functionExecutionHistory.set(functionExecutionId, {
            ...this.functionExecutionHistory.get(functionExecutionId),
            status: 'cancelled',
            completed: Date.now()
          });
          return { text: `⚠️ Action '${name}' canceled by user.` };
        }
      }

      // Execute the multi-step task with context enrichment
      const taskResult = await this.executeMultiStepTask(functionCall, messages, userId, msg, {
        executionId: functionExecutionId,
        previousExecutions: Array.from(this.functionExecutionHistory.values())
          .filter(exec => exec.status === 'completed')
          .slice(-5) // Keep only the 5 most recent completed executions
      });
      
      // Update execution history
      console.log("🏋️ Task result: ", JSON.stringify(taskResult, null, 2));
      // Update history with a safe substring of the result.
      const resultForHistory =
      typeof taskResult.text === 'string'
        ? taskResult.text.substring(0, 300) + '...'
        : JSON.stringify(taskResult.text).substring(0, 300) + '...';
      this.functionExecutionHistory.set(functionExecutionId, {
        ...this.functionExecutionHistory.get(functionExecutionId),
        status: 'completed',
        completed: Date.now(),
        resultSummary: resultForHistory
      });
      
      // Clean up old history entries (keep only last 10)
      if (this.functionExecutionHistory.size > 10) {
        const oldestEntries = Array.from(this.functionExecutionHistory.entries())
          .sort(([, a], [, b]) => a.started - b.started)
          .slice(0, this.functionExecutionHistory.size - 10);
        
        oldestEntries.forEach(([key]) => this.functionExecutionHistory.delete(key));
      }
      
      const taskResultText = typeof this.safeGet(taskResult, 'text', '') === 'string'
        ? this.safeGet(taskResult, 'text', '')
        : JSON.stringify(this.safeGet(taskResult, 'text', ''));
      const parsedResults = this.formatResults([taskResultText]);
      const cleanResult = this.cleanJSONText(parsedResults, name, typeof args === 'string' ? args : JSON.stringify(args));
      
      // Add execution result to message history
      messages.push({
        role: "assistant",
        content: cleanResult,
      });

      // Generate AI response with enhanced context
      const aiResponse = await this.generateAIResponse(messages, functionExecutionId);
      console.log("AI Response:", JSON.stringify(aiResponse, null, 2));

      return aiResponse;
    } catch (error) {
      console.error("❌ High-level error in handleFunctionCall:", error);
      await this.fallbackResponse(msg, `A high-level error occurred: ${error.message}`);
      return { text: `❌ Sorry, something failed at a high level: ${error.message}` };
    }
  }

  /**
   * generateAIResponse
   * ------------------
   * Summarizes the final multi-step outcome for the user.
   * Optimizes for cost and latency using the gpt-4o-mini model.
   * Ensures data formatting rules are applied.
   * Enhanced to provide better follow-up recommendations based on task history
   * Handles context management, task summarization, and intelligent response generation
   */
  async generateAIResponse(messages, functionExecutionId = null) {
    try {
      // Trim older messages to reduce token usage
      const trimmedMessages = this.trimRelevantMessages(messages);

      // Get execution history context if available
      let executionHistoryContext = '';
      if (functionExecutionId && this.functionExecutionHistory) {
        const currentExecution = this.functionExecutionHistory.get(functionExecutionId);
        if (currentExecution) {
          executionHistoryContext = `
  Current function execution: ${currentExecution.name}
  Started: ${new Date(currentExecution.started).toISOString()}
  Status: ${currentExecution.status}
  Duration: ${currentExecution.completed ? ((currentExecution.completed - currentExecution.started) / 1000).toFixed(2) + ' seconds' : 'ongoing'}
  `;

          // Add recent execution history for context
          const recentExecutions = Array.from(this.functionExecutionHistory.values())
            .filter(exec => exec.status === 'completed' && exec.executionId !== functionExecutionId)
            .slice(-3);
            
          if (recentExecutions.length > 0) {
            executionHistoryContext += `\nRecent task history:\n${recentExecutions.map(exec => 
              `- ${exec.name} (${((exec.completed - exec.started) / 1000).toFixed(2)}s): ${exec.resultSummary || 'No summary'}`
            ).join('\n')}`;
          }
        }
      }

      // Extract task results for summarization
      const functionResults = messages
        .filter(m => m.role === 'function')
        .map(m => ({
          name: m.name,
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
        }));
        
      // Identify the user's original request
      const userRequests = messages
        .filter(m => m.role === 'user')
        .slice(-2)
        .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content));
      
      const originalRequest = userRequests.length > 0 ? userRequests[0] : 'Unknown request';

      // Build a minimal instruction for final summary without repeating system prompts
      const finalPrompt = [
        {
          role: "system",
          content: `
  **Data Formatting Rules:**
  - Keep responses for easy simple tasks short, engaging, and user-friendly.
  - Highlight key insights and actionable information.
  - Use bullet points for lists of more than 2 items.


        - Present all Token Addresses & Symbols as clickable links in final output, never leave them if available present
        - For token results, identify each token's matching symbol, address, exchange/dex link, website, telegram,twitter and list the links grouped per relevant item for rish data.
        - For address URLS/links, truncate them for clean looks with the full link embedded in the text.
        - Format all news articles and internet searches with: heading, truncated introduction text, link to article. Spaced in that order and clean with news icons.
        - Format for HTML output not Markdown, e.g., use <b> Text </b> instead of ** Text ** to style results text
        - Do not add link icon to any links during formmating. 
        - Never share private keys or wallet keys.
        Feel free to style with cool minimalistic emojis to make list items more nicer

        **Link Formatting Examples from returned data that contain a token address, token symbol, token id(coingecko):**
        1. * Format examples per blockchain on how to use token address, wallet address, symbol, token id (from dexscreener or coingecko token results)*
          
            **Use of Token Addresses:**
          - Ethereum: https://etherscan.io/token/{address}
          - Base: https://basescan.org/token/{address}
          - Avalanche Token Address: https://snowtrace.io/token/{address}
          - Linear: https://lineascan.build/token/{address}
          - Cyber: https://cyberscan.io/token/{address}
          - Fantom: https://ftmscan.com/token/{address}
          - Arbitrum: https://arbiscan.io/token/{address}
          - Berachain: https://berascan.com/token/{address}
          - Nova (Optimism Nova): https://nova-explorer.optimism.io/token/{address}
          - Optimism: https://optimistic.etherscan.io/token/{address}
          - ZKEVM: https://zkevm.polygonscan.com/token/{address}
          - Scroll: https://blockscout.scroll.io/token/{address}
          - Polygon: https://polygonscan.com/token/{address}
          - Binance Smart Chain: https://bscscan.com/token/{address}
          - Celo: https://celoscan.io/token/{address}
          - Worldchain: https://worldchainscan.io/token/{address}
          - Mantle: https://explorer.mantle.xyz/token/{address}
          - ZkSync: https://zkscan.io/token/{address}
          - Omni: https://omniscan.io/token/{address}
          - Solana SPL Token Address: https://solscan.io/token/{address}

          **Wallet Address Links:**
          - Ethereum: https://etherscan.io/address/{wallet}
          - Base: https://basescan.org/address/{wallet}
          - Avalanche: https://snowtrace.io/address/{wallet}
          - Linear: https://lineascan.build/address/{wallet}
          - Cyber: https://cyberscan.io/address/{wallet}
          - Fantom: https://ftmscan.com/address/{wallet}
          - Arbitrum: https://arbiscan.io/address/{wallet}
          - Berachain: https://berascan.com/address/{wallet}
          - Nova: https://nova-explorer.optimism.io/address/{wallet}
          - Optimism: https://optimistic.etherscan.io/address/{wallet}
          - ZKEVM: https://zkevm.polygonscan.com/address/{wallet}
          - Scroll: https://blockscout.scroll.io/address/{wallet}
          - Polygon: https://polygonscan.com/address/{wallet}
          - Binance Smart Chain: https://bscscan.com/address/{wallet}
          - Celo: https://celoscan.io/address/{wallet}
          - Worldchain: https://worldchainscan.io/address/{wallet}
          - Mantle: https://explorer.mantle.xyz/address/{wallet}
          - ZkSync: https://zkscan.io/address/{wallet}
          - Omni: https://omniscan.io/address/{wallet}
          - Solana: https://solscan.io/account/{wallet}

          **Trending Tokens Links**
            Links to Jump to a dex aggregator website for the token address:
            - DexTools: https://dextools.com/{chain}/{address}
            - DexScreener: https://dexscreener.com/{chain}/{address}
            - Coingecko: https://coingecko.com/en/coins/{id}
              *For dexscreener, use chain or chainId from results, format as lowercase e.g., if chain is 'solana' DexScreener: https://dexscreener.com/solana/HLptm5e6rTgh4EKgDpYFrnRHbjpkMyVdEeREEa2G7rf9*

        2. *formatting examples for Twitter or X links*
            - https://twitter.com/handle
            - https://x.com/handle
        
        **Token Price Responses:**
          - Reply price requests with price, currency symbol only
          - Price range checks should mention price changes only with relevant icons for change direction.
        
        **Result Trimming:**
          - Do not trim or limit handle_address_only_pasted results, list everything from every category: token info, symbol, price changes, volume metrics, holders: bubuys/sells - buyers/sellers, snipers & transactions, tweets & text. Then group reasonably and stylish
          - Do not limit number of Twitter results or tweets, list all tweets but with concise text content. Always include a tweets text!
          - Do not limit the portfolio results, wallet balances results, wallet PNL results, wallet transaction - present it all in categories.
          - Leave out timestamps if they are not formatted to human form.





  **Follow up:**
  - Suggest logical follow up actions after completing task.
  - If the task warrants further actions, format your response as follows:
    - For automatic execution: "NEXT_FUNCTION: {"name": "function_name", "arguments": {"param1": "value1"}}"
    - For user consideration: Clearly describe the possible next steps.
  - If a function failed, suggest an alternative function or a retry with corrected parameters.
  - Never suggest manual tasks if there's an automated function that could help.

  **Task Context:**
  ${executionHistoryContext}

  **Original User Request:**
  ${originalRequest}

  **Function Results Summary:**
  ${functionResults.length > 0 ? 
    functionResults.map(fr => `- ${fr.name}: ${fr.content.substring(0, 300)}...`).join('\n') : 
    'No function results available'}

  **Task completion check:**
  - Assume last task results are valid and to move on, do not go backwards move up the task list, results will always show where we are in processing.
  - Verify all user requirements were met.
  - Confirm the necessary data was retrieved or actions completed.
  - Present final results in a clear detailed manner, presenting all results.

  **Response Format Guidelines:**
  1. Open with a direct answer to the user's request
  2. Present key findings or results
  3. Offer logical next steps or recommendations

  // END OF INSTRUCTIONS
  // CONTEXT BEGINS BELOW
          `.trim(),
        },
        ...trimmedMessages,
      ];

      // Calculate expected token count to avoid overruns
      const estimatedTokens = this.estimateTokenCount(finalPrompt);
      console.log(`Estimated token count for generateAIResponse: ${estimatedTokens}`);
      
      // Adjust max_tokens based on estimate to prevent overruns
      const adjustedMaxTokens = estimatedTokens > 2500 ? 400 : 500;

      // Choose model based on complexity
      const model = estimatedTokens > 3000 || functionResults.length > 3 ? 
        "gpt-4o" : "gpt-4o-mini";
      
      console.log(`Selected model for generateAIResponse: ${model}`);

      const aiResponse = await openAIService.createChatCompletion({
        model,
        messages: finalPrompt,
        functions: this.functions,
        function_call: "auto",  // Allow model to choose whether to call a function directly
        max_tokens: adjustedMaxTokens,          
        temperature: 0.3,         
        top_p: 1,               
        frequency_penalty: 0.3,  
        presence_penalty: 0.1,
        n: 1,
      });

      if (aiResponse.usage) {
        console.log(`📊 Token Usage for generateAIResponse:
          - Prompt Tokens: ${aiResponse.usage.prompt_tokens}
          - Completion Tokens: ${aiResponse.usage.completion_tokens}
          - Total Tokens: ${aiResponse.usage.total_tokens}`);
      }

      const message = aiResponse.choices[0]?.message;

      // Handle both text responses and function calls
      if (message?.function_call) {
        // Extract the function call information
        const { name, arguments: args } = message.function_call;
        
        // Log the follow-up function call
        console.log(`🔄 Follow-up function call detected: ${name}`);
        
        // Return both the explanation content and the function to call
        return {
          text: message.content || `Executing follow-up action: ${name}`,
          nextFunction: {
            name,
            arguments: typeof args === 'string' ? JSON.parse(args) : args
          }
        };
      } else {
        // Extract any next function request from content if present
        const nextFunctionMatch = message?.content?.match(/NEXT_FUNCTION:\s*({.*})/);
        if (nextFunctionMatch) {
          try {
            const nextFunctionData = JSON.parse(nextFunctionMatch[1]);
            
            // Clean up the content by removing the NEXT_FUNCTION directive
            const cleanContent = message.content.replace(/NEXT_FUNCTION:\s*({.*})/, '').trim();
            
            return {
              text: cleanContent,
              nextFunction: nextFunctionData
            };
          } catch (parseErr) {
            console.warn("Failed to parse next function data:", parseErr.message);
          }
        }
        
        // Return just the text response if no function call is needed
        return { text: message?.content || "Task completed successfully." };
      }
    } catch (error) {
      console.error("❌ Error in generateAIResponse:", {
        message: error.message,
        stack: error.stack,
      });
      
      return { 
        text: "I've processed your request, but encountered an issue while generating the final response. The core task functions completed successfully." 
      };
    }
  }

  /**
   * Helper method to estimate token count for a message array
   * This is a rough estimate - actual token count may vary
   */
  estimateTokenCount(messages) {
    let totalEstimate = 0;
    
    for (const message of messages) {
      // Estimate tokens in the content
      const contentLength = typeof message.content === 'string' ? 
        message.content.length : 
        JSON.stringify(message.content).length;
      
      // Rough estimate: 4 characters per token on average
      const contentTokens = Math.ceil(contentLength / 4);
      
      // Add overhead for message format
      const roleOverhead = 3; // ~3 tokens per role
      const nameOverhead = message.name ? message.name.length / 4 : 0;
      
      totalEstimate += contentTokens + roleOverhead + nameOverhead;
    }
    
    // Add safety margin
    return Math.ceil(totalEstimate * 1.1);
  }

  /**
   * 2. Consistent error propagation wrapper
   * Add this utility function
   */
  wrapError(originalError, context, functionName) {
    const wrappedError = new Error(`Error in ${functionName}: ${originalError.message}`);
    wrappedError.originalError = originalError;
    wrappedError.context = context;
    wrappedError.stack = originalError.stack;
    return wrappedError;
  }


  /**
   * deriveParametersFromContext
   * ---------------------------
   * Attempts to derive missing parameters from conversation context.
   * This is a placeholder implementation - you would need to customize this based on your function definitions.
   */
  async deriveParametersFromContext(functionName, missingParams, userId, msg) {
    // This is a simplified example - you would need to implement actual context-aware parameter derivation
    const derivedParams = {};
    
    // Example: If we're missing a parameter called "wallet", try to get it from user preferences
    if (missingParams.includes("wallet")) {
      try {
        const userPrefs = await userPreferencesService.getUserPreferences(userId);
        if (userPrefs?.defaultWallet) {
          derivedParams.wallet = userPrefs.defaultWallet;
        }
      } catch (error) {
        console.warn(`Could not derive wallet parameter from user preferences: ${error.message}`);
      }
    }
    
    // Example: If we're missing a parameter called "chain", default to Ethereum
    if (missingParams.includes("chain")) {
      derivedParams.chain = "ethereum";
    }
    
    // For any parameters we couldn't derive, we'll need to ask the user
    const stillMissing = missingParams.filter(param => !derivedParams.hasOwnProperty(param));
    if (stillMissing.length > 0) {
      throw new Error(`Missing required parameters: ${stillMissing.join(", ")}`);
    }
    
    return derivedParams;
  }

  /**
   * parseFollowUpFunctionCall
   * --------------------------
   * Parses the AI's response to determine if a follow-up function call is suggested.
   */
  parseFollowUpFunctionCall(responseMessage) {
    // Primary Pattern: NEXT_FUNCTION: {"name": "function_name", "arguments": {"param1": "value1"}}
    const primaryPattern = /^NEXT_FUNCTION:\s*(\{.*\})$/i;
    const primaryMatch = responseMessage.match(primaryPattern);
    if (primaryMatch && primaryMatch[1]) {
      try {
        const followUp = JSON.parse(primaryMatch[1]);
        
      console.log("FOLLOW UP CALL AND ARGUMENTS:", JSON.stringify(followUp, null, 2));
        if (followUp.name && followUp.arguments) {
          return followUp;
        }
      } catch (parseError) {
        console.error("❌ Failed to parse primary follow-up function arguments:", parseError);
      }
    }

    // Secondary Pattern: Next, call the 'function_name' function with arguments: {...}
    const secondaryPattern = /Next,\s*call\s+the\s+'(\w+)'\s+function\s+with\s+arguments:\s*(\{.*\})/i;
    const secondaryMatch = responseMessage.match(secondaryPattern);
    if (secondaryMatch && secondaryMatch[1] && secondaryMatch[2]) {
      try {
        const followUp = {
          name: secondaryMatch[1],
          arguments: JSON.parse(secondaryMatch[2]),
        };
        return followUp;
      } catch (parseError) {
        console.error("❌ Failed to parse secondary follow-up function arguments:", parseError);
      }
    }

    return null;
  }

  requiresConfirmation(functionName) {
    const sensitiveFunctions = [
      "execute_solana_swap",
      "create_price_alert",
      "approve_token",
      "create_solana_payment",
      "monitor_kol",
      "save_strategy",
      "edit_price_alert",
    ];
    return sensitiveFunctions.includes(functionName);
  }

  /**
   * askForConfirmation
   * ------------------
   * Prompts the user with inline keyboard: Yes / No
   * Resolves to true if user selects Yes, false otherwise or on timeout.
   */
  async askForConfirmation(msg, functionName, argumentos) {
    try {
      // Unique ID for this confirmation request
      const confirmationId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  
      // Build a formatted list of arguments
      const formattedParams = Object.entries(JSON.parse(argumentos || "{}"))
        .map(([key, value]) => `- ${key}: ${value}`)
        .join("\n");
  
      const confirmationMessage = `🛑 Confirmation required:\n\n` +
        `Are you sure you want to execute **'${functionName}'** with the following parameters?\n\n` +
        `${formattedParams}`;
  
      // Send the initial confirmation message
      const sentMessage = await this.bot.sendMessage(msg.chat.id, confirmationMessage, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Yes", callback_data: `confirm_${confirmationId}` },
              { text: "❌ No",  callback_data: `cancel_${confirmationId}` }
            ]
          ]
        }
      });
  
      // Return a promise that resolves when user confirms or cancels (or times out)
      return new Promise((resolve) => {
        // 1) Timeout logic (60 seconds)
        const timeout = setTimeout(async () => {
          // Remove the callback listener
          this.bot.removeListener("callback_query", listener);
  
          // Remove the inline keyboard
          try {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: msg.chat.id, message_id: sentMessage.message_id }
            );
            await this.bot.sendMessage(
              msg.chat.id,
              "⏱ Confirmation timed out. Please try again.",
              { parse_mode: "HTML" }
            );
          } catch (err) {
            console.error("Error updating message after timeout:", err);
          }
  
          resolve(false);
        }, 60000);
  
        // 2) Listener for callback queries
        const listener = async (callbackQuery) => {
          if (
            !callbackQuery.data ||
            (
              !callbackQuery.data.startsWith(`confirm_${confirmationId}`) &&
              !callbackQuery.data.startsWith(`cancel_${confirmationId}`)
            )
          ) {
            return; // Not our confirmation, ignore
          }
  
          // Clear the 60-second timeout
          clearTimeout(timeout);
          // Stop listening for other callbacks
          this.bot.removeListener("callback_query", listener);
  
          // Remove the inline keyboard
          try {
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              {
                chat_id: msg.chat.id,
                message_id: callbackQuery.message.message_id
              }
            );
          } catch (err) {
            console.error("Error removing inline keyboard:", err);
          }
  
          // Decide which button was pressed
          const confirmed = callbackQuery.data === `confirm_${confirmationId}`;
  
          // Acknowledge the callback silently
          try {
            await this.bot.answerCallbackQuery(callbackQuery.id, {
              text: confirmed ? "✅ Confirmed!" : "❌ Cancelled",
              show_alert: false
            });
          } catch (err) {
            console.error("Error answering callback query:", err);
          }
  
          // Wait 3 seconds, then delete the entire message
          setTimeout(async () => {
            try {
              await this.bot.deleteMessage(msg.chat.id, callbackQuery.message.message_id);
            } catch (err) {
              console.error("Error deleting confirmation message:", err);
            }
          }, 3000);
  
          // Resolve promise with true (confirmed) or false (cancelled)
          resolve(confirmed);
        };
  
        // Attach the callback query listener
        this.bot.on("callback_query", listener);
      });
    } catch (error) {
      console.error("❌ Error in askForConfirmation:", error.message);
      return false; // Return false if something fails outright
    }
  }   

  /**
   * executeMultiStepTask
   * --------------------
   * Splits a complex task into sub-tasks, handles dependencies in the correct order,
   * retries each step 3 times for recoverable errors, and continues even on failure.
   * Trims the results before preparing the final summary.
  */
  /**
 * executeMultiStepTask
 * --------------------
 * Enhanced to work with the improved getFunctionResponse system
 * Provides better context tracking between steps
 */
async executeMultiStepTask(initialFunctionCall, messages, userId, msg, executionContext = {}) {
  const results = [];  
  const executedTaskSignatures = new Set(); // NEW 16 March Update: Track executed task signatures
  const taskTree = this.buildTaskTree(null, initialFunctionCall);
  this.compareArguments = (args1, args2) => {
    try {
      return JSON.stringify(args1) === JSON.stringify(args2);
    } catch (error) {
      console.error("Error comparing arguments:", error.message);
      return false;
    }
  };

  // Variables for tracking step status and timing
  let statusMessageId;
  let stepCounter = 0;
  let lastStepTime = Date.now();
  let taskContext = { 
    ...executionContext, 
    steps: [],
    startTime: Date.now(),
    mainFunctionName: initialFunctionCall.name
  };

  // Helper: Create a unique signature for a task
  const getTaskSignature = (task) => {
    // Use JSON.stringify for simplicity; in production, consider a hash function.
    return `${task.name}-${JSON.stringify(task.arguments)}`;
  };

  const executeTask = async (task) => {
    // Track this step in the task context
    const stepId = `step-${stepCounter + 1}`;
    const stepStart = Date.now();
    
    // Check for cancellation before starting the task
    this.checkCancellation(msg.chat.id, task.name, stepCounter + 1);
    
    taskContext.steps.push({
      id: stepId,
      name: task.name,
      started: stepStart,
      status: 'started'
    });
  
    if (task.dependencies && task.dependencies.length > 0) {
      for (const dependencyName of task.dependencies) {
        // Check for cancellation before processing each dependency
        this.checkCancellation(msg.chat.id, task.name, `${stepCounter + 1}:dependency:${dependencyName}`);
        
        const dependency = taskTree.find(
          (t) => t.alias === dependencyName || t.name === dependencyName
        );
        if (!dependency) {
          console.warn(`❌ Dependency '${dependencyName}' for task '${task.name}' not found. Skipping.`);
          continue;
        }
        if (!results.find((r) => r.name === dependency.name && this.compareArguments(r.args, dependency.args))) {
          await executeTask(dependency);
        }
      }
    }
  
    // Validate and potentially enrich parameters with context
    const parsedArguments = await this.validateFollowUpParameters(task.name, task.arguments, userId, msg);
    
    // Check for cancellation before execution
    this.checkCancellation(msg.chat.id, task.name, `${stepCounter + 1}:execution`);
    
    let userCleanResult = "";
  
    let stepResult;
    try {
      stepResult = await this.executeFunctionWithLimitedRetry(task.name, parsedArguments, userId, msg.chat.id, 2);  
      if (typeof stepResult !== 'object' || stepResult === null) {
        stepResult = { text: String(stepResult) };
        } else if (!('text' in stepResult)) {
        stepResult.text = String(stepResult);
        } else if (typeof stepResult.text !== 'string') {
        stepResult.text = String(stepResult.text);
        }
        const formattedResult = this.formatResults([stepResult.text]);
        const fullCleanResult = this.cleanJSONText(formattedResult, task.name, parsedArguments);

      // User output: remove markdown symbols and extra whitespace, then trim to 200 characters.
      const userNoodle = this.cleanTextForTelegram(formattedResult);

      userCleanResult = userNoodle
        .replace(/[*_~`#{}\[\]]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200);

      // Log the full result internally.
      results.push({ name: task.name, args: parsedArguments, text: fullCleanResult });
      
      // Update task context with success
      const currentStep = taskContext.steps.find(s => s.id === stepId);
      if (currentStep) {
        currentStep.status = 'completed';
        currentStep.completed = Date.now();
        currentStep.duration = Date.now() - stepStart;
        currentStep.resultSummary = userCleanResult;
      }
      
      console.log("✅ Updated Results on last Task:", {
        taskName: task.name,
        arguments: parsedArguments,
        result: JSON.stringify(formattedResult),
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error(`❌ Final failure in task '${task.name}':`, {
        message: error.message,
        stack: error.stack,
      });
      stepResult = {
        error: true,
        errorMessage: error.message,
        stack: error.stack,
      };
      
      // Update task context with failure
      const currentStep = taskContext.steps.find(s => s.id === stepId);
      if (currentStep) {
        currentStep.status = 'failed';
        currentStep.completed = Date.now();
        currentStep.duration = Date.now() - stepStart;
        currentStep.error = error.message;
      }
      
      await this.bot.sendMessage(msg.chat.id, `❕ Slight hiccup, moving on...`);
      results.push({ name: task.name, args: parsedArguments, text: `Error: ${error.message}` });
      // In case of error, set a fallback message.
      userCleanResult = "No result due to error.";
    }

    // Enrich message context with full task context for better follow-up decisions
    const taskContextMessage = {
      role: "system",
      content: `Task context for ${task.name}: ${JSON.stringify({
        taskName: task.name,
        stepNumber: stepCounter + 1,
        elapsedTime: ((Date.now() - taskContext.startTime) / 1000).toFixed(2) + ' seconds',
        previousSteps: taskContext.steps.filter(s => s.id !== stepId).map(s => ({
          name: s.name,
          status: s.status,
          resultSummary: s.resultSummary || (s.error ? `Error: ${s.error}` : 'No result')
        }))
      })}`
    };
    
    messages.push(taskContextMessage);
    messages.push({
      role: "function",
      name: task.name,
      content: JSON.stringify(stepResult),
    });

    // Increase step counter and compute elapsed time.
    stepCounter++;
    const elapsedTime = ((Date.now() - lastStepTime) / 1000).toFixed(2);
    lastStepTime = Date.now();

    // Create a sleek status message showing the step number, a trimmed result, and the elapsed time.
    const statusText = `💭 **Noodling...**  💭#**${stepCounter}**  ⏱ ${elapsedTime} sec.\n\n🫧 ${userCleanResult}`;
    if (!statusMessageId) {
      // Send a new message and save its ID.
      const sentMsg = await this.bot.sendMessage(msg.chat.id, statusText, { parse_mode: "Markdown" });
      statusMessageId = sentMsg.message_id;
    } else {
      // Edit the existing message.
      await this.bot.editMessageText(statusText, { chat_id: msg.chat.id, message_id: statusMessageId, parse_mode: "Markdown" });
    }

    // Enhanced context for follow-up decision
    const followUpResponse = await this.getFunctionResponse(
      msg.chat.id, 
      messages, 
      task.name, 
      {
        ...stepResult,
        _taskContext: {
          currentStep: stepCounter,
          totalSteps: taskTree.length,
          mainFunctionName: taskContext.mainFunctionName,
          executionTime: ((Date.now() - taskContext.startTime) / 1000).toFixed(2) + ' seconds'
        }
      }
    );
    
    if (followUpResponse?.nextFunction && !this.userCancellations.get(msg.chat.id)) {
      const followUpTask = {
        name: followUpResponse.nextFunction.name,
        dependencies: [task.name],
        arguments: followUpResponse.nextFunction.arguments || {},
        alias: `${followUpResponse.nextFunction.name}_${Date.now()}`,
      };
      console.log("✅ Follow Up selected automatically by AI model after last result:", {
        name: followUpResponse.nextFunction.name,
        dependencies: [task.name],
        arguments: followUpResponse.nextFunction.arguments || {},
        alias: `${followUpResponse.nextFunction.name}_${Date.now()}`,
      });
      taskTree.push(followUpTask);
    }
  };

  for (const task of taskTree) {
    const signature = getTaskSignature(task);
    if (executedTaskSignatures.has(signature)) {
      // Skip task if already executed.
      console.log(`Skipping already executed task: ${signature}`);
      continue;
    }
    if (!results.find((r) => r.name === task.name && this.compareArguments(r.args, task.arguments))) {
      await executeTask(task, signature);
      // Mark the task as executed
      executedTaskSignatures.add(signature);
      this.userCancellations.delete(msg.chat.id);
    }
  }
  
  // Update task context with completion information
  taskContext.completed = Date.now();
  taskContext.totalDuration = (taskContext.completed - taskContext.startTime) / 1000;
  taskContext.totalSteps = stepCounter;
  
  const summary = this.formatResults(results.map((r) => r.text));
  return { text: summary, taskContext: taskContext };
}  

  /**
   * tryFallbackFunctions
   * --------------------
   * 1) Looks up fallbackMap for the given function name.
   * 2) Tries each fallback in order with short limited retry.
   * 3) If all fail, we throw.
   */
  async tryFallbackFunctions(name, args, userId, chatId, originalError) {
    const fallbacks = fallbackMap[name] || [];
    if (!fallbacks.length) {
      // No fallback => rethrow the original error
      console.error(`❌ No fallback defined for '${name}'. Failing step.`);
      throw originalError;
    }

    for (const fallbackName of fallbacks) {
      console.log(`⚠️ Attempting fallback '${fallbackName}' for '${name}'... args:'${args}`);
      try {
        // Possibly do short retry for fallback if it's also sensitive or likely to fail
        return await this.executeFunctionWithLimitedRetrySingleAttempt(
          fallbackName,
          args,
          userId,
          chatId
        );
      } catch (err) {
        console.warn(`⚠️ Fallback '${fallbackName}' failed: ${err.message}`);
        // Move to the next fallback in the array
      }
    }

    // All fallbacks failed
    throw new Error(
      `❌ All fallback functions for '${name}' have failed. Original error: ${originalError.message}`
    );
  }

  /**
   * executeFunctionWithLimitedRetry
   * -------------------------------
   * 1) Tries the main function up to `maxRetries` times if errors are recoverable.
   * 2) For each attempt, if function is "sensitive", reconfirm with user before retrying.
   * 3) If all retries fail or error is non-recoverable, we try fallback(s).
   * 4) If fallbacks also fail, we throw.
   * Extended to:
   * 1) Retry on recoverable errors
   * 2) Attempt fallback if non-recoverable or max retries reached
   * 3) Skip normal retries (and jump to fallback) if data is incomplete 
   *    (i.e., the function returned an "insufficient" result).
  */
  async executeFunctionWithLimitedRetry(name, args, userId, chatId, maxRetries = 2) {
    let attempts = 0;
    while (attempts < maxRetries) {      
      try {
        // Attempt the main function call.
        const result = await this.executeFunction(name, args, userId, chatId);
  
        // Check if the result is insufficient.
        if (this.isDataInsufficient(result)) {
          console.warn(`⚠️ Function '${name}' returned an error on attempt #${attempts + 1}, ${JSON.stringify(result)}`);
          attempts++;
  
          if (attempts < maxRetries) {
            // If the function is sensitive, ask for user confirmation before retrying.
            if (this.requiresConfirmation(name)) {
              const userConfirmed = await this.askForConfirmation(
                { chat: { id: chatId } },
                name,
                JSON.stringify(args)
              );
              if (!userConfirmed) {
                throw new Error(`User canceled retry for '${name}'.`);
              }
            }
            continue;
          } else {
            console.warn(`⚠️ No more retries left for '${name}'. Checking fallback... Using args: '${args}`);
            return await this.tryFallbackFunctions(name, args, userId, chatId, new Error("Insufficient data"));
          }
        }
        // Valid result; return immediately.
        return result;
      } catch (error) {
        attempts++;
        console.warn(`⚠️ Attempt ${attempts} for function '${name}' failed: ${error.message}`);
  
        // ★ NEW: If the error message indicates cancellation, immediately rethrow.
        if (error.message.toLowerCase().includes("user canceled")) {
          console.warn(`Cancellation detected for '${name}'. Aborting further retries.`);
          throw error;
        }
  
        if (!this.isRecoverableError(error) || attempts >= maxRetries) {
          console.warn(`⚠️ No more standard retries for '${name}'. Checking fallback...`);
          return await this.tryFallbackFunctions(name, args, userId, chatId, error);
        }
  
        // Continue normal retry attempts.
        await this.bot.sendMessage(
          chatId,
          `Retrying '${name}' (attempt #${attempts + 1}) due to error: ${error.message}`
        );
  
        if (this.requiresConfirmation(name)) {
          const userConfirmed = await this.askForConfirmation(
            { chat: { id: chatId } },
            name,
            JSON.stringify(args)
          );
          if (!userConfirmed) {
            throw new Error(`User canceled retry for '${name}'.`);
          }
        }
      }
    }
  }  

  /**
   * executeFunctionWithLimitedRetrySingleAttempt
   * --------------------------------------------
   * A simpler fallback method: tries once or twice if recoverable.
   * Also includes user confirmation if the fallback is "sensitive."
 */
  async executeFunctionWithLimitedRetrySingleAttempt(
    fallbackName,
    args,
    userId,
    chatId,
    maxFallbackRetries = 1
  ) {
    let attempts = 0;
    while (attempts < maxFallbackRetries) {
      try {
        const result = await this.executeFunction(
          fallbackName,
          args,
          userId,
          chatId
        );
        return result;
      } catch (error) {
        attempts++;
        console.warn(
          `⚠️ Fallback attempt #${attempts} for '${fallbackName}' failed: ${error.message}`
        );

        if (!this.isRecoverableError(error) || attempts >= maxFallbackRetries) {
          throw error; // no more fallback tries
        }

        // Optionally re-confirm if fallback is also sensitive
        if (this.requiresConfirmation(fallbackName)) {
          const userConfirmed = await this.askForConfirmation(
            { chat: { id: chatId } },
            fallbackName,
            JSON.stringify(args)
          );
          if (!userConfirmed) {
            throw new Error(`User canceled fallback retry for '${fallbackName}'.`);
          }
        }
      }
    }
  }

  /**
   * executeFunction
   * ---------------
   * Maps the AI function name to a method in your IntentProcessor or other modules.
   */
  async executeFunction(name, args, userId, chatId) {
    try {
      // Map function calls to actual method implementations
      const functionMap = {
        approve_token: () => this.intentProcessor.handleTokenApproval(args),
        revoke_token_approval: () => this.intentProcessor.handleTokenRevocation(args),
        create_solana_payment: () => this.intentProcessor.createSolanaPayment(args),
        get_market_conditions: () => this.intentProcessor.getMarketConditions(),
        fetch_market_categories: () => this.intentProcessor.getMarketCategories(),
        fetch_market_category_metrics: () => this.intentProcessor.getMarketCategoryMetrics(),
        fetch_coins_by_category: () => this.intentProcessor.getCoinsByCategory(args.categoryId),
        handle_product_reference: () => this.intentProcessor.handleProductReference(args.userId, args.productId),
        process_bridge_intent: () => this.intentProcessor.processBridgeTransaction(userId, chatId, args),
        evm_token_swap: () => this.intentProcessor.swapTokensOnEvm(userId, args),
        execute_solana_swap: () => this.intentProcessor.swapTokensOnJupiter(userId, args),
        execute_avalanche_swap: () => this.intentProcessor.swapTokensOnAvalanche(userId, args),
        ethereum_base_token_transfer: () => this.intentProcessor.sendTokensOnEvm(userId, args),
        handle_address_only_pasted: () => this.intentProcessor.handleAddressPaste(userId, args.address),
        fetch_tokenaddress_fromsymbol: () => this.intentProcessor.getTokenAddressBySymbol(args.tokenSymbol),
        analyze_token_by_symbol: () => this.intentProcessor.getTokenInfoBySymbol(args.query),
        analyze_token_by_address: () => this.intentProcessor.getTokenInfoByAddress(args.query),
        fetch_token_snipers: () => this.intentProcessor.fetchTokenSnipers(userId, args.query),
        search_token_by_twitterusername: () => this.intentProcessor.processAgentByTwitterQuery(args.twitterUsername, args.interval),
        check_token_mindshare_on_market: () => this.intentProcessor.processAgentByContractQuery(args.contractAddress, args.interval),
        suggest_token_investments_dominating: () => this.intentProcessor.processAgentsPaged(args.interval, args.page, args.pageSize),
        search_twitter_by_address: () => this.intentProcessor.processSearchTweets(args.query),
        get_token_market_sentiment_changes: () => this.intentProcessor.processSentimentShift(args.queryStr, args.interval),
        get_cookiedao_api_authorization_status: () => this.intentProcessor.processAuthorizationCheck(),// still Cookie.fun
        fetch_trending_tokens_all_sources: () => this.intentProcessor.getTrendingTokens(),
        fetch_trending_tokens_by_chain: () => this.intentProcessor.getTrendingTokensByChain(chatId, args.query),
        fetch_trending_tokens_coingecko: () => this.intentProcessor.getTrendingTokensCoinGecko(),
        fetch_trending_tokens_dextools: () => this.intentProcessor.getTrendingTokensDextools(),
        fetch_trending_tokens_dexscreener: () => this.intentProcessor.getTrendingTokensDexscreener(),
        fetch_trending_tokens_twitter: () => this.intentProcessor.getTrendingTokensTwitter(),
        fetch_trending_tokens_solscan:()=> this.intentProcessor.getTrendingTokensDexscreener(),
        create_price_alert: () => this.intentProcessor.createPriceAlert(userId, chatId, args),
        view_price_alerts: () => this.intentProcessor.viewPriceAlerts(userId),
        edit_price_alert: () => this.intentProcessor.editPriceAlert(args.alertId),
        view_price_alert: () => this.intentProcessor.getPriceAlert(args.alertId),
        delete_price_alert: () => this.intentProcessor.deletePriceAlert(args.alertId),
        get_portfolio: () => this.intentProcessor.getPortfolio(userId, args.network),
        get_wallet_balances: () => this.intentProcessor.getBalances(chatId, userId, args),
        get_wallet_token_transactions: () => this.intentProcessor.getWalletTransactions(chatId, args),
        fetch_flipper_mode_metrics: () => this.intentProcessor.fetchMetrics(),
        setup_flipper_mode: () => this.intentProcessor.setupFlipperMode(userId),
        start_flipper_mode: () => this.intentProcessor.startFlipperMode(userId, chatId, args),
        stop_flipper_mode: () => this.intentProcessor.stopFlipperMode(this.bot, userId),

        // Pumpfun Funtions
        listen_to_new_token_listings: () => this.intentProcessor.subscribeNewToken(userId, chatId, args),
        unlisten_to_new_token_listings: () => this.intentProcessor.unsubscribeNewToken(userId),
        subscribe_pumpfun_token_trade: () => this.intentProcessor.subscribeTokenTrade(userId, chatId, args.criteria, args.contractAddresses),
        unsubscribe_pumpfun_token_trade: () => this.intentProcessor.unsubscribeTokenTrade(userId, args),
        execute_pumpfun_trade: () => this.intentProcessor.executePumpfunTrade(userId, chatId, args),
        get_pumpfun_token_list_by_period: () => this.intentProcessor.getPumpfunTokenRanged(userId, chatId, args),
        get_pumpfun_tokens_by_liquidity: () => this.intentProcessor.getPumpfunTokenLiquidity(userId, chatId, args),

        // KOL Monitoring Functions
        monitor_kol: () => this.intentProcessor.startKOLMonitoring(userId, args),
        get_kol_monitor_positions: () => this.intentProcessor.getKOLMonitors(userId),
        delete_kol_monitor_position: () => this.intentProcessor.deleteKOLMonitoring(userId, args.handle),        
        /*delete_kol_monitor_position_by_id: () => this.intentProcessor.deleteKOLMonitoringID(userId, args.id),*/
        stop_monitor_kol: () => this.intentProcessor.stopKOLMonitoring(userId, args.handle),
        search_products: () => this.intentProcessor.handleShopifySearch(args.query),
        fetch_tweets_for_symbol: () => this.intentProcessor.search_tweets_for_cashtag(userId, args.query),
        search_twitter_using_multi_parameter_options: () => this.intentProcessor.processMultiDimensionalTwitterSearch(args),
        get_trench_chatter: () => this.intentProcessor.getTrenchChatterCached(),
        search_internet: () => this.intentProcessor.performInternetSearch(chatId, args.query),
        fetch_token_price_in_usd: () => this.intentProcessor.performTokenPriceCheck(args.query),
        token_price_coingecko: () => this.intentProcessor.getTokenInfoFromCoinGecko(args.query),
        
        // Google API Functions
        manage_user_google_settings: () => this.intentProcessor.manageUserGmailSettings(userId, args),
        manage_calendar_event: () => this.intentProcessor.manageCalendarEvent(userId, args),
        send_email: () => this.intentProcessor.sendEmail(userId, args),
        search_emails: () => this.intentProcessor.searchEmails(userId, args),
        read_email: () => this.intentProcessor.readEmail(userId, args),
        reply_email: () => this.intentProcessor.replyEmail(userId, args),

        // SolanaPay Functions
        create_solana_payment: () => this.intentProcessor.createSolanaPayment(args),
        get_payment_status: () => this.intentProcessor.getPaymentStatus(args),
        validate_payment: () => this.intentProcessor.validatePayment(args),
        create_recurring_payment: () => this.intentProcessor.createRecurringPayment(userId, args),
        get_payment_history: () => this.intentProcessor.getPaymentHistory(userId),

        // Savings
        save_strategy: () => this.intentProcessor.saveStrategy(userId, args),
        set_guidelines_manners_rules: ()=> this.intentProcessor.saveGuidelines(userId, args.query),
        get_guidelines_manners_rules: ()=> this.intentProcessor.getGuidelines(userId),
        get_30day_chat_history: ()=> this.intentProcessor.getChatHistory(userId),
        start_bitrefill_shopping_flow: ()=> this.intentProcessor.startBitrefillShoppingFlow(chatId, args.email),
        check_bitrefill_payment_status: ()=> this.intentProcessor.startBitrefillShoppingFlow(chatId, args.invoiceId),
        bridge_tokens: () => this.intentProcessor.handleBridgeTokens(args, chatId),
        fetch_bridge_receipts: () => this.intentProcessor.handleFetchBridgeReceipts(args),
        // Wallet creation
        create_evm_wallet: () => this.intentProcessor.createEVMWallet(userId, args.network),

        // Scrap the web info
        trending_tokens_fallback_scrap: () => this.intentProcessor.trendingTokensScrapped(userId),
        scrape_provided_url: () => this.intentProcessor.urlScrapper(userId, args.query),

        // Research and Tasks
        save_research: () => this.intentProcessor.processSaveResearchIntent(args, chatId),
        retrieve_research: () => this.intentProcessor.processRetrieveResearchIntent(args, chatId),
        delete_research: () => this.intentProcessor.processDeleteResearchIntent(args, chatId),
        save_task: () => this.intentProcessor.processSaveTaskIntent(args, chatId),
        retrieve_task: () => this.intentProcessor.processRetrieveTaskIntent(args, chatId),
        execute_task: () => this.intentProcessor.processExecuteTaskIntent(args, chatId),
        delete_task: () => this.intentProcessor.processDeleteTaskIntent(args, chatId),
      };

      const executor = functionMap[name];
      if (!executor) {
        throw new Error(`Unknown function: ${name}`);
      }
      // Validate arguments again
      this.validateRequiredParameters(name, args);

      // Track successful function call
      const duration = Date.now() - this.startTime;
      aiMetricsService.trackFunctionCall(name, true, duration);

      return await executor();
    } catch (error) {
      const duration = Date.now() - this.startTime;
      aiMetricsService.trackFunctionCall(name, false, duration);
      // Log full error fields
      console.error(`❌ Error in executeFunction('${name}')`, {
        message: error.message,
        stack: error.stack,
        functionName: name,
        args,
      });
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  /**
   * getFunctionResponse
   * --------------------
   * After a function call, decide whether follow-up functions are needed.
   * Only use recent context (trimmed messages) and a short directive.
   */
  async getFunctionResponse(chatId, messages, functionName, stepResult) {
    if (this.userCancellations.get(chatId)) {
      console.log("Cancellation detected: operation cancelled by user.");
      return {
        text: "Operation cancelled by user.",
        resultSummary: "User cancelled the operation; no further follow-up actions will be taken."
      };
    }

    try {
      const maxLength = 7000;
      const resultStr = JSON.stringify(stepResult);
      console.log(' ⏳ Result String at Max Length:',resultStr)
      const compressed = resultStr.length > maxLength ?
        resultStr.slice(0, maxLength) + `\n\n⚠️ [Carry over Results from ${resultStr.length} chars]` :
        resultStr;

      // Use only recent messages to save tokens.
      const trimmedMessages = this.trimRelevantMessages(messages);
      const newMessage = { role: "function", name: functionName, content: compressed };
      const fullMessages = [...trimmedMessages, newMessage];

      const response = await openAIService.createChatCompletion({
        model: "gpt-4o-mini",
        messages: fullMessages,
        functions: this.functions,
        function_call: "auto",
        max_tokens: 500,
        temperature: 0.4,
        top_p: 1.0,
        frequency_penalty: 0.3,
        presence_penalty: 0.2,
      });

      if (response.usage) {
        console.log(`📊 getFunctionResponse Token Usage:
- Prompt Tokens: ${response.usage.prompt_tokens}
- Completion Tokens: ${response.usage.completion_tokens}
- Total Tokens: ${response.usage.total_tokens}`);
      } else {
        console.warn("⚠️ No usage information available in getFunctionResponse response.");
      }

      const completion = response.choices[0]?.message;
      if (completion?.function_call) {
        return {
          nextFunction: {
            name: completion.function_call.name,
            arguments: JSON.parse(completion.function_call.arguments),
          },
        };
      }
      return {
        text: completion?.content || "No follow-up detected.",
        resultSummary: `Results from ${functionName} (possibly truncated).`
      };
    } catch (error) {
      console.error("❌ Error in getFunctionResponse:", {
        message: error.message,
        stack: error.stack,
        functionName,
        result,
      });
      throw error;
    }
  }

  /**
   * 4. Systematic cancellation handling
   * Add this utility method and modify executeMultiStepTask
   */
  checkCancellation(chatId, functionName, step) {
    if (this.userCancellations.get(chatId)) {
      const cancelInfo = {
        time: new Date().toISOString(),
        function: functionName,
        step: step,
      };
      console.log("🛑 Operation cancelled by user:", cancelInfo);
      throw new Error(`Operation '${functionName}' cancelled by user at step ${step}`);
    }
  }

  /**
   * trimRelevantMessages
   * --------------------
   * Optimized message trimming to maintain context while reducing token usage.
   * Prioritizes recent interactions and function results.
   */
  trimRelevantMessages(messages) {
    // Extract messages by role
    const systemMessages = messages.filter(m => m.role === "system").slice(-1); // Only keep most recent system message
    const functionMessages = messages.filter(m => m.role === "function");
    const userMessages = messages.filter(m => m.role === "user");
    const assistantMessages = messages.filter(m => m.role === "assistant");
    
    // Keep the most recent messages from each role
    const recentUserMessages = userMessages.slice(-3);
    const recentAssistantMessages = assistantMessages.slice(-3);
    
    // For function messages, prioritize recent and relevant ones
    // We'll keep the most recent function messages, but ensure we have at least 
    // one result from each unique function name to maintain context
    const uniqueFunctionNames = [...new Set(functionMessages.map(m => m.name))];
    const recentFunctionMessages = [];
    
    // First, ensure we have at least one message from each function type
    for (const name of uniqueFunctionNames) {
      const mostRecentOfType = functionMessages
        .filter(m => m.name === name)
        .slice(-1)[0];
      if (mostRecentOfType) {
        recentFunctionMessages.push(mostRecentOfType);
      }
    }
    
    // Then add the most recent function messages (if not already included)
    const additionalFunctionMessages = functionMessages
      .slice(-5)
      .filter(m => !recentFunctionMessages.includes(m));
    
    recentFunctionMessages.push(...additionalFunctionMessages);
    
    // Combine all messages, maintaining original order
    const allSelected = [...systemMessages, ...recentUserMessages, ...recentAssistantMessages, ...recentFunctionMessages];
    
    // Sort by original position to maintain conversation flow
    return messages.filter(m => allSelected.includes(m));
  }

  cleanJSONText(input, functionName = "unknown_function", functionArguments = {}) {
    if (!input || typeof input !== "string") return "";
    const timestamp = new Date().toISOString();
    const formattedArgs = Object.keys(functionArguments).length
      ? JSON.stringify(functionArguments, null, 2)
      : "No arguments provided";
    let cleanedText = input
      .replace(/[*_~`#]/g, "")
      .replace(/[{}\[\]]/g, "")
      .replace(/"/g, "")
      .replace(/\.{3,}/g, "..")
      .trim();
    const resultCleaned = `### Retrieved Result from: **${functionName}**
    Timestamp: **${timestamp}**
    🔹 **Function Arguments Used:**
    \`\`\`json
    ${formattedArgs}
    \`\`\`

    🔹 **Function Result:**
    \`\`\`plaintext
    ${cleanedText}
    \`\`\`
    `;
    return resultCleaned;
  }

  cleanTextForTelegram(input) {
    if (!input || typeof input !== "string") return "";
    
    // First, perform the basic cleaning (but do not escape HTML yet)
    let cleaned = input
      .replace(/[!#*_~`]/g, "")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s]+)\)/g, " $2")
      .replace(/\[.*?\]/g, "")
      .replace(/\.{3,}/g, "..")
      .replace(/\b(https?:\/\/[^\s]+)\b/g, "\n🔗 $1")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .trim();
  
    // Optionally, if you wish to allow <strong> tags, unescape those:
    // (Be cautious: this assumes the source <strong> tags are balanced and correct)
    cleaned = cleaned.replace(/&lt;(\/?strong)&gt;/g, "<$1>");
  
    // Now, truncate any detected addresses using our helper
    cleaned = this.truncateAddresses(cleaned);
  
    return cleaned;
  }  

  /**
   * Truncate a long address by keeping the first 6 and last 4 characters.
   * If the address is too short, return it unchanged.
   */
  truncateAddress(addr) {
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  /**
   * Scan the provided text for common address formats and replace them with truncated versions.
   *
   * Supported formats:
   * - Ethereum-style (0x followed by 40 hex digits) – covers Ethereum, Base, and Avalanche C-Chain.
   * - Solana addresses: Base58 strings of 43-44 characters.
   * - Avalanche P-chain addresses: starting with "P-" and at least 30 alphanumeric characters.
   * - Avalanche X-chain addresses: starting with "X-" and at least 30 alphanumeric characters.
   */
  truncateAddresses(text) {
    if (!text || typeof text !== "string") return text;
    
    // Ethereum / Base / Avalanche C-Chain addresses:
    text = text.replace(/0x[a-fA-F0-9]{40}/g, (match) => this.truncateAddress(match));

    // Solana addresses: 43 or 44 Base58 characters (avoiding ambiguous characters)
    text = text.replace(/\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/g, (match) => this.truncateAddress(match));

    // Avalanche P-chain addresses: starting with "P-" followed by at least 30 alphanumerics.
    text = text.replace(/\bP-[a-zA-Z0-9]{30,}\b/g, (match) => this.truncateAddress(match));

    // Avalanche X-chain addresses: starting with "X-" followed by at least 30 alphanumerics.
    text = text.replace(/\bX-[a-zA-Z0-9]{30,}\b/g, (match) => this.truncateAddress(match));

    return text;
  }

}

export const autonomousProcessor = new UnifiedAutonomousProcessor(bot);
