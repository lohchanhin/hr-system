import { Router } from 'express';
import { listRecords, createRecord } from '../controllers/attendanceController.js';

const router = Router();

router.get('/', listRecords);
router.post('/', createRecord);

export default router;
