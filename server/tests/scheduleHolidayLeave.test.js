// 公版班表匯入：國定假日／請假代碼照班別設定存成班表、Excel 日期儲存格、預覽規範檢核、
// 完整性檢查，以及班表列表／Excel 匯出對國定假日與請假列的處理。

import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import { buildLeaveFieldServiceMock } from './helpers/leaveFieldServiceMock.js';
import ExcelJS from 'exceljs';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes';

/* ----------------------------- Mocks: Models ----------------------------- */
const mockShiftSchedule = {
  find: jest.fn(),
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
let validateMonthSchedules;
let shared;

beforeAll(async () => {
  const scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  ({ validateMonthSchedules } = await import('../src/services/scheduleValidationService.js'));
  shared = await import('../src/controllers/schedule/scheduleShared.js');
  app = express();
  app.use(express.json());
  // 列表與匯出路由的登入驗證在 index.js 掛載處，這裡直接帶入管理員身分；匯入路由自己會驗證 token
  app.use((req, _res, next) => {
    req.user = { id: 'tester', role: 'admin' };
    next();
  });
  app.use('/api/schedules', scheduleRoutes);
});

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// 日期欄位不足整個月的檔案，每週一例一休無從檢核：匯入會多一則「未檢核」提醒（這些測試的檔案都只放前幾天）
const partialColumnsWarning = () => expect.objectContaining({
  row: null,
  message: expect.stringContaining('未檢核每週一例一休'),
});

function authHeader(role = 'admin') {
  const token = jwt.sign({ id: 'tester', role, ver: 0 }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: 'hr-system',
    audience: 'hr-system-api',
  });
  return `Bearer ${token}`;
}

// 客戶 公版班別表（節錄）：休息日、例假、國定假日、請假都是 00:00-00:00
const SHIFTS = [
  { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakMinutes: 60 },
  { _id: 'rest', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
  { _id: 'regular', code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
  { _id: 'holiday', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
  { _id: 'special', code: '特', name: '特休', semanticType: 'leave', startTime: '00:00', endTime: '00:00' },
  { _id: 'injury', code: '公傷', name: '公傷假', semanticType: 'leave', startTime: '00:00', endTime: '00:00' },
  { _id: 'range1', code: '11-20', name: '十一點到二十點', semanticType: 'work', startTime: '11:00', endTime: '20:00', breakMinutes: 60 },
  { _id: 'range2', code: '8-12', name: '八點到十二點', semanticType: 'work', startTime: '08:00', endTime: '12:00' },
];

const EMPLOYEE = { _id: 'e1', employeeId: 'A001', name: '測試員工', department: 'd1', subDepartment: 'sd1' };

function setShifts(shifts = SHIFTS) {
  mockAttendanceSetting.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({ shifts }) });
}

function setApprovedLeave(days = [], type = '特休') {
  mockApprovalRequest.find.mockReturnValue({
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(days.map((day) => ({
      applicant_employee: 'e1',
      form_data: { s: day, e: day, t: type },
    }))),
  });
}

function setHolidays(holidays = []) {
  mockHoliday.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(holidays) });
}

function setHolidayMoves(moves = []) {
  mockHolidayMoveSetting.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(moves) });
}

function setExistingSchedules(rows = []) {
  mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) });
}

/** 依公版格式建立班表：codes 為從 1 日起的儲存格內容，Date 物件會存成日期儲存格 */
async function buildWorkbook(codes, { employeeId = 'A001' } = {}) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('工作表1');
  sheet.addRow(['公版班表']);
  sheet.addRow(['', '', '行事曆']);
  sheet.addRow(['', '', '日期', ...codes.map((_, index) => index + 1)]);
  sheet.addRow(['員工代號', '姓名', '星期', ...codes.map(() => '')]);
  sheet.addRow([employeeId, '測試員工', '護理師', ...codes]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function importWorkbook(file, fields = {}) {
  let req = request(app)
    .post('/api/schedules/import')
    .set('Authorization', authHeader('admin'))
    .field('month', '2026-06')
    .field('department', 'd1');
  Object.entries({ mode: 'preview', ...fields }).forEach(([key, value]) => {
    req = req.field(key, value);
  });
  return req.attach('file', file, { filename: 'schedule.xlsx', contentType: XLSX_TYPE });
}

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
  mockShiftSchedule.bulkWrite.mockResolvedValue({ acknowledged: true });
  setShifts();
  setApprovedLeave([]);
  setHolidays([]);
  setHolidayMoves([]);
  mockHolidayRestResolution.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
  setExistingSchedules([]);
});

/* ------------------------------ 匯入：國／請假 ------------------------------ */
describe('schedule import of holiday and leave marks', () => {
  it('saves 國 and leave codes defined in the shift table as normal schedule rows', async () => {
    setHolidays([{ date: new Date('2026-06-19T00:00:00.000Z'), name: '端午節', type: '國定假日' }]);
    // 6/6 例、6/7 休、6/8 日、…… 6/19 國（只用前 19 天）
    const codes = Array.from({ length: 19 }, () => '日');
    codes[5] = '例';
    codes[6] = '休';
    codes[18] = '國';
    codes[9] = '特';
    const file = await buildWorkbook(codes);

    const preview = await importWorkbook(file);

    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.scheduleDays).toBe(19);
    // 國（有日曆）不會有提醒；特 沒有核准假單，有提醒但一樣存檔
    expect(preview.body.informationalDays).toBe(2);
    expect(preview.body.skippedDays).toBe(0);
    expect(preview.body.warnings).toEqual([
      expect.objectContaining({ row: 5, day: 10, code: '特', message: expect.stringContaining('已核准假單') }),
      partialColumnsWarning(),
    ]);
    expect(mockShiftSchedule.bulkWrite).not.toHaveBeenCalled();

    const committed = await importWorkbook(file, { mode: 'commit' });

    expect(committed.status).toBe(201);
    expect(committed.body.imported).toBe(19);
    const operations = mockShiftSchedule.bulkWrite.mock.calls[0][0];
    const byDay = new Map(operations.map(({ updateOne }) => [
      updateOne.filter.date.toISOString().slice(0, 10),
      updateOne.update.$set.shiftId,
    ]));
    expect(byDay.get('2026-06-19')).toBe('holiday');
    expect(byDay.get('2026-06-10')).toBe('special');
    expect(byDay.get('2026-06-06')).toBe('regular');
    expect(byDay.get('2026-06-07')).toBe('rest');
    expect(byDay.get('2026-06-08')).toBe('day');
  });

  it('resolves 國定假日 and 特休 written by their names', async () => {
    setHolidays([{ date: new Date('2026-06-02T00:00:00.000Z'), name: '補假', type: '國定假日' }]);
    setApprovedLeave(['2026-06-03']);
    const file = await buildWorkbook(['日', '國定假日', '特休']);

    const preview = await importWorkbook(file, { mode: 'commit' });

    expect(preview.status).toBe(201);
    const shiftIds = mockShiftSchedule.bulkWrite.mock.calls[0][0].map(({ updateOne }) => updateOne.update.$set.shiftId);
    expect(shiftIds).toEqual(['day', 'holiday', 'special']);
    expect(preview.body.warnings).toEqual([partialColumnsWarning()]);
    expect(preview.body.informationalDays).toBe(2);
  });

  it('warns when a holiday shift is used on a date missing from the holiday calendar', async () => {
    // 6/2 只有補班日，不算國定假日
    setHolidays([{ date: new Date('2026-06-02T00:00:00.000Z'), name: '補班日', type: '補班日' }]);
    const file = await buildWorkbook(['日', '國']);

    const preview = await importWorkbook(file);

    expect(preview.status).toBe(200);
    expect(preview.body.scheduleDays).toBe(2);
    expect(preview.body.warnings).toEqual([
      expect.objectContaining({ day: 2, code: '國', message: expect.stringContaining('假日日曆') }),
      partialColumnsWarning(),
    ]);
  });

  it('still skips 國 and leave codes that the shift table does not define, with a warning that points to 班別設定', async () => {
    setShifts([SHIFTS[0], SHIFTS[1]]);
    const file = await buildWorkbook(['日', '國', '事假', '休']);

    const preview = await importWorkbook(file);

    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.scheduleDays).toBe(2);
    expect(preview.body.informationalDays).toBe(2);
    expect(preview.body.skippedDays).toBe(2);
    expect(preview.body.warnings).toHaveLength(3);
    preview.body.warnings.slice(0, 2).forEach((warning) => {
      expect(warning.message).toContain('班別設定');
    });
    expect(preview.body.warnings.map((warning) => warning.code)).toEqual(['國', '事假', '']);
    expect(preview.body.warnings[2]).toEqual(partialColumnsWarning());
  });

  it('still rejects unknown codes that are neither holiday nor leave marks', async () => {
    const file = await buildWorkbook(['日', 'ZZ']);

    const preview = await importWorkbook(file);

    expect(preview.status).toBe(422);
    expect(preview.body.errors).toEqual([
      expect.objectContaining({ day: 2, code: 'ZZ' }),
    ]);
  });

  it('treats an approved-leave day as a conflict only for working shifts', async () => {
    setApprovedLeave(['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04']);
    // 6/1 日（上班）→ 衝突；6/2 國、6/3 特、6/4 休 → 不算衝突
    const file = await buildWorkbook(['日', '國', '特', '休']);

    const preview = await importWorkbook(file);

    expect(preview.status).toBe(422);
    expect(preview.body.errors).toEqual([
      expect.objectContaining({ day: 1, code: '日', message: '該日期已有核准請假，無法匯入班別' }),
    ]);

    const nonWorkOnly = await importWorkbook(await buildWorkbook(['', '國', '特', '休']));
    expect(nonWorkOnly.status).toBe(200);
    expect(nonWorkOnly.body.errors).toEqual([]);
    expect(nonWorkOnly.body.scheduleDays).toBe(3);
    // 特 在核准請假日，不再提醒「沒有假單」；國 的日曆提醒仍在
    expect(nonWorkOnly.body.warnings.map((warning) => warning.code)).toEqual(['國', '']);
    expect(nonWorkOnly.body.warnings[1]).toEqual(partialColumnsWarning());
  });

  it('never treats a shift without working time as a working shift, even if it was saved as 上班', async () => {
    // 管理畫面預設把班別性質存成 work：00:00-00:00 的「特」仍不能算上班
    setShifts([
      SHIFTS[0],
      { _id: 'leave-as-work', code: '特', name: '特休', semanticType: 'work', startTime: '00:00', endTime: '00:00' },
    ]);
    setApprovedLeave(['2026-06-02']);

    const preview = await importWorkbook(await buildWorkbook(['日', '特']));

    expect(preview.status).toBe(200);
    expect(preview.body.errors).toEqual([]);
    expect(preview.body.scheduleDays).toBe(2);
    expect(preview.body.informationalDays).toBe(1);
  });

  it('reports ambiguous 國/leave identifiers in the shift table instead of silently picking one', async () => {
    setShifts([
      SHIFTS[0],
      { _id: 'a', code: '特', name: '特休', semanticType: 'leave', startTime: '00:00', endTime: '00:00' },
      { _id: 'b', code: '假', name: '特', semanticType: 'leave', startTime: '00:00', endTime: '00:00' },
    ]);

    const preview = await importWorkbook(await buildWorkbook(['日', '特']));

    expect(preview.status).toBe(409);
    expect(preview.body.code).toBe('SHIFT_IDENTIFIER_CONFLICT');
  });

  it('replaces existing rows (including 國 rows) only when overwrite is enabled', async () => {
    setHolidays([{ date: new Date('2026-06-02T00:00:00.000Z'), name: '端午節', type: '國定假日' }]);
    const existing = [
      { _id: 'old-1', employee: 'e1', date: new Date('2026-06-01T00:00:00.000Z'), shiftId: 'rest', department: 'd1' },
      { _id: 'old-2', employee: 'e1', date: new Date('2026-06-02T00:00:00.000Z'), shiftId: 'day', department: 'd1' },
    ];
    setExistingSchedules(existing);
    const file = await buildWorkbook(['日', '國']);

    const withoutOverwrite = await importWorkbook(file);
    expect(withoutOverwrite.status).toBe(200);
    expect(withoutOverwrite.body.overwriteCount).toBe(2);
    expect(withoutOverwrite.body.scheduleDays).toBe(0);

    const overwritePreview = await importWorkbook(file, { overwrite: 'true' });
    expect(overwritePreview.status).toBe(200);
    expect(overwritePreview.body.overwriteCount).toBe(0);
    expect(overwritePreview.body.scheduleDays).toBe(2);
    // 預覽時被取代的舊列要排除在規範檢核之外
    expect(mockAssertScheduleRuleCompliance.mock.calls.at(-1)[0].ignoredScheduleIds).toEqual(['old-1', 'old-2']);

    const committed = await importWorkbook(file, { mode: 'commit', overwrite: 'true' });
    expect(committed.status).toBe(201);
    const operations = mockShiftSchedule.bulkWrite.mock.calls[0][0];
    expect(operations.map(({ updateOne }) => updateOne.update.$set.shiftId)).toEqual(['day', 'holiday']);
    expect(operations.every(({ updateOne }) => updateOne.upsert === true)).toBe(true);
  });
});

/* ------------------------------ 匯入：預覽檢核 ------------------------------ */
describe('schedule import preview rule check', () => {
  it('returns rule violations in the same shape commit uses and never writes', async () => {
    const violations = [
      { rule: 'weekly-one-regular-rest-one-rest-day', employee: 'e1', weekStart: '2026-06-01', message: '每週一至週日需至少1例1休' },
    ];
    mockAssertScheduleRuleCompliance.mockRejectedValue(Object.assign(new Error('排班規範檢核未通過'), { violations }));
    const file = await buildWorkbook(['日', '日']);

    const preview = await importWorkbook(file);
    const committed = await importWorkbook(file, { mode: 'commit' });

    expect(preview.status).toBe(200);
    expect(preview.body.violations).toEqual(violations);
    expect(committed.status).toBe(201);
    expect(committed.body.violations).toEqual(violations);
    expect(mockShiftSchedule.bulkWrite).toHaveBeenCalledTimes(1);
    const previewArgs = mockAssertScheduleRuleCompliance.mock.calls[0][0];
    expect(previewArgs.candidateSchedules).toHaveLength(2);
    expect(previewArgs.range.start.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });

  it('only demands weekly 1 regular rest / 1 rest day when the workbook covers the whole month', async () => {
    await importWorkbook(await buildWorkbook(['日', '日']));
    await importWorkbook(await buildWorkbook(Array.from({ length: 30 }, () => '日')));

    expect(mockAssertScheduleRuleCompliance.mock.calls.map(([args]) => args.strictWeeklyRest)).toEqual([false, true]);
  });

  it('adds a readable warning (and still previews) when the rule check itself breaks', async () => {
    mockAssertScheduleRuleCompliance.mockRejectedValue(new Error('boom'));
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const preview = await importWorkbook(await buildWorkbook(['日']));

    expect(preview.status).toBe(200);
    expect(preview.body.violations).toEqual([]);
    expect(preview.body.warnings).toEqual([
      partialColumnsWarning(),
      expect.objectContaining({ message: expect.stringContaining('排班規範檢核暫時無法完成') }),
    ]);
    consoleError.mockRestore();
  });

  it('skips the rule check when the preview already has blocking errors', async () => {
    const preview = await importWorkbook(await buildWorkbook(['ZZ']));

    expect(preview.status).toBe(422);
    expect(mockAssertScheduleRuleCompliance).not.toHaveBeenCalled();
  });
});

/* --------------------------- 匯入：Excel 日期儲存格 --------------------------- */
describe('schedule import of codes that Excel turned into dates', () => {
  it('matches 11-20 and 08-12 date cells against shift codes written as 11-20 and 8-12', async () => {
    // Excel 把輸入的 11-20、08-12 轉成日期（UTC 午夜）
    const file = await buildWorkbook([
      new Date('2026-11-20T00:00:00.000Z'),
      new Date('2026-08-12T00:00:00.000Z'),
      '日',
    ]);

    const committed = await importWorkbook(file, { mode: 'commit' });

    expect(committed.status).toBe(201);
    const shiftIds = mockShiftSchedule.bulkWrite.mock.calls[0][0].map(({ updateOne }) => updateOne.update.$set.shiftId);
    expect(shiftIds).toEqual(['range1', 'range2', 'day']);
  });

  it('shows the readable converted text and advises 文字 format when a date cell matches no shift', async () => {
    const file = await buildWorkbook([new Date('2026-03-04T00:00:00.000Z'), '日']);

    const preview = await importWorkbook(file);

    expect(preview.status).toBe(422);
    expect(preview.body.errors).toHaveLength(1);
    const [error] = preview.body.errors;
    expect(error).toMatchObject({ day: 1, code: '03-04' });
    expect(error.message).toContain('文字');
    expect(JSON.stringify(preview.body)).not.toMatch(/GMT|Mar 04/);
  });
});

/* ----------------------------- 完整性檢查 ----------------------------- */
describe('schedule completeness with holiday and leave rows', () => {
  const monthDays = (month) => {
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const days = [];
    for (let d = new Date(start); d.getUTCMonth() === start.getUTCMonth(); d.setUTCDate(d.getUTCDate() + 1)) {
      days.push(new Date(d));
    }
    return days;
  };

  function seedCompleteness(rows) {
    mockEmployee.find.mockReturnValue({
      lean: jest.fn().mockResolvedValue([{ _id: 'e1', name: '測試員工', role: 'employee' }]),
    });
    mockShiftSchedule.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(rows) });
  }

  it('does not report a day as missing once a 國 or leave row exists, and still reports days with no row', async () => {
    const days = monthDays('2026-06');
    const shiftForDay = (date) => {
      const day = date.getUTCDate();
      if (day === 19) return 'holiday';
      if (day === 10) return 'special';
      if (day === 6) return 'regular';
      if (day === 7) return 'rest';
      return 'day';
    };
    // 6/25 沒有排班
    const rows = days
      .filter((date) => date.getUTCDate() !== 25)
      .map((date) => ({ employee: 'e1', date, shiftId: shiftForDay(date) }));
    seedCompleteness(rows);

    const result = await validateMonthSchedules('2026-06');

    expect(result.results[0].missingDays).toEqual(['2026-06-25']);
    expect(result.results[0].isComplete).toBe(false);

    seedCompleteness([...rows, { employee: 'e1', date: new Date('2026-06-25T00:00:00.000Z'), shiftId: 'holiday' }]);
    const complete = await validateMonthSchedules('2026-06');
    expect(complete.results[0].missingDays).toEqual([]);
    expect(complete.allComplete).toBe(true);
  });

  it('counts a row on an approved-leave day as a conflict only when it is a working shift', async () => {
    const days = monthDays('2026-06');
    const rows = days.map((date) => ({
      employee: 'e1',
      date,
      shiftId: date.getUTCDate() === 3 ? 'day' : (date.getUTCDate() === 4 ? 'holiday' : (date.getUTCDate() === 5 ? 'rest' : 'day')),
    }));
    seedCompleteness(rows);
    setApprovedLeave(['2026-06-03', '2026-06-04', '2026-06-05']);

    const result = await validateMonthSchedules('2026-06');

    expect(result.results[0].conflictDays).toEqual(expect.arrayContaining(['2026-06-03']));
    expect(result.results[0].conflictDays).not.toContain('2026-06-04');
    expect(result.results[0].conflictDays).not.toContain('2026-06-05');
  });

  it('falls back to the strict check (every row is a working shift) when the shift table cannot be loaded', async () => {
    const days = monthDays('2026-06');
    seedCompleteness(days.map((date) => ({ employee: 'e1', date, shiftId: 'holiday' })));
    setApprovedLeave(['2026-06-04']);
    mockAttendanceSetting.findOne.mockImplementation(() => { throw new Error('db down'); });
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await validateMonthSchedules('2026-06');

    expect(result.results[0].conflictDays).toEqual(['2026-06-04']);
    consoleError.mockRestore();
  });
});

/* --------------------------- 班表列表與 Excel 匯出 --------------------------- */
describe('schedule grid and Excel export with holiday and leave rows', () => {
  const chain = (rows) => ({
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  });
  const rowOf = (day, shiftId) => ({
    employee: { _id: { toString: () => 'e1' }, name: '測試員工' },
    date: new Date(`2026-06-${String(day).padStart(2, '0')}T00:00:00.000Z`),
    shiftId,
    department: 'd1',
  });

  it('returns 國 and leave rows with their shift code from the monthly grid API', async () => {
    mockEmployee.find.mockReturnValue({
      select: jest.fn().mockImplementation(() => ({
        lean: jest.fn().mockResolvedValue([{ _id: 'e1', name: '測試員工' }]),
        then: (resolve) => Promise.resolve([{ _id: 'e1', name: '測試員工' }]).then(resolve),
      })),
    });
    mockShiftSchedule.find.mockReturnValue(chain([rowOf(19, 'holiday'), rowOf(10, 'special'), rowOf(12, 'injury'), rowOf(6, 'regular')]));

    const res = await request(app)
      .get('/api/schedules/monthly?month=2026-06&employee=e1')
      .set('Authorization', authHeader('admin'));

    expect(res.status).toBe(200);
    expect(res.body.schedules.map((item) => [item.date, item.shiftCode, item.shiftName])).toEqual([
      ['2026/06/19', '國', '國定假日'],
      ['2026/06/10', '特', '特休'],
      ['2026/06/12', '公傷', '公傷假'],
      ['2026/06/06', '例', '例假'],
    ]);
  });

  async function exportWorkbook({ schedules, approvedLeave = [], leaveType = '特休' }) {
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
    setApprovedLeave(approvedLeave, leaveType);
    // 匯出路由要有 req.user；用 admin token 走真實 authenticate
    const res = await request(app)
      .get('/api/schedules/export?month=2026-06&department=d1&format=excel')
      .set('Authorization', authHeader('admin'))
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

  const cellOf = (sheet, day) => sheet.getRow(6).getCell(4 + day);
  const fillOf = (cell) => cell.fill?.fgColor?.argb;

  it('exports 國 and leave rows with their code and without the unscheduled yellow fill', async () => {
    const sheet = await exportWorkbook({
      schedules: [rowOf(1, 'day'), rowOf(6, 'regular'), rowOf(7, 'rest'), rowOf(10, 'special'), rowOf(12, 'injury'), rowOf(19, 'holiday')],
    });

    expect([1, 6, 7, 10, 12, 19].map((day) => cellOf(sheet, day).value)).toEqual(['日', '例', '休', '特', '公傷', '國']);
    const unscheduledFill = 'FFFFE599';
    [1, 6, 7, 10, 12, 19].forEach((day) => {
      expect(fillOf(cellOf(sheet, day))).not.toBe(unscheduledFill);
    });
    // 請假與國定假日有各自的底色；沒有排班的格子仍是黃底
    expect(fillOf(cellOf(sheet, 10))).toBe('FFF8CBAD');
    expect(fillOf(cellOf(sheet, 12))).toBe('FFF8CBAD');
    expect(fillOf(cellOf(sheet, 19))).toBe('FFF4CCCC');
    expect(fillOf(cellOf(sheet, 20))).toBe(unscheduledFill);
  });

  it('keeps approved leave overriding the schedule cell and maps the leave type to the shift table code', async () => {
    const sheet = await exportWorkbook({
      schedules: [rowOf(3, 'day'), rowOf(4, 'day')],
      approvedLeave: ['2026-06-03'],
      leaveType: '公傷假',
    });

    // 公傷假 要對應到班別設定的「公傷」，而不是舊規則的「公」
    expect(cellOf(sheet, 3).value).toBe('公傷');
    expect(cellOf(sheet, 4).value).toBe('日');
    expect(fillOf(cellOf(sheet, 3))).toBe('FFF8CBAD');
  });

  it('still maps common leave types without a matching table shift to the short code', async () => {
    setShifts([SHIFTS[0]]);
    const sheet = await exportWorkbook({
      schedules: [rowOf(3, 'day')],
      approvedLeave: ['2026-06-03'],
      leaveType: '特別休假',
    });

    expect(cellOf(sheet, 3).value).toBe('特');
    expect(fillOf(cellOf(sheet, 3))).toBe('FFF8CBAD');
  });
});

/* ------------------------------ 共用判斷函式 ------------------------------ */
describe('schedule import helpers', () => {
  it('keeps the import leave code list in sync with the shift semantic inference', async () => {
    const { inferLegacyShiftSemanticType } = await import('../src/services/shiftSemanticService.js');
    const customerLeaveCodes = ['特', '病', '事', '喪', '公', '原', '補', '公傷', '婚', '生', '檢', '陪', '產', '家'];
    const customerLeaveNames = ['特休', '病假', '事假', '喪假', '公假', '原民假', '補休', '公傷假', '婚假', '生理假', '產檢假', '陪產檢假', '分娩假', '家庭照顧假'];

    [...customerLeaveCodes, ...customerLeaveNames].forEach((text) => {
      expect(shared.IMPORT_LEAVE_CODES.has(shared.normalizeWorkbookCode(text))).toBe(true);
    });
    customerLeaveCodes.forEach((code, index) => {
      expect(inferLegacyShiftSemanticType({ code, name: customerLeaveNames[index], startTime: '00:00', endTime: '00:00' })).toBe('leave');
    });
    ['國', '国', '國定假日'].forEach((text) => {
      expect(shared.IMPORT_HOLIDAY_CODES.has(shared.normalizeWorkbookCode(text))).toBe(true);
    });
  });

  it('classifies imported shifts by semantic type, never calling a shift without working time a working shift', () => {
    const kind = (shift) => shared.resolveImportShiftKind(shift);

    expect(kind({ code: '日', semanticType: 'work', startTime: '08:00', endTime: '17:00' })).toBe('work');
    expect(kind({ code: 'N', semanticType: 'work', startTime: '00:00', endTime: '08:00', crossDay: true })).toBe('work');
    expect(kind({ code: '國', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' })).toBe('holiday');
    expect(kind({ code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' })).toBe('rest_day');
    // 管理畫面預設存成 work 的零工時班別：依代號推論，推論不出來就當請假
    expect(kind({ code: '婚', name: '婚假', semanticType: 'work', startTime: '00:00', endTime: '00:00' })).toBe('leave');
    expect(kind({ code: '國', name: '國定假日', semanticType: 'work', startTime: '00:00', endTime: '00:00' })).toBe('holiday');
    expect(kind({ code: 'Q', name: '神祕', semanticType: 'work', startTime: '00:00', endTime: '00:00' })).toBe('leave');
  });

  it('counts only real holidays, not 補班日 or 工作日 entries', () => {
    expect(shared.isCountedHolidayRecord({ type: '國定假日', name: '端午節' })).toBe(true);
    expect(shared.isCountedHolidayRecord({ type: '假日', name: '補假' })).toBe(true);
    expect(shared.isCountedHolidayRecord({ type: '補班日', name: '補行上班' })).toBe(false);
    expect(shared.isCountedHolidayRecord({ type: '工作日', name: '' })).toBe(false);
    expect(shared.isCountedHolidayRecord({ name: '補班', description: '補行上班' })).toBe(false);
  });

  it('does not treat a non-work shift as a leave conflict, but keeps the strict check without a shift', async () => {
    setApprovedLeave(['2026-06-03']);
    const day = new Date('2026-06-03T00:00:00.000Z');

    expect(await shared.hasLeaveConflict('e1', day)).toBe(true);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS[0])).toBe(true);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS.find((shift) => shift.code === '國'))).toBe(false);
    expect(await shared.hasLeaveConflict('e1', day, SHIFTS.find((shift) => shift.code === '特'))).toBe(false);
    expect(await shared.hasLeaveConflict('e1', new Date('2026-06-04T00:00:00.000Z'))).toBe(false);
  });
});

/* ------------------- 國定假日休假紀錄：匯入提醒與匯出第二個工作表 ------------------- */
describe('schedule import checks the national-holiday ledger instead of the holiday date', () => {
  const monthCodes = (overrides = {}) => Array.from({ length: 30 }, (_, index) => overrides[index + 1] || '日');
  const holidayWarnings = (body) => body.warnings.filter((warning) => String(warning.message).includes('假日日曆'));
  const shortageWarnings = (body) => body.warnings.filter((warning) => String(warning.message).includes('只排了'));

  it('does not warn about a 國 moved to another day of the month', async () => {
    setHolidays([{ date: new Date('2026-06-19T00:00:00.000Z'), name: '端午節', type: '國定假日' }]);
    const codes = Array.from({ length: 19 }, () => '日');
    codes[4] = '國';

    const preview = await importWorkbook(await buildWorkbook(codes));

    expect(preview.status).toBe(200);
    expect(holidayWarnings(preview.body)).toEqual([]);
    expect(preview.body.informationalDays).toBe(1);
  });

  it('warns about each 國 beyond the number of national holidays and names the calendar', async () => {
    setHolidays([{ date: new Date('2026-06-19T00:00:00.000Z'), name: '端午節', type: '國定假日' }]);
    const codes = Array.from({ length: 19 }, () => '日');
    codes[2] = '國';
    codes[9] = '國';
    codes[18] = '國';

    const preview = await importWorkbook(await buildWorkbook(codes));

    expect(preview.status).toBe(200);
    expect(holidayWarnings(preview.body)).toEqual([
      expect.objectContaining({ row: 5, day: 3, code: '國', message: expect.stringContaining('1 個國定假日') }),
      expect.objectContaining({ row: 5, day: 10, code: '國' }),
    ]);
  });

  it('follows a company holiday move when counting the national holidays', async () => {
    setHolidays([{ date: new Date('2026-06-19T00:00:00.000Z'), name: '端午節', type: '國定假日' }]);
    setHolidayMoves([{
      enableHolidayMove: true,
      sourceDate: new Date('2026-06-19T00:00:00.000Z'),
      targetDate: new Date('2026-06-18T00:00:00.000Z'),
    }]);
    const codes = Array.from({ length: 19 }, () => '日');
    codes[17] = '國';

    const preview = await importWorkbook(await buildWorkbook(codes));

    expect(holidayWarnings(preview.body)).toEqual([]);
  });

  it('only for a whole-month file, warns once per employee about national holidays without a 國 to match', async () => {
    setHolidays([
      { date: new Date('2026-06-19T00:00:00.000Z'), name: '端午節', type: '國定假日' },
      { date: new Date('2026-06-22T00:00:00.000Z'), name: '補假', type: '國定假日' },
    ]);

    const whole = await importWorkbook(await buildWorkbook(monthCodes({ 5: '國' })));
    expect(whole.body.errors).toEqual([]);
    expect(shortageWarnings(whole.body)).toEqual([
      expect.objectContaining({ row: 5, day: null, code: 'A001', message: expect.stringContaining('本月 2 個國定假日只排了 1 個「國」') }),
    ]);
    expect(shortageWarnings(whole.body)[0].message).toContain('補假 06/22');

    const partial = await importWorkbook(await buildWorkbook(monthCodes({ 5: '國' }).slice(0, 25)));
    expect(shortageWarnings(partial.body)).toEqual([]);

    const settled = await importWorkbook(await buildWorkbook(monthCodes({ 5: '國', 19: '國' })));
    expect(shortageWarnings(settled.body)).toEqual([]);
  });

  it('does not report a holiday that falls on a rest day as missing', async () => {
    setHolidays([{ date: new Date('2026-06-19T00:00:00.000Z'), name: '端午節', type: '國定假日' }]);

    const preview = await importWorkbook(await buildWorkbook(monthCodes({ 19: '休' })));

    expect(shortageWarnings(preview.body)).toEqual([]);
  });
});

describe('schedule import judges the national-holiday shortfall by the length of the approved leave', () => {
  // 端午節 6/19，整月檔案；6/19 那格留空，沿用班表上已有的日班（沒被檔案覆蓋）
  const monthCodes = () => Array.from({ length: 30 }, (_, index) => (index + 1 === 19 ? '' : '日'));
  const shortageWarnings = (body) => body.warnings.filter((warning) => String(warning.message).includes('只排了'));

  function setApprovedLeaveRanges(ranges, type = '事假') {
    mockApprovalRequest.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue(ranges.map(([start, end]) => ({
        applicant_employee: 'e1',
        form_data: { s: start, e: end, t: type },
      }))),
    });
  }

  beforeEach(() => {
    setHolidays([{ date: new Date('2026-06-19T00:00:00.000Z'), name: '端午節', type: '國定假日' }]);
    setExistingSchedules([{ employee: 'e1', date: new Date('2026-06-19T00:00:00.000Z'), shiftId: 'day' }]);
  });

  it('still reports a worked holiday when the approved leave that day is only 2 hours', async () => {
    // 台灣 09:00-11:00
    setApprovedLeaveRanges([['2026-06-19T01:00:00.000Z', '2026-06-19T03:00:00.000Z']]);

    const preview = await importWorkbook(await buildWorkbook(monthCodes()));

    expect(preview.status).toBe(200);
    expect(shortageWarnings(preview.body)).toEqual([
      expect.objectContaining({ row: 5, day: null, code: 'A001', message: expect.stringContaining('端午節 06/19') }),
    ]);
  });

  it('does not report the holiday when the leave is a full day or covers the whole shift', async () => {
    setApprovedLeaveRanges([['2026-06-19', '2026-06-19']]);
    expect(shortageWarnings((await importWorkbook(await buildWorkbook(monthCodes()))).body)).toEqual([]);

    // 台灣 08:00-17:00，剛好是日班的上下班時間
    setApprovedLeaveRanges([['2026-06-19T00:00:00.000Z', '2026-06-19T09:00:00.000Z']]);
    expect(shortageWarnings((await importWorkbook(await buildWorkbook(monthCodes()))).body)).toEqual([]);
  });

  it('reports it without any leave, and reads the approved leave only once per import', async () => {
    setApprovedLeaveRanges([]);

    const whole = await importWorkbook(await buildWorkbook(monthCodes()));
    expect(shortageWarnings(whole.body)).toHaveLength(1);
    // 排班的衝突檢查與國定假日核對共用同一份請假時間區間，只查一次假單（以前日曆版本與時間區間版本各查一次，共兩次）
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1);

    mockApprovalRequest.find.mockClear();
    const partial = await importWorkbook(await buildWorkbook(monthCodes().slice(0, 25)));
    expect(shortageWarnings(partial.body)).toEqual([]);
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(1);
  });

  it('does not require part-time staff to be scheduled on the holiday, but still reports a worked one', async () => {
    setApprovedLeaveRanges([]);
    mockEmployee.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ ...EMPLOYEE, partTime: true }]),
    });

    // 6/19 沒有班表、檔案也沒排：兼職不列入；同一天排了日班（檔案或班表）就照樣提醒
    setExistingSchedules([]);
    expect(shortageWarnings((await importWorkbook(await buildWorkbook(monthCodes()))).body)).toEqual([]);
    setExistingSchedules([{ employee: 'e1', date: new Date('2026-06-19T00:00:00.000Z'), shiftId: 'day' }]);
    expect(shortageWarnings((await importWorkbook(await buildWorkbook(monthCodes()))).body)).toHaveLength(1);
  });
});

describe('schedule Excel export carries the national-holiday ledger as the second worksheet', () => {
  const chain = (rows) => ({
    select: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue(rows),
  });
  const rowOf = (day, shiftId) => ({
    employee: { _id: { toString: () => 'e1' }, name: '測試員工' },
    date: new Date(`2026-06-${String(day).padStart(2, '0')}T00:00:00.000Z`),
    shiftId,
    department: 'd1',
    state: 'finalized',
  });

  async function exportAll(schedules) {
    mockEmployee.find.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{
        _id: { toString: () => 'e1' },
        employeeId: 'A001',
        name: '測試員工',
        title: '',
        practiceTitle: '護理師',
        subDepartment: { name: 'A單位' },
      }]),
    });
    mockDepartment.findById.mockReturnValue({ select: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue({ name: '護理' }) });
    mockShiftSchedule.find.mockReturnValue(chain(schedules));
    mockScheduleDayMemo.find.mockReturnValue({ sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) });
    const res = await request(app)
      .get('/api/schedules/export?month=2026-06&department=d1&format=excel')
      .set('Authorization', authHeader('admin'))
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    return { workbook, buffer: res.body };
  }

  const twoHolidays = [
    { date: new Date('2026-06-19T00:00:00.000Z'), name: '端午節', type: '國定假日' },
    { date: new Date('2026-06-22T00:00:00.000Z'), name: '補假', type: '國定假日' },
  ];

  it('adds 國定假日休假紀錄 after the roster sheet: rested on the date, moved to another day, counts and legend', async () => {
    setHolidays(twoHolidays);

    const { workbook } = await exportAll([rowOf(19, 'holiday'), rowOf(10, 'holiday'), rowOf(1, 'day')]);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['工作表1', '國定假日休假紀錄']);
    const sheet = workbook.getWorksheet('國定假日休假紀錄');
    expect(sheet.getRow(1).getCell(1).value).toBe('護理　2026年06月 國定假日休假紀錄');
    expect(sheet.getRow(3).values.slice(1)).toEqual([
      '員工代號', '姓名', '單位', '職稱', '端午節 06/19', '補假 06/22', '應休', '當日休', '移休', '未休', '待處理', '多排的國', '處理方式',
    ]);
    const row = sheet.getRow(4);
    expect(row.getCell(1).value).toBe('A001');
    expect(row.getCell(2).value).toBe('測試員工');
    expect(row.getCell(3).value).toBe('A單位');
    expect(row.getCell(4).value).toBe('護理師');
    expect(row.getCell(5).value).toBe('當日休');
    expect(row.getCell(6).value).toBe('移休 06/10');
    expect([7, 8, 9, 10, 11].map((column) => row.getCell(column).value)).toEqual([2, 1, 1, 0, 0]);
  });

  it('matches 國 on other days to the holidays, lists the extra 國, and marks a worked holiday without a 國 in red', async () => {
    setHolidays(twoHolidays);

    const moved = await exportAll([rowOf(19, 'day'), rowOf(22, 'day'), rowOf(3, 'holiday'), rowOf(4, 'holiday'), rowOf(5, 'holiday')]);
    const movedRow = moved.workbook.getWorksheet('國定假日休假紀錄').getRow(4);
    expect(movedRow.getCell(5).value).toBe('移休 06/03');
    expect(movedRow.getCell(6).value).toBe('移休 06/04');
    expect(movedRow.getCell(12).value).toBe('06/05');

    const worked = await exportAll([rowOf(19, 'day'), rowOf(22, 'day')]);
    const workedRow = worked.workbook.getWorksheet('國定假日休假紀錄').getRow(4);
    expect(workedRow.getCell(5).value).toBe('未休（上班）');
    expect(workedRow.getCell(6).value).toBe('未休（上班）');
    expect(workedRow.getCell(5).fill.fgColor.argb).toBe('FFF4CCCC');
    expect([7, 8, 9, 10, 11].map((column) => workedRow.getCell(column).value)).toEqual([2, 0, 0, 2, 2]);
  });

  it('keeps the roster sheet importable: the importer still reads the first worksheet', async () => {
    setHolidays(twoHolidays);
    const { buffer } = await exportAll([rowOf(19, 'holiday'), rowOf(1, 'day')]);
    const { parseScheduleWorkbook } = await import('../src/services/scheduleWorkbookService.js');

    const parsed = await parseScheduleWorkbook(buffer, { month: '2026-06' });

    expect(parsed.worksheetName).toBe('工作表1');
    // 假日紀錄表（第二個工作表）的內容不會被當成員工列讀進來
    expect(parsed.rows.filter((row) => row.employeeId === 'A001')).toHaveLength(1);
    expect(parsed.rows.some((row) => ['員工代號', '端午節 06/19'].includes(row.employeeId))).toBe(false);
    expect(parsed.rows[0].employeeId).toBe('A001');
    expect(parsed.rows[0].entries.map((entry) => [entry.day, entry.code])).toEqual([[1, '日'], [19, '國']]);
  });

  it('shows a company-moved holiday on its new date in the calendar row and in the ledger header', async () => {
    setHolidays(twoHolidays);
    setHolidayMoves([{
      enableHolidayMove: true,
      sourceDate: new Date('2026-06-19T00:00:00.000Z'),
      targetDate: new Date('2026-06-18T00:00:00.000Z'),
    }]);

    const { workbook } = await exportAll([rowOf(18, 'holiday')]);

    const roster = workbook.getWorksheet('工作表1');
    expect(roster.getRow(3).getCell(4 + 18).value).toBe('端午節');
    expect(roster.getRow(3).getCell(4 + 19).value).toBeFalsy();
    expect(roster.getRow(3).getCell(4 + 22).value).toBe('補假');
    const ledger = workbook.getWorksheet('國定假日休假紀錄');
    expect(ledger.getRow(3).getCell(5).value).toBe('端午節 06/18（原 06/19）');
    expect(ledger.getRow(4).getCell(5).value).toBe('當日休');
  });

  it('still exports the roster when the ledger cannot be built', async () => {
    setHolidays(twoHolidays);
    mockHolidayRestResolution.find.mockImplementation(() => { throw new Error('boom'); });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { workbook } = await exportAll([rowOf(19, 'holiday')]);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['工作表1']);
    expect(errorSpy).toHaveBeenCalledWith('Schedule export holiday ledger sheet failed', 'Error');
    errorSpy.mockRestore();
  });
});
