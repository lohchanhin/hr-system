import path from 'path'

// 私有上傳檔（簽核附件、員工照片）只能走有驗證的 API 下載，不可由 /upload 靜態路徑直接讀取。
// express.static 會先把路徑解碼（%61 → a、%2f → /）再讀檔，Windows 主機還不分大小寫、
// 也把反斜線當作路徑分隔，所以這裡必須用「解碼並正規化之後」的路徑比對，不能直接比對原始網址。
const PRIVATE_DIRECTORIES = new Set(['approvals', 'employees'])
const LEGACY_EMPLOYEE_PHOTO_PREFIX = 'employee_'

function notFound(res) {
  return res.status(404).json({ error: 'Not found' })
}

// 解碼 → 反斜線視為分隔 → 正規化；回傳小寫的路徑片段，無法安全判讀時回傳 null
function normalizeSegments(rawPath) {
  const decoded = decodeURIComponent(rawPath)
  if (decoded.includes('\0')) return null
  const unified = decoded.replace(/\\/g, '/')
  // 解碼後仍帶有上層目錄（..）的路徑不是正常請求
  if (unified.split('/').some(segment => segment === '..')) return null
  const normalized = path.posix.normalize(`/${unified}`)
  return normalized
    .split('/')
    .filter(Boolean)
    // Windows 會忽略檔名結尾的點與空白，且檔名不分大小寫
    .map(segment => segment.replace(/[.\s]+$/, '').toLowerCase())
}

export default function privateUploadGuard(req, res, next) {
  const rawPath = String(req.path || '').split('?')[0]
  let segments
  try {
    segments = normalizeSegments(rawPath)
  } catch {
    return notFound(res) // 解碼失敗（壞掉的 % 序列）
  }
  if (!segments) return notFound(res)
  // 冒號可用來指定 NTFS 資料流（approvals::$INDEX_ALLOCATION），沒有正常檔案會用到
  if (segments.some(segment => segment.includes(':'))) return notFound(res)

  const [first] = segments
  const isPrivateDirectory = PRIVATE_DIRECTORIES.has(first)
  const isLegacyEmployeePhoto = segments.length === 1 && Boolean(first?.startsWith(LEGACY_EMPLOYEE_PHOTO_PREFIX))
  if (isPrivateDirectory || isLegacyEmployeePhoto) return notFound(res)
  return next()
}
