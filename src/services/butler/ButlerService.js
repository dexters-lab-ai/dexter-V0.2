import { google } from 'googleapis';
import { ErrorHandler } from '../../core/errors/index.js';
import { User } from '../../models/User.js';
import { EventEmitter } from 'events';

class ButlerService extends EventEmitter {
  constructor() {
    super();
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    this.initialized = false;
    this.activeMonitors = new Map();
  }

  async initialize() {
    if (this.initialized) return;
    try {
      // Initialize Google APIs
      this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
      
      this.initialized = true;
      console.log('✅ Butler Service initialized');
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async setReminder(userId, text) {
    try {
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user?.googleAuth?.accessToken) {
        throw new Error('Google account not connected. Please connect in Settings.');
      }

      this.oauth2Client.setCredentials({
        access_token: user.googleAuth.accessToken,
        refresh_token: user.googleAuth.refreshToken
      });

      // Parse reminder text for date/time
      const event = {
        summary: text,
        start: { dateTime: new Date().toISOString() },
        end: { dateTime: new Date(Date.now() + 3600000).toISOString() }
      };

      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        resource: event
      });

      return {
        action: 'reminder_set',
        status: 'success',
        details: `Reminder set for ${new Date(event.start.dateTime).toLocaleString()}`
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async startMonitoring(userId, text) {
    try {
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user?.googleAuth?.accessToken) {
        throw new Error('Google account not connected. Please connect in Settings.');
      }

      this.oauth2Client.setCredentials({
        access_token: user.googleAuth.accessToken,
        refresh_token: user.googleAuth.refreshToken
      });

      // Start monitoring emails/calendar
      const monitorId = `${userId}_${Date.now()}`;
      this.activeMonitors.set(monitorId, {
        userId,
        query: text,
        startTime: Date.now()
      });

      return {
        action: 'monitoring_started',
        status: 'success',
        details: `Started monitoring: ${text}`
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  async generateReport(userId) {
    try {
      const user = await User.findOne({ telegramId: userId.toString() });
      if (!user?.googleAuth?.accessToken) {
        throw new Error('Google account not connected. Please connect in Settings.');
      }

      this.oauth2Client.setCredentials({
        access_token: user.googleAuth.accessToken,
        refresh_token: user.googleAuth.refreshToken
      });

      // Get email stats
      const emailResponse = await this.gmail.users.messages.list({
        userId: 'me',
        maxResults: 10
      });

      // Get calendar events
      const calendarResponse = await this.calendar.events.list({
        calendarId: 'primary',
        timeMin: new Date().toISOString(),
        maxResults: 10,
        singleEvents: true,
        orderBy: 'startTime'
      });

      return {
        action: 'report_generated',
        status: 'success',
        details: {
          emails: emailResponse.data.messages?.length || 0,
          events: calendarResponse.data.items?.length || 0,
          monitors: this.activeMonitors.size
        }
      };
    } catch (error) {
      await ErrorHandler.handle(error);
      throw error;
    }
  }

  cleanup() {
    this.activeMonitors.clear();
    this.removeAllListeners();
    this.initialized = false;
  }
}

export const butlerService = new ButlerService();
