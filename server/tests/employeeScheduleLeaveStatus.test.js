import { jest } from '@jest/globals'

// 排班用員工列表的「請假中」狀態篩選：預設的「請假」與自建的請假表單並存時，每張表單的核准假單都要算

const mockEmployee = { find: jest.fn(), countDocuments: jest.fn() }
const mockShiftSchedule = { find: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockGetAllLeaveFieldInfos = jest.fn()

jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
  getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos,
}))

let listEmployeesSchedule

const ADMIN_ID = '64b000000000000000000001'
const EMPLOYEES = [
  { _id: 'e1', name: 'A員工' },
  { _id: 'e2', name: 'B員工' },
  { _id: 'e3', name: 'C員工' },
]

function createRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this },
    json(payload) { this.body = payload; return this },
  }
  return res
}

function leanChain(rows) {
  const chain = {
    select: jest.fn(() => chain),
    populate: jest.fn(() => chain),
    sort: jest.fn(() => chain),
    skip: jest.fn(() => chain),
    limit: jest.fn(() => chain),
    lean: jest.fn(async () => rows),
  }
  return chain
}

async function listWithStatus(status) {
  const res = createRes()
  await listEmployeesSchedule({
    user: { id: ADMIN_ID, role: 'admin' },
    query: { month: '2026-03', status },
  }, res)
  return res
}

beforeAll(async () => {
  ;({ listEmployeesSchedule } = await import('../src/controllers/employeeController.js'))
})

beforeEach(() => {
  mockEmployee.find.mockReset()
  mockShiftSchedule.find.mockReset()
  mockApprovalRequest.find.mockReset()
  mockGetAllLeaveFieldInfos.mockReset()
  mockEmployee.find.mockImplementation(() => leanChain(EMPLOYEES))
  mockShiftSchedule.find.mockImplementation(() => leanChain([]))
  mockGetAllLeaveFieldInfos.mockResolvedValue([])
})

describe('schedule employee list: onLeave status filter', () => {
  it('counts the approved leave of every leave form', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([
      { formId: 'default-form', startId: 'd-start', endId: 'd-end' },
      { formId: 'customer-form', startId: 'c-start', endId: 'c-end', typeId: 'c-type' },
    ])
    mockApprovalRequest.find.mockImplementation((query) => leanChain(query.form === 'default-form'
      ? [{ applicant_employee: 'e1', form_data: { 'd-start': '2026-03-05', 'd-end': '2026-03-06' } }]
      : [{ applicant_employee: 'e2', form_data: { 'c-start': '2026-03-20', 'c-end': '2026-03-20' } }]))

    const res = await listWithStatus('onLeave')

    expect(res.statusCode).toBe(200)
    expect(mockApprovalRequest.find).toHaveBeenCalledTimes(2)
    expect(mockApprovalRequest.find).toHaveBeenCalledWith({
      form: 'customer-form',
      status: 'approved',
      applicant_employee: { $in: ['e1', 'e2', 'e3'] },
      'form_data.c-start': { $lt: '2026-04-01' },
      'form_data.c-end': { $gte: '2026-03-01' },
    })
    expect(res.body.employees.map((employee) => employee._id)).toEqual(['e1', 'e2'])
  })

  it('does not look at approvals when there is no leave form, so nobody is on leave', async () => {
    const res = await listWithStatus('onLeave')

    expect(res.statusCode).toBe(200)
    expect(res.body.employees).toEqual([])
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })

  it('does not treat the employees who have leave as unscheduled', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([
      { formId: 'customer-form', startId: 'c-start', endId: 'c-end' },
    ])
    mockApprovalRequest.find.mockImplementation(() => leanChain([
      { applicant_employee: 'e2', form_data: { 'c-start': '2026-03-01', 'c-end': '2026-03-31' } },
    ]))

    const res = await listWithStatus('unscheduled')

    expect(res.body.employees.map((employee) => employee._id)).toEqual(['e1', 'e3'])
  })
})
