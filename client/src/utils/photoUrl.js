import { API_BASE_URL, apiFetch } from '../api'
import { getToken } from './tokenService'

/* 員工照片快取 ---------------------------------------------------------------
 * 員工照片是私有檔案，只能帶著登入 token 向 /api/employees/:id/photo 取得（fetch -> blob -> object URL）。
 * 畫面上到處都會出現人頭像，所以統一在這裡處理：
 * - 同一位員工的同一張照片只下載一次（含同時發出的請求），同時下載數量有上限
 * - 找不到的照片短時間內不重試（負向快取），避免整頁頭像各打一次 404
 * - object URL 由快取擁有：有畫面在用就不回收，最後一個使用者放開、被新照片取代或登出時才回收
 * - 編輯員工照片後呼叫 invalidateEmployeePhoto，所有正在顯示該員工的頭像會自動重新載入
 */
const MAX_CONCURRENT_REQUESTS = 6
const MAX_CACHED_PHOTOS = 300
// 照片本身可能有好幾 MB：除了張數，也限制快取佔用的記憶體
const MAX_CACHED_BYTES = 48 * 1024 * 1024
// 超過這段時間的照片下次被使用時重新向伺服器確認（伺服器用 ETag 回 304，不會重傳）
const PHOTO_REVALIDATE_MS = 10 * 60 * 1000
const MISSING_PHOTO_TTL_MS = 60 * 1000
const FAILED_PHOTO_TTL_MS = 5 * 1000

const photoEntries = new Map() // key -> { key, employeeId, url, size, refs, fetchedAt, dead }（Map 的順序即最近使用順序）
const retiredEntries = new Set() // 已被取代但仍有畫面在用的項目，最後一個使用者放開時才回收
const missingPhotos = new Map() // key -> 負向快取到期時間
const pendingLoads = new Map() // 下載中的請求 loadKey -> { promise, waiters }，同一張照片共用
const photoEpochs = new Map() // employeeId -> 失效次數
const photoListeners = new Map() // employeeId（'*' 代表全部）-> Set<callback>
const managedUrls = new Set() // 由快取建立的 object URL
let cacheEpoch = 0
let cacheSession = null
let cachedBytes = 0
let activeRequests = 0
const waitingRequests = []

function photoKey(employeeId, version) {
  return `${employeeId}\n${version}`
}

// 照片路徑最後的檔名：每次上傳都是新的檔名，換照片它就會變，用來當快取的版本，也是網址的版本參數（?v=）。
// 只看檔名，所以同一張照片不論伺服器給的是 /upload/... 還是完整網址，都共用同一份快取
function photoFileName(photoPath) {
  if (typeof photoPath !== 'string') return ''
  const cleanPath = photoPath.split(/[?#]/)[0]
  return cleanPath.split('/').filter(Boolean).pop() || ''
}

const photoVersion = photoFileName

function employeeEpoch(employeeId) {
  return photoEpochs.get(employeeId) || 0
}

function revokeObjectUrl(url) {
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(url)
    } catch {
      // 回收失敗不影響畫面
    }
  }
}

function destroyEntry(entry) {
  if (entry.dead) return
  entry.dead = true
  cachedBytes = Math.max(0, cachedBytes - entry.size)
  managedUrls.delete(entry.url)
  revokeObjectUrl(entry.url)
}

// 把項目從快取拿掉；還有畫面在用就先留著，等最後一個使用者放開再回收
function dropEntry(entry) {
  if (photoEntries.get(entry.key) === entry) photoEntries.delete(entry.key)
  if (entry.refs > 0) retiredEntries.add(entry)
  else destroyEntry(entry)
}

const cacheIsFull = () => photoEntries.size > MAX_CACHED_PHOTOS || cachedBytes > MAX_CACHED_BYTES

function trimCache(keep = null) {
  if (!cacheIsFull()) return
  // Map 的順序就是最近使用順序：從最久沒用的開始回收，正在顯示的（refs > 0）不動
  for (const entry of [...photoEntries.values()]) {
    if (!cacheIsFull()) break
    if (entry.refs === 0 && entry !== keep) dropEntry(entry)
  }
}

// adopt：下載完成時已經替每一位等待的呼叫端先算好一份使用數（避免剛建立的項目在呼叫端接手之前就被別的下載回收），這裡不再加一
function makeLease(entry, { adopt = false } = {}) {
  if (!adopt) entry.refs += 1
  // 重新放到 Map 尾端，代表剛用過
  if (photoEntries.get(entry.key) === entry) {
    photoEntries.delete(entry.key)
    photoEntries.set(entry.key, entry)
  }
  let released = false
  return {
    url: entry.url,
    // 需要自己持有一份 object URL 的呼叫端（例如交給 Element Plus el-upload：它會自己 revoke）用這個 Blob 另外建立，
    // 不能直接拿共用快取的 url，否則 revoke 之後所有顯示同一張照片的頭像都會壞掉
    blob: entry.blob || null,
    release() {
      if (released) return
      released = true
      entry.refs = Math.max(0, entry.refs - 1)
      if (entry.refs > 0) return
      if (retiredEntries.delete(entry)) {
        destroyEntry(entry)
        return
      }
      trimCache()
    },
  }
}

const emptyLease = () => ({ url: null, blob: null, release() {} })

function isDirectPhotoUrl(value) {
  return typeof value === 'string' && /^(blob|data):/i.test(value)
}

function notifyPhotoListeners(employeeId) {
  const targets = new Set([
    ...(photoListeners.get(employeeId) || []),
    ...(photoListeners.get('*') || []),
  ])
  targets.forEach(callback => {
    try {
      callback(employeeId)
    } catch {
      // 一個頭像出錯不能影響其他頭像
    }
  })
}

// 換了登入帳號（token 不同）就清掉快取：別人的照片不可以留給下一個登入者
function currentSession() {
  try {
    return getToken() || ''
  } catch {
    return ''
  }
}

// 登出的那一刻（原本有登入、現在沒有 token）通知頭像的同步視窗內為 true：
// 頭像收到通知會馬上重新載入，不擋掉的話每個頭像各打一個必定 401 的請求
let sessionEnded = false

function syncSession() {
  const token = currentSession()
  // 先記下新的 token 再清除：清除會通知頭像重新載入，重新載入又會回到這裡
  const changed = cacheSession !== null && cacheSession !== token
  cacheSession = token
  if (changed) clearEmployeePhotoCache()
}

function pumpRequests() {
  while (activeRequests < MAX_CONCURRENT_REQUESTS && waitingRequests.length) {
    const job = waitingRequests.shift()
    activeRequests += 1
    job.task().then(job.resolve, job.reject).finally(() => {
      activeRequests -= 1
      pumpRequests()
    })
  }
}

function enqueueRequest(task) {
  return new Promise((resolve, reject) => {
    waitingRequests.push({ task, resolve, reject })
    pumpRequests()
  })
}

async function downloadPhoto(employeeId, photoPath) {
  try {
    // 網址帶上目前照片的檔名當版本（?v=）：換照片後網址就不同，瀏覽器不會拿舊圖的快取；伺服器會忽略這個參數。
    // 不知道檔名時沒有版本可以依靠，改成每次先向伺服器確認（If-None-Match -> 304，不會重傳）
    const version = photoFileName(photoPath)
    const response = await apiFetch(
      `/api/employees/${encodeURIComponent(employeeId)}/photo${version ? `?v=${encodeURIComponent(version)}` : ''}`,
      version ? {} : { cache: 'no-cache' },
      { autoRedirect: false },
    )
    if (!response?.ok) {
      const status = Number(response?.status)
      // 403 / 404 代表這張照片就是看不到（沒有照片或沒有權限），短時間內不必再問；
      // 429 / 5xx / 連線失敗只擋幾秒，避免一直重打
      const denied = status >= 400 && status < 500 && status !== 429
      return { status: denied ? 'missing' : 'error' }
    }
    const blob = await response.blob()
    if (!blob?.type?.startsWith('image/')) return { status: 'missing' }
    return { status: 'ok', blob }
  } catch {
    return { status: 'error' }
  }
}

// 下載期間照片被編輯（或登出）過，這份結果已經過期：呼叫端要重新來過，不能當成「沒有照片」
const STALE_LOAD = Symbol('stale-photo-load')

function loadPhoto(employeeId, photoPath, key) {
  const epoch = employeeEpoch(employeeId)
  const globalEpoch = cacheEpoch
  const loadKey = `${key}\n${epoch}\n${globalEpoch}`
  const existing = pendingLoads.get(loadKey)
  if (existing) {
    existing.waiters += 1
    return existing.promise
  }

  const record = { waiters: 1, promise: null }
  record.promise = enqueueRequest(() => downloadPhoto(employeeId, photoPath))
    .then(result => {
      // 從這一刻起新來的呼叫端會直接看到快取項目，不再加入這一批等待者
      if (pendingLoads.get(loadKey) === record) pendingLoads.delete(loadKey)
      if (epoch !== employeeEpoch(employeeId) || globalEpoch !== cacheEpoch) return STALE_LOAD
      if (result.status !== 'ok') {
        const ttl = result.status === 'missing' ? MISSING_PHOTO_TTL_MS : FAILED_PHOTO_TTL_MS
        missingPhotos.set(key, Date.now() + ttl)
        return null
      }
      let url = ''
      try {
        url = URL.createObjectURL(result.blob)
      } catch {
        missingPhotos.set(key, Date.now() + FAILED_PHOTO_TTL_MS)
        return null
      }
      const entry = {
        key,
        employeeId,
        url,
        blob: result.blob,
        size: Number(result.blob.size) || 0,
        refs: record.waiters,
        fetchedAt: Date.now(),
        dead: false,
      }
      // 一位員工同一時間只有一張目前的照片：換了檔名之後，這位員工舊版本的照片不必再留著（還有畫面在用的等放開再回收）
      for (const other of [...photoEntries.values()]) {
        if (other.employeeId === employeeId) dropEntry(other)
      }
      cachedBytes += entry.size
      managedUrls.add(entry.url)
      photoEntries.set(key, entry)
      trimCache(entry)
      return entry
    })
    .finally(() => {
      if (pendingLoads.get(loadKey) === record) pendingLoads.delete(loadKey)
    })
  pendingLoads.set(loadKey, record)
  return record.promise
}

/**
 * 同步取得已快取的照片（不發請求），給畫面第一次 render 用，避免已載入過的頭像又閃一下字母。
 * 沒有快取、已過期或負向快取中都回傳 null。
 */
export function acquireCachedEmployeePhoto(employeeId, photoPath = '') {
  const id = employeeId == null ? '' : String(employeeId)
  if (!id) return null
  if (isDirectPhotoUrl(photoPath)) return { url: photoPath, release() {} }
  syncSession()
  const entry = photoEntries.get(photoKey(id, photoVersion(photoPath)))
  if (!entry || Date.now() - entry.fetchedAt > PHOTO_REVALIDATE_MS) return null
  return makeLease(entry)
}

/**
 * 取得員工照片的 object URL。回傳 { url, release }：用完（元件卸載、換照片）要呼叫 release，
 * 沒有照片 / 沒有權限時 url 是 null（release 仍可安全呼叫）。
 * photoPath 當作版本：照片換過檔名就會變，直接取得新的一份。
 */
export async function acquireEmployeePhoto(employeeId, photoPath = '') {
  const id = employeeId == null ? '' : String(employeeId)
  if (!id) return emptyLease()
  if (isDirectPhotoUrl(photoPath)) return { url: photoPath, release() {} }

  syncSession()
  // 登出通知的當下不要發請求（見 sessionEnded）
  if (sessionEnded) return emptyLease()
  const key = photoKey(id, photoVersion(photoPath))
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const missingUntil = missingPhotos.get(key)
    if (missingUntil) {
      if (missingUntil > Date.now()) return emptyLease()
      missingPhotos.delete(key)
    }
    let entry = photoEntries.get(key)
    if (entry && Date.now() - entry.fetchedAt > PHOTO_REVALIDATE_MS) {
      dropEntry(entry)
      entry = null
    }
    if (entry) return makeLease(entry)
    entry = await loadPhoto(id, photoPath, key)
    // 等待期間照片被編輯 / 登出作廢了就重來一次
    if (entry === STALE_LOAD) continue
    if (!entry) return emptyLease()
    return makeLease(entry, { adopt: true })
  }
  return emptyLease()
}

/**
 * 相容舊用法：只要網址、不管釋放。網址由快取擁有，換頁不會被收掉，
 * 編輯該員工照片、登出或超過快取上限時才回收。新的畫面請用 EmployeeAvatar 或 acquireEmployeePhoto。
 */
export async function fetchEmployeePhotoUrl(employeeId, photoPath) {
  if (!employeeId || !photoPath) return null
  if (isDirectPhotoUrl(photoPath)) return photoPath

  const lease = await acquireEmployeePhoto(employeeId, photoPath)
  lease.release()
  return lease.url
}

export function revokeEmployeePhotoUrl(url) {
  // 快取擁有的網址不可以被呼叫端回收，否則其他正在顯示同一張照片的頭像會壞掉
  if (typeof url === 'string' && url.startsWith('blob:') && !managedUrls.has(url)) revokeObjectUrl(url)
}

/** 員工照片被新增 / 更換 / 移除後呼叫：作廢快取並通知所有顯示該員工的頭像重新載入。 */
export function invalidateEmployeePhoto(employeeId) {
  const id = employeeId == null ? '' : String(employeeId)
  if (!id) return
  photoEpochs.set(id, employeeEpoch(id) + 1)
  for (const entry of [...photoEntries.values()]) {
    if (entry.employeeId === id) dropEntry(entry)
  }
  const prefix = `${id}\n`
  for (const key of [...missingPhotos.keys()]) {
    if (key.startsWith(prefix)) missingPhotos.delete(key)
  }
  notifyPhotoListeners(id)
}

/** 登出 / 換帳號時呼叫：回收全部照片並通知所有頭像。 */
export function clearEmployeePhotoCache() {
  cacheEpoch += 1
  const previousSession = cacheSession
  cacheSession = currentSession()
  sessionEnded = Boolean(previousSession) && !cacheSession
  try {
    for (const entry of [...photoEntries.values()]) dropEntry(entry)
    missingPhotos.clear()
    const ids = [...photoListeners.keys()].filter(key => key !== '*')
    ids.forEach(notifyPhotoListeners)
    if (photoListeners.has('*')) notifyPhotoListeners('*')
  } finally {
    sessionEnded = false
  }
}

/** 訂閱某位員工照片被作廢的通知（employeeId 傳 '*' 代表全部）；回傳取消訂閱的函式。 */
export function subscribeEmployeePhoto(employeeId, callback) {
  const id = employeeId == null ? '' : String(employeeId)
  if (!id || typeof callback !== 'function') return () => {}
  let listeners = photoListeners.get(id)
  if (!listeners) {
    listeners = new Set()
    photoListeners.set(id, listeners)
  }
  listeners.add(callback)
  return () => {
    listeners.delete(callback)
    if (!listeners.size && photoListeners.get(id) === listeners) photoListeners.delete(id)
  }
}

/* 上傳前檢查 ------------------------------------------------------------------
 * 與伺服器的規則一致（employeePhotoStorage）：JPEG / PNG / GIF / WebP，最大 5MB。
 * 在選檔當下就檢查，不要等到按「儲存」才被伺服器拒絕。
 */
export const EMPLOYEE_PHOTO_MAX_BYTES = 5 * 1024 * 1024
export const EMPLOYEE_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const SHRINKABLE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const SHRINK_MAX_EDGE = 1600

export const EMPLOYEE_PHOTO_TYPE_MESSAGE = '不支援的圖片格式，僅支援 JPEG、PNG、GIF、WebP'
export const EMPLOYEE_PHOTO_SIZE_MESSAGE = '圖片檔案過大，最大 5MB'

export function validateEmployeePhotoFile(file) {
  if (!file || typeof file !== 'object') return '無效的圖片資料'
  if (!EMPLOYEE_PHOTO_TYPES.includes(String(file.type || '').toLowerCase())) {
    return EMPLOYEE_PHOTO_TYPE_MESSAGE
  }
  if (!(Number(file.size) > 0)) return '無效的圖片資料'
  if (file.size > EMPLOYEE_PHOTO_MAX_BYTES) return EMPLOYEE_PHOTO_SIZE_MESSAGE
  return ''
}

// 手機拍的照片常常超過 5MB：縮小並轉成 JPEG 再上傳；瀏覽器不支援或失敗就回傳 null，維持原本的「檔案過大」提示
async function shrinkPhotoFile(file) {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const scale = Math.min(1, SHRINK_MAX_EDGE / Math.max(bitmap.width, bitmap.height, 1))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext('2d')
    if (!context) return null
    // 轉成 JPEG 沒有透明度，先鋪白底避免透明處變黑
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close?.()
    for (const quality of [0.88, 0.7]) {
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size > 0 && blob.size <= EMPLOYEE_PHOTO_MAX_BYTES) {
        const baseName = String(file.name || 'photo').replace(/\.[^./\\]+$/, '') || 'photo'
        return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
      }
    }
  } catch {
    // 縮圖失敗時沿用原本的檢查結果
  }
  return null
}

/** 檢查（必要時縮小）員工照片檔；回傳 { file, error }，error 是可直接顯示的中文訊息。 */
export async function prepareEmployeePhotoFile(file) {
  const error = validateEmployeePhotoFile(file)
  if (!error) return { file, error: '' }
  if (error === EMPLOYEE_PHOTO_SIZE_MESSAGE && SHRINKABLE_TYPES.includes(String(file.type).toLowerCase())) {
    const shrunk = await shrinkPhotoFile(file)
    if (shrunk) return { file: shrunk, error: '' }
  }
  return { file: null, error }
}

/**
 * Convert a photo path to a full URL
 * @param {string|null|undefined} photoPath - The photo path (e.g., '/upload/filename.jpg')
 * @returns {string|null} - The full URL or null if no photo
 */
export function getPhotoUrl(photoPath) {
  if (!photoPath) {
    return null
  }

  // If the photo is already a full URL (http:// or https://), return as is
  if (photoPath.startsWith('http://') || photoPath.startsWith('https://')) {
    return photoPath
  }

  // If the photo is a data URL (base64), return as is
  if (photoPath.startsWith('data:')) {
    return photoPath
  }

  // If the photo is a blob URL, return as is
  if (photoPath.startsWith('blob:')) {
    return photoPath
  }

  // If the path starts with /upload/, prepend the API base URL
  if (photoPath.startsWith('/upload/')) {
    return `${API_BASE_URL}${photoPath}`
  }

  // If the path doesn't start with /, prepend /upload/ and API base URL
  if (!photoPath.startsWith('/')) {
    return `${API_BASE_URL}/upload/${photoPath}`
  }

  // For any other path starting with /, prepend API base URL
  return `${API_BASE_URL}${photoPath}`
}

/**
 * Convert a full photo URL back to a relative path for storage
 * @param {string|null|undefined} photoUrl - The photo URL (full or relative)
 * @returns {string} - The relative path (e.g., '/upload/filename.jpg') or empty string
 */
export function getPhotoPath(photoUrl) {
  if (!photoUrl) {
    return ''
  }

  // If it's a data URL or blob URL, return as is (will be processed by backend)
  if (photoUrl.startsWith('data:') || photoUrl.startsWith('blob:')) {
    return photoUrl
  }

  // If it's already a relative path starting with /upload/, return as is
  if (photoUrl.startsWith('/upload/')) {
    return photoUrl
  }

  // If it's a full URL, extract the path part
  if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
    try {
      const url = new URL(photoUrl)
      const pathname = url.pathname
      // If the pathname contains /upload/, extract from /upload/ onwards
      if (pathname.includes('/upload/')) {
        const uploadIndex = pathname.indexOf('/upload/')
        return pathname.substring(uploadIndex)
      }
      // If it's just the pathname, return it
      if (pathname.startsWith('/')) {
        return pathname
      }
    } catch (e) {
      // Invalid URL, return as is
      return photoUrl
    }
  }

  // For any other case, return as is
  return photoUrl
}
