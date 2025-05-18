import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const compareMock = jest.fn();
const fakeUser = { _id: 'u1', role: 'employee', username: 'john', comparePassword: compareMock };
const User = { findOne: jest.fn() };

jest.mock('../src/models/User.js', () => ({ default: User }), { virtual: true });

let app;
let authRoutes;

beforeAll(async () => {
  authRoutes = (await import('../src/routes/authRoutes.js')).default;
  app = express();
  app.use(express.json());
  app.use('/api', authRoutes);
});

beforeEach(() => {
  User.findOne.mockReset();
  compareMock.mockReset();
});

describe('Auth API', () => {
  it('logs in with valid credentials', async () => {
    User.findOne.mockResolvedValue(fakeUser);
    compareMock.mockResolvedValue(true);
    const signSpy = jest.spyOn(jwt, 'sign').mockReturnValue('tok');
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'pass' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('tok');
    expect(res.body.user).toEqual({ id: 'u1', role: 'employee', username: 'john' });
    signSpy.mockRestore();
  });

  it('fails with invalid credentials', async () => {
    User.findOne.mockResolvedValue(fakeUser);
    compareMock.mockResolvedValue(false);
    const res = await request(app).post('/api/login').send({ username: 'john', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
