import ExcelJS from 'exceljs'
import { jest } from '@jest/globals'

const mockAttendanceRecord = {
  insertMany: jest.fn(),
  // 匯入前比對資料庫裡已經有的打卡（重複略過）
  find: jest.fn(),
  // 匯入只能新增：以下修改、刪除的方法都不應被呼叫
  deleteMany: jest.fn(),
  deleteOne: jest.fn(),
  updateMany: jest.fn(),
  updateOne: jest.fn(),
  replaceOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findOneAndDelete: jest.fn(),
  bulkWrite: jest.fn()
}

const WRITE_METHODS_OTHER_THAN_INSERT = [
  'deleteMany', 'deleteOne', 'updateMany', 'updateOne', 'replaceOne', 'findOneAndUpdate', 'findOneAndDelete', 'bulkWrite'
]

let mockExistingRecords = []

function mockExistingRecordsWith(records) {
  mockExistingRecords = records
}

const mockEmployeeModel = {
  find: jest.fn()
}

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({
  default: mockAttendanceRecord
}))

jest.unstable_mockModule('../src/models/Employee.js', () => ({
  default: mockEmployeeModel
}))

const mockIsTokenBlacklisted = jest.fn()
jest.unstable_mockModule('../src/utils/tokenBlacklist.js', () => ({
  isTokenBlacklisted: mockIsTokenBlacklisted
}))

const { importAttendanceRecords, parseTimestamp } = await import('../src/controllers/attendanceImportController.js')

function mockEmployeeFindWith(data) {
  const lean = jest.fn().mockResolvedValue(data)
  const select = jest.fn().mockReturnValue({ lean })
  mockEmployeeModel.find.mockReturnValue({ select, lean })
}

function createMockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn()
  return res
}

async function createWorkbookBuffer(rows) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Records')
  worksheet.addRow(['USERID', 'CHECKTIME', 'CHECKTYPE', 'REMARK'])
  rows.forEach(row => {
    worksheet.addRow([
      row.USERID,
      row.CHECKTIME,
      row.CHECKTYPE,
      row.REMARK ?? ''
    ])
  })
  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

beforeEach(() => {
  mockAttendanceRecord.insertMany.mockReset()
  WRITE_METHODS_OTHER_THAN_INSERT.forEach(method => mockAttendanceRecord[method].mockReset())
  mockAttendanceRecord.find.mockReset()
  mockExistingRecords = []
  mockAttendanceRecord.find.mockImplementation(() => {
    const lean = jest.fn().mockImplementation(async () => mockExistingRecords)
    const select = jest.fn().mockReturnValue({ lean })
    return { select, lean }
  })
  mockEmployeeModel.find.mockReset()
  mockIsTokenBlacklisted.mockReset()
  mockIsTokenBlacklisted.mockResolvedValue(false)
})

describe('parseTimestamp', () => {
  it('能解析純數字字串並轉換為正確日期', () => {
    const result = parseTimestamp('45625.3362384259', 'Asia/Taipei')
    expect(result.error).toBeNull()
    expect(result.value).toBeInstanceOf(Date)
    expect(result.value.toISOString()).toBe('2024-11-29T00:04:11.000Z')
  })

  it('能解析帶有損壞中文 PM 標記的時間戳（下��）', () => {
    const result = parseTimestamp('2025/11/2 下�� 11:50:45', 'Asia/Taipei')
    expect(result.error).toBeNull()
    expect(result.value).toBeInstanceOf(Date)
    // "下��" should be interpreted as PM (下午), so 11:50:45 PM in Asia/Taipei
    // which is 15:50:45 UTC (Taipei is UTC+8)
    expect(result.value.toISOString()).toBe('2025-11-02T15:50:45.000Z')
  })

  it('能解析帶有損壞中文 AM 標記的時間戳', () => {
    const result = parseTimestamp('2025/11/2 上�� 08:30:00', 'Asia/Taipei')
    expect(result.error).toBeNull()
    expect(result.value).toBeInstanceOf(Date)
    // "上��" should be interpreted as AM (上午), so 08:30:00 AM in Asia/Taipei
    // which is 00:30:00 UTC
    expect(result.value.toISOString()).toBe('2025-11-02T00:30:00.000Z')
  })
})

describe('attendanceImportController', () => {
  it('會解析欄位並轉換為 clockIn 動作與 UTC 時間', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'A001', CHECKTIME: '2024-01-05 08:15:00', CHECKTYPE: 'I', REMARK: '早班' }
    ])

    mockEmployeeFindWith([{ _id: 'emp1', employeeId: 'A001', email: 'user@example.com', name: 'User' }])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      employee: 'emp1',
      action: 'clockIn',
      remark: '早班'
    })
    expect(inserted[0].timestamp.toISOString()).toBe('2024-01-05T00:15:00.000Z')

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: '考勤資料匯入完成',
      summary: expect.objectContaining({ readyCount: 1, importedCount: 1, uniqueUserCount: 1 })
    }))
  })

  it('會將字串 0/1 的 CHECKTYPE 轉換為 clockOut/clockIn 並成功匯入', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'B001', CHECKTIME: '2024-02-01 09:00', CHECKTYPE: '1' },
      { USERID: 'B002', CHECKTIME: '2024-02-01 18:00', CHECKTYPE: '0' }
    ])

    mockEmployeeFindWith([
      { _id: 'emp-clockin', employeeId: 'B001', name: 'Morning' },
      { _id: 'emp-clockout', employeeId: 'B002', name: 'Evening' }
    ])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({ employee: 'emp-clockin', action: 'clockIn' })
    expect(inserted[1]).toMatchObject({ employee: 'emp-clockout', action: 'clockOut' })
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '考勤資料匯入完成',
        summary: expect.objectContaining({ readyCount: 2, importedCount: 2, uniqueUserCount: 2 })
      })
    )
  })

  it('找不到員工時會回傳 missingUsers 結構並不匯入', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'unknown', CHECKTIME: '2024-01-05 09:00', CHECKTYPE: 'O' }
    ])

    mockEmployeeFindWith([])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: true })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      dryRun: true,
      missingUsers: [
        expect.objectContaining({ identifier: 'unknown', count: 1 })
      ]
    }))
  })

  it('可透過 userMappings 對應使用者並成功匯入', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: '外部帳號', CHECKTIME: '2024/01/05 18:30:00', CHECKTYPE: 'O' }
    ])

    mockEmployeeFindWith([{ _id: 'emp2', email: 'mapped@example.com', name: 'Mapped' }])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei' }),
        userMappings: JSON.stringify({ '外部帳號': { email: 'mapped@example.com' } })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted[0]).toMatchObject({
      employee: 'emp2',
      action: 'clockOut'
    })
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      summary: expect.objectContaining({ readyCount: 1 }),
      message: '考勤資料匯入完成'
    }))
  })

  it('非預覽模式且沒有資料成功匯入時會回傳 400 與失敗摘要', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'unknown', CHECKTIME: '2024-01-05 09:00', CHECKTYPE: 'I' }
    ])

    mockEmployeeFindWith([])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(400)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('所有資料均未匯入'),
        failureReasons: expect.arrayContaining([
          expect.stringContaining('1 筆資料缺少對應員工')
        ]),
        summary: expect.objectContaining({ importedCount: 0, missingCount: 1 })
      })
    )
  })

  it('可解析 UTF-16LE 編碼的 CSV 並於預覽顯示正確時間', async () => {
    const csvContent = 'USERID,CHECKTIME,CHECKTYPE\nEMP001,2024-03-01 09:30:00,I\n'
    const bom = Buffer.from([0xff, 0xfe])
    const encoded = Buffer.from(csvContent, 'utf16le')
    const buffer = Buffer.concat([bom, encoded])

    mockEmployeeFindWith([{ _id: 'emp-utf16', employeeId: 'EMP001', name: 'UTF16 User' }])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'text/csv',
        originalname: 'attendance.csv'
      },
      body: {
        options: JSON.stringify({ dryRun: true, timezone: 'Asia/Taipei' })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalled()
    const response = res.json.mock.calls[0][0]
    expect(response.preview).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: 'EMP001',
          status: 'ready',
          timestamp: '2024-03-01T01:30:00.000Z'
        })
      ])
    )
  })

  it('支援 12 小時制與中文 AM/PM 標記', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'C001', CHECKTIME: '2024-01-05 06:30 PM', CHECKTYPE: 'I' },
      { USERID: 'C001', CHECKTIME: '2024/01/05 下午 06:30:00', CHECKTYPE: 'O' }
    ])

    mockEmployeeFindWith([{ _id: 'emp12h', employeeId: 'C001', name: 'Twelve Hour' }])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({ action: 'clockIn', employee: 'emp12h' })
    expect(inserted[0].timestamp.toISOString()).toBe('2024-01-05T10:30:00.000Z')
    expect(inserted[1]).toMatchObject({ action: 'clockOut', employee: 'emp12h' })
    expect(inserted[1].timestamp.toISOString()).toBe('2024-01-05T10:30:00.000Z')
  })

  it('missingCount 會統計所有缺少員工的總筆數', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'unknown', CHECKTIME: '2024-01-05 09:00', CHECKTYPE: 'I' },
      { USERID: 'unknown', CHECKTIME: '2024-01-05 18:00', CHECKTYPE: 'O' },
      { USERID: 'unknown', CHECKTIME: '2024-01-06 09:00', CHECKTYPE: 'I' }
    ])

    mockEmployeeFindWith([])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: true })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        summary: expect.objectContaining({ missingCount: 3, readyCount: 0 }),
        missingUsers: [expect.objectContaining({ identifier: 'unknown', count: 3 })]
      })
    )
  })

  it('遇到無效時間戳時會回傳詳細錯誤並記錄 log', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'ERR001', CHECKTIME: 'not-a-date', CHECKTYPE: 'I' }
    ])

    mockEmployeeFindWith([])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: true })
      }
    }

    const res = createMockRes()
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await importAttendanceRecords(req, res)

      expect(res.json).toHaveBeenCalledTimes(1)
      const payload = res.json.mock.calls[0][0]
      expect(payload.summary.errorCount).toBe(1)
      expect(payload.preview[0].errors).toContain('無法解析 CHECKTIME：CHECKTIME 格式不支援')
      expect(payload.preview[0].timestampError).toBe('CHECKTIME 格式不支援')

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'attendance-import: validation failed',
        expect.objectContaining({
          userId: 'ERR001',
          rawTimestamp: 'not-a-date',
          errors: expect.arrayContaining(['無法解析 CHECKTIME：CHECKTIME 格式不支援'])
        })
      )
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('dryRun 模擬大檔案僅回傳樣本並統計唯一使用者', async () => {
    const totalRows = 1200
    const uniqueUsers = 120
    const users = Array.from({ length: uniqueUsers }, (_, index) => {
      const employeeId = `EMP${String(index + 1).padStart(4, '0')}`
      return {
        employeeId,
        employee: {
          _id: `emp-${index + 1}`,
          employeeId,
          name: `User ${index + 1}`
        }
      }
    })

    const rows = []
    for (let i = 0; i < totalRows; i += 1) {
      const user = users[i % users.length]
      rows.push({
        USERID: user.employeeId,
        CHECKTIME: `2024-03-${String((i % 28) + 1).padStart(2, '0')} 08:00:00`,
        CHECKTYPE: 'I'
      })
    }

    const buffer = await createWorkbookBuffer(rows)
    mockEmployeeFindWith(users.map(user => user.employee))

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: true })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    expect(res.json).toHaveBeenCalledTimes(1)
    const payload = res.json.mock.calls[0][0]
    expect(payload.summary).toMatchObject({
      totalRows,
      readyCount: totalRows,
      importedCount: 0,
      uniqueUserCount: uniqueUsers
    })
    expect(payload.preview).toHaveLength(50)
    expect(payload.preview.every(item => item.status === 'ready')).toBe(true)
  })

  it('正式匯入大檔案會分批 insertMany 並回傳樣本', async () => {
    const totalRows = 1305
    const uniqueUsers = 87
    const users = Array.from({ length: uniqueUsers }, (_, index) => {
      const employeeId = `EMP${String(index + 1).padStart(4, '0')}`
      return {
        employeeId,
        employee: {
          _id: `emp-${index + 1}`,
          employeeId,
          name: `User ${index + 1}`
        }
      }
    })

    const rows = []
    for (let i = 0; i < totalRows; i += 1) {
      const user = users[i % users.length]
      rows.push({
        USERID: user.employeeId,
        CHECKTIME: `2024-04-${String((i % 28) + 1).padStart(2, '0')} 09:00:00`,
        CHECKTYPE: i % 2 === 0 ? 'I' : 'O'
      })
    }

    const buffer = await createWorkbookBuffer(rows)
    mockEmployeeFindWith(users.map(user => user.employee))

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    const expectedCalls = Math.ceil(totalRows / 500)
    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(expectedCalls)
    const insertedTotal = mockAttendanceRecord.insertMany.mock.calls.reduce(
      (sum, [batch]) => {
        expect(batch.length).toBeLessThanOrEqual(500)
        return sum + batch.length
      },
      0
    )
    expect(insertedTotal).toBe(totalRows)

    expect(res.json).toHaveBeenCalledTimes(1)
    const payload = res.json.mock.calls[0][0]
    expect(payload.summary).toMatchObject({
      totalRows,
      readyCount: totalRows,
      importedCount: totalRows,
      uniqueUserCount: uniqueUsers
    })
    expect(payload.preview).toHaveLength(50)
    expect(payload.preview[0].status).toBe('ready')
  })

  it('支援中文簽到/退類型 - 上班簽到和下班簽退', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'E001', CHECKTIME: '2024-05-01 08:00:00', CHECKTYPE: '上班簽到' },
      { USERID: 'E001', CHECKTIME: '2024-05-01 17:00:00', CHECKTYPE: '下班簽退' }
    ])

    mockEmployeeFindWith([{ _id: 'emp-chinese', employeeId: 'E001', name: 'Test User' }])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({ employee: 'emp-chinese', action: 'clockIn' })
    expect(inserted[1]).toMatchObject({ employee: 'emp-chinese', action: 'clockOut' })
  })

  it('將加班簽到/加班簽退視同一般上下班簽到退匯入', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'E002', CHECKTIME: '2024-05-01 18:00:00', CHECKTYPE: '加班簽到' },
      { USERID: 'E002', CHECKTIME: '2024-05-01 20:00:00', CHECKTYPE: '加班簽退' }
    ])

    mockEmployeeFindWith([{ _id: 'emp-overtime', employeeId: 'E002', name: 'Overtime User' }])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({ employee: 'emp-overtime', action: 'clockIn' })
    expect(inserted[1]).toMatchObject({ employee: 'emp-overtime', action: 'clockOut' })
  })

  it('支援姓名欄位並使用編號+姓名組合匹配員工', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Records')
    worksheet.addRow(['編號', '姓名', '日期時間', '簽到/退'])
    worksheet.addRow(['D0021', '楊世任', '2025/11/1 上午 07:54:21', '上班簽到'])
    worksheet.addRow(['D0021', '楊世任', '2025/11/1 下午 12:00:03', '下班簽退'])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    mockEmployeeFindWith([
      { _id: 'emp-yang', employeeId: 'D0021', name: '楊世任', email: 'yang@test.com' }
    ])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        mappings: JSON.stringify({
          userId: '編號',
          name: '姓名',
          timestamp: '日期時間',
          type: '簽到/退'
        }),
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({
      employee: 'emp-yang',
      action: 'clockIn'
    })
    expect(inserted[0].timestamp.toISOString()).toBe('2025-10-31T23:54:21.000Z')
    expect(inserted[1]).toMatchObject({
      employee: 'emp-yang',
      action: 'clockOut'
    })
    expect(inserted[1].timestamp.toISOString()).toBe('2025-11-01T04:00:03.000Z')
  })

  it('當只有姓名匹配且僅一位員工時可正確匹配', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Records')
    worksheet.addRow(['編號', '姓名', '日期時間', '簽到/退'])
    worksheet.addRow(['UNKNOWN_ID', '張三', '2025/11/2 上午 09:00:00', '上班簽到'])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    mockEmployeeFindWith([
      { _id: 'emp-zhang', employeeId: 'Z001', name: '張三', email: 'zhang@test.com' }
    ])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        mappings: JSON.stringify({
          userId: '編號',
          name: '姓名',
          timestamp: '日期時間',
          type: '簽到/退'
        }),
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      employee: 'emp-zhang',
      action: 'clockIn'
    })
  })

  it('當有多位同名員工但編號匹配時選擇正確的員工', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Records')
    worksheet.addRow(['編號', '姓名', '日期時間', '簽到/退'])
    worksheet.addRow(['L001', '李四', '2025/11/3 上午 08:30:00', '上班簽到'])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    mockEmployeeFindWith([
      { _id: 'emp-li-1', employeeId: 'L001', name: '李四', email: 'li1@test.com' },
      { _id: 'emp-li-2', employeeId: 'L002', name: '李四', email: 'li2@test.com' }
    ])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        mappings: JSON.stringify({
          userId: '編號',
          name: '姓名',
          timestamp: '日期時間',
          type: '簽到/退'
        }),
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      employee: 'emp-li-1',
      action: 'clockIn'
    })
  })

  it('支援帶有損壞中文 AM/PM 標記的時間戳（如下��）', async () => {
    const workbook = new ExcelJS.Workbook()
    const worksheet = workbook.addWorksheet('Records')
    worksheet.addRow(['USERID', 'CHECKTIME', 'CHECKTYPE', 'NAME'])
    // Test the exact case from the error: '2025/11/2 下�� 11:50:45'
    // We'll simulate this with a string that has the corrupted character
    worksheet.addRow(['E0108', '2025/11/2 下�� 11:50:45', '上班簽到', ''])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())

    mockEmployeeFindWith([
      { _id: 'emp-e0108', employeeId: 'E0108', name: 'Test User', email: 'e0108@test.com' }
    ])

    const req = {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun: false })
      }
    }

    const res = createMockRes()

    await importAttendanceRecords(req, res)

    // Should successfully parse and import despite corrupted character
    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(1)
    const inserted = mockAttendanceRecord.insertMany.mock.calls[0][0]
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      employee: 'emp-e0108',
      action: 'clockIn'
    })
    // Should be interpreted as PM (11:50:45 PM = 23:50:45 in 24-hour)
    // Asia/Taipei is UTC+8, so 23:50:45 Taipei - 8 hours = 15:50:45 UTC
    expect(inserted[0].timestamp.toISOString()).toBe('2025-11-02T15:50:45.000Z')
  })
})

// 指紋匯入與線上打卡互補、不互相覆蓋：匯入只新增（標記來源 import），
// 同一位員工、同一個動作、同一分鐘已經有的打卡（不論來源）或檔案內重複的列都略過，計入「重複略過」
describe('attendanceImportController 打卡來源與重複略過', () => {
  const EMPLOYEE = { _id: 'emp-src', employeeId: 'S001', name: '護理師', email: 's001@example.com' }

  function buildRequest(buffer, { dryRun = false } = {}) {
    return {
      user: { role: 'admin' },
      file: {
        buffer,
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        originalname: 'attendance.xlsx'
      },
      body: {
        options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun })
      }
    }
  }

  function expectNoUpdateOrDelete() {
    WRITE_METHODS_OTHER_THAN_INSERT.forEach(method => {
      expect(mockAttendanceRecord[method]).not.toHaveBeenCalled()
    })
  }

  const insertedRows = () => mockAttendanceRecord.insertMany.mock.calls.flatMap(([batch]) => batch)

  it('匯入的打卡標記來源為 import，只新增、不修改也不刪除既有記錄', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:55:00', CHECKTYPE: 'I' },
      { USERID: 'S001', CHECKTIME: '2026-10-21 17:05:00', CHECKTYPE: 'O' }
    ])
    mockEmployeeFindWith([EMPLOYEE])
    const res = createMockRes()

    await importAttendanceRecords(buildRequest(buffer), res)

    expect(insertedRows()).toEqual([
      expect.objectContaining({ employee: 'emp-src', action: 'clockIn', source: 'import' }),
      expect.objectContaining({ employee: 'emp-src', action: 'clockOut', source: 'import' })
    ])
    expectNoUpdateOrDelete()
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: '考勤資料匯入完成',
      summary: expect.objectContaining({ readyCount: 2, importedCount: 2, duplicateCount: 0 })
    }))
  })

  it('同一個檔案裡同一員工、同一動作、同一分鐘的打卡只匯入一次', async () => {
    const buffer = await createWorkbookBuffer([
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:55:10', CHECKTYPE: 'I' },
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:55:50', CHECKTYPE: 'I' },
      // 下一分鐘、或同一分鐘的不同動作都不是重複
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:56:00', CHECKTYPE: 'I' },
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:55:30', CHECKTYPE: 'O' }
    ])
    mockEmployeeFindWith([EMPLOYEE])
    const res = createMockRes()

    await importAttendanceRecords(buildRequest(buffer), res)

    expect(insertedRows().map(row => [row.action, row.timestamp.toISOString()])).toEqual([
      ['clockIn', '2026-10-20T23:55:10.000Z'],
      ['clockIn', '2026-10-20T23:56:00.000Z'],
      ['clockOut', '2026-10-20T23:55:30.000Z']
    ])
    const payload = res.json.mock.calls[0][0]
    expect(payload.summary).toMatchObject({ totalRows: 4, readyCount: 4, duplicateCount: 1, importedCount: 3 })
    expect(payload.preview[1]).toMatchObject({ rowNumber: 3, status: 'duplicate', duplicateReason: expect.stringContaining('檔案中') })
    expect(payload.message).toBe('考勤資料匯入完成（新增 3 筆，重複略過 1 筆）')
  })

  it('系統已有的打卡（線上打卡、舊資料）同一分鐘就略過，不覆蓋也不重複新增，其他照常新增', async () => {
    mockExistingRecordsWith([
      // 員工 08:10:23 已在線上簽到
      { employee: 'emp-src', action: 'clockIn', timestamp: new Date('2026-10-21T00:10:23.000Z'), source: 'online' },
      // 沒有來源欄位的舊資料
      { employee: 'emp-src', action: 'clockOut', timestamp: new Date('2026-10-21T09:05:59.000Z') }
    ])
    const buffer = await createWorkbookBuffer([
      { USERID: 'S001', CHECKTIME: '2026-10-21 08:10:45', CHECKTYPE: 'I' },
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:55:00', CHECKTYPE: 'I' },
      { USERID: 'S001', CHECKTIME: '2026-10-21 17:05:00', CHECKTYPE: 'O' }
    ])
    mockEmployeeFindWith([EMPLOYEE])
    const res = createMockRes()

    await importAttendanceRecords(buildRequest(buffer), res)

    expect(mockAttendanceRecord.find).toHaveBeenCalledWith({
      employee: { $in: ['emp-src'] },
      timestamp: {
        $gte: new Date('2026-10-20T23:55:00.000Z'),
        $lt: new Date('2026-10-21T09:06:00.000Z')
      }
    })
    expect(insertedRows()).toEqual([
      expect.objectContaining({ action: 'clockIn', timestamp: new Date('2026-10-20T23:55:00.000Z'), source: 'import' })
    ])
    expectNoUpdateOrDelete()
    const payload = res.json.mock.calls[0][0]
    expect(payload.summary).toMatchObject({ readyCount: 3, duplicateCount: 2, importedCount: 1 })
    expect(payload.preview.filter(row => row.status === 'duplicate').map(row => row.rowNumber)).toEqual([2, 4])
    expect(payload.preview[0].duplicateReason).toContain('系統已有')
  })

  it('同一個檔案再匯入一次不會新增任何記錄：回傳 200 並說明重複略過的筆數', async () => {
    mockExistingRecordsWith([
      { employee: 'emp-src', action: 'clockIn', timestamp: new Date('2026-10-20T23:55:00.000Z'), source: 'import' },
      { employee: 'emp-src', action: 'clockOut', timestamp: new Date('2026-10-21T09:05:00.000Z'), source: 'import' }
    ])
    const buffer = await createWorkbookBuffer([
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:55:00', CHECKTYPE: 'I' },
      { USERID: 'S001', CHECKTIME: '2026-10-21 17:05:00', CHECKTYPE: 'O' }
    ])
    mockEmployeeFindWith([EMPLOYEE])
    const res = createMockRes()

    await importAttendanceRecords(buildRequest(buffer), res)

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    expectNoUpdateOrDelete()
    expect(res.status).not.toHaveBeenCalled()
    const payload = res.json.mock.calls[0][0]
    expect(payload.message).toBe('沒有新的打卡記錄：2 筆與既有打卡記錄重複，已略過')
    expect(payload.summary).toMatchObject({ readyCount: 2, duplicateCount: 2, importedCount: 0, errorCount: 0 })
    expect(payload.failureReasons).toBeUndefined()
  })

  it('有缺少對應員工的列時，重複略過一併列在失敗原因裡', async () => {
    mockExistingRecordsWith([
      { employee: 'emp-src', action: 'clockIn', timestamp: new Date('2026-10-20T23:55:00.000Z'), source: 'online' }
    ])
    const buffer = await createWorkbookBuffer([
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:55:00', CHECKTYPE: 'I' },
      { USERID: 'unknown', CHECKTIME: '2026-10-21 08:00:00', CHECKTYPE: 'I' }
    ])
    mockEmployeeFindWith([EMPLOYEE])
    const res = createMockRes()
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await importAttendanceRecords(buildRequest(buffer), res)
    } finally {
      warnSpy.mockRestore()
    }

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    const payload = res.json.mock.calls[0][0]
    expect(payload.failureReasons).toEqual(['1 筆資料缺少對應員工', '1 筆與既有打卡記錄重複，已略過'])
    expect(payload.message).toBe('所有資料均未匯入：1 筆資料缺少對應員工、1 筆與既有打卡記錄重複，已略過')
  })

  it('預覽（dryRun）也會標出重複略過的列，但不寫入資料庫', async () => {
    mockExistingRecordsWith([
      { employee: 'emp-src', action: 'clockOut', timestamp: new Date('2026-10-21T09:05:00.000Z'), source: 'online' }
    ])
    const buffer = await createWorkbookBuffer([
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:55:00', CHECKTYPE: 'I' },
      { USERID: 'S001', CHECKTIME: '2026-10-21 17:05:20', CHECKTYPE: 'O' }
    ])
    mockEmployeeFindWith([EMPLOYEE])
    const res = createMockRes()

    await importAttendanceRecords(buildRequest(buffer, { dryRun: true }), res)

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    const payload = res.json.mock.calls[0][0]
    expect(payload.message).toBe('預覽成功')
    expect(payload.summary).toMatchObject({ readyCount: 2, duplicateCount: 1, importedCount: 0 })
    expect(payload.preview.map(row => row.status)).toEqual(['ready', 'duplicate'])
  })

  it('跨批次（每 500 筆）也會略過檔案內重複的列', async () => {
    const rows = []
    for (let index = 0; index < 501; index += 1) {
      const minute = String(index % 60).padStart(2, '0')
      const hour = String(Math.floor(index / 60)).padStart(2, '0')
      rows.push({ USERID: 'S001', CHECKTIME: `2026-10-21 ${hour}:${minute}:00`, CHECKTYPE: 'I' })
    }
    // 與第一列同一分鐘
    rows.push({ USERID: 'S001', CHECKTIME: '2026-10-21 00:00:30', CHECKTYPE: 'I' })
    const buffer = await createWorkbookBuffer(rows)
    mockEmployeeFindWith([EMPLOYEE])
    const res = createMockRes()

    await importAttendanceRecords(buildRequest(buffer), res)

    expect(mockAttendanceRecord.insertMany).toHaveBeenCalledTimes(2)
    expect(insertedRows()).toHaveLength(501)
    expect(res.json.mock.calls[0][0].summary).toMatchObject({ totalRows: 502, duplicateCount: 1, importedCount: 501 })
  })

  it('比對既有打卡失敗時回傳 500，不會把檔案當成已匯入', async () => {
    mockAttendanceRecord.find.mockImplementation(() => ({
      select: () => ({ lean: () => Promise.reject(new Error('db down')) })
    }))
    const buffer = await createWorkbookBuffer([
      { USERID: 'S001', CHECKTIME: '2026-10-21 07:55:00', CHECKTYPE: 'I' }
    ])
    mockEmployeeFindWith([EMPLOYEE])
    const res = createMockRes()
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

    try {
      await importAttendanceRecords(buildRequest(buffer), res)
    } finally {
      errorSpy.mockRestore()
    }

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: '考勤資料寫入失敗，請稍後再試',
      summary: { importedCount: 0, duplicateCount: 0 }
    }))
  })
})
