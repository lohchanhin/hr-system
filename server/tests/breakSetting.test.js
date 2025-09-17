import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockBreakSetting = jest.fn().mockImplementation(payload => ({
  ...payload,
  save: saveMock
}));

mockBreakSetting.find = jest.fn();
mockBreakSetting.findOne = jest.fn();
mockBreakSetting.findOneAndUpdate = jest.fn();
mockBreakSetting.findOneAndDelete = jest.fn();

jest.unstable_mockModule('../src/models/BreakSetting.js', () => ({
  default: mockBreakSetting
}));

let app;
let routes;

beforeAll(async () => {
  routes = (await import('../src/routes/breakSettingRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/break-settings', routes);
});

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockResolvedValue(undefined);
  mockBreakSetting.mockClear();
  mockBreakSetting.find.mockReset();
  mockBreakSetting.findOne.mockReset();
  mockBreakSetting.findOneAndUpdate.mockReset();
  mockBreakSetting.findOneAndDelete.mockReset();
});

describe('BreakSetting routes', () => {
  it('requires scope when listing', async () => {
    const res = await request(app).get('/api/break-settings');
    expect(res.status).toBe(400);
    expect(mockBreakSetting.find).not.toHaveBeenCalled();
  });

  it('lists settings filtered by department', async () => {
    mockBreakSetting.find.mockResolvedValue([{ department: 'dept1' }]);
    const res = await request(app).get('/api/break-settings?department=dept1');
    expect(res.status).toBe(200);
    expect(mockBreakSetting.find).toHaveBeenCalledWith({ department: 'dept1' });
  });

  it('rejects conflicting scope filters', async () => {
    const res = await request(app).get('/api/break-settings?department=d1&subDepartment=s1');
    expect(res.status).toBe(400);
  });

  it('gets setting for department via path', async () => {
    mockBreakSetting.findOne.mockResolvedValue({ department: 'dept2' });
    const res = await request(app).get('/api/break-settings/department/dept2');
    expect(res.status).toBe(200);
    expect(mockBreakSetting.findOne).toHaveBeenCalledWith({ department: 'dept2' });
  });

  it('creates new setting with department scope', async () => {
    mockBreakSetting.findOne.mockResolvedValueOnce(null);
    saveMock.mockResolvedValue({});

    const payload = {
      department: 'dept3',
      enableGlobalBreak: true,
      breakMinutes: 50,
      allowMultiBreak: true
    };

    const res = await request(app).post('/api/break-settings').send(payload);

    expect(res.status).toBe(201);
    expect(mockBreakSetting.findOne).toHaveBeenCalledWith({ department: 'dept3' });
    expect(mockBreakSetting).toHaveBeenCalledWith(expect.objectContaining(payload));
    expect(saveMock).toHaveBeenCalled();
  });

  it('prevents duplicate settings per scope', async () => {
    mockBreakSetting.findOne.mockResolvedValueOnce({ _id: 'existing' });
    const res = await request(app).post('/api/break-settings').send({ department: 'dept4' });
    expect(res.status).toBe(409);
    expect(saveMock).not.toHaveBeenCalled();
  });

  it('updates setting when scope matches', async () => {
    mockBreakSetting.findOneAndUpdate.mockResolvedValue({ _id: 'id1', department: 'dept5' });
    const res = await request(app)
      .put('/api/break-settings/id1')
      .send({ department: 'dept5', breakMinutes: 40 });

    expect(res.status).toBe(200);
    expect(mockBreakSetting.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'id1', department: 'dept5' },
      expect.objectContaining({ department: 'dept5', breakMinutes: 40 }),
      expect.objectContaining({ runValidators: true })
    );
  });

  it('rejects update without scope', async () => {
    const res = await request(app).put('/api/break-settings/id2').send({ breakMinutes: 35 });
    expect(res.status).toBe(400);
    expect(mockBreakSetting.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('deletes setting when scope matches', async () => {
    mockBreakSetting.findOneAndDelete.mockResolvedValue({ _id: 'id3', department: 'dept6' });
    const res = await request(app).delete('/api/break-settings/id3?department=dept6');
    expect(res.status).toBe(200);
    expect(mockBreakSetting.findOneAndDelete).toHaveBeenCalledWith({ _id: 'id3', department: 'dept6' });
  });

  it('rejects delete without scope', async () => {
    const res = await request(app).delete('/api/break-settings/id4');
    expect(res.status).toBe(400);
    expect(mockBreakSetting.findOneAndDelete).not.toHaveBeenCalled();
  });
});
