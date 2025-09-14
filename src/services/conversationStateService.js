const localMessageService = require('./localMessageService');

class ConversationStateService {
  constructor() {
    // In-memory state storage - in production this could be database/cache
    this.conversationStates = new Map();
  }

  // Conversation states
  static STATES = {
    WAITING_FOR_REQUEST: 'waiting_for_request',
    WAITING_FOR_AVAILABILITY: 'waiting_for_availability',
    WAITING_FOR_ALTERNATIVE_RESPONSE: 'waiting_for_alternative_response', 
    WAITING_FOR_NEW_TIME: 'waiting_for_new_time',
    COMPLETED: 'completed'
  };

  // Multiple choice response patterns
  static RESPONSE_PATTERNS = {
    OPTION_A: ['a)', 'a', 'option a', '1)', '1'],
    OPTION_B: ['b)', 'b', 'option b', '2)', '2'],
    OPTION_C: ['c)', 'c', 'option c', '3)', '3'],
    OPTION_D: ['d)', 'd', 'option d', '4)', '4']
  };

  // Get conversation state for a user
  getState(userId) {
    return this.conversationStates.get(userId) || {
      state: ConversationStateService.STATES.WAITING_FOR_REQUEST,
      data: {},
      lastTemplate: null,
      timestamp: new Date()
    };
  }

  // Set conversation state for a user
  setState(userId, state, data = {}, lastTemplate = null) {
    this.conversationStates.set(userId, {
      state,
      data: { ...this.getState(userId).data, ...data },
      lastTemplate,
      timestamp: new Date()
    });
  }

  // Parse multiple choice response
  parseMultipleChoiceResponse(message) {
    const content = message.content.trim().toLowerCase();
    
    // Check for Option A
    if (ConversationStateService.RESPONSE_PATTERNS.OPTION_A.some(pattern => 
        content.startsWith(pattern) || content === pattern)) {
      return 'option_a';
    }
    
    // Check for Option B  
    if (ConversationStateService.RESPONSE_PATTERNS.OPTION_B.some(pattern =>
        content.startsWith(pattern) || content === pattern)) {
      return 'option_b';
    }
    
    // Check for Option C
    if (ConversationStateService.RESPONSE_PATTERNS.OPTION_C.some(pattern =>
        content.startsWith(pattern) || content === pattern)) {
      return 'option_c';
    }
    
    // Check for Option D
    if (ConversationStateService.RESPONSE_PATTERNS.OPTION_D.some(pattern =>
        content.startsWith(pattern) || content === pattern)) {
      return 'option_d';
    }
    
    return 'invalid_response';
  }

  // Generate multiple choice templates
  generateAvailabilityTemplate(propertyAddress, dateTime) {
    return `Are you available for viewing at ${propertyAddress} on ${dateTime}?

Please reply with:
A) Yes, I'm available
B) No, I'm not available
C) I need a different time`;
  }

  generateAlternativeTemplate(originalTime, alternativeTime) {
    return `I have a conflict at ${originalTime}. How about ${alternativeTime} instead?

Please reply with:
A) Yes, that time works for me
B) No, I need a different time
C) I'm no longer interested`;
  }

  generateNewTimeTemplate() {
    return `What time would work better for you?

Please reply with:
A) Morning (9 AM - 12 PM)
B) Afternoon (1 PM - 5 PM) 
C) Evening (6 PM - 8 PM)
D) Let me suggest a specific time`;
  }

  generateConfirmationTemplate(propertyAddress, dateTime, recipientRole) {
    const roleText = recipientRole === 'visitor' ?
      "You're all set for your viewing" :
      "You're scheduled to show your property";

    return `${roleText} at ${propertyAddress} on ${dateTime}.

Please reply with:
A) Confirmed
B) I need to reschedule`;
  }

  generateViewingRequestTemplate(requesterName, propertyAddress, dateTime) {
    return `${requesterName} wants to view your property at ${propertyAddress} on ${dateTime}.

Please reply with:
A) Yes, that time works for me
B) No, I'm not available
C) I need a different time`;
  }

  generateAlternativeAcceptedTemplate(requesterName, propertyAddress, dateTime) {
    return `${requesterName} has accepted the new time for viewing your property at ${propertyAddress} on ${dateTime}.

Please reply with:
A) Confirmed, I'll be there
B) Actually, I can't make that time
C) I need to reschedule`;
  }

  generateClarifyDateTimeTemplate() {
    return `Please specify the date and time you'd like to view the property. For example: "tomorrow at 2pm" or "next Monday at 10am".

Please reply with:
A) Tomorrow morning (9 AM - 12 PM)
B) Tomorrow afternoon (1 PM - 5 PM)
C) Next week morning
D) Let me specify a time`;
  }

  generateAgentFullyBookedTemplate() {
    return `I'm completely booked for the next few weeks. Please call me directly to find an available time.

Please reply with:
A) I'll call you today
B) Send me your available times
C) I'll find another agent`;
  }

  generateRequestForwardedTemplate(recipientName, dateTime) {
    return `Your viewing request has been sent to ${recipientName} for ${dateTime}. You'll hear back shortly.

Please reply with:
A) Thank you
B) I need to change the time
C) Cancel this request`;
  }

  generateDeclineResponseTemplate() {
    return `No problem! What time would work better for you?

Please reply with:
A) Morning (9 AM - 12 PM)
B) Afternoon (1 PM - 5 PM)
C) Evening (6 PM - 8 PM)
D) Let me suggest a specific time`;
  }

  generateDeclineNotificationTemplate(otherPartyName) {
    return `${otherPartyName} is not available for the requested viewing time and is asking for alternatives.

Please reply with:
A) I can be flexible with timing
B) I need that specific time
C) Cancel this request`;
  }

  // Send template message and update state
  async sendTemplateAndUpdateState(userId, template, newState, stateData = {}) {
    await localMessageService.sendMessage(userId, template);
    this.setState(userId, newState, stateData, template);
  }

  // Handle different response types based on current state
  async handleResponse(userId, message, currentState) {
    const response = this.parseMultipleChoiceResponse(message);
    const state = this.getState(userId);

    console.log(`Handling response "${response}" for user ${userId} in state ${currentState.state}`);

    switch (currentState.state) {
      case ConversationStateService.STATES.WAITING_FOR_AVAILABILITY:
        return this.handleAvailabilityResponse(userId, response, state, message);

      case ConversationStateService.STATES.WAITING_FOR_ALTERNATIVE_RESPONSE:
        return this.handleAlternativeResponse(userId, response, state, message);

      case ConversationStateService.STATES.WAITING_FOR_NEW_TIME:
        return this.handleNewTimeResponse(userId, response, state, message);

      default:
        return this.handleInvalidState(userId, response, state);
    }
  }

  async handleAvailabilityResponse(userId, response, state, message) {
    switch (response) {
      case 'option_a': // Yes, available
        await localMessageService.sendMessage(userId, "Great! Your viewing is confirmed. Details will be sent shortly.");
        this.setState(userId, ConversationStateService.STATES.COMPLETED);
        return { action: 'confirmed', userId };
        
      case 'option_b': // No, not available
        const newTimeTemplate = this.generateNewTimeTemplate();
        await this.sendTemplateAndUpdateState(userId, newTimeTemplate, 
          ConversationStateService.STATES.WAITING_FOR_NEW_TIME);
        return { action: 'declined', userId };
        
      case 'option_c': // Need different time
        const altTimeTemplate = this.generateNewTimeTemplate();
        await this.sendTemplateAndUpdateState(userId, altTimeTemplate,
          ConversationStateService.STATES.WAITING_FOR_NEW_TIME);
        return { action: 'needs_different_time', userId };
        
      default:
        return this.handleInvalidResponse(userId, state);
    }
  }

  async handleAlternativeResponse(userId, response, state, message) {
    switch (response) {
      case 'option_a': // Yes, alternative time works
        // Import viewing service to handle the alternative acceptance
        const viewingService = require('./viewingService');

        // Use the existing handlePartyAAlternativeResponse method
        const result = await viewingService.handlePartyAAlternativeResponse({
          from: userId,
          content: 'option_a'
        });

        if (result && result.success) {
          this.setState(userId, ConversationStateService.STATES.COMPLETED);
          return { action: 'alternative_accepted', userId };
        } else {
          await localMessageService.sendMessage(userId, "Sorry, there was an issue processing your response. Please try again.");
          return { action: 'error', userId };
        }

      case 'option_b': // No, need different time
        const newTimeTemplate = this.generateNewTimeTemplate();
        await this.sendTemplateAndUpdateState(userId, newTimeTemplate,
          ConversationStateService.STATES.WAITING_FOR_NEW_TIME);
        return { action: 'needs_different_time', userId };

      case 'option_c': // No longer interested
        await localMessageService.sendMessage(userId, "Understood. Thank you for letting us know.");
        this.setState(userId, ConversationStateService.STATES.COMPLETED);
        return { action: 'cancelled', userId };

      default:
        return this.handleInvalidResponse(userId, state);
    }
  }

  async handleNewTimeResponse(userId, response, state, message) {
    switch (response) {
      case 'option_a': // Morning
        await localMessageService.sendMessage(userId, "Thanks! I'll check morning availability and get back to you.");
        this.setState(userId, ConversationStateService.STATES.COMPLETED);
        return { action: 'prefers_morning', userId };
        
      case 'option_b': // Afternoon  
        await localMessageService.sendMessage(userId, "Thanks! I'll check afternoon availability and get back to you.");
        this.setState(userId, ConversationStateService.STATES.COMPLETED);
        return { action: 'prefers_afternoon', userId };
        
      case 'option_c': // Evening
        await localMessageService.sendMessage(userId, "Thanks! I'll check evening availability and get back to you.");
        this.setState(userId, ConversationStateService.STATES.COMPLETED);
        return { action: 'prefers_evening', userId };
        
      case 'option_d': // Specific time
        await localMessageService.sendMessage(userId, "Please tell me your preferred date and time (e.g., 'Monday 3pm'):");
        this.setState(userId, ConversationStateService.STATES.WAITING_FOR_REQUEST);
        return { action: 'will_specify_time', userId };
        
      default:
        return this.handleInvalidResponse(userId, state);
    }
  }

  async handleInvalidResponse(userId, state) {
    await localMessageService.sendMessage(userId, 
      "I didn't understand your response. Please reply with A, B, C, or D as shown in the options above.");
    // Keep same state - don't advance until valid response
    return { action: 'invalid_response', userId };
  }

  async handleInvalidState(userId, response, state) {
    await localMessageService.sendMessage(userId,
      "I'm not sure how to help with that right now. Please start with a viewing request.");
    this.setState(userId, ConversationStateService.STATES.WAITING_FOR_REQUEST);
    return { action: 'reset_state', userId };
  }

  // Clear state for a user (useful for testing)
  clearState(userId) {
    this.conversationStates.delete(userId);
  }

  // Get all conversation states (for debugging)
  getAllStates() {
    return Object.fromEntries(this.conversationStates);
  }
}

module.exports = new ConversationStateService();