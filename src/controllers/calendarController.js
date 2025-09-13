const calendarService = require('../services/calendarService');

class CalendarController {
  initiateAuth(req, res) {
    const authUrl = calendarService.getAuthUrl();
    res.redirect(authUrl);
  }

  async handleCallback(req, res) {
    try {
      const { code } = req.query;
      const tokens = await calendarService.setCredentials(code);
      
      res.json({
        message: 'Calendar authorization successful',
        refreshToken: tokens.refresh_token
      });
    } catch (error) {
      console.error('Calendar auth error:', error);
      res.status(500).json({ error: 'Authorization failed' });
    }
  }

  async checkAvailability(req, res) {
    try {
      const { dateTime } = req.query;
      const isAvailable = await calendarService.checkAvailability(new Date(dateTime));
      
      res.json({ available: isAvailable });
    } catch (error) {
      console.error('Error checking availability:', error);
      res.status(500).json({ error: 'Failed to check availability' });
    }
  }

  async createEvent(req, res) {
    try {
      const { title, startDateTime, endDateTime, description, attendees } = req.body;
      
      const event = await calendarService.createEvent(
        title,
        startDateTime,
        endDateTime,
        description,
        attendees
      );
      
      res.json({ event });
    } catch (error) {
      console.error('Error creating event:', error);
      res.status(500).json({ error: 'Failed to create event' });
    }
  }
}

module.exports = new CalendarController();