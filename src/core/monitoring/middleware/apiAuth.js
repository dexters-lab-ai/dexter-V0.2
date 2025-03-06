import { validateApiKey as validateKey, trackApiUsage as trackUsage } from '../Dashboard.js';

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

export async function trackApiUsage(apiKey, endpoint) {
  await trackUsage(apiKey, endpoint);
}