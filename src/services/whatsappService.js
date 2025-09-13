const twilio = require('twilio');

class WhatsAppService {
  constructor() {
    this.client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    this.whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
  }

  async sendMessage(to, message) {
    try {
      const result = await this.client.messages.create({
        body: message,
        from: this.whatsappNumber,
        to: `whatsapp:${to}`
      });
      console.log(`Message sent to ${to}: ${result.sid}`);
      return result;
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      throw error;
    }
  }

  parseIncomingMessage(body) {
    const { From, To, Body, MessageSid } = body;
    
    return {
      from: From.replace('whatsapp:', ''),
      to: To.replace('whatsapp:', ''),
      content: Body,
      messageId: MessageSid,
      timestamp: new Date()
    };
  }

  isViewingRequest(messageContent) {
    const viewingKeywords = [
      'viewing', 'view', 'visit', 'see the property', 'show', 'appointment',
      'schedule', 'available', 'when can', 'can i see', 'inspection'
    ];
    
    const lowerMessage = messageContent.toLowerCase();
    return viewingKeywords.some(keyword => lowerMessage.includes(keyword));
  }

  isConfirmationResponse(messageContent) {
    const confirmationKeywords = [
      'yes', 'yeah', 'yep', 'ok', 'okay', 'confirmed', 'confirm', 'agreed', 'agree',
      'no', 'nope', 'not available', 'cannot', 'can\'t', 'busy'
    ];
    
    const lowerMessage = messageContent.toLowerCase().trim();
    return confirmationKeywords.some(keyword => 
      lowerMessage === keyword || 
      lowerMessage.startsWith(keyword + ' ') ||
      lowerMessage.endsWith(' ' + keyword)
    );
  }

  extractViewingDetails(messageContent) {
    const timePatterns = [
      /(\d{1,2}):?(\d{2})?\s?(am|pm)/gi,
      /(\d{1,2})\s?(am|pm)/gi
    ];
    
    const datePatterns = [
      /(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/gi,
      /(tomorrow|today)/gi,
      /(\d{1,2})[\/\-](\d{1,2})[\/\-]?(\d{2,4})?/g
    ];

    const times = [];
    const dates = [];

    timePatterns.forEach(pattern => {
      const matches = messageContent.match(pattern);
      if (matches) times.push(...matches);
    });

    datePatterns.forEach(pattern => {
      const matches = messageContent.match(pattern);
      if (matches) dates.push(...matches);
    });

    return {
      times,
      dates,
      originalMessage: messageContent
    };
  }
}

module.exports = new WhatsAppService();