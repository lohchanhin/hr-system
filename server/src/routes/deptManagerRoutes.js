import { Router } from 'express';
import { listDeptManagers } from '../controllers/deptManagerController.js';

const router = Router();

// 取得部門管理者列表
router.get('/', listDeptManagers);

export default router;
