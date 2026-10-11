import request from 'supertest'
import express from 'express'
import fs from 'fs/promises'
import path from 'path'
import sharp from 'sharp'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals'

// 員工照片縮圖：真的用 sharp 產生縮圖、真的寫進 upload/employees/.thumbs（資料庫以替身取代）。
// 圖片都在測試裡用 sharp 現場產生，不依賴任何圖檔。

// 影像處理比一般測試慢，整套測試同時跑（多個 worker 搶 CPU）時 5 秒的預設值不夠
jest.setTimeout(30000)

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

const EMPLOYEE_ID = '507f1f77bcf86cd799439011'
const OTHER_ID = '507f1f77bcf86cd799439012'

let storage
let thumbs
let routes
let app
let requestUser
let stored
let createdPhotos

// 有雜訊的圖才壓不小，縮圖與原檔的大小差異才看得出來
const noiseImage = (width, height) => sharp({
  create: { width, height, channels: 3, background: '#808080', noise: { type: 'gaussian', mean: 128, sigma: 40 } },
})
const solidImage = (width, height, background) => sharp({ create: { width, height, channels: 3, background } })

let noisePng // 700x500，沒有透明
let noiseJpeg // 700x500
let transparentPng // 640x640，有透明通道

function findByIdResult(doc) {
  const result = Promise.resolve(doc)
  result.select = jest.fn().mockResolvedValue(doc)
  result.populate = jest.fn().mockResolvedValue(doc)
  return result
}

const thumbDirNames = async () => {
  try {
    return (await fs.readdir(storage.EMPLOYEE_PHOTO_THUMB_DIR)).sort()
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

const stemOf = (storedPath) => path.basename(storedPath, path.extname(storedPath))

async function storePhoto(buffer) {
  const photo = await storage.storeEmployeePhoto(buffer, {})
  createdPhotos.push(photo.storedPath)
  return photo.storedPath
}

beforeAll(async () => {
  storage = await import('../src/services/employeePhotoStorage.js')
  thumbs = await import('../src/services/employeePhotoThumbnail.js')
  routes = (await import('../src/routes/employeeRoutes.js')).default
  app = express()
  app.use(express.json())
  app.use((req, _res, next) => {
    req.user = requestUser
    next()
  })
  app.use('/api/employees', routes)

  noisePng = await noiseImage(700, 500).png().toBuffer()
  noiseJpeg = await noiseImage(700, 500).jpeg({ quality: 90 }).toBuffer()
  transparentPng = await noiseImage(640, 640).ensureAlpha(0.5).png().toBuffer()
  // 載入整個路由（很多模組）加上現場產生幾張雜訊圖：整套測試同時跑時會超過預設的 5 秒
}, 60000)

beforeEach(() => {
  jest.restoreAllMocks()
  thumbs.resetEmployeePhotoThumbnailState()
  createdPhotos = []
  requestUser = { id: 'viewer1', role: 'employee' }
  stored = { _id: EMPLOYEE_ID, name: 'John', photo: '' }
  Object.values(mockEmployee).forEach((fn) => fn.mockReset())
  mockEmployee.findById.mockImplementation(() => findByIdResult({ ...stored }))
})

afterEach(async () => {
  jest.restoreAllMocks()
  await Promise.all(createdPhotos.splice(0).map((photoPath) => storage.deleteEmployeePhoto(photoPath).catch(() => {})))
})

afterAll(async () => {
  // 只在資料夾是空的時候才會成功：不動別人的縮圖
  await fs.rmdir(storage.EMPLOYEE_PHOTO_THUMB_DIR).catch(() => {})
})

describe('parseThumbnailSize', () => {
  it.each([
    ['48', 48],
    ['96', 96],
    ['160', 160],
    ['256', 256],
    ['384', 384],
    ['512', 512],
    // 往上取到固定檔位
    ['49', 96],
    ['64', 96],
    ['97', 160],
    ['100', 160],
    ['161', 256],
    ['200', 256],
    ['257', 384],
    ['385', 512],
    ['500', 512],
  ])('turns ?size=%s into the %i px step', (raw, expected) => {
    expect(thumbs.parseThumbnailSize(raw)).toBe(expected)
  })

  it.each([
    // 超出 48 ~ 512 的整數不照單全收：當作沒帶，回原圖
    '0',
    '1',
    '47',
    '513',
    '1000',
    '4096',
    '999999',
    // 其他亂帶的值
    undefined,
    null,
    '',
    ' ',
    'abc',
    '96px',
    '-5',
    '+96',
    '1e3',
    '96.5',
    ' 96',
    '096',
    '0096',
    '0x60',
    'NaN',
    'Infinity',
    '1234567',
    ['96'],
    ['96', '192'],
    { a: '96' },
    96,
  ].map((value) => [value]))('ignores the value %p (the full image is served)', (raw) => {
    expect(thumbs.parseThumbnailSize(raw)).toBeNull()
  })

  it('publishes the same steps the client asks for', () => {
    expect(thumbs.EMPLOYEE_PHOTO_THUMB_SIZES).toEqual([48, 96, 160, 256, 384, 512])
  })
})

describe('thumbnail generation with the real sharp', () => {
  it('shrinks a photo to the requested step, keeps the aspect ratio and caches the file next to the originals', async () => {
    const photoPath = await storePhoto(noisePng)
    const meta = await storage.statEmployeePhoto(photoPath)

    const thumbnail = await thumbs.readEmployeePhotoThumbnail(photoPath, 96, meta)

    // 沒有透明的 PNG 縮成 JPEG（照片用 JPEG 最小）；最長邊 96，比例不變，也不會放大
    expect(thumbnail.mimeType).toBe('image/jpeg')
    const info = await sharp(thumbnail.buffer).metadata()
    expect(info.format).toBe('jpeg')
    expect(info.width).toBe(96)
    expect(info.height).toBe(69)
    expect(thumbnail.buffer.length).toBeLessThan(noisePng.length / 10)

    const cacheFile = path.join(storage.EMPLOYEE_PHOTO_THUMB_DIR, `${stemOf(photoPath)}.96.jpg`)
    expect((await fs.readFile(cacheFile)).equals(thumbnail.buffer)).toBe(true)
    expect(await thumbDirNames()).toContain(`${stemOf(photoPath)}.96.jpg`)
    if (process.platform !== 'win32') {
      expect((await fs.stat(cacheFile)).mode & 0o777).toBe(0o600)
    }
  })

  it('writes the cached thumbnail owner-only (mode 0600) through a temp file that is renamed into place', async () => {
    const photoPath = await storePhoto(noiseJpeg)
    const meta = await storage.statEmployeePhoto(photoPath)
    const realWriteFile = fs.writeFile.bind(fs)
    const writes = []
    jest.spyOn(fs, 'writeFile').mockImplementation(async (file, data, options) => {
      if (String(file).includes('.thumbs')) writes.push({ file: String(file), options })
      return realWriteFile(file, data, options)
    })
    const realRename = fs.rename.bind(fs)
    const renames = []
    jest.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).includes('.thumbs')) renames.push({ from: String(from), to: String(to) })
      return realRename(from, to)
    })

    await thumbs.readEmployeePhotoThumbnail(photoPath, 96, meta)

    // writeFile 的 mode 在 Windows 上不會反映到檔案權限，所以直接檢查傳給 writeFile 的參數；非 Windows 另外看實際權限
    expect(writes).toHaveLength(1)
    expect(writes[0].options).toEqual({ flag: 'wx', mode: 0o600 })
    expect(writes[0].file).toMatch(/\.96\.jpg\.[0-9a-f-]+\.tmp$/)
    expect(renames).toEqual([{ from: writes[0].file, to: path.join(storage.EMPLOYEE_PHOTO_THUMB_DIR, `${stemOf(photoPath)}.96.jpg`) }])
    // 只看這張照片自己的檔案：別的行程可能正在寫它自己的縮圖（.tmp）
    expect((await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(photoPath)}.`)).some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('makes one cached file per step and never more than the six steps', async () => {
    const photoPath = await storePhoto(noiseJpeg)
    const meta = await storage.statEmployeePhoto(photoPath)

    const sizes = [48, 96, 160, 256, 384, 512]
    for (const size of sizes) {
      const thumbnail = await thumbs.readEmployeePhotoThumbnail(photoPath, size, meta)
      const info = await sharp(thumbnail.buffer).metadata()
      // 700x500 的原圖：每個檔位都比原圖小（512 也比 700 小），所以每一檔都真的縮出一份
      expect(Math.max(info.width, info.height)).toBe(size)
    }
    const mine = (await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(photoPath)}.`))
    expect(mine).toEqual(sizes.map((size) => `${stemOf(photoPath)}.${size}.jpg`).sort())
  })

  it('refuses a size that is not one of the steps', async () => {
    const photoPath = await storePhoto(noiseJpeg)
    const meta = await storage.statEmployeePhoto(photoPath)

    expect(await thumbs.readEmployeePhotoThumbnail(photoPath, 100, meta)).toBeNull()
    expect(await thumbs.readEmployeePhotoThumbnail(photoPath, 100000, meta)).toBeNull()
    expect((await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(photoPath)}.`))).toEqual([])
  })

  it('reads the cached file the second time instead of decoding the original again', async () => {
    const photoPath = await storePhoto(noiseJpeg)
    const meta = await storage.statEmployeePhoto(photoPath)
    await thumbs.readEmployeePhotoThumbnail(photoPath, 96, meta)

    // 把快取檔換成另一張可辨識的圖（時間比原檔新）：第二次拿到的是它，代表真的是讀快取
    const cacheFile = path.join(storage.EMPLOYEE_PHOTO_THUMB_DIR, `${stemOf(photoPath)}.96.jpg`)
    const marker = await solidImage(10, 10, '#00ff00').jpeg().toBuffer()
    await fs.writeFile(cacheFile, marker)
    const second = await thumbs.readEmployeePhotoThumbnail(photoPath, 96, meta)

    expect(second.buffer.equals(marker)).toBe(true)
  })

  it('keeps a PNG that has transparency as a PNG with its alpha channel', async () => {
    const photoPath = await storePhoto(transparentPng)
    const meta = await storage.statEmployeePhoto(photoPath)

    const thumbnail = await thumbs.readEmployeePhotoThumbnail(photoPath, 96, meta)

    expect(thumbnail.mimeType).toBe('image/png')
    const info = await sharp(thumbnail.buffer).metadata()
    expect(info.format).toBe('png')
    expect(info.hasAlpha).toBe(true)
    expect(info.width).toBe(96)
    expect(await thumbDirNames()).toContain(`${stemOf(photoPath)}.96.png`)
  })

  it('turns a big GIF into a still thumbnail and a WebP into a JPEG', async () => {
    // GIF 的調色盤最佳化很慢（600x600 的雜訊圖預設要好幾秒），測試只需要一張夠大的 GIF，所以用最低的 effort
    const gifPath = await storePhoto(await noiseImage(600, 600).gif({ effort: 1 }).toBuffer())
    const webpPath = await storePhoto(await noiseImage(600, 600).webp({ quality: 80 }).toBuffer())

    const gif = await thumbs.readEmployeePhotoThumbnail(gifPath, 96, await storage.statEmployeePhoto(gifPath))
    const webp = await thumbs.readEmployeePhotoThumbnail(webpPath, 96, await storage.statEmployeePhoto(webpPath))

    const gifInfo = await sharp(gif.buffer).metadata()
    expect(gifInfo.width).toBe(96)
    // 縮圖是靜態圖（動態 GIF 也只取第一格），不是 GIF
    expect(gifInfo.format).not.toBe('gif')
    expect(gifInfo.pages ?? 1).toBe(1)
    expect((await sharp(webp.buffer).metadata()).format).toBe('jpeg')
    expect((await sharp(webp.buffer).metadata()).width).toBe(96)
  })

  it('turns the photo upright the way the browser shows it (EXIF orientation)', async () => {
    // 400x200 的像素，EXIF 方向 6（順時鐘轉 90 度）：瀏覽器顯示成 200x400，縮圖要和它一致
    const rotated = await solidImage(400, 200, '#336699').withMetadata({ orientation: 6 }).jpeg().toBuffer()
    expect((await sharp(rotated).metadata()).orientation).toBe(6)
    const photoPath = await storePhoto(rotated)

    const thumbnail = await thumbs.readEmployeePhotoThumbnail(photoPath, 96, await storage.statEmployeePhoto(photoPath))

    const info = await sharp(thumbnail.buffer).metadata()
    expect(info.width).toBe(48)
    expect(info.height).toBe(96)
  })

  it('sends the original as it is when it is not bigger than the requested step, and caches nothing', async () => {
    const tiny = await solidImage(40, 40, '#cc3300').png().toBuffer()
    const photoPath = await storePhoto(tiny)

    const thumbnail = await thumbs.readEmployeePhotoThumbnail(photoPath, 96, await storage.statEmployeePhoto(photoPath))

    expect(thumbnail.mimeType).toBe('image/png')
    expect(thumbnail.buffer.equals(tiny)).toBe(true)
    expect((await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(photoPath)}.`))).toEqual([])
  })

  it('makes a new thumbnail when the original has been replaced under the same name', async () => {
    const photoPath = await storePhoto(await solidImage(600, 600, '#ff0000').png().toBuffer())
    const first = await thumbs.readEmployeePhotoThumbnail(photoPath, 96, await storage.statEmployeePhoto(photoPath))
    const firstPixel = (await sharp(first.buffer).raw().toBuffer()).subarray(0, 3)
    expect(firstPixel[0]).toBeGreaterThan(200)
    expect(firstPixel[2]).toBeLessThan(60)

    // 同一個檔名換成藍色的圖，修改時間往後（原檔比縮圖新）
    const absolutePath = storage.resolveEmployeePhotoPath(photoPath)
    await fs.writeFile(absolutePath, await solidImage(600, 600, '#0000ff').png().toBuffer())
    const later = new Date(Date.now() + 60_000)
    await fs.utimes(absolutePath, later, later)

    const second = await thumbs.readEmployeePhotoThumbnail(photoPath, 96, await storage.statEmployeePhoto(photoPath))
    const secondPixel = (await sharp(second.buffer).raw().toBuffer()).subarray(0, 3)
    expect(secondPixel[2]).toBeGreaterThan(200)
    expect(secondPixel[0]).toBeLessThan(60)
  })

  it('generates one thumbnail when the same one is asked for many times at once', async () => {
    const photoPath = await storePhoto(noiseJpeg)
    const meta = await storage.statEmployeePhoto(photoPath)
    const realWriteFile = fs.writeFile.bind(fs)
    const thumbnailWrites = []
    jest.spyOn(fs, 'writeFile').mockImplementation(async (file, ...rest) => {
      if (String(file).includes('.thumbs')) thumbnailWrites.push(String(file))
      return realWriteFile(file, ...rest)
    })

    const results = await Promise.all(Array.from({ length: 6 }, () => thumbs.readEmployeePhotoThumbnail(photoPath, 160, meta)))

    expect(thumbnailWrites).toHaveLength(1)
    results.forEach((result) => expect(result.buffer.equals(results[0].buffer)).toBe(true))
  })

  it('gives up quietly on an original it cannot decode, remembers that, and leaves no file behind', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const photoPath = await storePhoto(Buffer.concat([pngMagic, Buffer.from('this is not really a png, only the first bytes are')]))
    const meta = await storage.statEmployeePhoto(photoPath)

    expect(await thumbs.readEmployeePhotoThumbnail(photoPath, 96, meta)).toBeNull()
    expect(await thumbs.readEmployeePhotoThumbnail(photoPath, 96, meta)).toBeNull()

    // 只記錄一次，而且 log 裡沒有檔案路徑
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(consoleError.mock.calls[0])).not.toContain('upload')
    expect((await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(photoPath)}.`))).toEqual([])
  })

  it('does not decode an image with an absurd pixel count', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    // 6500x6500 的單色 PNG 壓縮後只有幾十 KB，展開卻要 4200 萬個像素（上限是 4000 萬）
    const bomb = await sharp({ create: { width: 6500, height: 6500, channels: 3, background: '#ffffff' } })
      .png({ compressionLevel: 9 }).toBuffer()
    expect(bomb.length).toBeLessThan(storage.EMPLOYEE_PHOTO_MAX_SIZE)
    const photoPath = await storePhoto(bomb)

    expect(await thumbs.readEmployeePhotoThumbnail(photoPath, 96, await storage.statEmployeePhoto(photoPath))).toBeNull()
  }, 30000)

  it('removes the thumbnail it has just written when the original disappeared while it was working', async () => {
    const photoPath = await storePhoto(noiseJpeg)
    const meta = await storage.statEmployeePhoto(photoPath)
    const absolutePath = storage.resolveEmployeePhotoPath(photoPath)
    const realRename = fs.rename.bind(fs)
    // 縮圖剛寫好，原檔就被刪除程序刪掉了（刪除程序此時還沒輪到清縮圖）
    jest.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      await realRename(from, to)
      if (String(to).includes('.thumbs')) await fs.unlink(absolutePath)
    })

    const thumbnail = await thumbs.readEmployeePhotoThumbnail(photoPath, 96, meta)

    expect(thumbnail.buffer.length).toBeGreaterThan(0)
    expect((await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(photoPath)}.`))).toEqual([])
  })
})

describe('thumbnails are removed together with the original', () => {
  it('deletes every thumbnail and leftover temp file of that photo, and only that photo', async () => {
    const mine = await storePhoto(noiseJpeg)
    const theirs = await storePhoto(noisePng)
    for (const size of [48, 96, 160]) {
      await thumbs.readEmployeePhotoThumbnail(mine, size, await storage.statEmployeePhoto(mine))
    }
    await thumbs.readEmployeePhotoThumbnail(theirs, 96, await storage.statEmployeePhoto(theirs))
    await fs.writeFile(path.join(storage.EMPLOYEE_PHOTO_THUMB_DIR, `${stemOf(mine)}.96.jpg.leftover.tmp`), 'half written')
    expect((await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(mine)}.`))).toHaveLength(4)

    expect(await storage.deleteEmployeePhoto(mine)).toBe(true)

    const names = await thumbDirNames()
    expect(names.filter((name) => name.startsWith(`${stemOf(mine)}.`))).toEqual([])
    expect(names).toContain(`${stemOf(theirs)}.96.jpg`)
    await expect(fs.stat(storage.resolveEmployeePhotoPath(mine))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('also clears thumbnails whose original is already gone, and does nothing for a path it does not manage', async () => {
    const photoPath = await storePhoto(noiseJpeg)
    await thumbs.readEmployeePhotoThumbnail(photoPath, 96, await storage.statEmployeePhoto(photoPath))
    await fs.unlink(storage.resolveEmployeePhotoPath(photoPath))

    expect(await storage.deleteEmployeePhoto(photoPath)).toBe(false)
    expect((await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(photoPath)}.`))).toEqual([])
    expect(await storage.deleteEmployeePhoto('/upload/payroll.xlsx')).toBe(false)
    expect(await storage.deleteEmployeePhotoThumbnails('/upload/employees/../../x')).toBe(0)
  })

  it('does not fail the deletion of the photo when the thumbnail folder cannot be cleaned', async () => {
    const photoPath = await storePhoto(noiseJpeg)
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(fs, 'readdir').mockRejectedValue(Object.assign(new Error("EACCES: permission denied, scandir 'D:\\hr\\upload'"), { code: 'EACCES' }))

    await expect(storage.deleteEmployeePhoto(photoPath)).resolves.toBe(true)

    expect(consoleError).toHaveBeenCalledWith('Employee photo thumbnail cleanup failed', { code: 'EACCES' })
  })
})

describe('replacing the photo through PUT /api/employees/:id', () => {
  const put = () => request(app).put(`/api/employees/${EMPLOYEE_ID}`)
  const get = (query = {}) => request(app).get(`/api/employees/${EMPLOYEE_ID}/photo`).query(query)
  const thumbnailsOf = async (photoPath) => (await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(photoPath)}.`))

  beforeEach(() => {
    requestUser = { id: 'admin1', role: 'admin' }
    stored = { _id: EMPLOYEE_ID, name: 'John', email: 'john@example.com', role: 'employee', status: '正職員工', accountEnabled: true, photo: '' }
    mockEmployee.countDocuments.mockResolvedValue(1)
    mockEmployee.exists.mockResolvedValue(null)
    mockEmployee.updateOne.mockImplementation(async (_filter, update) => {
      Object.assign(stored, update.$set)
      return { matchedCount: 1, modifiedCount: 1 }
    })
  })

  it('removes the old photo together with all of its thumbnails, and the new photo gets its own thumbnails', async () => {
    const oldPath = await storePhoto(noisePng)
    stored.photo = oldPath
    const oldThumbnail = await get({ size: 96 })
    await get({ size: 160 })
    expect(await thumbnailsOf(oldPath)).toEqual([`${stemOf(oldPath)}.160.jpg`, `${stemOf(oldPath)}.96.jpg`].sort())

    const res = await put()
      .field('data', JSON.stringify({ name: 'John Chen', photo: oldPath }))
      .attach('photo', noiseJpeg, { filename: 'new.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    const newPath = res.body.photo
    createdPhotos.push(newPath)
    expect(newPath).not.toBe(oldPath)
    // 舊照片與它的縮圖一起收掉
    expect(await storage.statEmployeePhoto(oldPath)).toBeNull()
    expect(await thumbnailsOf(oldPath)).toEqual([])
    // 新照片還沒有人要過縮圖：現在沒有；第一次要的時候才現做
    expect(await thumbnailsOf(newPath)).toEqual([])
    const newThumbnail = await get({ size: 96 })
    expect(newThumbnail.status).toBe(200)
    expect((await sharp(newThumbnail.body).metadata()).width).toBe(96)
    expect(newThumbnail.headers.etag).not.toBe(oldThumbnail.headers.etag)
    expect(await thumbnailsOf(newPath)).toEqual([`${stemOf(newPath)}.96.jpg`])
  })

  it('keeps the photo and its thumbnails when the save does not replace the photo', async () => {
    const photoPath = await storePhoto(noisePng)
    stored.photo = photoPath
    await get({ size: 96 })

    const res = await put().send({ name: 'Renamed', photo: photoPath })

    expect(res.status).toBe(200)
    expect(await storage.statEmployeePhoto(photoPath)).not.toBeNull()
    expect(await thumbnailsOf(photoPath)).toEqual([`${stemOf(photoPath)}.96.jpg`])
  })

  it('removes the thumbnails too when the photo is cleared', async () => {
    const photoPath = await storePhoto(noisePng)
    stored.photo = photoPath
    await get({ size: 96 })

    const res = await put().send({ name: 'Renamed', photo: '' })

    expect(res.status).toBe(200)
    expect(stored.photo).toBe('')
    expect(await storage.statEmployeePhoto(photoPath)).toBeNull()
    expect(await thumbnailsOf(photoPath)).toEqual([])
  })

  it('keeps the old photo and its thumbnails when the same file is still used by another employee', async () => {
    const photoPath = await storePhoto(noisePng)
    stored.photo = photoPath
    await get({ size: 96 })
    mockEmployee.exists.mockResolvedValue({ _id: OTHER_ID })

    const res = await put()
      .field('data', JSON.stringify({ name: 'John Chen', photo: photoPath }))
      .attach('photo', noiseJpeg, { filename: 'new.jpg', contentType: 'image/jpeg' })

    expect(res.status).toBe(200)
    createdPhotos.push(res.body.photo)
    expect(await storage.statEmployeePhoto(photoPath)).not.toBeNull()
    expect(await thumbnailsOf(photoPath)).toEqual([`${stemOf(photoPath)}.96.jpg`])
  })
})

describe('GET /api/employees/:id/photo?size= over HTTP', () => {
  const get = (query = {}, id = EMPLOYEE_ID) => request(app).get(`/api/employees/${id}/photo`).query(query)

  async function givePhoto(buffer = noisePng) {
    const photoPath = await storePhoto(buffer)
    stored.photo = photoPath
    return photoPath
  }

  it('answers a small thumbnail of the photo with the same safe headers, and the full image without ?size=', async () => {
    const photoPath = await givePhoto()

    const thumbnail = await get({ size: 96 })
    const full = await get()

    expect(thumbnail.status).toBe(200)
    expect(thumbnail.headers['content-type']).toBe('image/jpeg')
    expect(thumbnail.headers['x-content-type-options']).toBe('nosniff')
    expect(thumbnail.headers['content-security-policy']).toBe("default-src 'none'; sandbox")
    expect(thumbnail.headers.vary).toMatch(/Authorization/i)
    expect(thumbnail.headers['cache-control']).toBe('private, no-cache')
    expect(thumbnail.headers.etag).toMatch(/^"[0-9a-f]{24}"$/)
    expect((await sharp(thumbnail.body).metadata()).width).toBe(96)
    expect(thumbnail.body.length).toBeLessThan(full.body.length / 10)

    expect(full.status).toBe(200)
    expect(full.headers['content-type']).toBe('image/png')
    expect(full.body.equals(noisePng)).toBe(true)
    expect(full.headers.etag).not.toBe(thumbnail.headers.etag)

    // 縮圖有自己的快取檔
    expect(await thumbDirNames()).toContain(`${stemOf(photoPath)}.96.jpg`)
  })

  it('lets the browser cache a thumbnail for five minutes only when it names the current photo file', async () => {
    const photoPath = await givePhoto()
    const version = photoPath.split('/').pop()

    const versioned = await get({ size: 96, v: version })
    const stale = await get({ size: 96, v: 'employee_previous.png' })

    expect(versioned.headers['cache-control']).toBe('private, max-age=300, must-revalidate')
    expect(stale.headers['cache-control']).toBe('private, no-cache')
  })

  it('answers 304 without reading any file when the browser already has that thumbnail', async () => {
    await givePhoto()
    const first = await get({ size: 96 })
    const etag = first.headers.etag
    const readFile = jest.spyOn(fs, 'readFile')
    const readdir = jest.spyOn(fs, 'readdir')

    const again = await get({ size: 96 }).set('If-None-Match', etag)

    expect(again.status).toBe(304)
    expect(again.text ?? '').toBe('')
    expect(again.headers.etag).toBe(etag)
    expect(readFile).not.toHaveBeenCalled()
    expect(readdir).not.toHaveBeenCalled()
  })

  it('never answers 304 for the wrong representation: a thumbnail validator does not match the full image or another size', async () => {
    await givePhoto()
    const thumbnail = await get({ size: 96 })
    const otherSize = await get({ size: 160 })
    expect(otherSize.headers.etag).not.toBe(thumbnail.headers.etag)

    const fullWithThumbnailTag = await get().set('If-None-Match', thumbnail.headers.etag)
    const otherSizeWithTag = await get({ size: 160 }).set('If-None-Match', thumbnail.headers.etag)

    expect(fullWithThumbnailTag.status).toBe(200)
    expect(fullWithThumbnailTag.body.equals(noisePng)).toBe(true)
    expect(otherSizeWithTag.status).toBe(200)
  })

  it('makes a different validator when the photo is replaced, so the old thumbnail cannot be revalidated', async () => {
    await givePhoto()
    const first = await get({ size: 96 })
    await givePhoto(noiseJpeg)

    const replaced = await get({ size: 96 }).set('If-None-Match', first.headers.etag)

    expect(replaced.status).toBe(200)
    expect(replaced.headers.etag).not.toBe(first.headers.etag)
    expect((await sharp(replaced.body).metadata()).width).toBe(96)
  })

  it('snaps a size in 48..512 up to a step, and serves the original for anything else', async () => {
    await givePhoto()

    const widthOf = async (query) => (await sharp((await get(query)).body).metadata()).width
    expect(await widthOf({ size: 48 })).toBe(48)
    expect(await widthOf({ size: 64 })).toBe(96)
    expect(await widthOf({ size: 100 })).toBe(160)
    expect(await widthOf({ size: 512 })).toBe(512)

    // 超出 48 ~ 512 的數字與不是整數的值一律忽略：回的是原圖（不是夾到邊界的縮圖）
    for (const ignored of ['0', '1', '47', '513', '100000', 'abc', '96px', '-5', '1e3', '96.5', '', '1234567']) {
      const res = await get({ size: ignored })
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe('image/png')
      expect(res.body.equals(noisePng)).toBe(true)
    }
    // 重複的 size（陣列）與物件形式的 size 也當作垃圾
    const repeated = await request(app).get(`/api/employees/${EMPLOYEE_ID}/photo?size=96&size=160`)
    const nested = await request(app).get(`/api/employees/${EMPLOYEE_ID}/photo?size[a]=96`)
    expect(repeated.body.equals(noisePng)).toBe(true)
    expect(nested.body.equals(noisePng)).toBe(true)

    // 不論怎麼亂帶，快取資料夾裡這張照片只有上面實際要過的那幾份，垃圾值沒有留下任何檔案
    const mine = (await thumbDirNames()).filter((name) => name.startsWith(`${stemOf(stored.photo)}.`))
    expect(mine).toEqual([48, 96, 160, 512].map((size) => `${stemOf(stored.photo)}.${size}.jpg`).sort())
  })

  it('sends the original of a photo that is already small', async () => {
    const tiny = await solidImage(40, 40, '#cc3300').png().toBuffer()
    await givePhoto(tiny)

    const res = await get({ size: 96 })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.body.equals(tiny)).toBe(true)
  })

  it('sends the original when the photo cannot be decoded, instead of an error', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {})
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const broken = Buffer.concat([pngMagic, Buffer.from('this is not really a png, only the first bytes are')])
    await givePhoto(broken)

    const res = await get({ size: 96 })

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.body.equals(broken)).toBe(true)
  })

  it('needs a signed-in user and shows the thumbnail to any of them, like the full image', async () => {
    await givePhoto()

    requestUser = undefined
    const anonymous = await get({ size: 96 })
    expect(anonymous.status).toBe(401)

    for (const user of [
      { id: OTHER_ID, role: 'employee' },
      { id: 'sup-elsewhere', role: 'supervisor' },
      { id: 'admin1', role: 'admin' },
    ]) {
      requestUser = user
      const res = await get({ size: 96 })
      expect(res.status).toBe(200)
      expect((await sharp(res.body).metadata()).width).toBe(96)
    }
  })

  it('answers the same uncacheable 404 as the full image for no photo, a missing file and a malformed id', async () => {
    const noPhoto = await get({ size: 96 })
    stored.photo = '/upload/employees/employee_gone.png'
    const missingFile = await get({ size: 96 })
    const failure = Object.assign(new Error('Cast to ObjectId failed'), { name: 'CastError' })
    mockEmployee.findById.mockImplementation(() => ({ select: jest.fn().mockRejectedValue(failure) }))
    const badId = await get({ size: 96 }, 'not-an-id')

    for (const res of [noPhoto, missingFile, badId]) {
      expect(res.status).toBe(404)
      expect(res.headers['cache-control']).toBe('no-store')
      expect(res.body).toEqual({ error: 'Not found' })
    }
    expect(await thumbDirNames()).not.toContain('employee_gone.96.jpg')
  })

  it('serves a thumbnail of a photo that an older version stored as a full URL', async () => {
    const photoPath = await givePhoto()
    stored.photo = `http://localhost:3000${photoPath}`

    const res = await get({ size: 96 })

    expect(res.status).toBe(200)
    expect((await sharp(res.body).metadata()).width).toBe(96)
  })

  it('does not echo system error text when the thumbnail folder cannot be written; the original is served instead', async () => {
    await givePhoto()
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(fs, 'mkdir').mockRejectedValue(Object.assign(new Error("EACCES: permission denied, mkdir 'D:\\hr\\upload'"), { code: 'EACCES' }))

    const res = await get({ size: 96 })

    expect(res.status).toBe(200)
    expect(res.body.equals(noisePng)).toBe(true)
  })
})
