import { Router } from 'express';
import {
  listHolidays,
  listHolidaysByMonth,
  createHoliday,
  updateHoliday,
  deleteHoliday,
  importRocHolidays
} from '../controllers/holidayController.js';
import { authorizeRoles } from '../middleware/auth.js';

const router = Router();

// 讀取（by-month、清單）開放給已登入使用者，排班頁面要用；
// 新增、修改、刪除、匯入只有管理員可以，不論這個 router 掛在哪個路徑下（含 /api/holidays-public）。
const adminOnly = authorizeRoles('admin');

router.post('/import/roc', adminOnly, importRocHolidays);
router.get('/by-month', listHolidaysByMonth);
router.get('/', listHolidays);
router.post('/', adminOnly, createHoliday);
router.put('/:id', adminOnly, updateHoliday);
router.delete('/:id', adminOnly, deleteHoliday);

export default router;
