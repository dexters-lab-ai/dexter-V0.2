import { messageProcessor } from './processors/UnifiedMessageProcessor.js';
import { contextManager } from './ContextManager.js';
import { aiMetricsService } from '../aiMetricsService.js';
import { ErrorHandler } from '../../core/errors/index.js';
import { circuitBreakers } from '../../core/circuit-breaker/index.js';
import { BREAKER_CONFIGS } from '../../core/circuit-breaker/index.js';

class AIService {
  constructor() {
    this.processor = messageProcessor;
    this.contextManager = contextManager;
    this.metrics = aiMetricsService;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      await this.metrics.initialize();
      await this.contextManager.initialize();
      this.initialized = true;
      console.log('✅ AI Service initialized');
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async processCommand(text, providedIntent, userId, context = []) {
    return circuitBreakers.executeWithBreaker(
      'openai',
      async () => {
        try {
          // Validate input
          if (!text?.trim()) {
            return {
              text: "I need some input to work with! What can I help you with?",
              type: 'chat'
            };
          }

          // Format context properly
          const safeContext = Array.isArray(context) ? context : [];
          const conversationContext = safeContext.map(msg => ({
            role: msg.role || 'user',
            content: typeof msg.content === 'string' ? msg.content : String(msg.content)
          }));

          // Process through unified processor
          const result = await this.processor.processMessage({
            text,
            intent: providedIntent,
            userId,
            context: conversationContext
          });

          // Update context with new interaction
          await this.contextManager.updateContext(userId, text, result.text);

          return result;
        } catch (error) {
          await ErrorHandler.handle(error);
          return {
            text: "I encountered an error processing your request. Please try again or use the menu options.",
            type: 'error'
          };
        }
      },
      BREAKER_CONFIGS.openai
    );
  }

  cleanup() {
    this.processor.cleanup();
    this.contextManager.cleanup();
    this.initialized = false;
  }
}

export const aiService = new AIService();