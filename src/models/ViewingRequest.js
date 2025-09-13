const mongoose = require('mongoose');

const viewingRequestSchema = new mongoose.Schema({
  property: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: true
  },
  requestedBy: {
    type: String,
    enum: ['partyA', 'partyB'],
    required: true
  },
  requestedDateTime: {
    type: Date,
    required: true
  },
  status: {
    type: String,
    enum: ['pending_agent_check', 'pending_other_party', 'confirmed', 'declined', 'rescheduling', 'agent_suggested_alternative'],
    default: 'pending_agent_check'
  },
  messages: [{
    from: String,
    to: String,
    content: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    messageId: String
  }],
  calendarEventId: String,
  alternativeSlots: [{
    dateTime: Date,
    suggestedBy: String
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('ViewingRequest', viewingRequestSchema);