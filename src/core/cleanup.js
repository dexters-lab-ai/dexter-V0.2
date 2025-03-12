import { EventEmitter } from 'events';

class CleanupManager extends EventEmitter {
  constructor() {
    super();
    this.services = new Map();
    this.setupProcessHandlers();
  }

  registerService(name, cleanupFn) {
    this.services.set(name, cleanupFn);
  }

  setupProcessHandlers() {
    // Increase max listeners to prevent warnings.
    process.setMaxListeners(20);

    // Single handler for SIGINT
    process.once('SIGINT', async () => {
      console.log('\n🛑 SIGINT received. Cleaning up...');
      await this.cleanupAll();
      // Do not exit the process—allow it to continue running.
      // process.exit(0);
    });

    // Single handler for SIGTERM
    process.once('SIGTERM', async () => {
      console.log('\n🛑 SIGTERM received. Cleaning up...');
      await this.cleanupAll();
      // Do not exit the process—allow it to continue running.
      // process.exit(0);
    });
  }

  async cleanupAll() {
    console.log('🧹 Starting cleanup...');
    for (const [name, cleanup] of this.services) {
      try {
        await cleanup();
        console.log(`✅ Cleaned up ${name}`);
      } catch (error) {
        console.error(`❌ Error cleaning up ${name}:`, error);
      }
    }
    console.log('✅ All services cleaned up');
  }
}

export const cleanupManager = new CleanupManager();
