const localMessageService = require('./localMessageService');

class ConversationStateService {
  constructor() {
    // In-memory state storage - in production this could be database/cache
    this.conversationStates = new Map();
  }

  // Simplified conversation states - only 2 core states plus initial and completed
  static STATES = {
    WAITING_FOR_REQUEST: 'waiting_for_request',
    WAITING_FOR_CONFIRMATION: 'waiting_for_confirmation', // After forwarding request to other party
    WAITING_FOR_NEW_TIMING: 'waiting_for_new_timing', // After someone chooses "B" option
    COMPLETED: 'completed'
  };

  // Multiple choice response patterns - include actual label text and legacy A/B patterns
  static RESPONSE_PATTERNS = {
    OPTION_A: [
      'a)', 'a', 'option a', '1)', '1',
      'confirmed', 'ok', 'yes', 'i\'ll call you today',
      'morning (9 am - 12 pm)', 'i can be flexible with timing'
    ],
    OPTION_B: [
      'b)', 'b', 'option b', '2)', '2',
      'i can\'t make it, and would like to propose a new timing',
      'let me suggest a specific time', 'i need that specific time',
      'let me specify a time', 'i\'ll find another agent'
    ]
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

  // Parse multiple choice response - simplified to A/B only
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

    return 'invalid_response';
  }

  // Generate multiple choice templates
  generateAvailabilityTemplate(propertyAddress, dateTime) {
    return {
      text: `Are you available for viewing at ${propertyAddress} on ${dateTime}?`,
      options: [
        { id: 'option_a', label: 'Confirmed', value: 'A' },
        { id: 'option_b', label: "I can't make it, and would like to propose a new timing", value: 'B' }
      ]
    };
  }

  generateAlternativeTemplate(originalTime, alternativeTime) {
    return {
      text: `I have a conflict at ${originalTime}. How about ${alternativeTime} instead?`,
      options: [
        { id: 'option_a', label: 'Ok', value: 'A' },
        { id: 'option_b', label: "I can't make it, and would like to propose a new timing", value: 'B' }
      ]
    };
  }

  generateNewTimeTemplate() {
    return {
      text: `What time would work better for you?`,
      options: [
        { id: 'option_a', label: 'Morning (9 AM - 12 PM)', value: 'A' },
        { id: 'option_b', label: 'Let me suggest a specific time', value: 'B' }
      ]
    };
  }

  generateConfirmationTemplate(propertyAddress, dateTime, recipientRole) {
    const roleText = recipientRole === 'visitor' ?
      "You're all set for your viewing" :
      "You're scheduled to show your property";

    return {
      text: `${roleText} at ${propertyAddress} on ${dateTime}.`,
      options: [
        { id: 'option_a', label: 'Confirmed', value: 'A' },
        { id: 'option_b', label: "I can't make it, and would like to propose a new timing", value: 'B' }
      ]
    };
  }

  generateViewingRequestTemplate(requesterName, propertyAddress, dateTime) {
    return {
      text: `${requesterName} wants to view your property at ${propertyAddress} on ${dateTime}.`,
      options: [
        { id: 'option_a', label: 'Confirmed', value: 'A' },
        { id: 'option_b', label: "I can't make it, and would like to propose a new timing", value: 'B' }
      ]
    };
  }

  generateAlternativeAcceptedTemplate(requesterName, propertyAddress, dateTime) {
    return {
      text: `${requesterName} has accepted the new time for viewing your property at ${propertyAddress} on ${dateTime}.`,
      options: [
        { id: 'option_a', label: 'Confirmed', value: 'A' },
        { id: 'option_b', label: "I can't make it, and would like to propose a new timing", value: 'B' }
      ]
    };
  }

  generateClarifyDateTimeTemplate() {
    return {
      text: `Please specify the date and time you'd like to view the property. For example: "tomorrow at 2pm" or "next Monday at 10am".`,
      options: [
        { id: 'option_a', label: 'Tomorrow morning (9 AM - 12 PM)', value: 'A' },
        { id: 'option_b', label: 'Let me specify a time', value: 'B' }
      ]
    };
  }

  generateAgentFullyBookedTemplate() {
    return {
      text: `I'm completely booked for the next few weeks. Please call me directly to find an available time.`,
      options: [
        { id: 'option_a', label: "I'll call you today", value: 'A' },
        { id: 'option_b', label: "I'll find another agent", value: 'B' }
      ]
    };
  }

  generateRequestForwardedTemplate(recipientName, dateTime, senderRole = null) {
    // Role-aware messaging: buyers/tenants make viewing requests, sellers/landlords host viewings
    if (senderRole === 'seller' || senderRole === 'landlord') {
      return `Your proposed viewing time of ${dateTime} has been sent to ${recipientName}. You'll hear back shortly.`;
    } else {
      // Default for buyers/tenants
      return `Your viewing request has been sent to ${recipientName} for ${dateTime}. You'll hear back shortly.`;
    }
  }

  generateDeclineResponseTemplate() {
    return `No problem! Please suggest an alternative date and time that works for you.

For example: "Tomorrow at 10am" or "Next Tuesday at 3pm"

The system will understand your preferred timing and coordinate with the other party.`;
  }

  generateDeclineNotificationTemplate(otherPartyName) {
    return {
      text: `${otherPartyName} is not available for the requested viewing time and is asking for alternatives.`,
      options: [
        { id: 'option_a', label: 'I can be flexible with timing', value: 'A' },
        { id: 'option_b', label: 'I need that specific time', value: 'B' }
      ]
    };
  }

  generateCounterProposalTemplate(proposerName, propertyAddress, dateTime) {
    return {
      text: `${proposerName} has proposed a new time for the viewing at ${propertyAddress} on ${dateTime}.`,
      options: [
        { id: 'option_a', label: 'Confirmed', value: 'A' },
        { id: 'option_b', label: "I can't make it, and would like to propose a new timing", value: 'B' }
      ]
    };
  }

  // Send template message and update state
  async sendTemplateAndUpdateState(userId, template, newState, stateData = {}) {
    await localMessageService.sendMessage(userId, template);
    this.setState(userId, newState, stateData, template);
  }

  // Handle different response types based on simplified states
  async handleResponse(userId, message, currentState) {
    const response = this.parseMultipleChoiceResponse(message);
    const state = this.getState(userId);

    console.log(`Handling response "${response}" for user ${userId} in state ${currentState.state}`);

    switch (currentState.state) {
      case ConversationStateService.STATES.WAITING_FOR_CONFIRMATION:
        return this.handleConfirmationResponse(userId, response, state, message);

      case ConversationStateService.STATES.WAITING_FOR_NEW_TIMING:
        return this.handleNewTimingResponse(userId, response, state, message);

      default:
        return this.handleInvalidState(userId, response, state);
    }
  }

  // Simplified handler for confirmation responses (A/B only)
  async handleConfirmationResponse(userId, response, state, message) {
    switch (response) {
      case 'option_a': // Confirmed
        // Check if this is accepting an agent-proposed alternative time
        if (state.data && state.data.alternativeDateTime) {
          // This is accepting an alternative time proposed by the agent
          // Forward the accepted alternative time to the other party via central flow
          console.log(`User ${userId} accepted alternative time ${state.data.alternativeDateTime}, forwarding to other party`);

          // Use the viewing service to forward the accepted alternative time
          const viewingService = require('./viewingService');
          const result = await viewingService.processViewingProposal(
            userId,
            state.data.alternativeDateTime,
            state.data.propertyId,
            state.data.originalRequestData
          );

          return { action: 'alternative_accepted_and_forwarded', userId, result };
        } else {
          // This is a final confirmation (e.g., landlord confirming the viewing)
          console.log(`Final confirmation from ${userId}, completing viewing arrangement`);

          // Get the viewing details from the state
          const viewingData = state.data;

          if (viewingData && viewingData.propertyId && viewingData.proposedDateTime) {
            // Use the viewing service to complete the confirmation flow
            const viewingService = require('./viewingService');
            const result = await viewingService.completeViewingConfirmation(
              userId,
              viewingData.proposedDateTime,
              viewingData.propertyId,
              viewingData
            );

            await localMessageService.sendMessage(userId, "Great! Your viewing is confirmed. Details will be sent shortly.");
            this.setState(userId, ConversationStateService.STATES.COMPLETED);
            return { action: 'viewing_fully_confirmed', userId, result };
          } else {
            // Fallback for incomplete data
            await localMessageService.sendMessage(userId, "Great! Your viewing is confirmed. Details will be sent shortly.");
            this.setState(userId, ConversationStateService.STATES.COMPLETED);
            return { action: 'confirmed', userId };
          }
        }

      case 'option_b': // I can't make it, propose new timing
        const declineTemplate = this.generateDeclineResponseTemplate();
        await localMessageService.sendMessage(userId, declineTemplate);
        this.setState(userId, ConversationStateService.STATES.WAITING_FOR_REQUEST, {
          isCounterProposal: true,
          originalRequest: state.data
        });
        return { action: 'needs_new_timing', userId };

      default:
        return this.handleInvalidResponse(userId, state);
    }
  }

  // Simplified handler for new timing responses
  async handleNewTimingResponse(userId, response, state, message) {
    switch (response) {
      case 'option_a': // Morning or general positive response
        await localMessageService.sendMessage(userId, "Thanks! I'll check availability and coordinate with the other party.");
        this.setState(userId, ConversationStateService.STATES.COMPLETED);
        return { action: 'timing_preference_noted', userId };

      case 'option_b': // Let me specify a time / I can't make it
        await localMessageService.sendMessage(userId, "Please tell me your preferred date and time (e.g., 'Monday 3pm'):");
        this.setState(userId, ConversationStateService.STATES.WAITING_FOR_REQUEST, {
          isCounterProposal: true,
          originalRequest: state.data
        });
        return { action: 'waiting_for_specific_time', userId };

      default:
        return this.handleInvalidResponse(userId, state);
    }
  }

  // This method is now replaced by handleNewTimingResponse above

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