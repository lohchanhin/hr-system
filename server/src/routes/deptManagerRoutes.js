import { Router } from 'express';
import { listDeptManagers } from '../controllers/deptManagerController.js';

const router = Router();

// 取得排班管理者／排班人員的選單（任何角色的員工都可以擔任）
router.get('/', listDeptManagers);

export default router;
