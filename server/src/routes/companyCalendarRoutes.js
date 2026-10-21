import { Router } from 'express';
import {
  applyYear,
  approve,
  checkUpdates,
  dismissNotice,
  fetchYear,
  getYear,
  listNotices,
  listYears,
  reconciliation,
  rejectYearSnapshot,
  reopen,
  snapshotDiff,
  updateSettings,
} from '../controllers/companyCalendarController.js';
import { authorizeRoles } from '../middleware/auth.js';

const router = Router();

// 行事曆設定只有管理員可用（index.js 掛載時已檢查，這裡再擋一次，不論掛在哪個路徑）
router.use(authorizeRoles('admin'));

router.get('/years', listYears);
router.get('/years/:year', getYear);
router.post('/years/:year/fetch', fetchYear);
router.post('/years/:year/apply', applyYear);
router.post('/years/:year/reject', rejectYearSnapshot);
router.post('/years/:year/approve', approve);
router.post('/years/:year/reopen', reopen);
router.put('/years/:year/settings', updateSettings);
router.get('/snapshots/:id/diff', snapshotDiff);
router.get('/notices', listNotices);
router.post('/notices/:id/dismiss', dismissNotice);
router.post('/check-updates', checkUpdates);
router.get('/reconciliation', reconciliation);

export default router;
