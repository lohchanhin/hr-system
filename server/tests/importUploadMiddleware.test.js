import express from 'express'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import request from 'supertest'
import { IMPORT_FILE_MAX_SIZE } from '../src/middleware/upload.js'
import uploadMiddleware from '../src/middleware/upload.js'

const app = express()
app.post('/upload', uploadMiddleware, (req, res) => {
  res.status(200).json({
    filename: req.file.originalname,
    size: req.file.size,
    body: req.body,
  })
})

describe('spreadsheet import upload validation', () => {
  it('accepts a CSV file and preserves text fields for downstream validation', async () => {
    const response = await request(app)
      .post('/upload')
      .field('mappings', JSON.stringify({ employeeNo: 'employeeId' }))
      .field('options', JSON.stringify({ dryRun: true }))
      .attach('file', Buffer.from('employeeId,name\nE001,Test User\n'), {
        filename: 'employees.csv',
        contentType: 'text/csv',
      })

    expect(response.status).toBe(200)
    expect(response.body.filename).toBe('employees.csv')
    expect(response.body.body.mappings).toBe(JSON.stringify({ employeeNo: 'employeeId' }))
    expect(response.body.body.options).toBe(JSON.stringify({ dryRun: true }))
  })

  it('accepts an XLSX ZIP signature sent with a generic browser MIME type', async () => {
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Employees').addRow(['employeeId', 'name'])
    const workbookBuffer = await workbook.xlsx.writeBuffer()

    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from(workbookBuffer), {
        filename: 'employees.xlsx',
        contentType: 'application/octet-stream',
      })

    expect(response.status).toBe(200)
  })

  it('rejects an unsupported extension', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('not a spreadsheet'), {
        filename: 'employees.html',
        contentType: 'text/html',
      })

    expect(response.status).toBe(400)
    expect(response.body.message).toMatch(/\.xlsx.*\.csv/)
  })

  it('rejects a spoofed XLSX file whose content is plain text', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'employees.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

    expect(response.status).toBe(400)
    expect(response.body.message).toMatch(/內容.*格式不一致/)
  })

  it('rejects a ZIP file that is not an OpenXML workbook', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01]), {
        filename: 'employees.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

    expect(response.status).toBe(400)
    expect(response.body.message).toMatch(/內容.*格式不一致/)
  })

  it('rejects a compressed workbook whose expanded content exceeds the safety limit', async () => {
    const archive = new JSZip()
    archive.file('[Content_Types].xml', '<Types />')
    archive.file('xl/workbook.xml', '<workbook />')
    archive.file('xl/worksheets/sheet1.xml', Buffer.alloc(50 * 1024 * 1024 + 1, 0x20))
    const compressed = await archive.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    })

    expect(compressed.length).toBeLessThan(IMPORT_FILE_MAX_SIZE)

    const response = await request(app)
      .post('/upload')
      .attach('file', compressed, {
        filename: 'employees.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })

    expect(response.status).toBe(400)
    expect(response.body.message).toMatch(/內容.*格式不一致/)
  })

  it('rejects files larger than 5MB', async () => {
    const response = await request(app)
      .post('/upload')
      .attach('file', Buffer.alloc(IMPORT_FILE_MAX_SIZE + 1, 0x61), {
        filename: 'employees.csv',
        contentType: 'text/csv',
      })

    expect(response.status).toBe(413)
    expect(response.body.message).toContain('最大 5MB')
  })

  it('rejects multiple files and non-multipart requests', async () => {
    const multipleFiles = await request(app)
      .post('/upload')
      .attach('file', Buffer.from('a,b\n1,2\n'), 'first.csv')
      .attach('file', Buffer.from('a,b\n3,4\n'), 'second.csv')

    expect(multipleFiles.status).toBe(400)
    expect(multipleFiles.body.message).toContain('一個')

    const nonMultipart = await request(app)
      .post('/upload')
      .send({ file: 'none' })

    expect(nonMultipart.status).toBe(400)
    expect(nonMultipart.body.message).toContain('multipart/form-data')
  })
})
