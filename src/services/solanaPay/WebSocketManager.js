import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { VoiceStreamingServer } from '../voice/VoiceStreamingServer.js';

export class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.clients = new Map();
    this.voiceServer = null;
  }

  async initialize(httpServer = null) {
    try {
      // Initialize Solana Pay WebSocket server using HTTP server if provided
      if (httpServer) {
        // Use HTTP server for WebSocket connections to avoid port conflicts
        this.wss = new WebSocket.Server({ 
          server: httpServer,
          path: '/solana-pay-ws'
        });
        console.log('✅ Solana Pay WebSocket server initialized on HTTP server');
      } else {
        // Fallback to separate port if no HTTP server provided
        const wsPort = process.env.SOLANA_PAY_WS_PORT || 8081;
        this.wss = new WebSocket.Server({ port: wsPort });
        console.log(`✅ Solana Pay WebSocket server initialized on port ${wsPort}`);
      }

      this.wss.on('connection', (ws, req) => {
        const sessionId = this.extractSessionId(req.url);
        if (sessionId) {
          this.clients.set(sessionId, ws);
          console.log(`🔗 Solana Pay client connected: ${sessionId}`);
          
          ws.on('close', () => {
            this.clients.delete(sessionId);
            console.log(`🔌 Solana Pay client disconnected: ${sessionId}`);
          });
        }
      });

      // Initialize Voice Streaming server if HTTP server provided
      if (httpServer) {
        this.voiceServer = new VoiceStreamingServer(httpServer);
        await this.voiceServer.initialize();
        console.log('🎤 Voice streaming server initialized with WebSocket manager');
      }

      return true;
    } catch (error) {
      console.error('Failed to initialize WebSocket services:', error);
      throw error;
    }
  }

  /**
   * Get voice streaming server instance
   * @returns {VoiceStreamingServer|null} Voice server instance
   */
  getVoiceServer() {
    return this.voiceServer;
  }

  /**
   * Shutdown all WebSocket services
   */
  async shutdown() {
    if (this.voiceServer) {
      await this.voiceServer.shutdown();
    }
    
    if (this.wss) {
      this.wss.close();
    }
  }

  notifyClient(sessionId, message) {
    const client = this.clients.get(sessionId);
    if (client) {
      client.send(JSON.stringify(message));
    }
  }

  extractSessionId(url) {
    const match = url.match(/session=([^&]*)/);
    return match ? match[1] : null;
  }

  cleanup() {
    if (this.wss) {
      this.wss.close();
    }
    this.clients.clear();
    this.removeAllListeners();
  }
}