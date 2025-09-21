import { Router } from 'express';

import {
  getAttendanceSetting,
  updateAttendanceSetting,
} from '../controllers/attendanceSettingController.js';

const router = Router();

router.get('/', getAttendanceSetting);
router.put('/', updateAttendanceSetting);

export default router;
