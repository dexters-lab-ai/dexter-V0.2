import { validateApiKey as validateKey } from '../Dashboard.js';
import { deterministicEncrypt } from '../../../utils/encryption.js';
import { ApiUsage } from '../api/models/ApiUsage.js';

export async function validateApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }

  const isValid = await validateKey(apiKey);
  if (!isValid) {
    return res.status(403).json({ error: 'Invalid or expired API key' });
  }

  req.apiKey = apiKey;
  next();
}

// Tracks usage after the API call:
export async function trackAndContinue(req, res, next) {
  const startTime = Date.now();

  res.on('finish', async () => {
    const duration = Date.now() - startTime;
    // We hash the API key once here to ensure consistency with the stored value.
    const hashedKey = deterministicEncrypt(req.headers['x-api-key']);
    await trackApiUsage(
      hashedKey,
      req.originalUrl,
      duration,
      res.statusCode,
      Buffer.byteLength(JSON.stringify(res.body || {})) // Estimate dataSize;
    );
  });

  next();
}

/**
 * Records an API usage event.
 *
 * @param {string} hashedKey - The deterministic encrypted API key.
 * @param {string} endpoint - The endpoint that was called.
 * @param {number} responseTime - The duration (in milliseconds) of the API call.
 * @param {number} statusCode - The HTTP status code of the response.
 * @param {number} dataSize - The size (in bytes) of the response data.
 * @param {number} [cost=1] - The cost associated with this API call (default is 1).
 */
export async function trackApiUsage(hashedKey, endpoint, responseTime, statusCode, dataSize, cost = 1) {
  try {
    await ApiUsage.create({
      apiKey: hashedKey,
      endpoint,
      responseTime,
      statusCode,
      dataSize,
      cost
    });
  } catch (error) {
    console.error('Error tracking API usage:', error);
  }
}
