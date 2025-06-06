import { Router } from 'express';
import {
  listSchedules,
  createSchedule,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  exportSchedules,
  listMonthlySchedules,
  createSchedulesBatch
} from '../controllers/scheduleController.js';
import { verifySupervisor } from '../middleware/supervisor.js';

const router = Router();

router.get('/', listSchedules);
router.get('/monthly', listMonthlySchedules);
router.get('/export', exportSchedules);
router.post('/batch', verifySupervisor, createSchedulesBatch);
router.post('/', verifySupervisor, createSchedule);
router.get('/:id', getSchedule);
router.put('/:id', verifySupervisor, updateSchedule);
router.delete('/:id', deleteSchedule);

export default router;
