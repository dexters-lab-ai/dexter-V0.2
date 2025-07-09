import { ErrorTypes, BaseError } from './ErrorTypes.js';
import { healthMonitor } from '../health/HealthMonitor.js';

export class ErrorHandler {
  /**
   * Handles errors globally with optional user notification.
   * @param {Error} error - The error to handle.
   * @param {Object|null} bot - (Optional) node-telegram-bot-api instance for user notification.
   * @param {number|null} chatId - (Optional) Chat id to send the error message to.
   * @returns {Promise<Object>} - Details of the handled error.
   */
  static async handle(error, bot = null, chatId = null) {
    console.error('❌ Error occurred:', error);

    // Determine error type and map to a user-friendly message.
    const errorMessages = this._getErrorMessages();
    const message = errorMessages[error.type] || errorMessages['DEFAULT'];

    // Notify the user if bot and chatId are available.
    if (bot && chatId) {
      await this._notifyUser(bot, chatId, message);
    }

    // Log error for monitoring purposes.
    healthMonitor.logError(error);

    // Handle specific error types or critical errors.
    if (error instanceof BaseError && error.isCritical) {
      console.error('🚨 Critical error detected:', error.message);
      await this._handleCriticalError(error);
    } else if (error instanceof AggregateError) {
      console.error('📚 Handling AggregateError with multiple sub-errors');
      for (const subError of error.errors) {
        console.error('Sub-error:', subError);
        await this.handle(subError, bot, chatId); // Recursive handling of sub-errors.
      }
    } else {
      console.warn('Non-critical error handled:', error.message);
    }

    return { message: error.message, stack: error.stack };
  }

  /**
   * Returns a mapping of error types to user-friendly messages.
   * @returns {Object} A mapping of error types to messages.
   */
  static _getErrorMessages() {
    return {
      [ErrorTypes.RATE_LIMIT]: '⚠️ You are sending too many requests. Please wait a moment.',
      [ErrorTypes.NETWORK]: '❌ Network error. Please check your connection.',
      [ErrorTypes.DATABASE]: '❌ Service temporarily unavailable.',
      [ErrorTypes.VALIDATION]: '❌ Invalid input. Please check your data.',
      [ErrorTypes.AUTH]: '❌ Authentication failed. Please try again.',
      [ErrorTypes.WALLET]: '❌ Wallet operation failed. Please check your settings.',
      [ErrorTypes.API]: '❌ External service error. Please try again later.',
      [ErrorTypes.POLLING]: '⚠️ Polling error occurred. Retrying automatically.',
      'DEFAULT': '❌ An unexpected error occurred. Please try again later.',
    };
  }

  /**
   * Notifies the user in the Telegram chat with an error message.
   * @param {Object} bot - The node-telegram-bot-api instance.
   * @param {number} chatId - The chat id where the message should be sent.
   * @param {string} message - The error message to send.
   */
  static async _notifyUser(bot, chatId, message) {
    try {
      await bot.sendMessage(chatId, message, {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🔄 Retry', callback_data: 'retry_action' },
              { text: '↩️ Back to Menu', callback_data: 'back_to_menu' }
            ]
          ]
        }
      });
    } catch (notifyError) {
      console.error('Error notifying user:', notifyError);
    }
  }

  /**
   * Handles critical errors by logging and possibly restarting services.
   * @param {BaseError} error - The critical error object.
   */
  static async _handleCriticalError(error) {
    console.error('🔧 Handling critical error:', error);
    healthMonitor.logCriticalError(error);
  }

  /**
   * Initializes global error handlers for uncaught exceptions and unhandled promise rejections.
   */
  static initializeGlobalHandlers() {
    process.on('uncaughtException', async (error) => {
      console.error('❌ Uncaught Exception:', error);
      await ErrorHandler.handle(error);
    });

    process.on('unhandledRejection', async (reason) => {
      console.error('❌ Unhandled Promise Rejection:', reason);
      await ErrorHandler.handle(reason);
    });
  }
}

/**
 * Utility function to safely execute async functions with centralized error handling.
 * @param {Function} fn - The async function to execute.
 * @param {Object|null} bot - (Optional) node-telegram-bot-api instance for error handling.
 * @param {number|null} chatId - (Optional) Chat id to send error notifications.
 * @param {...any} args - Arguments to pass to the function.
 * @returns {Promise<any>} The result of the function or null if an error occurred.
 */
export async function safeExecute(fn, bot = null, chatId = null, ...args) {
  try {
    return await fn(...args);
  } catch (error) {
    await ErrorHandler.handle(error, bot, chatId);
    console.error('Error during execution:', error);
    return null;
  }
}
