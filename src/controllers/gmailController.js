import { google } from 'googleapis';
import { getAuthorizedClient } from '../services/google/googleAPIService.js';
import { User } from '../models/User.js';

/**
 * 1) Send an email
 */
export async function sendEmail(req, res) {
  try {
    const { telegramId, to, subject, text, html } = req.body;
    const oAuth2Client = await getAuthorizedClient(telegramId);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // Gmail requires the raw message in base64-encoded RFC 2822 format
    // We'll do a simple approach:
    const messageParts = [
      `To: ${to}`,
      `Subject: ${subject}`,
      `Content-Type: text/${html ? 'html' : 'plain'}; charset=utf-8`,
      ``,
      html || text
    ];
    const message = messageParts.join('\n');

    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage
      }
    });

    res.json({ success: true, message: 'Email sent' });
  } catch (error) {
    console.error("Error sending email:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * 2) Search emails by query or label
 */
export async function searchEmails(req, res) {
  try {
    const { telegramId, query = '', maxResults = 10 } = req.body;
    const oAuth2Client = await getAuthorizedClient(telegramId);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });
    const response = await gmail.users.messages.list({
      userId: 'me',
      q: query,        // e.g. "label:unread from:someone@example.com"
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
 * 3) Read a specific email
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

    const message = response.data;
    // Optionally store the thread info in user's doc for future reference
    const user = await User.findOne({ telegramId });
    if (user && message.threadId) {
      await user.addEmailThread(message.threadId, message.snippet, /*subject*/'', message.historyId);
    }

    res.json({ success: true, message });
  } catch (error) {
    console.error("Error reading email:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * 4) Reply to an email in a thread
 */
export async function replyEmail(req, res) {
  try {
    const { telegramId, threadId, messageId, body } = req.body;
    const oAuth2Client = await getAuthorizedClient(telegramId);

    const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

    // First, get the original message to gather 'References' and 'In-Reply-To'
    const original = await gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'metadata'
    });

    const headers = original.data.payload?.headers || [];
    const subjectHeader = headers.find(h => h.name.toLowerCase() === 'subject');
    const fromHeader = headers.find(h => h.name.toLowerCase() === 'from');
    const toHeader = headers.find(h => h.name.toLowerCase() === 'to');
    const referencesHeader = headers.find(h => h.name.toLowerCase() === 'references');
    const inReplyToHeader = headers.find(h => h.name.toLowerCase() === 'in-reply-to');

    const subject = subjectHeader ? subjectHeader.value : "No Subject";
    const references = referencesHeader ? referencesHeader.value : "";
    const inReplyTo = inReplyToHeader ? inReplyToHeader.value : `<${messageId}@mail.gmail.com>`;

    // Construct reply
    const messageParts = [
      `Subject: Re: ${subject}`,
      `To: ${fromHeader ? fromHeader.value : ''}`, // or you can do to the original "From"
      `References: ${references} <${messageId}@mail.gmail.com>`,
      `In-Reply-To: ${inReplyTo}`,
      `Thread-Topic: ${subject}`,
      ``,
      body
    ];
    const rawMessage = messageParts.join('\n');
    const encodedMessage = Buffer.from(rawMessage)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

    // Send
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
        threadId
      }
    });

    // If desired, update local stored thread snippet
    const user = await User.findOne({ telegramId });
    if (user) {
      await user.addEmailThread(threadId, `Replied: ${body.slice(0,40)}...`, subject, original.data.historyId);
    }

    res.json({ success: true, message: 'Reply sent' });
  } catch (error) {
    console.error("Error replying to email:", error);
    res.status(500).json({ error: error.message });
  }
}
