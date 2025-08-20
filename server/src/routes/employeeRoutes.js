import { Router } from 'express';
import {
  listEmployees,
  listEmployeeOptions,
  createEmployee,
  getEmployee,
  updateEmployee,
  deleteEmployee
} from '../controllers/employeeController.js';

const router = Router();

router.get('/', listEmployees);
router.get('/options', listEmployeeOptions);
router.post('/', createEmployee);
router.get('/:id', getEmployee);
router.put('/:id', updateEmployee);
router.delete('/:id', deleteEmployee);

export default router;
