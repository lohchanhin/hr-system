import ExcelJS from 'exceljs'
import { jest } from '@jest/globals'

const mockAttendanceRecord = {
  insertMany: jest.fn()
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

const { importAttendanceRecords } = await import('../src/controllers/attendanceImportController.js')

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
  mockEmployeeModel.find.mockReset()
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
})
