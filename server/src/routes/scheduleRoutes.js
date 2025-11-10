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
  publishSchedules,
  finalizeSchedules,
  respondToSchedule,
  respondToSchedulesBulk,
} from '../controllers/scheduleController.js';
import { verifySupervisor } from '../middleware/supervisor.js';
import { authenticate, authorizeRoles } from '../middleware/auth.js';

const router = Router();

router.get('/', listSchedules);
router.get('/monthly', listMonthlySchedules);
router.get('/leave-approvals', listLeaveApprovals);
router.get('/summary', authenticate, authorizeRoles('supervisor'), listSupervisorSummary);
router.get('/overview', authorizeRoles('admin'), listScheduleOverview);
router.get('/export', exportSchedules);
router.post('/publish', authenticate, authorizeRoles('supervisor', 'admin'), publishSchedules);
router.post('/publish/finalize', authenticate, authorizeRoles('supervisor', 'admin'), finalizeSchedules);
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
router.delete('/:id', deleteSchedule);

export default router;
