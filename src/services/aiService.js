const OpenAI = require('openai');

class AIService {
  constructor() {
    if (this.isEnabled()) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      });
    } else {
      this.openai = null;
      console.log('OpenAI API key not configured - AI features will be disabled');
    }
  }

  async analyzeMessage(message, context = {}) {
    if (!this.isEnabled() || !this.openai) {
      throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in your environment variables.');
    }
    
    try {
      const { properties = [], agentName = 'your agent' } = context;
      
      const propertyList = properties.length > 0 
        ? properties.map(p => `- ${p.address} (${p.propertyType})`).join('\n')
        : 'No properties available';

      const currentDate = new Date();
      const systemPrompt = `You are an AI assistant for AutoView, a real estate viewing scheduling system. You help analyze WhatsApp messages and extract relevant information.

IMPORTANT: Today is ${currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${currentDate.toISOString().split('T')[0]})

CONTEXT:
- Agent's available properties:
${propertyList}

- Your role: Analyze the user's message and extract viewing request details
- Be professional but friendly
- Understanding context is important for natural conversation

ANALYSIS TASKS:
1. Determine message type (viewing_request, confirmation, alternative_response, general)
2. Extract property (match to available properties)
3. Extract requested date/time
4. Extract any preferences or special requirements
5. Determine urgency/priority

Respond in JSON format:
{
  "messageType": "viewing_request|confirmation|alternative_response|general",
  "intent": "brief description of what user wants",
  "property": {
    "matched": "exact address if matched",
    "confidence": 0.0-1.0
  },
  "dateTime": {
    "extracted": "ISO date string in Singapore timezone like '2025-09-16T14:00:00+08:00' or null. IMPORTANT: Use Singapore timezone (+08:00), not UTC.",
    "relative": "today|tomorrow|this_week|next_week|specific_date",
    "time": "extracted time or null"
  },
  "sentiment": "positive|neutral|negative",
  "urgency": "low|medium|high",
  "context": "brief context about the request",
  "suggestedResponse": "natural, professional response suggestion"
}`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Analyze this message: "${message}"` }
        ],
        temperature: 0.3,
        max_tokens: 500
      });

      const analysis = JSON.parse(completion.choices[0].message.content);
      console.log('AI Analysis:', analysis);
      return analysis;

    } catch (error) {
      console.error('AI analysis error:', error);
      throw new Error(`AI message analysis failed: ${error.message}`);
    }
  }

  async generateResponse(intent, context = {}) {
    if (!this.isEnabled() || !this.openai) {
      throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in your environment variables.');
    }
    
    try {
      const {
        propertyAddress = '',
        dateTime = '',
        recipientName = '',
        senderName = '',
        responseType = 'confirmation',
        alternativeTime = '',
        isConfirmation = false
      } = context;

      const systemPrompt = `You are a professional real estate assistant helping coordinate property viewings via WhatsApp. 

Generate natural, professional but friendly messages for property viewing coordination.

IMPORTANT ROLES (NEVER CONFUSE THESE):
- Party A: The person wanting to VIEW the property (buyer/tenant) - they are the VISITOR
- Party B: The property owner who will SHOW the property (seller/landlord) - they are the HOST

GUIDELINES:
- Be casual, friendly, and conversational (like texting a friend)
- Use casual language - avoid formal business speak
- Keep it short and sweet
- Use emojis sparingly but naturally
- Sound human and approachable, not corporate
- ALWAYS remember: Party B shows the property TO Party A, not the other way around

CONTEXT:
- Intent: ${intent}
- Property: ${propertyAddress}
- Date/Time: ${dateTime}
- Response Type: ${responseType}`;

      let userPrompt = '';

      switch (responseType) {
        case 'forward_to_seller':
          userPrompt = `Generate a casual, friendly message asking ${recipientName} if they're available to show their property at ${propertyAddress} to ${senderName} on ${dateTime}. Keep it simple and conversational.`;
          break;
        case 'alternative_suggestion':
          userPrompt = `Generate a message suggesting an alternative time (${alternativeTime}) because the requested time (${dateTime}) is not available.`;
          break;
        case 'agent_unavailable_alternative':
          userPrompt = `Generate an honest message explaining that I (the agent) have another viewing scheduled at ${dateTime}, so I'm suggesting an alternative time (${alternativeTime}). Be honest that it's my schedule conflict, not the host's unavailability.`;
          break;
        case 'agent_fully_booked':
          userPrompt = `Generate an honest message explaining that I (the agent) am fully booked for the next few weeks and ask them to contact me directly to arrange a viewing. Be honest that it's my schedule that's the issue.`;
          break;
        case 'final_confirmation':
          const { recipientRole = 'unknown' } = context;
          if (recipientRole === 'host') {
            userPrompt = `Generate a casual confirmation message for the property owner. They'll be showing their place at ${propertyAddress} on ${dateTime}. Keep it friendly and brief - remind them they're the host.`;
          } else if (recipientRole === 'visitor') {
            userPrompt = `Generate a casual confirmation message for someone viewing a property. The viewing at ${propertyAddress} is set for ${dateTime}. Keep it excited and friendly - they're the visitor.`;
          } else {
            userPrompt = `Generate a casual confirmation that the viewing for ${propertyAddress} at ${dateTime} is all set.`;
          }
          break;
        case 'decline_response':
          userPrompt = `Generate a professional response asking for alternative times when someone declined the proposed viewing time.`;
          break;
        case 'request_forwarded':
          userPrompt = `Generate a casual message letting someone know their viewing request for ${propertyAddress} at ${dateTime} has been sent to ${recipientName}. Keep it short and friendly - just confirming we forwarded it, not that it's confirmed.`;
          break;
        default:
          userPrompt = `Generate an appropriate response for: ${intent}`;
      }

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.7,
        max_tokens: 200
      });

      const response = completion.choices[0].message.content.trim();
      console.log('AI Generated Response:', response);
      return response;

    } catch (error) {
      console.error('AI response generation error:', error);
      throw new Error(`AI response generation failed: ${error.message}`);
    }
  }

  async parseDateTime(message, currentDate = new Date()) {
    if (!this.isEnabled() || !this.openai) {
      throw new Error('OpenAI API is not configured. Please set OPENAI_API_KEY in your environment variables.');
    }
    
    try {
      const systemPrompt = `You are a date/time parser. Extract date and time information from natural language.

Current date: ${currentDate.toISOString()} (${currentDate.toDateString()})
Today is: ${currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}

Parse the message and return JSON with ISO date format:
{
  "date": "YYYY-MM-DD or null",
  "time": "HH:MM or null", 
  "confidence": 0.0-1.0,
  "relative": "today|tomorrow|this_week|next_week|specific_date",
  "originalText": "the part of message referring to time/date"
}

Handle common expressions like:
- "tomorrow at 3pm" 
- "this afternoon"
- "next Monday"
- "2pm today"
- "Friday morning"`;

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `Parse date/time from: "${message}"` }
        ],
        temperature: 0.1,
        max_tokens: 150
      });

      const parsed = JSON.parse(completion.choices[0].message.content);
      console.log('AI Date/Time Parse:', parsed);
      return parsed;

    } catch (error) {
      console.error('AI date parsing error:', error);
      throw new Error(`AI date/time parsing failed: ${error.message}`);
    }
  }


  isEnabled() {
    return !!process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'your_openai_api_key_here';
  }
}

module.exports = new AIService();