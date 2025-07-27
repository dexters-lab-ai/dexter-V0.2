import { EventEmitter } from 'events';
import { solanaPayService } from './SolanaPayService.js';

/**
 * @class SolanaPaySocketHandler
 * Manages WebSocket connections and communication specifically for the Solana Pay service.
 */
export class SolanaPaySocketHandler extends EventEmitter {
  constructor() {
    super();
    this.clients = new Map();
    this.setupServiceListeners();
    console.log('✅ Solana Pay Socket Handler initialized');
  }

  /**
   * Handles a new WebSocket connection intended for Solana Pay.
   * @param {WebSocket} ws - The WebSocket connection object.
   * @param {http.IncomingMessage} req - The initial HTTP request.
   */
  handleConnection(ws, req) {
    const sessionId = this.extractSessionId(req.url);
    if (sessionId) {
      this.clients.set(sessionId, ws);
      console.log(`🔗 Solana Pay client connected: ${sessionId}`);

      ws.on('message', (message) => {
        // Placeholder for handling incoming messages from Solana Pay clients
        console.log(`Received message from Solana Pay client ${sessionId}: ${message}`);
      });

      ws.on('close', () => {
        this.clients.delete(sessionId);
        console.log(`🔌 Solana Pay client disconnected: ${sessionId}`);
      });

      ws.on('error', (error) => {
        console.error(`Error with Solana Pay client ${sessionId}:`, error);
        this.clients.delete(sessionId);
      });

    } else {
      console.warn('Connection attempt to Solana Pay handler without a session ID. Closing connection.');
      ws.close(1008, 'Session ID is required.');
    }
  }

  /**
   * Sends a message to a specific connected client.
   * @param {string} sessionId - The session ID of the client to notify.
   * @param {object} message - The JSON object to send.
   */
  notifyClient(sessionId, message) {
    const client = this.clients.get(sessionId);
    if (client && client.readyState === client.OPEN) {
      client.send(JSON.stringify(message));
    } else {
      console.warn(`Attempted to notify non-existent or closed client: ${sessionId}`);
    }
  }

  /**
   * Extracts the session ID from the connection URL.
   * @param {string} url - The connection URL.
   * @returns {string|null} The extracted session ID.
   */
  extractSessionId(url) {
    const match = url.match(/session=([^&]*)/);
    return match ? match[1] : null;
  }

  /**
   * Listen for events from the SolanaPayService to relay to clients.
   */
  setupServiceListeners() {
    solanaPayService.on('paymentUpdate', ({ sessionId, data }) => {
      const clientWs = this.clients.get(sessionId);
      if (clientWs && clientWs.readyState === clientWs.OPEN) {
        clientWs.send(JSON.stringify(data));
      }
    });
  }

  /**
   * Clean up resources when the handler is no longer needed.
   */
  cleanup() {
    console.log('Cleaning up SolanaPaySocketHandler...');
    solanaPayService.removeAllListeners('paymentUpdate');
    this.clients.forEach((ws) => {
      ws.close();
    });
    this.clients.clear();
  }

  /**
   * Shuts down all active connections and cleans up resources.
   */
  shutdown() {
    console.log('Shutting down Solana Pay Socket Handler...');
    for (const ws of this.clients.values()) {
      ws.close(1001, 'Server is shutting down.');
    }
    this.clients.clear();
    this.removeAllListeners();
    console.log('✅ Solana Pay Socket Handler shut down.');
  }
}
