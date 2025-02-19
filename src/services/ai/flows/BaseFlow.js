import { EventEmitter } from 'events';
import { ErrorHandler } from '../../../core/errors/index.js';

export class BaseFlow extends EventEmitter {
  constructor() {
    super();
    if (new.target === BaseFlow) {
      throw new Error('BaseFlow is abstract');
    }
  }

  async start(initialData) {
    try {
      this.emit('flowStarted', { initialData });
      return {
        currentStep: 0,
        data: initialData,
        response: 'Flow started'
      };
    } catch (error) {
      return this.handleError(error, 'start');
    }
  }

  async processStep(state, input) {
    try {
      await this.validateState(state);
      await this.validateInput(input);
      
      const result = await this._processStep(state, input);
      
      this.emit('stepCompleted', {
        step: state.currentStep,
        result
      });
      
      return result;
    } catch (error) {
      return this.handleError(error, 'processStep', state);
    }
  }

  async validate(input) {
    try {
      if (!input) {
        throw new Error('Input is required');
      }
      return true;
    } catch (error) {
      return this.handleError(error, 'validate');
    }
  }

  async complete(state) {
    try {
      this.emit('flowCompleted', { state });
      return {
        completed: true,
        data: state,
        response: 'Flow completed successfully'
      };
    } catch (error) {
      return this.handleError(error, 'complete', state);
    }
  }

  async cancel(state) {
    try {
      this.emit('flowCancelled', { state });
      return {
        completed: true,
        cancelled: true,
        response: 'Flow cancelled'
      };
    } catch (error) {
      return this.handleError(error, 'cancel', state);
    }
  }

  // Centralized error handling
  async handleError(error, operation, state = null) {
    try {
      // Log error with context
      console.error(`Error in ${this.constructor.name}.${operation}:`, error);

      // Handle error through central system
      await ErrorHandler.handle(error);

      // Clean up resources if needed
      if (state) {
        await this.cleanup(state);
      }

      // Emit error event with context
      this.emit('flowError', {
        error,
        operation,
        state,
        timestamp: Date.now()
      });

      // Return error response
      return {
        completed: true,
        error: true,
        response: `An error occurred during ${operation}: ${error.message}`
      };
    } catch (additionalError) {
      // Handle error in error handler
      console.error('Error in error handler:', additionalError);
      return {
        completed: true,
        error: true,
        response: 'A critical error occurred'
      };
    }
  }

  // Helper methods
  async validateState(state) {
    if (!state || typeof state.currentStep !== 'number') {
      throw new Error('Invalid flow state');
    }
  }

  async validateInput(input) {
    if (!input && input !== 0) {
      throw new Error('Input is required');
    }
  }

  async cleanup(state) {
    try {
      // Clean up any resources
      this.emit('cleanup', { state });
    } catch (error) {
      console.error('Error during cleanup:', error);
    }
  }

  // Protected method for child classes to implement
  async _processStep(state, input) {
    throw new Error('_processStep must be implemented by child class');
  }
}