// 大型 CSV 考勤檔（A4）：原本用 readline 的 async iterator 逐行讀，Node 24 上整個檔案只有一個 chunk、
// 超過約 1024 行時會丟出「readline was closed」，5000 筆的 CSV 預覽、匯入都回 400「無法讀取匯入檔案」。
// 改成先讀成文字再逐行處理；BOM、UTF-16、CRLF、引號的處理不變。
import { jest } from '@jest/globals'

const mockAttendanceRecord = { insertMany: jest.fn(), find: jest.fn() }
const mockEmployeeModel = { find: jest.fn() }

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployeeModel }))

const { importAttendanceRecords } = await import('../src/controllers/attendanceImportController.js')

const TOTAL_ROWS = 5000
const USERS = Array.from({ length: 125 }, (_, index) => {
  const employeeId = `N${String(index + 1).padStart(4, '0')}`
  return { _id: `emp-${index + 1}`, employeeId, name: `護理師${index + 1}` }
})

function pad(value) {
  return String(value).padStart(2, '0')
}

// 每一列的時間都不同（每列多一分鐘），不會被當成重複略過
function rowAt(index) {
  const time = new Date(Date.UTC(2026, 9, 1, 0, 0) + index * 60000)
  const stamp = `${time.getUTCFullYear()}-${pad(time.getUTCMonth() + 1)}-${pad(time.getUTCDate())} ${pad(time.getUTCHours())}:${pad(time.getUTCMinutes())}:00`
  const user = USERS[index % USERS.length]
  return [user.employeeId, stamp, index % 2 === 0 ? 'I' : 'O', `"備註 ${index}, 第 ${Math.floor(index / 100)} 批"`]
}

function csvText(lineBreak = '\n') {
  const lines = ['USERID,CHECKTIME,CHECKTYPE,REMARK']
  for (let index = 0; index < TOTAL_ROWS; index += 1) lines.push(rowAt(index).join(','))
  return lines.join(lineBreak) + lineBreak
}

function createMockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn()
  return res
}

function csvRequest(buffer, { dryRun }) {
  return {
    user: { role: 'admin' },
    file: { buffer, mimetype: 'text/csv', originalname: 'attendance.csv' },
    body: { options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun }) },
  }
}

beforeEach(() => {
  mockAttendanceRecord.insertMany.mockReset()
  mockAttendanceRecord.insertMany.mockImplementation(async (docs) => docs)
  mockAttendanceRecord.find.mockReset()
  mockAttendanceRecord.find.mockImplementation(() => {
    const lean = jest.fn().mockResolvedValue([])
    return { select: jest.fn().mockReturnValue({ lean }), lean }
  })
  mockEmployeeModel.find.mockReset()
  const lean = jest.fn().mockResolvedValue(USERS)
  mockEmployeeModel.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean }), lean })
})

describe('5000 筆的 CSV 考勤檔', () => {
  jest.setTimeout(60000)

  it(`在 Node ${process.version} 上預覽成功：每一列都讀到，不寫入資料庫`, async () => {
    const res = createMockRes()

    await importAttendanceRecords(csvRequest(Buffer.from(csvText()), { dryRun: true }), res)

    expect(res.status).not.toHaveBeenCalledWith(400)
    const payload = res.json.mock.calls[0][0]
    expect(payload.summary).toMatchObject({ totalRows: TOTAL_ROWS, readyCount: TOTAL_ROWS, importedCount: 0, duplicateCount: 0 })
    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
  })

  it('正式匯入：5000 筆分 10 批新增，時間、動作、備註（引號內的逗號）都正確，最後一列也有', async () => {
    const res = createMockRes()

    await importAttendanceRecords(csvRequest(Buffer.from(csvText()), { dryRun: false }), res)

    expect(res.status).not.toHaveBeenCalledWith(400)
    expect(res.json.mock.calls[0][0].summary).toMatchObject({ totalRows: TOTAL_ROWS, importedCount: TOTAL_ROWS })
    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(10)
    const inserted = mockAttendanceRecord.insertMany.mock.calls.flatMap(([docs]) => docs)
    expect(inserted).toHaveLength(TOTAL_ROWS)
    // 2026-10-01 00:00（台灣時間）= 2026-09-30T16:00:00Z
    expect(inserted[0]).toEqual(expect.objectContaining({
      employee: 'emp-1', action: 'clockIn', remark: '備註 0, 第 0 批', source: 'import',
    }))
    expect(inserted[0].timestamp.toISOString()).toBe('2026-09-30T16:00:00.000Z')
    const last = inserted[TOTAL_ROWS - 1]
    expect(last).toEqual(expect.objectContaining({ employee: `emp-${USERS.length}`, action: 'clockOut', remark: '備註 4999, 第 49 批' }))
    expect(last.timestamp.toISOString()).toBe(new Date(Date.parse('2026-09-30T16:00:00.000Z') + 4999 * 60000).toISOString())
  })

  it('UTF-8 BOM + CRLF 換行的大檔案一樣讀得到全部的列', async () => {
    const res = createMockRes()
    const buffer = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(csvText('\r\n'))])

    await importAttendanceRecords(csvRequest(buffer, { dryRun: true }), res)

    expect(res.json.mock.calls[0][0].summary).toMatchObject({ totalRows: TOTAL_ROWS, readyCount: TOTAL_ROWS })
  })

  it('UTF-16LE（含 BOM）的大檔案一樣讀得到全部的列', async () => {
    const res = createMockRes()
    const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(csvText('\r\n'), 'utf16le')])

    await importAttendanceRecords(csvRequest(buffer, { dryRun: true }), res)

    expect(res.json.mock.calls[0][0].summary).toMatchObject({ totalRows: TOTAL_ROWS, readyCount: TOTAL_ROWS })
  })

  it('只有標題列的 CSV 照舊回覆「匯入檔案沒有資料」；空檔案也是', async () => {
    for (const text of ['USERID,CHECKTIME,CHECKTYPE\r\n', '']) {
      const res = createMockRes()
      // eslint-disable-next-line no-await-in-loop
      await importAttendanceRecords(csvRequest(Buffer.from(text), { dryRun: true }), res)
      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith({ message: '匯入檔案沒有資料', errors: [] })
    }
  })
})
