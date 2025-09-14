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
        // Check if this is a multiple choice response to an existing conversation
        if (currentState.state !== 'waiting_for_request') {
          console.log('Handling state-based response');
          const stateResponse = await conversationStateService.handleResponse(from, message, currentState);
          response = {
            message: 'Response processed',
            action: stateResponse.action,
            state: currentState.state
          };
        } else {
          // This should be a new viewing request - use minimal AI analysis
          console.log('Processing new viewing request');
          
          // Get available properties for context
          const properties = await Property.find();
          
          // Use AI only to extract basic information from the viewing request
          const aiAnalysis = await aiService.analyzeMessage(message.content, { 
            properties,
            currentSender: from
          });
          console.log('AI Analysis Result (request parsing only):', aiAnalysis);
          
          // Check if AI detected a viewing request
          if (aiAnalysis.messageType === 'viewing_request') {
            console.log('New viewing request detected');
            response = await viewingService.handleViewingRequest(message, aiAnalysis);
          } else {
            console.log('No viewing request detected, sending help message');
            response = { 
              message: 'To request a viewing, please tell me which property you\'d like to see and your preferred date/time. For example: "I would like to view the Marina Bay property tomorrow at 2pm"'
            };
          }
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