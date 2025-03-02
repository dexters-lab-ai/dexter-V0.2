import express from 'express';
import {
  initiateGoogleAuth,
  handleGoogleCallback
} from '../controllers/googleAuthController.js';

import {
  sendEmail,
  searchEmails,
  readEmail,
  replyEmail
} from '../controllers/gmailController.js';

import {
  manageCalendarEvent,
  listCalendarEvents
} from '../controllers/calendarController.js';

const router = express.Router();

// ✅ OAuth2 Flow
router.get('/google/auth', initiateGoogleAuth);       // 1) Starts Google OAuth2 flow
router.get('/google/callback', handleGoogleCallback); // 2) Callback URL from Google

// ✅ Gmail API Endpoints
router.post('/gmail/send', sendEmail);
router.post('/gmail/search', searchEmails);
router.post('/gmail/read', readEmail);
router.post('/gmail/reply', replyEmail);

// ✅ Google Calendar API Endpoints
router.post('/calendar/manage', manageCalendarEvent);
router.post('/calendar/list', listCalendarEvents);

export default router;
