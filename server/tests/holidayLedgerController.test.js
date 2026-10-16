// 國定假日休假紀錄 API：依班表的權限範圍（員工自己、主管直屬部屬、管理員全部）查詢、登記／刪除處理方式、匯出。
import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';

const chain = (rows) => {
  const query = {
    select: jest.fn(() => query),
    populate: jest.fn(() => query),
    lean: jest.fn(async () => rows),
  };
  return query;
};

const mockEmployee = { find: jest.fn(), findById: jest.fn() };
const mockHoliday = { find: jest.fn() };
const mockHolidayMoveSetting = { find: jest.fn() };
const mockShiftSchedule = { find: jest.fn() };
const mockAttendanceSetting = { findOne: jest.fn() };
const mockDepartment = { findById: jest.fn(), find: jest.fn() };
const mockLoadApprovedLeaveCalendar = jest.fn();

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/Holiday.js', () => ({ default: mockHoliday }));
jest.unstable_mockModule('../src/models/HolidayMoveSetting.js', () => ({ default: mockHolidayMoveSetting }));
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }));
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: mockDepartment }));
jest.unstable_mockModule('../src/services/approvedLeaveCalendarService.js', () => ({
  loadApprovedLeaveCalendar: mockLoadApprovedLeaveCalendar,
  leaveDaysFromCalendar: jest.fn(() => new Set()),
}));
jest.unstable_mockModule('../src/services/laborRuleValidationService.js', () => ({
  isLaborRuleValidationError: jest.fn(() => false),
}));

const { default: HolidayRestResolution } = await import('../src/models/HolidayRestResolution.js');
const { default: holidayLedgerRoutes } = await import('../src/routes/holidayLedgerRoutes.js');

const oid = (n) => n.toString(16).padStart(24, '0');
const ID = { admin: oid(1), boss: oid(2), nurseA: oid(3), nurseB: oid(4), otherNurse: oid(5), otherBoss: oid(6), dept: oid(100), sub: oid(101) };
const utc = (key) => new Date(`${key}T00:00:00.000Z`);

const person = (id, name, extra = {}) => ({
  _id: id,
  employeeId: `N-${name}`,
  name,
  title: '護理師',
  subDepartment: { name: '內科' },
  department: ID.dept,
  status: '正職員工',
  ...extra,
});
const ALL_EMPLOYEES = [
  person(ID.admin, '管理員', { title: '人資' }),
  person(ID.boss, '主管', { supervisor: ID.admin }),
  person(ID.nurseA, '護理甲', { supervisor: ID.boss }),
  person(ID.nurseB, '護理乙', { supervisor: ID.boss, partTime: true }),
  person(ID.otherNurse, '護理丙', { supervisor: ID.otherBoss }),
  person(ID.otherBoss, '他組主管', { supervisor: ID.admin }),
];

const SHIFTS = [
  { _id: 'day', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
  { _id: 'guo', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
];
const rowOf = (employee, key, shiftId) => ({ employee, date: utc(key), shiftId, state: 'finalized' });

let currentUser;
let app;

beforeAll(() => {
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = currentUser;
    next();
  });
  app.use('/api/holiday-ledger', holidayLedgerRoutes);
});

function loginAs(role, id) {
  currentUser = { id, role };
}

const resolutionStore = [];

beforeEach(() => {
  jest.resetAllMocks();
  resolutionStore.length = 0;
  loginAs('admin', ID.admin);

  mockEmployee.find.mockImplementation((query = {}) => {
    let rows = ALL_EMPLOYEES;
    if (query.supervisor) rows = rows.filter((employee) => employee.supervisor === query.supervisor);
    if (query._id?.$in) rows = rows.filter((employee) => query._id.$in.includes(employee._id));
    if (query.department) rows = rows.filter((employee) => employee.department === query.department);
    if (query.$or) rows = rows.filter((employee) => query.$or.some((clause) => Object.entries(clause).every(([key, rx]) => rx.test(employee[key] || ''))));
    return chain(rows);
  });
  mockEmployee.findById.mockImplementation((id) => chain(ALL_EMPLOYEES.find((employee) => employee._id === id) || null));
  mockHoliday.find.mockImplementation((query = {}) => {
    const docs = [
      { date: utc('2026-09-25'), name: '中秋節', type: '國定假日' },
      { date: utc('2026-09-28'), name: '教師節', type: '國定假日' },
      { date: utc('2026-09-12'), name: '補班日', type: '補班日' },
    ];
    if (query.date instanceof Date) return chain(docs.filter((doc) => doc.date.getTime() === query.date.getTime()));
    return chain(docs.filter((doc) => !query.date?.$gte || (doc.date >= query.date.$gte && doc.date < query.date.$lt)));
  });
  mockHolidayMoveSetting.find.mockReturnValue(chain([]));
  mockAttendanceSetting.findOne.mockReturnValue(chain({ shifts: SHIFTS }));
  mockDepartment.findById.mockReturnValue(chain({ name: '護理部', unitName: '內科病房' }));
  mockLoadApprovedLeaveCalendar.mockResolvedValue(new Map());
  mockShiftSchedule.find.mockImplementation((query) => {
    const ids = query.employee.$in;
    const rows = [
      rowOf(ID.nurseA, '2026-09-25', 'guo'), rowOf(ID.nurseA, '2026-09-20', 'guo'),
      rowOf(ID.nurseB, '2026-09-25', 'day'),
      rowOf(ID.otherNurse, '2026-09-25', 'day'),
      rowOf(ID.boss, '2026-09-25', 'guo'), rowOf(ID.boss, '2026-09-28', 'guo'),
    ];
    return chain(rows.filter((row) => ids.includes(row.employee)));
  });

  jest.spyOn(HolidayRestResolution, 'find').mockImplementation(() => chain(resolutionStore));
  jest.spyOn(HolidayRestResolution, 'findById').mockImplementation((id) => chain(resolutionStore.find((doc) => doc._id === id) || null));
  jest.spyOn(HolidayRestResolution, 'deleteOne').mockResolvedValue({ deletedCount: 1 });
  jest.spyOn(HolidayRestResolution, 'findOneAndUpdate').mockImplementation(async (filter, update) => ({
    _id: oid(900),
    employee: filter.employee,
    holidayDate: filter.holidayDate,
    ...update.$set,
    updatedAt: new Date('2026-10-12T00:00:00.000Z'),
  }));
});

const ledgerRows = (body, month = 0) => body.months[month].employees;
const idsOf = (body) => ledgerRows(body).map((row) => row.employeeId).sort();
const sorted = (...ids) => [...ids].sort();
const url = (query = '') => `/api/holiday-ledger?month=2026-09${query}`;

describe('GET /api/holiday-ledger scope', () => {
  it('lets an administrator see everyone and filters by department, sub department and search', async () => {
    const all = await request(app).get(url());
    expect(all.status).toBe(200);
    expect(idsOf(all.body)).toEqual(sorted(ID.admin, ID.boss, ID.nurseA, ID.nurseB, ID.otherNurse, ID.otherBoss));

    const search = await request(app).get(url('&search=護理甲'));
    expect(idsOf(search.body)).toEqual([ID.nurseA]);

    const dept = await request(app).get(url(`&department=${ID.dept}&subDepartment=${ID.sub}`));
    expect(dept.status).toBe(200);
    expect(mockEmployee.find.mock.calls.at(-1)[0]).toMatchObject({ department: ID.dept, subDepartment: ID.sub });
  });

  it('limits a supervisor to direct reports, adds themselves only with includeSelf, and never shows other teams', async () => {
    loginAs('supervisor', ID.boss);

    const own = await request(app).get(url());
    expect(own.status).toBe(200);
    expect(idsOf(own.body)).toEqual(sorted(ID.nurseA, ID.nurseB));

    const withSelf = await request(app).get(url('&includeSelf=true'));
    expect(idsOf(withSelf.body)).toEqual(sorted(ID.boss, ID.nurseA, ID.nurseB));

    const other = await request(app).get(url(`&employee=${ID.otherNurse}`));
    expect(other.status).toBe(403);

    const report = await request(app).get(url(`&employee=${ID.nurseA}`));
    expect(report.status).toBe(200);
    expect(idsOf(report.body)).toEqual([ID.nurseA]);
  });

  it('lets an employee see only themselves and refuses asking for someone else', async () => {
    loginAs('employee', ID.nurseA);

    const mine = await request(app).get(url('&includeSelf=true'));
    expect(mine.status).toBe(200);
    expect(idsOf(mine.body)).toEqual([ID.nurseA]);

    const someoneElse = await request(app).get(url(`&employee=${ID.nurseB}`));
    expect(someoneElse.status).toBe(403);
    const search = await request(app).get(url('&search=護理乙'));
    expect(idsOf(search.body)).toEqual([]);
  });

  it('refuses an unknown role and an anonymous caller', async () => {
    loginAs('guest', ID.nurseA);
    expect((await request(app).get(url())).status).toBe(403);
    currentUser = undefined;
    expect((await request(app).get(url())).status).toBe(401);
  });
});

describe('GET /api/holiday-ledger content', () => {
  it('returns the holidays, per-employee statuses and a summary', async () => {
    const res = await request(app).get(url(`&employee=${ID.nurseA}`));

    expect(res.status).toBe(200);
    const [month] = res.body.months;
    expect(month.month).toBe('2026-09');
    expect(month.holidays.map((holiday) => [holiday.name, holiday.date])).toEqual([['中秋節', '2026-09-25'], ['教師節', '2026-09-28']]);
    const row = month.employees[0];
    expect(row).toMatchObject({ employeeNo: 'N-護理甲', name: '護理甲', rested: 1, moved: 1, notTaken: 0, open: 0 });
    expect(row.items.map((item) => [item.status, item.guoDate])).toEqual([['rested_on_date', '2026-09-25'], ['moved', '2026-09-20']]);
    expect(res.body.summary).toMatchObject({ employees: 1, holidays: 2, rested: 1, moved: 1, notTaken: 0, open: 0, extra: 0 });
  });

  it('includes part-time employees like everyone else and flags them', async () => {
    const res = await request(app).get(url(`&employee=${ID.nurseB}`));
    const row = ledgerRows(res.body)[0];
    expect(row.partTime).toBe(true);
    expect(row.items[0]).toMatchObject({ status: 'not_taken', reason: 'worked', needsAction: 'resolve' });
    expect(row.items[1]).toMatchObject({ status: 'not_taken', reason: 'unscheduled' });
    expect(row.open).toBe(2);
  });

  it('status=open keeps only employees with something to handle and recomputes the summary', async () => {
    const res = await request(app).get(url('&status=open'));
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(sorted(ID.nurseB, ID.otherNurse, ID.admin, ID.otherBoss));
    expect(res.body.summary.employees).toBe(4);
    expect(res.body.summary.open).toBe(ledgerRows(res.body).reduce((sum, row) => sum + row.open, 0));
  });

  it('supports a month range and caps it at 12 months', async () => {
    const range = await request(app).get('/api/holiday-ledger?from=2026-08&to=2026-10&employee=' + ID.nurseA);
    expect(range.status).toBe(200);
    expect(range.body.months.map((entry) => entry.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(range.body.months[0].employees).toEqual([]);
    expect(range.body.months[1].employees).toHaveLength(1);

    const tooLong = await request(app).get('/api/holiday-ledger?from=2025-01&to=2026-02');
    expect(tooLong.status).toBe(400);
    const exactlyYear = await request(app).get('/api/holiday-ledger?from=2026-01&to=2026-12&employee=' + ID.nurseA);
    expect(exactlyYear.status).toBe(200);
    expect(exactlyYear.body.months).toHaveLength(12);
  });

  it('rejects bad input with 400', async () => {
    expect((await request(app).get('/api/holiday-ledger')).status).toBe(400);
    expect((await request(app).get('/api/holiday-ledger?month=2026-13')).status).toBe(400);
    expect((await request(app).get('/api/holiday-ledger?month=2026-9')).status).toBe(400);
    expect((await request(app).get('/api/holiday-ledger?from=2026-10&to=2026-09')).status).toBe(400);
    expect((await request(app).get('/api/holiday-ledger?from=2026-10')).status).toBe(400);
    expect((await request(app).get(url('&employee=not-an-id'))).status).toBe(400);
    expect((await request(app).get(url('&department=bad'))).status).toBe(400);
    expect((await request(app).get(url('&subDepartment=bad'))).status).toBe(400);
  });

  it('asks to narrow the scope instead of loading thousands of employees', async () => {
    const many = Array.from({ length: 2001 }, (_, index) => person(oid(5000 + index), `員工${index}`));
    mockEmployee.find.mockReturnValue(chain(many));
    const res = await request(app).get(url());
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('narrow');
  });

  it('answers 500 with a generic message when the ledger cannot be built', async () => {
    mockShiftSchedule.find.mockImplementation(() => { throw new Error('db down'); });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get(url());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'internal error' });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('db down');
    errorSpy.mockRestore();
  });
});

describe('POST /api/holiday-ledger/resolutions', () => {
  const body = (extra = {}) => ({ employee: ID.nurseA, holidayDate: '2026-09-25', kind: 'compensatory_leave', ...extra });

  it('records a compensatory leave with 8 hours by default and stores the original holiday date', async () => {
    loginAs('supervisor', ID.boss);
    const res = await request(app).post('/api/holiday-ledger/resolutions').send(body());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ employee: ID.nurseA, holidayDate: '2026-09-25', holidayName: '中秋節', kind: 'compensatory_leave', compensatoryHours: 8 });
    const [filter, update, options] = HolidayRestResolution.findOneAndUpdate.mock.calls[0];
    expect(filter.employee).toBe(ID.nurseA);
    expect(filter.holidayDate.toISOString()).toBe('2026-09-25T00:00:00.000Z');
    expect(update.$set).toMatchObject({ kind: 'compensatory_leave', compensatoryHours: 8, month: '2026-09', resolvedBy: ID.boss, holidayName: '中秋節' });
    expect(update.$unset).toEqual({ restedDate: '' });
    expect(options).toMatchObject({ upsert: true, new: true });
  });

  it('accepts custom hours, paid, rested later with a date, and waived with a note', async () => {
    const hours = await request(app).post('/api/holiday-ledger/resolutions').send(body({ compensatoryHours: 4 }));
    expect(hours.body.compensatoryHours).toBe(4);

    const paid = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'paid', compensatoryHours: 99 }));
    expect(paid.status).toBe(200);
    expect(HolidayRestResolution.findOneAndUpdate.mock.calls.at(-1)[1].$unset).toEqual({ compensatoryHours: '', restedDate: '' });

    const later = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'rested_later', restedDate: '2026-10-03' }));
    expect(later.status).toBe(200);
    expect(later.body.restedDate).toBe('2026-10-03');

    const waived = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'waived', note: '員工放棄' }));
    expect(waived.status).toBe(200);
    expect(waived.body.note).toBe('員工放棄');
  });

  it('validates the body', async () => {
    const post = (extra) => request(app).post('/api/holiday-ledger/resolutions').send(body(extra));
    expect((await post({ kind: 'cash' })).status).toBe(400);
    expect((await post({ kind: undefined })).status).toBe(400);
    expect((await post({ compensatoryHours: 0 })).status).toBe(400);
    expect((await post({ compensatoryHours: 25 })).status).toBe(400);
    expect((await post({ compensatoryHours: 'abc' })).status).toBe(400);
    expect((await post({ kind: 'rested_later' })).status).toBe(400);
    expect((await post({ kind: 'rested_later', restedDate: '2026-02-30' })).status).toBe(400);
    expect((await post({ kind: 'waived' })).status).toBe(400);
    expect((await post({ kind: 'waived', note: '   ' })).status).toBe(400);
    expect((await post({ note: 'x'.repeat(501) })).status).toBe(400);
    expect((await post({ holidayDate: '2026/09/25' })).status).toBe(400);
    expect((await post({ holidayDate: '2026-02-30' })).status).toBe(400);
    expect((await post({ employee: 'abc' })).status).toBe(400);
    expect((await post({ employee: undefined })).status).toBe(400);
    // 補班日、一般日期不是國定假日
    expect((await post({ holidayDate: '2026-09-12' })).status).toBe(400);
    expect((await post({ holidayDate: '2026-09-13' })).status).toBe(400);
    expect(HolidayRestResolution.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('answers 404 for an employee that does not exist', async () => {
    const res = await request(app).post('/api/holiday-ledger/resolutions').send(body({ employee: oid(777) }));
    expect(res.status).toBe(404);
  });

  it('applies the schedule permission scope: a supervisor handles direct reports only, never themselves or other teams', async () => {
    loginAs('supervisor', ID.boss);
    const post = (employee) => request(app).post('/api/holiday-ledger/resolutions').send(body({ employee }));

    expect((await post(ID.nurseB)).status).toBe(200);
    expect((await post(ID.boss)).status).toBe(403);
    expect((await post(ID.otherNurse)).status).toBe(403);

    loginAs('admin', ID.admin);
    expect((await post(ID.otherNurse)).status).toBe(200);
    expect((await post(ID.admin)).status).toBe(200);

    loginAs('employee', ID.nurseA);
    expect((await post(ID.nurseA)).status).toBe(403);
    expect(HolidayRestResolution.findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  it('is idempotent: a second save of the same holiday updates the same document, and a duplicate-key race is retried once', async () => {
    const first = await request(app).post('/api/holiday-ledger/resolutions').send(body());
    const second = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'paid' }));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const [firstFilter] = HolidayRestResolution.findOneAndUpdate.mock.calls[0];
    const [secondFilter] = HolidayRestResolution.findOneAndUpdate.mock.calls[1];
    expect(secondFilter.employee).toBe(firstFilter.employee);
    expect(secondFilter.holidayDate.getTime()).toBe(firstFilter.holidayDate.getTime());

    HolidayRestResolution.findOneAndUpdate.mockReset();
    HolidayRestResolution.findOneAndUpdate
      .mockRejectedValueOnce(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }))
      .mockResolvedValueOnce({ _id: oid(901), employee: ID.nurseA, holidayDate: utc('2026-09-25'), kind: 'paid', month: '2026-09' });
    const raced = await request(app).post('/api/holiday-ledger/resolutions').send(body({ kind: 'paid' }));
    expect(raced.status).toBe(200);
    expect(HolidayRestResolution.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('DELETE /api/holiday-ledger/resolutions/:id', () => {
  const stored = (employee) => ({ _id: oid(800), employee, holidayDate: utc('2026-09-25'), kind: 'paid', month: '2026-09' });

  it('deletes within the permission scope', async () => {
    resolutionStore.push(stored(ID.nurseA));
    loginAs('supervisor', ID.boss);
    const res = await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`);
    expect(res.status).toBe(200);
    expect(HolidayRestResolution.deleteOne).toHaveBeenCalledWith({ _id: oid(800) });
  });

  it('refuses another team, the supervisor themselves and employees; admin may', async () => {
    resolutionStore.push(stored(ID.otherNurse));
    loginAs('supervisor', ID.boss);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(403);

    resolutionStore.length = 0;
    resolutionStore.push(stored(ID.boss));
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(403);

    loginAs('employee', ID.nurseA);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(403);
    expect(HolidayRestResolution.deleteOne).not.toHaveBeenCalled();

    loginAs('admin', ID.admin);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(800)}`)).status).toBe(200);
  });

  it('answers 400 for a bad id and 404 for a missing one', async () => {
    expect((await request(app).delete('/api/holiday-ledger/resolutions/abc')).status).toBe(400);
    expect((await request(app).delete(`/api/holiday-ledger/resolutions/${oid(801)}`)).status).toBe(404);
  });
});

describe('GET /api/holiday-ledger/export', () => {
  const download = (query) => request(app)
    .get(`/api/holiday-ledger/export${query}`)
    .buffer(true)
    .parse((response, callback) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });

  it('downloads one workbook with the ledger sheet for the requested scope', async () => {
    loginAs('supervisor', ID.boss);
    const res = await download(`?month=2026-09&department=${ID.dept}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toContain('holiday-ledger-202609.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['國定假日休假紀錄']);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).getCell(1).value).toContain('內科病房');
    expect(sheet.getRow(3).values.slice(1, 7)).toEqual(['員工代號', '姓名', '單位', '職稱', '中秋節 09/25', '教師節 09/28']);
    const names = [];
    sheet.eachRow((row, number) => { if (number > 3) names.push(row.getCell(2).value); });
    expect(names.sort()).toEqual(['護理乙', '護理甲'].sort());
  });

  it('refuses employees and bad months', async () => {
    loginAs('employee', ID.nurseA);
    expect((await download('?month=2026-09')).status).toBe(403);
    loginAs('admin', ID.admin);
    expect((await download('')).status).toBe(400);
    expect((await download('?month=2026-00')).status).toBe(400);
  });
});
