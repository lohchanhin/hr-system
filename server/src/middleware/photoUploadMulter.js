import multer from 'multer'
import {
  EMPLOYEE_PHOTO_FORMAT_MESSAGE,
  EMPLOYEE_PHOTO_HEIF_MESSAGE,
  EMPLOYEE_PHOTO_MAX_SIZE,
  EmployeePhotoStorageError,
  EmployeePhotoValidationError,
  storeEmployeePhoto,
} from '../services/employeePhotoStorage.js'

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
// 部分瀏覽器／系統會用別名或空白型別回報（舊版 Edge 的 image/pjpeg、.jfif 檔…）。
// 檔案內容一律另外用檔頭特徵碼驗證並以驗出的型別存檔，所以宣告的型別只是參考，不是信任的依據。
const MIME_TYPE_ALIASES = new Map([
  ['image/jpg', 'image/jpeg'],
  ['image/pjpeg', 'image/jpeg'],
  ['image/x-png', 'image/png'],
])
const UNDECLARED_MIME_TYPES = new Set(['', 'application/octet-stream'])
const HEIF_MIME_TYPES = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])
const HEIF_FILENAME = /\.hei[cf]$/i

// 前端把整份員工資料放在這一個欄位（JSON 字串）：數字與布林值不會被 multipart 變成字串，
// 欄位數也不會因為員工資料越填越多而碰到上限
export const EMPLOYEE_DATA_FIELD = 'data'
// 舊版前端把每個欄位各自放一個 multipart 欄位，布林值會變成 'true'／'false' 字串
const BOOLEAN_FIELDS = ['accountEnabled', 'isPartTime', 'isClocking', 'partTime', 'needClockIn', 'requiresScheduling']
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const FORM_FALLBACK_MESSAGE = '上傳的資料格式不正確，請重新整理頁面後再試'
const FORM_TOO_MANY_FIELDS_MESSAGE = '表單欄位過多，請重新整理頁面後再試'
const FORM_BAD_FIELD_NAME_MESSAGE = '表單欄位名稱不正確，請重新整理頁面後再試'
const MULTER_ERROR_MESSAGES = {
  LIMIT_FILE_SIZE: '圖片檔案過大，最大 5MB',
  LIMIT_FILE_COUNT: '一次只能上傳一張照片',
  LIMIT_UNEXPECTED_FILE: '上傳的檔案欄位不正確，一次只能上傳一張照片',
  LIMIT_PART_COUNT: FORM_TOO_MANY_FIELDS_MESSAGE,
  LIMIT_FIELD_COUNT: FORM_TOO_MANY_FIELDS_MESSAGE,
  LIMIT_FIELD_VALUE: '員工資料過大（證照或教育訓練的附件總量太大），請移除部分附件後再試',
  LIMIT_FIELD_KEY: FORM_BAD_FIELD_NAME_MESSAGE,
  MISSING_FIELD_NAME: FORM_BAD_FIELD_NAME_MESSAGE,
  INVALID_FIELD_NAME: FORM_BAD_FIELD_NAME_MESSAGE,
  LIMIT_FIELD_NESTING: FORM_BAD_FIELD_NAME_MESSAGE,
  LIMIT_FIELD_ARRAY_INDEX: FORM_BAD_FIELD_NAME_MESSAGE,
}

// 帶照片的存檔把整份員工資料放進一個 data 欄位：上限要和沒有照片時的 JSON 一樣（JSON_BODY_LIMIT，預設 2mb），
// 否則有證照掃描檔的員工只有「加照片」會存不了
function parseByteSize(value, fallback) {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(String(value ?? '').trim())
  if (!match) return fallback
  const unit = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 }[(match[2] || 'b').toLowerCase()]
  return Math.max(1, Math.floor(Number(match[1]) * unit))
}
const DATA_FIELD_MAX_BYTES = Math.max(1024 * 1024, parseByteSize(process.env.JSON_BODY_LIMIT || '2mb', 2 * 1024 * 1024))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: EMPLOYEE_PHOTO_MAX_SIZE,
    files: 1,
    // 一份員工資料即使每個欄位各佔一個欄位也有一百多個（證照、訓練、緊急聯絡人…），
    // 上限留足餘裕；正常情況只會有 data 與 photo 兩個
    fields: 300,
    parts: 302,
    fieldNameSize: 100,
    fieldSize: DATA_FIELD_MAX_BYTES,
    headerPairs: 100,
  },
  fileFilter: (_req, file, callback) => {
    const mimeType = String(file.mimetype || '').toLowerCase()
    const isUndeclared = UNDECLARED_MIME_TYPES.has(mimeType)
    if (HEIF_MIME_TYPES.has(mimeType) || (isUndeclared && HEIF_FILENAME.test(file.originalname || ''))) {
      callback(new EmployeePhotoValidationError(EMPLOYEE_PHOTO_HEIF_MESSAGE))
      return
    }
    if (!ALLOWED_MIME_TYPES.includes(mimeType) && !MIME_TYPE_ALIASES.has(mimeType) && !isUndeclared) {
      callback(new EmployeePhotoValidationError(EMPLOYEE_PHOTO_FORMAT_MESSAGE))
      return
    }
    callback(null, true)
  },
})

export const uploadSingle = upload.single('photo')

export function handleMulterError(error, _req, res, next) {
  if (!error) return next()
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: MULTER_ERROR_MESSAGES[error.code] || FORM_FALLBACK_MESSAGE })
  }
  if (error instanceof EmployeePhotoValidationError || error instanceof EmployeePhotoStorageError) {
    return res.status(error.status).json({ error: error.message })
  }
  // 表單被截斷、邊界格式錯誤等解析錯誤的訊息是英文；只有我們自己丟出的中文訊息才原樣回給使用者
  console.warn('Employee upload parse failed', { error: error?.name ?? 'Error', code: error?.code })
  const message = /[一-鿿]/.test(String(error.message)) ? error.message : FORM_FALLBACK_MESSAGE
  return res.status(400).json({ error: message })
}

function isMultipartRequest(req) {
  if (req.file) return true
  return typeof req.is === 'function' && Boolean(req.is('multipart/form-data'))
}

function resolveDeclaredMimeType(mimeType) {
  const normalized = String(mimeType || '').toLowerCase()
  if (UNDECLARED_MIME_TYPES.has(normalized)) return undefined
  return MIME_TYPE_ALIASES.get(normalized) ?? normalized
}

// 取出 data 欄位（JSON 字串）；沒有這個欄位時回傳 null
function takeJsonDataPart(body) {
  const raw = body[EMPLOYEE_DATA_FIELD]
  if (typeof raw !== 'string') return null
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    // 下面統一回報格式錯誤
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EmployeePhotoValidationError('表單資料格式不正確，請重新整理頁面後再試')
  }
  delete body[EMPLOYEE_DATA_FIELD]
  return parsed
}

function coerceBooleanStrings(body) {
  for (const key of BOOLEAN_FIELDS) {
    if (typeof body[key] !== 'string') continue
    const text = body[key].trim().toLowerCase()
    if (text === 'true') body[key] = true
    else if (text === 'false') body[key] = false
  }
}

export async function processUploadedPhoto(req, res, next) {
  try {
    if (!req.body) req.body = {}
    // 純 JSON 請求本來就有正確的型別，不看 data 欄位（它只是 multipart 表單用來裝整份資料的欄位）
    const multipart = isMultipartRequest(req)
    const dataPart = multipart ? takeJsonDataPart(req.body) : null

    for (const key of Object.keys(req.body)) {
      const value = req.body[key]
      if (typeof value === 'string' && (value.startsWith('{') || value.startsWith('['))) {
        try {
          req.body[key] = JSON.parse(value)
        } catch {
          // Keep ordinary strings that only happen to start with a bracket.
        }
      }
    }
    // 只轉換各自獨立的文字欄位；data 裡的值已經有正確的型別，原樣採用（型別不對的照舊交給後面的驗證擋下）
    if (multipart) coerceBooleanStrings(req.body)
    if (dataPart) {
      for (const [key, value] of Object.entries(dataPart)) {
        if (!UNSAFE_KEYS.has(key)) req.body[key] = value
      }
    }

    if (req.file) {
      // 瀏覽器的 File.type 是依副檔名猜的（網路下載的 WebP 存成 .jpg 很常見），內容以檔案開頭的特徵判斷，
      // 存檔副檔名與回傳的 Content-Type 都以判斷結果為準，所以不再因為宣告格式不同而拒絕真的圖片
      const stored = await storeEmployeePhoto(req.file.buffer)
      req.body.photo = stored.storedPath
      req.uploadedPhotoPath = stored.storedPath
      return next()
    }

    const { default: photoUploadMiddleware } = await import('./photoUpload.js')
    return photoUploadMiddleware(req, res, next)
  } catch (error) {
    if (error instanceof EmployeePhotoValidationError || error instanceof EmployeePhotoStorageError) {
      return res.status(error.status).json({ error: error.message })
    }
    next(error)
  }
}

export default upload
