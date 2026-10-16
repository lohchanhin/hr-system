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

export default router
