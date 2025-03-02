import { google } from 'googleapis';
import { getAuthorizedClient } from '../services/google/googleAPIService.js';
import { User } from '../models/User.js';

/**
 * ✅ Send an email using Gmail API
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
 * ✅ Search for emails using a query or label
 */
export async function searchEmails(req, res) {
  try {
    const { telegramId, query = '', maxResults = 10 } = req.body;
    const oAuth2Client = await getAuthorizedClient(telegramId);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query, // Example: "label:unread from:someone@example.com"
      maxResults
    });

    const messages = response.data.messages || [];
    res.json({ success: true, messages });
  } catch (error) {
    console.error("Error searching emails:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * ✅ Read an email by message ID
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
 * ✅ Reply to an email in a thread
 */
export async function replyEmail(req, res) {
  try {
    const { telegramId, threadId, messageId, body } = req.body;
    const oAuth2Client = await getAuthorizedClient(telegramId);
    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Get the original email details
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
