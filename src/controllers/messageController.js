const localMessageService = require('../services/localMessageService');
const viewingService = require('../services/viewingService');
const aiService = require('../services/aiService');
const conversationStateService = require('../services/conversationStateService');
const Property = require('../models/Property');

class MessageController {
  async sendMessage(req, res) {
    try {
      const { from, to, content } = req.body;
      
      if (!from || !content) {
        return res.status(400).json({ error: 'From and content are required' });
      }

      // Store the incoming message
      const incomingMessage = await localMessageService.receiveMessage(from, to || 'system', content);
      
      // Process the message through the existing business logic
      const message = localMessageService.parseIncomingMessage({
        from: from,
        to: to || 'system',
        content: content
      });

      console.log('Processing message:', message);

      let response = null;
      
      // Get current conversation state
      const currentState = conversationStateService.getState(from);
      console.log(`User ${from} is in state: ${currentState.state}`);
      
      try {
        // Handle based on simplified conversation states
        if (currentState.state === 'waiting_for_confirmation' || currentState.state === 'waiting_for_new_timing') {
          // Handle A/B templated responses
          console.log('Handling templated A/B response');
          const stateResponse = await conversationStateService.handleResponse(from, message, currentState);
          response = {
            message: 'Response processed',
            action: stateResponse.action,
            state: currentState.state
          };
        } else if (currentState.state === 'waiting_for_request') {
          // Handle initial requests or counter-proposals with natural language timing
          if (currentState.data?.isCounterProposal) {
            console.log('Processing counter-proposal time suggestion');

            // Get available properties for context
            const properties = await Property.find();

            // Use AI to parse the suggested time with enhanced context
            // Handle multiple possible field names for the original datetime
            const originalDateTime = currentState.data.originalRequest?.requestedDateTime ||
                                   currentState.data.originalRequest?.proposedDateTime ||
                                   currentState.data.originalRequest?.originalDateTime;


            const originalDateStr = originalDateTime ? new Date(originalDateTime).toDateString() : 'the original proposed date';

            const aiAnalysis = await aiService.analyzeMessage(message.content, {
              properties,
              currentSender: from,
              isCounterProposal: true,
              originalContext: currentState.data.originalRequest,
              originalDateTime: originalDateTime,
              contextHint: `The user is suggesting an alternative time for ${originalDateStr}. If they only mention a time (like "5pm"), assume it's for ${originalDateStr}, NOT today. Original date context: ${originalDateStr}`
            });

            console.log('Debug - AI Analysis dateTime:', JSON.stringify(aiAnalysis.dateTime));
            console.log('Debug - originalDateTime:', originalDateTime);
            console.log('Debug - condition checks:', {
              extracted: !!aiAnalysis.dateTime.extracted,
              hasTime: !!aiAnalysis.dateTime.time,
              hasOriginalDateTime: !!originalDateTime
            });

            if (aiAnalysis.dateTime.extracted) {
              console.log('Counter-proposal time detected:', aiAnalysis.dateTime.extracted);
              // Use the central flow handler
              response = await viewingService.handleCounterProposal(message, aiAnalysis, currentState.data.originalRequest);
            } else if (aiAnalysis.dateTime.time && originalDateTime) {
              // AI extracted only time, not full date - construct full datetime using original date
              console.log(`AI extracted time (${aiAnalysis.dateTime.time}) but not full date. Constructing full datetime using original date.`);
              console.log('Debug - aiAnalysis.dateTime:', JSON.stringify(aiAnalysis.dateTime));
              console.log('Debug - originalDateTime:', originalDateTime);

              const originalDate = new Date(originalDateTime);
              const [hours, minutes] = aiAnalysis.dateTime.time.split(':');
              const newDateTime = new Date(originalDate.getFullYear(), originalDate.getMonth(), originalDate.getDate(), parseInt(hours), parseInt(minutes || '0'));

              // Construct enhanced AI analysis with full datetime
              const enhancedAnalysis = {
                ...aiAnalysis,
                dateTime: {
                  ...aiAnalysis.dateTime,
                  extracted: newDateTime.toISOString()
                }
              };

              console.log('Enhanced counter-proposal time constructed:', enhancedAnalysis.dateTime.extracted);
              response = await viewingService.handleCounterProposal(message, enhancedAnalysis, currentState.data.originalRequest);
            } else {
              response = {
                message: 'Please suggest a specific time, for example: "Tomorrow at 2pm" or "Next Monday at 10am"'
              };
            }
          } else {
            // This is a new viewing request
            console.log('Processing new viewing request');

            // Get available properties for context
            const properties = await Property.find();

            // Use AI to extract viewing request details
            const aiAnalysis = await aiService.analyzeMessage(message.content, {
              properties,
              currentSender: from
            });
            console.log('AI Analysis Result (new request):', aiAnalysis);

            // Check if AI detected a viewing request
            if (aiAnalysis.messageType === 'viewing_request' || aiAnalysis.messageType === 'new_viewing_request') {
              console.log('New viewing request detected');
              // Use the central flow handler
              response = await viewingService.handleViewingRequest(message, aiAnalysis);
            } else {
              console.log('No viewing request detected, sending help message');
              response = {
                message: 'To request a viewing, please tell me which property you\'d like to see and your preferred date/time. For example: "I would like to view the Marina Bay property tomorrow at 2pm"'
              };
            }
          }
        } else {
          // Unknown state - reset to initial state
          console.log('Unknown state, resetting to waiting_for_request');
          conversationStateService.setState(from, 'waiting_for_request');
          response = {
            message: 'Let\'s start fresh. How can I help you with scheduling a viewing?'
          };
        }
      } catch (error) {
        console.error('Error processing message:', error);
        response = { message: 'Sorry, I encountered an error processing your message. Please try again.' };
      }

      // Get updated conversation
      const conversation = localMessageService.getConversation(from, to || 'system');

      res.json({
        success: true,
        message: 'Message processed',
        incomingMessage,
        response,
        conversation
      });
    } catch (error) {
      console.error('Error processing message:', error);
      res.status(500).json({ error: 'Error processing message', details: error.message });
    }
  }

  async getConversations(req, res) {
    try {
      const conversations = localMessageService.getAllConversations();
      res.json({ success: true, conversations });
    } catch (error) {
      console.error('Error getting conversations:', error);
      res.status(500).json({ error: 'Error getting conversations' });
    }
  }

  async getConversation(req, res) {
    try {
      const { phone1, phone2 } = req.params;
      const conversation = localMessageService.getConversation(phone1, phone2);
      res.json({ success: true, conversation });
    } catch (error) {
      console.error('Error getting conversation:', error);
      res.status(500).json({ error: 'Error getting conversation' });
    }
  }

  async getAllMessages(req, res) {
    try {
      const messages = localMessageService.getAllMessages();
      res.json({ success: true, messages });
    } catch (error) {
      console.error('Error getting all messages:', error);
      res.status(500).json({ error: 'Error getting messages' });
    }
  }

  async clearMessages(req, res) {
    try {
      const { phone1, phone2 } = req.body;
      
      if (phone1 && phone2) {
        localMessageService.clearConversation(phone1, phone2);
        res.json({ success: true, message: `Conversation between ${phone1} and ${phone2} cleared` });
      } else {
        localMessageService.clearAllMessages();
        res.json({ success: true, message: 'All messages cleared' });
      }
    } catch (error) {
      console.error('Error clearing messages:', error);
      res.status(500).json({ error: 'Error clearing messages' });
    }
  }

  async getKnownRoles(req, res) {
    try {
      const roles = await localMessageService.getKnownRoles();
      res.json({ success: true, roles });
    } catch (error) {
      console.error('Error getting known roles:', error);
      res.status(500).json({ error: 'Error getting roles' });
    }
  }

  // Health check endpoint
  async getStatus(req, res) {
    try {
      const messageCount = localMessageService.getAllMessages().length;
      const conversationCount = Object.keys(localMessageService.getAllConversations()).length;
      
      res.json({
        success: true,
        status: 'Local messaging service active',
        messageCount,
        conversationCount,
        timestamp: new Date()
      });
    } catch (error) {
      console.error('Error getting status:', error);
      res.status(500).json({ error: 'Error getting status' });
    }
  }

  // Simulate receiving a message from the system (for automated responses)
  async simulateSystemMessage(req, res) {
    try {
      const { to, content, from = 'system' } = req.body;
      
      if (!to || !content) {
        return res.status(400).json({ error: 'To and content are required' });
      }

      const message = await localMessageService.sendMessage(to, content, from);
      
      res.json({
        success: true,
        message: 'System message sent',
        sentMessage: message
      });
    } catch (error) {
      console.error('Error sending system message:', error);
      res.status(500).json({ error: 'Error sending system message' });
    }
  }
}

module.exports = new MessageController();