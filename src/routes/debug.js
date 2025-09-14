const express = require('express');
const router = express.Router();
const localMessageService = require('../services/localMessageService');
const Property = require('../models/Property');
const ViewingRequest = require('../models/ViewingRequest');

// Get message service status
router.get('/message-service', async (req, res) => {
    try {
        const messageCount = localMessageService.getAllMessages().length;
        const conversations = localMessageService.getAllConversations();
        const conversationCount = Object.keys(conversations).length;
        
        res.json({
            success: true,
            service: 'Local Message Service',
            messageCount,
            conversationCount,
            conversations,
            status: 'active'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test local message processing
router.post('/test-message', async (req, res) => {
    try {
        const { from, content } = req.body;
        
        if (!from || !content) {
            return res.status(400).json({ error: 'from and content are required' });
        }

        // Send the message to local service
        const message = await localMessageService.receiveMessage(from, 'system', content);
        
        res.json({ 
            success: true, 
            message: 'Local message processed',
            messageData: message,
            instruction: 'Check the message simulator UI to see the full flow'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get system statistics
router.get('/stats', async (req, res) => {
    try {
        const properties = await Property.find();
        const viewingRequests = await ViewingRequest.find();
        const messages = localMessageService.getAllMessages();
        
        res.json({
            success: true,
            stats: {
                totalProperties: properties.length,
                totalViewingRequests: viewingRequests.length,
                totalMessages: messages.length,
                userMessages: messages.filter(m => m.from !== 'system').length,
                systemMessages: messages.filter(m => m.from === 'system').length
            },
            recentMessages: messages.slice(-5),
            properties: properties.map(p => ({
                address: p.address,
                partyA: p.partyA ? p.partyA.phone : null,
                partyB: p.partyB ? p.partyB.phone : null
            }))
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear all debug data
router.delete('/clear-all', async (req, res) => {
    try {
        localMessageService.clearAllMessages();
        res.json({ 
            success: true, 
            message: 'All local messages cleared' 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;