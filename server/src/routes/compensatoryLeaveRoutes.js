import { Router } from 'express';
import {
  createCompensatoryAdjustment,
  createCompensatoryCredit,
  getEmployeeCompensatoryLeave,
  getMyCompensatoryLeave,
  updateCompensatoryNote,
  voidCompensatoryCredit,
} from '../controllers/compensatoryLeaveController.js';
import { authorizeRoles } from '../middleware/auth.js';

const router = Router();

// 查詢開放給員工（自己）、主管（直屬部屬）、管理員；手動給予、扣除、作廢、存摺備註只有管理員，不論這個 router 掛在哪個路徑下。
const adminOnly = authorizeRoles('admin');

router.get('/mine', getMyCompensatoryLeave);
router.get('/', getEmployeeCompensatoryLeave);
router.post('/credits', adminOnly, createCompensatoryCredit);
router.post('/credits/:id/void', adminOnly, voidCompensatoryCredit);
router.post('/adjustments', adminOnly, createCompensatoryAdjustment);
router.put('/note', adminOnly, updateCompensatoryNote);

export default router;
