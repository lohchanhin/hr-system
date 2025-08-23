import { Router } from 'express';
import { authorizeRoles } from '../middleware/auth.js';
import {
  listSubDepartments,
  createSubDepartment,
  updateSubDepartment,
  deleteSubDepartment
} from '../controllers/subDepartmentController.js';

const router = Router();

router.get('/', authorizeRoles('admin', 'supervisor'), listSubDepartments);
router.post('/', authorizeRoles('admin'), createSubDepartment);
router.put('/:id', authorizeRoles('admin'), updateSubDepartment);
router.delete('/:id', authorizeRoles('admin'), deleteSubDepartment);

export default router;
