import path from 'node:path'
import { TextDecoder } from 'node:util'
import JSZip from 'jszip'
import multer from 'multer'

export const IMPORT_FILE_MAX_SIZE = 5 * 1024 * 1024

const MAX_TEXT_FIELD_SIZE = 512 * 1024
const MAX_XLSX_ENTRIES = 1_000
const MAX_XLSX_UNCOMPRESSED_SIZE = 50 * 1024 * 1024
const ALLOWED_EXTENSIONS = new Set(['.xlsx', '.csv'])
const ALLOWED_MIME_TYPES = new Map([
  ['.xlsx', new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
    'application/zip',
  ])],
  ['.csv', new Set([
    'text/csv',
    'application/csv',
    'text/plain',
    'text/tab-separated-values',
    'application/vnd.ms-excel',
    'application/octet-stream',
  ])],
])

class ImportUploadValidationError extends Error {}

function getExtension(filename = '') {
  return path.extname(filename).toLowerCase()
}

function startsWith(buffer, bytes) {
  return bytes.every((byte, index) => buffer[index] === byte)
}

async function isXlsx(buffer) {
  if (!Buffer.isBuffer(buffer) || !startsWith(buffer, [0x50, 0x4b, 0x03, 0x04])) {
    return false
  }

  try {
    const archive = await JSZip.loadAsync(buffer, { createFolders: false })
    const entries = Object.values(archive.files)
    if (entries.length > MAX_XLSX_ENTRIES) return false
    if (!archive.file('[Content_Types].xml') || !archive.file('xl/workbook.xml')) return false

    let totalUncompressedSize = 0
    for (const entry of entries) {
      if (entry.dir) continue
      const uncompressedSize = Number(entry?._data?.uncompressedSize)
      if (!Number.isSafeInteger(uncompressedSize) || uncompressedSize < 0) return false
      totalUncompressedSize += uncompressedSize
      if (totalUncompressedSize > MAX_XLSX_UNCOMPRESSED_SIZE) return false
    }
    return true
  } catch {
    return false
  }
}

function decodeCsv(buffer) {
  if (startsWith(buffer, [0xff, 0xfe])) {
    return new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2))
  }
  if (startsWith(buffer, [0xfe, 0xff])) {
    return new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2))
  }
  const payload = startsWith(buffer, [0xef, 0xbb, 0xbf]) ? buffer.subarray(3) : buffer
  return new TextDecoder('utf-8', { fatal: true }).decode(payload)
}

function isCsv(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false

  try {
    const sample = decodeCsv(buffer).slice(0, 64 * 1024)
    if (!sample.trim()) return false

    let disallowedControlCharacters = 0
    for (const character of sample) {
      const code = character.charCodeAt(0)
      if (code < 32 && character !== '\n' && character !== '\r' && character !== '\t') {
        disallowedControlCharacters += 1
      }
    }
    return disallowedControlCharacters / sample.length < 0.01
  } catch {
    return false
  }
}

async function hasAllowedContent(file) {
  const extension = getExtension(file?.originalname)
  if (extension === '.xlsx') return await isXlsx(file?.buffer)
  if (extension === '.csv') return isCsv(file?.buffer)
  return false
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: IMPORT_FILE_MAX_SIZE,
    files: 1,
    fields: 10,
    parts: 12,
    fieldNameSize: 100,
    fieldSize: MAX_TEXT_FIELD_SIZE,
    headerPairs: 100,
  },
  fileFilter: (_req, file, callback) => {
    const extension = getExtension(file.originalname)
    if (!ALLOWED_EXTENSIONS.has(extension)) {
      callback(new ImportUploadValidationError('僅支援 .xlsx 或 .csv 匯入檔案'))
      return
    }

    const mimetype = String(file.mimetype || '').toLowerCase()
    if (!ALLOWED_MIME_TYPES.get(extension)?.has(mimetype)) {
      callback(new ImportUploadValidationError('匯入檔案副檔名與格式不一致'))
      return
    }
    callback(null, true)
  },
})

function sendUploadError(res, error) {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ message: '上傳檔案過大，最大 5MB' })
      return
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE' || error.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({ message: '僅能上傳一個 file 檔案' })
      return
    }
    if (error.code === 'LIMIT_FIELD_VALUE') {
      res.status(400).json({ message: '上傳欄位內容過大' })
      return
    }
    res.status(400).json({ message: '上傳內容超過系統限制' })
    return
  }

  if (error instanceof ImportUploadValidationError) {
    res.status(400).json({ message: error.message })
    return
  }

  res.status(400).json({ message: '無法解析上傳內容' })
}

export default function uploadMiddleware(req, res, next) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase()
  if (!contentType.startsWith('multipart/form-data')) {
    res.status(400).json({ message: 'Content-Type 必須為 multipart/form-data' })
    return
  }

  upload.single('file')(req, res, async (error) => {
    if (error) {
      sendUploadError(res, error)
      return
    }
    if (!req.file?.buffer?.length) {
      res.status(400).json({ message: '缺少上傳檔案' })
      return
    }
    if (!await hasAllowedContent(req.file)) {
      res.status(400).json({ message: '匯入檔案內容與宣告格式不一致' })
      return
    }
    next()
  })
}
