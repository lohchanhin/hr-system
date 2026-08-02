import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const EMPLOYEE_PHOTO_MAX_SIZE = 5 * 1024 * 1024
export const UPLOAD_ROOT = path.resolve(__dirname, '../../../upload')
export const EMPLOYEE_PHOTO_DIR = path.join(UPLOAD_ROOT, 'employees')

export class EmployeePhotoValidationError extends Error {
  constructor(message) {
    super(message)
    this.name = 'EmployeePhotoValidationError'
    this.status = 400
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

  const format = detectEmployeePhotoFormat(buffer)
  if (!format) {
    throw new EmployeePhotoValidationError('無效的圖片數據，僅支援 JPEG、PNG、GIF、WebP')
  }
  if (declaredMimeType && declaredMimeType !== format.mimeType) {
    throw new EmployeePhotoValidationError('圖片內容與宣告格式不一致')
  }

  await fs.mkdir(EMPLOYEE_PHOTO_DIR, { recursive: true })
  const filename = `employee_${crypto.randomUUID()}.${format.extension}`
  const absolutePath = path.join(EMPLOYEE_PHOTO_DIR, filename)
  await fs.writeFile(absolutePath, buffer, { flag: 'wx', mode: 0o600 })

  return {
    absolutePath,
    mimeType: format.mimeType,
    storedPath: `/upload/employees/${filename}`,
  }
}

export async function readEmployeePhoto(storedPath) {
  const absolutePath = resolveEmployeePhotoPath(storedPath)
  if (!absolutePath) return null

  try {
    const stat = await fs.stat(absolutePath)
    if (!stat.isFile() || stat.size <= 0 || stat.size > EMPLOYEE_PHOTO_MAX_SIZE) return null
    const buffer = await fs.readFile(absolutePath)
    const format = detectEmployeePhotoFormat(buffer)
    if (!format) return null
    return { buffer, mimeType: format.mimeType }
  } catch (error) {
    if (error?.code === 'ENOENT') return null
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
