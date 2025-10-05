import { Router } from 'express';
import {
  listEmployees,
  listEmployeeOptions,
  createEmployee,
  getEmployee,
  updateEmployee,
  deleteEmployee,
  setSupervisors
} from '../controllers/employeeController.js';
import { bulkImportEmployees } from '../controllers/employeeBulkImportController.js';
import uploadMiddleware from '../middleware/upload.js';

const router = Router();

router.get('/', listEmployees);
router.get('/options', listEmployeeOptions);
router.post('/', createEmployee);
router.post('/bulk-import', uploadMiddleware, bulkImportEmployees);
router.post('/import', uploadMiddleware, bulkImportEmployees);
router.post('/set-supervisors', setSupervisors);
router.get('/:id', getEmployee);
router.put('/:id', updateEmployee);
router.delete('/:id', deleteEmployee);

export default router;
