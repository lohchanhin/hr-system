import request from 'supertest'
import express from 'express'
import fs from 'fs/promises'
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'

// 員工照片上傳的完整路徑：真的 multipart 請求 → multer → processUploadedPhoto → 控制器（資料庫以替身取代，檔案是真的）。
// 以前的測試都是直接呼叫函式，從來沒有送過真正的 multipart 內容，所以「編輯員工 + 上傳照片」整條路壞了也沒人發現。

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

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }))

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const JPEG_TINY = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(16)])
const HEIC_TINY = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic', 'latin1'), Buffer.alloc(32)])
const EMPLOYEE_ID = '507f1f77bcf86cd799439011'
const OTHER_ID = '507f1f77bcf86cd799439012'

let storage
let routes
let multerModule
let app
let requestUser
let createdPhotos

// 以資料庫替身保存「目前的員工資料」，updateOne 會把 $set 套上去，之後的 findById 就讀得到新值
let stored

function findByIdResult(doc) {
  const result = Promise.resolve(doc)
  result.select = jest.fn().mockResolvedValue(doc)
  result.populate = jest.fn().mockResolvedValue(doc)
  return result
}

beforeAll(async () => {
  storage = await import('../src/services/employeePhotoStorage.js')
  multerModule = await import('../src/middleware/photoUploadMulter.js')
  routes = (await import('../src/routes/employeeRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = requestUser
    next()
  })
  app.use('/api/employees', routes)
})

beforeEach(() => {
  jest.restoreAllMocks()
  createdPhotos = []
  requestUser = { id: 'admin1', role: 'admin' }
  stored = {
    _id: EMPLOYEE_ID,
    name: 'John',
    email: 'john@example.com',
    role: 'employee',
    status: '正職員工',
    accountEnabled: true,
    partTime: false,
    needClockIn: false,
    photo: '',
  }
  Object.values(mockEmployee).forEach(fn => fn.mockReset())
  mockEmployee.countDocuments.mockResolvedValue(1)
  mockEmployee.exists.mockResolvedValue(null)
  mockEmployee.findById.mockImplementation(() => findByIdResult({ ...stored }))
  mockEmployee.updateOne.mockImplementation(async (_filter, update) => {
    Object.assign(stored, update.$set)
    return { modifiedCount: 1 }
  })
  mockEmployee.create.mockImplementation(async doc => ({ _id: OTHER_ID, ...doc }))
})

afterEach(async () => {
  // 測試裡對 fs/promises 做的 spy 作用在真正的核心模組上，一定要還原，不然會影響同一個程序裡後面的測試檔
  jest.restoreAllMocks()
  await Promise.all(createdPhotos.splice(0).map(photoPath => storage.deleteEmployeePhoto(photoPath).catch(() => {})))
})

function track(photoPath) {
  if (photoPath) createdPhotos.push(photoPath)
  return photoPath
}

/** 記下這次請求實際寫入的照片檔案路徑（仍然真的寫檔），用來確認失敗時有清掉 */
function spyOnPhotoWrites() {
  const paths = []
  const realWriteFile = fs.writeFile.bind(fs)
  jest.spyOn(fs, 'writeFile').mockImplementation(async (filePath, ...rest) => {
    paths.push(String(filePath))
    return realWriteFile(filePath, ...rest)
  })
  return paths
}

function photoFile(req, buffer = PNG_1PX, { filename = 'me.png', contentType = 'image/png' } = {}) {
  return req.attach('photo', buffer, { filename, contentType })
}

describe('multipart upload middleware over HTTP', () => {
  let echoApp

  beforeAll(() => {
    echoApp = express()
    echoApp.use(express.json())
    echoApp.post(
      '/echo',
      multerModule.uploadSingle,
      multerModule.handleMulterError,
      multerModule.processUploadedPhoto,
      (req, res) => res.json({ body: req.body, uploadedPhotoPath: req.uploadedPhotoPath ?? null }),
    )
  })

  const post = () => request(echoApp).post('/echo')

  it('keeps the types of a JSON data part and stores the photo', async () => {
    const data = {
      name: '王小明',
      accountEnabled: true,
      isPartTime: false,
      isClocking: false,
      salaryAmount: 45000,
      languages: ['中文', 'English'],
      salaryAccountA: { bank: '812', acct: '123' },
      supervisor: null,
    }

    const res = await photoFile(post().field('data', JSON.stringify(data)))

    expect(res.status).toBe(200)
    track(res.body.uploadedPhotoPath)
    expect(res.body.uploadedPhotoPath).toMatch(/^\/upload\/employees\/employee_[a-f0-9-]+\.png$/)
    expect(res.body.body).toEqual({ ...data, photo: res.body.uploadedPhotoPath })
    expect(res.body.body.accountEnabled).toBe(true)
    expect(res.body.body.isPartTime).toBe(false)
    expect(res.body.body.salaryAmount).toBe(45000)
  })

  it('lets the data part win over a flat field of the same name, and never changes the prototype', async () => {
    const res = await photoFile(
      post()
        .field('name', 'flat')
        .field('data', '{"name":"typed","__proto__":{"polluted":true},"constructor":"x"}'),
    )

    expect(res.status).toBe(200)
    track(res.body.uploadedPhotoPath)
    expect(res.body.body.name).toBe('typed')
    expect(res.body.body.polluted).toBeUndefined()
    expect(res.body.body.constructor).not.toBe('x')
    expect({}.polluted).toBeUndefined()
  })

  it.each([
    ['broken JSON', '{"name":'],
    ['a JSON array', '[1,2]'],
    ['a JSON string', '"text"'],
    ['JSON null', 'null'],
  ])('rejects a data part that is %s with a Chinese message and stores nothing', async (_label, data) => {
    const res = await photoFile(post().field('data', data))

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('表單資料格式不正確，請重新整理頁面後再試')
  })

  it('turns flat multipart booleans into real booleans (older clients) and leaves other text alone', async () => {
    const res = await photoFile(
      post()
        .field('accountEnabled', 'true')
        .field('isPartTime', 'false')
        .field('isClocking', ' FALSE ')
        .field('requiresScheduling', 'true')
        .field('name', 'true')
        .field('title', 'false'),
    )

    expect(res.status).toBe(200)
    track(res.body.uploadedPhotoPath)
    expect(res.body.body).toMatchObject({
      accountEnabled: true,
      isPartTime: false,
      isClocking: false,
      requiresScheduling: true,
      // 只有已知的布林欄位會轉換；一般文字欄位剛好寫 true／false 要維持字串
      name: 'true',
      title: 'false',
    })
  })

  it('does not turn strings into booleans for a JSON request', async () => {
    const res = await post().send({ accountEnabled: 'false', name: 'x' })

    expect(res.status).toBe(200)
    expect(res.body.body.accountEnabled).toBe('false')
  })

  it('leaves a field called data alone in a JSON request (the data part exists only in multipart forms)', async () => {
    const res = await post().send({ name: 'x', data: 'not json at all' })

    expect(res.status).toBe(200)
    expect(res.body.body).toEqual({ name: 'x', data: 'not json at all' })
  })

  it('still parses flat fields that carry JSON arrays and objects', async () => {
    const res = await photoFile(
      post().field('languages', '["中文","English"]').field('emergency1', '{"name":"A"}').field('note', '[待確認'),
    )

    expect(res.status).toBe(200)
    track(res.body.uploadedPhotoPath)
    expect(res.body.body.languages).toEqual(['中文', 'English'])
    expect(res.body.body.emergency1).toEqual({ name: 'A' })
    expect(res.body.body.note).toBe('[待確認')
  })

  it('accepts a fully populated form sent as 150 separate fields plus the photo', async () => {
    let req = post()
    for (let index = 0; index < 150; index += 1) req = req.field(`field${index}`, `value${index}`)

    const res = await photoFile(req)

    expect(res.status).toBe(200)
    track(res.body.uploadedPhotoPath)
    expect(res.body.body.field149).toBe('value149')
  })

  it('answers a Chinese message when the form has an absurd number of fields', async () => {
    let req = post()
    for (let index = 0; index < 350; index += 1) req = req.field(`field${index}`, 'x')

    const res = await photoFile(req)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('表單欄位過多，請重新整理頁面後再試')
  })

  it('answers a Chinese message when a single field is too long', async () => {
    const res = await photoFile(post().field('note', 'x'.repeat(2 * 1024 * 1024 + 10)))

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('員工資料過大（證照或教育訓練的附件總量太大），請移除部分附件後再試')
  })

  it('rejects a HEIC photo (the iPhone default) with a message that says to use JPG or PNG', async () => {
    const byMime = await photoFile(post(), HEIC_TINY, { filename: 'IMG_0001.HEIC', contentType: 'image/heic' })
    const byExtension = await photoFile(post(), HEIC_TINY, { filename: 'IMG_0001.heic', contentType: 'application/octet-stream' })
    const byContent = await photoFile(post(), HEIC_TINY, { filename: 'IMG_0001.jpg', contentType: 'image/jpeg' })

    for (const res of [byMime, byExtension, byContent]) {
      expect(res.status).toBe(400)
      expect(res.body.error).toBe(storage.EMPLOYEE_PHOTO_HEIF_MESSAGE)
    }
    expect(byMime.body.error).toContain('JPG')
    expect(byMime.body.error).toContain('PNG')
  })

  it.each([
    ['SVG', 'image/svg+xml', 'logo.svg'],
    ['BMP', 'image/bmp', 'scan.bmp'],
    ['PDF', 'application/pdf', 'cv.pdf'],
  ])('rejects %s with the supported-format message', async (_label, contentType, filename) => {
    const res = await photoFile(post(), PNG_1PX, { filename, contentType })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('不支援的圖片格式，僅支援 JPEG、PNG、GIF、WebP')
  })

  it('rejects a photo over 5 MB with the size message', async () => {
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(5 * 1024 * 1024)])

    const res = await photoFile(post(), big)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('圖片檔案過大，最大 5MB')
  })

  it('accepts a photo just under 5 MB', async () => {
    const nearLimit = Buffer.concat([PNG_1PX, Buffer.alloc(4 * 1024 * 1024)])

    const res = await photoFile(post(), nearLimit)

    expect(res.status).toBe(200)
    track(res.body.uploadedPhotoPath)
  })

  it.each([
    ['an unknown type', 'application/octet-stream', 'photo.png'],
    ['the image/x-png alias', 'image/x-png', 'photo.png'],
  ])('trusts the file content over %s declared by the browser', async (_label, contentType, filename) => {
    const res = await photoFile(post(), PNG_1PX, { filename, contentType })

    expect(res.status).toBe(200)
    track(res.body.uploadedPhotoPath)
    expect(res.body.uploadedPhotoPath).toMatch(/\.png$/)
  })

  it('accepts the image/pjpeg alias for a real JPEG', async () => {
    const res = await photoFile(post(), JPEG_TINY, { filename: 'photo.jfif', contentType: 'image/pjpeg' })

    expect(res.status).toBe(200)
    track(res.body.uploadedPhotoPath)
    expect(res.body.uploadedPhotoPath).toMatch(/\.jpg$/)
  })

  it('accepts a data field between 1 MB and the JSON body limit (employees with scanned licences can still add a photo)', async () => {
    const res = await photoFile(post().field('note', 'x'.repeat(1536 * 1024)))

    expect(res.status).toBe(200)
  })

  it('accepts a real image whose declared type disagrees with its content and stores it under the sniffed type', async () => {
    // 網路下載的 PNG 被存成 .jpg：瀏覽器宣告 image/jpeg，內容其實是 PNG
    const res = await photoFile(post(), PNG_1PX, { filename: 'photo.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    expect(res.body.uploadedPhotoPath).toMatch(/\.png$/)
  })

  it('refuses text that only claims to be an image', async () => {
    const res = await photoFile(post(), Buffer.from('this is definitely not an image file'), { contentType: 'image/png' })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('無效的圖片數據')
  })

  it('refuses a second file and a file sent under the wrong field name', async () => {
    const two = await post().attach('photo', PNG_1PX, 'a.png').attach('photo', PNG_1PX, 'b.png')
    const wrongName = await post().attach('avatar', PNG_1PX, 'a.png')

    expect(two.status).toBe(400)
    expect(two.body.error).toMatch(/一次只能上傳一張照片/)
    expect(wrongName.status).toBe(400)
    expect(wrongName.body.error).toMatch(/一次只能上傳一張照片/)
  })

  it('answers a Chinese message for a truncated multipart body', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await post()
      .set('Content-Type', 'multipart/form-data; boundary=xyz')
      .send('--xyz\r\nContent-Disposition: form-data; name="name"\r\n\r\nvalue')

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('上傳的資料格式不正確，請重新整理頁面後再試')
    expect(consoleWarn).toHaveBeenCalled()
  })

  it('answers 500 with a Chinese message, and logs the error code, when the upload folder cannot be written', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(fs, 'mkdir').mockRejectedValue(Object.assign(new Error("EACCES: permission denied, mkdir 'D:\\hr\\upload\\employees'"), { code: 'EACCES' }))

    const res = await photoFile(post())

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: '照片儲存失敗，請聯絡系統管理員' })
    expect(consoleError).toHaveBeenCalledWith('Employee photo storage failed', { operation: 'write', code: 'EACCES' })
  })
})

describe('PUT /api/employees/:id with a photo', () => {
  const put = () => request(app).put(`/api/employees/${EMPLOYEE_ID}`)

  // 編輯畫面會把整份員工資料（含資料庫回傳的 accountEnabled、布林值）一起送出
  const editFormData = () => ({
    name: 'John Chen',
    email: 'john@example.com',
    accountEnabled: true,
    isPartTime: false,
    isClocking: false,
    salaryAmount: 52000,
    _id: EMPLOYEE_ID,
    authVersion: 3,
    createdAt: '2026-01-01T00:00:00.000Z',
  })

  it('saves the photo, keeps booleans typed and answers with the employee including the new photo path', async () => {
    const res = await photoFile(put().field('data', JSON.stringify(editFormData())))

    expect(res.status).toBe(200)
    track(res.body.photo)
    expect(res.body.photo).toMatch(/^\/upload\/employees\/employee_[a-f0-9-]+\.png$/)
    expect(res.body.name).toBe('John Chen')
    const update = mockEmployee.updateOne.mock.calls[0][1]
    expect(update.$set).toMatchObject({
      photo: res.body.photo,
      accountEnabled: true,
      partTime: false,
      needClockIn: false,
      salaryAmount: 52000,
    })
    // 照片真的寫進私有資料夾，而且之後讀得到
    expect((await storage.readEmployeePhoto(res.body.photo))?.mimeType).toBe('image/png')
  })

  it('does not flip the part-time and clock-in flags when only the photo changes', async () => {
    stored.partTime = false
    stored.needClockIn = false

    const res = await photoFile(put().field('data', JSON.stringify(editFormData())))

    expect(res.status).toBe(200)
    track(res.body.photo)
    expect(stored.partTime).toBe(false)
    expect(stored.needClockIn).toBe(false)
    expect(res.body.partTime).toBe(false)
    expect(res.body.needClockIn).toBe(false)
  })

  it('also saves when an older client sends every field as its own text part (booleans as strings)', async () => {
    const res = await photoFile(
      put()
        .field('name', 'John Chen')
        .field('accountEnabled', 'true')
        .field('isPartTime', 'false')
        .field('isClocking', 'false')
        .field('salaryAmount', '52000'),
    )

    expect(res.status).toBe(200)
    track(res.body.photo)
    expect(mockEmployee.updateOne.mock.calls[0][1].$set).toMatchObject({
      accountEnabled: true,
      partTime: false,
      needClockIn: false,
      salaryAmount: 52000,
    })
  })

  it('reads text parts that are true/false strings correctly in the controller even without the middleware', async () => {
    // 防禦：就算有欄位繞過了前面的轉換，Boolean('false') 也不能把兼職／打卡旗標翻成 true
    const { buildEmployeeDoc, buildEmployeePatch } = await import('../src/controllers/employeeController.js')

    expect(buildEmployeeDoc({ isPartTime: 'false', isClocking: 'false' })).toMatchObject({ isPartTime: false, isClocking: false })
    expect(buildEmployeeDoc({ isPartTime: 'true', isClocking: 'on' })).toMatchObject({ isPartTime: true, isClocking: true })
    expect(buildEmployeePatch({ isPartTime: 'false', isClocking: '0', accountEnabled: 'false' }).$set)
      .toMatchObject({ partTime: false, needClockIn: false, accountEnabled: false })
    expect(buildEmployeePatch({ isPartTime: true, isClocking: false, accountEnabled: true }).$set)
      .toMatchObject({ partTime: true, needClockIn: false, accountEnabled: true })
    expect(buildEmployeeDoc({})).toMatchObject({ isPartTime: false, isClocking: false })
  })

  it('replaces an existing photo and deletes the old file when nobody else uses it', async () => {
    const old = await storage.storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' })
    track(old.storedPath)
    stored.photo = old.storedPath

    const res = await photoFile(
      put().field('data', JSON.stringify({ ...editFormData(), photo: old.storedPath })),
      JPEG_TINY,
      { filename: 'new.jpg', contentType: 'image/jpeg' },
    )

    expect(res.status).toBe(200)
    track(res.body.photo)
    expect(res.body.photo).toMatch(/\.jpg$/)
    expect(res.body.photo).not.toBe(old.storedPath)
    expect(await storage.statEmployeePhoto(old.storedPath)).toBeNull()
    expect(await storage.statEmployeePhoto(res.body.photo)).not.toBeNull()
  })

  it('keeps the old file when another employee still points at it', async () => {
    const old = await storage.storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' })
    track(old.storedPath)
    stored.photo = old.storedPath
    mockEmployee.exists.mockResolvedValue({ _id: OTHER_ID })

    const res = await photoFile(put().field('data', JSON.stringify(editFormData())), JPEG_TINY, { filename: 'n.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    track(res.body.photo)
    expect(await storage.statEmployeePhoto(old.storedPath)).not.toBeNull()
  })

  it('removes the photo and its file when the form sends an empty photo', async () => {
    const old = await storage.storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' })
    track(old.storedPath)
    stored.photo = old.storedPath

    const res = await put().send({ name: 'John', photo: '' })

    expect(res.status).toBe(200)
    expect(res.body.photo).toBe('')
    expect(await storage.statEmployeePhoto(old.storedPath)).toBeNull()
  })

  it('keeps the stored photo when a JSON save sends back the same path', async () => {
    const old = await storage.storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' })
    track(old.storedPath)
    stored.photo = old.storedPath

    const res = await put().send({ name: 'Renamed', photo: old.storedPath })

    expect(res.status).toBe(200)
    expect(res.body.photo).toBe(old.storedPath)
    expect(await storage.statEmployeePhoto(old.storedPath)).not.toBeNull()
  })

  it('accepts the /upload path of a photo that an older version stored as a full URL', async () => {
    stored.photo = 'http://localhost:3000/upload/employee_legacy.png'

    const res = await put().send({ name: 'Renamed', photo: '/upload/employee_legacy.png' })

    expect(res.status).toBe(200)
    expect(res.body.photo).toBe('/upload/employee_legacy.png')
  })

  it('still refuses to point an employee at a photo file that was not uploaded for them', async () => {
    stored.photo = '/upload/employees/employee_mine.png'

    const res = await put().send({ photo: '/upload/employees/employee_someone-elses.png' })

    expect(res.status).toBe(400)
    expect(res.body).toEqual({ error: '員工照片必須直接上傳' })
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })

  it('stores nothing when the upload is a HEIC photo', async () => {
    const res = await photoFile(put().field('data', JSON.stringify(editFormData())), HEIC_TINY, { filename: 'IMG.heic', contentType: 'image/heic' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe(storage.EMPLOYEE_PHOTO_HEIF_MESSAGE)
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
  })

  it('deletes the new file again when the save is refused after the upload', async () => {
    const writes = spyOnPhotoWrites()

    const res = await photoFile(put().field('data', JSON.stringify({ ...editFormData(), email: 'not-an-email' })))

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('Invalid email')
    expect(mockEmployee.updateOne).not.toHaveBeenCalled()
    expect(writes).toHaveLength(1)
    await expect(fs.stat(writes[0])).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('POST /api/employees with a photo', () => {
  const newEmployee = () => ({
    name: 'Jane',
    email: 'jane@example.com',
    employeeNo: 'E001',
    username: 'jane',
    password: 'Secret-pass-123',
    role: 'employee',
    isPartTime: false,
    isClocking: true,
  })

  it('creates the employee with the photo, keeps the part-time switch off and answers with the photo path', async () => {
    const res = await photoFile(request(app).post('/api/employees').field('data', JSON.stringify(newEmployee())))

    expect(res.status).toBe(201)
    track(res.body.photo)
    expect(res.body.photo).toMatch(/^\/upload\/employees\/employee_[a-f0-9-]+\.png$/)
    const doc = mockEmployee.create.mock.calls[0][0]
    expect(doc.photo).toBe(res.body.photo)
    expect(doc.isPartTime).toBe(false)
    expect(doc.isClocking).toBe(true)
    expect((await storage.readEmployeePhoto(res.body.photo))?.mimeType).toBe('image/png')
  })

  it('does not turn the part-time switch on for an older client that sends it as the text "false"', async () => {
    const res = await photoFile(
      request(app).post('/api/employees')
        .field('name', 'Jane')
        .field('email', 'jane@example.com')
        .field('employeeNo', 'E001')
        .field('username', 'jane')
        .field('password', 'Secret-pass-123')
        .field('isPartTime', 'false')
        .field('isClocking', 'false'),
    )

    expect(res.status).toBe(201)
    track(res.body.photo)
    const doc = mockEmployee.create.mock.calls[0][0]
    expect(doc.isPartTime).toBe(false)
    expect(doc.isClocking).toBe(false)
  })

  it('deletes the uploaded file when the employee cannot be created', async () => {
    mockEmployee.create.mockRejectedValue(new Error('E11000 duplicate key error'))
    const writes = spyOnPhotoWrites()

    const res = await photoFile(request(app).post('/api/employees').field('data', JSON.stringify(newEmployee())))

    expect(res.status).toBe(400)
    expect(writes).toHaveLength(1)
    await expect(fs.stat(writes[0])).rejects.toMatchObject({ code: 'ENOENT' })
  })
})

describe('GET /api/employees/:id/photo over HTTP', () => {
  const get = (id = EMPLOYEE_ID) => request(app).get(`/api/employees/${id}/photo`)

  async function givePhoto(buffer = PNG_1PX) {
    const photo = await storage.storeEmployeePhoto(buffer, {})
    track(photo.storedPath)
    stored.photo = photo.storedPath
    return photo.storedPath
  }

  it('shows an employee photo to any signed-in user, not only to the owner, a supervisor or an administrator', async () => {
    await givePhoto()

    for (const user of [
      { id: OTHER_ID, role: 'employee' },
      { id: 'sup-elsewhere', role: 'supervisor' },
      { id: 'admin1', role: 'admin' },
    ]) {
      requestUser = user
      const res = await get()
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('image/png')
      expect(res.headers['x-content-type-options']).toBe('nosniff')
      expect(res.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
      expect(Buffer.isBuffer(res.body) && res.body.equals(PNG_1PX)).toBe(true)
    }
  })

  it('answers 304 with no body when the browser already has the current photo, and 200 with the new bytes after a replacement', async () => {
    const firstPath = await givePhoto()
    const first = await get()
    expect(first.status).toBe(200)
    const etag = first.headers.etag
    expect(etag).toMatch(/^"[0-9a-f]{24}"$/)
    expect(first.headers['cache-control']).toBe('private, no-cache')
    expect(first.headers.vary).toMatch(/Authorization/i)

    const again = await get().set('If-None-Match', etag)
    expect(again.status).toBe(304)
    expect(again.text ?? '').toBe('')
    expect(again.headers.etag).toBe(etag)

    // 換一張照片：同一個網址，ETag 不同，舊的驗證碼不能再換到 304
    const secondPath = await givePhoto(JPEG_TINY)
    expect(secondPath).not.toBe(firstPath)
    const replaced = await get().set('If-None-Match', etag)
    expect(replaced.status).toBe(200)
    expect(replaced.headers['content-type']).toBe('image/jpeg')
    expect(replaced.headers.etag).not.toBe(etag)
  })

  it('lets the browser cache for five minutes only when the request names the current photo file', async () => {
    const photoPath = await givePhoto()
    const version = photoPath.split('/').pop()

    const versioned = await get().query({ v: version })
    const stale = await get().query({ v: 'employee_previous.png' })

    expect(versioned.headers['cache-control']).toBe('private, max-age=300, must-revalidate')
    expect(stale.headers['cache-control']).toBe('private, no-cache')
  })

  it('answers an uncacheable 404 for an employee without a photo, a missing file and a malformed id', async () => {
    const noPhoto = await get()
    stored.photo = '/upload/employees/employee_gone.png'
    const missingFile = await get()
    const failure = Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' })
    mockEmployee.findById.mockImplementation(() => ({ select: jest.fn().mockRejectedValue(failure) }))
    const badId = await get('not-an-id')

    for (const res of [noPhoto, missingFile, badId]) {
      expect(res.status).toBe(404)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body).toEqual({ error: 'Not found' })
    }
  })

  it('serves a photo that an older version stored as a full URL', async () => {
    const photoPath = await givePhoto()
    stored.photo = `http://localhost:3000${photoPath}`

    const res = await get()

    expect(res.status).toBe(200)
  })

  it('does not echo system error text when the photo cannot be read', async () => {
    await givePhoto()
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(fs, 'readFile').mockRejectedValue(Object.assign(new Error("EACCES: permission denied, open 'D:\\hr\\upload'"), { code: 'EACCES' }))

    const res = await get()

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ error: '載入照片失敗' })
    expect(consoleError).toHaveBeenCalledWith('Failed to read employee photo', expect.objectContaining({ code: 'EACCES' }))
  })
})
