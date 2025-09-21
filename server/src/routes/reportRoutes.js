import { Router } from 'express';
import {
  listReports,
  createReport,
  getReport,
  updateReport,
  deleteReport,
  exportDepartmentAttendance,
  exportDepartmentLeave
} from '../controllers/reportController.js';
import { authorizeRoles } from '../middleware/auth.js';

const router = Router();

router.get('/', listReports);
router.post('/', createReport);
router.get('/department/attendance/export', exportDepartmentAttendance);
router.get(
  '/department/leave/export',
  authorizeRoles('supervisor', 'admin'),
  exportDepartmentLeave
);
router.get('/:id', getReport);
router.put('/:id', updateReport);
router.delete('/:id', deleteReport);

export default router;
