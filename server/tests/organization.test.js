import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const Organization = jest.fn().mockImplementation(() => ({ save: saveMock }));
Organization.find = jest.fn();
Organization.findByIdAndUpdate = jest.fn();
Organization.findByIdAndDelete = jest.fn();

jest.mock('../src/models/Organization.js', () => ({ default: Organization }), { virtual: true });

let app;
let organizationRoutes;

beforeAll(async () => {
  organizationRoutes = (await import('../src/routes/organizationRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/organizations', organizationRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  Organization.find.mockReset();
  Organization.findByIdAndUpdate.mockReset();
  Organization.findByIdAndDelete.mockReset();
});

describe('Organization API', () => {
  it('lists organizations', async () => {
    Organization.find.mockResolvedValue([{ name: 'Org' }]);
    const res = await request(app).get('/api/organizations');
    expect(res.status).toBe(200);
  });

  it('creates organization', async () => {
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/organizations').send({ name: 'Org' });
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
  });

  it('updates organization', async () => {
    Organization.findByIdAndUpdate.mockResolvedValue({ name: 'Org' });
    const res = await request(app).put('/api/organizations/1').send({ name: 'Org' });
    expect(res.status).toBe(200);
    expect(Organization.findByIdAndUpdate).toHaveBeenCalled();
  });

  it('deletes organization', async () => {
    Organization.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/organizations/1');
    expect(res.status).toBe(200);
    expect(Organization.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});
