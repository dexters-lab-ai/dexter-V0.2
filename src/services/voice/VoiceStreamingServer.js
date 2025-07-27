// src/services/voice/VoiceStreamingServer.js
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { geminiLiveService } from '../gemini/GeminiLiveService.js';
import { URL } from 'url';

export class VoiceStreamingServer extends EventEmitter {
  constructor(server) {
    super();
    this.wss = null;
    this.server = server;
    this.clients = new Map(); // Map wallet address to WebSocket connection
    this.sessionTimeouts = new Map(); // Track session timeouts
    this.maxSessionDuration = parseInt(process.env.MAX_VOICE_SESSION_DURATION) || 300000; // 5 minutes
    this.setupGeminiEventHandlers();
  }

  /**
   * Initialize the WebSocket server
   */
  async initialize() {
    try {
      this.wss = new WebSocket.Server({ 
        server: this.server,
        path: '/voice-stream',
        verifyClient: (info) => {
          // Basic verification - could add more security here
          const url = new URL(info.req.url, 'http://localhost');
          const walletAddress = url.searchParams.get('wallet');
          return walletAddress && walletAddress.length > 0;
        }
      });

      this.setupWebSocketHandlers();
      console.log('🎤 Voice streaming WebSocket server initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize voice streaming server:', error);
      throw error;
    }
  }

  /**
   * Set up WebSocket connection handlers
   */
  setupWebSocketHandlers() {
    this.wss.on('connection', (ws, req) => {
      const walletAddress = this.extractWalletAddress(req.url);
      
      if (!walletAddress) {
        ws.close(1008, 'Wallet address required');
        return;
      }

      console.log(`🔗 Voice client connected: ${walletAddress}`);
      
      // Store client connection
      this.clients.set(walletAddress, {
        ws,
        connectedAt: Date.now(),
        isActive: false
      });

      // Set up message handlers
      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          await this.handleVoiceMessage(walletAddress, message, ws);
        } catch (error) {
          console.error(`Error handling message from ${walletAddress}:`, error);
          this.sendError(ws, 'Invalid message format');
        }
      });

      // Handle client disconnect
      ws.on('close', (code, reason) => {
        console.log(`🔌 Voice client disconnected: ${walletAddress} (${code}: ${reason})`);
        this.handleClientDisconnect(walletAddress);
      });

      // Handle WebSocket errors
      ws.on('error', (error) => {
        console.error(`WebSocket error for ${walletAddress}:`, error);
        this.handleClientDisconnect(walletAddress);
      });

      // Send connection confirmation
      this.sendMessage(ws, {
        type: 'connected',
        walletAddress,
        timestamp: Date.now()
      });
    });

    this.wss.on('error', (error) => {
      console.error('WebSocket server error:', error);
    });
  }

  /**
   * Set up Gemini Live service event handlers
   */
  setupGeminiEventHandlers() {
    geminiLiveService.on('session_opened', ({ userId }) => {
      this.sendToClient(userId, {
        type: 'session_ready',
        timestamp: Date.now()
      });
    });

    geminiLiveService.on('text_response', ({ userId, text, timestamp }) => {
      this.sendToClient(userId, {
        type: 'transcription',
        text,
        timestamp
      });
    });

    geminiLiveService.on('audio_response', ({ userId, audio, mimeType, timestamp }) => {
      this.sendToClient(userId, {
        type: 'audio_response',
        audio,
        mimeType,
        timestamp
      });
    });

    geminiLiveService.on('turn_complete', ({ userId }) => {
      this.sendToClient(userId, {
        type: 'complete',
        timestamp: Date.now()
      });
    });

    geminiLiveService.on('session_error', ({ userId, error }) => {
      this.sendToClient(userId, {
        type: 'error',
        error: error.message,
        timestamp: Date.now()
      });
    });

    geminiLiveService.on('session_closed', ({ userId, reason }) => {
      this.sendToClient(userId, {
        type: 'session_closed',
        reason,
        timestamp: Date.now()
      });
    });
  }

  /**
   * Handle incoming voice messages from clients
   * @param {string} walletAddress - Client's wallet address
   * @param {Object} message - Parsed message object
   * @param {WebSocket} ws - WebSocket connection
   */
  async handleVoiceMessage(walletAddress, message, ws) {
    try {
      switch (message.type) {
        case 'start_session':
          await this.startVoiceSession(walletAddress, message, ws);
          break;

        case 'audio_chunk':
          await this.processAudioChunk(walletAddress, message, ws);
          break;

        case 'end_session':
          await this.endVoiceSession(walletAddress, ws);
          break;

        case 'ping':
          this.sendMessage(ws, { type: 'pong', timestamp: Date.now() });
          break;

        default:
          console.warn(`Unknown message type from ${walletAddress}:`, message.type);
          this.sendError(ws, `Unknown message type: ${message.type}`);
      }
    } catch (error) {
      console.error(`Error handling voice message from ${walletAddress}:`, error);
      this.sendError(ws, error.message);
    }
  }

  /**
   * Start a new voice session for a client
   * @param {string} walletAddress - Client's wallet address
   * @param {Object} message - Start session message
   * @param {WebSocket} ws - WebSocket connection
   */
  async startVoiceSession(walletAddress, message, ws) {
    try {
      console.log(`🎤 Starting voice session for ${walletAddress}`);

      // Check if session already exists
      if (geminiLiveService.hasActiveSession(walletAddress)) {
        await geminiLiveService.closeSession(walletAddress);
      }

      // Create new Gemini Live session
      const instructions = message.instructions || this.getDefaultInstructions();
      await geminiLiveService.createSession(walletAddress, instructions);

      // Mark client as active
      const client = this.clients.get(walletAddress);
      if (client) {
        client.isActive = true;
      }

      // Set session timeout
      this.setSessionTimeout(walletAddress);

      // Send confirmation
      this.sendMessage(ws, {
        type: 'session_started',
        timestamp: Date.now()
      });

      console.log(`✅ Voice session started for ${walletAddress}`);
    } catch (error) {
      console.error(`Failed to start voice session for ${walletAddress}:`, error);
      this.sendError(ws, `Failed to start session: ${error.message}`);
    }
  }

  /**
   * Process audio chunk from client
   * @param {string} walletAddress - Client's wallet address
   * @param {Object} message - Audio chunk message
   * @param {WebSocket} ws - WebSocket connection
   */
  async processAudioChunk(walletAddress, message, ws) {
    try {
      if (!geminiLiveService.hasActiveSession(walletAddress)) {
        this.sendError(ws, 'No active session. Start a session first.');
        return;
      }

      // Send thinking indicator
      this.sendMessage(ws, {
        type: 'thinking',
        timestamp: Date.now()
      });

      // Process audio with Gemini
      await geminiLiveService.sendAudioChunk(
        walletAddress, 
        message.audio, 
        message.mimeType || 'audio/webm;codecs=opus'
      );

      console.log(`🎵 Audio chunk processed for ${walletAddress}`);
    } catch (error) {
      console.error(`Failed to process audio chunk for ${walletAddress}:`, error);
      this.sendError(ws, `Failed to process audio: ${error.message}`);
    }
  }

  /**
   * End voice session for a client
   * @param {string} walletAddress - Client's wallet address
   * @param {WebSocket} ws - WebSocket connection
   */
  async endVoiceSession(walletAddress, ws) {
    try {
      console.log(`🔚 Ending voice session for ${walletAddress}`);

      // Close Gemini session
      await geminiLiveService.closeSession(walletAddress);

      // Clear session timeout
      this.clearSessionTimeout(walletAddress);

      // Mark client as inactive
      const client = this.clients.get(walletAddress);
      if (client) {
        client.isActive = false;
      }

      // Send confirmation
      this.sendMessage(ws, {
        type: 'session_ended',
        timestamp: Date.now()
      });

      console.log(`✅ Voice session ended for ${walletAddress}`);
    } catch (error) {
      console.error(`Failed to end voice session for ${walletAddress}:`, error);
      this.sendError(ws, `Failed to end session: ${error.message}`);
    }
  }

  /**
   * Handle client disconnect
   * @param {string} walletAddress - Client's wallet address
   */
  async handleClientDisconnect(walletAddress) {
    try {
      // Clean up Gemini session
      if (geminiLiveService.hasActiveSession(walletAddress)) {
        await geminiLiveService.closeSession(walletAddress);
      }

      // Clear session timeout
      this.clearSessionTimeout(walletAddress);

      // Remove client
      this.clients.delete(walletAddress);

      console.log(`🧹 Cleaned up resources for ${walletAddress}`);
    } catch (error) {
      console.error(`Error cleaning up for ${walletAddress}:`, error);
    }
  }

  /**
   * Set session timeout for a client
   * @param {string} walletAddress - Client's wallet address
   */
  setSessionTimeout(walletAddress) {
    this.clearSessionTimeout(walletAddress); // Clear existing timeout

    const timeout = setTimeout(async () => {
      console.log(`⏰ Session timeout for ${walletAddress}`);
      
      const client = this.clients.get(walletAddress);
      if (client && client.isActive) {
        await this.endVoiceSession(walletAddress, client.ws);
        this.sendMessage(client.ws, {
          type: 'session_timeout',
          message: 'Session ended due to timeout',
          timestamp: Date.now()
        });
      }
    }, this.maxSessionDuration);

    this.sessionTimeouts.set(walletAddress, timeout);
  }

  /**
   * Clear session timeout for a client
   * @param {string} walletAddress - Client's wallet address
   */
  clearSessionTimeout(walletAddress) {
    const timeout = this.sessionTimeouts.get(walletAddress);
    if (timeout) {
      clearTimeout(timeout);
      this.sessionTimeouts.delete(walletAddress);
    }
  }

  /**
   * Send message to a specific client
   * @param {string} walletAddress - Client's wallet address
   * @param {Object} message - Message to send
   */
  sendToClient(walletAddress, message) {
    const client = this.clients.get(walletAddress);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      this.sendMessage(client.ws, message);
    }
  }

  /**
   * Send message to WebSocket connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {Object} message - Message to send
   */
  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message to WebSocket connection
   * @param {WebSocket} ws - WebSocket connection
   * @param {string} error - Error message
   */
  sendError(ws, error) {
    this.sendMessage(ws, {
      type: 'error',
      error,
      timestamp: Date.now()
    });
  }

  /**
   * Extract wallet address from WebSocket request URL
   * @param {string} url - Request URL
   * @returns {string|null} Wallet address or null
   */
  extractWalletAddress(url) {
    try {
      const urlObj = new URL(url, 'http://localhost');
      return urlObj.searchParams.get('wallet');
    } catch (error) {
      console.error('Error extracting wallet address:', error);
      return null;
    }
  }

  /**
   * Get default system instructions for SENTINEL
   * @returns {string} Default instructions
   */
  getDefaultInstructions() {
    return `You are SENTINEL, an AI-powered crypto intelligence assistant. You have access to real-time token data, security analysis, and social sentiment tools.

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

Respond naturally in voice conversations. Be helpful, accurate, and engaging. Keep responses brief and to the point for voice interaction.`;
  }

  /**
   * Get server statistics
   * @returns {Object} Server statistics
   */
  getStats() {
    const activeClients = Array.from(this.clients.entries())
      .filter(([_, client]) => client.isActive)
      .length;

    return {
      totalConnections: this.clients.size,
      activeVoiceSessions: activeClients,
      geminiSessions: geminiLiveService.getStats(),
      uptime: process.uptime()
    };
  }

  /**
   * Shutdown the voice streaming server
   */
  async shutdown() {
    console.log('🔄 Shutting down voice streaming server...');

    // Close all client connections
    for (const [walletAddress, client] of this.clients.entries()) {
      try {
        if (client.isActive) {
          await this.endVoiceSession(walletAddress, client.ws);
        }
        client.ws.close(1001, 'Server shutdown');
      } catch (error) {
        console.error(`Error closing connection for ${walletAddress}:`, error);
      }
    }

    // Clear all timeouts
    for (const timeout of this.sessionTimeouts.values()) {
      clearTimeout(timeout);
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
    }

    console.log('✅ Voice streaming server shutdown complete');
  }
}

// Export singleton instance
export const voiceStreamingServer = new VoiceStreamingServer();
