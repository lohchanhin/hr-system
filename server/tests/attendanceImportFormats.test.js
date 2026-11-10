// 考勤匯入的時間格式與編碼（2026-11 複查，以下每一項修正前都重現過）：
// - Excel 的日期時間儲存格每一列都回「CHECKTIME 格式不支援」。
// - 沒有時區的時間（帶毫秒、只有日期、英文月份）交給 new Date() 解析後取 UTC 欄位，伺服器時區不是 UTC 時整批差了好幾個小時。
// - 2/30、13 月、24:00、下午 17:30 這類超出範圍的值被 Date.UTC 自動進位，悄悄存成另一天的打卡。
// - 民國年（115/11/10）、緊湊格式（20261110083000）不支援。
// - Big5（ANSI）的 CSV 被當成 UTF-8：中文的簽到／簽退無法判斷，「下午 05:30」被存成清晨 05:30。
// - 超過一批（500 筆）的檔案中途寫入失敗時回 400「無法讀取匯入檔案」，看不出前面幾批已經存進去。
import { jest } from '@jest/globals'
import ExcelJS from 'exceljs'

const mockAttendanceRecord = { insertMany: jest.fn(), find: jest.fn() }
const mockEmployeeModel = { find: jest.fn() }

jest.unstable_mockModule('../src/models/AttendanceRecord.js', () => ({ default: mockAttendanceRecord }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployeeModel }))

const { importAttendanceRecords, parseTimestamp } = await import('../src/controllers/attendanceImportController.js')

const EMPLOYEE = { _id: 'emp-1', employeeId: 'N001', name: '王小明' }
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function createMockRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn()
  return res
}

function requestOf(buffer, { csv = false, dryRun = false, mappings } = {}) {
  return {
    user: { role: 'admin' },
    file: csv
      ? { buffer, mimetype: 'text/csv', originalname: 'attendance.csv' }
      : { buffer, mimetype: XLSX_TYPE, originalname: 'attendance.xlsx' },
    body: {
      options: JSON.stringify({ timezone: 'Asia/Taipei', dryRun }),
      ...(mappings ? { mappings: JSON.stringify(mappings) } : {}),
    },
  }
}

const insertedRows = () => mockAttendanceRecord.insertMany.mock.calls.flatMap(([docs]) => docs)
const taipei = (result) => (result.value
  ? new Date(result.value.getTime() + 8 * 3600000).toISOString().slice(0, 19).replace('T', ' ')
  : `ERR ${result.error}`)

// 把文字編成 Big5：Node 只有解碼器，所以先把所有雙位元組解一遍建立反查表
let big5Table = null
function toBig5(text) {
  if (!big5Table) {
    big5Table = new Map()
    const decoder = new TextDecoder('big5')
    for (let lead = 0x81; lead <= 0xfe; lead += 1) {
      for (let trail = 0x40; trail <= 0xfe; trail += 1) {
        if (trail > 0x7e && trail < 0xa1) continue
        const char = decoder.decode(Buffer.from([lead, trail]))
        if (char.length === 1 && char !== '�' && !big5Table.has(char)) big5Table.set(char, [lead, trail])
      }
    }
  }
  const bytes = []
  for (const char of text) {
    if (char.charCodeAt(0) < 0x80) bytes.push(char.charCodeAt(0))
    else if (big5Table.has(char)) bytes.push(...big5Table.get(char))
    else throw new Error(`no Big5 mapping for ${char}`)
  }
  return Buffer.from(bytes)
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
  const lean = jest.fn().mockResolvedValue([EMPLOYEE])
  mockEmployeeModel.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean }), lean })
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('parseTimestamp：沒有時區的時間一律是匯入時區（台灣）的時間，不受伺服器時區影響', () => {
  it.each([
    ['2026-11-10 08:00:00', '2026-11-10 08:00:00'],
    ['2026-11-10 08:00:00.000', '2026-11-10 08:00:00'],
    ['2026-11-10T08:00:00.123', '2026-11-10 08:00:00'],
    ['2026/11/10', '2026-11-10 00:00:00'],
    ['2026-11-10', '2026-11-10 00:00:00'],
    ['Nov 10 2026 08:00', '2026-11-10 08:00:00'],
    ['11/10/2026 05:30 PM', '2026-11-10 17:30:00'],
    ['2026/11/10 下午 05:30:00', '2026-11-10 17:30:00'],
    ['2026/11/10 12:30 上午', '2026-11-10 00:30:00'],
    // 帶時區的照時區換算
    ['2026-11-10T00:00:00Z', '2026-11-10 08:00:00'],
    ['2026-11-10T08:00:00+08:00', '2026-11-10 08:00:00'],
  ])('%s -> %s', (input, expected) => {
    expect(taipei(parseTimestamp(input, 'Asia/Taipei'))).toBe(expected)
  })

  it('民國年、中文年月日、緊湊格式', () => {
    const cases = {
      '115/11/10 08:00': '2026-11-10 08:00:00',
      '115/11/10 下午 05:30:00': '2026-11-10 17:30:00',
      '115-11-10': '2026-11-10 00:00:00',
      '115.11.10 08:00': '2026-11-10 08:00:00',
      '民國115年11月10日 08:00': '2026-11-10 08:00:00',
      '2026年11月10日 08:00': '2026-11-10 08:00:00',
      '2026.11.10 08:00': '2026-11-10 08:00:00',
      '20261110083000': '2026-11-10 08:30:00',
      '202611100830': '2026-11-10 08:30:00',
    }
    for (const [input, expected] of Object.entries(cases)) {
      expect([input, taipei(parseTimestamp(input, 'Asia/Taipei'))]).toEqual([input, expected])
    }
  })

  it('已經是 24 小時制又帶「下午」時不再加 12 小時', () => {
    expect(taipei(parseTimestamp('2026/11/10 下午 17:30', 'Asia/Taipei'))).toBe('2026-11-10 17:30:00')
  })

  it.each([
    '2026-02-30 08:00:00',
    '2026-13-40 08:00',
    '2026-11-10 24:00:00',
    '2026-11-10 08:61',
    '25/12/2026 08:00',
  ])('超出範圍的日期時間 %s 回報錯誤，不會自動進位成另一天', (input) => {
    const result = parseTimestamp(input, 'Asia/Taipei')
    expect(result.value).toBeNull()
    expect(result.error).toBe('打卡時間的日期或時間超出範圍')
  })

  it('Excel 序號（數字）照舊；Date 物件四捨五入到秒', () => {
    expect(taipei(parseTimestamp('46336.3333333333', 'Asia/Taipei'))).toBe('2026-11-10 08:00:00')
    expect(taipei(parseTimestamp(new Date(Date.UTC(2026, 10, 10, 7, 59, 59, 999)), 'Asia/Taipei'))).toBe('2026-11-10 08:00:00')
  })
})

describe('考勤匯入：Excel 日期儲存格與 Big5 CSV', () => {
  it('Excel 的日期時間儲存格（不是文字）可以匯入，時間是檔案上的台灣時間', async () => {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('考勤')
    sheet.addRow(['USERID', 'CHECKTIME', 'CHECKTYPE'])
    // ExcelJS 以 UTC 表示儲存格上的時間：這兩格在 Excel 裡顯示 2026/11/10 07:55、17:05
    sheet.addRow(['N001', new Date(Date.UTC(2026, 10, 10, 7, 55, 0)), 'I'])
    sheet.addRow(['N001', new Date(Date.UTC(2026, 10, 10, 17, 5, 0)), 'O'])
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
    const res = createMockRes()

    await importAttendanceRecords(requestOf(buffer), res)

    expect(res.status).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0].summary).toMatchObject({ totalRows: 2, errorCount: 0, importedCount: 2 })
    expect(insertedRows().map((row) => [row.action, row.timestamp.toISOString()])).toEqual([
      ['clockIn', '2026-11-09T23:55:00.000Z'],
      ['clockOut', '2026-11-10T09:05:00.000Z'],
    ])
  })

  it('Big5（ANSI）的 CSV：中文欄名、姓名、上班簽到／下班簽退與上午／下午都讀得對', async () => {
    const csv = [
      '編號,姓名,日期時間,簽到/退',
      'N001,王小明,2026/11/10 上午 07:55:00,上班簽到',
      'N001,王小明,2026/11/10 下午 05:30:00,下班簽退',
    ].join('\r\n')
    const buffer = toBig5(csv)
    // 這個檔案不是有效的 UTF-8
    expect(() => new TextDecoder('utf-8', { fatal: true }).decode(buffer)).toThrow()
    const res = createMockRes()

    await importAttendanceRecords(requestOf(buffer, {
      csv: true,
      mappings: { userId: '編號', name: '姓名', timestamp: '日期時間', type: '簽到/退' },
    }), res)

    expect(res.status).not.toHaveBeenCalled()
    expect(res.json.mock.calls[0][0].summary).toMatchObject({ totalRows: 2, errorCount: 0, missingCount: 0, importedCount: 2 })
    expect(insertedRows().map((row) => [row.action, row.timestamp.toISOString()])).toEqual([
      ['clockIn', '2026-11-09T23:55:00.000Z'],
      // 下午 05:30 是 17:30（以前亂碼的「下午」認不出來，存成清晨 05:30）
      ['clockOut', '2026-11-10T09:30:00.000Z'],
    ])
    expect(res.json.mock.calls[0][0].preview[0].employee).toMatchObject({ name: '王小明' })
  })

  it('UTF-8（沒有 BOM）的中文 CSV 照舊', async () => {
    const csv = '編號,姓名,日期時間,簽到/退\nN001,王小明,2026/11/10 下午 05:30:00,下班簽退\n'
    const res = createMockRes()

    await importAttendanceRecords(requestOf(Buffer.from(csv, 'utf8'), {
      csv: true,
      mappings: { userId: '編號', name: '姓名', timestamp: '日期時間', type: '簽到/退' },
    }), res)

    expect(insertedRows().map((row) => [row.action, row.timestamp.toISOString()])).toEqual([
      ['clockOut', '2026-11-10T09:30:00.000Z'],
    ])
  })
})

describe('考勤匯入：沒有依時間或員工排序的大檔案', () => {
  it('一批裡員工多、時間又分散時，只查每一列自己那一分鐘的既有打卡（不是整段期間所有人的打卡），重複照樣略過', async () => {
    const employees = Array.from({ length: 10 }, (_, index) => ({ _id: `emp-${index}`, employeeId: `N10${index}`, name: `員工${index}` }))
    const lean = jest.fn().mockResolvedValue(employees)
    mockEmployeeModel.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean }), lean })
    const lines = ['USERID,CHECKTIME,CHECKTYPE']
    for (let index = 0; index < 20; index += 1) {
      // 10 位員工、橫跨 20 天，順序是打散的
      const day = String(((index * 7) % 20) + 1).padStart(2, '0')
      lines.push(`N10${index % 10},2026-10-${day} 08:0${index % 10}:00,I`)
    }
    const existingFilters = []
    mockAttendanceRecord.find.mockImplementation((filter) => {
      existingFilters.push(filter)
      // 資料庫已經有第一列那一筆（同一分鐘，秒數不同）
      const rows = [{ employee: 'emp-0', action: 'clockIn', timestamp: new Date('2026-10-01T00:00:30.000Z') }]
      const leanRows = jest.fn().mockResolvedValue(rows)
      return { select: jest.fn().mockReturnValue({ lean: leanRows }), lean: leanRows }
    })
    const res = createMockRes()

    await importAttendanceRecords(requestOf(Buffer.from(`${lines.join('\n')}\n`), { csv: true }), res)

    expect(existingFilters).toHaveLength(1)
    expect(existingFilters[0].$or).toHaveLength(20)
    expect(existingFilters[0].$or[0]).toEqual({
      employee: 'emp-0',
      timestamp: { $gte: new Date('2026-10-01T00:00:00.000Z'), $lt: new Date('2026-10-01T00:01:00.000Z') },
    })
    expect(res.json.mock.calls[0][0].summary).toMatchObject({ totalRows: 20, duplicateCount: 1, importedCount: 19 })
  })
})

describe('考勤匯入：超過一批的檔案中途寫入失敗', () => {
  function csvOf(rows) {
    const lines = ['USERID,CHECKTIME,CHECKTYPE']
    for (let index = 0; index < rows; index += 1) {
      const time = new Date(Date.UTC(2026, 9, 1, 0, 0) + index * 60000)
      lines.push(`N001,${time.toISOString().slice(0, 19).replace('T', ' ')},${index % 2 === 0 ? 'I' : 'O'}`)
    }
    return Buffer.from(`${lines.join('\n')}\n`)
  }

  it('第二批寫入失敗：回 500 並說明已新增幾筆（不是「無法讀取匯入檔案」）', async () => {
    mockAttendanceRecord.insertMany
      .mockImplementationOnce(async (docs) => docs)
      .mockRejectedValueOnce(new Error('db down'))
    const res = createMockRes()

    await importAttendanceRecords(requestOf(csvOf(1200), { csv: true }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    const body = res.json.mock.calls[0][0]
    expect(body.message).toBe('考勤資料寫入失敗：已新增 500 筆，其餘尚未匯入；請稍後用同一個檔案再匯入一次（已有的打卡會自動略過）')
    expect(body.summary).toEqual({ importedCount: 500, duplicateCount: 0 })
    // 不外洩資料庫的錯誤訊息
    expect(JSON.stringify(body)).not.toContain('db down')
  })

  it('第一批就失敗：回 500「考勤資料寫入失敗，請稍後再試」', async () => {
    mockAttendanceRecord.insertMany.mockRejectedValue(new Error('db down'))
    const res = createMockRes()

    await importAttendanceRecords(requestOf(csvOf(1200), { csv: true }), res)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json.mock.calls[0][0]).toMatchObject({
      message: '考勤資料寫入失敗，請稍後再試',
      summary: { importedCount: 0, duplicateCount: 0 },
    })
  })
})

// 員工編號沒有唯一限制：以前同一個編號有兩位員工時，後讀到的那一位蓋掉前面的，打卡可能整批記到已離職的那一筆資料上
describe('考勤匯入：同一個員工編號有多位員工', () => {
  const csv = Buffer.from('USERID,CHECKTIME,CHECKTYPE\nN001,2026-11-10 07:55:00,I\n')
  const employeesAre = (employees) => {
    const lean = jest.fn().mockResolvedValue(employees)
    mockEmployeeModel.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean }), lean })
  }

  it('只有一位不是離職員工：記到在職的那一位（不論資料庫回傳的順序）', async () => {
    const active = { _id: 'emp-active', employeeId: 'N001', name: '王小明', status: '正職員工' }
    const resigned = { _id: 'emp-resigned', employeeId: 'N001', name: '王小明', status: '離職員工' }
    for (const order of [[active, resigned], [resigned, active]]) {
      mockAttendanceRecord.insertMany.mockClear()
      employeesAre(order)
      await importAttendanceRecords(requestOf(csv, { csv: true }), createMockRes())
      expect(insertedRows().map((row) => row.employee)).toEqual(['emp-active'])
    }
  })

  it('兩位都在職、檔案又沒有姓名可以分辨：不猜，列為缺少對應員工並說明原因，不寫入', async () => {
    employeesAre([
      { _id: 'emp-a', employeeId: 'N001', name: '王小明', status: '正職員工' },
      { _id: 'emp-b', employeeId: 'N001', name: '李小華', status: '正職員工' },
    ])
    const res = createMockRes()

    await importAttendanceRecords(requestOf(csv, { csv: true }), res)

    expect(mockAttendanceRecord.insertMany).not.toHaveBeenCalled()
    const body = res.json.mock.calls[0][0]
    expect(body.summary).toMatchObject({ missingCount: 1, importedCount: 0 })
    expect(body.missingUsers).toEqual([expect.objectContaining({
      identifier: 'N001',
      reason: '這個員工編號有多位員工使用，請指定要對應的員工',
    })])
  })

  it('檔案有姓名欄時用「編號＋姓名」分辨', async () => {
    employeesAre([
      { _id: 'emp-a', employeeId: 'N001', name: '王小明', status: '正職員工' },
      { _id: 'emp-b', employeeId: 'N001', name: '李小華', status: '正職員工' },
    ])
    const named = Buffer.from('USERID,NAME,CHECKTIME,CHECKTYPE\nN001,李小華,2026-11-10 07:55:00,I\n')

    await importAttendanceRecords(requestOf(named, { csv: true }), createMockRes())

    expect(insertedRows().map((row) => row.employee)).toEqual(['emp-b'])
  })

  it('管理者在畫面上指定對應的員工後照常匯入', async () => {
    employeesAre([
      { _id: '64b000000000000000000001', employeeId: 'N001', name: '王小明', status: '正職員工' },
      { _id: '64b000000000000000000002', employeeId: 'N001', name: '李小華', status: '正職員工' },
    ])
    const req = requestOf(csv, { csv: true })
    req.body.userMappings = JSON.stringify({ N001: { _id: '64b000000000000000000002' } })

    await importAttendanceRecords(req, createMockRes())

    expect(insertedRows().map((row) => String(row.employee))).toEqual(['64b000000000000000000002'])
  })
})

describe('考勤匯入：Tab 分隔的文字檔', () => {
  it('標題列以 Tab 分隔時照 Tab 切欄位（考勤機匯出的格式）', async () => {
    const TAB = String.fromCharCode(9)
    const lines = [
      ['部門', '姓名', '差勤號碼', '日期時間', '簽到/退', '機器號', '編號', '比對方式'],
      ['迦美', '王小明', '23', '2026/11/10 上午 07:54:21', '上班簽到', '104', 'N001', '指紋'],
      ['迦美', '王小明', '23', '2026/11/10 下午 05:01:47', '下班簽退', '104', 'N001', '指紋'],
    ].map((cells) => cells.join(TAB))
    const res = createMockRes()

    await importAttendanceRecords(requestOf(Buffer.from(lines.join('\r\n'), 'utf8'), {
      csv: true,
      mappings: { userId: '編號', name: '姓名', timestamp: '日期時間', type: '簽到/退' },
    }), res)

    expect(res.status).not.toHaveBeenCalled()
    expect(insertedRows().map((row) => [row.action, row.timestamp.toISOString()])).toEqual([
      ['clockIn', '2026-11-09T23:54:21.000Z'],
      ['clockOut', '2026-11-10T09:01:47.000Z'],
    ])
  })
})
