import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 專案根目錄的 upload 資料夾
const UPLOAD_DIR = path.join(__dirname, '../../../upload')

// 支援的圖片格式
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20MB

// 配置 multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR)
  },
  filename: function (req, file, cb) {
    // 生成唯一的檔案名稱
    const timestamp = Date.now()
    const randomBytes = crypto.randomBytes(4).toString('hex')
    const ext = path.extname(file.originalname)
    const filename = `employee_${timestamp}_${randomBytes}${ext}`
    cb(null, filename)
  }
})

// 檔案過濾器
const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true)
  } else {
    cb(new Error('不支援的圖片格式，僅支援 JPEG, PNG, GIF, WebP'), false)
  }
}

// 創建 multer 實例
const upload = multer({
  storage: storage,
  limits: {
    fileSize: MAX_FILE_SIZE
  },
  fileFilter: fileFilter
})

// 單一照片上傳中間件
export const uploadSingle = upload.single('photo')

// 錯誤處理中間件
export function handleMulterError(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '圖片檔案過大，最大 5MB' })
    }
    return res.status(400).json({ error: err.message })
  } else if (err) {
    return res.status(400).json({ error: err.message })
  }
  next()
}

// 處理上傳後的檔案路徑，並支持舊的 base64 格式以保持向後兼容
export async function processUploadedPhoto(req, res, next) {
  // 如果有上傳檔案（新的 multipart 方式），將路徑設置到 req.body.photo
  if (req.file) {
    req.body.photo = `/upload/${req.file.filename}`
    
    // 解析 FormData 中的 JSON 字串欄位
    // 因為前端會將物件轉成 JSON 字串放入 FormData
    Object.keys(req.body).forEach(key => {
      const value = req.body[key]
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          req.body[key] = JSON.parse(value)
        } catch (e) {
          // 如果解析失敗，保持原值
        }
      }
    })
    
    return next()
  }
  
  // 如果沒有上傳檔案，但有 base64 數據（舊方式），使用舊的 photoUpload 邏輯
  // 這保證了向後兼容性
  const { default: photoUploadMiddleware } = await import('./photoUpload.js')
  return photoUploadMiddleware(req, res, next)
}

export default upload
