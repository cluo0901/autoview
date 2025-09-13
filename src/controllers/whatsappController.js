const whatsappService = require('../services/whatsappService');
const viewingService = require('../services/viewingService');

class WhatsAppController {
  verifyWebhook(req, res) {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === process.env.TWILIO_AUTH_TOKEN) {
      console.log('Webhook verified');
      res.status(200).send(challenge);
    } else {
      res.status(403).send('Forbidden');
    }
  }

  async handleWebhook(req, res) {
    try {
      const message = whatsappService.parseIncomingMessage(req.body);
      console.log('Received message:', message);

      if (whatsappService.isViewingRequest(message.content)) {
        console.log('Detected viewing request');
        await viewingService.handleViewingRequest(message);
      } else if (whatsappService.isConfirmationResponse(message.content)) {
        console.log('Detected confirmation response');
        await viewingService.handleConfirmationResponse(message);
      } else {
        console.log('Message not recognized as viewing request or confirmation');
      }

      res.status(200).send('OK');
    } catch (error) {
      console.error('Error handling webhook:', error);
      res.status(500).send('Error processing message');
    }
  }
}

module.exports = new WhatsAppController();