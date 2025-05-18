import { Router } from 'express'
import { listLeaveRequests, createLeaveRequest } from '../controllers/leaveController.js'

const router = Router()

router.get('/', listLeaveRequests)
router.post('/', createLeaveRequest)

export default router
