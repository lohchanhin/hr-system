import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const EMPLOYEE_PHOTO_MAX_SIZE = 5 * 1024 * 1024
// 讀取上限比上傳上限寬：舊版曾允許上傳到 20MB，那段期間存的照片不能因為新規則就變成讀不到
export const EMPLOYEE_PHOTO_MAX_READ_SIZE = 20 * 1024 * 1024
export const UPLOAD_ROOT = path.resolve(__dirname, '../../../upload')
export const EMPLOYEE_PHOTO_DIR = path.join(UPLOAD_ROOT, 'employees')

export const EMPLOYEE_PHOTO_FORMAT_MESSAGE = '不支援的圖片格式，僅支援 JPEG、PNG、GIF、WebP'
export const EMPLOYEE_PHOTO_HEIF_MESSAGE = '不支援 HEIC／HEIF 格式（iPhone 預設的照片格式），瀏覽器無法顯示，請改用 JPG 或 PNG 圖片'

export class EmployeePhotoValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EmployeePhotoValidationError'
    this.status = 400
  }
}

// 伺服器端寫檔失敗（資料夾沒有寫入權限、磁碟已滿…）：不是使用者的錯，訊息請他們找系統管理員
export class EmployeePhotoStorageError extends Error {
  constructor(message = '照片儲存失敗，請聯絡系統管理員') {
    super(message)
    this.name = 'EmployeePhotoStorageError'
    this.status = 500
  }
}

export function detectEmployeePhotoFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { extension: 'jpg', mimeType: 'image/jpeg' }
  }
  if (
    buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47 &&
    buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a
  ) {
    return { extension: 'png', mimeType: 'image/png' }
  }
  if (
    buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38 &&
    (buffer[4] === 0x37 || buffer[4] === 0x39) && buffer[5] === 0x61
  ) {
    return { extension: 'gif', mimeType: 'image/gif' }
  }
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return { extension: 'webp', mimeType: 'image/webp' }
  }
  return null
}

// HEIC／HEIF 是 ISO 媒體檔：第 4～7 個位元組是 'ftyp'，接著是 4 個字元的品牌（iPhone 照片多半是 heic）
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'])

export function isHeifPhoto(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false
  if (buffer.toString('latin1', 4, 8) !== 'ftyp') return false
  return HEIF_BRANDS.has(buffer.toString('latin1', 8, 12).toLowerCase())
}

// 舊資料可能存成完整網址（http://主機/upload/...）；對應到本機檔案時只看路徑部分
export function normalizeStoredPhotoPath(storedPath) {
  if (typeof storedPath !== 'string') return ''
  const value = storedPath.trim()
  if (!/^https?:\/\//i.test(value)) return value
  try {
    return new URL(value).pathname
  } catch {
    return ''
  }
}

export function resolveEmployeePhotoPath(storedPath) {
  if (typeof storedPath !== 'string' || !storedPath.startsWith('/upload/')) return null

  const relativePath = storedPath.slice('/upload/'.length).replaceAll('/', path.sep)
  const normalizedRelativePath = path.normalize(relativePath)
  const isPrivatePhoto = normalizedRelativePath.startsWith(`employees${path.sep}employee_`)
  const isLegacyPhoto = !normalizedRelativePath.includes(path.sep) && normalizedRelativePath.startsWith('employee_')
  if (!isPrivatePhoto && !isLegacyPhoto) return null

  const absolutePath = path.resolve(UPLOAD_ROOT, normalizedRelativePath)
  const uploadPrefix = `${UPLOAD_ROOT}${path.sep}`
  if (!absolutePath.startsWith(uploadPrefix)) return null
  return absolutePath
}

export function isManagedEmployeePhotoPath(storedPath) {
  return Boolean(resolveEmployeePhotoPath(storedPath))
}

export async function storeEmployeePhoto(buffer, { declaredMimeType } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new EmployeePhotoValidationError('無效的圖片資料')
  }
  if (buffer.length > EMPLOYEE_PHOTO_MAX_SIZE) {
    throw new EmployeePhotoValidationError('圖片檔案過大，最大 5MB')
  }

  if (isHeifPhoto(buffer)) {
    throw new EmployeePhotoValidationError(EMPLOYEE_PHOTO_HEIF_MESSAGE)
  }
  const format = detectEmployeePhotoFormat(buffer)
  if (!format) {
    throw new EmployeePhotoValidationError('無效的圖片數據，僅支援 JPEG、PNG、GIF、WebP')
  }
  if (declaredMimeType && declaredMimeType !== format.mimeType) {
    throw new EmployeePhotoValidationError('圖片內容與宣告格式不一致')
  }

  const filename = `employee_${crypto.randomUUID()}.${format.extension}`
  const absolutePath = path.join(EMPLOYEE_PHOTO_DIR, filename)
  try {
    await fs.mkdir(EMPLOYEE_PHOTO_DIR, { recursive: true })
    await fs.writeFile(absolutePath, buffer, { flag: 'wx', mode: 0o600 })
  } catch (error) {
    // 通用的 500 處理只會記錄錯誤名稱，看不出是權限（EACCES）還是磁碟已滿（ENOSPC），所以在這裡把錯誤代碼記下來
    console.error('Employee photo storage failed', { operation: 'write', code: error?.code ?? error?.name ?? 'Error' })
    throw new EmployeePhotoStorageError()
  }

  return {
    absolutePath,
    mimeType: format.mimeType,
    storedPath: `/upload/employees/${filename}`,
  }
}

/**
 * 讀取前先看檔案狀態：回傳大小與 ETag，檔案不存在或不是可讀的照片檔時回傳 null。
 * ETag 由路徑、大小、修改時間算出；每次上傳都是新的檔名，換照片時 ETag 一定會變。
 */
export async function statEmployeePhoto(storedPath) {
  const absolutePath = resolveEmployeePhotoPath(storedPath)
  if (!absolutePath) return null

  try {
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > EMPLOYEE_PHOTO_MAX_READ_SIZE) return null
    const digest = crypto
      .createHash('sha1')
      .update(`${storedPath}|${stat.size}|${Math.trunc(stat.mtimeMs)}`)
      .digest('hex')
      .slice(0, 24)
    return { size: stat.size, mtimeMs: stat.mtimeMs, etag: `"${digest}"` }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

export async function readEmployeePhoto(storedPath) {
  const absolutePath = resolveEmployeePhotoPath(storedPath)
  if (!absolutePath) return null

  try {
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > EMPLOYEE_PHOTO_MAX_READ_SIZE) return null
    const buffer = await fs.readFile(absolutePath)
    const format = detectEmployeePhotoFormat(buffer)
    if (!format) return null
    return { buffer, mimeType: format.mimeType }
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

export async function deleteEmployeePhoto(storedPath) {
  const absolutePath = resolveEmployeePhotoPath(storedPath)
  if (!absolutePath) return false
  try {
    await fs.unlink(absolutePath)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}
