// scheduleRoutes.test.ts (或 .js)
// 整合版：含 list / create(upsert) / monthly / supervisor / export(pdf|excel) / batch / delete-old

import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

/* ----------------------------- Mocks: Models ----------------------------- */
// 統一成物件型態，提供各端點會用到的方法
const mockShiftSchedule = {
  find: jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) })),
  findOneAndUpdate: jest.fn(),
  insertMany: jest.fn(),
  deleteMany: jest.fn(),
};

const mockEmployee = { find: jest.fn() };

/* ----------------------------- Mocks: PDF/Excel ----------------------------- */
const pdfPipe = jest.fn();
const pdfEnd = jest.fn();
const mockPDFDocument = jest.fn().mockImplementation(() => ({
  pipe: pdfPipe,
  end: pdfEnd,
  fontSize: jest.fn().mockReturnThis(),
  text: jest.fn().mockReturnThis(),
  moveDown: jest.fn(),
}));

const worksheetMock = { columns: [], addRow: jest.fn() };
const workbookMock = {
  addWorksheet: jest.fn(() => worksheetMock),
  xlsx: { writeBuffer: jest.fn().mockResolvedValue(Buffer.from('test')) },
};
const mockExcelJS = { Workbook: jest.fn(() => workbookMock) };

/* --------------------------- jest.mock 設定區 --------------------------- */
jest.mock('pdfkit', () => ({ default: mockPDFDocument }), { virtual: true });
jest.mock('exceljs', () => ({ default: mockExcelJS }), { virtual: true });

jest.mock('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }), { virtual: true });
jest.mock('../src/models/Employee.js', () => ({ default: mockEmployee }), { virtual: true });

// 驗證中介層直接放行
jest.mock('../src/middleware/supervisor.js', () => ({ verifySupervisor: (req, res, next) => next() }), { virtual: true });

/* --------------------------------- App --------------------------------- */
let app: express.Express;
let scheduleRoutes: any;

beforeAll(async () => {
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/schedules', scheduleRoutes);
});

beforeEach(() => {
  mockShiftSchedule.find.mockReset();
  mockShiftSchedule.findOneAndUpdate.mockReset();
  mockShiftSchedule.insertMany.mockReset();
  mockShiftSchedule.deleteMany.mockReset();

  mockEmployee.find.mockReset();

  // reset PDF/Excel mocks（以免跨測試殘留）
  pdfPipe.mockReset();
  pdfEnd.mockReset();
  mockPDFDocument.mockClear();

  worksheetMock.columns = [];
  worksheetMock.addRow.mockReset();
  workbookMock.addWorksheet.mockClear();
  workbookMock.xlsx.writeBuffer.mockClear();
});

/* --------------------------------- Tests -------------------------------- */
describe('Schedule API', () => {
  it('lists schedules', async () => {
    const fakeSchedules = [{ shiftType: 'morning' }];
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeSchedules) });

    const res = await request(app).get('/api/schedules');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeSchedules);
  });

  it('returns 500 if listing fails', async () => {
    mockShiftSchedule.find.mockReturnValue({
      populate: jest.fn().mockRejectedValue(new Error('fail')),
    });

    const res = await request(app).get('/api/schedules');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates schedule (upsert by employee+date)', async () => {
    const payload = { employee: 'e1', date: '2023-01-01', shiftType: 'morning' };
    const fake = { ...payload, _id: '1' };

    mockShiftSchedule.findOneAndUpdate.mockResolvedValue(fake);

    const res = await request(app).post('/api/schedules').send(payload);

    expect(res.status).toBe(201);
    expect(mockShiftSchedule.findOneAndUpdate).toHaveBeenCalledWith(
      { employee: payload.employee, date: payload.date },
      { shiftType: payload.shiftType },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    expect(res.body).toEqual(fake);
  });

  it('updates schedule on same day', async () => {
    const base = { employee: 'e1', date: '2023-01-01' };
    mockShiftSchedule.findOneAndUpdate
      .mockResolvedValueOnce({ ...base, shiftType: 'day', _id: '1' })
      .mockResolvedValueOnce({ ...base, shiftType: 'night', _id: '1' });

    // 第一次：day
    let res = await request(app).post('/api/schedules').send({ ...base, shiftType: 'day' });
    expect(res.status).toBe(201);

    // 第二次：night
    res = await request(app).post('/api/schedules').send({ ...base, shiftType: 'night' });
    expect(res.status).toBe(201);
    expect(res.body.shiftType).toBe('night');

    expect(mockShiftSchedule.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      { employee: base.employee, date: base.date },
      { shiftType: 'night' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  });

  it('exports schedules to pdf', async () => {
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) });

    const res = await request(app).get('/api/schedules/export?format=pdf');

    expect(res.status).toBe(200);
    expect(mockPDFDocument).toHaveBeenCalled(); // new PDFDocument()
    expect(pdfPipe).toHaveBeenCalled();
    expect(pdfEnd).toHaveBeenCalled();
  });

  it('exports schedules to excel', async () => {
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) });

    const res = await request(app).get('/api/schedules/export?format=excel');

    expect(res.status).toBe(200);
    expect(workbookMock.addWorksheet).toHaveBeenCalled();
    expect(workbookMock.xlsx.writeBuffer).toHaveBeenCalled();
  });

  it('lists schedules by month (with employee filter)', async () => {
    const fake = [{ shiftType: 'night' }];
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fake) });

    const res = await request(app).get('/api/schedules/monthly?month=2023-01&employee=e1');

    expect(res.status).toBe(200);
    expect(mockShiftSchedule.find).toHaveBeenCalled();
    expect(res.body).toEqual(fake);
  });

  it('lists schedules by supervisor (derives employees then schedules)', async () => {
    const fakeEmployees = [{ _id: 'e1' }, { _id: 'e2' }];
    mockEmployee.find.mockResolvedValue(fakeEmployees);

    const fakeSchedules = [{ employee: 'e1' }, { employee: 'e2' }];
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeSchedules) });

    const res = await request(app).get('/api/schedules/monthly?month=2023-01&supervisor=s1');

    expect(res.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({ supervisor: 's1' });

    const calledQuery = mockShiftSchedule.find.mock.calls[0][0];
    expect(calledQuery.employee).toEqual({ $in: ['e1', 'e2'] });
    expect(res.body).toEqual(fakeSchedules);
  });

  it('creates schedules batch', async () => {
    mockShiftSchedule.insertMany.mockResolvedValue([{ _id: '1' }]);

    const payload = { schedules: [{ employee: 'e1', date: '2023-01-01', shiftType: 'day' }] };
    const res = await request(app).post('/api/schedules/batch').send(payload);

    expect(res.status).toBe(201);
    expect(mockShiftSchedule.insertMany).toHaveBeenCalledWith(payload.schedules, { ordered: false });
  });

  it('deletes old schedules', async () => {
    // 用本地陣列模擬資料，deleteMany 以條件計算刪除數
    const data = [
      { _id: '1', date: new Date('2020-01-01') },
      { _id: '2', date: new Date('2030-01-01') },
    ];

    mockShiftSchedule.deleteMany.mockImplementation(({ date }) => {
      const beforeDate: Date = date.$lt;
      const remaining = data.filter((s) => s.date >= beforeDate);
      const deleted = data.length - remaining.length;
      data.length = 0;
      data.push(...remaining);
      return { deletedCount: deleted };
    });

    const res = await request(app).delete('/api/schedules/older-than?before=2021-01-01');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: 1 });
    expect(data).toHaveLength(1);
    expect(data[0]._id).toBe('2');
  });
});
