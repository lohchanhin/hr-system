import { Router } from 'express';
import {
  listSchedules,
  createSchedule,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  exportSchedules,
  listMonthlySchedules,
  createSchedulesBatch,
  deleteOldSchedules,
  listLeaveApprovals,
  listSupervisorSummary,
  listScheduleOverview,
  exportScheduleOverview,
  publishSchedules,
  finalizeSchedules,
  respondToSchedule,
  respondToSchedulesBulk,
  validateScheduleRules,
  validateScheduleCompleteness,
  getIncompleteSchedules,
  checkCanFinalize,
  getIncludeSelfPreference,
  updateIncludeSelfPreference,
  importSchedules,
  deleteSchedulesBatch,
  listScheduleDayMemos,
  upsertScheduleDayMemo,
} from '../controllers/scheduleController.js';
import { verifySupervisor } from '../middleware/supervisor.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';
// 排班功能看「排班權限」而不是角色：管理員、主管（排班權限模式允許時）與被指定為排班人員的員工都能使用
import { requireScheduleAccess } from '../middleware/scheduleAccess.js';
import uploadMiddleware from '../middleware/upload.js';

const router = Router();

router.get('/', listSchedules);
router.get('/monthly', listMonthlySchedules);
router.get('/leave-approvals', listLeaveApprovals);
router.get('/preferences/include-self', authenticate, authorizeRoles('supervisor'), getIncludeSelfPreference);
router.put('/preferences/include-self', authenticate, authorizeRoles('supervisor'), updateIncludeSelfPreference);
// 主管統計：原本只給主管（管理員不開放），現在排班人員也看得到自己範圍的統計
router.get('/summary', authenticate, requireScheduleAccess({ excludeRoles: ['admin'] }), listSupervisorSummary);
router.get('/overview', authorizeRoles('admin'), listScheduleOverview);
router.get('/overview/export', authorizeRoles('admin'), exportScheduleOverview);
router.get('/export', exportSchedules);
router.get('/rules/validate', authenticate, requireScheduleAccess(), validateScheduleRules);
router.get('/validate', authenticate, requireScheduleAccess(), validateScheduleCompleteness);
router.get('/incomplete', authenticate, requireScheduleAccess(), getIncompleteSchedules);
router.get('/can-finalize', authenticate, requireScheduleAccess(), checkCanFinalize);
router.post('/publish', authenticate, requireScheduleAccess(), publishSchedules);
router.post('/publish/finalize', authenticate, requireScheduleAccess(), finalizeSchedules);
router.post('/import', authenticate, requireScheduleAccess(), uploadMiddleware, importSchedules);
router.get('/memos', authenticate, requireScheduleAccess(), listScheduleDayMemos);
router.put('/memos/:date', authenticate, requireScheduleAccess(), upsertScheduleDayMemo);
router.post('/batch-delete', authenticate, requireScheduleAccess(), deleteSchedulesBatch);
router.post('/batch', verifySupervisor, createSchedulesBatch);
router.post('/', verifySupervisor, createSchedule);
router.get('/:id', getSchedule);
router.post(
  '/respond/bulk',
  authenticate,
  authorizeRoles('employee', 'supervisor'),
  respondToSchedulesBulk
);
router.post(
  '/:id/respond',
  authenticate,
  authorizeRoles('employee', 'supervisor'),
  respondToSchedule
);
router.put('/:id', verifySupervisor, updateSchedule);
router.delete('/older-than', verifySupervisor, deleteOldSchedules);
router.delete('/:id', verifySupervisor, deleteSchedule);

export default router;
