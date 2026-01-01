import { Router } from 'express';
import {
  listEmployees,
  listEmployeeOptions,
  createEmployee,
  getEmployee,
  updateEmployee,
  deleteEmployee,
  setSupervisors,
  getEmployeeAnnualLeave,
  getEmployeeAnnualLeaveHistory,
  setEmployeeAnnualLeave,
  validateEmployeeAnnualLeave
} from '../controllers/employeeController.js';
import { bulkImportEmployees } from '../controllers/employeeBulkImportController.js';
import uploadMiddleware from '../middleware/upload.js';
import validateBulkImportPayload from '../middleware/validateBulkImportPayload.js';

const router = Router();

router.get('/', listEmployees);
router.get('/options', listEmployeeOptions);
router.post('/', createEmployee);
router.post('/bulk-import', uploadMiddleware, validateBulkImportPayload, bulkImportEmployees);
router.post('/import', uploadMiddleware, validateBulkImportPayload, bulkImportEmployees);
router.post('/set-supervisors', setSupervisors);

// 特休管理路由
router.get('/:id/annual-leave', getEmployeeAnnualLeave);
router.get('/:id/annual-leave/history', getEmployeeAnnualLeaveHistory);
router.patch('/:id/annual-leave', setEmployeeAnnualLeave);
router.post('/:id/annual-leave/validate', validateEmployeeAnnualLeave);

router.get('/:id', getEmployee);
router.put('/:id', updateEmployee);
router.delete('/:id', deleteEmployee);

export default router;
