const express = require('express');
const router = express.Router();
const messageController = require('../controllers/messageController');

// Send a message and process it
router.post('/send', messageController.sendMessage);

// Get all conversations
router.get('/conversations', messageController.getConversations);

// Get specific conversation between two parties
router.get('/conversation/:phone1/:phone2', messageController.getConversation);

// Get all messages
router.get('/all', messageController.getAllMessages);

// Clear messages
router.delete('/clear', messageController.clearMessages);

// Get known roles from properties
router.get('/roles', messageController.getKnownRoles);

// Get service status
router.get('/status', messageController.getStatus);

// Simulate system message (for automated responses)
router.post('/system', messageController.simulateSystemMessage);

module.exports = router;