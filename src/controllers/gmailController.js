import { google } from 'googleapis';
import { getAuthorizedClient } from '../services/google/googleAPIservice.js';
import { User } from '../models/User.js';

export async function manageUserGoogleSettings(req, res) {
  
  // Determine the base URL dynamically
  const baseUrl = global.ngrokUrl || process.env.BASE_URL || 'http://localhost:80';
  
  const { telegramId, action } = req.body;
  if (!telegramId) {
    return res.status(400).json({ error: 'Missing telegramId' });
  }
  try {
    const user = await User.findOne({ telegramId });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    switch (action) {
      case 'create': {
        // Return an absolute URL for initiating OAuth flow
        const oauthUrl = `${baseUrl}/api/google/auth?telegramId=${encodeURIComponent(telegramId)}`;
        return res.json({ message: 'Please re-link your Google account via OAuth.', oauthUrl });
      }
      case 'update': {
        // Force re-authorization using the absolute URL
        const updateUrl = `${baseUrl}/api/google/auth?telegramId=${encodeURIComponent(telegramId)}`;
        return res.json({ message: 'To update your Google settings, please re-authorize your account.', oauthUrl: updateUrl });
      }
      case 'delete': {
        // Unlink Google account by clearing stored tokens.
        user.googleAuth = {
          encryptedAccessToken: "",
          encryptedRefreshToken: "",
          scope: "",
          tokenType: "",
          expiryDate: null
        };
        await user.save();
        return res.json({ message: 'Google account unlinked successfully.' });
      }
      default:
        return res.status(400).json({ error: 'Invalid action provided.' });
    }
  } catch (error) {
    console.error('Error managing Google settings:', error);
    return res.status(500).json({ error: error.message });
  }
}

/**
 * Send an email using Gmail API.
 */
export async function sendEmail(req, res) {
  try {
    const { telegramId, to, subject, text, html } = req.body;
    const oAuth2Client = await getAuthorizedClient(telegramId);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
     // RFC 2822 formatted raw message (Base64-encoded)
    const messageParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/${html ? 'html' : 'plain'}; charset=utf-8`,
      ``,
      html || text
    ];
    const encodedMessage = Buffer.from(messageParts.join('\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage }
    });
    res.json({ success: true, message: 'Email sent successfully' });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Search for emails using a query.
 */
export async function searchEmails(req, res) {
  try {
    const { telegramId, query = '', maxResults = 10 } = req.body;
    const oAuth2Client = await getAuthorizedClient(telegramId);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    
    // Get list of messages matching the query.
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: query,
      maxResults
    });
    const messages = listResponse.data.messages || [];
    
    // Helper: Trim text to a maximum length.
    const trimText = (text, maxLen = 100) => {
      return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
    };

    // For each message, fetch full details and extract rich information.
    const richResults = await Promise.all(messages.map(async (msg) => {
      try {
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });
        const fullMessage = messageResponse.data;

        // Extract subject from headers.
        let subject = "";
        if (fullMessage.payload && fullMessage.payload.headers) {
          const subjectHeader = fullMessage.payload.headers.find(header => header.name.toLowerCase() === 'subject');
          if (subjectHeader) subject = subjectHeader.value;
        }
        
        // Use Gmail's snippet and trim it to a maximum of 100 characters.
        let summary = fullMessage.snippet ? trimText(fullMessage.snippet, 100) : "";
        
        // Alternatively, if you want to extract from the HTML part, you can add similar logic
        // as in your readEmail function—but this example uses the snippet.

        return {
          id: fullMessage.id,
          subject,
          summary
        };
      } catch (error) {
        console.error(`Error fetching message ${msg.id}:`, error);
        return { id: msg.id, error: error.message };
      }
    }));

    res.json({ success: true, messages: richResults });
  } catch (error) {
    console.error("Error searching emails:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Read an email by message ID.
 */
export async function readEmail(req, res) {
  try {
    const { telegramId, messageId, format = 'full' } = req.body;
    const oAuth2Client = await getAuthorizedClient(telegramId);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const response = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format
    });
    res.json({ success: true, message: response.data });
  } catch (error) {
    console.error("Error reading email:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Reply to an email in a thread.
 */
export async function replyEmail(req, res) {
  try {
    const { telegramId, threadId, messageId, body } = req.body;
    const oAuth2Client = await getAuthorizedClient(telegramId);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const original = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata'
    });
    const headers = original.data.payload?.headers || [];
    const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || "No Subject";
    const fromHeader = headers.find(h => h.name.toLowerCase() === 'from')?.value || "";
    const messageParts = [
      `To: ${fromHeader}`,
      `Subject: Re: ${subject}`,
      `In-Reply-To: <${messageId}@mail.gmail.com>`,
      ``,
      body
    ];
    const rawMessage = Buffer.from(messageParts.join('\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: rawMessage, threadId }
    });
    res.json({ success: true, message: 'Reply sent successfully' });
  } catch (error) {
    console.error("Error replying to email:", error);
    res.status(500).json({ error: error.message });
  }
}
