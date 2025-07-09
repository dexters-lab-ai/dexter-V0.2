import fs from "fs";
import path from "path";

// Ensure logs directory exists
const logDir = path.resolve("logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir);
}

// Log file paths
const errorLogPath = path.join(logDir, "cookie_error.log");
const combinedLogPath = path.join(logDir, "cookie_combined.log");

// Function to format log messages with branding
const formatLog = (level, message) => {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [COOKIE.FUN] ${level.toUpperCase()}: ${message}\n`;
};

// Function to write logs to files
const writeLogToFile = (filePath, logMessage) => {
  fs.appendFile(filePath, logMessage, (err) => {
    if (err) console.error("❌ [COOKIE.FUN] Failed to write log:", err);
  });
};

// Logger object with Cookie.fun branding
const logger = {
  info: (message) => {
    const logMessage = formatLog("info", message);
    console.log(`\x1b[32m🍪 [COOKIE.FUN] ${logMessage.trim()}\x1b[0m`); // Green for info
    writeLogToFile(combinedLogPath, logMessage);
  },

  warn: (message) => {
    const logMessage = formatLog("warn", message);
    console.warn(`\x1b[33m⚠️ [COOKIE.FUN] ${logMessage.trim()}\x1b[0m`); // Yellow for warnings
    writeLogToFile(combinedLogPath, logMessage);
  },

  error: (message) => {
    const logMessage = formatLog("error", message);
    console.error(`\x1b[31m❌ [COOKIE.FUN] ${logMessage.trim()}\x1b[0m`); // Red for errors
    writeLogToFile(errorLogPath, logMessage);
    writeLogToFile(combinedLogPath, logMessage);
  },

  debug: (message) => {
    const logMessage = formatLog("debug", message);
    console.log(`\x1b[36m🐾 [COOKIE.FUN] ${logMessage.trim()}\x1b[0m`); // Cyan for debug
    writeLogToFile(combinedLogPath, logMessage);
  },
};

// Export the logger
export default logger;
