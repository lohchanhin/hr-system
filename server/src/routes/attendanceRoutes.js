import { Router } from 'express'
import { listRecords, createRecord } from '../controllers/attendanceController.js'
import uploadMiddleware from '../middleware/upload.js'
import { authorizeRoles } from '../middleware/auth.js'
import { importAttendanceRecords } from '../controllers/attendanceImportController.js'

const router = Router()

router.get('/', listRecords)
router.post('/', createRecord)
router.post('/import', authorizeRoles('admin'), uploadMiddleware, importAttendanceRecords)

export default router
