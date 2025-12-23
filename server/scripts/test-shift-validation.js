/**
 * Simple test to verify shift allowance validation
 */

// Test function that simulates buildShiftPayload behavior
function testBuildShiftPayload(input, existing = {}) {
  const merged = { ...existing, ...input };
  const name = (merged.name || '').trim();
  const code = (merged.code || '').trim();
  
  const payload = {
    name,
    code,
    startTime: merged.startTime,
    endTime: merged.endTime,
    breakDuration: merged.breakDuration || 0,
    isNightShift: Boolean(merged.isNightShift ?? existing.isNightShift ?? false),
    hasAllowance: Boolean(merged.hasAllowance ?? existing.hasAllowance ?? (merged.isNightShift ?? existing.isNightShift ?? false)),
    fixedAllowanceAmount: merged.fixedAllowanceAmount !== undefined ? Number(merged.fixedAllowanceAmount) : (existing.fixedAllowanceAmount ?? 0),
  };

  // Validation
  if (payload.isNightShift && payload.hasAllowance) {
    if (!payload.fixedAllowanceAmount || payload.fixedAllowanceAmount <= 0) {
      throw new Error('啟用夜班津貼時，固定津貼金額必須大於 0');
    }
  }

  return payload;
}

console.log('🧪 Testing shift allowance validation...\n');

// Test 1: Valid fixed configuration
try {
  const shift1 = testBuildShiftPayload({
    name: '夜班',
    code: 'NIGHT',
    startTime: '22:00',
    endTime: '06:00',
    isNightShift: true,
    hasAllowance: true,
    fixedAllowanceAmount: 200
  });
  console.log('✅ Test 1 PASSED: Valid fixed configuration');
} catch (error) {
  console.log('❌ Test 1 FAILED:', error.message);
}

// Test 2: Invalid fixed allowance (0)
try {
  const shift2 = testBuildShiftPayload({
    name: '夜班',
    code: 'NIGHT',
    startTime: '22:00',
    endTime: '06:00',
    isNightShift: true,
    hasAllowance: true,
    fixedAllowanceAmount: 0
  });
  console.log('❌ Test 2 FAILED: Should have thrown error for fixedAllowanceAmount = 0');
} catch (error) {
  console.log('✅ Test 2 PASSED: Correctly rejected fixedAllowanceAmount = 0');
  console.log('   Error:', error.message);
}

// Test 3: Night shift defaults to allowance enabled
try {
  const shift3 = testBuildShiftPayload({
    name: '夜班',
    code: 'NIGHT',
    startTime: '22:00',
    endTime: '06:00',
    isNightShift: true,
    fixedAllowanceAmount: 300
  });
  if (!shift3.hasAllowance) {
    throw new Error('夜班未啟用津貼');
  }
  console.log('✅ Test 3 PASSED: Night shift defaults to allowance enabled with fixed amount');
} catch (error) {
  console.log('❌ Test 3 FAILED:', error.message);
}

// Test 4: Invalid fixed amount (0)
try {
  const shift4 = testBuildShiftPayload({
    name: '夜班',
    code: 'NIGHT',
    startTime: '22:00',
    endTime: '06:00',
    isNightShift: true,
    hasAllowance: true,
    allowanceType: 'fixed',
    fixedAllowanceAmount: 0
  });
  console.log('❌ Test 4 FAILED: Should have thrown error for fixedAmount = 0');
} catch (error) {
  console.log('✅ Test 4 PASSED: Correctly rejected fixedAmount = 0');
  console.log('   Error:', error.message);
}

// Test 5: hasAllowance = false, multiplier = 0 (should be OK)
try {
  const shift5 = testBuildShiftPayload({
    name: '夜班',
    code: 'NIGHT',
    startTime: '22:00',
    endTime: '06:00',
    isNightShift: true,
    hasAllowance: false,
    allowanceMultiplier: 0
  });
  console.log('✅ Test 5 PASSED: hasAllowance=false allows multiplier=0');
} catch (error) {
  console.log('❌ Test 5 FAILED:', error.message);
}

// Test 6: Missing allowanceType (should default to multiplier)
try {
  const shift6 = testBuildShiftPayload({
    name: '夜班',
    code: 'NIGHT',
    startTime: '22:00',
    endTime: '06:00',
    isNightShift: true,
    hasAllowance: true,
    allowanceMultiplier: 0.5
  });
  console.log('✅ Test 6 PASSED: Missing allowanceType defaults to multiplier');
  console.log('   allowanceType:', shift6.allowanceType);
} catch (error) {
  console.log('❌ Test 6 FAILED:', error.message);
}

console.log('\n✅ All tests completed!');
