// 考勤匯入的上傳檢查：Big5（ANSI）的 CSV 要能送到考勤匯入（控制器會自己解碼）。
// 以前上傳檢查只收 UTF-8／UTF-16，考勤機與 Excel 另存的 Big5 CSV 一律回 400「匯入檔案內容與宣告格式不一致」，
// 看不出是編碼的問題。其他匯入（員工批次匯入）照舊不收 Big5。
import express from 'express'
import request from 'supertest'
import uploadMiddleware, { createUploadMiddleware } from '../src/middleware/upload.js'

const app = express()
const echo = (req, res) => res.status(200).json({ size: req.file.size })
app.post('/attendance', createUploadMiddleware({ allowBig5Csv: true }), echo)
app.post('/other', uploadMiddleware, echo)

// Big5 的「編號,姓名」＋一列資料（王小明、上班簽到）
const BIG5_CSV = Buffer.concat([
  Buffer.from([0xbd, 0x73, 0xb8, 0xb9]), Buffer.from(','), Buffer.from([0xa9, 0x6d, 0xa6, 0x57]), Buffer.from('\r\n'),
  Buffer.from('N001,'), Buffer.from([0xa4, 0xfd, 0xa4, 0x70, 0xa9, 0xfa]), Buffer.from('\r\n'),
])
const upload = (path, buffer, filename = 'attendance.csv') => request(app)
  .post(path)
  .attach('file', buffer, { filename, contentType: 'text/csv' })

describe('考勤匯入的上傳檢查接受 Big5 的 CSV', () => {
  it('測試用的位元組真的是 Big5、不是 UTF-8', () => {
    expect(new TextDecoder('big5').decode(BIG5_CSV)).toBe('編號,姓名\r\nN001,王小明\r\n')
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(BIG5_CSV)).toThrow()
  })

  it('考勤匯入：Big5 的 CSV 放行', async () => {
    const response = await upload('/attendance', BIG5_CSV)
    expect(response.status).toBe(200)
  })

  it('考勤匯入：UTF-8、UTF-8 BOM 的 CSV 照舊放行；二進位內容照舊擋下', async () => {
    expect((await upload('/attendance', Buffer.from('編號,姓名\nN001,王小明\n', 'utf8'))).status).toBe(200)
    expect((await upload('/attendance', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('USERID\nN001\n')]))).status).toBe(200)
    const binary = Buffer.from(Array.from({ length: 512 }, (_, index) => index % 32))
    const rejected = await upload('/attendance', binary)
    expect(rejected.status).toBe(400)
    expect(rejected.body.message).toBe('匯入檔案內容與宣告格式不一致')
  })

  it('其他匯入（預設的上傳檢查）照舊不收 Big5', async () => {
    const response = await upload('/other', BIG5_CSV, 'employees.csv')
    expect(response.status).toBe(400)
    expect(response.body.message).toBe('匯入檔案內容與宣告格式不一致')
  })
})
