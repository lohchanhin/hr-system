import { afterEach, describe, expect, it, jest } from '@jest/globals'
import privateUploadGuard from '../src/middleware/privateUploadGuard.js'
import {
  EmployeePhotoValidationError,
  deleteEmployeePhoto,
  readEmployeePhoto,
  resolveEmployeePhotoPath,
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
