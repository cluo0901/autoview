# AutoView - Automated Real Estate Viewing Scheduler

An MVP system that automatically schedules property viewings via WhatsApp using Twilio and Google Calendar integration.

## Features

- WhatsApp message processing for viewing requests
- Automatic agent calendar availability checking
- Bi-party communication coordination (buyer/seller or tenant/landlord)
- Google Calendar event creation
- Property and contact management

## Setup Instructions

### 1. Prerequisites

- Node.js (v14 or higher)
- MongoDB (local or cloud instance)
- Twilio account with WhatsApp sandbox
- Google Cloud account with Calendar API enabled

### 2. Installation

```bash
# Clone and install dependencies
cd AutoView
npm install
```

### 3. Environment Configuration

```bash
# Copy environment template
cp .env.example .env
```

Fill in your credentials in `.env`:

```env
# Server
PORT=3000
NODE_ENV=development

# Twilio WhatsApp
TWILIO_ACCOUNT_SID=your_account_sid_here
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Google Calendar API
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/calendar/callback
GOOGLE_REFRESH_TOKEN=your_refresh_token_after_auth

# Database
MONGODB_URI=mongodb://localhost:27017/autoview

# Your WhatsApp number
AGENT_WHATSAPP_NUMBER=+1234567890
```

### 4. Google Calendar Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable Google Calendar API
4. Create OAuth 2.0 credentials
5. Add redirect URI: `http://localhost:3000/api/calendar/callback`
6. Start the server and visit `http://localhost:3000/api/calendar/auth`
7. Complete OAuth flow and copy the refresh token to your `.env`

### 5. Twilio WhatsApp Setup

1. Sign up for [Twilio](https://console.twilio.com)
2. Go to Messaging > Try it out > Send a WhatsApp message
3. Follow sandbox setup instructions
4. Set webhook URL to: `https://your-ngrok-url.ngrok.io/webhook/whatsapp`
5. Add your phone number to the sandbox

### 6. Database Setup

Start MongoDB locally or use a cloud service like MongoDB Atlas.

### 7. Running the Application

```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

## Testing the MVP

### 1. Create a Property

```bash
curl -X POST http://localhost:3000/api/properties \
-H "Content-Type: application/json" \
-d '{
  "address": "123 Main St, San Francisco, CA",
  "propertyType": "sale",
  "partyA": {
    "name": "John Buyer",
    "phone": "+1234567890",
    "role": "buyer"
  },
  "partyB": {
    "name": "Jane Seller", 
    "phone": "+0987654321",
    "role": "seller"
  },
  "agentPhone": "+1111111111"
}'
```

### 2. Test WhatsApp Flow

1. Send a message from Party A's number: "Can I view the property tomorrow at 3pm?"
2. System checks agent availability
3. If available, forwards request to Party B
4. Party B replies "YES" to confirm
5. Calendar event is created automatically

### 3. Message Examples

**Viewing Request:**
- "Can I see the property tomorrow at 2pm?"
- "Is the house available for viewing this Friday at 10am?"
- "Schedule a visit for Monday 3pm please"

**Confirmation:**
- "YES" or "Yes" or "Confirmed"
- "NO" or "Not available"

## API Endpoints

- `GET /health` - Health check
- `POST /webhook/whatsapp` - WhatsApp webhook
- `GET /api/properties` - List properties
- `POST /api/properties` - Create property
- `GET /api/calendar/auth` - Start Google OAuth
- `GET /api/calendar/availability` - Check availability

## Architecture

```
WhatsApp Message → Twilio → Webhook → Message Parser
                                          ↓
Agent Calendar ← Google Calendar API ← Viewing Service
                                          ↓
Property Database → MongoDB ← Property Matching
                                          ↓
Response Generator → WhatsApp Service → Twilio → WhatsApp
```

## Limitations (MVP)

- Simple keyword detection (not full NLP)
- Manual property setup required
- Basic date/time parsing
- Single agent support
- No advanced scheduling conflict resolution

## Next Steps

1. Add OpenAI/Claude for better message understanding
2. Implement multi-agent support
3. Add web dashboard for property management
4. Enhanced scheduling with multiple time slots
5. SMS fallback for non-WhatsApp users