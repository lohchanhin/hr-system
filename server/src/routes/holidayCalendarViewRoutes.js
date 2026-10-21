import { Router } from 'express';
import {
  getHolidayCalendarHeaders,
  getHolidayCalendarStatus,
} from '../controllers/holidayCalendarViewController.js';

// 唯讀：index.js 掛在 /api/holiday-calendar，已登入的員工、主管、管理員都可以讀
const router = Router();

router.get('/headers', getHolidayCalendarHeaders);
router.get('/status', getHolidayCalendarStatus);

export default router;
