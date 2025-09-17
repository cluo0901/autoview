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
    ],
    OPTION_C: [
      'c)', 'c', 'option c', '3)', '3',
      'i can\'t make any of these times', 'none of these work for me'
    ],
    OPTION_D: [
      'd)', 'd', 'option d', '4)', '4'
    ],
    OPTION_E: [
      'e)', 'e', 'option e', '5)', '5'
    ],
    OPTION_F: [
      'f)', 'f', 'option f', '6)', '6'
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

  // Parse multiple choice response - supports A through F options
  parseMultipleChoiceResponse(message) {
    const content = message.content.trim().toLowerCase();

    // First check for new format with parentheses like "Tomorrow 4pm (B)"
    const parenthesesMatch = content.match(/\(([a-f])\)$/);
    if (parenthesesMatch) {
      const letter = parenthesesMatch[1].toUpperCase();
      return `option_${letter.toLowerCase()}`;
    }

    // Check each option pattern in order (original logic)
    const optionKeys = ['OPTION_A', 'OPTION_B', 'OPTION_C', 'OPTION_D', 'OPTION_E', 'OPTION_F'];

    for (const optionKey of optionKeys) {
      const patterns = ConversationStateService.RESPONSE_PATTERNS[optionKey];
      if (patterns && patterns.some(pattern =>
          content.startsWith(pattern) || content === pattern)) {
        return optionKey.toLowerCase();
      }
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

  // Multiple-option template methods for when users provide multiple time choices
  generateMultipleTimeProposalTemplate(propertyAddress, timeOptions) {
    const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const options = timeOptions.slice(0, 6).map((timeOption, index) => ({
      id: `option_${optionLetters[index].toLowerCase()}`,
      label: timeOption.display,
      value: optionLetters[index],
      datetime: timeOption.datetime
    }));

    // Add "None of these work" option
    const nextLetter = optionLetters[options.length];
    if (nextLetter) {
      options.push({
        id: `option_${nextLetter.toLowerCase()}`,
        label: "None of these work for me",
        value: nextLetter
      });
    }

    return {
      text: `You have multiple time options to view ${propertyAddress}. Which time works best for you?`,
      options
    };
  }

  generateMultipleAlternativeTemplate(originalTime, alternativeOptions) {
    const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const options = alternativeOptions.slice(0, 5).map((timeOption, index) => ({
      id: `option_${optionLetters[index].toLowerCase()}`,
      label: timeOption.display,
      value: optionLetters[index],
      datetime: timeOption.datetime
    }));

    // Add "None of these work" option
    const nextLetter = optionLetters[options.length];
    if (nextLetter) {
      options.push({
        id: `option_${nextLetter.toLowerCase()}`,
        label: "I can't make any of these times",
        value: nextLetter
      });
    }

    return {
      text: `I have a conflict at ${originalTime}. How about one of these times instead?`,
      options
    };
  }

  generateMultipleCounterProposalTemplate(proposerName, propertyAddress, timeOptions) {
    const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F'];
    const options = timeOptions.slice(0, 5).map((timeOption, index) => ({
      id: `option_${optionLetters[index].toLowerCase()}`,
      label: timeOption.display,
      value: optionLetters[index],
      datetime: timeOption.datetime
    }));

    // Add "None of these work" option
    const nextLetter = optionLetters[options.length];
    if (nextLetter) {
      options.push({
        id: `option_${nextLetter.toLowerCase()}`,
        label: "I can't make any of these times",
        value: nextLetter
      });
    }

    return {
      text: `${proposerName} has requested to view ${propertyAddress} and provided multiple time options. Which time works for you to show the property?`,
      options
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

  // Simplified handler for confirmation responses (A/B/C/D/E/F)
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
        } else if (state.data && state.data.multipleTimeOptions) {
          // This is selecting the first option from multiple time proposals
          const selectedOption = state.data.multipleTimeOptions[0];
          return this.handleMultipleTimeSelection(userId, selectedOption, state);
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

      case 'option_b': // I can't make it, propose new timing OR second option from multiple choices
        if (state.data && state.data.multipleTimeOptions && state.data.multipleTimeOptions.length > 1) {
          // This is selecting the second option from multiple time proposals
          const selectedOption = state.data.multipleTimeOptions[1];
          return this.handleMultipleTimeSelection(userId, selectedOption, state);
        } else {
          // Standard decline response
          const declineTemplate = this.generateDeclineResponseTemplate();
          await localMessageService.sendMessage(userId, declineTemplate);
          this.setState(userId, ConversationStateService.STATES.WAITING_FOR_REQUEST, {
            isCounterProposal: true,
            originalRequest: state.data
          });
          return { action: 'needs_new_timing', userId };
        }

      case 'option_c': // Third option from multiple choices OR none of these work
        if (state.data && state.data.multipleTimeOptions && state.data.multipleTimeOptions.length > 2) {
          const selectedOption = state.data.multipleTimeOptions[2];
          return this.handleMultipleTimeSelection(userId, selectedOption, state);
        } else {
          // None of these work
          const declineTemplate = this.generateDeclineResponseTemplate();
          await localMessageService.sendMessage(userId, declineTemplate);
          this.setState(userId, ConversationStateService.STATES.WAITING_FOR_REQUEST, {
            isCounterProposal: true,
            originalRequest: state.data
          });
          return { action: 'needs_new_timing', userId };
        }

      case 'option_d': // Fourth option from multiple choices
        if (state.data && state.data.multipleTimeOptions && state.data.multipleTimeOptions.length > 3) {
          const selectedOption = state.data.multipleTimeOptions[3];
          return this.handleMultipleTimeSelection(userId, selectedOption, state);
        } else {
          return this.handleInvalidResponse(userId, state);
        }

      case 'option_e': // Fifth option from multiple choices
        if (state.data && state.data.multipleTimeOptions && state.data.multipleTimeOptions.length > 4) {
          const selectedOption = state.data.multipleTimeOptions[4];
          return this.handleMultipleTimeSelection(userId, selectedOption, state);
        } else {
          return this.handleInvalidResponse(userId, state);
        }

      case 'option_f': // Sixth option from multiple choices
        if (state.data && state.data.multipleTimeOptions && state.data.multipleTimeOptions.length > 5) {
          const selectedOption = state.data.multipleTimeOptions[5];
          return this.handleMultipleTimeSelection(userId, selectedOption, state);
        } else {
          return this.handleInvalidResponse(userId, state);
        }

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

  // Handle multiple time option selection
  async handleMultipleTimeSelection(userId, selectedOption, state) {
    try {
      console.log(`User ${userId} selected time option:`, selectedOption);

      // Parse the selected datetime
      const selectedDateTime = new Date(selectedOption.datetime);
      if (isNaN(selectedDateTime.getTime())) {
        throw new Error(`Invalid selected datetime: ${selectedOption.datetime}`);
      }

      // IMPORTANT: Check if this is a seller/landlord accepting buyer's/tenant's originally proposed time
      // In this case, both parties have now agreed - we should immediately confirm the viewing
      const viewingService = require('./viewingService');
      const senderInfo = await viewingService.parseRoleId(userId);

      if (senderInfo && (senderInfo.role === 'seller' || senderInfo.role === 'landlord')) {
        // This is a seller/landlord accepting one of the buyer's/tenant's proposed times
        // Both parties have now agreed - immediately confirm the viewing
        console.log(`Seller/landlord ${userId} accepted buyer's proposed time - immediately confirming viewing`);

        const property = await require('../models/Property').findById(state.data.propertyId);
        if (!property) {
          throw new Error('Property not found');
        }

        // Get the original requester (the other party)
        const originalRequester = viewingService.getOtherPartyRoleId(property, senderInfo.role, property._id);

        // Send confirmation to both parties
        const formatDateTime = require('moment-timezone')(selectedDateTime).tz('Asia/Singapore').format('dddd, MMMM Do, h:mm A');

        // Confirm to seller/landlord
        await localMessageService.sendMessage(userId,
          `Perfect! Your viewing is confirmed for ${formatDateTime} at ${property.address}. The buyer will be there to view the property.`);

        // Confirm to buyer/tenant
        await localMessageService.sendMessage(originalRequester,
          `Great news! Your viewing is confirmed for ${formatDateTime} at ${property.address}. The seller will show you the property.`);

        // Create calendar event
        try {
          const calendarEvent = await viewingService.createCalendarEvent(property, selectedDateTime, senderInfo, {
            roleId: originalRequester,
            name: senderInfo.role === 'seller' ? 'Buyer' : 'Tenant', // Get proper name if available
            role: senderInfo.role === 'seller' ? 'buyer' : 'tenant'
          });
          console.log(`Calendar event created for multiple time selection: ${calendarEvent ? 'success' : 'failed'}`);
        } catch (error) {
          console.error('Error creating calendar event for multiple time selection:', error);
        }

        // Update conversation states to completed
        this.setState(userId, ConversationStateService.STATES.COMPLETED);
        this.setState(originalRequester, ConversationStateService.STATES.COMPLETED);

        return { action: 'viewing_immediately_confirmed', userId, selectedOption, confirmedDateTime: selectedDateTime };
      }

      // For all other cases (buyer selecting from multiple options, or other scenarios),
      // use the normal flow to forward to the other party
      const result = await viewingService.processViewingProposal(
        userId,
        selectedDateTime,
        state.data.propertyId,
        state.data.originalRequestData || {}
      );

      console.log('Multiple time selection processed:', result);
      return { action: 'multiple_time_selected_and_forwarded', userId, selectedOption, result };

    } catch (error) {
      console.error('Error handling multiple time selection:', error);
      await localMessageService.sendMessage(userId,
        'Sorry, there was an error processing your time selection. Please try again.');
      return { action: 'error', userId, error: error.message };
    }
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