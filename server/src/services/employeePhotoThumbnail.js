import crypto from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import {
  EMPLOYEE_PHOTO_THUMB_DIR,
  readEmployeePhoto,
  resolveEmployeePhotoPath,
} from './employeePhotoStorage.js'

/* 員工照片縮圖 ------------------------------------------------------------------
 * 頭像只有幾十個像素，畫面上卻到處都是：每一個都載入原圖（最大 5MB）太浪費。
 * GET /api/employees/:id/photo?size=<像素> 回傳縮圖：
 * - 邊長只有固定幾個檔位（與前端 utils/photoUrl.js 的 PHOTO_SIZE_STEPS 相同），要多少就往上取到最接近的檔位，
 *   所以磁碟上每張照片最多只有幾份縮圖，亂帶 ?size= 也撐不大快取
 * - 縮圖用 sharp 產生，存在 upload/employees/.thumbs/，檔名是「原檔名.邊長.副檔名」；原檔刪除時一併刪除（見 deleteEmployeePhoto）
 * - sharp 是原生套件：載入不了（平台沒有預編譯檔…）就當作沒有縮圖功能，端點直接回傳原檔，畫面照樣能用
 */

// 縮圖邊長（像素）：與前端 PHOTO_SIZE_STEPS 一致；伺服器接受 48 ~ 512 的任何整數，再往上取到這些檔位
export const EMPLOYEE_PHOTO_THUMB_SIZES = Object.freeze([48, 96, 160, 256, 384, 512])
export const EMPLOYEE_PHOTO_THUMB_MIN_SIZE = EMPLOYEE_PHOTO_THUMB_SIZES[0]
export const EMPLOYEE_PHOTO_THUMB_MAX_SIZE = EMPLOYEE_PHOTO_THUMB_SIZES[EMPLOYEE_PHOTO_THUMB_SIZES.length - 1]

// 縮圖的編碼參數改了就要換這個值：ETag 會跟著變，瀏覽器會重新取圖
const THUMBNAIL_VERSION = 1
const JPEG_QUALITY = 82
// 解碼上限：5MB 的 PNG 可能展開成幾億個像素（解壓縮炸彈），超過就當作無法縮圖，改回原檔
const MAX_INPUT_PIXELS = 40 * 1000 * 1000
// 同時解碼的張數：一整頁頭像第一次載入時，不要同時把幾十張原圖讀進記憶體
const MAX_CONCURRENT_GENERATIONS = 3
const MAX_REMEMBERED_FAILURES = 1000

const THUMBNAIL_FORMATS = {
  jpg: 'image/jpeg',
  png: 'image/png',
}

/**
 * 解析 ?size=。只認 48 ~ 512 的整數（純數字、不帶正負號與小數），再往上取到最接近的檔位（例如 64 -> 96、100 -> 160）：
 * - 沒帶、不是整數（abc、1e3、96.5、-5、陣列、物件…）或超出 48 ~ 512 的範圍，一律忽略，回傳 null（呼叫端回原檔）
 * - 不照單全收是為了擋住亂帶的值：縮圖快取每張照片最多只會有檔位那幾份
 */
export function parseThumbnailSize(raw) {
  if (typeof raw !== 'string' || !/^[1-9]\d{0,2}$/.test(raw)) return null
  const wanted = Number(raw)
  if (wanted < EMPLOYEE_PHOTO_THUMB_MIN_SIZE || wanted > EMPLOYEE_PHOTO_THUMB_MAX_SIZE) return null
  return EMPLOYEE_PHOTO_THUMB_SIZES.find((step) => step >= wanted) ?? null
}

/** 縮圖的 ETag：由原檔的狀態（路徑、大小、修改時間）與檔位算出，不必讀檔就能回 304；與原檔的 ETag 不會相同 */
export function employeePhotoThumbnailEtag(storedPath, size, meta) {
  const digest = crypto
    .createHash('sha1')
    .update(`${storedPath}|${meta.size}|${Math.trunc(meta.mtimeMs)}|thumb:${size}:${THUMBNAIL_VERSION}`)
    .digest('hex')
    .slice(0, 24)
  return `"${digest}"`
}

/* sharp 載入：第一次用到才載入，結果（含失敗）整個程序共用 ---------------------- */

let sharpPromise = null

export function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = import('sharp')
      .then((module) => {
        const sharp = module?.default ?? module
        if (typeof sharp !== 'function') throw new TypeError('sharp is not a function')
        return sharp
      })
      .catch((error) => {
        // 只記錄錯誤代碼，不把系統路徑寫進 log
        console.warn('sharp unavailable, employee photo thumbnails are disabled', { code: error?.code ?? error?.name ?? 'Error' })
        return null
      })
  }
  return sharpPromise
}

/** 測試用：忘掉已經載入（或載入失敗）的 sharp 與失敗紀錄 */
export function resetEmployeePhotoThumbnailState() {
  sharpPromise = null
  failedThumbnails.clear()
}

/* 同時產生的縮圖數量上限 ------------------------------------------------------- */

let activeGenerations = 0
const waitingGenerations = []

function acquireGenerationSlot() {
  if (activeGenerations < MAX_CONCURRENT_GENERATIONS) {
    activeGenerations += 1
    return Promise.resolve()
  }
  return new Promise((resolve) => waitingGenerations.push(resolve))
}

// 有人在等就把名額直接交給下一位（名額數不變），沒有人等才歸還
function releaseGenerationSlot() {
  const next = waitingGenerations.shift()
  if (next) next()
  else activeGenerations -= 1
}

/* 縮圖快取 --------------------------------------------------------------------- */

const inFlight = new Map() // 同一份縮圖同時被要求時只產生一次
const failedThumbnails = new Set() // 這個版本的原檔無法縮圖（損毀、太大…）：不要每次請求都再試、再記錄一次

function thumbnailStem(absolutePath) {
  return path.basename(absolutePath, path.extname(absolutePath))
}

function thumbnailPath(stem, size, extension) {
  return path.join(EMPLOYEE_PHOTO_THUMB_DIR, `${stem}.${size}.${extension}`)
}

async function readCachedThumbnail(stem, size, originalMtimeMs) {
  for (const [extension, mimeType] of Object.entries(THUMBNAIL_FORMATS)) {
    const file = thumbnailPath(stem, size, extension)
    try {
      const stat = await fs.stat(file)
      if (!stat.isFile() || stat.size <= 0) continue
      // 縮圖比原檔舊：原檔被換過（同一個檔名被覆寫），這份縮圖已經過期，丟掉重做
      if (stat.mtimeMs < originalMtimeMs) {
        await fs.unlink(file).catch(() => {})
        continue
      }
      return { buffer: await fs.readFile(file), mimeType }
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue
      throw error
    }
  }
  return null
}

async function storeThumbnail(stem, size, extension, buffer) {
  const finalPath = thumbnailPath(stem, size, extension)
  // 先寫暫存檔再改名：讀取的人不會看到寫到一半的縮圖。暫存檔名同樣以原檔名開頭，萬一中斷留下來，刪除原檔時也會一起清掉
  const tempPath = `${finalPath}.${crypto.randomUUID()}.tmp`
  await fs.mkdir(EMPLOYEE_PHOTO_THUMB_DIR, { recursive: true })
  try {
    await fs.writeFile(tempPath, buffer, { flag: 'wx', mode: 0o600 })
    await fs.rename(tempPath, finalPath)
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {})
    throw error
  }
  return finalPath
}

async function generateThumbnail(sharp, storedPath, originalPath, stem, size) {
  const original = await readEmployeePhoto(storedPath)
  if (!original) return null

  const image = sharp(original.buffer, { limitInputPixels: MAX_INPUT_PIXELS })
  const info = await image.metadata()
  const longestEdge = Math.max(info.width || 0, info.height || 0)
  // 原圖本來就不比要求的邊長大：縮圖不會更小，直接送原檔（也保留 GIF 動畫），不另存一份
  if (longestEdge > 0 && longestEdge <= size) return original

  // rotate() 依 EXIF 方向轉正（瀏覽器顯示原檔時也會轉）；有透明的圖維持 PNG，其他一律 JPEG（照片用 JPEG 最小）
  const hasAlpha = Boolean(info.hasAlpha)
  const resized = image.rotate().resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
  const extension = hasAlpha ? 'png' : 'jpg'
  const buffer = await (hasAlpha
    ? resized.png({ compressionLevel: 9 })
    : resized.jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
  ).toBuffer()

  const finalPath = await storeThumbnail(stem, size, extension, buffer)
  // 產生縮圖的期間原檔可能剛好被換掉或刪除（刪除程序先刪原檔、再清縮圖）：寫完之後再確認一次，原檔已不在就把剛寫的縮圖收掉
  try {
    await fs.stat(originalPath)
  } catch (error) {
    if (error?.code === 'ENOENT') await fs.unlink(finalPath).catch(() => {})
  }
  return { buffer, mimeType: THUMBNAIL_FORMATS[extension] }
}

async function produceThumbnail(sharp, storedPath, originalPath, stem, size, meta) {
  const failureKey = `${stem}|${size}|${Math.trunc(meta.mtimeMs)}`
  if (failedThumbnails.has(failureKey)) return null

  try {
    const cached = await readCachedThumbnail(stem, size, meta.mtimeMs)
    if (cached) return cached

    await acquireGenerationSlot()
    try {
      return await generateThumbnail(sharp, storedPath, originalPath, stem, size)
    } finally {
      releaseGenerationSlot()
    }
  } catch (error) {
    // 原圖本身無法解碼（損毀、像素太多）才記住：重試也不會成功。磁碟錯誤（EACCES、ENOSPC…）可能只是暫時的，不記住
    if (!/^E[A-Z0-9]+$/.test(String(error?.code ?? ''))) {
      if (failedThumbnails.size >= MAX_REMEMBERED_FAILURES) failedThumbnails.clear()
      failedThumbnails.add(failureKey)
    }
    // 縮圖是加分功能：失敗時只記錄錯誤代碼，呼叫端改送原檔
    console.error('Employee photo thumbnail failed', { error: error?.name ?? 'Error', code: error?.code })
    return null
  }
}

/**
 * 取得照片的縮圖 { buffer, mimeType }。
 * size 必須是 parseThumbnailSize 的結果；meta 是 statEmployeePhoto 的結果（用來判斷快取是否過期）。
 * 回傳 null 代表做不出縮圖（sharp 載入不了、原檔無法解碼…），呼叫端應改送原檔。
 * 原圖本來就不比 size 大時，回傳的就是原檔內容。
 */
export async function readEmployeePhotoThumbnail(storedPath, size, meta) {
  const sharp = await loadSharp()
  if (!sharp) return null
  const originalPath = resolveEmployeePhotoPath(storedPath)
  if (!originalPath || !EMPLOYEE_PHOTO_THUMB_SIZES.includes(size) || !meta) return null

  const stem = thumbnailStem(originalPath)
  const key = `${stem}.${size}.${Math.trunc(meta.mtimeMs)}`
  let pending = inFlight.get(key)
  if (!pending) {
    pending = produceThumbnail(sharp, storedPath, originalPath, stem, size, meta)
      .finally(() => inFlight.delete(key))
    inFlight.set(key, pending)
  }
  return pending
}
