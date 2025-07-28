// geminiService.js - Gemini AI service for SENTINEL
import dotenv from 'dotenv';
dotenv.config(); // Load environment variables

import { GoogleGenerativeAI } from '@google/generative-ai';
import { aiMetricsService } from '../aiMetricsService.js';

/**
 * Service for interacting with Gemini API
 * Provides methods for generating text, images, and handling streaming responses
 * Implements the official Gemini streaming function-calling pattern for tools
 */
class GeminiService {
  constructor() {
    // Initialize with your API key
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    // Configure the models we'll use
    this.textModel = 'gemini-1.5-flash-latest'; // Using the latest flash model for speed and cost
    this.audioModel = 'gemini-1.5-flash-latest'; // Using the latest flash model for speed and cost
    
    this.contextWindow = 100000; // Context window for gemini-pro
    
    console.log('🤖 GeminiService initialized with production-grade function-calling support.');
  }

  /**
   * Streams text content from Gemini, correctly handling multi-turn tool calls
   * by following the official Google AI streaming pattern.
   * @param {string} input - User text input
   * @param {Array} history - Conversation history (optional)
   * @param {Function} onChunk - Callback for each text chunk
   * @param {Function} onToolCall - Callback for tool calls (optional)
   * @returns {Promise<Object>} - Final aggregated response object
   */
  async streamTextContent(input, history = [], onChunk = null, onToolCall = null) {
    const start = Date.now();
    console.log('🚀 [PROD] Starting Gemini streaming request:', input);

    // --- 1. Define Tools ---
    const toolDefinitions = {
      functionDeclarations: [
        {
          name: 'google_search',
          description: 'Search the web for current information on any topic including crypto, finance, technology, or general knowledge.',
          parameters: {
            type: 'OBJECT',
            properties: {
              query: { type: 'STRING', description: 'The search query to find information on the web.' }
            },
            required: ['query']
          }
        },
        {
          name: 'sentinel_search',
          description: 'Search for cryptocurrency information including token data, prices, charts, security metrics, and social sentiment.',
          parameters: {
            type: 'OBJECT',
            properties: {
              token: { type: 'STRING', description: 'Token symbol (e.g., \"BTC\"), name, or contract address.' }
            },
            required: ['token']
          }
        },
        {
          name: 'sentinel_url_analyzer',
          description: 'Extract and analyze content from a URL, useful for crypto websites, whitepapers, or articles.',
          parameters: {
            type: 'OBJECT',
            properties: {
              url: { type: 'STRING', description: 'The complete URL to scrape and analyze.' }
            },
            required: ['url']
          }
        }
      ]
    };

    // --- 2. Initialize Model and Chat ---
    const model = this.genAI.getGenerativeModel({ model: this.textModel, tools: toolDefinitions });
    const chat = model.startChat({ history });

    // --- 3. Send Initial Message & Start Streaming ---
    console.log('✉️ [PROD] Sending initial message to Gemini.');
    const result = await chat.sendMessageStream(input);

    let aggregatedResponseText = '';
    let aggregatedToolCalls = [];

    // --- 4. Process Stream for Text and Tool Calls ---
    for await (const chunk of result.stream) {
      if (chunk.text) {
        const text = chunk.text();
        // console.log(`💬 [PROD] Received text chunk: "${text.substring(0, 50)}..."`);
        aggregatedResponseText += text;
        if (onChunk) onChunk(text);
      }

      const functionCalls = chunk.functionCalls();
      if (functionCalls && functionCalls.length > 0) {
        console.log('🔧 [PROD] Model requests tool calls:', functionCalls.map(fc => fc.name));
        aggregatedToolCalls.push(...functionCalls);

        if (!onToolCall) {
          console.error('[PROD] Tool call requested but no onToolCall handler provided.');
          continue;
        }

        // --- 5. Execute Tool Calls Concurrently ---
        const toolPromises = functionCalls.map(call => onToolCall(call.name, call.args));
        const toolResults = await Promise.all(toolPromises);

        const toolResponseParts = functionCalls.map((call, index) => ({
          functionResponse: {
            name: call.name,
            response: { result: toolResults[index] }
          }
        }));

        // --- 6. Send Tool Results Back to Model ---
        console.log('↪️ [PROD] Sending tool results back to Gemini.');
        const secondResult = await chat.sendMessageStream(toolResponseParts);

        // --- 7. Process Final Response Stream ---
        for await (const finalChunk of secondResult.stream) {
          if (finalChunk.text) {
            const finalText = finalChunk.text();
            // console.log(`💬 [PROD] Received final text chunk: "${finalText.substring(0, 50)}..."`);
            aggregatedResponseText += finalText;
            if (onChunk) onChunk(finalText);
          }
        }
      }
    }

    const duration = Date.now() - start;
    console.log(`✅ [PROD] Gemini stream finished in ${duration}ms.`);
    aiMetricsService.trackGeneration({ provider: 'gemini', model: this.textModel, durationMs: duration, success: true });

    return {
      text: aggregatedResponseText,
      toolCalls: aggregatedToolCalls,
      model: this.textModel
    };
  }

  /**
   * Process audio content through Gemini and stream responses
   * @param {ArrayBuffer} audioBuffer - Audio buffer from the microphone
   * @param {Function} onTextChunk - Callback for text chunks
   * @param {Function} onAudioChunk - Callback for audio chunks
   * @param {Function} onToolCall - Optional callback for tool calls
   * @returns {Promise<Object>} - Session information
   */
  async processAudioStream(audioBuffer, onTextChunk = null, onAudioChunk = null, onToolCall = null) {
    try {
      const start = Date.now();
      console.log('🎤 [PROD] Gemini Audio Request Processing');
      
      const responseQueue = [];
      
      const session = await this.genAI.live.connect({
        model: this.audioModel,
        callbacks: {
          onopen: () => console.log('🟢 [PROD] Gemini audio session opened'),
          onmessage: (message) => {
            responseQueue.push(message);
            this.handleModelResponse(message, onTextChunk, onAudioChunk, onToolCall);
          },
          onerror: (e) => console.error('🔴 [PROD] Gemini audio error:', e.message),
          onclose: (e) => console.log('🟠 [PROD] Gemini audio session closed:', e.reason)
        },
      });

      session.sendClientContent({ audio: audioBuffer });

      await this.handleTurn(responseQueue);
      
      const duration = Date.now() - start;
      console.log(`[PROD] Gemini audio request completed in ${duration}ms`);
      
      return { session };
    } catch (error) {
      console.error('❌ [PROD] Gemini audio processing error:', error.message);
      throw new Error(`Gemini audio processing error: ${error.message}`);
    }
  }

  /**
   * Handle model responses from audio stream
   * @private
   */
  handleModelResponse(message, onTextChunk, onAudioChunk, onToolCall) {
    if (message.serverContent?.modelTurn?.parts) {
      for (const part of message.serverContent.modelTurn.parts) {
        if (part?.inlineData) {
          if (onAudioChunk) onAudioChunk(part.inlineData.data, part.inlineData.mimeType);
        }

        if (part?.functionCall) {
          console.log(`🔧 [PROD] Tool call in audio stream: ${part.functionCall.name}`, part.functionCall.args);
          if (onToolCall) onToolCall(part.functionCall.name, part.functionCall.args);
          if (onTextChunk) onTextChunk(`[Using tool: ${part.functionCall.name}]\n`);
        }

        if (part?.text) {
          // console.log(`💬 [PROD] Gemini audio response: ${part.text}`);
          if (onTextChunk) onTextChunk(part.text);
        }
      }
    }
  }

  /**
   * Handle a conversation turn in audio stream
   * @private
   */
  async handleTurn(responseQueue) {
    const turn = [];
    let done = false;
    while (!done) {
      const message = await this.waitMessage(responseQueue);
      turn.push(message);
      if (message.serverContent && message.serverContent.turnComplete) {
        done = true;
      }
    }
    return turn;
  }

  /**
   * Wait for a message from the queue in audio stream
   * @private
   */
  async waitMessage(responseQueue) {
    while (true) {
      const message = responseQueue.shift();
      if (message) return message;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

export const geminiService = new GeminiService();
