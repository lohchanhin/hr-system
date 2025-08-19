import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const toObjectMock = jest.fn(() => ({}));
const mockUser = jest.fn().mockImplementation(() => ({ save: saveMock, toObject: toObjectMock }));
mockUser.find = jest.fn();
mockUser.findById = jest.fn();
mockUser.findByIdAndDelete = jest.fn();

let app;
let userRoutes;

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/User.js', () => ({ default: mockUser }));
  userRoutes = (await import('../src/routes/userRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  toObjectMock.mockReset().mockReturnValue({});
  mockUser.find.mockReset();
  mockUser.findById.mockReset();
  mockUser.findByIdAndDelete.mockReset();
});

describe('User API', () => {
  it('lists users', async () => {
    const fake = [{ username: 'a' }];
    mockUser.find.mockReturnValue({ select: jest.fn().mockResolvedValue(fake) });
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fake);
  });

  it('creates user', async () => {
    const payload = { username: 'u', password: 'p', role: 'admin' };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/users').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
  });

  for (const field of ['username', 'password', 'role']) {
    it(`requires ${field} on create`, async () => {
      const payload = { username: 'u', password: 'p', role: 'employee' };
      delete payload[field];
      const res = await request(app).post('/api/users').send(payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(`${field} is required`);
    });
  }

  it('rejects invalid role on create', async () => {
    const payload = { username: 'u', password: 'p', role: 'boss' };
    const res = await request(app).post('/api/users').send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid role');
  });

  it('updates user', async () => {
    mockUser.findById.mockResolvedValue({ save: saveMock, toObject: toObjectMock, username: 'u', password: 'p', role: 'employee' });
    saveMock.mockResolvedValue();
    const res = await request(app)
      .put('/api/users/1')
      .send({ username: 'b', password: 'p2', role: 'admin' });
    expect(res.status).toBe(200);
    expect(mockUser.findById).toHaveBeenCalledWith('1');
  });

  for (const field of ['username', 'password', 'role']) {
    it(`requires ${field} on update`, async () => {
      const payload = { username: 'u', password: 'p', role: 'employee' };
      delete payload[field];
      const res = await request(app).put('/api/users/1').send(payload);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe(`${field} is required`);
    });
  }

  it('rejects invalid role on update', async () => {
    const payload = { username: 'u', password: 'p', role: 'boss' };
    const res = await request(app).put('/api/users/1').send(payload);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid role');
  });

  it('deletes user', async () => {
    mockUser.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/users/1');
    expect(res.status).toBe(200);
    expect(mockUser.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});
