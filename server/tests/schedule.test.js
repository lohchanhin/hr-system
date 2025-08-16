import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockShiftSchedule = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockShiftSchedule.find = jest.fn(() => ({ populate: jest.fn().mockResolvedValue([]) }));
mockShiftSchedule.deleteMany = jest.fn();

const pdfPipe = jest.fn();
const pdfEnd = jest.fn();
const mockPDFDocument = jest.fn().mockImplementation(() => ({
  pipe: pdfPipe,
  end: pdfEnd,
  fontSize: jest.fn().mockReturnThis(),
  text: jest.fn().mockReturnThis(),
  moveDown: jest.fn()
}));

const worksheetMock = { columns: [], addRow: jest.fn() };
const workbookMock = {
  addWorksheet: jest.fn(() => worksheetMock),
  xlsx: { writeBuffer: jest.fn().mockResolvedValue(Buffer.from('test')) }
};
const mockExcelJS = { Workbook: jest.fn(() => workbookMock) };

const mockEmployee = { find: jest.fn() };

jest.mock('pdfkit', () => ({ default: mockPDFDocument }), { virtual: true });
jest.mock('exceljs', () => ({ default: mockExcelJS }), { virtual: true });

jest.mock('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }), { virtual: true });
jest.mock('../src/models/Employee.js', () => ({ default: mockEmployee }), { virtual: true });
jest.mock('../src/middleware/supervisor.js', () => ({ verifySupervisor: (req, res, next) => next() }), { virtual: true });

let app;
let scheduleRoutes;

beforeAll(async () => {
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/schedules', scheduleRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  mockShiftSchedule.find.mockReset();
  mockShiftSchedule.deleteMany.mockReset();
  mockEmployee.find.mockReset();
});

describe('Schedule API', () => {
  it('lists schedules', async () => {
    const fakeSchedules = [{ shiftType: 'morning' }];
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fakeSchedules) });
    const res = await request(app).get('/api/schedules');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fakeSchedules);
  });

  it('returns 500 if listing fails', async () => {
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('fail')) });
    const res = await request(app).get('/api/schedules');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'fail' });
  });

  it('creates schedule', async () => {
    const payload = { shiftType: 'morning' };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/schedules').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
    expect(res.body).toMatchObject(payload);
  });

  it('exports schedules to pdf', async () => {
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) });
    const res = await request(app).get('/api/schedules/export?format=pdf');
    expect(res.status).toBe(200);
    expect(pdfPipe).toHaveBeenCalled();
  });

  it('exports schedules to excel', async () => {
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue([]) });
    const res = await request(app).get('/api/schedules/export?format=excel');
    expect(res.status).toBe(200);
    expect(workbookMock.xlsx.writeBuffer).toHaveBeenCalled();
  });

  it('lists schedules by month', async () => {
    const fake = [{ shiftType: 'night' }];
    mockShiftSchedule.find.mockReturnValue({ populate: jest.fn().mockResolvedValue(fake) });
    const res = await request(app).get('/api/schedules/monthly?month=2023-01&employee=e1');
    expect(res.status).toBe(200);
    expect(mockShiftSchedule.find).toHaveBeenCalled();
    expect(res.body).toEqual(fake);
  });

  it('lists schedules by supervisor', async () => {
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
    mockShiftSchedule.insertMany = jest.fn().mockResolvedValue([{ _id: '1' }]);
    const payload = { schedules: [{ employee: 'e1', date: '2023-01-01', shiftType: 'day' }] };
    const res = await request(app).post('/api/schedules/batch').send(payload);
    expect(res.status).toBe(201);
    expect(mockShiftSchedule.insertMany).toHaveBeenCalled();
  });

  it('deletes old schedules', async () => {
    const data = [
      { _id: '1', date: new Date('2020-01-01') },
      { _id: '2', date: new Date('2030-01-01') }
    ];
    mockShiftSchedule.deleteMany.mockImplementation(({ date }) => {
      const beforeDate = date.$lt;
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
