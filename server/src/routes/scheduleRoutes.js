import { Router } from 'express';
import {
  listSchedules,
  createSchedule,
  getSchedule,
  updateSchedule,
  deleteSchedule,
  exportSchedules
} from '../controllers/scheduleController.js';

const router = Router();

router.get('/', listSchedules);
router.get('/export', exportSchedules);
router.post('/', createSchedule);
router.get('/:id', getSchedule);
router.put('/:id', updateSchedule);
router.delete('/:id', deleteSchedule);

export default router;
