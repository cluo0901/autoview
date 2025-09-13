const express = require('express');
const router = express.Router();
const calendarController = require('../controllers/calendarController');

router.get('/availability', calendarController.checkAvailability);
router.post('/event', calendarController.createEvent);
router.get('/auth', calendarController.initiateAuth);
router.get('/callback', calendarController.handleCallback);

module.exports = router;