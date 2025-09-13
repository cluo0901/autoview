const express = require('express');
const router = express.Router();
const twilio = require('twilio');

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

// Check message delivery status
router.get('/message/:messageId', async (req, res) => {
    try {
        const message = await client.messages(req.params.messageId).fetch();
        res.json({
            messageSid: message.sid,
            status: message.status,
            to: message.to,
            from: message.from,
            body: message.body,
            dateCreated: message.dateCreated,
            dateSent: message.dateSent,
            errorCode: message.errorCode,
            errorMessage: message.errorMessage
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test send message
router.post('/test-message', async (req, res) => {
    try {
        const { to, message } = req.body;
        const result = await client.messages.create({
            body: message || 'Test message from AutoView',
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: `whatsapp:${to}`
        });
        res.json({ success: true, messageSid: result.sid });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;