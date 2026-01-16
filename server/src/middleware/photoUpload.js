import fs from 'fs/promises'
import fsSync from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 專案根目錄的 upload 資料夾
const UPLOAD_DIR = path.join(__dirname, '../../../upload')

// 確保 upload 目錄存在（同步方式，僅在啟動時執行一次）
if (!fsSync.existsSync(UPLOAD_DIR)) {
  fsSync.mkdirSync(UPLOAD_DIR, { recursive: true })
}

// 支援的圖片格式（移除無效的 image/jpg）
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * 驗證 base64 字符串是否為有效的圖片數據
 * 通過檢查文件簽名（magic numbers）
 */
function isValidImageBuffer(buffer) {
  if (!buffer || buffer.length < 4) return false
  
  // 檢查常見圖片格式的文件簽名
  const signatures = {
    jpeg: [0xFF, 0xD8, 0xFF],           // JPEG
    png: [0x89, 0x50, 0x4E, 0x47],      // PNG
    gif: [0x47, 0x49, 0x46, 0x38],      // GIF
    webp: [0x52, 0x49, 0x46, 0x46]      // WEBP (RIFF)
  }
  
  for (const [format, sig] of Object.entries(signatures)) {
    const matches = sig.every((byte, i) => buffer[i] === byte)
    if (matches) return true
  }
  
  return false
}

/**
 * 處理照片上傳的中間件
 * 接收 base64 或實際檔案，保存到 /upload 目錄
 */
export default async function photoUploadMiddleware(req, res, next) {
  try {
    const { photo, photoData, photoList } = req.body

    // 決定要處理的照片數據
    let photoSource = photo || photoData
    
    // 如果 photoList 存在且有內容，使用第一張照片
    if (!photoSource && Array.isArray(photoList) && photoList.length > 0) {
      photoSource = photoList[0]
    }

    // 如果沒有照片數據，跳過處理
    if (!photoSource) {
      return next()
    }

    // 如果照片已經是 /upload/ 路徑，說明已經上傳過了，跳過處理
    if (typeof photoSource === 'string' && photoSource.startsWith('/upload/')) {
      return next()
    }

    let buffer
    let mimeType
    let extension

    // 處理 base64 格式的照片
    if (photoSource && photoSource.startsWith('data:image/')) {
      const matches = photoSource.match(/^data:([^;]+);base64,(.+)$/)
      if (!matches) {
        return res.status(400).json({ error: '無效的圖片格式' })
      }

      mimeType = matches[1]
      const base64Data = matches[2]
      buffer = Buffer.from(base64Data, 'base64')

      // 檢查 MIME 類型
      if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
        return res.status(400).json({ error: '不支援的圖片格式，僅支援 JPEG, PNG, GIF, WebP' })
      }

      // 檢查檔案大小
      if (buffer.length > MAX_FILE_SIZE) {
        return res.status(400).json({ error: '圖片檔案過大，最大 5MB' })
      }

      // 根據 MIME 類型決定副檔名
      extension = mimeType.split('/')[1]
      if (extension === 'jpeg') extension = 'jpg'
    } 
    // 處理純 base64 (沒有 data:image/ 前綴的情況)
    else if (photoSource && typeof photoSource === 'string') {
      try {
        buffer = Buffer.from(photoSource, 'base64')
      } catch (e) {
        return res.status(400).json({ error: '無效的 base64 格式' })
      }

      // 驗證是否為有效的圖片數據
      if (!isValidImageBuffer(buffer)) {
        return res.status(400).json({ error: '無效的圖片數據，無法識別圖片格式' })
      }

      // 檢查檔案大小
      if (buffer.length > MAX_FILE_SIZE) {
        return res.status(400).json({ error: '圖片檔案過大，最大 5MB' })
      }

      // 根據文件簽名決定副檔名
      if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
        extension = 'jpg'
        mimeType = 'image/jpeg'
      } else if (buffer[0] === 0x89 && buffer[1] === 0x50) {
        extension = 'png'
        mimeType = 'image/png'
      } else if (buffer[0] === 0x47 && buffer[1] === 0x49) {
        extension = 'gif'
        mimeType = 'image/gif'
      } else if (buffer[0] === 0x52 && buffer[1] === 0x49) {
        extension = 'webp'
        mimeType = 'image/webp'
      } else {
        extension = 'jpg' // 預設
        mimeType = 'image/jpeg'
      }
    } else {
      return next()
    }

    // 生成唯一的檔案名稱
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(2, 8)
    const filename = `employee_${timestamp}_${randomStr}.${extension}`
    const filepath = path.join(UPLOAD_DIR, filename)

    // 使用非同步方式保存檔案
    await fs.writeFile(filepath, buffer)

    // 將檔案路徑存到 req.body.photo，格式為 /upload/filename
    req.body.photo = `/upload/${filename}`

    next()
  } catch (error) {
    console.error('Photo upload error:', error)
    res.status(500).json({ error: '圖片上傳失敗' })
  }
}
