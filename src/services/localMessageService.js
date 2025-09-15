class LocalMessageService {
  constructor() {
    this.messages = [];
    this.conversations = new Map();
  }

  async sendMessage(to, message, from = 'system') {
    try {
      const messageObj = {
        id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        from: from,
        to: to,
        content: typeof message === 'string' ? message : message.text,
        timestamp: new Date(),
        type: 'outbound'
      };

      // Add selection options if provided
      if (typeof message === 'object' && message.options) {
        messageObj.options = message.options;
        messageObj.messageType = 'selection';
      }

      this.messages.push(messageObj);
      
      // Store in conversation threads
      const conversationKey = this.getConversationKey(from, to);
      if (!this.conversations.has(conversationKey)) {
        this.conversations.set(conversationKey, []);
      }
      this.conversations.get(conversationKey).push(messageObj);

      console.log(`Local message sent from ${from} to ${to}: ${message}`);
      return messageObj;
    } catch (error) {
      console.error('Error sending local message:', error);
      throw error;
    }
  }

  parseIncomingMessage(messageData) {
    // Handle both webhook format and local format
    if (messageData.From && messageData.To && messageData.Body) {
      // Twilio webhook format (for compatibility)
      return {
        from: messageData.From.replace('whatsapp:', ''),
        to: messageData.To.replace('whatsapp:', ''),
        content: messageData.Body,
        messageId: messageData.MessageSid || `msg_${Date.now()}`,
        timestamp: new Date()
      };
    } else {
      // Local format
      return {
        from: messageData.from,
        to: messageData.to || 'system',
        content: messageData.content,
        messageId: messageData.id || `msg_${Date.now()}`,
        timestamp: messageData.timestamp || new Date()
      };
    }
  }

  async receiveMessage(from, to, content) {
    const messageObj = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      from: from,
      to: to,
      content: content,
      timestamp: new Date(),
      type: 'inbound'
    };

    this.messages.push(messageObj);
    
    // Store in conversation threads
    const conversationKey = this.getConversationKey(from, to);
    if (!this.conversations.has(conversationKey)) {
      this.conversations.set(conversationKey, []);
    }
    this.conversations.get(conversationKey).push(messageObj);

    console.log(`Local message received from ${from} to ${to}: ${content}`);
    return messageObj;
  }

  getConversationKey(from, to) {
    // Create a consistent key for conversations regardless of direction
    return [from, to].sort().join('_');
  }

  getConversation(phone1, phone2) {
    const key = this.getConversationKey(phone1, phone2);
    return this.conversations.get(key) || [];
  }

  getAllConversations() {
    const conversations = {};
    for (const [key, messages] of this.conversations.entries()) {
      conversations[key] = messages;
    }
    return conversations;
  }

  getAllMessages() {
    return this.messages;
  }

  clearAllMessages() {
    this.messages = [];
    this.conversations.clear();
    console.log('All local messages cleared');
  }

  clearConversation(phone1, phone2) {
    const key = this.getConversationKey(phone1, phone2);
    this.conversations.delete(key);
    
    // Remove messages from main array
    this.messages = this.messages.filter(msg => {
      const msgKey = this.getConversationKey(msg.from, msg.to);
      return msgKey !== key;
    });
    
    console.log(`Conversation between ${phone1} and ${phone2} cleared`);
  }

  // Keep existing message analysis methods for compatibility
  isViewingRequest(messageContent) {
    const lowerMessage = messageContent.toLowerCase().trim();
    
    // Strong viewing request indicators
    const strongViewingKeywords = [
      'viewing', 'view the property', 'visit the property', 'see the property', 'show me', 
      'schedule a viewing', 'book a viewing', 'arrange a viewing', 'can i see', 'inspection',
      'when can i view', 'i would like to view', 'i want to see'
    ];
    
    // Check for strong indicators first
    if (strongViewingKeywords.some(keyword => lowerMessage.includes(keyword))) {
      return true;
    }
    
    // Weak indicators that need additional context
    const weakViewingKeywords = ['available', 'appointment', 'schedule', 'visit'];
    
    // Only consider weak keywords if they're NOT part of a confirmation response
    const startsWithConfirmation = /^(yes|yeah|yep|ok|okay|no|nope)/i.test(lowerMessage);
    if (startsWithConfirmation) {
      return false; // This is likely a confirmation, not a viewing request
    }
    
    // Check for weak keywords with additional context requirements
    return weakViewingKeywords.some(keyword => {
      if (lowerMessage.includes(keyword)) {
        // "available" must be in context of asking about availability, not confirming it
        if (keyword === 'available') {
          return lowerMessage.includes('when are you available') || 
                 lowerMessage.includes('are you available') ||
                 lowerMessage.includes('if you are available') ||
                 lowerMessage.includes('available to show');
        }
        return true;
      }
      return false;
    });
  }

  isConfirmationResponse(messageContent) {
    const confirmationKeywords = [
      'yes', 'yeah', 'yep', 'ok', 'okay', 'confirmed', 'confirm', 'agreed', 'agree',
      'no', 'nope', 'not available', 'cannot', 'can\'t', 'busy'
    ];
    
    const lowerMessage = messageContent.toLowerCase().trim();
    
    // Check for explicit confirmation patterns
    const confirmationPatterns = [
      /^yes,?\s/i,
      /^yeah,?\s/i, 
      /^yep,?\s/i,
      /^ok,?\s/i,
      /^okay,?\s/i,
      /^no,?\s/i,
      /^nope,?\s/i
    ];
    
    // Check explicit patterns first
    if (confirmationPatterns.some(pattern => pattern.test(messageContent))) {
      return true;
    }
    
    // Then check for exact word matches or phrases
    return confirmationKeywords.some(keyword => 
      lowerMessage === keyword || 
      lowerMessage.startsWith(keyword + ' ') ||
      lowerMessage.endsWith(' ' + keyword) ||
      lowerMessage.includes(' ' + keyword + ' ')
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

  // Utility method to get predefined roles from existing properties
  async getKnownRoles() {
    try {
      const Property = require('../models/Property');
      const properties = await Property.find();
      
      const roles = [];
      properties.forEach(property => {
        if (property.partyA && property.partyA.role) {
          roles.push({
            role: property.partyA.role,
            property: this.getPropertyTag(property.address),
            id: `${property.partyA.role}-${property._id}`,
            displayName: this.formatRoleDisplay(property.partyA.role, property.address)
          });
        }
        if (property.partyB && property.partyB.role) {
          roles.push({
            role: property.partyB.role,
            property: this.getPropertyTag(property.address),
            id: `${property.partyB.role}-${property._id}`,
            displayName: this.formatRoleDisplay(property.partyB.role, property.address)
          });
        }
      });
      
      // Add agent role
      roles.push({
        role: 'agent',
        property: '',
        id: 'agent',
        displayName: 'Agent'
      });
      
      return roles;
    } catch (error) {
      console.error('Error getting known roles:', error);
      return [];
    }
  }

  getPropertyTag(address) {
    // Extract a short property identifier from address
    if (address.toLowerCase().includes('marina bay')) return 'Marina Bay';
    if (address.toLowerCase().includes('orchard')) return 'Orchard';
    if (address.toLowerCase().includes('sentosa')) return 'Sentosa';
    
    // Default: take first word or first two words
    const words = address.split(' ');
    return words.length > 1 ? `${words[0]} ${words[1]}` : words[0];
  }

  formatRoleDisplay(role, address) {
    const propertyTag = this.getPropertyTag(address);
    
    // For roles that own/manage properties, add property tag
    if (role === 'seller' || role === 'landlord') {
      return `${this.capitalizeFirst(role)} (${propertyTag})`;
    }
    
    // For buyers/tenants, show role with property they're interested in
    if (role === 'buyer' || role === 'tenant') {
      return `${this.capitalizeFirst(role)} (${propertyTag})`;
    }
    
    return this.capitalizeFirst(role);
  }

  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

module.exports = new LocalMessageService();