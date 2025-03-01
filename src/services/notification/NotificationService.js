import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../../core/config.js';

class NotificationService {
  constructor() {
    this.oauth2Client = new OAuth2Client(
      config.googleClientID,
      config.googleClientSecret,
      config.googleClientRedirect
    );
    this.oauth2Client.setCredentials({
      refresh_token: config.googleRefreshToken,
    });
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  async sendEmail(to, subject, text) {
    try {
      const message = [
        `To: ${to}`,
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        `Subject: ${subject}`,
        '',
        text,
      ].join('\n');

      const encodedMessage = Buffer.from(message)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });
      console.log(`Email sent to ${to}`);
    } catch (error) {
      console.error(`Failed to send email to ${to}:`, error);
      throw error;
    }
  }
}

export const notificationService = new NotificationService();
