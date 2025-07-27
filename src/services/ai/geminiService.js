// geminiService.js - Gemini AI service for SENTINEL
import { GoogleGenAI } from '@google/genai';
import { config } from '../../core/config.js';
import { aiMetricsService } from '../aiMetricsService.js';

class GeminiService {
  constructor() {
    this.apiKey = config.geminiApiKey;
    this.genAI = new GoogleGenAI({
      apiKey: this.apiKey
    });
    this.textModel = 'gemini-2.5-pro';
    this.audioModel = 'models/gemini-2.5-flash-preview-native-audio-dialog';
  }

  /**
   * Stream text content from Gemini
   * @param {string} input - User text input
   * @param {Array} history - Conversation history (optional)
   * @param {Function} onChunk - Callback for each text chunk
   * @returns {Promise<Object>} - Complete response
   */
  async streamTextContent(input, history = [], onChunk = null) {
    try {
      const start = Date.now();
      console.log('🧠 Gemini Text Request:', input);

      // Format the contents with history if available
      const contents = history.length > 0 ? history : [
        {
          role: 'user',
          parts: [{ text: input }],
        }
      ];

      // Add tools configuration
      const config = {
        thinkingConfig: {
          thinkingBudget: -1,
        },
        tools: [
          {
            googleSearch: {}
          },
        ],
      };

      // Get the streaming response
      const response = await this.genAI.models.generateContentStream({
        model: this.textModel,
        config,
        contents,
      });

      let fullResponse = '';
      
      // Process each chunk
      for await (const chunk of response) {
        const chunkText = chunk.text || '';
        fullResponse += chunkText;
        
        // Call the chunk callback if provided
        if (onChunk && chunkText) {
          onChunk(chunkText);
        }
      }

      const duration = Date.now() - start;
      aiMetricsService.trackLLMUsage('gemini', input.length, fullResponse.length, duration);
      
      return { 
        text: fullResponse,
        model: this.textModel
      };
    } catch (error) {
      console.error('❌ Gemini text streaming error:', error.message);
      throw new Error(`Gemini AI error: ${error.message}`);
    }
  }

  /**
   * Process audio content through Gemini and stream responses
   * @param {ArrayBuffer} audioBuffer - Audio buffer from the microphone
   * @param {Function} onTextChunk - Callback for text chunks
   * @param {Function} onAudioChunk - Callback for audio chunks
   * @returns {Promise<Object>} - Session information
   */
  async processAudioStream(audioBuffer, onTextChunk = null, onAudioChunk = null) {
    try {
      const start = Date.now();
      console.log('🎤 Gemini Audio Request Processing');
      
      // Initialize response queue and session
      const responseQueue = [];
      
      // Connect to Gemini Live API
      const session = await this.genAI.live.connect({
        model: this.audioModel,
        callbacks: {
          onopen: () => console.log('🟢 Gemini audio session opened'),
          onmessage: (message) => {
            responseQueue.push(message);
            this.handleModelResponse(message, onTextChunk, onAudioChunk);
          },
          onerror: (e) => console.error('🔴 Gemini audio error:', e.message),
          onclose: (e) => console.log('🟠 Gemini audio session closed:', e.reason)
        },
        config: {
          responseModalities: ['AUDIO'],
          mediaResolution: 'MEDIA_RESOLUTION_MEDIUM',
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Zephyr',
              }
            }
          },
          contextWindowCompression: {
            triggerTokens: '25600',
            slidingWindow: { targetTokens: '12800' },
          },
        }
      });

      // Send the audio content
      session.sendClientContent({
        turns: [{
          audio: audioBuffer
        }]
      });

      // Process the turn
      await this.handleTurn(responseQueue);
      
      const duration = Date.now() - start;
      aiMetricsService.trackLLMUsage('gemini-audio', audioBuffer.byteLength, 0, duration);
      
      return { session };
    } catch (error) {
      console.error('❌ Gemini audio processing error:', error.message);
      throw new Error(`Gemini audio processing error: ${error.message}`);
    }
  }

  /**
   * Handle model responses
   * @private
   */
  handleModelResponse(message, onTextChunk, onAudioChunk) {
    if (message.serverContent?.modelTurn?.parts) {
      const part = message.serverContent.modelTurn.parts[0];

      // Handle file data
      if (part?.fileData) {
        console.log(`📁 File: ${part.fileData.fileUri}`);
      }

      // Handle inline data (audio)
      if (part?.inlineData) {
        const inlineData = part.inlineData;
        if (onAudioChunk) {
          onAudioChunk(inlineData.data, inlineData.mimeType);
        }
      }

      // Handle text
      if (part?.text) {
        console.log(`💬 Gemini response: ${part.text}`);
        if (onTextChunk) {
          onTextChunk(part.text);
        }
      }
    }
  }

  /**
   * Handle a conversation turn
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
   * Wait for a message from the queue
   * @private
   */
  async waitMessage(responseQueue) {
    let done = false;
    let message;
    
    while (!done) {
      message = responseQueue.shift();
      if (message) {
        done = true;
      } else {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    
    return message;
  }
}

export const geminiService = new GeminiService();
