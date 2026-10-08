import { jest } from '@jest/globals'

// 特休統計：舊資料的「特休」與字典項目的「特休假」都要算進來，其他假別不算

const mockEmployee = { find: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockGetAllLeaveFieldInfos = jest.fn()

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/Department.js', () => ({ default: { findById: jest.fn() } }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos,
}))

let getDepartmentReportData

const LEAVE_FORM = {
  formId: 'customer-form',
  startId: 'c-start',
  endId: 'c-end',
  typeId: 'c-type',
  typeOptions: [
    { value: '特休假', label: '特休假' },
    { value: '特休', label: '特休' },
    { value: '事假', label: '事假' },
  ],
}

function approval(id, type, days) {
  return {
    _id: id,
    applicant_employee: { _id: 'emp1', name: '員工1' },
    form_data: { 'c-type': type, 'c-start': '2026-03-02', 'c-end': '2026-03-03', days },
  }
}

beforeAll(async () => {
  ;({ getDepartmentReportData } = await import('../src/services/reportMetricsService.js'))
})

beforeEach(() => {
  mockEmployee.find.mockReset()
  mockApprovalRequest.find.mockReset()
  mockGetAllLeaveFieldInfos.mockReset()
  mockEmployee.find.mockResolvedValue([{ _id: 'emp1', name: '員工1' }])
  mockGetAllLeaveFieldInfos.mockResolvedValue([LEAVE_FORM])
})

describe('specialLeave report', () => {
  it('lists both 特休 and 特休假 approvals and ignores other leave types', async () => {
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        approval('a1', '特休', 1),
        approval('a2', '特休假', 2),
        approval('a3', '事假', 1),
        approval('a4', '病假', 1),
      ]),
    })

    const result = await getDepartmentReportData({
      type: 'specialLeave',
      month: '2026-03',
      departmentId: 'dept1',
      actor: { role: 'admin', id: 'admin1' },
    })

    expect(result.records.map((record) => record.approvalId)).toEqual(['a1', 'a2'])
    expect(result.summary).toEqual({ totalRequests: 2, totalDays: 3 })
  })

  it('does not match a name that merely contains 特休', async () => {
    mockApprovalRequest.find.mockReturnValue({
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([approval('a1', '特休保留', 1), approval('a2', '特休假', 1)]),
    })

    const result = await getDepartmentReportData({
      type: 'specialLeave',
      month: '2026-03',
      departmentId: 'dept1',
      actor: { role: 'admin', id: 'admin1' },
    })

    expect(result.records.map((record) => record.approvalId)).toEqual(['a2'])
  })
})
