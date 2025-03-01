// routes/googleRoutes.js

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

// OAuth endpoints
router.get('/google/auth', initiateGoogleAuth);      // 1) /api/google/auth?telegramId=1234
router.get('/google/callback', handleGoogleCallback); // 2) callback from Google

// Gmail endpoints
router.post('/gmail/send', sendEmail);
router.post('/gmail/search', searchEmails);
router.post('/gmail/read', readEmail);
router.post('/gmail/reply', replyEmail);

// Calendar endpoints
router.post('/calendar/manage', manageCalendarEvent);
router.post('/calendar/list', listCalendarEvents);

export default router;
