const moment = require('moment-timezone');

// Mock calendar service with a conflict at 4pm tomorrow
const mockCalendarService = {
  async checkAvailability(datetime) {
    // Simulate existing appointment at 4pm tomorrow
    const testTime = moment(datetime);
    const conflictTime = moment().add(1, 'day').hour(16).minute(0); // 4pm tomorrow

    // Only 4pm has a conflict (more realistic scenario)
    const hasConflict = testTime.hour() === 16; // Only 4pm conflicts

    console.log(`Checking availability for ${testTime.format('YYYY-MM-DD HH:mm')}`);
    console.log(`Conflict time: ${conflictTime.format('YYYY-MM-DD HH:mm')}`);
    console.log(`Has conflict: ${hasConflict}`);

    return !hasConflict; // Return true if available (no conflict)
  }
};

// Mock message service
const mockMessageService = {
  async sendMessage(recipient, message) {
    console.log(`📨 Message to ${recipient}: ${message}`);
  }
};

// Test the refined calendar conflict detection logic
async function testRefinedCalendarConflictDetection() {
  console.log('🧪 Testing Refined Calendar Conflict Detection\n');

  // Simulate the scenario: buyer requests 3pm, 4pm, 5pm tomorrow
  const timeOptions = [
    {
      datetime: moment().add(1, 'day').hour(15).minute(0).toISOString(), // 3pm
      display: 'Tomorrow 3pm'
    },
    {
      datetime: moment().add(1, 'day').hour(16).minute(0).toISOString(), // 4pm
      display: 'Tomorrow 4pm'
    },
    {
      datetime: moment().add(1, 'day').hour(17).minute(0).toISOString(), // 5pm
      display: 'Tomorrow 5pm'
    }
  ];

  console.log('📅 Original time options:', timeOptions.map(t => t.display).join(', '));
  console.log('\n🔍 Checking calendar availability for each time option...\n');

  // Step 1: Check calendar availability for each time option and filter out conflicts
  const availableTimeOptions = [];

  for (const timeOption of timeOptions) {
    try {
      const datetime = new Date(timeOption.datetime);
      const isAvailable = await mockCalendarService.checkAvailability(datetime);

      if (isAvailable) {
        availableTimeOptions.push(timeOption);
        console.log(`✅ Time slot available: ${timeOption.display}`);
      } else {
        console.log(`❌ Time slot unavailable (conflict): ${timeOption.display}`);
      }
    } catch (error) {
      console.error(`Error checking availability for ${timeOption.display}:`, error);
      console.log(`❌ Time slot marked unavailable due to error: ${timeOption.display}`);
    }
  }

  console.log(`\n📊 Results:`);
  console.log(`- Original options: ${timeOptions.length}`);
  console.log(`- Available options: ${availableTimeOptions.length}`);
  console.log(`- Conflicted options: ${timeOptions.length - availableTimeOptions.length}`);

  // Step 2: Apply the refined conflict detection logic
  if (availableTimeOptions.length === 0) {
    console.log('\n🚫 No proposed times are available, would offer alternative slots...');
    await mockMessageService.sendMessage('buyer', `I'm sorry, but the times you proposed (${timeOptions.map(t => t.display).join(', ')}) are not available due to schedule conflicts. Here are some alternative times that work: [alternatives would be provided]`);
  } else if (availableTimeOptions.length < timeOptions.length) {
    // ✨ THIS IS THE KEY ENHANCEMENT ✨
    console.log('\n🎯 Some times were filtered out due to conflicts - applying refined logic...');

    // Find which times conflicted
    const conflictedTimes = timeOptions.filter(original =>
      !availableTimeOptions.some(available => available.datetime === original.datetime)
    );

    console.log(`\n💬 Sending specific conflict message to buyer:`);

    // Send message to buyer about specific conflicts
    const conflictMessage = `I have an existing appointment at ${conflictedTimes.map(t => t.display).join(' and ')}, but I'm forwarding your other time options (${availableTimeOptions.map(t => t.display).join(', ')}) to the seller for their selection.`;
    await mockMessageService.sendMessage('buyer', conflictMessage);

    console.log(`\n📤 Would forward to seller: ${availableTimeOptions.length} available options`);
    console.log(`Available options for seller selection: ${availableTimeOptions.map(t => t.display).join(', ')}`);

  } else {
    console.log('\n✅ All times are available, proceeding normally...');
    await mockMessageService.sendMessage('seller', `Please select from these viewing times: ${availableTimeOptions.map(t => t.display).join(', ')}`);
  }

  console.log('\n🎉 Test completed!');
}

// Run the test
testRefinedCalendarConflictDetection().catch(console.error);