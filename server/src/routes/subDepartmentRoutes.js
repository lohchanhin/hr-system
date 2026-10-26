import { Router } from 'express';
import { authorizeRoles } from '../middleware/auth.js';
import { requireScheduleAccess } from '../middleware/scheduleAccess.js';
import {
  listSubDepartments,
  createSubDepartment,
  updateSubDepartment,
  deleteSubDepartment
} from '../controllers/subDepartmentController.js';

const router = Router();

// 清單：管理員、主管，以及被指定為排班人員的員工（排班頁的單位篩選）
router.get('/', requireScheduleAccess({ allowRoles: ['admin', 'supervisor'] }), listSubDepartments);
router.post('/', authorizeRoles('admin'), createSubDepartment);
router.put('/:id', authorizeRoles('admin'), updateSubDepartment);
router.delete('/:id', authorizeRoles('admin'), deleteSubDepartment);

export default router;
