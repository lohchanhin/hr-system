import { Router } from 'express';
import { listEmployees, createEmployee } from '../controllers/employeeController.js';

const router = Router();

router.get('/', listEmployees);
router.post('/', createEmployee);

export default router;
