import { Router } from 'express';
import {
  exportDepartmentAttendance,
  exportDepartmentLeave,
  exportDepartmentTardiness,
  exportDepartmentEarlyLeave,
  exportDepartmentWorkHours,
  exportDepartmentOvertime,
  exportDepartmentCompTime,
  exportDepartmentMakeUp,
  exportDepartmentSpecialLeave,
  listSupervisorDepartmentReports,
} from '../controllers/reportController.js';
import { authorizeRoles } from '../middleware/auth.js';

const router = Router();

const departmentReportGuard = authorizeRoles('supervisor');

router.get('/department/templates', departmentReportGuard, listSupervisorDepartmentReports);
router.get('/department/attendance/export', departmentReportGuard, exportDepartmentAttendance);
router.get('/department/leave/export', departmentReportGuard, exportDepartmentLeave);
router.get('/department/tardiness/export', departmentReportGuard, exportDepartmentTardiness);
router.get('/department/early-leave/export', departmentReportGuard, exportDepartmentEarlyLeave);
router.get('/department/work-hours/export', departmentReportGuard, exportDepartmentWorkHours);
router.get('/department/overtime/export', departmentReportGuard, exportDepartmentOvertime);
router.get('/department/comp-time/export', departmentReportGuard, exportDepartmentCompTime);
router.get('/department/make-up/export', departmentReportGuard, exportDepartmentMakeUp);
router.get('/department/special-leave/export', departmentReportGuard, exportDepartmentSpecialLeave);

export default router;
