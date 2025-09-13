const Property = require('../models/Property');
const ViewingRequest = require('../models/ViewingRequest');
const whatsappService = require('./whatsappService');
const calendarService = require('./calendarService');
const aiService = require('./aiService');
const moment = require('moment-timezone');

class ViewingService {
  async handleViewingRequest(message) {
    try {
      // Find all properties associated with sender's phone number
      const properties = await Property.find({
        $or: [
          { 'partyA.phone': message.from },
          { 'partyB.phone': message.from }
        ]
      });

      if (properties.length === 0) {
        await whatsappService.sendMessage(
          message.from,
          "Sorry, I couldn't find a property associated with your number. Please contact your agent directly."
        );
        return;
      }

      // AI-enhanced property matching and message analysis
      let property = null;
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
          await whatsappService.sendMessage(
            message.from,
            `I need you to be more specific about which property you're referring to. Available properties: ${properties.map(p => p.address).join(', ')}`
          );
          return;
        }
      }

      // This should never happen now since we check properties.length above
      if (!property) {
        await whatsappService.sendMessage(
          message.from,
          "Sorry, I couldn't find a property associated with your number. Please contact your agent directly."
        );
        return;
      }

      // Determine who is requesting (partyA or partyB)
      const requestedBy = property.partyA.phone === message.from ? 'partyA' : 'partyB';
      
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
        
        await whatsappService.sendMessage(message.from, errorMessage);
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
          
          await whatsappService.sendMessage(message.from, alternativeMessage);
          
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
          
          await whatsappService.sendMessage(message.from, noAvailabilityMessage);
        }
        
        await viewingRequest.save();
        return;
      }

      // Agent is available, forward to other party
      const otherParty = requestedBy === 'partyA' ? property.partyB : property.partyA;
      const requesterName = requestedBy === 'partyA' ? property.partyA.name : property.partyB.name;
      
      
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
      
      await whatsappService.sendMessage(otherParty.phone, forwardingMessage);
      await whatsappService.sendMessage(message.from, confirmationMessage);

      viewingRequest.status = 'pending_other_party';
      await viewingRequest.save();

    } catch (error) {
      console.error('Error handling viewing request:', error);
      await whatsappService.sendMessage(
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
      
      // First check if this is Party A responding to an alternative time suggestion
      const partyAResponse = await this.handlePartyAAlternativeResponse(message);
      if (partyAResponse) {
        return; // Party A response was handled
      }
      
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

      // Find the most recent request where this person is Party B
      let viewingRequest = null;
      for (const request of viewingRequests) {
        if (request.property.partyB.phone === message.from) {
          viewingRequest = request;
          break;
        }
      }

      if (!viewingRequest) {
        console.log(`No pending viewing request found where ${message.from} is Party B`);
        return;
      }

      console.log(`Found viewing request: ${viewingRequest._id}, status: ${viewingRequest.status}`);
      console.log(`Message from ${message.from}, requestedBy: ${viewingRequest.requestedBy}, isPartyA: ${viewingRequest.requestedBy === 'partyA' && viewingRequest.property.partyA.phone === message.from}`);
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
        const requesterPhone = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyA.phone 
          : viewingRequest.property.partyB.phone;
        const requesterName = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyA.name 
          : viewingRequest.property.partyB.name;
        const otherPartyName = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyB.name 
          : viewingRequest.property.partyA.name;

        // Generate AI confirmation messages
        const confirmationMessageToRequester = await aiService.generateResponse('final_confirmation', {
          propertyAddress: viewingRequest.property.address,
          dateTime: calendarService.formatDateTime(viewingRequest.requestedDateTime),
          recipientName: requesterName,
          recipientRole: 'visitor', // Party A is the visitor viewing the property
          otherPartyName: otherPartyName,
          responseType: 'final_confirmation'
        });
        
        const confirmationMessageToOtherParty = await aiService.generateResponse('final_confirmation', {
          propertyAddress: viewingRequest.property.address,
          dateTime: calendarService.formatDateTime(viewingRequest.requestedDateTime),
          recipientName: otherPartyName,
          recipientRole: 'host', // Party B is the host showing the property
          requesterName: requesterName,
          responseType: 'final_confirmation'
        });
        
        await whatsappService.sendMessage(requesterPhone, confirmationMessageToRequester);
        console.log(`Confirmation sent to requester: ${requesterPhone}`);

        // Also confirm to Party B
        await whatsappService.sendMessage(message.from, confirmationMessageToOtherParty);

      } else {
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
        
        await whatsappService.sendMessage(message.from, declineResponse);
        
        viewingRequest.status = 'rescheduling';
        await viewingRequest.save();

        // Notify Party A about the decline
        const requesterPhone = viewingRequest.requestedBy === 'partyA' 
          ? viewingRequest.property.partyA.phone 
          : viewingRequest.property.partyB.phone;

        await whatsappService.sendMessage(requesterPhone, notifyRequesterMessage);
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

      // Check if this message is from Party A (the original requester)
      const isPartyA = (viewingRequest.requestedBy === 'partyA' && viewingRequest.property.partyA.phone === message.from) ||
                       (viewingRequest.requestedBy === 'partyB' && viewingRequest.property.partyB.phone === message.from);

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

      await whatsappService.sendMessage(
        otherParty.phone,
        `Hi ${otherParty.name}, ${requesterName} would like to view ${viewingRequest.property.address} on ${calendarService.formatDateTime(alternativeSlot.dateTime)}. Are you available? Reply YES to confirm or suggest alternative times.`
      );

      console.log(`Alternative time forwarded to Party B: ${otherParty.phone}`);

      // Confirm to Party A that we've sent the request
      await whatsappService.sendMessage(
        message.from,
        `Perfect! I've sent your updated viewing request to ${otherParty.name} for ${calendarService.formatDateTime(alternativeSlot.dateTime)}. You'll hear back shortly.`
      );

      // Add this message to the viewing request history
      viewingRequest.messages.push(message);
      await viewingRequest.save();

      return true; // Successfully handled Party A response

    } catch (error) {
      console.error('Error handling Party A alternative response:', error);
      return false;
    }
  }

  // Keep the old method for backward compatibility
  async handleConfirmation(message, isConfirmed) {
    return this.handleConfirmationResponse({
      ...message,
      content: isConfirmed ? 'yes' : 'no'
    });
  }
}

module.exports = new ViewingService();