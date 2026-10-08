import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import request from 'supertest'
import {
  repairUploadedFilename,
  sanitizeAttachmentName,
  uploadApprovalAttachmentFiles,
} from '../src/middleware/approvalAttachmentUpload.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadDir = path.join(__dirname, '../../upload/approvals')
const createdFiles = []

const app = express()
app.post('/upload', uploadApprovalAttachmentFiles, (req, res) => {
  createdFiles.push(...(req.files || []).map((file) => file.path))
  res.status(201).json({
    files: (req.files || []).map((file) => file.filename),
    names: (req.files || []).map((file) => file.originalname),
  })
})

afterAll(() => {
  createdFiles.forEach((file) => {
    try {
      fs.unlinkSync(file)
    } catch {
      // The upload middleware may already have removed a rejected file.
    }
  })
})

describe('approval attachment upload validation', () => {
  it('rejects a MIME and extension mismatch before storing the file', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('files', Buffer.from('<script>alert(1)</script>'), {
        filename: 'attack.html',
        contentType: 'image/png',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('附件副檔名與格式不一致')
  })

  it('rejects content whose signature does not match the declared image type', async () => {
    const before = fs.existsSync(uploadDir) ? new Set(fs.readdirSync(uploadDir)) : new Set()
    const res = await request(app)
      .post('/upload')
      .attach('files', Buffer.from('<script>alert(1)</script>'), {
        filename: 'attack.png',
        contentType: 'image/png',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('附件內容與宣告格式不一致')
    const after = fs.existsSync(uploadDir) ? new Set(fs.readdirSync(uploadDir)) : new Set()
    expect(after).toEqual(before)
  })

  it('accepts a file with a matching extension and signature', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('files', Buffer.from('%PDF-1.4\n%%EOF\n'), {
        filename: 'document.pdf',
        contentType: 'application/pdf',
      })

    expect(res.status).toBe(201)
    expect(res.body.files).toHaveLength(1)
  })
})

describe('attachment file names', () => {
  it('keeps a Chinese file name intact instead of storing mojibake', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('files', Buffer.from('%PDF-1.4\n%%EOF\n'), {
        filename: '請假證明_醫師診斷書.pdf',
        contentType: 'application/pdf',
      })

    expect(res.status).toBe(201)
    expect(res.body.names).toEqual(['請假證明_醫師診斷書.pdf'])
    // 磁碟上的檔名仍是隨機名稱，不含使用者提供的名稱
    expect(res.body.files[0]).toMatch(/^\d+-[0-9a-f]{16}\.pdf$/)
  })

  it('sanitises a hostile file name (path parts, reserved characters) but keeps the extension', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('files', Buffer.from('%PDF-1.4\n%%EOF\n'), {
        filename: '..\\..\\evil<script>.pdf',
        contentType: 'application/pdf',
      })

    expect(res.status).toBe(201)
    expect(res.body.names[0]).toBe('evil_script_.pdf')
  })
})

describe('repairUploadedFilename / sanitizeAttachmentName', () => {
  it('turns latin1-decoded UTF-8 bytes back into the original Chinese name', () => {
    const original = '請假證明.pdf'
    const mojibake = Buffer.from(original, 'utf8').toString('latin1')
    expect(mojibake).not.toBe(original)
    expect(repairUploadedFilename(mojibake)).toBe(original)
  })

  it('leaves proper names and genuine latin1 names alone', () => {
    expect(repairUploadedFilename('請假證明.pdf')).toBe('請假證明.pdf')
    expect(repairUploadedFilename('plain.pdf')).toBe('plain.pdf')
    expect(repairUploadedFilename('café.pdf')).toBe('café.pdf')
    expect(repairUploadedFilename('')).toBe('')
  })

  it('removes directories and reserved characters and limits the length', () => {
    expect(sanitizeAttachmentName('C:\\Users\\x\\proof.pdf')).toBe('proof.pdf')
    expect(sanitizeAttachmentName('a/b/c.png')).toBe('c.png')
    expect(sanitizeAttachmentName('a\u0000b:c|d?.pdf')).toBe('a_b_c_d_.pdf')
    expect(sanitizeAttachmentName('...')).toBe('attachment')
    const result = sanitizeAttachmentName(`${'長'.repeat(300)}.pdf`)
    expect(result.length).toBeLessThanOrEqual(120)
    expect(result.endsWith('.pdf')).toBe(true)
  })
})

describe('upload error messages', () => {
  it('answers in Chinese when too many files are sent, instead of the multer text', async () => {
    let req = request(app).post('/upload')
    for (let index = 0; index < 6; index += 1) {
      req = req.attach('files', Buffer.from('%PDF-1.4\n%%EOF\n'), { filename: `doc-${index}.pdf`, contentType: 'application/pdf' })
    }
    const res = await req

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('一次最多上傳 5 個附件')
  })

  it('answers in Chinese for a file larger than 10MB', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('files', Buffer.alloc(10 * 1024 * 1024 + 16, 0x25), { filename: 'big.pdf', contentType: 'application/pdf' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('單一附件不可超過 10MB')
  })

  it('does not leak the text of an unexpected field error', async () => {
    const res = await request(app)
      .post('/upload')
      .attach('wrongField', Buffer.from('%PDF-1.4\n%%EOF\n'), { filename: 'doc.pdf', contentType: 'application/pdf' })

    expect(res.status).toBe(400)
    expect(res.body.error).not.toMatch(/Unexpected field/i)
    expect(res.body.error).toMatch(/附件/)
  })
})
