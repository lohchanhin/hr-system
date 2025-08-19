import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import { authorizeRoles } from '../src/middleware/auth.js';

const saveMock = jest.fn();
const mockUser = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockUser.find = jest.fn();
mockUser.findById = jest.fn();
mockUser.findByIdAndDelete = jest.fn();

jest.mock('../src/models/User.js', () => ({ default: mockUser }), { virtual: true });

let app;
let userRoutes;
let currentRole = 'admin';

const authenticate = (req, res, next) => {
  req.user = { role: currentRole };
  next();
};

beforeAll(async () => {
  userRoutes = (await import('../src/routes/userRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/users', authenticate, authorizeRoles('admin'), userRoutes);
});

describe('User API as admin', () => {
  beforeEach(() => {
    currentRole = 'admin';
    saveMock.mockReset();
    mockUser.find.mockReset();
    mockUser.findById.mockReset();
    mockUser.findByIdAndDelete.mockReset();
  });

  it('lists users', async () => {
    const fake = [{ username: 'a' }];
    mockUser.find.mockResolvedValue(fake);
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

  it('updates user', async () => {
    mockUser.findById.mockResolvedValue({ save: saveMock, username: 'u' });
    saveMock.mockResolvedValue();
    const res = await request(app).put('/api/users/1').send({ username: 'b' });
    expect(res.status).toBe(200);
    expect(mockUser.findById).toHaveBeenCalledWith('1');
  });

  it('deletes user', async () => {
    mockUser.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/users/1');
    expect(res.status).toBe(200);
    expect(mockUser.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});

describe('User API as non-admin', () => {
  beforeEach(() => {
    currentRole = 'user';
    saveMock.mockReset();
    mockUser.find.mockReset();
    mockUser.findById.mockReset();
    mockUser.findByIdAndDelete.mockReset();
  });

  it('denies listing users', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('denies creating user', async () => {
    const res = await request(app).post('/api/users').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('denies updating user', async () => {
    const res = await request(app).put('/api/users/1').send({});
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('denies deleting user', async () => {
    const res = await request(app).delete('/api/users/1');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });
});
