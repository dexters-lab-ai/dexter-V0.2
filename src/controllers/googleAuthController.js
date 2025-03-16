import { google } from 'googleapis';
import { User } from '../models/User.js';
import { config } from '../core/config.js';

const CLIENT_ID = config.googleClientID;
const CLIENT_SECRET = config.googleClientSecret;
const REDIRECT_URI = config.googleClientRedirect; // "https://dail.ngrok.com/api/google/callback"

// Scopes for Gmail and Calendar
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar'
];

function createOAuth2Client() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);
}

/**
 * Initiate Google OAuth2: redirect to Google consent screen.
 */
export function initiateGoogleAuth(req, res) {
  const { telegramId } = req.query;
  if (!telegramId) {
    return res.status(400).send("Missing telegramId");
  }
  const oAuth2Client = createOAuth2Client();
  const state = encodeURIComponent(telegramId);
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state
  });
  res.redirect(url);
}

/**
 * Handle OAuth callback: exchange code for tokens and store them.
 */
export async function handleGoogleCallback(req, res) {
  const code = req.query.code;
  const state = req.query.state;
  if (!code) {
    return res.status(400).send("No code in query");
  }
  const telegramId = decodeURIComponent(state);
  try {
    const oAuth2Client = createOAuth2Client();
    const { tokens } = await oAuth2Client.getToken(code);
    let user = await User.findOne({ telegramId });
    if (!user) {
      user = new User({ telegramId });
    }
    await user.setGoogleTokens(tokens);
    res.send("Google OAuth Success! You may close this window.");
  } catch (err) {
    console.error("Error exchanging code:", err);
    res.status(500).send("Authentication failed");
  }
}
