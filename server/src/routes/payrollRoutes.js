import { Router } from 'express';
import {
  listPayrolls,
  createPayroll,
  getPayroll,
  updatePayroll,
  deletePayroll
} from '../controllers/payrollController.js';

const router = Router();

router.get('/', listPayrolls);
router.post('/', createPayroll);
router.get('/:id', getPayroll);
router.put('/:id', updatePayroll);
router.delete('/:id', deletePayroll);

export default router;
