import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';

const saveMock = jest.fn();
const mockOrganization = jest.fn().mockImplementation(() => ({ save: saveMock }));
mockOrganization.find = jest.fn();
mockOrganization.findByIdAndUpdate = jest.fn();
mockOrganization.findByIdAndDelete = jest.fn();

jest.unstable_mockModule('../src/models/Organization.js', () => ({ default: mockOrganization }));

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
  mockOrganization.find.mockReset();
  mockOrganization.findByIdAndUpdate.mockReset();
  mockOrganization.findByIdAndDelete.mockReset();
});

describe('Organization API', () => {
  it('lists organizations', async () => {
    mockOrganization.find.mockResolvedValue([{ name: 'Org' }]);
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
    mockOrganization.findByIdAndUpdate.mockResolvedValue({ name: 'Org' });
    const res = await request(app).put('/api/organizations/1').send({ name: 'Org' });
    expect(res.status).toBe(200);
    expect(mockOrganization.findByIdAndUpdate).toHaveBeenCalled();
  });

  it('deletes organization', async () => {
    mockOrganization.findByIdAndDelete.mockResolvedValue({});
    const res = await request(app).delete('/api/organizations/1');
    expect(res.status).toBe(200);
    expect(mockOrganization.findByIdAndDelete).toHaveBeenCalledWith('1');
  });
});

describe('Organization authorization middleware', () => {
  it('allows employee to list but not create', async () => {
    const { authorizeRoles } = await import('../src/middleware/auth.js');
    const authenticate = (req, res, next) => {
      req.user = { role: 'employee' };
      next();
    };
    const appAuth = express();
    appAuth.use(express.json());
    appAuth.use(
      '/api/organizations',
      authenticate,
      (req, res, next) => {
        if (req.method === 'GET') {
          return authorizeRoles('admin', 'supervisor', 'employee')(req, res, next);
        }
        return authorizeRoles('admin')(req, res, next);
      },
      organizationRoutes
    );

    mockOrganization.find.mockResolvedValue([]);
    const resList = await request(appAuth).get('/api/organizations');
    expect(resList.status).toBe(200);

    const resCreate = await request(appAuth).post('/api/organizations').send({});
    expect(resCreate.status).toBe(403);
  });
});
