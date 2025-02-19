import { EventEmitter } from 'events';
import WebSocket from 'ws';

export class WebSocketManager extends EventEmitter {
  constructor() {
    super();
    this.wss = null;
    this.clients = new Map();
  }

  async initialize() {
    this.wss = new WebSocket.Server({ 
      port: process.env.SOLANA_PAY_WS_PORT || 8081 
    });

    this.wss.on('connection', (ws, req) => {
      const sessionId = this.extractSessionId(req.url);
      if (sessionId) {
        this.clients.set(sessionId, ws);
        
        ws.on('close', () => {
          this.clients.delete(sessionId);
        });
      }
    });

    return true;
  }

  notifyClient(sessionId, data) {
    const ws = this.clients.get(sessionId);
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
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