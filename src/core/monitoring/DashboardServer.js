import express from 'express';
import dashboardRouter from './Dashboard.js';

class DashboardServer {
  constructor() {
    this.app = express();
    this.server = null;
    this.port = 4000;
  }

  async start() {
    try {
      this.server = this.app.listen(this.port, () => {
        console.log(`📊 Monitoring Dashboard running at: http://localhost:${this.port}`);
      });

      // Setup routes
      this.app.use('/', dashboardRouter);

      return this.server;
    } catch (error) {
      console.error('Failed to start dashboard:', error);
      throw error;
    }
  }

  async shutdown() {
    try {
      if (this.server) {
        await new Promise(resolve => this.server.close(resolve));
      }
      console.log('✅ Monitoring Dashboard shut down successfully');
    } catch (error) {
      console.error('Error shutting down dashboard:', error);
    }
  }
}

export default DashboardServer;
