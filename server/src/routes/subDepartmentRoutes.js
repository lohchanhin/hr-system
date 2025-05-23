import { Router } from 'express';
import {
  listSubDepartments,
  createSubDepartment,
  updateSubDepartment,
  deleteSubDepartment
} from '../controllers/subDepartmentController.js';

const router = Router();

router.get('/', listSubDepartments);
router.post('/', createSubDepartment);
router.put('/:id', updateSubDepartment);
router.delete('/:id', deleteSubDepartment);

export default router;
