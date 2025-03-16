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

// OAuth2 Flow
router.get('/auth', initiateGoogleAuth);       // Correct: full path becomes /api/google/auth
router.get('/callback', handleGoogleCallback);   // Correct: full path becomes /api/google/callback

// Gmail API Endpoints
router.post('/gmail/send', sendEmail);
router.post('/gmail/search', searchEmails);
router.post('/gmail/read', readEmail);
router.post('/gmail/reply', replyEmail);

// Google Calendar API Endpoints
router.post('/calendar/manage', manageCalendarEvent);
router.post('/calendar/list', listCalendarEvents);

export default router;
