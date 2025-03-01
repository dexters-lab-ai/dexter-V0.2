// controllers/calendarController.js
import { google } from 'googleapis';
import { getAuthorizedClient } from '../services/google/googleAPIService.js';

/**
 * Manage a calendar event: create, update, or delete
 */
export async function manageCalendarEvent(req, res) {
  const { telegramId, action, eventId, title, startTime, endTime, description } = req.body;

  try {
    const oAuth2Client = await getAuthorizedClient(telegramId);
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    switch (action) {
      case 'create': {
        if (!title || !startTime || !endTime) {
          return res.status(400).json({ error: "Missing required fields (title, startTime, endTime)" });
        }

        const event = {
          summary: title,
          start: { dateTime: startTime },
          end: { dateTime: endTime },
          description
        };

        const { data } = await calendar.events.insert({
          calendarId: 'primary',
          requestBody: event
        });
        return res.json({ success: true, event: data });
      }

      case 'update': {
        if (!eventId) {
          return res.status(400).json({ error: "eventId is required for update" });
        }
        // Load existing
        const existing = await calendar.events.get({ calendarId: 'primary', eventId });
        const updatedEvent = {
          ...existing.data,
          summary: title || existing.data.summary,
          description: description || existing.data.description,
          start: { dateTime: startTime || existing.data.start.dateTime },
          end: { dateTime: endTime || existing.data.end.dateTime }
        };
        const { data } = await calendar.events.update({
          calendarId: 'primary',
          eventId,
          requestBody: updatedEvent
        });
        return res.json({ success: true, event: data });
      }

      case 'delete': {
        if (!eventId) {
          return res.status(400).json({ error: "eventId is required for delete" });
        }
        await calendar.events.delete({ calendarId: 'primary', eventId });
        return res.json({ success: true, message: "Event deleted" });
      }

      default:
        return res.status(400).json({ error: "Invalid action. Use create, update, or delete." });
    }
  } catch (error) {
    console.error("Error managing calendar event:", error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * (Optional) Retrieve the user's upcoming events
 */
export async function listCalendarEvents(req, res) {
  const { telegramId, maxResults = 10 } = req.body;
  try {
    const oAuth2Client = await getAuthorizedClient(telegramId);
    const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });

    const now = new Date().toISOString();
    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: now,
      maxResults,
      singleEvents: true,
      orderBy: 'startTime'
    });

    res.json({ success: true, events: data.items });
  } catch (error) {
    console.error("Error listing calendar events:", error);
    res.status(500).json({ error: error.message });
  }
}
