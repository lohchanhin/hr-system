import { Router } from 'express'
import {
  getOtherControlSettings,
  updateNotificationSettings,
  updateSecuritySettings,
  updateIntegrationSettings,
  replaceCustomFields
} from '../controllers/otherControlSettingController.js'

const router = Router()

router.get('/', getOtherControlSettings)
router.put('/notification', updateNotificationSettings)
router.put('/security', updateSecuritySettings)
router.put('/integration', updateIntegrationSettings)
router.put('/custom-fields', replaceCustomFields)

export default router
