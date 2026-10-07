import { Router } from 'express';
import {
  listEmployees,
  listEmployeesSchedule,
  listEmployeeOptions,
  listAttendanceImportEmployeeOptions,
  createEmployee,
  getEmployee,
  getEmployeePhoto,
  updateEmployee,
  deleteEmployee,
  bulkDeleteEmployees,
  setSupervisors,
  getEmployeeAnnualLeave,
  getEmployeeAnnualLeaveHistory,
  setEmployeeAnnualLeave,
  validateEmployeeAnnualLeave
} from '../controllers/employeeController.js';
import { authorizeRoles } from '../middleware/auth.js';
import { bulkImportEmployees } from '../controllers/employeeBulkImportController.js';
import uploadMiddleware from '../middleware/upload.js';
import photoUploadMiddleware from '../middleware/photoUpload.js';
import { uploadSingle, handleMulterError, processUploadedPhoto } from '../middleware/photoUploadMulter.js';
import validateBulkImportPayload from '../middleware/validateBulkImportPayload.js';

const router = Router();

router.get('/', listEmployees);
router.get('/schedule', listEmployeesSchedule);
router.get('/options', listEmployeeOptions);
router.get('/attendance-import-options', authorizeRoles('admin'), listAttendanceImportEmployeeOptions);
router.post('/', uploadSingle, handleMulterError, processUploadedPhoto, createEmployee);
router.post('/bulk-import', uploadMiddleware, validateBulkImportPayload, bulkImportEmployees);
router.post('/import', uploadMiddleware, validateBulkImportPayload, bulkImportEmployees);
router.post('/set-supervisors', setSupervisors);
// 固定路徑的批量刪除必須註冊在所有 '/:id' 路由之前，避免被動態路由攔截
router.post('/bulk-delete', bulkDeleteEmployees);

// 特休管理路由
router.get('/:id/annual-leave', getEmployeeAnnualLeave);
router.get('/:id/annual-leave/history', getEmployeeAnnualLeaveHistory);
router.patch('/:id/annual-leave', setEmployeeAnnualLeave);
router.post('/:id/annual-leave/validate', validateEmployeeAnnualLeave);

router.get('/:id/photo', getEmployeePhoto);
router.get('/:id', getEmployee);
router.put('/:id', uploadSingle, handleMulterError, processUploadedPhoto, updateEmployee);
router.delete('/:id', deleteEmployee);

export default router;
