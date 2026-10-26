import { Router } from 'express'
import {
  getOtherControlSettings,
  updateNotificationSettings,
  updateSecuritySettings,
  updateIntegrationSettings,
  replaceCustomFields,
  getItemSettings,
  updateItemSettings,
  listFormCategories,
  createFormCategory,
  updateFormCategory,
  deleteFormCategory
} from '../controllers/otherControlSettingController.js'
import { getLeavePolicySettings, updateLeavePolicySettings } from '../controllers/leavePolicyController.js'
import { getScheduleAccessSetting, updateScheduleAccessSetting } from '../controllers/scheduleAccessSettingController.js'

const router = Router()

router.get('/', getOtherControlSettings)
router.put('/notification', updateNotificationSettings)
router.put('/security', updateSecuritySettings)
router.put('/integration', updateIntegrationSettings)
router.put('/custom-fields', replaceCustomFields)
router.get('/item-settings', getItemSettings)
router.put('/item-settings', updateItemSettings)
router.get('/form-categories', listFormCategories)
router.post('/form-categories', createFormCategory)
router.put('/form-categories/:id', updateFormCategory)
router.delete('/form-categories/:id', deleteFormCategory)
// 假別額度規則（請假與加班設定）：額度、超額處理、顯示方式；沒有儲存過就用法定預設值
router.get('/leave-policy', getLeavePolicySettings)
router.put('/leave-policy', updateLeavePolicySettings)
// 排班權限模式：supervisor_and_scheduler（預設：主管與排班人員都能排班）／scheduler_only（只有被指定的排班人員）
router.get('/schedule-access', getScheduleAccessSetting)
router.put('/schedule-access', updateScheduleAccessSetting)

export default router
