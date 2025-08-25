import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const mockShiftSchedule = { findOne: jest.fn(), create: jest.fn(), insertMany: jest.fn() };
const mockApprovalRequest = { findOne: jest.fn() };
const mockFormTemplate = { findOne: jest.fn() };
const mockFormField = { find: jest.fn() };
const mockEmployee = { findById: jest.fn(), find: jest.fn() };
const mockUser = { findById: jest.fn() };

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }));
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }));
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }));
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
jest.unstable_mockModule('../src/models/User.js', () => ({ default: mockUser }));

let app;
let scheduleRoutes;
let employeeRoutes;

beforeAll(async () => {
  scheduleRoutes = (await import('../src/routes/scheduleRoutes.js')).default;
  employeeRoutes = (await import('../src/routes/employeeRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: 'u1', role: 'supervisor' };
    next();
  });
  app.use('/api/schedules', scheduleRoutes);
  app.use('/api/employees', employeeRoutes);
});

beforeEach(() => {
  mockShiftSchedule.findOne.mockReset();
  mockShiftSchedule.create.mockReset();
  mockShiftSchedule.insertMany.mockReset();
  mockApprovalRequest.findOne.mockReset();
  mockFormTemplate.findOne.mockResolvedValue({ _id: 'form1' });
  mockFormField.find.mockResolvedValue([
    { _id: 's', label: '開始日期' },
    { _id: 'e', label: '結束日期' },
  ]);
  mockEmployee.findById.mockReset();
  mockEmployee.find.mockReset();
  mockUser.findById.mockReset();
});

describe('Supervisor schedule permissions', () => {
  it('allows supervisor to create schedule for own employee', async () => {
    mockUser.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue({ _id: 'u1', role: 'supervisor', employee: null, supervisor: 'sup1' })
    });
    mockEmployee.findById.mockResolvedValue({ _id: 'emp1', supervisor: 'sup1' });
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue(null);
    mockShiftSchedule.create.mockResolvedValue({ _id: 'sch1' });

    const res = await request(app)
      .post('/api/schedules')
      .send({ employee: 'emp1', date: '2023-01-01', shiftId: 'day' });

    expect(res.status).toBe(201);
    expect(mockShiftSchedule.create).toHaveBeenCalled();
  });

  it('rejects batch creation if any employee not under supervisor', async () => {
    mockUser.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue({ _id: 'u1', role: 'supervisor', employee: null, supervisor: 'sup1' })
    });
    mockEmployee.findById.mockImplementation((id) => {
      if (id === 'emp1') return Promise.resolve({ _id: 'emp1', supervisor: 'sup1' });
      if (id === 'emp2') return Promise.resolve({ _id: 'emp2', supervisor: 'other' });
      return Promise.resolve(null);
    });

    const payload = {
      schedules: [
        { employee: 'emp1', date: '2023-01-01', shiftId: 'day' },
        { employee: 'emp2', date: '2023-01-02', shiftId: 'day' }
      ]
    };

    const res = await request(app).post('/api/schedules/batch').send(payload);

    expect(res.status).toBe(403);
    expect(mockShiftSchedule.insertMany).not.toHaveBeenCalled();
  });

  it('lists supervisor employees and creates schedules batch', async () => {
    mockUser.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue({ _id: 'u1', role: 'supervisor', employee: null, supervisor: 'sup1' })
    });
    const fakeEmployees = [{ _id: 'emp1', supervisor: 'sup1', name: 'Emp1' }];
    mockEmployee.find.mockReturnValue({
      populate: jest.fn().mockReturnValue({ sort: jest.fn().mockResolvedValue(fakeEmployees) })
    });
    const listRes = await request(app).get('/api/employees?supervisor=sup1');
    expect(listRes.status).toBe(200);
    expect(mockEmployee.find).toHaveBeenCalledWith({ supervisor: 'sup1' });
    expect(listRes.body).toEqual(fakeEmployees);

    mockEmployee.findById.mockResolvedValue({ _id: 'emp1', supervisor: 'sup1' });
    mockShiftSchedule.findOne.mockResolvedValue(null);
    mockApprovalRequest.findOne.mockResolvedValue(null);
    mockShiftSchedule.insertMany.mockResolvedValue([{ _id: 'sch1' }]);

    const payload = { schedules: [{ employee: 'emp1', date: '2023-01-01', shiftId: 'day' }] };
    const res = await request(app).post('/api/schedules/batch').send(payload);
    expect(res.status).toBe(201);
    expect(mockShiftSchedule.insertMany).toHaveBeenCalled();
  });
});
