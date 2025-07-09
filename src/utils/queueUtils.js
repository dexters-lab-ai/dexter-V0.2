// src/utils/queueUtils.js

/**
 * Generates a standardized job ID for queue jobs
 * Format: {service}:{entityId}:{action}[:timestamp]
 * 
 * @param {string} service - Service name (e.g., 'tasks', 'priceAlerts', 'kolMonitor')
 * @param {string} entityId - ID of the entity (e.g., taskId, alertId)
 * @param {string} action - Action being performed (e.g., 'check', 'execute')
 * @param {boolean} includeTimestamp - Whether to include a timestamp for uniqueness
 * @returns {string} - Standardized job ID
 */
export function generateJobId(service, entityId, action, includeTimestamp = false) {
    const base = `${service}:${entityId}:${action}`;
    return includeTimestamp ? `${base}:${Date.now()}` : base;
  }
  
  /**
   * Parses a standardized job ID into its components
   * 
   * @param {string} jobId - Standardized job ID
   * @returns {Object} - Parsed components { service, entityId, action, timestamp? }
   */
  export function parseJobId(jobId) {
    const parts = jobId.split(':');
    
    if (parts.length < 3) {
      throw new Error(`Invalid job ID format: ${jobId}`);
    }
    
    const result = {
      service: parts[0],
      entityId: parts[1],
      action: parts[2]
    };
    
    if (parts.length > 3) {
      result.timestamp = parseInt(parts[3], 10);
    }
    
    return result;
  }
  
  /**
   * Creates a pattern for matching jobs related to a specific entity
   * 
   * @param {string} service - Service name
   * @param {string} entityId - Entity ID
   * @returns {string} - Pattern for matching jobs
   */
  export function createJobPattern(service, entityId) {
    return `${service}:${entityId}:`;
  }
  