const Property = require('../models/Property');
const ViewingRequest = require('../models/ViewingRequest');
const localMessageService = require('./localMessageService');
const calendarService = require('./calendarService');
const aiService = require('./aiService');
const conversationStateService = require('./conversationStateService');
const moment = require('moment-timezone');

class ViewingService {
  // Central flow handler - implements the clean recursive logic
  // Step 1: AI analysis to extract timing proposal
  // Step 2: Check agent calendar → forward/alternative
  async processViewingProposal(sender, proposedDateTime, propertyId, originalRequestData = null) {
    try {
      console.log(`Processing viewing proposal from ${sender} for ${proposedDateTime} at property ${propertyId}`);

      // Loop prevention: Check if this user has been going back and forth too many times
      const currentState = conversationStateService.getState(sender);
      const proposalAttempts = (currentState.data?.proposalAttempts || 0) + 1;

      console.log(`Proposal attempt #${proposalAttempts} for user ${sender}`);

      // After 3 attempts, suggest calling agent directly
      if (proposalAttempts >= 3) {
        console.log('Too many proposal attempts, suggesting direct agent call');
        await localMessageService.sendMessage(sender,
          'We\'ve been going back and forth quite a bit! Let me give you a call to sort this out more efficiently. What\'s the best number to reach you?');

        conversationStateService.setState(sender, conversationStateService.constructor.STATES.COMPLETED, {
          proposalAttempts: proposalAttempts,
          needsDirectCall: true
        });

        return { success: true, message: 'Loop prevented, direct call requested' };
      }

      // Get property details
      const property = await Property.findById(propertyId);
      if (!property) {
        await localMessageService.sendMessage(sender,
          'Sorry, I cannot find the property details. Please contact me directly.');
        return { success: false, message: 'Property not found' };
      }

      // Update proposal attempt count for this user
      const updatedRequestData = {
        ...originalRequestData,
        proposalAttempts: proposalAttempts
      };

      // Step 2: Check agent's availability
      const isAgentAvailable = await calendarService.checkAvailability(proposedDateTime);

      if (isAgentAvailable) {
        // Step 2a: Agent available - forward to other party with A/B confirmation options
        return this.forwardToOtherParty(sender, proposedDateTime, property, updatedRequestData);
      } else {
        // Step 2b: Agent not available - propose nearest available time with A/B options
        return this.proposeAlternativeTime(sender, proposedDateTime, property, updatedRequestData);
      }

    } catch (error) {
      console.error('Error processing viewing proposal:', error);
      await localMessageService.sendMessage(sender,
        'Sorry, there was an error processing your proposal. Please try again.');
      return { success: false, message: 'Processing error', error: error.message };
    }
  }

  async forwardToOtherParty(sender, proposedDateTime, property, originalRequestData) {
    // Determine who the other party is
    const senderInfo = await this.parseRoleId(sender);
    const otherPartyRoleId = this.getOtherPartyRoleId(property, senderInfo.role, property._id);
    const otherParty = senderInfo.role === property.partyA.role ? property.partyB : property.partyA;
    const senderName = senderInfo.role === property.partyA.role ? property.partyA.name : property.partyB.name;

    // Send viewing request to other party with A/B confirmation template
    // Check if this is a counter-proposal (indicated by proposal attempts > 0 or alternative datetime)
    const isCounterProposal = originalRequestData && (
      (originalRequestData.proposalAttempts && originalRequestData.proposalAttempts > 0) ||
      originalRequestData.alternativeDateTime ||
      originalRequestData.isCounterProposal
    );

    let forwardingMessage;
    if (isCounterProposal) {
      // Use counter-proposal template for alternative time suggestions
      forwardingMessage = conversationStateService.generateCounterProposalTemplate(
        senderName,
        property.address,
        calendarService.formatDateTime(proposedDateTime)
      );
    } else {
      // Use standard viewing request template for initial requests
      forwardingMessage = conversationStateService.generateViewingRequestTemplate(
        senderName,
        property.address,
        calendarService.formatDateTime(proposedDateTime)
      );
    }

    const confirmationMessage = conversationStateService.generateRequestForwardedTemplate(
      otherParty.name,
      calendarService.formatDateTime(proposedDateTime),
      senderInfo.role
    );

    await localMessageService.sendMessage(otherPartyRoleId, forwardingMessage);
    await localMessageService.sendMessage(sender, confirmationMessage);

    // Set conversation state for the other party - waiting for confirmation (A/B)
    conversationStateService.setState(otherPartyRoleId,
      conversationStateService.constructor.STATES.WAITING_FOR_CONFIRMATION,
      {
        propertyId: property._id,
        proposedDateTime: proposedDateTime,
        requesterName: senderName,
        originalRequestData: originalRequestData
      }
    );

    // Set sender state to completed (they've done their part)
    // Include proposal attempt count for tracking
    conversationStateService.setState(sender, conversationStateService.constructor.STATES.COMPLETED, {
      proposalAttempts: originalRequestData?.proposalAttempts || 0
    });

    return { success: true, message: 'Request forwarded to other party' };
  }

  async proposeAlternativeTime(sender, proposedDateTime, property, originalRequestData) {
    // Find multiple available slots to give user options
    const availableSlots = await calendarService.findMultipleAvailableSlots(proposedDateTime, 3);

    if (availableSlots && availableSlots.length > 0) {
      if (availableSlots.length === 1) {
        // Single alternative - use existing template
        const alternativeMessage = conversationStateService.generateAlternativeTemplate(
          calendarService.formatDateTime(proposedDateTime),
          calendarService.formatDateTime(availableSlots[0])
        );

        await localMessageService.sendMessage(sender, alternativeMessage);

        // Set conversation state - waiting for confirmation of alternative (A/B)
        conversationStateService.setState(sender,
          conversationStateService.constructor.STATES.WAITING_FOR_CONFIRMATION,
          {
            propertyId: property._id,
            originalDateTime: proposedDateTime,
            alternativeDateTime: availableSlots[0],
            originalRequestData: originalRequestData,
            proposalAttempts: originalRequestData?.proposalAttempts || 0
          }
        );
      } else {
        // Multiple alternatives - use new multiple options template
        const timeOptions = availableSlots.map(slot => ({
          datetime: slot.toISOString(),
          display: calendarService.formatDateTime(slot)
        }));

        const multipleAlternativeMessage = conversationStateService.generateMultipleAlternativeTemplate(
          calendarService.formatDateTime(proposedDateTime),
          timeOptions
        );

        await localMessageService.sendMessage(sender, multipleAlternativeMessage);

        // Set conversation state - waiting for confirmation of one of the alternatives
        conversationStateService.setState(sender,
          conversationStateService.constructor.STATES.WAITING_FOR_CONFIRMATION,
          {
            propertyId: property._id,
            originalDateTime: proposedDateTime,
            alternativeOptions: timeOptions,
            originalRequestData: originalRequestData,
            proposalAttempts: originalRequestData?.proposalAttempts || 0
          }
        );
      }

      return { success: true, message: 'Alternative time(s) proposed' };
    } else {
      // Agent fully booked
      const noAvailabilityMessage = conversationStateService.generateAgentFullyBookedTemplate();
      await localMessageService.sendMessage(sender, noAvailabilityMessage);

      conversationStateService.setState(sender,
        conversationStateService.constructor.STATES.WAITING_FOR_CONFIRMATION,
        {
          propertyId: property._id,
          fullyBooked: true,
          originalRequestData: originalRequestData,
          proposalAttempts: originalRequestData?.proposalAttempts || 0
        }
      );

      return { success: true, message: 'Agent fully booked, call requested' };
    }
  }

  async handleViewingRequest(message, aiAnalysis = null) {
    try {
      // Extract role and property from sender ID (e.g., "buyer-property123")
      const senderInfo = await this.parseRoleId(message.from);
      if (!senderInfo) {
        await localMessageService.sendMessage(
          message.from,
          "hmm can't tell who you are. try again?",
          'agent'
        );
        return;
      }

      // Find the property based on role and property ID
      const property = await Property.findById(senderInfo.propertyId);
      if (!property) {
        await localMessageService.sendMessage(
          message.from,
          "can't find that property, call me direct",
          'agent'
        );
        return;
      }

      // Step 1: Use AI to extract proposed timing from the message
      const properties = [property];
      const aiAnalysisResult = await aiService.analyzeMessage(message.content, { properties });


      // Check if user provided multiple time options
      if (aiAnalysisResult.dateTime.hasMultiple && aiAnalysisResult.dateTime.options && aiAnalysisResult.dateTime.options.length > 0) {
        console.log(`Multiple time options detected via hasMultiple: ${aiAnalysisResult.dateTime.options.length} options`);
        return this.handleMultipleTimeProposal(message.from, property, aiAnalysisResult.dateTime.options, { originalMessage: message });
      }


      // Extract and parse the proposed date/time (single time)
      let proposedDateTime = null;

      // IMPORTANT: Check for multiple times BEFORE attempting single-time parsing
      if (aiAnalysisResult.dateTime.extracted) {
        // Handle array format first
        if (Array.isArray(aiAnalysisResult.dateTime.extracted)) {
          console.log('Detected array of times in extracted field, parsing as multiple options');
          const timeOptions = aiAnalysisResult.dateTime.extracted.map((timeStr, index) => ({
            datetime: timeStr,
            display: `Option ${index + 1}: ${moment.tz(timeStr, 'Asia/Singapore').format('dddd, MMMM Do, h:mm A')}`
          }));
          console.log(`Parsed ${timeOptions.length} time options from array`);
          return this.handleMultipleTimeProposal(message.from, property, timeOptions, { originalMessage: message });
        }
        // Handle comma-separated string format next
        else if (typeof aiAnalysisResult.dateTime.extracted === 'string' && aiAnalysisResult.dateTime.extracted.includes(',')) {
          console.log('Detected comma-separated times in extracted field, parsing as multiple options');
          const timeStrings = aiAnalysisResult.dateTime.extracted.split(',').map(t => t.trim());
          console.log('Time strings after split:', timeStrings);

          try {
            const timeOptions = timeStrings.map((timeStr, index) => {
              console.log(`Parsing time string ${index + 1}: "${timeStr}"`);
              const parsedTime = moment.tz(timeStr, 'Asia/Singapore');
              if (!parsedTime.isValid()) {
                throw new Error(`Invalid time string: ${timeStr}`);
              }
              return {
                datetime: timeStr,
                display: `Option ${index + 1}: ${parsedTime.format('dddd, MMMM Do, h:mm A')}`
              };
            });
            console.log(`Successfully parsed ${timeOptions.length} time options from comma-separated string`);
            return this.handleMultipleTimeProposal(message.from, property, timeOptions, { originalMessage: message });
          } catch (error) {
            console.error('Error parsing comma-separated times:', error);
            // Return error instead of falling through
            const errorMessage = conversationStateService.generateClarifyDateTimeTemplate();
            await localMessageService.sendMessage(message.from, errorMessage);
            conversationStateService.setState(message.from,
              conversationStateService.constructor.STATES.WAITING_FOR_NEW_TIMING,
              {
                propertyId: property._id,
                needsClarification: true
              }
            );
            return;
          }
        }
      }

      // Only proceed with single-time parsing if we don't have multiple times and it's not a comma-separated string
      if (aiAnalysisResult.dateTime.extracted &&
          !(typeof aiAnalysisResult.dateTime.extracted === 'string' && aiAnalysisResult.dateTime.extracted.includes(','))) {
        // Use moment.js to properly handle timezone-aware parsing
        if (aiAnalysisResult.dateTime.extracted.includes('T')) {
          if (aiAnalysisResult.dateTime.extracted.includes('+08:00')) {
            proposedDateTime = moment.tz(aiAnalysisResult.dateTime.extracted, 'Asia/Singapore').toDate();
          } else if (aiAnalysisResult.dateTime.extracted.includes('Z')) {
            proposedDateTime = moment.utc(aiAnalysisResult.dateTime.extracted).tz('Asia/Singapore').toDate();
          } else {
            proposedDateTime = moment.tz(aiAnalysisResult.dateTime.extracted, 'Asia/Singapore').toDate();
          }
        } else {
          proposedDateTime = moment.tz(aiAnalysisResult.dateTime.extracted, 'Asia/Singapore').toDate();
        }

        console.log(`AI extracted date/time: ${proposedDateTime}`);

        // Validate the extracted date
        if (isNaN(proposedDateTime.getTime())) {
          throw new Error(`AI extracted invalid date/time: ${aiAnalysisResult.dateTime.extracted}`);
        }
      }

      if (!proposedDateTime) {
        const errorMessage = conversationStateService.generateClarifyDateTimeTemplate();
        await localMessageService.sendMessage(message.from, errorMessage);

        conversationStateService.setState(message.from,
          conversationStateService.constructor.STATES.WAITING_FOR_NEW_TIMING,
          {
            propertyId: property._id,
            needsClarification: true
          }
        );
        return;
      }

      // Step 2: Use the central flow handler - this implements the clean logic
      const result = await this.processViewingProposal(
        message.from,
        proposedDateTime,
        property._id,
        { originalMessage: message }
      );

      console.log('Viewing proposal processed:', result);

    } catch (error) {
      console.error('Error handling viewing request:', error);
      await localMessageService.sendMessage(
        message.from,
        "Sorry, there was an error processing your request. Please try again or contact your agent directly."
      );
    }
  }

  async handleCounterProposal(message, aiAnalysis, originalRequest) {
    try {
      console.log('Handling counter-proposal with suggested time:', aiAnalysis.dateTime.extracted);

      // Extract role and property from sender ID
      const senderInfo = await this.parseRoleId(message.from);
      if (!senderInfo || !senderInfo.propertyId) {
        await localMessageService.sendMessage(message.from,
          'Sorry, I cannot identify which property this is for. Please start a new viewing request.');
        return { message: 'Cannot identify property' };
      }

      // Get property for context
      const property = await Property.findById(senderInfo.propertyId);
      if (!property) {
        await localMessageService.sendMessage(message.from,
          'Sorry, I cannot find the property details. Please contact me directly.');
        return { message: 'Property not found' };
      }

      // Check if user provided multiple time options for counter-proposal
      if (aiAnalysis.dateTime.hasMultiple && aiAnalysis.dateTime.options && aiAnalysis.dateTime.options.length > 0) {
        console.log(`Multiple counter-proposal time options detected: ${aiAnalysis.dateTime.options.length} options`);
        return this.handleMultipleCounterProposal(message.from, property, aiAnalysis.dateTime.options, originalRequest);
      }

      // Parse the suggested time using the same logic as handleViewingRequest (single time)
      let suggestedDateTime = null;
      if (aiAnalysis.dateTime.extracted) {
        if (aiAnalysis.dateTime.extracted.includes('T')) {
          if (aiAnalysis.dateTime.extracted.includes('+08:00')) {
            suggestedDateTime = moment.tz(aiAnalysis.dateTime.extracted, 'Asia/Singapore').toDate();
          } else if (aiAnalysis.dateTime.extracted.includes('Z')) {
            suggestedDateTime = moment.utc(aiAnalysis.dateTime.extracted).tz('Asia/Singapore').toDate();
          } else {
            suggestedDateTime = moment.tz(aiAnalysis.dateTime.extracted, 'Asia/Singapore').toDate();
          }
        } else {
          suggestedDateTime = moment.tz(aiAnalysis.dateTime.extracted, 'Asia/Singapore').toDate();
        }

        console.log(`Counter-proposal extracted date/time: ${suggestedDateTime}`);
      }

      if (!suggestedDateTime || isNaN(suggestedDateTime.getTime())) {
        await localMessageService.sendMessage(message.from,
          'Please suggest a specific time, for example: "Tomorrow at 2pm" or "Next Monday at 10am"');
        return { message: 'Invalid time suggestion' };
      }

      // Use the central flow handler - this implements the clean recursive logic
      const result = await this.processViewingProposal(
        message.from,
        suggestedDateTime,
        senderInfo.propertyId,
        { originalRequest, counterProposal: true }
      );

      console.log('Counter-proposal processed:', result);
      return result;

    } catch (error) {
      console.error('Error handling counter-proposal:', error);
      await localMessageService.sendMessage(
        message.from,
        "Sorry, there was an error processing your counter-proposal. Please try again."
      );
      return { message: 'Error processing counter-proposal' };
    }
  }

  parseDateTime(viewingDetails) {
    // Simple parsing - in production, use more sophisticated NLP
    const { times, dates, originalMessage } = viewingDetails;
    
    if (times.length === 0) return null;

    let baseDate = moment();
    
    // Handle relative dates
    const lowerMessage = originalMessage.toLowerCase();
    
    if (lowerMessage.includes('tomorrow')) {
      baseDate = moment().add(1, 'day');
    } else if (lowerMessage.includes('today')) {
      baseDate = moment();
    } else if (lowerMessage.includes('next monday')) {
      // Find next Monday
      baseDate = moment().add(1, 'week').startOf('week').add(1, 'day'); // Next Monday
    } else if (lowerMessage.includes('next tuesday')) {
      baseDate = moment().add(1, 'week').startOf('week').add(2, 'days');
    } else if (lowerMessage.includes('next wednesday')) {
      baseDate = moment().add(1, 'week').startOf('week').add(3, 'days');
    } else if (lowerMessage.includes('next thursday')) {
      baseDate = moment().add(1, 'week').startOf('week').add(4, 'days');
    } else if (lowerMessage.includes('next friday')) {
      baseDate = moment().add(1, 'week').startOf('week').add(5, 'days');
    } else if (lowerMessage.includes('next saturday')) {
      baseDate = moment().add(1, 'week').startOf('week').add(6, 'days');
    } else if (lowerMessage.includes('next sunday')) {
      baseDate = moment().add(1, 'week').startOf('week');
    } else if (lowerMessage.includes('monday')) {
      // This week's Monday (if not passed) or next Monday
      const thisMonday = moment().startOf('week').add(1, 'day');
      baseDate = thisMonday.isBefore(moment()) ? thisMonday.add(1, 'week') : thisMonday;
    }

    // Parse time
    const timeStr = times[0];
    const timeMatch = timeStr.match(/(\d{1,2}):?(\d{2})?\s?(am|pm)/i);
    
    if (timeMatch) {
      let hour = parseInt(timeMatch[1]);
      const minute = parseInt(timeMatch[2] || '0');
      const ampm = timeMatch[3].toLowerCase();
      
      if (ampm === 'pm' && hour !== 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      
      baseDate.hour(hour).minute(minute).second(0);
    }

    return baseDate.toDate();
  }

  async handleConfirmationResponse(message) {
    try {
      console.log(`Processing confirmation response from ${message.from}: "${message.content}"`);
      
      // This method now only handles landlord/seller confirmations to viewing requests
      // Alternative responses from tenants are handled separately
      
      // Find viewing requests where this person could be involved and status is pending or alternative
      const viewingRequests = await ViewingRequest.find({
        $or: [
          { status: 'pending_other_party' },
          { status: 'agent_suggested_alternative' }
        ]
      }).populate('property').sort({ createdAt: -1 });

      if (viewingRequests.length === 0) {
        console.log('No pending viewing requests found');
        return;
      }

      // Find the most recent request where this person is responding (could be Party A or B)
      let viewingRequest = null;
      for (const request of viewingRequests) {
        const partyARoleId = this.getOtherPartyRoleId(request.property, 
          request.property.partyA.role === 'buyer' ? 'seller' : 'landlord', 
          request.property._id);
        const partyBRoleId = this.getOtherPartyRoleId(request.property, 
          request.property.partyB.role === 'seller' ? 'buyer' : 'tenant', 
          request.property._id);
        
        if (partyARoleId === message.from || partyBRoleId === message.from) {
          viewingRequest = request;
          break;
        }
      }

      if (!viewingRequest) {
        console.log(`No pending viewing request found where ${message.from} is Party B`);
        return;
      }

      console.log(`Found viewing request: ${viewingRequest._id}, status: ${viewingRequest.status}`);
      const senderInfo = await this.parseRoleId(message.from);
      const isPartyA = (viewingRequest.requestedBy === 'partyA' && senderInfo.role === viewingRequest.property.partyA.role);
      console.log(`Message from ${message.from}, requestedBy: ${viewingRequest.requestedBy}, isPartyA: ${isPartyA}`);
      console.log(`Not from the original requester`);

      // Determine if it's a positive or negative response
      const messageContent = message.content.toLowerCase().trim();
      const isConfirmed = ['yes', 'yeah', 'yep', 'ok', 'okay', 'confirmed', 'confirm', 'agreed', 'agree'].includes(messageContent);

      console.log(`Confirmation response: ${isConfirmed ? 'CONFIRMED' : 'DECLINED'}`);

      if (isConfirmed) {
        // Create calendar event
        const startTime = moment(viewingRequest.requestedDateTime);
        const endTime = moment(startTime).add(30, 'minutes');
        
        const event = await calendarService.createEvent(
          `Property Viewing - ${viewingRequest.property.address}`,
          startTime.toDate(),
          endTime.toDate(),
          `Property viewing for ${viewingRequest.property.address}`,
          []
        );

        viewingRequest.calendarEventId = event.id;
        viewingRequest.status = 'confirmed';
        await viewingRequest.save();

        console.log(`Calendar event created: ${event.id}`);

        // Notify the requester (Party A)
        const requesterRole = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyA.role 
          : viewingRequest.property.partyB.role;
        const requesterRoleId = `${requesterRole}-${viewingRequest.property._id}`;
        const requesterName = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyA.name 
          : viewingRequest.property.partyB.name;
        const otherPartyName = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyB.name 
          : viewingRequest.property.partyA.name;

        // Determine correct roles based on who is buyer/tenant vs seller/landlord
        const requesterActualRole = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyA.role 
          : viewingRequest.property.partyB.role;
        const otherPartyActualRole = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyB.role 
          : viewingRequest.property.partyA.role;
          
        // Buyer/tenant is always visitor, seller/landlord is always host
        const requesterFinalRole = (requesterActualRole === 'buyer' || requesterActualRole === 'tenant') ? 'visitor' : 'host';
        const otherPartyFinalRole = (otherPartyActualRole === 'seller' || otherPartyActualRole === 'landlord') ? 'host' : 'visitor';

        // Use templated confirmation messages with clear A/B options
        const confirmationMessageToRequester = conversationStateService.generateConfirmationTemplate(
          viewingRequest.property.address,
          calendarService.formatDateTime(viewingRequest.requestedDateTime),
          requesterFinalRole
        );

        const confirmationMessageToOtherParty = conversationStateService.generateConfirmationTemplate(
          viewingRequest.property.address,
          calendarService.formatDateTime(viewingRequest.requestedDateTime),
          otherPartyFinalRole
        );
        
        await localMessageService.sendMessage(requesterRoleId, confirmationMessageToRequester);

        // Set conversation state for both parties to handle confirmation responses
        conversationStateService.setState(requesterRoleId,
          conversationStateService.constructor.STATES.WAITING_FOR_AVAILABILITY,
          {
            propertyId: viewingRequest.property._id,
            requestedDateTime: viewingRequest.requestedDateTime,
            viewingRequestId: viewingRequest._id,
            isConfirmation: true
          }
        );

        console.log(`Confirmation sent to requester: ${requesterRoleId}`);

        // Also confirm to Party B
        await localMessageService.sendMessage(message.from, confirmationMessageToOtherParty);

        conversationStateService.setState(message.from,
          conversationStateService.constructor.STATES.WAITING_FOR_AVAILABILITY,
          {
            propertyId: viewingRequest.property._id,
            requestedDateTime: viewingRequest.requestedDateTime,
            viewingRequestId: viewingRequest._id,
            isConfirmation: true
          }
        );

      } else {
        // Define the missing otherPartyName for the decline response
        const otherPartyName = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyB.name 
          : viewingRequest.property.partyA.name;
          
        // Use templated decline response with clear A/B/C/D options
        const declineResponse = conversationStateService.generateDeclineResponseTemplate();

        const notifyRequesterMessage = conversationStateService.generateDeclineNotificationTemplate(otherPartyName);
        
        await localMessageService.sendMessage(message.from, declineResponse);
        
        viewingRequest.status = 'rescheduling';
        await viewingRequest.save();

        // Notify Party A about the decline
        const requesterPhone = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyA.phone 
          : viewingRequest.property.partyB.phone;

        await localMessageService.sendMessage(requesterPhone, notifyRequesterMessage);
      }

      // Add this message to the viewing request history
      viewingRequest.messages.push(message);
      await viewingRequest.save();

    } catch (error) {
      console.error('Error handling confirmation response:', error);
    }
  }

  async handlePartyAAlternativeResponse(message) {
    try {
      // Look for viewing requests where Party A was offered alternative times
      // Check any viewing request with alternative slots (not just pending_agent_check)
      const viewingRequest = await ViewingRequest.findOne({
        'alternativeSlots.0': { $exists: true }, // Has alternative slots
        $or: [
          { status: 'pending_agent_check' },
          { status: 'agent_suggested_alternative' }
        ]
      }).populate('property').sort({ createdAt: -1 });

      if (!viewingRequest) {
        console.log('No viewing request with alternative slots found');
        return false; // No alternative time request found
      }

      console.log(`Found viewing request with alternative slots: ${viewingRequest._id}, status: ${viewingRequest.status}`);

      // Check if this message is from Party A (the original requester) using role IDs
      const senderInfo = await this.parseRoleId(message.from);
      const requesterRole = viewingRequest.requestedBy === 'partyA' ? viewingRequest.property.partyA.role : viewingRequest.property.partyB.role;
      const isPartyA = senderInfo && senderInfo.role === requesterRole;

      console.log(`Message from ${message.from}, requestedBy: ${viewingRequest.requestedBy}, isPartyA: ${isPartyA}`);

      if (!isPartyA) {
        console.log('Not from the original requester');
        return false; // Not from the original requester
      }

      // Check if it's a positive response to the alternative time
      const messageContent = message.content.toLowerCase().trim();
      const isAccepted = ['yes', 'yeah', 'yep', 'ok', 'okay', 'confirmed', 'confirm', 'agreed', 'agree', 'option_a', 'a'].includes(messageContent);

      if (!isAccepted) {
        return false; // Not accepting the alternative time
      }

      console.log(`Party A accepted alternative time suggestion`);

      // Get the most recent alternative slot
      const alternativeSlot = viewingRequest.alternativeSlots[viewingRequest.alternativeSlots.length - 1];
      
      // Update the viewing request with the new time
      viewingRequest.requestedDateTime = alternativeSlot.dateTime;
      viewingRequest.status = 'pending_other_party';
      await viewingRequest.save();

      // Now send to Party B with the new time
      const otherParty = viewingRequest.requestedBy === 'partyA' ? viewingRequest.property.partyB : viewingRequest.property.partyA;
      
      const requesterName = viewingRequest.requestedBy === 'partyA' ? 
        viewingRequest.property.partyA.name : 
        viewingRequest.property.partyB.name;

      // Use templated alternative accepted message with clear A/B/C options
      const casualMessage = conversationStateService.generateAlternativeAcceptedTemplate(
        requesterName,
        viewingRequest.property.address,
        calendarService.formatDateTime(alternativeSlot.dateTime)
      );

      // Get the actual requesting party's role, then determine other party role
      const requestingPartyRole = viewingRequest.requestedBy === 'partyA'
        ? viewingRequest.property.partyA.role
        : viewingRequest.property.partyB.role;

      const otherPartyRoleId = this.getOtherPartyRoleId(viewingRequest.property,
        requestingPartyRole,
        viewingRequest.property._id);

      await localMessageService.sendMessage(otherPartyRoleId, casualMessage);

      // Set conversation state for the other party to wait for their confirmation
      conversationStateService.setState(otherPartyRoleId,
        conversationStateService.constructor.STATES.WAITING_FOR_AVAILABILITY,
        {
          propertyId: viewingRequest.property._id,
          requestedDateTime: alternativeSlot.dateTime,
          viewingRequestId: viewingRequest._id,
          requesterName: requesterName
        }
      );

      console.log(`Alternative time forwarded to Party B: ${otherPartyRoleId}`);

      // Confirm to Party A that we've sent the request
      await localMessageService.sendMessage(
        message.from,
        `cool! sent to ${otherParty.name} for ${calendarService.formatDateTime(alternativeSlot.dateTime)}`
      );

      // Add this message to the viewing request history
      viewingRequest.messages.push(message);
      await viewingRequest.save();

      return {
        message: 'Alternative time accepted and forwarded to landlord',
        success: true,
        viewingRequest: viewingRequest,
        nextStep: 'waiting_for_landlord_confirmation'
      }; // Successfully handled Party A response

    } catch (error) {
      console.error('Error handling Party A alternative response:', error);
      return {
        message: 'Error processing alternative time response',
        success: false,
        error: error.message
      };
    }
  }

  // Keep the old method for backward compatibility
  async handleConfirmation(message, isConfirmed) {
    return this.handleConfirmationResponse({
      ...message,
      content: isConfirmed ? 'yes' : 'no'
    });
  }

  // Helper method to parse role ID (e.g., "buyer-64f1b2c3d4e5f6g7h8i9j0k1")
  async parseRoleId(roleId) {
    if (roleId === 'agent') {
      return { role: 'agent', propertyId: null };
    }

    const parts = roleId.split('-');
    if (parts.length >= 2) {
      return {
        role: parts[0],
        propertyId: parts[1]
      };
    }

    // Fallback for testing scenarios where only role name is provided (e.g., "buyer", "seller")
    // Find the first property that has this role and use it
    const Property = require('../models/Property');
    try {
      const properties = await Property.find();
      for (const property of properties) {
        if (property.partyA && property.partyA.role === roleId) {
          console.log(`🔄 Fallback: Mapping role '${roleId}' to property ${property._id} (partyA)`);
          return {
            role: roleId,
            propertyId: property._id.toString()
          };
        }
        if (property.partyB && property.partyB.role === roleId) {
          console.log(`🔄 Fallback: Mapping role '${roleId}' to property ${property._id} (partyB)`);
          return {
            role: roleId,
            propertyId: property._id.toString()
          };
        }
      }
    } catch (error) {
      console.error('Error in parseRoleId fallback:', error);
    }

    return null;
  }

  // Helper method to get the other party's role ID from a property
  getOtherPartyRoleId(property, currentRole, currentPropertyId) {
    console.log(`getOtherPartyRoleId: currentRole="${currentRole}", partyA.role="${property.partyA.role}", partyB.role="${property.partyB.role}"`);

    if (currentRole === property.partyA.role) {
      // Current sender is Party A, so other party is Party B
      const result = `${property.partyB.role}-${currentPropertyId}`;
      console.log(`Returning Party B roleId: ${result}`);
      return result;
    } else if (currentRole === property.partyB.role) {
      // Current sender is Party B, so other party is Party A
      const result = `${property.partyA.role}-${currentPropertyId}`;
      console.log(`Returning Party A roleId: ${result}`);
      return result;
    }

    console.log(`No role match found, returning null`);
    return null;
  }

  // Helper method to format role for display
  formatRoleDisplay(role, propertyAddress) {
    const propertyTag = this.getPropertyTag(propertyAddress);
    
    if (role === 'seller' || role === 'landlord') {
      return `${this.capitalizeFirst(role)} (${propertyTag})`;
    }
    
    if (role === 'buyer' || role === 'tenant') {
      return `${this.capitalizeFirst(role)} (${propertyTag})`;
    }
    
    return this.capitalizeFirst(role);
  }

  getPropertyTag(address) {
    if (address.toLowerCase().includes('marina bay')) return 'Marina Bay';
    if (address.toLowerCase().includes('orchard')) return 'Orchard';
    if (address.toLowerCase().includes('sentosa')) return 'Sentosa';
    
    const words = address.split(' ');
    return words.length > 1 ? `${words[0]} ${words[1]}` : words[0];
  }

  capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  // Helper method to determine which party is making the request
  determineRequestingParty(role, property) {
    if (role === property.partyA.role) {
      return 'partyA';
    } else if (role === property.partyB.role) {
      return 'partyB';
    }

    // Default fallback
    return 'partyA';
  }

  // Handle initial viewing request with multiple time options
  async handleMultipleTimeProposal(sender, property, timeOptions, originalRequestData) {
    try {
      console.log(`Processing multiple time proposal from ${sender} with ${timeOptions.length} options`);

      // Determine who the other party is
      const senderInfo = await this.parseRoleId(sender);
      const otherPartyRoleId = this.getOtherPartyRoleId(property, senderInfo.role, property._id);
      const otherParty = senderInfo.role === property.partyA.role ? property.partyB : property.partyA;
      const senderName = senderInfo.role === property.partyA.role ? property.partyA.name : property.partyB.name;

      // Check calendar availability for each time option and filter out conflicts
      const availableTimeOptions = [];
      console.log('Checking calendar availability for time options...');

      for (const timeOption of timeOptions) {
        try {
          const datetime = new Date(timeOption.datetime);
          const isAvailable = await calendarService.checkAvailability(datetime);

          if (isAvailable) {
            availableTimeOptions.push(timeOption);
            console.log(`✓ Time slot available: ${timeOption.display}`);
          } else {
            console.log(`✗ Time slot unavailable (conflict): ${timeOption.display}`);
          }
        } catch (error) {
          console.error(`Error checking availability for ${timeOption.display}:`, error);
          // If calendar check fails, assume unavailable for safety
          console.log(`✗ Time slot marked unavailable due to error: ${timeOption.display}`);
        }
      }

      // If no times are available, suggest alternative times
      if (availableTimeOptions.length === 0) {
        console.log('No proposed times are available, finding alternative slots...');

        // Try to find alternative available slots
        const firstProposedTime = new Date(timeOptions[0].datetime);
        const alternativeSlots = await calendarService.findMultipleAvailableSlots(firstProposedTime, 3);

        if (alternativeSlots.length > 0) {
          // Convert alternative slots to the expected format
          alternativeSlots.forEach((slot, index) => {
            availableTimeOptions.push({
              datetime: slot.toISOString(),
              display: `Alternative ${index + 1}: ${moment.tz(slot, 'Asia/Singapore').format('dddd, MMMM Do, h:mm A')}`
            });
          });

          // Send message about conflicts and alternatives
          const conflictMessage = `I'm sorry, but the times you proposed (${timeOptions.map(t => t.display).join(', ')}) are not available due to schedule conflicts. Here are some alternative times that work:`;
          await localMessageService.sendMessage(sender, conflictMessage);
        } else {
          // No alternatives found
          const noAvailabilityMessage = `I'm sorry, but the times you proposed are not available due to schedule conflicts, and I couldn't find suitable alternatives. Please propose different times or contact me directly to discuss scheduling.`;
          await localMessageService.sendMessage(sender, noAvailabilityMessage);
          return;
        }
      } else if (availableTimeOptions.length < timeOptions.length) {
        // Some times were filtered out due to conflicts - inform buyer about specific conflicts
        const conflictedTimes = timeOptions.filter(original =>
          !availableTimeOptions.some(available => available.datetime === original.datetime)
        );
        console.log(`Filtered out ${conflictedTimes.length} conflicting time(s): ${conflictedTimes.map(t => t.display).join(', ')}`);

        // Send message to buyer about specific conflicts
        const conflictMessage = `I have an existing appointment at ${conflictedTimes.map(t => t.display).join(' and ')}, but I'm forwarding your other time options (${availableTimeOptions.map(t => t.display).join(', ')}) to the ${senderInfo.role === 'buyer' ? 'seller' : 'landlord'} for their selection.`;
        await localMessageService.sendMessage(sender, conflictMessage);
      }

      console.log(`Proceeding with ${availableTimeOptions.length} available time options`);

      // Send multiple time proposal to other party with A/B/C/D/E/F options
      const multipleTimeMessage = conversationStateService.generateMultipleTimeProposalTemplate(
        property.address,
        availableTimeOptions
      );

      const confirmationMessage = conversationStateService.generateRequestForwardedTemplate(
        otherParty.name,
        `multiple time options`,
        senderInfo.role
      );

      await localMessageService.sendMessage(otherPartyRoleId, multipleTimeMessage);
      await localMessageService.sendMessage(sender, confirmationMessage);

      // Set conversation state for the other party - waiting for selection from multiple options
      conversationStateService.setState(otherPartyRoleId,
        conversationStateService.constructor.STATES.WAITING_FOR_CONFIRMATION,
        {
          propertyId: property._id,
          multipleTimeOptions: availableTimeOptions,
          requesterName: senderName,
          originalRequestData: originalRequestData
        }
      );

      // Set sender state to completed (they've done their part)
      conversationStateService.setState(sender, conversationStateService.constructor.STATES.COMPLETED, {
        proposalAttempts: originalRequestData?.proposalAttempts || 0
      });

      return { success: true, message: 'Multiple time options forwarded to other party' };

    } catch (error) {
      console.error('Error handling multiple time proposal:', error);
      await localMessageService.sendMessage(sender,
        'Sorry, there was an error processing your time options. Please try again.');
      return { success: false, message: 'Error processing multiple time proposal' };
    }
  }

  // Handle counter-proposal with multiple time options
  async handleMultipleCounterProposal(sender, property, timeOptions, originalRequest) {
    try {
      console.log(`Processing multiple counter-proposal from ${sender} with ${timeOptions.length} options`);

      // Determine who the other party is
      const senderInfo = await this.parseRoleId(sender);
      const otherPartyRoleId = this.getOtherPartyRoleId(property, senderInfo.role, property._id);
      const otherParty = senderInfo.role === property.partyA.role ? property.partyB : property.partyA;
      const senderName = senderInfo.role === property.partyA.role ? property.partyA.name : property.partyB.name;

      // Send multiple counter-proposal to other party with A/B/C/D/E/F options
      const multipleCounterMessage = conversationStateService.generateMultipleCounterProposalTemplate(
        senderName,
        property.address,
        timeOptions
      );

      const confirmationMessage = conversationStateService.generateRequestForwardedTemplate(
        otherParty.name,
        `alternative time options`,
        senderInfo.role
      );

      await localMessageService.sendMessage(otherPartyRoleId, multipleCounterMessage);
      await localMessageService.sendMessage(sender, confirmationMessage);

      // Set conversation state for the other party - waiting for selection from multiple options
      conversationStateService.setState(otherPartyRoleId,
        conversationStateService.constructor.STATES.WAITING_FOR_CONFIRMATION,
        {
          propertyId: property._id,
          multipleTimeOptions: timeOptions,
          requesterName: senderName,
          originalRequestData: { originalRequest, counterProposal: true },
          isCounterProposal: true
        }
      );

      // Set sender state to completed (they've done their part)
      conversationStateService.setState(sender, conversationStateService.constructor.STATES.COMPLETED, {
        proposalAttempts: originalRequest?.proposalAttempts || 0
      });

      return { success: true, message: 'Multiple counter-proposal options forwarded to other party' };

    } catch (error) {
      console.error('Error handling multiple counter-proposal:', error);
      await localMessageService.sendMessage(sender,
        'Sorry, there was an error processing your counter-proposal options. Please try again.');
      return { success: false, message: 'Error processing multiple counter-proposal' };
    }
  }

  // Complete viewing confirmation when final party confirms
  async completeViewingConfirmation(confirmingUserId, confirmedDateTime, propertyId, viewingData) {
    try {
      console.log(`Completing viewing confirmation for property ${propertyId} at ${confirmedDateTime}`);

      // Get property details
      const property = await Property.findById(propertyId);
      if (!property) {
        console.error('Property not found for final confirmation');
        return { success: false, message: 'Property not found' };
      }

      // Determine who confirmed and who needs to be notified
      const confirmingUserInfo = await this.parseRoleId(confirmingUserId);
      const otherPartyRoleId = this.getOtherPartyRoleId(property, confirmingUserInfo.role, propertyId);

      const confirmingParty = confirmingUserInfo.role === property.partyA.role ? property.partyA : property.partyB;
      const otherParty = confirmingUserInfo.role === property.partyA.role ? property.partyB : property.partyA;

      console.log(`${confirmingParty.name} (${confirmingUserInfo.role}) confirmed, notifying ${otherParty.name} (${otherParty.role})`);

      // 1. Notify the other party about the confirmation
      const confirmationNotification = `Great news! ${confirmingParty.name} has confirmed your viewing at ${property.address} on ${calendarService.formatDateTime(confirmedDateTime)}. You're all set!`;
      await localMessageService.sendMessage(otherPartyRoleId, confirmationNotification);

      // 2. Create Google Calendar event
      const calendarEvent = await this.createCalendarEvent(property, confirmedDateTime, confirmingParty, otherParty);

      // 3. Mark the other party's conversation as completed too
      conversationStateService.setState(otherPartyRoleId, conversationStateService.constructor.STATES.COMPLETED);

      console.log(`Viewing confirmation completed successfully. Calendar event: ${calendarEvent ? 'created' : 'failed'}`);

      return {
        success: true,
        message: 'Viewing fully confirmed',
        calendarEvent,
        notifiedParty: otherPartyRoleId
      };

    } catch (error) {
      console.error('Error completing viewing confirmation:', error);
      return { success: false, message: 'Error completing confirmation', error: error.message };
    }
  }

  // Create calendar event for confirmed viewing
  async createCalendarEvent(property, dateTime, party1, party2) {
    try {
      const eventTitle = `Property Viewing - ${property.address}`;
      const eventDescription = `Property viewing arranged between ${party1.name} (${party1.role}) and ${party2.name} (${party2.role})`;

      // Use calendar service to create the event
      const endTime = moment(dateTime).add(1, 'hour').toDate(); // 1 hour viewing
      const attendees = [
        party1.phone + '@example.com', // Mock email format
        party2.phone + '@example.com'
      ];

      const calendarResult = await calendarService.createEvent(
        eventTitle,
        dateTime,
        endTime,
        eventDescription,
        attendees
      );

      return calendarResult;
    } catch (error) {
      console.error('Error creating calendar event:', error);
      return null;
    }
  }
}

module.exports = new ViewingService();