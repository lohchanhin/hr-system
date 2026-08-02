import multer from 'multer'
import {
  EMPLOYEE_PHOTO_MAX_SIZE,
  EmployeePhotoValidationError,
  storeEmployeePhoto,
} from '../services/employeePhotoStorage.js'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: EMPLOYEE_PHOTO_MAX_SIZE, files: 1 },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      callback(new EmployeePhotoValidationError('不支援的圖片格式，僅支援 JPEG、PNG、GIF、WebP'))
      return
    }
    callback(null, true)
  },
})

export const uploadSingle = upload.single('photo')

export function handleMulterError(error, _req, res, next) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: '圖片檔案過大，最大 5MB' })
    }
    return res.status(400).json({ error: error.message })
  }
  if (error instanceof EmployeePhotoValidationError) {
    return res.status(error.status).json({ error: error.message })
  }
  if (error) return res.status(400).json({ error: error.message })
  next()
}

export async function processUploadedPhoto(req, res, next) {
  try {
    for (const key of Object.keys(req.body || {})) {
      const value = req.body[key]
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          req.body[key] = JSON.parse(value)
        } catch {
          // Keep ordinary strings that only happen to start with a bracket.
        }
      }
    }

    if (req.file) {
      const stored = await storeEmployeePhoto(req.file.buffer, {
        declaredMimeType: req.file.mimetype,
      })
      req.body.photo = stored.storedPath
      req.uploadedPhotoPath = stored.storedPath
      return next()
    }

    const { default: photoUploadMiddleware } = await import('./photoUpload.js')
    return photoUploadMiddleware(req, res, next)
  } catch (error) {
    if (error instanceof EmployeePhotoValidationError) {
      return res.status(error.status).json({ error: error.message })
    }
    next(error)
  }
}

export default upload
