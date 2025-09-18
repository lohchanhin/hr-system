import { Router } from 'express';
import {
  listReports,
  createReport,
  getReport,
  updateReport,
  deleteReport,
  exportDepartmentAttendance
} from '../controllers/reportController.js';

const router = Router();

router.get('/', listReports);
router.post('/', createReport);
router.get('/department/attendance/export', exportDepartmentAttendance);
router.get('/:id', getReport);
router.put('/:id', updateReport);
router.delete('/:id', deleteReport);

export default router;
