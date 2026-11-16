import { Router } from 'express';
import AuditEvent from '../models/AuditEvent.js';
import { PERMISSIONS } from '../config/rbac.js';
import { authorizePermissions } from '../middleware/auth.js';

const router = Router();

router.get('/', authorizePermissions(PERMISSIONS.AUDIT_READ), async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const filter = {};

    if (typeof req.query.action === 'string' && req.query.action.trim()) {
      filter.action = req.query.action.trim();
    }
    if (typeof req.query.actorId === 'string' && req.query.actorId.trim()) {
      filter['actor.id'] = req.query.actorId.trim();
    }
    if (typeof req.query.resourceType === 'string' && req.query.resourceType.trim()) {
      filter.resourceType = req.query.resourceType.trim();
    }
    if (req.query.from || req.query.to) {
      filter.timestamp = {};
      if (req.query.from) {
        const fromDate = new Date(req.query.from);
        if (!Number.isNaN(fromDate.getTime())) filter.timestamp.$gte = fromDate;
      }
      if (req.query.to) {
        const toDate = new Date(req.query.to);
        if (!Number.isNaN(toDate.getTime())) filter.timestamp.$lte = toDate;
      }
      if (Object.keys(filter.timestamp).length === 0) delete filter.timestamp;
    }

    const [items, total] = await Promise.all([
      AuditEvent.find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      AuditEvent.countDocuments(filter),
    ]);

    res.json({
      items,
      total,
      page,
      limit,
    });
  } catch (err) {
    console.error('Failed to list audit events', { error: err?.name || 'Error' });
    res.status(500).json({ error: '讀取稽核紀錄失敗' });
  }
});

export default router;
