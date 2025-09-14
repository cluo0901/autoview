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
      const { 
        properties = [], 
        agentName = 'your agent',
        conversationHistory = [],
        currentSender = null
      } = context;
      
      const propertyList = properties.length > 0 
        ? properties.map(p => `- ${p.address} (${p.propertyType})`).join('\n')
        : 'No properties available';

      // Format conversation history for context
      const conversationContext = conversationHistory.length > 0 
        ? conversationHistory.map(msg => {
            const timestamp = new Date(msg.timestamp).toLocaleString();
            return `[${timestamp}] ${msg.from}: "${msg.content}"`;
          }).join('\n')
        : 'No previous conversation';

      const currentDate = new Date();
      


      const systemPrompt = `You are an AI assistant for AutoView, a real estate viewing scheduling system. You help analyze WhatsApp messages and extract relevant information.

CURRENT DATE CONTEXT: 
- Today is ${currentDate.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${currentDate.toISOString().split('T')[0]})
- Current time zone: Singapore (GMT+8)

CONTEXT:
- Agent's available properties:
${propertyList}

- Recent conversation history:
${conversationContext}

- Current sender: ${currentSender || 'unknown'}

UNDERSTANDING MESSAGE TYPES:
Analyze the conversation flow and context to understand what the user is really trying to communicate:

1. NEW VIEWING REQUEST: When someone is asking to schedule a completely new viewing
   - Example: "I want to see the Marina Bay property tomorrow at 2pm"

2. CONFIRMATION: When someone is confirming their availability for a time that was directly asked about
   - Example: After "Are you available tomorrow at 2pm?" → "Yes, I'm available"

3. ALTERNATIVE RESPONSE: When someone accepts a different time that was suggested to them
   - Example: After "How about 3pm instead?" → "Yes, that works" or "OK sounds good"

4. GENERAL: Other types of communication

The key is understanding the conversational context. If the system just suggested a different time and the user responds positively, that's accepting an alternative. If the system asked if they're available and they confirm, that's a confirmation.

Your role: Analyze the user's message and extract viewing request details using natural language understanding and conversational context.

ANALYSIS TASKS:
1. Determine message type based on conversational context
2. Extract property (match to available properties)  
3. Extract requested date/time using natural language understanding
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
    "extracted": "ISO date string in Singapore timezone like '2025-09-15T14:00:00+08:00' or null. IMPORTANT: Use Singapore timezone (+08:00), not UTC. Use natural language understanding to interpret dates.",
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

      const systemPrompt = `You are a real estate agent helping coordinate property viewings via WhatsApp. 

Generate very casual, short WhatsApp-style messages like normal people texting.

IMPORTANT ROLES:
- Party A: Person wanting to VIEW the property (buyer/tenant) - they are the VISITOR
- Party B: Property owner who will SHOW the property (seller/landlord) - they are the HOST

GUIDELINES:
- Write like you're texting a friend - super casual
- Keep messages VERY SHORT (max 15-20 words)
- Use normal texting language, contractions, casual words
- Minimal emojis (1-2 max), only when natural
- No formal language or business speak
- Sound like a normal person, not a bot
- Examples of good style: "hey! john wants to see your place tomorrow 2pm. you free?" or "cool, i'll let sarah know you're available"

CONTEXT:
- Intent: ${intent}
- Property: ${propertyAddress}
- Date/Time: ${dateTime}
- Response Type: ${responseType}`;

      let userPrompt = '';

      switch (responseType) {
        case 'forward_to_seller':
          userPrompt = `Write a very short casual text asking ${recipientName} if they can show their place to ${senderName} on ${dateTime}. Like: "hey sarah! john wants to see your place tomorrow 2pm. free?"`;
          break;
        case 'alternative_suggestion':
          userPrompt = `Write a short casual text suggesting ${alternativeTime} instead of ${dateTime}. Like: "that time's taken, how about 4pm instead?"`;
          break;
        case 'agent_unavailable_alternative':
          userPrompt = `Write a short casual text saying you have another viewing at ${dateTime} and suggesting ${alternativeTime}. Like: "got another viewing then, can we do 4pm instead?"`;
          break;
        case 'agent_fully_booked':
          userPrompt = `Write a short casual text saying you're swamped and ask them to call. Like: "super busy next few weeks, can you call me to sort something out?"`;
          break;
        case 'final_confirmation':
          const { recipientRole = 'unknown' } = context;
          if (recipientRole === 'host') {
            userPrompt = `Write a short casual confirmation for the host showing their place at ${dateTime}. Like: "all set! you're showing your place tomorrow 2pm"`;
          } else if (recipientRole === 'visitor') {
            userPrompt = `Write a short casual confirmation for the visitor viewing at ${dateTime}. Like: "you're all set for tomorrow 2pm!"`;
          } else {
            userPrompt = `Write a short casual confirmation for ${dateTime}. Like: "confirmed for tomorrow 2pm!"`;
          }
          break;
        case 'decline_response':
          userPrompt = `Write a short casual response asking for other times. Like: "no worries, when works better for you?"`;
          break;
        case 'request_forwarded':
          userPrompt = `Write a short casual text saying you sent their request to ${recipientName}. Like: "sent it to sarah, she'll get back to you"`;
          break;
        default:
          userPrompt = `Write a short casual response for: ${intent}`;
      }

      const completion = await this.openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.5,
        max_tokens: 50
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