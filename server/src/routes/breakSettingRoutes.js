import { Router } from 'express';
import {
  listSettings,
  createSetting,
  getSetting,
  updateSetting,
  deleteSetting,
  getSettingForDepartment,
  getSettingForSubDepartment
} from '../controllers/breakSettingController.js';

const router = Router();

router.get('/department/:departmentId', getSettingForDepartment);
router.get('/sub-department/:subDepartmentId', getSettingForSubDepartment);
router.get('/', listSettings);
router.post('/', createSetting);
router.get('/:id', getSetting);
router.put('/:id', updateSetting);
router.delete('/:id', deleteSetting);

export default router;
