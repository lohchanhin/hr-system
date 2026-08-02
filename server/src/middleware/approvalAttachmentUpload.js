import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const UPLOAD_DIR = path.join(__dirname, '../../../upload/approvals')
const MAX_FILE_SIZE = 10 * 1024 * 1024
const MAX_FILES = 5

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
])

const ALLOWED_EXTENSIONS_BY_MIME = new Map([
  ['application/pdf', new Set(['.pdf'])],
  ['application/msword', new Set(['.doc'])],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', new Set(['.docx'])],
  ['application/vnd.ms-excel', new Set(['.xls'])],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', new Set(['.xlsx'])],
  ['image/jpeg', new Set(['.jpg', '.jpeg'])],
  ['image/png', new Set(['.png'])],
  ['image/gif', new Set(['.gif'])],
  ['image/webp', new Set(['.webp'])],
])

function hasAllowedSignature(file) {
  const buffer = Buffer.alloc(16)
  const descriptor = fs.openSync(file.path, 'r')
  let bytesRead = 0
  try {
    bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0)
  } finally {
    fs.closeSync(descriptor)
  }
  const header = buffer.subarray(0, bytesRead)
  const startsWith = (...bytes) => bytes.every((byte, index) => header[index] === byte)

  if (file.mimetype === 'application/pdf') return header.subarray(0, 5).toString('ascii') === '%PDF-'
  if (file.mimetype === 'image/jpeg') return startsWith(0xff, 0xd8, 0xff)
  if (file.mimetype === 'image/png') return startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  if (file.mimetype === 'image/gif') {
    const signature = header.subarray(0, 6).toString('ascii')
    return signature === 'GIF87a' || signature === 'GIF89a'
  }
  if (file.mimetype === 'image/webp') {
    return header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  if (file.mimetype === 'application/msword' || file.mimetype === 'application/vnd.ms-excel') {
    return startsWith(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)
  }
  return startsWith(0x50, 0x4b, 0x03, 0x04)
}

function removeUploadedFiles(files = []) {
  files.forEach((file) => {
    if (!file?.path) return
    try {
      fs.unlinkSync(file.path)
    } catch {
      // Best effort cleanup; failed cleanup is handled by operational monitoring.
    }
  })
}

fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, UPLOAD_DIR),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname || '').toLowerCase()
    callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`)
  },
})

const attachmentUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      callback(new Error('附件格式不支援，請上傳 PDF、Word、Excel 或圖片'))
      return
    }
    const extension = path.extname(file.originalname || '').toLowerCase()
    if (!ALLOWED_EXTENSIONS_BY_MIME.get(file.mimetype)?.has(extension)) {
      callback(new Error('附件副檔名與格式不一致'))
      return
    }
    callback(null, true)
  },
})

export function uploadApprovalAttachmentFiles(req, res, next) {
  attachmentUpload.array('files', MAX_FILES)(req, res, (error) => {
    if (!error) {
      const invalidFile = (req.files || []).find((file) => !hasAllowedSignature(file))
      if (invalidFile) {
        removeUploadedFiles(req.files)
        res.status(400).json({ error: '附件內容與宣告格式不一致' })
        return
      }
      next()
      return
    }
    removeUploadedFiles(req.files)
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ error: '單一附件不可超過 10MB' })
      return
    }
    res.status(400).json({ error: error.message || '附件上傳失敗' })
  })
}
