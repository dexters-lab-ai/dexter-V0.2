import { EventEmitter } from 'events';
import { AIFunctions } from './AIFunctions.js';
import { openAIService } from '../openai.js';
import { ErrorHandler } from '../../../core/errors/index.js';
import { isDataInsufficient } from './DataValidator.js';

const MAX_TELEGRAM_CHARS = 4096;

export class HelperFunctions {
  constructor(bot) {
    this.bot = bot;
    this.functions = AIFunctions;
  }

  /**
   * A simple pass-through to the imported function isDataInsufficient,
   * so the rest of the app can do "this.isDataInsufficient(...)"
   */
  isDataInsufficient(result) {
    return isDataInsufficient(result);
  }

  /**
   * Validates that all required parameters exist for a given function name.
   */
  validateRequiredParameters(functionName, args) {
    const def = this.functions.find((f) => f.name === functionName);
    if (!def) throw new Error(`No function definition for '${functionName}'.`);
  
    const required = def.parameters?.required || [];
    const missing = required.filter((p) => !(p in args));
    if (missing.length) {
      throw new Error(
        `Missing required parameters for '${functionName}': ${missing.join(", ")}`
      );
    }
  
    // Validate batch processing case
    if (Array.isArray(args.queries) && args.queries.length === 0) {
      throw new Error(`'queries' must contain at least one element for '${functionName}'.`);
    }
  
    // Ensure batch and single aren't both present
    if ("query" in args && "queries" in args) {
      throw new Error(
        `Both 'query' and 'queries' cannot be present for '${functionName}'. Use one.`
      );
    }
  }  

  /**
   * Dynamically ask user for missing fields
   */
  async handleMissingParameters(fnName, args, missing, msg) {
    try {
      const promptText = `⚠️ Missing parameters for '${fnName}': ${missing.join(", ")}.\n` +
        `Provide the input value/string".`;

      await this.bot.sendMessage(msg.chat.id, promptText, {
        reply_markup: { force_reply: true },
      });

      return new Promise((resolve, reject) => {
        const t = setTimeout(() => {
          this.bot.removeListener("message", listener);
          reject(new Error("User did not respond in time for missing parameters."));
        }, 30000);

        const listener = async (reply) => {
          if (reply.chat.id === msg.chat.id) {
            clearTimeout(t);
            this.bot.removeListener("message", listener);

            const text = (reply.text || "").trim();
            // ADDED: Attempt to parse each "key=value" pair from user input:
            for (const param of missing) {
              // Use flexible pattern: paramName = remainderUntilNextSpace
              const regex = new RegExp(`${param}\\s*=\\s*(\\S+)`, "i");
              const found = text.match(regex);
              if (found) {
                args[param] = found[1];
              }
            }

            try {
              this.validateRequiredParameters(fnName, args);
              resolve(args);
            } catch (valErr) {
              // If still missing, recursively prompt again
              resolve(await this.handleMissingParameters(fnName, args, missing, msg));
            }
          }
        };
        this.bot.on("message", listener);
      });
    } catch (err) {
      console.error("❌ handleMissingParameters error:", err.message);
      throw err;
    }
  }

  
  /**
   * validateFollowUpParameters
   * --------------------------
   * Ensures that follow-up function parameters are valid and complete.
   * If parameters are missing or invalid, applies smart defaults or throws helpful errors.
   */
  async validateFollowUpParameters(functionName, args, userId, msg) {
    try {
      // Log the raw arguments received
      console.log("🟢 Received arguments:", { functionName, args, userId, chatId: msg.chat?.id });

      // Parse the arguments
      let parsed;
      try {
        parsed = typeof args === "string" ? this.safeParseJSON(args) : { ...args };
      } catch (parseErr) {
        console.error("❌ Failed to parse arguments:", parseErr.message, { args });
        throw new Error(`Invalid JSON arguments for '${functionName}': ${parseErr.message}`);
      }
      console.log("🟢 Parsed arguments:", { functionName, parsed });

      try {
        // Validate required parameters
        this.validateRequiredParameters(functionName, parsed);
        console.log("✅ Parameters validated for:", { functionName, parsed });
        return parsed;
      } catch (err) {
        console.error("❌ Parameter validation failed:", err.message);

        const match = err.message.match(/Missing required parameters for '.*?': (.+)/);
        if (!match) throw err; // It's some other error, re-throw

        const missingParams = match[1].split(", ").map((x) => x.trim());
        console.log("⚠️ Missing parameters detected:", { missingParams });

        // First try to derive missing parameters from context
        try {
          const derivedParams = await this.deriveParametersFromContext(functionName, missingParams, userId, msg);
          const updatedParams = { ...parsed, ...derivedParams };
          
          // Revalidate with derived parameters
          this.validateRequiredParameters(functionName, updatedParams);
          return updatedParams;
        } catch (derivationErr) {
          // If context derivation fails, fall back to prompting the user
          return await this.handleMissingParameters(functionName, parsed, missingParams, msg);
        }
      }
    } catch (parseErr) {
      console.error("❌ Failed to parse arguments:", parseErr.message, { args });
      throw new Error(`Invalid JSON arguments for '${functionName}': ${parseErr.message}`);
    }
  }
  
  /**
   * buildTaskTree
   * -------------
   * Creates a multi-step task array from the initial function call,
   * possibly splitting into repeated sub-tasks if arguments contain
   * an array of items to process (e.g., multiple queries or tokens).
   */
  buildTaskTree(templateName, initialFunctionCall) {
    if (!initialFunctionCall || !initialFunctionCall.name) {
      throw new Error("Invalid initial function call: missing 'name'.");
    }

    // Common single-task fallback
    const singleTask = [
      {
        name: initialFunctionCall.name,
        dependencies: [],
        arguments: initialFunctionCall.arguments || "{}"
      }
    ];

    // Parse the function arguments
    let args;
    try {
      args = JSON.parse(initialFunctionCall.arguments || "{}");
    } catch (err) {
      console.warn("buildTaskTree: Could not parse arguments, fallback to singleTask.");
      return singleTask;
    }

    const fnName = initialFunctionCall.name;

    // Check if arguments has an array we want to split
    // We'll do a helper function:
    function createRepeatedSubTasks(arrayOfItems, baseFunctionName, paramName) {
      // E.g. for each item in arrayOfItems => build sub-task
      // To run them in parallel (no dependencies),
      // set dependencies: [].
      // To run them in sequence, chain them.
      return arrayOfItems.map((item, idx) => ({
        name: baseFunctionName,
        // Lets not experiment with this:
        // chaining means If one task fails, it might block all subsequent tasks,well not really
        // but also this increases latency as each task must wait for the previous
        // For sequential chaining, do: dependencies: idx === 0 ? [] : [`${baseFunctionName}_${idx - 1}`]
        dependencies: [],
        // arguments: a JSON string for that item
        arguments: JSON.stringify({ [paramName]: item }),
        alias: `${baseFunctionName}_${idx}` // optional alias
      }));
    }

    // We'll detect if the user wants repeated calls.
    // For example, user calls "search_internet" with an array of queries.
    // Or "fetch_token_price_in_usd" with multiple queries, etc.

    // 1) For "search_internet"
    if (
      (fnName === "search_internet" && Array.isArray(args.queries)) ||
      (fnName === "fetch_token_price_in_usd" && Array.isArray(args.queries)) ||
      (fnName === "token_price_coingecko" && Array.isArray(args.queries)) ||
      (fnName === "analyze_token_by_symbol" && Array.isArray(args.queries)) ||
      (fnName === "analyze_token_by_address" && Array.isArray(args.queries)) ||
      (fnName === "fetch_trending_tokens_by_chain" && Array.isArray(args.queries)) 
    ) {
      let paramName = "query";
      let items = args.queries;
      return createRepeatedSubTasks(items, fnName, paramName);
    }

    // If none of the above pattern matches or no array => fallback single
    return singleTask;
  }
    
    /**
     * Format an object/array to string, handle large data
     */
    /**
     * Send a message in HTML, splitting into multiple messages if text > 4096 chars.
    */
    async sendMessageWithLimit(chatId, text, parseMode = "HTML") {
      const chunkSize = MAX_TELEGRAM_CHARS;
      let start = 0;
      while (start < text.length) {
        const chunk = text.slice(start, start + chunkSize);
        await this.bot.sendMessage(chatId, chunk, { parse_mode: parseMode });
        start += chunkSize;
      }
    }

    /**
     * formatResultForDisplay
     * 
     * Moved from old code, no markdown escaping. 
     * If you want to protect HTML, do an optional escapeHtml.
     */
    formatResultForDisplay(result) {
      const limit = 200;
      if (result == null) return "Oops, No data to format for display.";

      const processValue = (val, path = "") => {
        if (val == null) return "null";

        if (Array.isArray(val)) {
          if (val.length > limit) {
            return `[${val.slice(0, limit).map((x, i) => processValue(x, `${path}[${i}]`)).join(", ")}] ... truncated`;
          }
          return `[${val.map((x, i) => processValue(x, `${path}[${i}]`)).join(", ")}]`;
        }

        if (typeof val === "object") {
          const entries = Object.entries(val);
          if (entries.length > limit) {
            const partial = entries.slice(0, limit).reduce((acc, [k, v]) => {
              acc[k] = processValue(v, `${path}.${k}`);
              return acc;
            }, {});
            return JSON.stringify(partial, null, 2) + " ... truncated";
          }
          return entries
            .map(([k, v]) => `${k}: ${processValue(v, `${path}.${k}`)}`)
            .join("\n");
        }

        // Otherwise string/number/bool
        return String(val);
      };

      if (typeof result === "object") {
        return processValue(result, "");
      }
      return String(result);
    }

  /* ============================================================
     === Utility Functions: Safe Object Access & JSON Parsing ===
     ============================================================ */

    safeGet(obj, path, defaultValue = null) {
      if (!obj) return defaultValue;
      const keys = Array.isArray(path) ? path : path.split('.');
      let result = obj;
      for (const key of keys) {
        if (result == null || typeof result !== 'object') return defaultValue;
        result = result[key];
        if (result === undefined) return defaultValue;
      }
      return result === undefined ? defaultValue : result;
    }
  
    safeParseJSON(text, defaultValue = {}) {
      if (!text || typeof text !== 'string') {
        return defaultValue;
      }
      try {
        return JSON.parse(text);
      } catch (error) {
        console.warn('Failed to parse JSON:', error.message);
        return defaultValue;
      }
    }
  
  /**
   * Creates a fallback response when a task fails.
   * @param {string} functionName - The function that failed.
   * @param {object} args - The arguments passed to the function.
   * @param {Error} error - The error that occurred.
   * @returns {object} A standardized response object with a text field.
   */
  createFallbackTaskResult(functionName, args, error) {
    return {
      status: "error",
      function: functionName,
      errorMessage: error.message,
      text: `I encountered an issue while executing ${functionName}, but I'll continue with the remaining tasks.`,
      timestamp: new Date().toISOString(),
      args: args
    };
  }

  /* ============================================================
      === Results Formatting: Always Return a String Result    ===
  ============================================================ */

  formatResults(resultsArray) {
    if (!Array.isArray(resultsArray) || resultsArray.length === 0) {
      return "⚠️ No results to display.";
    }
    // Map over each result and ensure it is a string
    const stringResults = resultsArray.map((result) => {
      if (typeof result === 'string') return result;
      return typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result);
    });
    // Join the results with two newlines for readability
    return stringResults.join("\n\n");
  }
  

  /**
   * notifyUserWithRetry
   */
  async notifyUserWithRetry(type, msg, taskName, extra, max = 3) {
    let attempt = 0;
    while (attempt < max) {
      const ok = await this.notifyUser(type, msg, taskName, extra);
      if (ok) return true;
      attempt++;
    }
    await this.fallbackResponse(msg, `Cannot notify about '${taskName}' after ${max} tries.`);
    return false;
  }

  /**
   * notifyUser
   * Now using HTML parse mode, chunk-splitting, no markdown escapes
   */
  async notifyUser(type, msg, taskName = "", extra = "") {
    try {
      if (!msg?.chat?.id) return false;
      const chatId = msg.chat.id;
      const truncatedExtra = extra.slice(0, 2000); // or any safe cutoff

      const map = {
        start: `🔄 <b>Starting</b> ${taskName}...`,
        complete: `✅ <b>${taskName} completed</b>.\n${truncatedExtra}`,
        followUp: `🔄 <i>Proceeding with</i> ${taskName}...`,
        error: `❌ <b>Error in</b> ${taskName}.\n${truncatedExtra}`,
      };

      const textToSend = map[type] || truncatedExtra || "⚠️";
      await this.sendMessageWithLimit(chatId, textToSend, "HTML");
      return true;
    } catch (error) {
      console.error("❌ notifyUser error:", error.message);
      return false;
    }
  }

  /**
   * fallbackResponse
   * 
   * Also HTML parse mode
   */
  async fallbackResponse(msg, explanation) {
    try {
      if (!msg?.chat?.id) return;
      const finalText = `⚠️ ${explanation}`;
      await this.sendMessageWithLimit(msg.chat.id, finalText, "HTML");
    } catch (err) {
      console.error("❌ fallbackResponse error:", err.message);
    }
  }

  /**
   * isRecoverableError
   * ------------------
   * Checks if error is something we want to retry or fallback on:
   * - network timeouts (ETIMEDOUT, ENOTFOUND, ECONNRESET, 503, etc.)
   * - certain 4XX or 5XX HTTP statuses (404, 429, 502, 503, etc.)
   * - more...
   */
  isRecoverableError(error) {
    // 1) Standard networking keys
    const recoverableKeywords = [
      "ECONNRESET",
      "ETIMEDOUT",
      "NetworkError",
      "ENOTFOUND",
      "AggregateError"
    ];

    // 2) Some typical HTTP status codes that might be "retryable"
    // If you don't want to retry on 404, remove it.
    // If 402 (Payment Required) can be solved by a quick fix, lets keep it; otherwise remove.
    const recoverableHttpCodes = ["404", "402", "408", "429", "500", "502", "503", "504"];

    // 3) We can check error.code, error.statusCode, or parse error.message
    const messageLower = (error.message || "").toLowerCase();

    // If error has an explicit code or statusCode:
    if (error.code && recoverableHttpCodes.includes(String(error.code))) {
      return true;
    }
    if (error.statusCode && recoverableHttpCodes.includes(String(error.statusCode))) {
      return true;
    }

    // Then check if message includes or exactly matches
    for (const kw of recoverableKeywords) {
      if (messageLower.includes(kw.toLowerCase())) {
        
      console.log('📩 Error Keyword: ', JSON.stringify(messageLower, null, 2));
        return true;
      }
    }
    for (const http of recoverableHttpCodes) {
      if (messageLower.includes(http)) {
        console.log('📩 Error Code: ', JSON.stringify(messageLower, null, 2));
        return true;
      }
    }

    // If we don't find any match, treat as not recoverable
    return false;
  }

  /**
   * sendMessageWithLimit
   * ------------------
   * Checks if message about to be send to user through telegram bot is not too long
   * - Telegram 4096 char limit respected
   * - Text chunked if it exceeds
   */
  
}
