import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 專案根目錄的 upload 資料夾
const UPLOAD_DIR = path.join(__dirname, '../../../upload')

// 確保 upload 目錄存在（使用異步方式）
async function ensureUploadDir() {
  try {
    await fs.access(UPLOAD_DIR)
  } catch {
    await fs.mkdir(UPLOAD_DIR, { recursive: true })
  }
}

// 在模塊加載時確保目錄存在
ensureUploadDir().catch(console.error)

// 支援的圖片格式（移除無效的 image/jpg）
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * 檢測圖片格式並返回相關信息
 * @param {Buffer} buffer - 圖片數據緩衝區
 * @returns {{ format: string, extension: string, mimeType: string } | null}
 */
function detectImageFormat(buffer) {
  if (!buffer || buffer.length < 12) return null
  
  // JPEG: FF D8 FF
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { format: 'jpeg', extension: 'jpg', mimeType: 'image/jpeg' }
  }
  
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return { format: 'png', extension: 'png', mimeType: 'image/png' }
  }
  
  // GIF: 47 49 46 38 (GIF8)
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return { format: 'gif', extension: 'gif', mimeType: 'image/gif' }
  }
  
  // WebP: RIFF (52 49 46 46) at bytes 0-3, WEBP (57 45 42 50) at bytes 8-11
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
      buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    return { format: 'webp', extension: 'webp', mimeType: 'image/webp' }
  }
  
  return null
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
      // Check for blob URLs which cannot be processed server-side
      if (photoSource.startsWith('blob:')) {
        return res.status(400).json({ 
          error: '無法處理 blob URL，請確保前端已將圖片轉換為 base64 格式' 
        })
      }
      
      try {
        buffer = Buffer.from(photoSource, 'base64')
      } catch (e) {
        return res.status(400).json({ error: '無效的 base64 格式' })
      }

      // 檢查檔案大小
      if (buffer.length > MAX_FILE_SIZE) {
        return res.status(400).json({ error: '圖片檔案過大，最大 5MB' })
      }

      // 使用統一的格式檢測函數
      const formatInfo = detectImageFormat(buffer)
      if (!formatInfo) {
        return res.status(400).json({ error: '無效的圖片數據，僅支援 JPEG, PNG, GIF, WebP 格式' })
      }

      extension = formatInfo.extension
      mimeType = formatInfo.mimeType
    } else {
      return next()
    }

    // 生成唯一的檔案名稱（使用密碼學安全的隨機數）
    const timestamp = Date.now()
    const randomBytes = crypto.randomBytes(4).toString('hex')
    const filename = `employee_${timestamp}_${randomBytes}.${extension}`
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
