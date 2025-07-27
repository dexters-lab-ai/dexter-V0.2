/**
 * Simple logger utility for SENTINEL API
 */

export const logger = {
  info: (message, ...args) => {
    console.log(`[INFO] ${message}`, ...args);
  },
  
  warn: (message, ...args) => {
    console.warn(`[WARNING] ${message}`, ...args);
  },
  
  error: (message, ...args) => {
    console.error(`[ERROR] ${message}`, ...args);
  },
  
  debug: (message, ...args) => {
    if (process.env.DEBUG) {
      console.log(`[DEBUG] ${message}`, ...args);
    }
  },
  
  trace: (message, ...args) => {
    console.trace(`[TRACE] ${message}`, ...args);
  }
};

export default logger;
