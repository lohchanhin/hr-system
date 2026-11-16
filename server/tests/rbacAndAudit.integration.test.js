import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import {
  PERMISSIONS,
  getPermissionsForRole,
  roleHasPermission,
} from '../src/config/rbac.js';
import { authorizePermissions } from '../src/middleware/auth.js';

const mockAuditEventModel = {
  create: jest.fn(),
  find: jest.fn(),
  countDocuments: jest.fn(),
};

jest.unstable_mockModule('../src/models/AuditEvent.js', () => ({ default: mockAuditEventModel }));

const { recordAuditEvent, sanitizeAuditSummary } = await import('../src/services/auditService.js');
const auditRoutes = (await import('../src/routes/auditRoutes.js')).default;

describe('P1 RBAC & AuditEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('enforces least-privilege separation across admin, hr_admin, payroll_admin, auditor', () => {
    expect(getPermissionsForRole('admin')).toEqual(expect.arrayContaining(Object.values(PERMISSIONS)));

    expect(roleHasPermission('hr_admin', PERMISSIONS.EMPLOYEE_WRITE)).toBe(true);
    expect(roleHasPermission('hr_admin', PERMISSIONS.PAYROLL_WRITE)).toBe(false);
    expect(roleHasPermission('hr_admin', PERMISSIONS.AUDIT_READ)).toBe(false);

    expect(roleHasPermission('payroll_admin', PERMISSIONS.PAYROLL_WRITE)).toBe(true);
    expect(roleHasPermission('payroll_admin', PERMISSIONS.EMPLOYEE_WRITE)).toBe(false);
    expect(roleHasPermission('payroll_admin', PERMISSIONS.SYSTEM_SETTING_WRITE)).toBe(false);

    expect(roleHasPermission('auditor', PERMISSIONS.AUDIT_READ)).toBe(true);
    expect(roleHasPermission('auditor', PERMISSIONS.PAYROLL_READ)).toBe(true);
    expect(roleHasPermission('auditor', PERMISSIONS.EMPLOYEE_WRITE)).toBe(false);
    expect(roleHasPermission('auditor', PERMISSIONS.PAYROLL_WRITE)).toBe(false);
  });

  it('sanitizeAuditSummary redacts sensitive fields recursively', () => {
    const sanitized = sanitizeAuditSummary({
      username: 'alice',
      password: 'plain-password',
      twoFactorSecret: 'JBSWY3DPEHPK3PXP',
      nested: {
        refreshToken: 'secret-refresh',
        note: 'ok',
      },
    });
    expect(sanitized.username).toBe('alice');
    expect(sanitized.password).toBe('[REDACTED]');
    expect(sanitized.twoFactorSecret).toBe('[REDACTED]');
    expect(sanitized.nested.refreshToken).toBe('[REDACTED]');
    expect(sanitized.nested.note).toBe('ok');
  });

  it('recordAuditEvent persists sanitized audit entry', async () => {
    mockAuditEventModel.create.mockResolvedValue({ _id: 'evt1' });
    await recordAuditEvent({
      actor: { id: 'u1', username: 'admin', role: 'admin' },
      action: 'AUTH_LOGIN',
      resourceType: 'Employee',
      resourceId: 'u1',
      status: 'success',
      summary: { password: 'secret', ip: '127.0.0.1' },
    });
    expect(mockAuditEventModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'AUTH_LOGIN',
        summary: { password: '[REDACTED]', ip: '127.0.0.1' },
      })
    );
  });

  it('GET /api/audit-events allows auditor/admin and denies hr_admin', async () => {
    const buildApp = (role) => {
      const app = express();
      app.use((req, _res, next) => {
        req.user = { id: 'u1', role, permissions: getPermissionsForRole(role) };
        next();
      });
      app.use('/api/audit-events', authorizePermissions(PERMISSIONS.AUDIT_READ), auditRoutes);
      return app;
    };

    const hrRes = await request(buildApp('hr_admin')).get('/api/audit-events');
    expect(hrRes.status).toBe(403);

    const mockChain = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([{ _id: 'e1', action: 'AUTH_LOGIN' }]),
    };
    mockAuditEventModel.find.mockReturnValue(mockChain);
    mockAuditEventModel.countDocuments.mockResolvedValue(1);

    const auditorRes = await request(buildApp('auditor')).get('/api/audit-events');
    expect(auditorRes.status).toBe(200);
    expect(auditorRes.body.items).toHaveLength(1);
    expect(auditorRes.body.total).toBe(1);
  });
});
