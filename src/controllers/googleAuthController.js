import { google } from 'googleapis';
import { User } from '../models/User.js';
import { config } from '../core/config.js';

// Client credentials from config remain unchanged.
const CLIENT_ID = config.googleClientID;
const CLIENT_SECRET = config.googleClientSecret;

// Define your desired callback path.
const CALLBACK_PATH = '/api/google/callback';

// Scopes for Gmail and Calendar
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar'
];

/**
 * Dynamically creates an OAuth2 client with the current base URL.
 * Uses global.ngrokUrl if available, or falls back to config.googleClientRedirect.
 */
function createOAuth2Client() {
  // Use environment variables for URLs
  const baseUrl = process.env.BASE_URL || process.env.GOOGLE_CLIENT_REDIRECT || 
                  `${process.env.NODE_ENV === 'production' ? 'https' : 'http'}://${process.env.HOST || 'localhost'}:${process.env.PORT || 3000}`;
  // Append the callback path.
  const redirectUri = baseUrl + CALLBACK_PATH;
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, redirectUri);
}

/**
 * Initiate Google OAuth2: redirect to Google consent screen.
 */
export function initiateGoogleAuth(req, res) {
  console.log("Initiate OAuth called with query:", req.query);
  const { telegramId } = req.query;
  if (!telegramId) {
    return res.status(400).send("Missing telegramId");
  }
  const oAuth2Client = createOAuth2Client();
  const state = encodeURIComponent(telegramId);
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    state,
    prompt: 'consent' // Force re-consent to get a refresh token
  });
  console.log("Redirecting to:", url);
  res.redirect(url);
}

/**
 * Handle OAuth callback: exchange code for tokens and store them.
 */
export async function handleGoogleCallback(req, res) {
  console.log("Callback called with query:", req.query);
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
