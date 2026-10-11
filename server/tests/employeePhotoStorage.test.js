import { afterEach, describe, expect, it, jest } from '@jest/globals'
import fs from 'fs/promises'
import path from 'path'
import privateUploadGuard from '../src/middleware/privateUploadGuard.js'
import {
  EMPLOYEE_PHOTO_HEIF_MESSAGE,
  EMPLOYEE_PHOTO_MAX_READ_SIZE,
  EMPLOYEE_PHOTO_MAX_SIZE,
  EmployeePhotoStorageError,
  EmployeePhotoValidationError,
  UPLOAD_ROOT,
  deleteEmployeePhoto,
  isHeifPhoto,
  normalizeStoredPhotoPath,
  readEmployeePhoto,
  resolveEmployeePhotoPath,
  statEmployeePhoto,
  storeEmployeePhoto,
} from '../src/services/employeePhotoStorage.js'

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const storedPaths = []

afterEach(async () => {
  await Promise.all(storedPaths.splice(0).map(path => deleteEmployeePhoto(path)))
})

describe('employee photo storage', () => {
  it('stores validated photos in the private employee directory', async () => {
    const stored = await storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' })
    storedPaths.push(stored.storedPath)

    expect(stored.storedPath).toMatch(/^\/upload\/employees\/employee_[a-f0-9-]+\.png$/)
    const loaded = await readEmployeePhoto(stored.storedPath)
    expect(loaded?.mimeType).toBe('image/png')
    expect(loaded?.buffer).toEqual(PNG_1PX)
  })

  it('rejects a spoofed MIME type before writing a file', async () => {
    await expect(storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/jpeg' }))
      .rejects.toBeInstanceOf(EmployeePhotoValidationError)
  })

  it('rejects traversal and unrelated upload paths', () => {
    expect(resolveEmployeePhotoPath('/upload/employees/../../secret.txt')).toBeNull()
    expect(resolveEmployeePhotoPath('/upload/payroll.xlsx')).toBeNull()
    expect(resolveEmployeePhotoPath('https://example.com/photo.jpg')).toBeNull()
  })
})

describe('private upload guard', () => {
  const makeRes = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn() })

  it.each([
    '/employees/employee_test.png',
    '/employee_legacy.jpg',
    '/approvals/evidence.pdf',
  ])('blocks direct static access to %s', requestPath => {
    const res = makeRes()
    const next = jest.fn()

    privateUploadGuard({ path: requestPath }, res, next)

    expect(res.status).toHaveBeenCalledWith(404)
    expect(next).not.toHaveBeenCalled()
  })

  it('leaves unrelated public assets to the static middleware', () => {
    const res = makeRes()
    const next = jest.fn()

    privateUploadGuard({ path: '/public-logo.png' }, res, next)

    expect(next).toHaveBeenCalledTimes(1)
  })
})

/** 用 ISO 媒體檔的檔頭組出 HEIC／AVIF 之類的假檔案（只需要檔頭，不需要真的影像資料） */
function makeIsoMediaBuffer(brand) {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from(`ftyp${brand}`, 'latin1'), Buffer.alloc(32)])
}

const extraFiles = []

afterEach(async () => {
  jest.restoreAllMocks()
  await Promise.all(extraFiles.splice(0).map(filePath => fs.unlink(filePath).catch(() => {})))
})

/** 在 upload 根目錄放一個舊版命名（employee_*.png）的檔案；測試結束會自動刪除 */
async function writeLegacyPhoto(size) {
  const filename = `employee_test_${Date.now()}_${Math.random().toString(16).slice(2)}.png`
  const absolutePath = path.join(UPLOAD_ROOT, filename)
  const handle = await fs.open(absolutePath, 'wx', 0o600)
  extraFiles.push(absolutePath)
  try {
    await handle.write(PNG_1PX)
    await handle.truncate(size)
  } finally {
    await handle.close()
  }
  return `/upload/${filename}`
}

describe('employee photo storage: HEIC/HEIF', () => {
  it.each(['heic', 'heix', 'hevc', 'mif1', 'msf1', 'HEIC'])('recognises the %s brand', brand => {
    expect(isHeifPhoto(makeIsoMediaBuffer(brand))).toBe(true)
  })

  it('does not mistake ordinary images or other ISO media files for HEIF', () => {
    expect(isHeifPhoto(PNG_1PX)).toBe(false)
    expect(isHeifPhoto(makeIsoMediaBuffer('avif'))).toBe(false)
    expect(isHeifPhoto(makeIsoMediaBuffer('isom'))).toBe(false)
    expect(isHeifPhoto(Buffer.from('short'))).toBe(false)
    expect(isHeifPhoto(null)).toBe(false)
  })

  it('rejects a HEIC photo with a message that says to use JPG or PNG, whatever type it was declared as', async () => {
    for (const declaredMimeType of ['image/heic', 'image/jpeg', undefined]) {
      const error = await storeEmployeePhoto(makeIsoMediaBuffer('heic'), { declaredMimeType }).catch(e => e)
      expect(error).toBeInstanceOf(EmployeePhotoValidationError)
      expect(error.status).toBe(400)
      expect(error.message).toBe(EMPLOYEE_PHOTO_HEIF_MESSAGE)
    }
    expect(EMPLOYEE_PHOTO_HEIF_MESSAGE).toContain('HEIC')
    expect(EMPLOYEE_PHOTO_HEIF_MESSAGE).toContain('JPG')
    expect(EMPLOYEE_PHOTO_HEIF_MESSAGE).toContain('PNG')
  })

  it('still reports other unreadable formats with the generic message', async () => {
    await expect(storeEmployeePhoto(makeIsoMediaBuffer('avif')))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('JPEG、PNG、GIF、WebP') })
  })

  it('refuses a photo over the upload cap with the size message', async () => {
    const tooBig = Buffer.concat([PNG_1PX, Buffer.alloc(EMPLOYEE_PHOTO_MAX_SIZE)])
    await expect(storeEmployeePhoto(tooBig, { declaredMimeType: 'image/png' }))
      .rejects.toMatchObject({ status: 400, message: '圖片檔案過大，最大 5MB' })
  })
})

describe('employee photo storage: write failures', () => {
  it('turns an unwritable upload folder into a storage error and records the error code', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(fs, 'mkdir').mockRejectedValue(Object.assign(new Error('EACCES: permission denied, mkdir'), { code: 'EACCES' }))

    const error = await storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' }).catch(e => e)

    expect(error).toBeInstanceOf(EmployeePhotoStorageError)
    expect(error.status).toBe(500)
    expect(error.message).toBe('照片儲存失敗，請聯絡系統管理員')
    expect(error.message).not.toContain('EACCES')
    expect(consoleError).toHaveBeenCalledWith(
      'Employee photo storage failed',
      { operation: 'write', code: 'EACCES' },
    )
  })

  it('turns a failed file write into a storage error as well', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(fs, 'writeFile').mockRejectedValue(Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }))

    await expect(storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' }))
      .rejects.toBeInstanceOf(EmployeePhotoStorageError)
  })
})

describe('employee photo storage: status and legacy files', () => {
  it('returns a validator that changes when the photo is replaced', async () => {
    const first = await storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' })
    const second = await storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' })
    storedPaths.push(first.storedPath, second.storedPath)

    const firstMeta = await statEmployeePhoto(first.storedPath)
    const secondMeta = await statEmployeePhoto(second.storedPath)

    expect(firstMeta).toMatchObject({ size: PNG_1PX.length })
    expect(firstMeta.etag).toMatch(/^"[0-9a-f]{24}"$/)
    expect(await statEmployeePhoto(first.storedPath)).toEqual(firstMeta)
    // 同樣的內容、不同的檔案：換了照片 ETag 就會不一樣
    expect(secondMeta.etag).not.toBe(firstMeta.etag)
  })

  it('returns null for files that are missing, empty or outside the managed photo paths', async () => {
    expect(await statEmployeePhoto('/upload/employees/employee_missing.png')).toBeNull()
    expect(await statEmployeePhoto('/upload/employees')).toBeNull()
    expect(await statEmployeePhoto('/upload/approvals/employee_x.png')).toBeNull()
    expect(await statEmployeePhoto('')).toBeNull()
    expect(await statEmployeePhoto(undefined)).toBeNull()
    expect(await statEmployeePhoto(await writeLegacyPhoto(0))).toBeNull()
  })

  it('still serves a legacy photo above the 5 MB upload cap, up to the 20 MB read cap', async () => {
    const legacyPath = await writeLegacyPhoto(EMPLOYEE_PHOTO_MAX_SIZE + 512 * 1024)

    const meta = await statEmployeePhoto(legacyPath)
    const photo = await readEmployeePhoto(legacyPath)

    expect(meta?.size).toBe(EMPLOYEE_PHOTO_MAX_SIZE + 512 * 1024)
    expect(photo?.mimeType).toBe('image/png')
    expect(photo?.buffer.length).toBe(EMPLOYEE_PHOTO_MAX_SIZE + 512 * 1024)
  })

  it('does not read a file above the read cap', async () => {
    const hugePath = await writeLegacyPhoto(EMPLOYEE_PHOTO_MAX_READ_SIZE + 1)

    expect(await statEmployeePhoto(hugePath)).toBeNull()
    expect(await readEmployeePhoto(hugePath)).toBeNull()
  })

  it('does not hide a read failure other than a missing file', async () => {
    const stored = await storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' })
    storedPaths.push(stored.storedPath)
    jest.spyOn(fs, 'readFile').mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }))

    await expect(readEmployeePhoto(stored.storedPath)).rejects.toMatchObject({ code: 'EACCES' })
  })
})

describe('stored photo path normalisation', () => {
  it.each([
    ['/upload/employees/employee_a.png', '/upload/employees/employee_a.png'],
    ['  /upload/employee_a.png  ', '/upload/employee_a.png'],
    ['http://localhost:3000/upload/employee_a.png', '/upload/employee_a.png'],
    ['https://hr.example.com/upload/employees/employee_a.png?x=1', '/upload/employees/employee_a.png'],
    ['', ''],
    [undefined, ''],
    [null, ''],
    [42, ''],
    ['http://', ''],
  ])('maps %p to %p', (value, expected) => {
    expect(normalizeStoredPhotoPath(value)).toBe(expected)
  })

  it('does not make a foreign URL point at a local file', () => {
    // 完整網址只取路徑部分；不在受管理照片路徑下的檔案仍然讀不到
    expect(resolveEmployeePhotoPath(normalizeStoredPhotoPath('https://evil.example.com/etc/passwd'))).toBeNull()
    expect(resolveEmployeePhotoPath(normalizeStoredPhotoPath('https://evil.example.com/upload/../secret.txt'))).toBeNull()
    expect(resolveEmployeePhotoPath(normalizeStoredPhotoPath('data:image/png;base64,AAAA'))).toBeNull()
  })
})
