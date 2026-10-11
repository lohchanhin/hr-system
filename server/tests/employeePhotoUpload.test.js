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
  mockEmployee.updateOne.mockImplementation(async (filter, update) => {
    // 和真的資料庫一樣：條件（換照片時是 _id 加上讀到的舊照片）對不上就不寫入，matchedCount 為 0
    if (filter?.photo !== undefined && !photoMatchesCondition(stored.photo, filter.photo)) {
      return { matchedCount: 0, modifiedCount: 0 }
    }
    Object.assign(stored, update.$set)
    return { matchedCount: 1, modifiedCount: 1 }
  })
  mockEmployee.create.mockImplementation(async doc => ({ _id: OTHER_ID, ...doc }))
})

// 資料庫替身用的條件比對：只認得「等於某個路徑」與「沒有照片（{ $in: [null, ''] }）」這兩種
function photoMatchesCondition(current, condition) {
  if (condition && typeof condition === 'object' && Array.isArray(condition.$in)) {
    return condition.$in.some(candidate => (candidate ?? '') === (current ?? ''))
  }
  return condition === current
}

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
    track(res.body.uploadedPhotoPath)
  })

  it('accepts a real image whose declared type disagrees with its content and stores it under the sniffed type', async () => {
    // 網路下載的 PNG 被存成 .jpg：瀏覽器宣告 image/jpeg，內容其實是 PNG
    const res = await photoFile(post(), PNG_1PX, { filename: 'photo.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    track(res.body.uploadedPhotoPath)
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

  describe('when saves of the same employee run at the same time', () => {
    const CONFLICT_MESSAGE = '員工照片剛剛已被其他人更新，這次的修改沒有儲存，請重新整理頁面後再試'
    // 內容不同的 JPEG（檔頭相同，最後一個位元組不同）：每次上傳存成不同的檔案
    const jpegVariant = (marker) => Buffer.concat([JPEG_TINY, Buffer.from([marker])])
    const exists = (filePath) => fs.stat(filePath).then(() => true, () => false)

    /**
     * 讓前 count 個「讀取員工」的請求都讀完同一份舊資料之後才一起往下走（讀到的是各自抵達時的快照），
     * 重現「幾個人同時按儲存、全都讀到同一張舊照片」的情況；之後的讀取（存檔之後再讀一次）不受影響。
     */
    function holdFirstReads(count) {
      const readThrough = mockEmployee.findById.getMockImplementation()
      const waiting = []
      mockEmployee.findById.mockImplementation((...args) => {
        if (waiting.length >= count) return readThrough(...args)
        const snapshot = { ...stored }
        const gate = new Promise((resolve) => {
          waiting.push(resolve)
          if (waiting.length === count) waiting.forEach((release) => release())
        })
        return findByIdResult(gate.then(() => snapshot))
      })
    }

    async function storeOldPhoto() {
      const old = await storage.storeEmployeePhoto(PNG_1PX, { declaredMimeType: 'image/png' })
      track(old.storedPath)
      stored.photo = old.storedPath
      return old.storedPath
    }

    it('lets exactly one of three simultaneous replacements win; the others answer 409 and leave no file behind', async () => {
      const oldPath = await storeOldPhoto()
      holdFirstReads(3)
      const writes = spyOnPhotoWrites()

      const responses = await Promise.all([1, 2, 3].map((marker) => photoFile(
        put().field('data', JSON.stringify({ ...editFormData(), name: `Editor ${marker}`, photo: oldPath })),
        jpegVariant(marker),
        { filename: `new${marker}.jpg`, contentType: 'image/jpeg' },
      )))

      const winners = responses.filter((res) => res.status === 200)
      const losers = responses.filter((res) => res.status === 409)
      expect(winners).toHaveLength(1)
      expect(losers).toHaveLength(2)
      const [winner] = winners
      track(winner.body.photo)

      // 輸的人什麼都沒存，並被告知目前真正存著的照片；贏的人回應的就是資料庫裡的照片
      expect(stored.photo).toBe(winner.body.photo)
      expect(winner.body.name).toBe(stored.name)
      losers.forEach((res) => expect(res.body).toEqual({ error: CONFLICT_MESSAGE, photo: stored.photo }))
      expect(stored.name).toMatch(/^Editor [123]$/)
      // 三個人都用「讀到的舊照片」當條件寫入，只有第一個對得上
      expect(mockEmployee.updateOne).toHaveBeenCalledTimes(3)
      mockEmployee.updateOne.mock.calls.forEach(([filter]) => expect(filter).toMatchObject({ _id: EMPLOYEE_ID, photo: oldPath }))

      // 硬碟上：三次上傳寫了三個檔，只剩被引用的那一個；舊照片也收掉了
      expect(writes).toHaveLength(3)
      const remaining = []
      for (const filePath of writes) if (await exists(filePath)) remaining.push(filePath)
      expect(remaining).toEqual([storage.resolveEmployeePhotoPath(stored.photo)])
      expect(await storage.statEmployeePhoto(oldPath)).toBeNull()
    })

    it('does not put the old photo back when a save that never touched the photo read it before another save replaced it', async () => {
      const oldPath = await storeOldPhoto()
      holdFirstReads(2)

      const [replacing, stale] = await Promise.all([
        photoFile(
          put().field('data', JSON.stringify({ ...editFormData(), photo: oldPath })),
          jpegVariant(7),
          { filename: 'new.jpg', contentType: 'image/jpeg' },
        ),
        // 編輯畫面每次存檔都會把目前的照片路徑原樣送回來
        put().send({ name: 'Renamed', photo: oldPath }),
      ])

      expect(replacing.status).toBe(200)
      expect(stale.status).toBe(200)
      track(replacing.body.photo)
      // 沒換照片的那次儲存不寫照片欄位，所以不論誰先寫，都不會把新照片蓋回舊路徑
      mockEmployee.updateOne.mock.calls
        .filter(([, update]) => update.$set.name === 'Renamed')
        .forEach(([filter, update]) => {
          expect(update.$set).not.toHaveProperty('photo')
          expect(filter).not.toHaveProperty('photo')
        })
      expect(stored.photo).toBe(replacing.body.photo)
      expect(stale.body.photo).toBe(stored.photo)
      expect(await storage.statEmployeePhoto(stored.photo)).not.toBeNull()
      expect(await storage.statEmployeePhoto(oldPath)).toBeNull()
    })

    it('answers 409 with the photo that is really stored, and removes its own file, when the photo was replaced after it was read', async () => {
      const oldPath = await storeOldPhoto()
      const other = await storage.storeEmployeePhoto(jpegVariant(9), { declaredMimeType: 'image/jpeg' })
      track(other.storedPath)
      const writes = spyOnPhotoWrites()
      // 讀完員工、尚未寫入之前，別人把照片換成 other
      const realUpdateOne = mockEmployee.updateOne.getMockImplementation()
      mockEmployee.updateOne.mockImplementationOnce(async (...args) => {
        stored.photo = other.storedPath
        return realUpdateOne(...args)
      })

      const res = await photoFile(put().field('data', JSON.stringify({ ...editFormData(), photo: oldPath })), jpegVariant(8), { filename: 'mine.jpg', contentType: 'image/jpeg' })

      expect(res.status).toBe(409)
      expect(res.body).toEqual({ error: CONFLICT_MESSAGE, photo: other.storedPath })
      expect(stored.name).toBe('John')
      expect(writes).toHaveLength(1)
      expect(await exists(writes[0])).toBe(false)
      // 別人換上去的照片沒有被動到；舊照片不是這次請求換掉的，它的去留不歸這次請求管
      expect(await storage.statEmployeePhoto(other.storedPath)).not.toBeNull()
    })

    it('treats an employee with no photo the same way: only one of two first uploads wins', async () => {
      stored.photo = undefined
      holdFirstReads(2)
      const writes = spyOnPhotoWrites()

      const responses = await Promise.all([1, 2].map((marker) => photoFile(
        put().field('data', JSON.stringify({ ...editFormData(), name: `First ${marker}` })),
        jpegVariant(marker),
        { filename: `first${marker}.jpg`, contentType: 'image/jpeg' },
      )))

      expect(responses.map((res) => res.status).sort()).toEqual([200, 409])
      const winner = responses.find((res) => res.status === 200)
      track(winner.body.photo)
      expect(stored.photo).toBe(winner.body.photo)
      mockEmployee.updateOne.mock.calls.forEach(([filter]) => expect(filter.photo).toEqual({ $in: [null, ''] }))
      const remaining = []
      for (const filePath of writes) if (await exists(filePath)) remaining.push(filePath)
      expect(remaining).toEqual([storage.resolveEmployeePhotoPath(stored.photo)])
    })

    it('answers 404 and removes the new file when the employee was deleted while the save was running', async () => {
      const oldPath = await storeOldPhoto()
      const writes = spyOnPhotoWrites()
      let reads = 0
      mockEmployee.findById.mockImplementation(() => findByIdResult(++reads === 1 ? { ...stored } : null))
      mockEmployee.updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })

      const res = await photoFile(put().field('data', JSON.stringify({ ...editFormData(), photo: oldPath })), jpegVariant(5), { filename: 'late.jpg', contentType: 'image/jpeg' })

      expect(res.status).toBe(404)
      expect(res.body).toEqual({ error: 'Not found' })
      expect(writes).toHaveLength(1)
      expect(await exists(writes[0])).toBe(false)
    })

    it('does not fail the save of a legacy full-URL photo that only needs its path rewritten when the photo changed meanwhile', async () => {
      stored.photo = 'http://localhost:3000/upload/employee_legacy.png'
      const replacedMeanwhile = '/upload/employees/employee_replaced-meanwhile.png'
      const realUpdateOne = mockEmployee.updateOne.getMockImplementation()
      mockEmployee.updateOne.mockImplementationOnce(async (...args) => {
        stored.photo = replacedMeanwhile
        return realUpdateOne(...args)
      })

      const res = await put().send({ name: 'Renamed', photo: '/upload/employee_legacy.png' })

      // 只是改寫路徑格式，不值得為它回 409：其他欄位照存，照片欄位維持別人剛換上去的
      expect(res.status).toBe(200)
      expect(res.body.name).toBe('Renamed')
      expect(res.body.photo).toBe(replacedMeanwhile)
      expect(mockEmployee.updateOne).toHaveBeenCalledTimes(2)
      expect(mockEmployee.updateOne.mock.calls[1][0]).toEqual({ _id: EMPLOYEE_ID })
      expect(mockEmployee.updateOne.mock.calls[1][1].$set).not.toHaveProperty('photo')
    })
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
