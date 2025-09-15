class MessageSimulator {
    constructor() {
        this.init();
        this.loadKnownRoles();
        this.loadMessages();
        this.setupEventListeners();
    }

    init() {
        this.senderSelect = document.getElementById('senderSelect');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.clearAllBtn = document.getElementById('clearAllBtn');
        this.refreshBtn = document.getElementById('refreshBtn');
        this.conversationView = document.getElementById('conversationView');
        this.allConversations = document.getElementById('allConversations');
        this.conversationTitle = document.getElementById('conversationTitle');
        this.messageCount = document.getElementById('messageCount');
        this.conversationCount = document.getElementById('conversationCount');
        this.currentSender = null;
    }

    setupEventListeners() {
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.clearAllBtn.addEventListener('click', () => this.clearAllMessages());
        this.refreshBtn.addEventListener('click', () => this.loadMessages());

        // Quick message buttons
        document.querySelectorAll('.quick-message-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.messageInput.value = e.target.dataset.message;
            });
        });

        // Enter key to send message
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.sendMessage();
            }
        });

        // Sender selection event
        this.senderSelect.addEventListener('change', (e) => {
            this.currentSender = e.target.value;
            this.messageInput.value = ''; // Clear message input when switching roles
            this.updateConversationView();
        });

        // Auto-refresh messages every 5 seconds
        setInterval(() => this.loadMessages(), 5000);

        // Add event delegation for selection option buttons
        this.conversationView.addEventListener('click', (e) => {
            if (e.target.classList.contains('selection-option')) {
                const selectedValue = e.target.getAttribute('data-value');
                const messageId = e.target.getAttribute('data-message-id');
                this.handleSelectionClick(selectedValue, messageId);
            }
        });
    }

    async loadKnownRoles() {
        try {
            const response = await safeFetch('/api/messages/roles');
            const data = await response.json();
            
            if (data.success) {
                this.populateRoleSelector(data.roles);
            }
        } catch (error) {
            console.error('Error loading roles:', error);
            this.showError('Failed to load roles');
        }
    }

    populateRoleSelector(roles) {
        // Clear existing options except the first one
        this.senderSelect.innerHTML = '<option value="">Select role...</option>';
        
        // Add roles from properties
        roles.forEach(roleInfo => {
            const option = document.createElement('option');
            option.value = roleInfo.id;
            option.textContent = roleInfo.displayName;
            this.senderSelect.appendChild(option);
        });
    }

    async sendMessage() {
        const sender = this.senderSelect.value.trim();
        const content = this.messageInput.value.trim();

        if (!sender || !content) {
            this.showError('Please select a role and enter a message');
            return;
        }

        try {
            this.sendBtn.disabled = true;
            this.sendBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
            
            // Clear message input immediately for better UX
            const originalMessage = this.messageInput.value;
            this.messageInput.value = '';

            const response = await safeFetch('/api/messages/send', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    from: sender,
                    content: originalMessage
                }),
                timeout: 30000
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSuccess('Message sent successfully');
                this.loadMessages();
                // Update conversation view immediately
                setTimeout(() => this.updateConversationView(), 100);
            } else {
                // Restore message on failure
                this.messageInput.value = originalMessage;
                this.showError(data.error || 'Failed to send message');
            }
        } catch (error) {
            console.error('Error sending message:', error);
            // Restore message on error
            this.messageInput.value = originalMessage;
            this.showError('Failed to send message');
        } finally {
            this.sendBtn.disabled = false;
            this.sendBtn.innerHTML = '<i class="fas fa-send"></i> Send';
        }
    }

    async loadMessages() {
        try {
            const response = await safeFetch('/api/messages/all');
            const data = await response.json();
            
            if (data.success) {
                this.displayMessages(data.messages);
                this.updateCounts(data.messages);
            }
        } catch (error) {
            console.error('Error loading messages:', error);
            this.showError('Failed to load messages');
        }
    }

    displayMessages(messages) {
        this.allMessages = messages;
        this.displayAllConversations(messages);
        this.updateConversationView();
        this.updateCounts(messages);
    }

    displayAllConversations(messages) {
        if (messages.length === 0) {
            this.allConversations.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-inbox" style="font-size: 48px; color: #ccc; margin-bottom: 15px;"></i>
                    <p>No conversations yet</p>
                </div>
            `;
            return;
        }

        // Group messages by role
        const conversations = this.groupMessagesByRole(messages);
        const conversationList = Object.keys(conversations).map(roleId => {
            const msgs = conversations[roleId];
            const lastMessage = msgs[msgs.length - 1];
            
            return {
                roleId: roleId,
                displayName: this.getRoleDisplayName(roleId),
                messages: msgs,
                lastMessage: lastMessage,
                lastTime: new Date(lastMessage.timestamp)
            };
        });

        // Sort by last message time
        conversationList.sort((a, b) => b.lastTime - a.lastTime);

        this.allConversations.innerHTML = conversationList.map(conv => 
            this.renderConversationItem(conv)
        ).join('');

        // Add click handlers to conversation items
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.addEventListener('click', () => {
                const roleId = item.getAttribute('data-role-id');
                this.currentSender = roleId;
                this.senderSelect.value = roleId;
                this.messageInput.value = ''; // Clear message input when switching roles
                this.updateConversationView();
            });
        });
    }

    groupMessagesByRole(messages) {
        const conversations = {};
        
        messages.forEach(msg => {
            const roleId = msg.from === 'system' ? msg.to : msg.from;
            if (!conversations[roleId]) {
                conversations[roleId] = [];
            }
            conversations[roleId].push(msg);
        });
        
        return conversations;
    }

    renderConversationItem(conversation) {
        const isActive = conversation.roleId === this.currentSender ? 'active' : '';
        const preview = this.escapeHtml(conversation.lastMessage.content);
        const time = new Date(conversation.lastMessage.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        return `
            <div class="conversation-item ${isActive}" data-role-id="${conversation.roleId}">
                <div class="conversation-time">${time}</div>
                <div class="conversation-contact">${conversation.displayName}</div>
                <div class="conversation-preview">${preview}</div>
            </div>
        `;
    }

    updateConversationView() {
        if (!this.currentSender || !this.allMessages) {
            this.conversationView.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comments" style="font-size: 48px; color: #ccc; margin-bottom: 15px;"></i>
                    <p>Select a sender to view their conversation</p>
                </div>
            `;
            this.conversationTitle.textContent = 'Select sender to view conversation';
            return;
        }

        // Get messages for current sender
        const senderMessages = this.allMessages.filter(msg => 
            msg.from === this.currentSender || msg.to === this.currentSender
        );

        if (senderMessages.length === 0) {
            this.conversationView.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-comments" style="font-size: 48px; color: #ccc; margin-bottom: 15px;"></i>
                    <p>No messages yet. Send a message to start!</p>
                </div>
            `;
        } else {
            this.conversationView.innerHTML = senderMessages.map(msg => 
                this.renderWhatsAppMessage(msg, this.currentSender)
            ).join('');
        }

        this.conversationTitle.textContent = this.getRoleDisplayName(this.currentSender);
        
        // Scroll to bottom
        this.conversationView.scrollTop = this.conversationView.scrollHeight;
        
        // Update active conversation item
        document.querySelectorAll('.conversation-item').forEach(item => {
            item.classList.remove('active');
            if (item.getAttribute('data-role-id') === this.currentSender) {
                item.classList.add('active');
            }
        });
    }

    renderWhatsAppMessage(message, currentUser) {
        const isSentByUser = message.from === currentUser;
        const messageClass = isSentByUser ? 'sent' : 'received';
        const timestamp = new Date(message.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});

        // System messages (from 'system' to user or vice versa)
        if (message.from === 'system' || message.to === 'system') {
            if (message.from === 'system') {
                // System response - show as received with optional selection buttons
                const optionsHtml = this.renderSelectionOptions(message);
                return `
                    <div class="message received">
                        <div class="message-content">${this.escapeHtml(message.content)}</div>
                        ${optionsHtml}
                        <div class="message-meta">${timestamp}</div>
                    </div>
                `;
            } else {
                // User message to system - show as sent
                return `
                    <div class="message sent">
                        <div class="message-content">${this.escapeHtml(message.content)}</div>
                        <div class="message-meta">${timestamp}</div>
                    </div>
                `;
            }
        }

        const optionsHtml = this.renderSelectionOptions(message);
        return `
            <div class="message ${messageClass}">
                <div class="message-content">${this.escapeHtml(message.content)}</div>
                ${optionsHtml}
                <div class="message-meta">${timestamp}</div>
            </div>
        `;
    }

    renderMessage(message) {
        const messageClass = message.type || 'inbound';
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        
        return `
            <div class="message ${messageClass}">
                <div class="message-meta">
                    <strong>${message.from}</strong> 
                    ${message.to ? `→ ${message.to}` : ''} 
                    <span style="color: #999;">${timestamp}</span>
                </div>
                <div class="message-content">${this.escapeHtml(message.content)}</div>
            </div>
        `;
    }

    updateCounts(messages) {
        const totalMessages = messages.length;
        const conversations = this.groupMessagesByRole(messages);
        const conversationCount = Object.keys(conversations).length;
        
        this.messageCount.textContent = this.currentSender 
            ? `${messages.filter(msg => msg.from === this.currentSender || msg.to === this.currentSender).length} messages`
            : `${totalMessages} messages`;
        this.conversationCount.textContent = `${conversationCount} conversations`;
    }

    getRoleDisplayName(roleId) {
        if (!roleId) return 'Unknown';
        if (roleId === 'agent') return 'Agent';
        
        // Try to get from selector options
        const option = Array.from(this.senderSelect.options).find(opt => opt.value === roleId);
        return option ? option.textContent : roleId;
    }

    async clearAllMessages() {
        if (!confirm('Are you sure you want to clear all messages? This cannot be undone.')) {
            return;
        }

        try {
            const response = await safeFetch('/api/messages/clear', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();
            
            if (data.success) {
                this.showSuccess('All messages cleared');
                this.loadMessages();
            } else {
                this.showError(data.error || 'Failed to clear messages');
            }
        } catch (error) {
            console.error('Error clearing messages:', error);
            this.showError('Failed to clear messages');
        }
    }

    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showNotification(message, type) {
        // Create a simple notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            font-weight: 600;
            z-index: 1000;
            transition: all 0.3s ease;
            ${type === 'success' ? 'background: #4caf50;' : 'background: #f44336;'}
        `;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    renderSelectionOptions(message) {
        // Check if message has options for selection
        if (!message.options || !Array.isArray(message.options) || message.options.length === 0) {
            return '';
        }

        const optionsHtml = message.options.map(option => `
            <button class="selection-option"
                    data-value="${this.escapeHtml(option.value)}"
                    data-message-id="${message.id}">
                ${this.escapeHtml(option.label)}
            </button>
        `).join('');

        return `<div class="selection-options">${optionsHtml}</div>`;
    }

    handleSelectionClick(selectedValue, messageId) {
        // Send the selected value as a message
        if (this.currentSender) {
            // Get the actual label text from the button that was clicked
            const clickedButton = document.querySelector(`[data-value="${selectedValue}"][data-message-id="${messageId}"]`);
            const labelText = clickedButton ? clickedButton.textContent.trim() : selectedValue;

            // Simulate typing the selected label text
            this.messageInput.value = labelText;
            this.sendMessage();

            // Hide the selection options for this message to prevent multiple selections
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                const optionsContainer = messageElement.closest('.message').querySelector('.selection-options');
                if (optionsContainer) {
                    optionsContainer.style.display = 'none';
                }
            }
        } else {
            this.showError('Please select a role first');
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize the message simulator when the page loads
document.addEventListener('DOMContentLoaded', () => {
    new MessageSimulator();
});