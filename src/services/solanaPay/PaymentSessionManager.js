import { EventEmitter } from 'events';
import { PaymentStatus } from './SolanaPayService.js';

export class PaymentSessionManager extends EventEmitter {
  constructor() {
    super();
    this.sessions = new Map();
  }

  async initialize() {
    // Nothing to initialize
    return true;
  }

  async create(data) {
    const sessionId = this.generateSessionId();
    const session = {
      id: sessionId,
      status: PaymentStatus.INITIALIZED,
      createdAt: new Date(),
      ...data
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  async getStatus(sessionId) {
    const session = this.sessions.get(sessionId);
    return session?.status || null;
  }

  async updateStatus(sessionId, status) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      this.sessions.set(sessionId, session);
      this.emit('statusUpdate', { sessionId, status });
    }
  }

  generateSessionId() {
    return `pay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  cleanup() {
    this.sessions.clear();
    this.removeAllListeners();
  }
}