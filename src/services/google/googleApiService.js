// services/googleApiService.js
import { google } from 'googleapis';
import { User } from '../../models/User.js';
import { decrypt } from '../../utils/encryption.js';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;

function createOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

/**
 * Returns an authorized OAuth2 client for the user by decrypting their tokens.
 */
export async function getAuthorizedClient(telegramId) {
  const user = await User.findOne({ telegramId });
  if (!user) throw new Error(`User not found for telegramId=${telegramId}`);

  const tokens = user.getDecryptedGoogleTokens();
  if (!tokens.refresh_token) {
    throw new Error("User has not completed OAuth or has no refresh token.");
  }

  const oAuth2Client = createOAuth2Client();
  oAuth2Client.setCredentials(tokens);

  // Attempt to refresh if needed
  oAuth2Client.on('tokens', async (newTokens) => {
    // If we get new tokens, update user doc
    if (newTokens.refresh_token) {
      tokens.refresh_token = newTokens.refresh_token;
    }
    if (newTokens.access_token) {
      tokens.access_token = newTokens.access_token;
    }
    if (newTokens.expiry_date) {
      tokens.expiry_date = newTokens.expiry_date;
    }
    await user.setGoogleTokens(tokens);
  });

  return oAuth2Client;
}
