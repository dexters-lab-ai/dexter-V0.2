// src/services/gemini/GeminiLiveService.js
import { GoogleGenAI, Modality, MediaResolution } from '@google/genai';
import { EventEmitter } from 'events';

export class GeminiLiveService extends EventEmitter {
  constructor() {
    super();
    this.ai = new GoogleGenAI({ 
      apiKey: process.env.GEMINI_API_KEY 
    });
    this.sessions = new Map(); // Track user sessions by wallet address
    this.model = 'models/gemini-2.5-flash-preview-native-audio-dialog';
  }

  /**
   * Create a new Gemini Live session for a user
   * @param {string} userId - User's wallet address
   * @param {string} instructions - System instructions for the AI
   * @returns {Promise<Object>} Session object
   */
  async createSession(userId, instructions = null) {
    try {
      console.log(`🎤 Creating Gemini Live session for user: ${userId}`);

      const config = {
        responseModalities: [Modality.AUDIO, Modality.TEXT],
        mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: 'Zephyr' // Professional, clear voice
            }
          }
        },
        contextWindowCompression: {
          triggerTokens: '25600',
          slidingWindow: { targetTokens: '12800' }
        }
      };

      const session = await this.ai.live.connect({
        model: this.model,
        config,
        callbacks: {
          onopen: () => {
            console.log(`✅ Gemini Live session opened for user ${userId}`);
            this.emit('session_opened', { userId });
          },
          onmessage: (message) => {
            this.handleGeminiMessage(userId, message);
          },
          onerror: (error) => {
            console.error(`❌ Gemini Live session error for ${userId}:`, error);
            this.emit('session_error', { userId, error });
          },
          onclose: (event) => {
            console.log(`🔒 Gemini Live session closed for ${userId}:`, event.reason);
            this.sessions.delete(userId);
            this.emit('session_closed', { userId, reason: event.reason });
          }
        }
      });

      // Create session data
      const sessionData = {
        session,
        responseQueue: [],
        isProcessing: false,
        audioParts: [],
        createdAt: Date.now()
      };

      this.sessions.set(userId, sessionData);

      // Send initial system instructions
      if (instructions) {
        await this.sendSystemInstructions(userId, instructions);
      }

      return sessionData;
    } catch (error) {
      console.error(`Failed to create Gemini Live session for ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Send system instructions to the AI
   * @param {string} userId - User's wallet address
   * @param {string} instructions - System instructions
   */
  async sendSystemInstructions(userId, instructions) {
    const sessionData = this.sessions.get(userId);
    if (!sessionData) {
      throw new Error(`No active session for user ${userId}`);
    }

    const systemMessage = {
      turns: [{
        role: 'user',
        parts: [{ 
          text: `SYSTEM INSTRUCTIONS: ${instructions}

You are SENTINEL, an AI-powered crypto intelligence assistant. You have access to real-time token data, security analysis, and social sentiment tools. 

When users ask about tokens, prices, or crypto-related topics:
1. Use available tools to fetch current data
2. Provide concise, actionable insights
3. Keep responses conversational and under 30 seconds when speaking
4. If asked about specific tokens, always try to get the latest price and key metrics

Available tools include:
- Token price and metadata lookup
- Security analysis and holder distribution
- Social sentiment from Twitter/X
- Contract address resolution

Respond naturally in voice conversations. Be helpful, accurate, and engaging.`
        }]
      }]
    };

    sessionData.session.sendClientContent(systemMessage);
    console.log(`📝 System instructions sent to user ${userId}`);
  }

  /**
   * Send audio chunk to Gemini Live session
   * @param {string} userId - User's wallet address
   * @param {string} audioData - Base64 encoded audio data
   * @param {string} mimeType - Audio MIME type
   */
  async sendAudioChunk(userId, audioData, mimeType = 'audio/webm;codecs=opus') {
    const sessionData = this.sessions.get(userId);
    if (!sessionData) {
      throw new Error(`No active session for user ${userId}`);
    }

    try {
      const audioMessage = {
        turns: [{
          role: 'user',
          parts: [{
            inlineData: {
              mimeType: mimeType,
              data: audioData
            }
          }]
        }]
      };

      sessionData.session.sendClientContent(audioMessage);
      sessionData.isProcessing = true;
      
      console.log(`🎵 Audio chunk sent to Gemini for user ${userId}`);
      this.emit('audio_sent', { userId, size: audioData.length });
    } catch (error) {
      console.error(`Error sending audio for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Handle incoming messages from Gemini Live API
   * @param {string} userId - User's wallet address
   * @param {Object} message - Gemini Live message
   */
  handleGeminiMessage(userId, message) {
    const sessionData = this.sessions.get(userId);
    if (!sessionData) return;

    try {
      sessionData.responseQueue.push(message);

      if (message.serverContent?.modelTurn?.parts) {
        const parts = message.serverContent.modelTurn.parts;
        
        for (const part of parts) {
          // Handle text response
          if (part.text) {
            console.log(`💬 Gemini text response for ${userId}:`, part.text);
            this.emit('text_response', { 
              userId, 
              text: part.text,
              timestamp: Date.now()
            });
          }

          // Handle audio response
          if (part.inlineData && part.inlineData.mimeType?.includes('audio')) {
            console.log(`🔊 Gemini audio response for ${userId}`);
            sessionData.audioParts.push(part.inlineData.data);
            
            // Convert and emit audio
            const audioBuffer = this.convertToWav(sessionData.audioParts, part.inlineData.mimeType);
            this.emit('audio_response', {
              userId,
              audio: audioBuffer.toString('base64'),
              mimeType: 'audio/wav',
              timestamp: Date.now()
            });
          }

          // Handle file data (if any)
          if (part.fileData) {
            console.log(`📁 Gemini file response for ${userId}:`, part.fileData.fileUri);
            this.emit('file_response', {
              userId,
              fileUri: part.fileData.fileUri,
              timestamp: Date.now()
            });
          }
        }
      }

      // Check if turn is complete
      if (message.serverContent?.turnComplete) {
        sessionData.isProcessing = false;
        sessionData.audioParts = []; // Reset for next turn
        this.emit('turn_complete', { userId });
        console.log(`✅ Turn complete for user ${userId}`);
      }

    } catch (error) {
      console.error(`Error handling Gemini message for ${userId}:`, error);
      this.emit('message_error', { userId, error });
    }
  }

  /**
   * Convert raw audio data to WAV format
   * @param {string[]} rawData - Array of base64 audio chunks
   * @param {string} mimeType - Source MIME type
   * @returns {Buffer} WAV audio buffer
   */
  convertToWav(rawData, mimeType) {
    const options = this.parseMimeType(mimeType);
    const dataLength = rawData.reduce((a, b) => a + b.length, 0);
    const wavHeader = this.createWavHeader(dataLength, options);
    const buffer = Buffer.concat(rawData.map(data => Buffer.from(data, 'base64')));

    return Buffer.concat([wavHeader, buffer]);
  }

  /**
   * Parse MIME type to extract audio parameters
   * @param {string} mimeType - MIME type string
   * @returns {Object} Audio parameters
   */
  parseMimeType(mimeType) {
    const [fileType, ...params] = mimeType.split(';').map(s => s.trim());
    const [_, format] = fileType.split('/');

    const options = {
      numChannels: 1,
      bitsPerSample: 16,
      sampleRate: 16000
    };

    if (format && format.startsWith('L')) {
      const bits = parseInt(format.slice(1), 10);
      if (!isNaN(bits)) {
        options.bitsPerSample = bits;
      }
    }

    for (const param of params) {
      const [key, value] = param.split('=').map(s => s.trim());
      if (key === 'rate') {
        options.sampleRate = parseInt(value, 10);
      }
    }

    return options;
  }

  /**
   * Create WAV file header
   * @param {number} dataLength - Audio data length
   * @param {Object} options - Audio format options
   * @returns {Buffer} WAV header buffer
   */
  createWavHeader(dataLength, options) {
    const { numChannels, sampleRate, bitsPerSample } = options;
    const byteRate = sampleRate * numChannels * bitsPerSample / 8;
    const blockAlign = numChannels * bitsPerSample / 8;
    const buffer = Buffer.alloc(44);

    buffer.write('RIFF', 0);                      // ChunkID
    buffer.writeUInt32LE(36 + dataLength, 4);     // ChunkSize
    buffer.write('WAVE', 8);                      // Format
    buffer.write('fmt ', 12);                     // Subchunk1ID
    buffer.writeUInt32LE(16, 16);                 // Subchunk1Size (PCM)
    buffer.writeUInt16LE(1, 20);                  // AudioFormat (1 = PCM)
    buffer.writeUInt16LE(numChannels, 22);        // NumChannels
    buffer.writeUInt32LE(sampleRate, 24);         // SampleRate
    buffer.writeUInt32LE(byteRate, 28);           // ByteRate
    buffer.writeUInt16LE(blockAlign, 32);         // BlockAlign
    buffer.writeUInt16LE(bitsPerSample, 34);      // BitsPerSample
    buffer.write('data', 36);                     // Subchunk2ID
    buffer.writeUInt32LE(dataLength, 40);         // Subchunk2Size

    return buffer;
  }

  /**
   * Close a user's session
   * @param {string} userId - User's wallet address
   */
  async closeSession(userId) {
    const sessionData = this.sessions.get(userId);
    if (sessionData) {
      try {
        sessionData.session.close();
        this.sessions.delete(userId);
        console.log(`🔒 Closed Gemini Live session for user ${userId}`);
      } catch (error) {
        console.error(`Error closing session for ${userId}:`, error);
      }
    }
  }

  /**
   * Get active session for user
   * @param {string} userId - User's wallet address
   * @returns {Object|null} Session data or null
   */
  getSession(userId) {
    return this.sessions.get(userId) || null;
  }

  /**
   * Check if user has active session
   * @param {string} userId - User's wallet address
   * @returns {boolean} True if session exists
   */
  hasActiveSession(userId) {
    return this.sessions.has(userId);
  }

  /**
   * Get session statistics
   * @returns {Object} Session statistics
   */
  getStats() {
    return {
      activeSessions: this.sessions.size,
      sessions: Array.from(this.sessions.keys()).map(userId => ({
        userId,
        createdAt: this.sessions.get(userId).createdAt,
        isProcessing: this.sessions.get(userId).isProcessing
      }))
    };
  }
}

// Export singleton instance
export const geminiLiveService = new GeminiLiveService();
