// 遲到、早退報表匯出（Excel / PDF）：「實際打卡」旁多一欄「打卡來源」，顯示線上 / 指紋匯入（A3）。
import { jest } from '@jest/globals'

const mockGetDepartmentReportData = jest.fn()
const mockExportTabularReport = jest.fn()
const mockReport = jest.fn()
mockReport.exists = jest.fn()

class ReportAccessError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

jest.unstable_mockModule('../src/services/reportMetricsService.js', () => ({
  getDepartmentReportData: mockGetDepartmentReportData,
  ReportAccessError,
  getReportDisplayName: (type) => ({ tardiness: '遲到統計', earlyLeave: '早退統計' }[type] || '報表'),
}))
jest.unstable_mockModule('../src/services/reportExportHelper.js', () => ({ exportTabularReport: mockExportTabularReport }))
jest.unstable_mockModule('../src/models/Report.js', () => ({ default: mockReport }))

const controllers = await import('../src/controllers/reportController.js')

function createRes() {
  const res = {}
  res.status = jest.fn().mockReturnValue(res)
  res.json = jest.fn().mockReturnValue(res)
  res.setHeader = jest.fn()
  return res
}

async function exportExcel(handler, records) {
  mockGetDepartmentReportData.mockResolvedValueOnce({ summary: {}, records })
  const res = createRes()
  await handler({ query: { month: '2026-10', department: 'dept1', format: 'excel' }, user: { role: 'admin', id: 'adm1' } }, res)
  expect(mockExportTabularReport).toHaveBeenCalledTimes(1)
  return mockExportTabularReport.mock.calls[0][1]
}

beforeEach(() => {
  mockGetDepartmentReportData.mockReset()
  mockExportTabularReport.mockReset()
  mockReport.exists.mockReset()
  mockReport.exists.mockResolvedValue(true)
})

describe('遲到、早退報表匯出的打卡來源', () => {
  it('遲到：實際打卡右邊是打卡來源，線上 / 指紋匯入 / 未標示；沒有來源資訊時留白', async () => {
    const payload = await exportExcel(controllers.exportDepartmentTardiness, [
      { name: '羅護理師', date: '2026-10-12', scheduledStart: '08:00', actualClockIn: '08:10', clockInSource: 'import', minutesLate: 10 },
      { name: '羅護理師', date: '2026-10-13', scheduledStart: '08:00', actualClockIn: '08:05', clockInSource: 'online', minutesLate: 5 },
      { name: '羅護理師', date: '2026-10-14', scheduledStart: '08:00', actualClockIn: '08:20', clockInSource: 'legacy', minutesLate: 20 },
      { name: '羅護理師', date: '2026-10-15', scheduledStart: '08:00', actualClockIn: '08:30', minutesLate: 30 },
    ])

    const headers = payload.columns.map((column) => column.header)
    expect(headers).toEqual(['員工姓名', '日期', '排定上班', '實際打卡', '打卡來源', '遲到分鐘'])
    expect(payload.rows.map((row) => [row.actualClockIn, row.clockInSource])).toEqual([
      ['08:10', '指紋匯入'],
      ['08:05', '線上'],
      ['08:20', '未標示'],
      ['08:30', ''],
    ])
  })

  it('早退：實際打卡右邊是打卡來源', async () => {
    const payload = await exportExcel(controllers.exportDepartmentEarlyLeave, [
      { name: '羅護理師', date: '2026-10-12', scheduledEnd: '17:00', actualClockOut: '16:30', clockOutSource: 'import', minutesEarly: 30 },
    ])

    expect(payload.columns.map((column) => column.header)).toEqual(['員工姓名', '日期', '排定下班', '實際打卡', '打卡來源', '早退分鐘'])
    expect(payload.rows).toEqual([expect.objectContaining({ actualClockOut: '16:30', clockOutSource: '指紋匯入', minutesEarly: 30 })])
  })
})
