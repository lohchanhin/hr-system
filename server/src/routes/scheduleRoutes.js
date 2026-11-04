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
// 排班功能看「排班權限」而不是角色：管理員、被指定為排班人員的員工（任何角色），與排班權限模式允許時的主管
// （預設只有排班人員，見 docs/scheduler-access.md）
import { requireScheduleAccess } from '../middleware/scheduleAccess.js';
import uploadMiddleware from '../middleware/upload.js';

const router = Router();

router.get('/', listSchedules);
router.get('/monthly', listMonthlySchedules);
router.get('/leave-approvals', listLeaveApprovals);
router.get('/preferences/include-self', authenticate, authorizeRoles('supervisor'), getIncludeSelfPreference);
router.put('/preferences/include-self', authenticate, authorizeRoles('supervisor'), updateIncludeSelfPreference);
// 排班頁上方的統計（排班員工數、未排班、請假中）：範圍與排班頁名單相同（有排班權限的人；管理員是所選部門、小單位的所有員工，
// 以前管理員不開放，排班頁的統計一直是 0）
router.get('/summary', authenticate, requireScheduleAccess(), listSupervisorSummary);
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
// 刪除某個日期以前的所有班表（全公司，畫面沒有用到）：只有管理員；以前任何排班人員帶一位範圍內的員工就能清掉全公司的舊班表
router.delete('/older-than', authenticate, authorizeRoles('admin'), deleteOldSchedules);
router.delete('/:id', verifySupervisor, deleteSchedule);

export default router;
