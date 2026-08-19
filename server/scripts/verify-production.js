import ExcelJS from 'exceljs';

const baseUrl = String(process.env.HR_BASE_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const username = String(process.env.HR_ADMIN_USERNAME || 'admin').trim();
const password = String(process.env.HR_ADMIN_PASSWORD || '');
const marker = String(process.env.HR_VERIFY_EMPLOYEE_MARKER || 'CODEX_TEST_').trim();
const month = String(process.env.HR_VERIFY_MONTH || '2099-12').trim();
const requestedShiftCode = String(process.env.HR_VERIFY_SHIFT_CODE || '').trim();

const results = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pass(name, detail = '') {
  results.push({ name, status: 'PASS', detail });
  console.log(`[PASS] ${name}${detail ? ` - ${detail}` : ''}`);
}

function entityId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return String(value._id || value.id || '');
}

function messageFrom(payload) {
  if (typeof payload === 'string') return payload;
  return payload?.error || payload?.message || JSON.stringify(payload);
}

async function request(path, { method = 'GET', token, body, expected = [200], headers = {} } = {}) {
  const response = await fetch(new URL(path, `${baseUrl}/`), {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!expected.includes(response.status)) {
    throw new Error(`${method} ${path} returned ${response.status}: ${messageFrom(payload).slice(0, 300)}`);
  }
  return { response, payload };
}

function schedulesFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.schedules) ? payload.schedules : [];
}

function employeesFrom(payload) {
  if (Array.isArray(payload)) return payload;
  return Array.isArray(payload?.employees) ? payload.employees : [];
}

function buildWorkbook(employee, shift, day) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Verification');
  sheet.addRow(['HR production verification']);
  sheet.addRow(['', '', '\u884c\u4e8b\u66c6']);
  sheet.addRow(['', '', '\u65e5\u671f', day]);
  sheet.addRow(['\u54e1\u5de5\u4ee3\u865f', '\u59d3\u540d', '\u661f\u671f', 'X']);
  sheet.addRow([employee.employeeId, employee.name, employee.title || 'VERIFY', shift.code || shift.name]);
  return workbook.xlsx.writeBuffer();
}

async function verifyStaticAssets() {
  const { payload: html } = await request('/', { expected: [200] });
  assert(typeof html === 'string' && /<html/i.test(html), 'root response is not HTML');

  const assetPaths = new Set();
  for (const match of html.matchAll(/<(?:script|link)\b[^>]+(?:src|href)=["']([^"']+)["']/gi)) {
    const value = match[1];
    if (!value.startsWith('data:')) assetPaths.add(value);
  }
  assert(assetPaths.size > 0, 'root HTML contains no script or stylesheet assets');
  for (const assetPath of [...assetPaths].slice(0, 20)) {
    await request(assetPath, { expected: [200] });
  }
  pass('Frontend entry and referenced assets', `${assetPaths.size} assets reachable`);
}

function verifyShiftSemantics(shifts) {
  const expectedByName = new Map([
    ['\u4f11\u5047', 'rest_day'],
    ['\u4f8b\u5047', 'regular_rest'],
    ['\u570b\u5b9a\u5047\u65e5', 'holiday'],
    ['\u56fd\u5b9a\u5047\u65e5', 'holiday'],
    ['\u7279\u4f11', 'leave'],
  ]);
  let checked = 0;
  for (const shift of shifts) {
    const name = String(shift.name || '').trim();
    const expected = expectedByName.get(name);
    if (expected) {
      assert(shift.semanticType === expected, `${name} semanticType is ${shift.semanticType}, expected ${expected}`);
      checked += 1;
    }
    if (name.includes('(\u4f111)') || name.includes('\uff08\u4f111\uff09')) {
      assert(shift.semanticType === 'work', `${name} must remain a work shift`);
      checked += 1;
    }
  }
  assert(checked > 0, 'no known legacy shift names were available for semantic verification');
  pass('Legacy shift semantics', `${checked} mappings checked`);
}

async function main() {
  assert(password, 'HR_ADMIN_PASSWORD is required');
  assert(/^\d{4}-(0[1-9]|1[0-2])$/.test(month), 'HR_VERIFY_MONTH must use YYYY-MM');
  assert(marker, 'HR_VERIFY_EMPLOYEE_MARKER must not be empty');

  const { payload: health } = await request('/api/health');
  assert(health?.status === 'OK', 'health endpoint did not return status OK');
  pass('API health', `${baseUrl}/api/health`);

  const { payload: login } = await request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role: 'admin' }),
  });
  assert(login?.token, 'login response did not include a token');
  const token = login.token;
  pass('Administrator login', username);

  const { payload: settingsBefore } = await request('/api/attendance-settings', { token });
  assert(settingsBefore?.laborRules, 'laborRules are missing');
  assert(settingsBefore.laborRules.strictCompanyWeeklyRest === true, 'strict company weekly rest must be enabled');
  assert(Number(settingsBefore.laborRules.minShiftRestMinutes) >= 660, 'shift interval must default to at least 11 hours');
  assert(Number(settingsBefore.laborRules.monthlyOvertimeHours) <= 54, 'monthly overtime limit exceeds the supported ceiling');
  pass(
    'Labor-rule configuration',
    `${settingsBefore.laborRules.workTimeRegime}, ${settingsBefore.laborRules.minShiftRestMinutes} minute interval`,
  );

  const { response: unauthorized } = await request('/api/schedules/import', {
    method: 'POST',
    expected: [401],
  });
  assert(unauthorized.status === 401, 'unauthorized schedule import was not rejected');
  pass('Schedule import authorization', 'unauthorized request rejected with 401');

  const { response: rejectedSetting } = await request('/api/attendance-settings', {
    method: 'PUT',
    token,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ laborRules: { strictCompanyWeeklyRest: false } }),
    expected: [400],
  });
  assert(rejectedSetting.status === 400, 'weekly-rest policy disable request was not rejected');
  const { payload: settingsAfter } = await request('/api/attendance-settings', { token });
  assert(settingsAfter?.laborRules?.strictCompanyWeeklyRest === true, 'rejected setting change was persisted');
  pass('Mandatory weekly-rest policy', 'disable request rejected and setting remained enabled');

  const { payload: shiftsPayload } = await request('/api/shifts', { token });
  const shifts = Array.isArray(shiftsPayload) ? shiftsPayload : [];
  assert(shifts.length > 0, 'no shifts are configured');
  verifyShiftSemantics(shifts);
  const shiftIdentityCounts = new Map();
  for (const configuredShift of shifts) {
    for (const value of [configuredShift.code, configuredShift.name]) {
      const key = String(value || '').trim().normalize('NFKC').toUpperCase();
      if (key) shiftIdentityCounts.set(key, (shiftIdentityCounts.get(key) || 0) + 1);
    }
  }
  const workShifts = shifts.filter((shift) => {
    const code = String(shift.code || '').trim().normalize('NFKC').toUpperCase();
    return shift.semanticType === 'work' && code && shiftIdentityCounts.get(code) === 1;
  });
  const shift = requestedShiftCode
    ? workShifts.find((item) => String(item.code || '').trim() === requestedShiftCode)
    : workShifts[0];
  assert(shift, requestedShiftCode
    ? `work shift ${requestedShiftCode} was not found`
    : 'no work shift with a code or name was found');
  pass('Work shift selected', String(shift.code || shift.name));

  const employeePath = `/api/employees?search=${encodeURIComponent(marker)}&pageSize=100`;
  const { payload: employeePayload } = await request(employeePath, { token });
  const markedEmployees = employeesFrom(employeePayload).filter((employee) => {
    const searchable = [employee.employeeId, employee.name, employee.username].filter(Boolean).join(' ');
    return searchable.includes(marker);
  });
  assert(markedEmployees.length > 0, `no employee containing marker ${marker} was found`);
  const employee = markedEmployees.find((item) => item.employeeId && item.name && entityId(item.department));
  assert(employee, 'marked test employee must have employeeId, name, and department');
  const employeeId = entityId(employee._id || employee.id);
  const departmentId = entityId(employee.department);
  assert(employeeId && departmentId, 'test employee identifiers could not be resolved');
  pass('Marked test employee selected', employee.employeeId);

  const schedulePath = `/api/schedules/monthly?month=${encodeURIComponent(month)}&employee=${encodeURIComponent(employeeId)}`;
  const { payload: schedulesBeforePayload } = await request(schedulePath, { token });
  const schedulesBefore = schedulesFrom(schedulesBeforePayload);
  const occupiedDays = new Set(schedulesBefore.map((item) => String(item.date || '').slice(0, 10)));
  const daysInMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
  const emptyDay = Array.from({ length: daysInMonth }, (_, index) => index + 1)
    .find((day) => !occupiedDays.has(`${month}-${String(day).padStart(2, '0')}`));
  const testDay = emptyDay || 1;

  const workbookBuffer = await buildWorkbook(employee, shift, testDay);
  const form = new FormData();
  form.append('month', month);
  form.append('department', departmentId);
  form.append('mode', 'preview');
  form.append('overwrite', emptyDay ? 'false' : 'true');
  form.append(
    'file',
    new Blob([workbookBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `CODEX_VERIFY_${month}.xlsx`,
  );
  const { payload: preview } = await request('/api/schedules/import', {
    method: 'POST',
    token,
    body: form,
  });
  assert(preview?.mode === 'preview', 'schedule import did not remain in preview mode');
  assert(Array.isArray(preview.errors) && preview.errors.length === 0, 'schedule preview returned validation errors');
  assert(preview.scheduleDays === 1, `expected one preview schedule day, received ${preview.scheduleDays}`);
  pass('XLSX schedule preview', `${employee.employeeId}, ${month}-${String(testDay).padStart(2, '0')}`);

  const { payload: schedulesAfterPayload } = await request(schedulePath, { token });
  const schedulesAfter = schedulesFrom(schedulesAfterPayload);
  assert(schedulesAfter.length === schedulesBefore.length, 'preview changed the schedule count');
  const beforeIds = schedulesBefore.map((item) => entityId(item._id || item.id)).filter(Boolean).sort();
  const afterIds = schedulesAfter.map((item) => entityId(item._id || item.id)).filter(Boolean).sort();
  assert(JSON.stringify(afterIds) === JSON.stringify(beforeIds), 'preview changed existing schedule records');
  pass('Non-destructive verification', `schedule count remained ${schedulesAfter.length}`);

  await verifyStaticAssets();

  console.log(`\nVerification complete: ${results.length}/${results.length} checks passed.`);
  console.log('No schedule import was committed and no existing record was deleted.');
}

main().catch((error) => {
  console.error(`\n[FAIL] ${error.message}`);
  console.error(`Verification stopped after ${results.length} passed checks.`);
  process.exitCode = 1;
});
