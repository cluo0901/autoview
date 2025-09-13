const mongoose = require('mongoose');

const propertySchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
    trim: true
  },
  propertyType: {
    type: String,
    enum: ['sale', 'rental'],
    required: true
  },
  partyA: {
    name: String,
    phone: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ['buyer', 'tenant', 'agent_buyer', 'agent_tenant'],
      required: true
    }
  },
  partyB: {
    name: String,
    phone: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ['seller', 'landlord', 'agent_seller', 'agent_landlord'],
      required: true
    }
  },
  agentPhone: {
    type: String,
    required: true
  },
  status: {
    type: String,
    enum: ['active', 'sold', 'rented', 'withdrawn'],
    default: 'active'
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Property', propertySchema);