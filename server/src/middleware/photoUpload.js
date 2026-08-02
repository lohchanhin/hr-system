import {
  EMPLOYEE_PHOTO_MAX_SIZE,
  EmployeePhotoValidationError,
  detectEmployeePhotoFormat,
  isManagedEmployeePhotoPath,
  storeEmployeePhoto,
} from '../services/employeePhotoStorage.js'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_BASE64_LENGTH = Math.ceil(EMPLOYEE_PHOTO_MAX_SIZE / 3) * 4

function getPhotoSource(body = {}) {
  if (body.photo || body.photoData) return body.photo || body.photoData
  if (Array.isArray(body.photoList) && body.photoList.length) {
    const first = body.photoList[0]
    return typeof first === 'object' ? first.url || first.path : first
  }
  return null
}

function decodeBase64Photo(photoSource) {
  if (photoSource.startsWith('blob:')) {
    throw new EmployeePhotoValidationError('無法處理 blob URL，請重新選擇圖片上傳')
  }

  if (photoSource.startsWith('data:image/')) {
    const header = photoSource.match(/^data:([^;]+);base64,/)
    if (!header || !ALLOWED_MIME_TYPES.includes(header[1])) {
      throw new EmployeePhotoValidationError('不支援的圖片格式，僅支援 JPEG、PNG、GIF、WebP')
    }
    const encoded = photoSource.slice(header[0].length)
    if (encoded.length > MAX_BASE64_LENGTH) {
      throw new EmployeePhotoValidationError('圖片檔案過大，最大 5MB')
    }
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(encoded)) {
      throw new EmployeePhotoValidationError('無效的 base64 格式')
    }
    return { buffer: Buffer.from(encoded, 'base64'), declaredMimeType: header[1] }
  }

  if (photoSource.length > MAX_BASE64_LENGTH) {
    throw new EmployeePhotoValidationError('圖片檔案過大，最大 5MB')
  }
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(photoSource)) {
    throw new EmployeePhotoValidationError('無效的 base64 格式')
  }
  return { buffer: Buffer.from(photoSource, 'base64'), declaredMimeType: undefined }
}

export default async function photoUploadMiddleware(req, res, next) {
  try {
    const photoSource = getPhotoSource(req.body)
    if (!photoSource) return next()
    if (typeof photoSource !== 'string') {
      throw new EmployeePhotoValidationError('無效的圖片資料')
    }

    if (photoSource.startsWith('/upload/')) {
      if (!isManagedEmployeePhotoPath(photoSource)) {
        throw new EmployeePhotoValidationError('無效的員工照片路徑')
      }
      req.body.photo = photoSource
      return next()
    }

    const { buffer, declaredMimeType } = decodeBase64Photo(photoSource)
    if (buffer.length > EMPLOYEE_PHOTO_MAX_SIZE) {
      throw new EmployeePhotoValidationError('圖片檔案過大，最大 5MB')
    }
    const format = detectEmployeePhotoFormat(buffer)
    if (!format) {
      throw new EmployeePhotoValidationError('無效的圖片數據，僅支援 JPEG、PNG、GIF、WebP')
    }

    const stored = await storeEmployeePhoto(buffer, { declaredMimeType })
    req.body.photo = stored.storedPath
    req.uploadedPhotoPath = stored.storedPath
    next()
  } catch (error) {
    if (error instanceof EmployeePhotoValidationError) {
      return res.status(error.status).json({ error: error.message })
    }
    console.error('Photo upload error:', error)
    res.status(500).json({ error: '圖片上傳失敗' })
  }
}
