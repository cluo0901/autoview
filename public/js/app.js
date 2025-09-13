class PropertyManager {
    constructor() {
        this.apiBase = '/api';
        this.properties = [];
        this.currentEditingId = null;
        this.initializeEventListeners();
        this.loadProperties();
    }

    initializeEventListeners() {
        // Modal controls
        document.getElementById('addPropertyBtn').addEventListener('click', () => {
            this.openModal();
        });

        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.loadProperties();
        });

        document.getElementById('debugBtn').addEventListener('click', async () => {
            console.log('=== DEBUG INFO ===');
            console.log('API Base:', this.apiBase);
            console.log('Current properties:', this.properties);
            
            try {
                const response = await safeFetch(`${this.apiBase}/properties`);
                console.log('Debug API Response Status:', response.status);
                const data = await response.json();
                console.log('Debug API Response Data:', data);
                this.showNotification(`API Debug: Found ${data.length} properties`, 'info');
            } catch (error) {
                console.error('Debug API Error:', error);
                this.showNotification(`Debug Error: ${error.message}`, 'error');
            }
        });

        document.getElementById('cancelBtn').addEventListener('click', () => {
            this.closeModal();
        });

        document.querySelector('.close').addEventListener('click', () => {
            this.closeModal();
        });

        // Form submission
        document.getElementById('propertyForm').addEventListener('submit', (e) => {
            this.handleFormSubmit(e);
        });

        // Close modal when clicking outside
        window.addEventListener('click', (e) => {
            const modal = document.getElementById('propertyModal');
            if (e.target === modal) {
                this.closeModal();
            }
        });
    }

    async loadProperties() {
        try {
            console.log('Loading properties...');
            this.showLoading();
            
            // Add cache busting and better headers
            const response = await safeFetch(`${this.apiBase}/properties?t=${Date.now()}`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache'
                }
            });
            
            console.log('Response status:', response.status);
            console.log('Response headers:', response.headers);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Response error:', errorText);
                throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
            }
            
            this.properties = await response.json();
            console.log('Loaded properties:', this.properties);
            console.log('Properties count:', this.properties.length);
            
            this.renderProperties();
            this.updateStats();
            
            this.showNotification('Properties loaded successfully!', 'success');
        } catch (error) {
            console.error('Error loading properties:', error);
            this.showError(`Failed to load properties: ${error.message}`);
            this.showNotification(`API Error: ${error.message}`, 'error');
        }
    }

    renderProperties() {
        const container = document.getElementById('propertiesContainer');
        
        if (this.properties.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-home"></i>
                    <h3>No Properties Found</h3>
                    <p>Click "Add New Property" to get started</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.properties.map(property => `
            <div class="property-card">
                <div class="property-header">
                    <div class="property-info">
                        <h3>${property.address}</h3>
                        <span class="property-type type-${property.propertyType}">
                            ${property.propertyType === 'sale' ? 'For Sale' : 'For Rental'}
                        </span>
                    </div>
                    <div class="property-actions">
                        <button class="btn btn-edit" onclick="propertyManager.editProperty('${property._id}')">
                            <i class="fas fa-edit"></i> Edit
                        </button>
                        <button class="btn btn-danger" onclick="propertyManager.deleteProperty('${property._id}')">
                            <i class="fas fa-trash"></i> Delete
                        </button>
                    </div>
                </div>
                
                <div class="parties">
                    <div class="party">
                        <h4>Party A (${this.getRoleDisplayName(property.partyA.role)})</h4>
                        <div class="party-info">
                            <span class="name">${property.partyA.name || 'Not specified'}</span>
                            <span class="phone"><i class="fas fa-phone"></i> ${property.partyA.phone}</span>
                            <span class="role"><i class="fas fa-user-tag"></i> ${this.getRoleDisplayName(property.partyA.role)}</span>
                        </div>
                    </div>
                    
                    <div class="party">
                        <h4>Party B (${this.getRoleDisplayName(property.partyB.role)})</h4>
                        <div class="party-info">
                            <span class="name">${property.partyB.name || 'Not specified'}</span>
                            <span class="phone"><i class="fas fa-phone"></i> ${property.partyB.phone}</span>
                            <span class="role"><i class="fas fa-user-tag"></i> ${this.getRoleDisplayName(property.partyB.role)}</span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    updateStats() {
        const total = this.properties.length;
        const active = this.properties.filter(p => p.status === 'active').length;
        const sale = this.properties.filter(p => p.propertyType === 'sale').length;
        const rental = this.properties.filter(p => p.propertyType === 'rental').length;

        document.getElementById('totalProperties').textContent = total;
        document.getElementById('activeProperties').textContent = active;
        document.getElementById('saleProperties').textContent = sale;
        document.getElementById('rentalProperties').textContent = rental;
    }

    showLoading() {
        document.getElementById('propertiesContainer').innerHTML = `
            <div class="loading">
                <i class="fas fa-spinner fa-spin"></i> Loading properties...
            </div>
        `;
    }

    showError(message) {
        document.getElementById('propertiesContainer').innerHTML = `
            <div class="empty-state">
                <i class="fas fa-exclamation-triangle" style="color: #dc3545;"></i>
                <h3>Error</h3>
                <p>${message}</p>
            </div>
        `;
    }

    getRoleDisplayName(role) {
        const roleMap = {
            'buyer': 'Buyer',
            'seller': 'Seller',
            'tenant': 'Tenant',
            'landlord': 'Landlord',
            'agent_buyer': 'Agent (Buyer)',
            'agent_seller': 'Agent (Seller)',
            'agent_tenant': 'Agent (Tenant)',
            'agent_landlord': 'Agent (Landlord)'
        };
        return roleMap[role] || role;
    }

    openModal(property = null) {
        const modal = document.getElementById('propertyModal');
        const form = document.getElementById('propertyForm');
        const title = document.getElementById('modalTitle');

        if (property) {
            // Edit mode
            this.currentEditingId = property._id;
            title.textContent = 'Edit Property';
            this.populateForm(property);
        } else {
            // Add mode
            this.currentEditingId = null;
            title.textContent = 'Add New Property';
            form.reset();
            // Set default agent phone
            document.getElementById('agentPhone').value = '+6581897621';
        }

        modal.style.display = 'block';
    }

    closeModal() {
        document.getElementById('propertyModal').style.display = 'none';
        this.currentEditingId = null;
    }

    populateForm(property) {
        document.getElementById('address').value = property.address;
        document.getElementById('propertyType').value = property.propertyType;
        document.getElementById('partyAName').value = property.partyA.name || '';
        document.getElementById('partyAPhone').value = property.partyA.phone;
        document.getElementById('partyARole').value = property.partyA.role;
        document.getElementById('partyBName').value = property.partyB.name || '';
        document.getElementById('partyBPhone').value = property.partyB.phone;
        document.getElementById('partyBRole').value = property.partyB.role;
        document.getElementById('agentPhone').value = property.agentPhone;
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        
        const formData = new FormData(e.target);
        const propertyData = {
            address: formData.get('address'),
            propertyType: formData.get('propertyType'),
            partyA: {
                name: formData.get('partyAName'),
                phone: formData.get('partyAPhone'),
                role: formData.get('partyARole')
            },
            partyB: {
                name: formData.get('partyBName'),
                phone: formData.get('partyBPhone'),
                role: formData.get('partyBRole')
            },
            agentPhone: formData.get('agentPhone')
        };

        try {
            const url = this.currentEditingId 
                ? `${this.apiBase}/properties/${this.currentEditingId}`
                : `${this.apiBase}/properties`;
            
            const method = this.currentEditingId ? 'PUT' : 'POST';

            const response = await safeFetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(propertyData)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.closeModal();
            this.loadProperties();
            
            // Show success message
            this.showNotification(
                this.currentEditingId ? 'Property updated successfully!' : 'Property created successfully!',
                'success'
            );

        } catch (error) {
            console.error('Error saving property:', error);
            this.showNotification('Failed to save property. Please try again.', 'error');
        }
    }

    async editProperty(id) {
        const property = this.properties.find(p => p._id === id);
        if (property) {
            this.openModal(property);
        }
    }

    async deleteProperty(id) {
        const property = this.properties.find(p => p._id === id);
        if (!property) return;

        if (!confirm(`Are you sure you want to delete the property at "${property.address}"?`)) {
            return;
        }

        try {
            const response = await safeFetch(`${this.apiBase}/properties/${id}`, {
                method: 'DELETE'
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            this.loadProperties();
            this.showNotification('Property deleted successfully!', 'success');

        } catch (error) {
            console.error('Error deleting property:', error);
            this.showNotification('Failed to delete property. Please try again.', 'error');
        }
    }

    showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i>
            ${message}
        `;
        
        document.body.appendChild(notification);
        
        // Trigger animation
        setTimeout(() => notification.classList.add('show'), 100);
        
        // Remove notification
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    document.body.removeChild(notification);
                }
            }, 300);
        }, 4000);
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM loaded, initializing PropertyManager...');
    try {
        window.propertyManager = new PropertyManager();
        console.log('PropertyManager initialized successfully');
    } catch (error) {
        console.error('Failed to initialize PropertyManager:', error);
        
        // Fallback initialization
        setTimeout(() => {
            try {
                window.propertyManager = new PropertyManager();
                console.log('PropertyManager initialized on retry');
            } catch (retryError) {
                console.error('Retry failed:', retryError);
            }
        }, 1000);
    }
});

// Also try immediate initialization for testing
console.log('Script loaded at:', new Date().toISOString());