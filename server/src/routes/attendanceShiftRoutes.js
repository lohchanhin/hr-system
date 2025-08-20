import { Router } from 'express';
import { getAttendanceSettings } from '../controllers/attendanceShiftController.js';

const router = Router();

router.get('/', getAttendanceSettings);

export default router;
