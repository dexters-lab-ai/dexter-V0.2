import { EventEmitter } from 'events';

export class ReferenceTracker extends EventEmitter {
  constructor() {
    super();
    this.references = new Set();
  }

  async initialize() {
    return true;
  }

  async track(reference) {
    this.references.add(reference);
  }

  async untrack(reference) {
    this.references.delete(reference);
  }

  isTracked(reference) {
    return this.references.has(reference);
  }

  cleanup() {
    this.references.clear();
    this.removeAllListeners();
  }
}