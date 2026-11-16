import mongoose from 'mongoose';
import AuditEvent from '../models/AuditEvent.js';

const SENSITIVE_KEY_PATTERN = /(password|token|secret|authorization|cookie|idNumber|accountNumber|backupCode)/i;

export function sanitizeAuditSummary(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 3) return '[truncated]';
  if (typeof value === 'string') {
    return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeAuditSummary(item, depth + 1));
  }
  const sanitized = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      sanitized[k] = '[REDACTED]';
    } else {
      sanitized[k] = sanitizeAuditSummary(v, depth + 1);
    }
  }
  return sanitized;
}

export async function recordAuditEvent({
  req = null,
  actor = null,
  action,
  resourceType = '',
  resourceId = '',
  status = 'success',
  summary = {},
}) {
  if (!action) return null;
  if (mongoose.connection.readyState !== 1 && typeof AuditEvent.create?.mock !== 'object') {
    return null;
  }
  try {
    const resolvedActor = actor || {
      id: req?.user?.id ? String(req.user.id) : '',
      username: req?.user?.username ? String(req.user.username) : '',
      role: req?.user?.role ? String(req.user.role) : '',
    };
    return await AuditEvent.create({
      timestamp: new Date(),
      requestId: req?.requestId || req?.id || '',
      actor: resolvedActor,
      action,
      resourceType,
      resourceId: resourceId ? String(resourceId) : '',
      ip: req?.ip || '',
      userAgent: typeof req?.get === 'function' ? req.get('user-agent') || '' : '',
      status,
      summary: sanitizeAuditSummary(summary),
    });
  } catch (err) {
    // Audit logging must never crash the primary request flow in degraded DB conditions
    console.error('Failed to persist audit event', { action, error: err?.name || 'Error' });
    return null;
  }
}
