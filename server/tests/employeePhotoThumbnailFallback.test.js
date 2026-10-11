import request from 'supertest'
import express from 'express'
import fs from 'fs/promises'
import path from 'path'
import jwt from 'jsonwebtoken'
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'

// 真實 Express app（src/index.js）在載入時會檢查這幾個環境變數，必須在動態 import 之前設定
process.env.PORT = process.env.PORT || '3000'
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost/test'
process.env.JWT_SECRET = 'test-only-jwt-secret-at-least-32-bytes'

// 第一個打到真實 app 的請求要把所有路由與中介層暖機，整套測試同時跑時 5 秒的預設值不夠
jest.setTimeout(30000)

// 伺服器上 sharp（原生套件）載入不了時：縮圖功能整個關掉，GET /api/employees/:id/photo?size= 照樣回傳原圖，畫面不會壞。
// sharp 載入是動態 import，這裡用 mock 讓它載入失敗；同一個測試檔裡的真實 sharp 測試在 employeePhotoThumbnail.test.js。

const importFailure = Object.assign(
  new Error('Could not load the "sharp" module using the linux-x64 runtime (D:\\hr\\node_modules\\sharp\\lib\\sharp.js)'),
  { code: 'ERR_DLOPEN_FAILED' },
)
jest.unstable_mockModule('sharp', () => {
  throw importFailure
})

const mockEmployee = {
  find: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  updateOne: jest.fn(),
  countDocuments: jest.fn(),
  exists: jest.fn(),
}
const mockApprovalRequest = { find: jest.fn() }
const mockApprovalWorkflow = { find: jest.fn() }
const mockIsTokenBlacklisted = jest.fn()

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))
jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
  isTokenBlacklisted: mockIsTokenBlacklisted,
  blacklistToken: jest.fn(),
}))

const EMPLOYEE_ID = '507f1f77bcf86cd799439011'
// 70 個位元組的 1x1 PNG：夠讓檔頭驗證通過，不依賴任何圖檔
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

let storage
let thumbs
let app
let stored
let createdPhotos

function findByIdResult(doc) {
  const result = Promise.resolve(doc)
  result.select = jest.fn().mockResolvedValue(doc)
  return result
}

beforeAll(async () => {
  storage = await import('../src/services/employeePhotoStorage.js')
  thumbs = await import('../src/services/employeePhotoThumbnail.js')
  const routes = (await import('../src/routes/employeeRoutes.js')).default
  app = express()
  app.use((req, _res, next) => {
    req.user = { id: 'viewer1', role: 'employee' }
    next()
  })
  app.use('/api/employees', routes)
  // 載入整個路由（很多模組）：整套測試同時跑時會超過預設的 5 秒
}, 60000)

beforeEach(() => {
  jest.restoreAllMocks()
  thumbs.resetEmployeePhotoThumbnailState()
  createdPhotos = []
  stored = { _id: EMPLOYEE_ID, name: 'John', photo: '' }
  Object.values(mockEmployee).forEach((fn) => fn.mockReset())
  mockEmployee.findById.mockImplementation(() => findByIdResult({ ...stored }))
})

afterEach(async () => {
  jest.restoreAllMocks()
  await Promise.all(createdPhotos.splice(0).map((photoPath) => storage.deleteEmployeePhoto(photoPath).catch(() => {})))
})

async function givePhoto() {
  const photo = await storage.storeEmployeePhoto(PNG_1PX, {})
  createdPhotos.push(photo.storedPath)
  stored.photo = photo.storedPath
  return photo.storedPath
}

// 別的測試檔可能同時在用縮圖資料夾，所以只看這張照片自己有沒有縮圖
const thumbnailsOf = async (photoPath) => {
  const stem = path.basename(photoPath, path.extname(photoPath))
  const names = await fs.readdir(storage.EMPLOYEE_PHOTO_THUMB_DIR).catch(() => [])
  return names.filter((name) => name.startsWith(`${stem}.`))
}

describe('when sharp cannot be loaded', () => {
  it('reports no thumbnail support, logs only the error code once, and keeps answering null', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    expect(await thumbs.loadSharp()).toBeNull()
    expect(await thumbs.loadSharp()).toBeNull()

    // 只記一次，而且只有錯誤代碼：訊息裡有系統路徑，不寫進 log
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][1]).toEqual({ code: 'ERR_DLOPEN_FAILED' })
    expect(JSON.stringify(warn.mock.calls[0])).not.toMatch(/hr|node_modules|linux-x64/)

    const photoPath = await givePhoto()
    const meta = await storage.statEmployeePhoto(photoPath)
    expect(await thumbs.readEmployeePhotoThumbnail(photoPath, 96, meta)).toBeNull()
    expect(await thumbnailsOf(photoPath)).toEqual([])
  })

  it('serves the original for ?size= with the original validator, so the same URL never gets two sets of validators', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const photoPath = await givePhoto()
    const meta = await storage.statEmployeePhoto(photoPath)

    const withSize = await request(app).get(`/api/employees/${EMPLOYEE_ID}/photo`).query({ size: 96 })
    const without = await request(app).get(`/api/employees/${EMPLOYEE_ID}/photo`)

    expect(withSize.status).toBe(200)
    expect(withSize.headers['content-type']).toBe('image/png')
    expect(withSize.body.equals(PNG_1PX)).toBe(true)
    expect(withSize.headers.etag).toBe(meta.etag)
    expect(without.headers.etag).toBe(meta.etag)
    expect(withSize.headers['x-content-type-options']).toBe('nosniff')
    expect(withSize.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
    expect(withSize.headers['cache-control']).toBe('private, no-cache')
    expect(await thumbnailsOf(photoPath)).toEqual([])
  })

  it('still answers 304 for a browser that already has the image, and ignores garbage sizes like before', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const photoPath = await givePhoto()
    const meta = await storage.statEmployeePhoto(photoPath)

    const again = await request(app).get(`/api/employees/${EMPLOYEE_ID}/photo`).query({ size: 192 }).set('If-None-Match', meta.etag)
    const garbage = await request(app).get(`/api/employees/${EMPLOYEE_ID}/photo`).query({ size: 'abc' })

    expect(again.status).toBe(304)
    expect(garbage.status).toBe(200)
    expect(garbage.body.equals(PNG_1PX)).toBe(true)
  })

  it('still answers the uncacheable 404 for an employee without a photo', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await request(app).get(`/api/employees/${EMPLOYEE_ID}/photo`).query({ size: 96 })

    expect(res.status).toBe(404)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('deleting the photo still works and has no thumbnail folder to clean', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const photoPath = await givePhoto()
    createdPhotos.pop()

    expect(await storage.deleteEmployeePhoto(photoPath)).toBe(true)
    expect(await storage.statEmployeePhoto(photoPath)).toBeNull()
    expect(await thumbnailsOf(photoPath)).toEqual([])
  })
})

describe('the real app (src/index.js) when sharp cannot be loaded', () => {
  const VIEWER_ID = '507f1f77bcf86c0000000001'
  let realApp

  const authHeader = () => `Bearer ${jwt.sign({ id: VIEWER_ID, role: 'employee', ver: 0 }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    issuer: 'hr-system',
    audience: 'hr-system-api',
  })}`

  beforeAll(async () => {
    ;({ app: realApp } = await import('../src/index.js'))
  }, 60000)

  beforeEach(() => {
    mockIsTokenBlacklisted.mockResolvedValue(false)
    // 驗證登入者與讀取照片都走 findById(...).select(...)：登入者回自己的資料，其他 id 回被查看的員工
    mockEmployee.findById.mockImplementation((id) => ({
      select: jest.fn().mockResolvedValue(
        String(id) === VIEWER_ID
          ? { _id: VIEWER_ID, role: 'employee', status: '正職員工', accountEnabled: true, authVersion: 0 }
          : { ...stored },
      ),
    }))
  })

  it('still loads, answers the health check and serves the original through the authenticated photo route', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const photoPath = await givePhoto()
    const meta = await storage.statEmployeePhoto(photoPath)

    // 載入整個 app 本身就沒有碰 sharp：sharp 只在第一次要縮圖時才動態載入
    const health = await request(realApp).get('/api/health')
    expect(health.status).toBe(200)

    const anonymous = await request(realApp).get(`/api/employees/${EMPLOYEE_ID}/photo`).query({ size: 96 })
    expect(anonymous.status).toBe(401)

    const res = await request(realApp)
      .get(`/api/employees/${EMPLOYEE_ID}/photo`)
      .query({ size: 96, v: photoPath.split('/').pop() })
      .set('Authorization', authHeader())
    expect(res.status).toBe(200)
    expect(res.body.equals(PNG_1PX)).toBe(true)
    expect(res.headers.etag).toBe(meta.etag)
    expect(res.headers['cache-control']).toBe('private, max-age=300, must-revalidate')
  })

  it('does not let the photo files or the thumbnail folder be read as static files', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const photoPath = await givePhoto()
    const stem = path.basename(photoPath, path.extname(photoPath))

    for (const url of [
      photoPath,
      `/upload/employees/.thumbs/${stem}.96.jpg`,
      '/upload/employees/.thumbs/',
      '/upload/employees/%2ethumbs/x.jpg',
    ]) {
      const res = await request(realApp).get(url)
      expect(res.status).toBe(404)
    }
  })
})
