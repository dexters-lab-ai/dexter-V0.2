import WebSocket from 'ws';
import { VoiceStreamingServer } from './voice/VoiceStreamingServer.js';
import { SolanaPaySocketHandler } from './solanaPay/SolanaPaySocketHandler.js';

/**
 * @class WebSocketRouter
 * Manages and routes all incoming WebSocket connections to the appropriate handlers.
 */
export class WebSocketRouter {
  constructor() {
    this.wss = null;
    this.voiceServer = null;
    this.solanaPayHandler = null;
    console.log('✅ WebSocket Router initialized');
  }

  /**
   * Initializes the WebSocket server and all its handlers, attaching to the provided HTTP server.
   * @param {http.Server} httpServer - The main HTTP server instance.
   */
  async initialize(httpServer) {
    if (!httpServer) {
      throw new Error('WebSocketRouter requires an HTTP server to initialize.');
    }

    // Create handlers for different services
    this.solanaPayHandler = new SolanaPaySocketHandler();
    this.voiceServer = new VoiceStreamingServer(httpServer); // Voice server needs the http server for its own setup

    // Create the main WebSocket server, sharing the HTTP server
    this.wss = new WebSocket.Server({ noServer: true });

    // Handle HTTP upgrade requests to route them to the correct service
    httpServer.on('upgrade', (request, socket, head) => {
      const pathname = request.url.split('?')[0];

      if (pathname === '/voice-stream') {
        this.voiceServer.getWss().handleUpgrade(request, socket, head, (ws) => {
          this.voiceServer.getWss().emit('connection', ws, request);
        });
      } else if (pathname === '/solana-pay-ws') {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        console.log(`WebSocket connection rejected for unknown path: ${pathname}`);
        socket.destroy();
      }
    });

    // Set up the connection handler for Solana Pay connections routed here
    this.wss.on('connection', (ws, req) => {
        // This route is now only for non-voice connections, i.e., Solana Pay
        this.solanaPayHandler.handleConnection(ws, req);
    });

    // Initialize the voice server (which sets up its own connection handlers)
    await this.voiceServer.initialize();

    console.log('✅ WebSocket Router is online and routing requests.');
  }

  /**
   * Returns the instance of the Solana Pay handler.
   * @returns {SolanaPaySocketHandler}
   */
  getSolanaPayHandler() {
    return this.solanaPayHandler;
  }

  /**
   * Returns the instance of the voice streaming server.
   * @returns {VoiceStreamingServer}
   */
  getVoiceServer() {
    return this.voiceServer;
  }

  /**
   * Shuts down all WebSocket services and handlers gracefully.
   */
  async shutdown() {
    console.log('Shutting down WebSocket Router...');
    if (this.voiceServer) {
      await this.voiceServer.shutdown();
    }
    if (this.solanaPayHandler) {
      this.solanaPayHandler.shutdown();
    }
    if (this.wss) {
      this.wss.close(() => {
        console.log('Main WebSocket server closed.');
      });
    }
    console.log('✅ WebSocket Router shut down.');
  }
}
