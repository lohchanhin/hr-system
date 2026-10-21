// 排班遇到「只請幾小時的假」：請假改以小時計之後，只請 2 小時的假不能讓整天都排不了班。
// 上班班別只有在核准請假「整天」或「涵蓋整個班次」時才擋；休/例/國/請假班別不擋；
// 匯入預覽／確認、單格新增／修改、批次套用、完整性檢查都用同一個判斷（leaveCoverageService），而且每個請求只查一次請假。
import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';
import { buildLeaveFieldServiceMock } from './helpers/leaveFieldServiceMock.js';

process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes';

/* ----------------------------- Mocks: Models ----------------------------- */
const mockShiftSchedule = {
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  bulkWrite: jest.fn(),
  deleteMany: jest.fn(),
};
const mockApprovalRequest = { find: jest.fn() };
const mockEmployee = { find: jest.fn(), findById: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockDepartment = { find: jest.fn(), findById: jest.fn() };
const mockHoliday = { find: jest.fn() };
const mockHolidayMoveSetting = { find: jest.fn() };
const mockHolidayRestResolution = { find: jest.fn() };
const mockScheduleDayMemo = { find: jest.fn() };
const mockGetLeaveFieldIds = jest.fn();
const mockIsTokenBlacklisted = jest.fn();
const mockAssertScheduleRuleCompliance = jest.fn();
const mockIsLaborRuleValidationError = jest.fn((error) => Array.isArray(error?.violations));

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }));
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }));
jest.unstable_mockModule('../src/models/HolidayRestResolution.js', () => ({ default: mockHolidayRestResolution }));
jest.unstable_mockModule('../src/models/ScheduleDayMemo.js', () => ({ default: mockScheduleDayMemo }));
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => buildLeaveFieldServiceMock(mockGetLeaveFieldIds));
jest.unstable_mockModule('../src/services/laborRuleValidationService.js', () => ({
  assertScheduleRuleCompliance: mockAssertScheduleRuleCompliance,
  isLaborRuleValidationError: mockIsLaborRuleValidationError,
}));
jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
  isTokenBlacklisted: mockIsTokenBlacklisted,
}));

let app;
let shared;
let validateMonthSchedules;

beforeAll(async () => {
  const scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  shared = await import('../src/controllers/schedule/scheduleShared.js');
  ({ validateMonthSchedules } = await import('../src/services/scheduleValidationService.js'));
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'tester', role: 'admin' };
    next();
  });
  app.use('/api/schedules', scheduleRoutes);
});

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// 日班 08:00-17:00（休息 60 分鐘）、下午班 13:00-17:00、休息日、特休（請假班別）
const SHIFTS = [
  { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
  { _id: 'pm', code: '午', name: '下午班', semanticType: 'work', startTime: '13:00', endTime: '17:00' },
  { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
  { _id: 'special', code: '特', name: '特休', semanticType: 'leave', startTime: '00:00', endTime: '00:00' },
];
const EMPLOYEE = { _id: 'e1', employeeId: 'A001', name: '測試員工', department: 'd1', subDepartment: 'sd1' };

// 台灣時間的 UTC ISO 字串（前端日期選擇器送出的格式）
const taipeiIso = (key, time = '00:00') => new Date(`${key}T${time}:00+08:00`).toISOString();
const hours = (key, from, to, endKey = key) => [taipeiIso(key, from), taipeiIso(endKey, to)];
const wholeDay = (key, lastKey = key) => [taipeiIso(key), taipeiIso(lastKey)];

function setShifts(shifts = SHIFTS) {
  mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts }) });
}

/** ranges：[[開始, 結束], ...] 的核准請假（開始、結束是 ISO 字串）；請假表單欄位 s / e / t */
function setApprovedLeave(ranges = [], type = '事假') {
  mockApprovalRequest.find.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(ranges.map(([start, end]) => ({
      applicant_employee: 'e1',
      form_data: { s: start, e: end, t: type },
    }))),
  });
}

async function workbookWith(codes) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('工作表1');
  sheet.addRow(['公版班表']);
  sheet.addRow(['', '', '行事曆']);
  sheet.addRow(['', '', '日期', ...codes.map((_, index) => index + 1)]);
  sheet.addRow(['員工代號', '姓名', '星期', ...codes.map(() => '')]);
  sheet.addRow(['A001', '測試員工', '護理師', ...codes]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function importCodes(codes, mode = 'preview') {
  return request(app)
    .post('/api/schedules/import')
    .set('Authorization', authHeader())
    .field('month', '2026-06')
    .field('department', 'd1')
    .field('mode', mode)
    .attach('file', await workbookWith(codes), { filename: 'schedule.xlsx', contentType: XLSX_TYPE });
}

function authHeader() {
  const token = jwt.sign({ id: 'tester', role: 'admin', ver: 0 }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: 'hr-system',
    audience: 'hr-system-api',
  });
  return `Bearer ${token}`;
}

const JUNE = (day) => `2026-06-${String(day).padStart(2, '0')}`;
const createBody = (day, shiftId) => ({ employee: 'e1', date: JUNE(day), shiftId, department: 'd1', subDepartment: 'sd1' });

beforeEach(() => {
  jest.resetAllMocks();
  mockIsLaborRuleValidationError.mockImplementation((error) => Array.isArray(error?.violations));
  mockIsTokenBlacklisted.mockResolvedValue(false);
  mockGetLeaveFieldIds.mockResolvedValue({
    formId: 'form1', startId: 's', endId: 'e', typeId: 't', typeOptions: [],
  });
  mockAssertScheduleRuleCompliance.mockResolvedValue({ ok: true, violations: [] });
  mockEmployee.findById.mockImplementation(async (id) => ({ _id: id, role: 'admin' }));
  mockEmployee.find.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([EMPLOYEE]),
  });
  mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  mockShiftSchedule.findOne.mockResolvedValue(null);
  mockShiftSchedule.bulkWrite.mockResolvedValue({ acknowledged: true });
  mockShiftSchedule.create.mockImplementation(async (data) => ({ _id: 'new', ...data }));
  setShifts();
  setApprovedLeave([]);
  mockHoliday.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  mockHolidayMoveSetting.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  mockHolidayRestResolution.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
});

describe('single cell (POST /api/schedules)', () => {
  it('creates a working shift on a day with only a 2-hour leave', async () => {
    setApprovedLeave([hours(JUNE(10), '09:00', '11:00')]);

    const res = await request(app).post('/api/schedules').send(createBody(10, 'day'));

    expect(res.status).toBe(201);
    expect(mockShiftSchedule.create).toHaveBeenCalledTimes(1);
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1);
  });

  it('still rejects a full-day leave, and any leave of the day for a shift missing from the shift table', async () => {
    setApprovedLeave([wholeDay(JUNE(10))]);
    const fullDay = await request(app).post('/api/schedules').send(createBody(10, 'day'));
    expect(fullDay.status).toBe(400);
    expect(fullDay.body).toEqual({ error: 'leave conflict' });

    setApprovedLeave([hours(JUNE(10), '09:00', '11:00')]);
    const unknownShift = await request(app).post('/api/schedules').send(createBody(10, 'deleted-shift'));
    expect(unknownShift.status).toBe(400);
    expect(unknownShift.body).toEqual({ error: 'leave conflict' });
    expect(mockShiftSchedule.create).not.toHaveBeenCalled();
  });

  it('rejects a working shift that the leave covers, and accepts one it only overlaps', async () => {
    setApprovedLeave([hours(JUNE(10), '13:00', '17:00')]);

    const covered = await request(app).post('/api/schedules').send(createBody(10, 'pm'));
    expect(covered.status).toBe(400);
    expect(covered.body).toEqual({ error: 'leave conflict' });

    const overlapped = await request(app).post('/api/schedules').send(createBody(10, 'day'));
    expect(overlapped.status).toBe(201);
  });

  it('accepts a rest-day or leave shift on a part-day leave, but still not on a full-day leave (as before)', async () => {
    setApprovedLeave([wholeDay(JUNE(10)), hours(JUNE(11), '09:00', '11:00')]);

    expect((await request(app).post('/api/schedules').send(createBody(11, 'rest'))).status).toBe(201);
    expect((await request(app).post('/api/schedules').send(createBody(11, 'special'))).status).toBe(201);
    const restOnFullDay = await request(app).post('/api/schedules').send(createBody(10, 'rest'));
    expect(restOnFullDay.status).toBe(400);
    expect(restOnFullDay.body).toEqual({ error: 'leave conflict' });
    expect((await request(app).post('/api/schedules').send(createBody(10, 'special'))).status).toBe(400);
  });

  it('blocks every day of a multi-day leave and only those days', async () => {
    setApprovedLeave([wholeDay(JUNE(10), JUNE(12))]);

    for (const day of [10, 11, 12]) {
      const res = await request(app).post('/api/schedules').send(createBody(day, 'day'));
      expect(res.status).toBe(400);
    }
    expect((await request(app).post('/api/schedules').send(createBody(13, 'day'))).status).toBe(201);
  });
});

describe('single cell update (PUT /api/schedules/:id)', () => {
  const existingDoc = () => ({
    _id: 'sch1',
    employee: 'e1',
    date: new Date(`${JUNE(10)}T00:00:00.000Z`),
    shiftId: 'rest',
    department: 'd1',
    subDepartment: 'sd1',
    save: jest.fn().mockImplementation(function save() { return Promise.resolve({ ...this }); }),
  });

  it('changes a row to a working shift on a day with only a 2-hour leave', async () => {
    setApprovedLeave([hours(JUNE(10), '09:00', '11:00')]);
    const doc = existingDoc();
    mockShiftSchedule.findById.mockResolvedValue(doc);

    const res = await request(app).put('/api/schedules/sch1').send({ shiftId: 'day' });

    expect(res.status).toBe(200);
    expect(doc.save).toHaveBeenCalled();
  });

  it('rejects a change to a working shift that the leave covers', async () => {
    setApprovedLeave([hours(JUNE(10), '13:00', '17:00')]);
    const doc = existingDoc();
    mockShiftSchedule.findById.mockResolvedValue(doc);

    const res = await request(app).put('/api/schedules/sch1').send({ shiftId: 'pm' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'leave conflict' });
    expect(doc.save).not.toHaveBeenCalled();
  });

  it('judges the shift the row will have after the update, not the one it has now', async () => {
    setApprovedLeave([wholeDay(JUNE(10))]);
    const doc = existingDoc();
    doc.shiftId = 'day';
    mockShiftSchedule.findById.mockResolvedValue(doc);

    // 全天請假日不論改成上班班別或休息日都擋（手動排班原本的行為）；不改班別（沿用目前的上班班別）也擋
    expect((await request(app).put('/api/schedules/sch1').send({ shiftId: 'rest' })).status).toBe(400);
    const keep = await request(app).put('/api/schedules/sch1').send({ department: 'd1' });
    expect(keep.status).toBe(400);
    expect(keep.body).toEqual({ error: 'leave conflict' });

    // 只請幾小時的假，同一列改成休息日就可以
    setApprovedLeave([hours(JUNE(10), '09:00', '11:00')]);
    expect((await request(app).put('/api/schedules/sch1').send({ shiftId: 'rest' })).status).toBe(200);
  });
});

describe('batch apply (POST /api/schedules/batch)', () => {
  const batch = (cells) => request(app).post('/api/schedules/batch').send({
    schedules: cells.map(([day, shiftId]) => createBody(day, shiftId)),
  });

  it('applies working shifts on a day with only a 2-hour leave, with one leave query for all cells', async () => {
    setApprovedLeave([hours(JUNE(10), '09:00', '11:00'), wholeDay(JUNE(20))]);
    mockShiftSchedule.find
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) });

    const res = await batch(Array.from({ length: 9 }, (_, index) => [index + 5, 'day']));

    expect(res.status).toBe(201);
    expect(mockShiftSchedule.bulkWrite).toHaveBeenCalledTimes(1);
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1);
  });

  it('rejects the whole batch when one cell is a working shift on a full-day leave or covered by the leave', async () => {
    setApprovedLeave([wholeDay(JUNE(20)), hours(JUNE(10), '13:00', '17:00')]);

    const fullDay = await batch([[9, 'day'], [20, 'day']]);
    expect(fullDay.status).toBe(400);
    expect(fullDay.body).toEqual({ error: 'leave conflict' });

    const covered = await batch([[9, 'day'], [10, 'pm']]);
    expect(covered.status).toBe(400);
    expect(covered.body).toEqual({ error: 'leave conflict' });
    expect(mockShiftSchedule.bulkWrite).not.toHaveBeenCalled();
  });

  it('judges each cell with its own shift: a rest-day shift on a part-day leave passes, on a full-day leave it does not', async () => {
    setApprovedLeave([wholeDay(JUNE(20)), hours(JUNE(21), '09:00', '11:00')]);
    mockShiftSchedule.find
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) })
      .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue([]) });

    expect((await batch([[21, 'rest'], [22, 'day']])).status).toBe(201);
    expect((await batch([[20, 'rest'], [22, 'day']])).status).toBe(400);
    // 同一天送了兩格時以後面那格為準，所以這一天要用日班判斷
    expect((await batch([[21, 'rest'], [21, 'day']])).status).toBe(201);
    expect((await batch([[20, 'rest'], [20, 'day']])).status).toBe(400);
  });
});

describe('schedule import', () => {
  const codes = (cells) => Array.from({ length: 28 }, (_, index) => cells[index + 1] || '');

  it('previews and commits a working shift on a day with only a 2-hour leave', async () => {
    setApprovedLeave([hours(JUNE(3), '09:00', '11:00')]);

    const preview = await importCodes(codes({ 3: '日', 4: '日' }));
    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.scheduleDays).toBe(2);

    const committed = await importCodes(codes({ 3: '日', 4: '日' }), 'commit');
    expect(committed.status).toBe(201);
    expect(committed.body.imported).toBe(2);
  });

  it('keeps blocking a full-day leave with the same message as before', async () => {
    setApprovedLeave([wholeDay(JUNE(3), JUNE(4))]);

    const preview = await importCodes(codes({ 3: '日', 4: '午', 5: '日' }));

    expect(preview.status).toBe(422);
    expect(preview.body.errors).toEqual([
      expect.objectContaining({ day: 3, code: '日', message: '該日期已有核准請假，無法匯入班別' }),
      expect.objectContaining({ day: 4, code: '午', message: '該日期已有核准請假，無法匯入班別' }),
    ]);
  });

  it('blocks a working shift that the leave covers, saying so, and lets one it only overlaps through', async () => {
    setApprovedLeave([hours(JUNE(3), '13:00', '17:00')]);

    const covered = await importCodes(codes({ 3: '午' }));
    expect(covered.status).toBe(422);
    expect(covered.body.errors).toEqual([
      expect.objectContaining({ day: 3, code: '午', message: '該日期已有核准請假涵蓋整個班別，無法匯入班別' }),
    ]);

    const overlapped = await importCodes(codes({ 3: '日' }));
    expect(overlapped.status).toBe(200);
    expect(overlapped.body.errors).toEqual([]);
  });

  it('accepts a rest-day or leave shift on a leave day, and does not warn that the leave shift has no leave request', async () => {
    setApprovedLeave([hours(JUNE(3), '09:00', '11:00'), wholeDay(JUNE(4))]);

    const preview = await importCodes(codes({ 3: '休', 4: '特' }));

    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.warnings.map((warning) => warning.message).join('\n')).not.toContain('已核准假單');
  });

  it('reads the approved leave once however many cells there are', async () => {
    setApprovedLeave([hours(JUNE(3), '09:00', '11:00')]);

    const cells = Object.fromEntries(Array.from({ length: 28 }, (_, index) => [index + 1, '日']));
    expect((await importCodes(codes(cells))).status).toBe(200);
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1);
  });
});

describe('hasLeaveConflict', () => {
  const day = new Date(`${JUNE(10)}T00:00:00.000Z`);

  it('judges a working shift by the leave times, a non-work shift never, and no shift by the whole day', async () => {
    setApprovedLeave([hours(JUNE(10), '09:00', '11:00')]);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[0])).toBe(false);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[2])).toBe(false);
    expect(await shared.hasLeaveConflict('e1', day)).toBe(true);
    expect(await shared.hasLeaveConflict('e1', new Date(`${JUNE(11)}T00:00:00.000Z`))).toBe(false);

    setApprovedLeave([hours(JUNE(10), '13:00', '17:00')]);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[1])).toBe(true);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[0])).toBe(false);

    setApprovedLeave([wholeDay(JUNE(10))]);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[0])).toBe(true);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[3])).toBe(false);
  });

  it('with strictNonWork (manual edits) a non-work shift is still blocked by a whole-day leave but not by a part-day leave', async () => {
    const strict = { strictNonWork: true };
    setApprovedLeave([wholeDay(JUNE(10))]);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[2], strict)).toBe(true);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[3], strict)).toBe(true);

    setApprovedLeave([hours(JUNE(10), '09:00', '11:00')]);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[2], strict)).toBe(false);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[3], strict)).toBe(false);
  });
});

describe('schedule completeness check', () => {
  const rows = (...entries) => entries.map(([date, shiftId]) => ({
    employee: 'e1',
    date: new Date(`${date}T00:00:00.000Z`),
    shiftId,
  }));

  async function conflictDaysFor(scheduleRows) {
    mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(scheduleRows) });
    mockEmployee.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'e1', name: '測試員工', role: 'employee' }]) });
    const validation = await validateMonthSchedules('2026-06');
    return validation.results[0].conflictDays;
  }

  it('does not call a working shift on a day with only a 2-hour leave a conflict', async () => {
    setApprovedLeave([hours(JUNE(10), '09:00', '11:00')]);
    expect(await conflictDaysFor(rows([JUNE(10), 'day']))).toEqual([]);
  });

  it('calls a working shift on a full-day leave, or one the leave covers, a conflict', async () => {
    setApprovedLeave([wholeDay(JUNE(10)), hours(JUNE(11), '13:00', '17:00'), hours(JUNE(12), '13:00', '17:00')]);
    expect(await conflictDaysFor(rows([JUNE(10), 'day'], [JUNE(11), 'pm'], [JUNE(12), 'day']))).toEqual([JUNE(10), JUNE(11)]);
  });

  it('does not call a rest-day or leave shift on a leave day a conflict', async () => {
    setApprovedLeave([wholeDay(JUNE(10))]);
    expect(await conflictDaysFor(rows([JUNE(10), 'rest']))).toEqual([]);
  });

  it('keeps the whole-day rule when the shift is not in the shift table', async () => {
    setApprovedLeave([hours(JUNE(10), '09:00', '11:00')]);
    expect(await conflictDaysFor(rows([JUNE(10), 'deleted-shift']))).toEqual([JUNE(10)]);
  });

  // 每位員工：10 日日班＋只請 2 小時、11 日下午班＋請假涵蓋整個下午班；人數變多，查假單的次數不變
  async function validateEmployees(count, leavesOf) {
    const employees = Array.from({ length: count }, (_, index) => ({ _id: `e${index + 1}`, name: `員工${index + 1}`, role: 'employee' }));
    mockEmployee.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(employees) });
    mockShiftSchedule.find.mockImplementation((filter) => ({
      lean: jest.fn().mockResolvedValue([
        { employee: filter.employee, date: new Date(`${JUNE(10)}T00:00:00.000Z`), shiftId: 'day' },
        { employee: filter.employee, date: new Date(`${JUNE(11)}T00:00:00.000Z`), shiftId: 'pm' },
      ]),
    }));
    mockApprovalRequest.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(employees.flatMap(({ _id }) => leavesOf().map(([start, end]) => ({
        applicant_employee: _id,
        form_data: { s: start, e: end, t: '事假' },
      })))),
    });
    mockApprovalRequest.find.mockClear();
    const validation = await validateMonthSchedules('2026-06');
    return { employees, validation, finds: mockApprovalRequest.find.mock.calls };
  }

  it('reads the approved leave a fixed number of times however many employees it checks', async () => {
    const leaves = () => [hours(JUNE(10), '09:00', '11:00'), hours(JUNE(11), '13:00', '17:00')];
    for (const count of [1, 5, 40]) {
      const { employees, validation, finds } = await validateEmployees(count, leaves);

      expect(validation.results).toHaveLength(count);
      validation.results.forEach((result) => expect(result.conflictDays).toEqual([JUNE(11)]));
      // 請假日曆一次、請假時間區間一次（一個請假表單），兩次都涵蓋所有員工；以前每位員工各查兩次（40 人就是 80 次）
      expect(finds).toHaveLength(2);
      finds.forEach(([filter]) => expect(filter.applicant_employee).toEqual({ $in: employees.map(({ _id }) => _id) }));
    }
  });

  it('does not read the leave times when nobody has a leave on a rostered working day', async () => {
    // 20 日沒有排班：只算請假日，不用判斷班次，所以只讀一次請假日曆
    const { validation, finds } = await validateEmployees(10, () => [hours(JUNE(20), '09:00', '11:00')]);

    expect(validation.results.every((result) => result.conflictDays.length === 0)).toBe(true);
    expect(finds).toHaveLength(1);
  });
});

describe('Excel export', () => {
  const chain = (rows) => ({
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  });
  const rowOf = (day, shiftId) => ({
    employee: { _id: { toString: () => 'e1' }, name: '測試員工' },
    date: new Date(`${JUNE(day)}T00:00:00.000Z`),
    shiftId,
    department: 'd1',
    state: 'finalized',
  });

  async function exportSheet(schedules, ranges, type = '事假') {
    mockEmployee.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: { toString: () => 'e1' }, employeeId: 'A001', name: '測試員工', title: '', practiceTitle: '', subDepartment: { name: 'A單位' },
      }]),
    });
    mockDepartment.findById.mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ name: '護理' }) });
    mockShiftSchedule.find.mockReturnValue(chain(schedules));
    mockScheduleDayMemo.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });
    setApprovedLeave(ranges, type);
    const res = await request(app)
      .get('/api/schedules/export?month=2026-06&department=d1&format=excel')
      .set('Authorization', authHeader())
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    return workbook.getWorksheet('工作表1');
  }

  const cellOf = (sheet, day) => sheet.getRow(6).getCell(4 + day).value;

  it('keeps the rostered shift on a day with only a 2-hour leave, and the leave code on a whole-day leave', async () => {
    const sheet = await exportSheet(
      [rowOf(3, 'day'), rowOf(4, 'day'), rowOf(5, 'day')],
      [hours(JUNE(3), '09:00', '11:00'), wholeDay(JUNE(4))],
    );

    expect(cellOf(sheet, 3)).toBe('日');
    expect(cellOf(sheet, 4)).toBe('事');
    expect(cellOf(sheet, 5)).toBe('日');
  });

  it('shows the leave code when the leave covers the whole shift, not when it only overlaps it', async () => {
    const sheet = await exportSheet(
      [rowOf(3, 'pm'), rowOf(4, 'day'), rowOf(5, 'day')],
      [hours(JUNE(3), '13:00', '17:00'), hours(JUNE(4), '13:00', '17:00'), hours(JUNE(5), '08:00', '17:00')],
    );

    expect(cellOf(sheet, 3)).toBe('事');
    expect(cellOf(sheet, 4)).toBe('日');
    expect(cellOf(sheet, 5)).toBe('事');
  });

  it('still shows the leave on a day without a roster row, and keeps a rest-day row on a 2-hour leave', async () => {
    const sheet = await exportSheet(
      [rowOf(3, 'rest')],
      [hours(JUNE(3), '09:00', '11:00'), hours(JUNE(6), '09:00', '11:00')],
    );

    expect(cellOf(sheet, 3)).toBe('休');
    expect(cellOf(sheet, 6)).toBe('事');
  });

  it('takes the days in the middle of a timed multi-day leave as leave days', async () => {
    const sheet = await exportSheet(
      [rowOf(3, 'day'), rowOf(4, 'day'), rowOf(5, 'day')],
      [hours(JUNE(3), '13:00', '10:00', JUNE(5))],
    );

    expect([3, 4, 5].map((day) => cellOf(sheet, day))).toEqual(['日', '事', '日']);
  });
});
