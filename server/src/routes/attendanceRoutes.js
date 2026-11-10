import { Router } from 'express'
import { listRecords, createRecord, getPunchWindowSetting } from '../controllers/attendanceController.js'
import { createUploadMiddleware } from '../middleware/upload.js'
import { authorizeRoles } from '../middleware/auth.js'
import { importAttendanceRecords } from '../controllers/attendanceImportController.js'

const router = Router()
// 考勤機與 Excel 另存的 CSV 常是 Big5：考勤匯入的控制器會自己解碼（attendanceImportController），上傳檢查也要放行
const uploadMiddleware = createUploadMiddleware({ allowBig5Csv: true })

router.get('/punch-window', getPunchWindowSetting)
router.get('/', listRecords)
router.post('/', createRecord)
router.post('/import', authorizeRoles('admin'), uploadMiddleware, importAttendanceRecords)

export default router
