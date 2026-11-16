/**
 * Role-Based Access Control (RBAC) permission definitions and role mappings.
 * Backward-compatible transition: `admin` retains all permissions, while
 * `hr_admin`, `payroll_admin`, and `auditor` enforce least-privilege separation.
 */

export const PERMISSIONS = Object.freeze({
  // Employee & Organization
  EMPLOYEE_READ: 'employee:read',
  EMPLOYEE_READ_SENSITIVE: 'employee:read_sensitive',
  EMPLOYEE_WRITE: 'employee:write',
  ORG_READ: 'org:read',
  ORG_WRITE: 'org:write',

  // Attendance & Scheduling
  ATTENDANCE_READ: 'attendance:read',
  ATTENDANCE_WRITE: 'attendance:write',
  SCHEDULE_READ: 'schedule:read',
  SCHEDULE_WRITE: 'schedule:write',
  ATTENDANCE_SETTING_WRITE: 'attendance_setting:write',

  // Payroll & Insurance
  PAYROLL_READ: 'payroll:read',
  PAYROLL_WRITE: 'payroll:write',
  PAYROLL_EXPORT: 'payroll:export',
  INSURANCE_READ: 'insurance:read',
  INSURANCE_WRITE: 'insurance:write',
  SALARY_SETTING_WRITE: 'salary_setting:write',

  // Approvals & Reports
  APPROVAL_READ: 'approval:read',
  APPROVAL_WRITE: 'approval:write',
  REPORT_DEPARTMENT_READ: 'report:department_read',
  REPORT_ADMIN_READ: 'report:admin_read',

  // System Settings & Audit
  SYSTEM_SETTING_WRITE: 'system_setting:write',
  AUDIT_READ: 'audit:read',
});

const ALL_PERMISSIONS = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS = Object.freeze({
  admin: Object.freeze([...ALL_PERMISSIONS]),
  hr_admin: Object.freeze([
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.EMPLOYEE_READ_SENSITIVE,
    PERMISSIONS.EMPLOYEE_WRITE,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.ORG_WRITE,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_WRITE,
    PERMISSIONS.SCHEDULE_READ,
    PERMISSIONS.SCHEDULE_WRITE,
    PERMISSIONS.ATTENDANCE_SETTING_WRITE,
    PERMISSIONS.APPROVAL_READ,
    PERMISSIONS.APPROVAL_WRITE,
    PERMISSIONS.REPORT_DEPARTMENT_READ,
    PERMISSIONS.REPORT_ADMIN_READ,
  ]),
  payroll_admin: Object.freeze([
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.EMPLOYEE_READ_SENSITIVE,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.PAYROLL_READ,
    PERMISSIONS.PAYROLL_WRITE,
    PERMISSIONS.PAYROLL_EXPORT,
    PERMISSIONS.INSURANCE_READ,
    PERMISSIONS.INSURANCE_WRITE,
    PERMISSIONS.SALARY_SETTING_WRITE,
    PERMISSIONS.REPORT_DEPARTMENT_READ,
    PERMISSIONS.REPORT_ADMIN_READ,
  ]),
  auditor: Object.freeze([
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.SCHEDULE_READ,
    PERMISSIONS.PAYROLL_READ,
    PERMISSIONS.INSURANCE_READ,
    PERMISSIONS.APPROVAL_READ,
    PERMISSIONS.REPORT_DEPARTMENT_READ,
    PERMISSIONS.REPORT_ADMIN_READ,
    PERMISSIONS.AUDIT_READ,
  ]),
  supervisor: Object.freeze([
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_WRITE,
    PERMISSIONS.SCHEDULE_READ,
    PERMISSIONS.APPROVAL_READ,
    PERMISSIONS.APPROVAL_WRITE,
    PERMISSIONS.REPORT_DEPARTMENT_READ,
  ]),
  employee: Object.freeze([
    PERMISSIONS.EMPLOYEE_READ,
    PERMISSIONS.ORG_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_WRITE,
    PERMISSIONS.SCHEDULE_READ,
    PERMISSIONS.APPROVAL_READ,
    PERMISSIONS.APPROVAL_WRITE,
  ]),
});

export const BACKOFFICE_ROLES = Object.freeze(['admin', 'hr_admin', 'payroll_admin', 'auditor']);
export const ALL_ROLES = Object.freeze(['employee', 'supervisor', 'hr_admin', 'payroll_admin', 'auditor', 'admin']);

export function getPermissionsForRole(role) {
  return ROLE_PERMISSIONS[role] || [];
}

export function roleHasPermission(role, permission) {
  return getPermissionsForRole(role).includes(permission);
}

export function roleHasAnyPermission(role, permissions = []) {
  const granted = getPermissionsForRole(role);
  return permissions.some((p) => granted.includes(p));
}
