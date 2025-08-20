import { Router } from 'express';
import {
  listDeptSchedules,
  createDeptSchedule,
  getDeptSchedule,
  updateDeptSchedule,
  deleteDeptSchedule
} from '../controllers/deptScheduleController.js';

const router = Router();

router.get('/', listDeptSchedules);
router.post('/', createDeptSchedule);
router.get('/:id', getDeptSchedule);
router.put('/:id', updateDeptSchedule);
router.delete('/:id', deleteDeptSchedule);

export default router;
