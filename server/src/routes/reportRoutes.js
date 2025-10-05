import { Router } from 'express';
import {
  listReports,
  createReport,
  getReport,
  updateReport,
  deleteReport,
  exportDepartmentAttendance,
  exportDepartmentLeave,
  exportDepartmentTardiness,
  exportDepartmentEarlyLeave,
  exportDepartmentWorkHours,
  exportDepartmentOvertime,
  exportDepartmentCompTime,
  exportDepartmentMakeUp,
  exportDepartmentSpecialLeave,
} from '../controllers/reportController.js';
import { authorizeRoles } from '../middleware/auth.js';

const router = Router();

router.get('/', listReports);
router.post('/', createReport);
const departmentReportGuard = authorizeRoles('supervisor', 'admin');

router.get('/department/attendance/export', departmentReportGuard, exportDepartmentAttendance);
router.get('/department/leave/export', departmentReportGuard, exportDepartmentLeave);
router.get('/department/tardiness/export', departmentReportGuard, exportDepartmentTardiness);
router.get('/department/early-leave/export', departmentReportGuard, exportDepartmentEarlyLeave);
router.get('/department/work-hours/export', departmentReportGuard, exportDepartmentWorkHours);
router.get('/department/overtime/export', departmentReportGuard, exportDepartmentOvertime);
router.get('/department/comp-time/export', departmentReportGuard, exportDepartmentCompTime);
router.get('/department/make-up/export', departmentReportGuard, exportDepartmentMakeUp);
router.get('/department/special-leave/export', departmentReportGuard, exportDepartmentSpecialLeave);
router.get('/:id', getReport);
router.put('/:id', updateReport);
router.delete('/:id', deleteReport);

export default router;
