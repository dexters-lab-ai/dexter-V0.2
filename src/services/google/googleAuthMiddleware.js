//DEPRECATED - not used in the current version of the app
// This middleware checks if the user has a linked Google account and if the refresh token is valid.
// If the refresh token is invalid or expired, it redirects the user to the Google OAuth2 consent screen.
// If the refresh token is valid, it continues to the next middleware.
// If the user does not have a linked Google account, it returns a 401 status code with an error message and a URL to the Google OAuth2 consent screen.

import { User } from "../../models/User.js";

export async function googleAuthMiddleware(req, res, next) {
  const { telegramId } = req.body;
  if (!telegramId) {
    return res.status(400).json({ error: 'Missing telegramId' });
  }
  try {
    const user = await User.findOne({ telegramId });
    if (!user || !user.googleAuth || !user.googleAuth.encryptedRefreshToken) {
      return res.status(401).json({
        error: 'Google account not linked',
        authUrl: `/api/google/auth?telegramId=${encodeURIComponent(telegramId)}`
      });
    }
    next();
  } catch (error) {
    console.error('Error in googleAuthMiddleware:', error);
    return res.status(500).json({ error: 'Authentication middleware error' });
  }
}
