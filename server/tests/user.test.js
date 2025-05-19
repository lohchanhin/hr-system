import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const User = jest.fn().mockImplementation(() => ({ save: saveMock }));
User.find = jest.fn();
User.findById = jest.fn();
User.findByIdAndDelete = jest.fn();

jest.mock('../src/models/User.js', () => ({ default: User }), { virtual: true });

let app;
let userRoutes;

beforeAll(async () => {
  userRoutes = (await import('../src/routes/userRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api/users', userRoutes);
});

beforeEach(() => {
  saveMock.mockReset();
  User.find.mockReset();
  User.findById.mockReset();
  User.findByIdAndDelete.mockReset();
});

describe('User API', () => {
  it('lists users', async () => {
    const fake = [{ username: 'a' }];
    User.find.mockResolvedValue(fake);
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(fake);
  });

  it('creates user', async () => {
    const payload = { username: 'u', password: 'p', role: 'hr' };
    saveMock.mockResolvedValue();
    const res = await request(app).post('/api/users').send(payload);
    expect(res.status).toBe(201);
    expect(saveMock).toHaveBeenCalled();
  });

  it('updates user', async () => {
    User.findById.mockResolvedValue({ save: saveMock, username: 'u' });
    saveMock.mockResolvedValue();
    const res = await request(app).put('/api/users/1').send({ username: 'b' });
    expect(res.status).toBe(200);
    expect(User.findById).toHaveBeenCalledWith('1');
  });

  it('deletes user', async () => {
    User.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/users/1');
    expect(res.status).toBe(200);
    expect(User.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});
