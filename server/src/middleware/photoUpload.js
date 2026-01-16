import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 專案根目錄的 upload 資料夾
const UPLOAD_DIR = path.join(__dirname, '../../../upload')

// 確保 upload 目錄存在
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

// 支援的圖片格式
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp']
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

/**
 * 處理照片上傳的中間件
 * 接收 base64 或實際檔案，保存到 /upload 目錄
 */
export default async function photoUploadMiddleware(req, res, next) {
  try {
    const { photo, photoData } = req.body

    // 如果沒有照片數據，跳過處理
    if (!photo && !photoData) {
      return next()
    }

    let buffer
    let mimeType
    let extension

    // 處理 base64 格式的照片
    if (photo && photo.startsWith('data:image/')) {
      const matches = photo.match(/^data:([^;]+);base64,(.+)$/)
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
    // 處理 photoData base64 (沒有 data:image/ 前綴的情況)
    else if (photoData) {
      buffer = Buffer.from(photoData, 'base64')
      extension = 'jpg' // 預設為 jpg
      mimeType = 'image/jpeg'

      if (buffer.length > MAX_FILE_SIZE) {
        return res.status(400).json({ error: '圖片檔案過大，最大 5MB' })
      }
    } else {
      return next()
    }

    // 生成唯一的檔案名稱
    const timestamp = Date.now()
    const randomStr = Math.random().toString(36).substring(2, 8)
    const filename = `employee_${timestamp}_${randomStr}.${extension}`
    const filepath = path.join(UPLOAD_DIR, filename)

    // 保存檔案
    fs.writeFileSync(filepath, buffer)

    // 將檔案路徑存到 req.body.photo，格式為 /upload/filename
    req.body.photo = `/upload/${filename}`

    next()
  } catch (error) {
    console.error('Photo upload error:', error)
    res.status(500).json({ error: '圖片上傳失敗' })
  }
}
