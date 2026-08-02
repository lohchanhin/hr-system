import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import request from 'supertest'
import { uploadApprovalAttachmentFiles } from '../src/middleware/approvalAttachmentUpload.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const uploadDir = path.join(__dirname, '../../upload/approvals')
const createdFiles = []

const app = express()
app.post('/upload', uploadApprovalAttachmentFiles, (req, res) => {
  createdFiles.push(...(req.files || []).map((file) => file.path))
  res.status(201).json({ files: (req.files || []).map((file) => file.filename) })
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
