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

export default router
