const { google } = require('googleapis');
const moment = require('moment');

class CalendarService {
  constructor() {
    this.oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    if (process.env.GOOGLE_REFRESH_TOKEN) {
      this.oauth2Client.setCredentials({
        refresh_token: process.env.GOOGLE_REFRESH_TOKEN
      });
    }

    this.calendar = google.calendar({ version: 'v3', auth: this.oauth2Client });
  }

  getAuthUrl() {
    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar']
    });
  }

  async setCredentials(code) {
    const { tokens } = await this.oauth2Client.getToken(code);
    this.oauth2Client.setCredentials(tokens);
    return tokens;
  }

  async checkAvailability(startDateTime, bufferMinutes = 30) {
    try {
      // TEST MODE: Simulate calendar conflict at 4pm for testing
      if (process.env.NODE_ENV === 'test' || process.env.CALENDAR_TEST_MODE === 'true') {
        const testTime = moment(startDateTime);
        const hasConflict = testTime.hour() === 16; // 4pm has conflict
        console.log(`📅 TEST MODE: Checking ${testTime.format('YYYY-MM-DD HH:mm')} - Conflict: ${hasConflict}`);
        return !hasConflict;
      }

      const startTime = moment(startDateTime).subtract(bufferMinutes, 'minutes');
      const endTime = moment(startDateTime).add(90, 'minutes'); // 30 min viewing + 30 min buffer

      const response = await this.calendar.freebusy.query({
        requestBody: {
          timeMin: startTime.toISOString(),
          timeMax: endTime.toISOString(),
          items: [{ id: 'primary' }]
        }
      });

      const busy = response.data.calendars.primary.busy;
      return busy.length === 0;
    } catch (error) {
      console.error('Error checking calendar availability:', error);
      throw error;
    }
  }

  async findNextAvailableSlot(preferredDateTime, durationMinutes = 90) {
    try {
      let currentTime = moment(preferredDateTime);
      const maxAttempts = 14; // Check next 14 days

      for (let i = 0; i < maxAttempts; i++) {
        if (await this.checkAvailability(currentTime.toDate())) {
          return currentTime.toDate();
        }
        currentTime = currentTime.add(30, 'minutes');

        // Skip non-business hours (before 9 AM or after 6 PM)
        if (currentTime.hour() >= 18) {
          currentTime = currentTime.add(1, 'day').hour(9).minute(0);
        } else if (currentTime.hour() < 9) {
          currentTime = currentTime.hour(9).minute(0);
        }
      }

      return null;
    } catch (error) {
      console.error('Error finding next available slot:', error);
      throw error;
    }
  }

  async findMultipleAvailableSlots(preferredDateTime, maxSlots = 3, durationMinutes = 90) {
    try {
      let currentTime = moment(preferredDateTime);
      const maxAttempts = 20; // Check more slots to find multiple options
      const availableSlots = [];

      for (let i = 0; i < maxAttempts && availableSlots.length < maxSlots; i++) {
        if (await this.checkAvailability(currentTime.toDate())) {
          availableSlots.push(currentTime.toDate());
        }
        currentTime = currentTime.add(30, 'minutes');

        // Skip non-business hours (before 9 AM or after 6 PM)
        if (currentTime.hour() >= 18) {
          currentTime = currentTime.add(1, 'day').hour(9).minute(0);
        } else if (currentTime.hour() < 9) {
          currentTime = currentTime.hour(9).minute(0);
        }
      }

      return availableSlots;
    } catch (error) {
      console.error('Error finding multiple available slots:', error);
      throw error;
    }
  }

  async createEvent(title, startDateTime, endDateTime, description, attendees = []) {
    try {
      const event = {
        summary: title,
        description: description,
        start: {
          dateTime: moment(startDateTime).toISOString(),
          timeZone: 'Asia/Singapore'
        },
        end: {
          dateTime: moment(endDateTime).toISOString(),
          timeZone: 'Asia/Singapore'
        },
        attendees: attendees.map(email => ({ email }))
      };

      const response = await this.calendar.events.insert({
        calendarId: 'primary',
        requestBody: event
      });

      console.log('Calendar event created:', response.data.id);
      return response.data;
    } catch (error) {
      console.error('Error creating calendar event:', error);
      throw error;
    }
  }

  formatDateTime(dateTime) {
    return moment(dateTime).format('MMMM Do YYYY, h:mm A');
  }
}

module.exports = new CalendarService();