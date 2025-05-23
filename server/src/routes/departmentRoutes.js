import { Router } from 'express';
import {
  listDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment
} from '../controllers/departmentController.js';

const router = Router();
// 可以在查詢字串帶入 ?organization=<id> 以篩選指定機構的部門
router.get('/', listDepartments);
router.post('/', createDepartment);
router.put('/:id', updateDepartment);
router.delete('/:id', deleteDepartment);

export default router;
