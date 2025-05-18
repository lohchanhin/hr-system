import { Router } from 'express';
import { listSchedules, createSchedule } from '../controllers/scheduleController.js';

const router = Router();

router.get('/', listSchedules);
router.post('/', createSchedule);

export default router;
