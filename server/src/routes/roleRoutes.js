import { Router } from 'express'
import { listRoles } from '../controllers/roleController.js'

const router = Router()

router.get('/', listRoles)

export default router
