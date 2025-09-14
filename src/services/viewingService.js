const Property = require('../models/Property');
const ViewingRequest = require('../models/ViewingRequest');
const localMessageService = require('./localMessageService');
const calendarService = require('./calendarService');
const aiService = require('./aiService');
const conversationStateService = require('./conversationStateService');
const moment = require('moment-timezone');

class ViewingService {
  async handleViewingRequest(message, aiAnalysis = null) {
    try {
      // Extract role and property from sender ID (e.g., "buyer-property123")
      const senderInfo = this.parseRoleId(message.from);
      if (!senderInfo) {
        await localMessageService.sendMessage(
          message.from,
          "hmm can't tell who you are. try again?",
          'agent'
        );
        return;
      }

      // Find the property based on role and property ID
      let property = await Property.findById(senderInfo.propertyId);
      if (!property) {
        await localMessageService.sendMessage(
          message.from,
          "can't find that property, call me direct",
          'agent'
        );
        return;
      }

      const properties = [property]; // Convert to array for compatibility

      // AI-enhanced property matching and message analysis  
      let aiAnalysis = null;
      
      aiAnalysis = await aiService.analyzeMessage(message.content, { properties });
      
      // Use AI to match property
      if (aiAnalysis.property.matched && aiAnalysis.property.confidence > 0.6) {
        property = properties.find(p => 
          p.address.toLowerCase().includes(aiAnalysis.property.matched.toLowerCase())
        );
        console.log(`AI matched property: ${aiAnalysis.property.matched} (confidence: ${aiAnalysis.property.confidence})`);
      }
      
      // If AI couldn't match with high confidence, require manual specification
      if (!property) {
        if (properties.length === 1) {
          property = properties[0];
          console.log(`Using single available property: ${property.address}`);
        } else {
          await localMessageService.sendMessage(
            message.from,
            `which property? i've got: ${properties.map(p => p.address).join(', ')}`
          );
          return;
        }
      }

      // This should never happen now since we check properties.length above
      if (!property) {
        await localMessageService.sendMessage(
          message.from,
          "no property found for you, call me direct"
        );
        return;
      }

      // Determine who is requesting (partyA or partyB) based on role
      const requestedBy = this.determineRequestingParty(senderInfo.role, property);
      
      // AI date/time extraction
      let requestedDateTime = null;
      
      if (aiAnalysis.dateTime.extracted) {
        // Use moment.js to properly handle timezone-aware parsing
        if (aiAnalysis.dateTime.extracted.includes('T')) {
          // ISO string from AI - parse with timezone awareness
          if (aiAnalysis.dateTime.extracted.includes('+08:00')) {
            // Singapore timezone format
            requestedDateTime = moment.tz(aiAnalysis.dateTime.extracted, 'Asia/Singapore').toDate();
          } else if (aiAnalysis.dateTime.extracted.includes('Z')) {
            // UTC format - convert to Singapore timezone
            requestedDateTime = moment.utc(aiAnalysis.dateTime.extracted).tz('Asia/Singapore').toDate();
          } else {
            // ISO format without timezone - assume Singapore time
            requestedDateTime = moment.tz(aiAnalysis.dateTime.extracted, 'Asia/Singapore').toDate();
          }
        } else {
          // Try parsing as is with Singapore timezone
          requestedDateTime = moment.tz(aiAnalysis.dateTime.extracted, 'Asia/Singapore').toDate();
        }
        
        console.log(`AI extracted date/time: ${requestedDateTime}`);
        console.log(`Original AI string: ${aiAnalysis.dateTime.extracted}`);
        console.log(`Formatted for display: ${moment(requestedDateTime).tz('Asia/Singapore').format('dddd, MMMM Do YYYY, h:mm A')}`);
        
        // Validate the extracted date
        if (isNaN(requestedDateTime.getTime())) {
          throw new Error(`AI extracted invalid date/time: ${aiAnalysis.dateTime.extracted}`);
        }
      }

      if (!requestedDateTime) {
        const errorMessage = await aiService.generateResponse('clarify_datetime', { 
          context: "User didn't specify clear date/time" 
        });
        
        await localMessageService.sendMessage(message.from, errorMessage);
        return;
      }

      // Create viewing request
      const viewingRequest = new ViewingRequest({
        property: property._id,
        requestedBy,
        requestedDateTime,
        messages: [message]
      });

      await viewingRequest.save();

      // Check agent's availability
      const isAgentAvailable = await calendarService.checkAvailability(requestedDateTime);

      if (!isAgentAvailable) {
        const nextSlot = await calendarService.findNextAvailableSlot(requestedDateTime);
        
        if (nextSlot) {
          const formattedTime = calendarService.formatDateTime(nextSlot);
          
          // Generate AI alternative time suggestion - be honest about agent availability
          const alternativeMessage = await aiService.generateResponse('agent_unavailable_alternative', {
            propertyAddress: property.address,
            dateTime: calendarService.formatDateTime(requestedDateTime),
            alternativeTime: formattedTime,
            responseType: 'agent_unavailable_alternative',
            context: aiAnalysis.context
          });
          
          await localMessageService.sendMessage(message.from, alternativeMessage);
          
          viewingRequest.alternativeSlots.push({
            dateTime: nextSlot,
            suggestedBy: 'agent'
          });
          viewingRequest.status = 'agent_suggested_alternative';
        } else {
          // Generate AI no availability message - be honest about agent schedule
          const noAvailabilityMessage = await aiService.generateResponse('agent_fully_booked', {
            propertyAddress: property.address,
            responseType: 'agent_fully_booked',
            context: aiAnalysis.context
          });
          
          await localMessageService.sendMessage(message.from, noAvailabilityMessage);
        }
        
        await viewingRequest.save();
        return;
      }

      // Agent is available, forward to other party
      const otherParty = requestedBy === 'partyA' ? property.partyB : property.partyA;
      const requesterName = requestedBy === 'partyA' ? property.partyA.name : property.partyB.name;
      const otherPartyRoleId = this.getOtherPartyRoleId(property, 
        senderInfo.role, 
        senderInfo.propertyId);
      
      
      // Generate AI forwarding message
      const forwardingMessage = await aiService.generateResponse('forward_to_seller', {
        propertyAddress: property.address,
        dateTime: calendarService.formatDateTime(requestedDateTime),
        recipientName: otherParty.name,
        senderName: requesterName,
        responseType: 'forward_to_seller'
      });
      
      const confirmationMessage = await aiService.generateResponse('request_forwarded', {
        propertyAddress: property.address,
        dateTime: calendarService.formatDateTime(requestedDateTime),
        recipientName: otherParty.name,
        responseType: 'request_forwarded',
        context: aiAnalysis.context
      });
      
      await localMessageService.sendMessage(otherPartyRoleId, forwardingMessage);
      await localMessageService.sendMessage(message.from, confirmationMessage);

      viewingRequest.status = 'pending_other_party';
      await viewingRequest.save();

    } catch (error) {
      console.error('Error handling viewing request:', error);
      await localMessageService.sendMessage(
        message.from,
        "Sorry, there was an error processing your request. Please try again or contact your agent directly."
      );
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
      const senderInfo = this.parseRoleId(message.from);
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

        // Generate AI confirmation messages
        const confirmationMessageToRequester = await aiService.generateResponse('final_confirmation', {
          propertyAddress: viewingRequest.property.address,
          dateTime: calendarService.formatDateTime(viewingRequest.requestedDateTime),
          recipientName: requesterName,
          recipientRole: requesterFinalRole,
          otherPartyName: otherPartyName,
          responseType: 'final_confirmation'
        });
        
        const confirmationMessageToOtherParty = await aiService.generateResponse('final_confirmation', {
          propertyAddress: viewingRequest.property.address,
          dateTime: calendarService.formatDateTime(viewingRequest.requestedDateTime),
          recipientName: otherPartyName,
          recipientRole: otherPartyFinalRole,
          requesterName: requesterName,
          responseType: 'final_confirmation'
        });
        
        await localMessageService.sendMessage(requesterRoleId, confirmationMessageToRequester);
        console.log(`Confirmation sent to requester: ${requesterRoleId}`);

        // Also confirm to Party B
        await localMessageService.sendMessage(message.from, confirmationMessageToOtherParty);

      } else {
        // Define the missing otherPartyName for the decline response
        const otherPartyName = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyB.name 
          : viewingRequest.property.partyA.name;
          
        // Generate AI decline response
        const declineResponse = await aiService.generateResponse('decline_response', {
          propertyAddress: viewingRequest.property.address,
          dateTime: calendarService.formatDateTime(viewingRequest.requestedDateTime),
          responseType: 'decline_response'
        });
        
        const notifyRequesterMessage = await aiService.generateResponse('notify_decline', {
          propertyAddress: viewingRequest.property.address,
          dateTime: calendarService.formatDateTime(viewingRequest.requestedDateTime),
          otherPartyName: otherPartyName
        });
        
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
      const senderInfo = this.parseRoleId(message.from);
      const requesterRole = viewingRequest.requestedBy === 'partyA' ? viewingRequest.property.partyA.role : viewingRequest.property.partyB.role;
      const isPartyA = senderInfo && senderInfo.role === requesterRole;

      console.log(`Message from ${message.from}, requestedBy: ${viewingRequest.requestedBy}, isPartyA: ${isPartyA}`);

      if (!isPartyA) {
        console.log('Not from the original requester');
        return false; // Not from the original requester
      }

      // Check if it's a positive response to the alternative time
      const messageContent = message.content.toLowerCase().trim();
      const isAccepted = ['yes', 'yeah', 'yep', 'ok', 'okay', 'confirmed', 'confirm', 'agreed', 'agree'].includes(messageContent);

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

      // Generate casual message using AI
      const casualMessage = await aiService.generateResponse('forward_to_seller', {
        propertyAddress: viewingRequest.property.address,
        dateTime: calendarService.formatDateTime(alternativeSlot.dateTime),
        recipientName: otherParty.name,
        senderName: requesterName,
        responseType: 'forward_to_seller'
      });

      await localMessageService.sendMessage(
        this.getOtherPartyRoleId(viewingRequest.property, 
          viewingRequest.requestedBy === 'partyA' ? 'buyer' : 'tenant', 
          viewingRequest.property._id),
        casualMessage
      );

      console.log(`Alternative time forwarded to Party B: ${this.getOtherPartyRoleId(viewingRequest.property, 
          viewingRequest.requestedBy === 'partyA' ? 'buyer' : 'tenant', 
          viewingRequest.property._id)}`);

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
  parseRoleId(roleId) {
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

    return null;
  }

  // Helper method to get the other party's role ID from a property
  getOtherPartyRoleId(property, currentRole, currentPropertyId) {
    if (currentRole === property.partyA.role) {
      // Current sender is Party A, so other party is Party B
      return `${property.partyB.role}-${currentPropertyId}`;
    } else if (currentRole === property.partyB.role) {
      // Current sender is Party B, so other party is Party A
      return `${property.partyA.role}-${currentPropertyId}`;
    }
    
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
}

module.exports = new ViewingService();