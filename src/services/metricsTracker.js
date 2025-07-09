class MetricsTracker {
    constructor() {
      this.metrics = {
        openai: {
          totalTokens: 0,
          totalCost: 0,
          rateLimitHits: 0,
          responseTimes: [],
          modelUsage: new Map()
        },
        messages: {
          total: 0,
          text: 0,
          audio: 0,
          responseTimes: []
        },
        functions: new Map(),
        users: new Map()
      };
    }
  
    trackTokenUsage(model, tokens, cost) {
      this.metrics.openai.totalTokens += tokens;
      this.metrics.openai.totalCost += cost;
      
      const modelStats = this.metrics.openai.modelUsage.get(model) || {
        uses: 0,
        tokens: 0,
        cost: 0
      };
      modelStats.uses++;
      modelStats.tokens += tokens;
      modelStats.cost += cost;
      this.metrics.openai.modelUsage.set(model, modelStats);
    }
  
    trackResponseTime(startTime, type = 'text') {
      const duration = Date.now() - startTime;
      this.metrics.messages[type]++;
      this.metrics.messages.total++;
      this.metrics.messages.responseTimes.push(duration);
    }
  
    trackFunctionCall(name, success) {
      const stats = this.metrics.functions.get(name) || {
        calls: 0,
        successes: 0,
        failures: 0
      };
      stats.calls++;
      if (success) stats.successes++;
      else stats.failures++;
      this.metrics.functions.set(name, stats);
    }
  
    trackUserActivity(userId) {
      this.metrics.users.set(userId, {
        lastActive: new Date(),
        interactions: (this.metrics.users.get(userId)?.interactions || 0) + 1
      });
    }
  }
  
  export const metricsTracker = new MetricsTracker();
  