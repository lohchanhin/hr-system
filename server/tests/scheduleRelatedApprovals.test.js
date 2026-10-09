import { jest } from '@jest/globals'

// 排班頁「相關簽核」清單（GET /api/schedules/leave-approvals 的 approvals[]）：範圍內員工的所有簽核單，
// 任何表單、任何狀態，只要與本月有關；日曆用的 leaves[] 仍只含核准的請假。
// 這裡用模擬的資料庫回傳驗證清單的組成、台灣日期判斷、範圍條件、上限與標頭；
// 資料庫端的粗篩條件有沒有漏撈，由 scheduleRelatedApprovals.integration.test.js 在真的 MongoDB 驗證。
// 這個檔案要在 TZ=UTC 與 TZ=Asia/Taipei 兩種主機時區下都通過。

const mockShiftSchedule = { find: jest.fn() }
const mockEmployee = { find: jest.fn() }
const mockApprovalRequest = { find: jest.fn() }
const mockAttendanceSetting = { findOne: jest.fn() }
const mockFormTemplate = { find: jest.fn() }
const mockFormField = { find: jest.fn() }
const mockGetAllLeaveFieldInfos = jest.fn()

jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }))
jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }))
jest.unstable_mockModule('../src/models/form_field.js', () => ({ default: mockFormField }))
jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({ getAllLeaveFieldInfos: mockGetAllLeaveFieldInfos }))

let listLeaveApprovals
let SCHEDULE_APPROVAL_LIMIT

beforeAll(async () => {
  ;({ listLeaveApprovals } = await import('../src/controllers/schedule/scheduleQueryController.js'))
  ;({ SCHEDULE_APPROVAL_LIMIT } = await import('../src/services/scheduleApprovalService.js'))
})

const LEAVE_FORM = { formId: 'leave-form', startId: 's', endId: 'e', typeId: 't', isActive: true }
const FORMS = [
  { _id: 'leave-form', name: '請假', category: '人事類', semanticType: 'leave' },
  { _id: 'ot-form', name: '加班申請', category: '人事類', semanticType: 'overtime' },
  { _id: 'support-form', name: '支援申請', category: '人事類', semanticType: 'general' },
  { _id: 'keep-form', name: '特休保留', category: '人事類', semanticType: 'general' },
  { _id: 'bonus-form', name: '獎金申請', category: '財務類', semanticType: 'general' },
  // 名稱像請假單、表單性質卻還是「一般」的舊表單（尚未被啟動時的補正改成請假）
  { _id: 'legacy-form', name: '(全)假別申請單', category: '人事類', semanticType: 'general' },
]
const FIELDS = [
  { _id: 'leave-r', form: 'leave-form', label: '事由', order: 4 },
  { _id: 'ot-s', form: 'ot-form', label: '開始時間', order: 1 },
  { _id: 'ot-e', form: 'ot-form', label: '結束時間', order: 2 },
  { _id: 'ot-r', form: 'ot-form', label: '事由', order: 3 },
  { _id: 'sup-r', form: 'support-form', label: '申請事由', order: 1 },
  { _id: 'sup-s', form: 'support-form', label: '日期(起)', order: 2 },
  { _id: 'sup-e', form: 'support-form', label: '日期 (迄)', order: 3 },
  { _id: 'keep-r', form: 'keep-form', label: '理由', order: 1 },
  { _id: 'bonus-t', form: 'bonus-form', label: '獎金類型', order: 1 },
  { _id: 'bonus-a', form: 'bonus-form', label: '金額', order: 2 },
  { _id: 'bonus-r', form: 'bonus-form', label: '備註', order: 3 },
  { _id: 'legacy-t', form: 'legacy-form', label: '假別', order: 1 },
  { _id: 'legacy-s', form: 'legacy-form', label: '開始時間', order: 2 },
  { _id: 'legacy-e', form: 'legacy-form', label: '結束時間', order: 3 },
]
const E1 = { _id: 'e1', name: 'A員工', department: 'd1', subDepartment: 'sd1' }
const E2 = { _id: 'e2', name: 'B員工', department: 'd1', subDepartment: 'sd1' }

let seq = 0
// 預設是台灣 2026-07-05 10:00 申請的、核准的請假單，請假日是台灣 7/10
const row = (over = {}) => {
  seq += 1
  return {
    _id: `r${seq}`,
    applicant_employee: E1,
    form: 'leave-form',
    status: 'approved',
    createdAt: new Date('2026-07-05T02:00:00.000Z'),
    form_data: { s: '2026-07-09T16:00:00.000Z', e: '2026-07-09T16:00:00.000Z', t: '事假' },
    ...over,
  }
}
const noDates = (over = {}) => row({ form: 'keep-form', form_data: { 'keep-r': '年底前無法休完' }, ...over })

// 模擬資料庫：請假日曆那幾次（指定表單與核准狀態）只回傳該表單核准的單；「相關簽核」清單那一次回傳全部，依申請日由新到舊並套用 limit
function useRows(rows) {
  mockApprovalRequest.find.mockImplementation((filter) => {
    const isLeaveQuery = Boolean(filter.form)
    let matched = rows.filter((item) => !isLeaveQuery || (item.form === filter.form && item.status === filter.status))
    if (!isLeaveQuery) {
      matched = [...matched].sort((a, b) => (b.createdAt - a.createdAt) || String(b._id).localeCompare(String(a._id)))
    }
    const query = {
      select: jest.fn(() => query),
      populate: jest.fn(() => query),
      sort: jest.fn(() => query),
      limit: jest.fn((count) => { matched = matched.slice(0, count); return query }),
      lean: jest.fn(async () => matched),
    }
    return query
  })
}

function createRes() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) { this.statusCode = code; return this },
    // 和真的回應一樣經過 JSON 序列化（日期變字串、undefined 的欄位消失）
    json(payload) { this.body = JSON.parse(JSON.stringify(payload)); return this },
    set(name, value) { this.headers[name] = value; return this },
  }
}

const ADMIN = { id: 'admin1', role: 'admin' }

async function listFor(month, rows, { query = {}, user = ADMIN } = {}) {
  useRows(rows)
  const res = createRes()
  await listLeaveApprovals({ query: { month, ...query }, user }, res)
  return res
}

const idsOf = (res) => res.body.approvals.map((item) => item._id)

beforeEach(() => {
  seq = 0
  mockShiftSchedule.find.mockReset()
  mockEmployee.find.mockReset()
  mockApprovalRequest.find.mockReset()
  mockAttendanceSetting.findOne.mockReset()
  mockGetAllLeaveFieldInfos.mockReset()
  mockGetAllLeaveFieldInfos.mockResolvedValue([LEAVE_FORM])
  mockFormTemplate.find.mockReset()
  mockFormTemplate.find.mockImplementation(() => ({ select: () => ({ lean: async () => FORMS }) }))
  mockFormField.find.mockReset()
  mockFormField.find.mockImplementation(() => ({ select: () => ({ lean: async () => FIELDS }) }))
  mockEmployee.find.mockImplementation(() => {
    const query = {
      select: jest.fn(() => query),
      lean: jest.fn(async () => [E1, E2]),
      then: (resolve) => Promise.resolve([E1, E2]).then(resolve),
    }
    return query
  })
})

describe(`相關簽核清單的內容 (host time zone ${process.env.TZ || 'default'})`, () => {
  it('lists every form type, not only leave, with the contract shape', async () => {
    const res = await listFor('2026-07', [
      row({
        _id: 'leave',
        createdAt: new Date('2026-07-05T05:00:00.000Z'),
        form_data: { s: '2026-07-09T16:00:00.000Z', e: '2026-07-09T16:00:00.000Z', t: '事假', 'leave-r': '家中有事' },
      }),
      row({
        _id: 'ot',
        form: 'ot-form',
        createdAt: new Date('2026-07-05T04:00:00.000Z'),
        form_data: { 'ot-s': '2026-07-14T10:00:00.000Z', 'ot-e': '2026-07-14T13:00:00.000Z', 'ot-r': '病房交班延遲' },
      }),
      row({
        _id: 'support',
        form: 'support-form',
        status: 'pending',
        createdAt: new Date('2026-07-05T03:00:00.000Z'),
        form_data: { 'sup-r': '支援急診', 'sup-s': '2026-07-20', 'sup-e': '2026-07-21' },
      }),
      row({ _id: 'keep', form: 'keep-form', status: 'returned', createdAt: new Date('2026-07-05T02:00:00.000Z'), form_data: { 'keep-r': '年底前無法休完' } }),
      row({ _id: 'bonus', form: 'bonus-form', createdAt: new Date('2026-07-05T01:00:00.000Z'), form_data: { 'bonus-t': '年終', 'bonus-a': 5000, 'bonus-r': '績效優良' } }),
    ])

    expect(res.statusCode).toBe(200)
    expect(idsOf(res)).toEqual(['leave', 'ot', 'support', 'keep', 'bonus'])
    const byId = Object.fromEntries(res.body.approvals.map((item) => [item._id, item]))
    expect(byId.leave).toEqual({
      _id: 'leave',
      applicant_employee: E1,
      employee: E1,
      form: { _id: 'leave-form', name: '請假', category: '人事類', semanticType: 'leave' },
      status: 'approved',
      createdAt: '2026-07-05T05:00:00.000Z',
      isLeave: true,
      leaveType: '事假',
      startDate: '2026-07-09T16:00:00.000Z',
      endDate: '2026-07-09T16:00:00.000Z',
      noteSummary: '家中有事',
    })
    expect(byId.ot).toEqual(expect.objectContaining({
      isLeave: false,
      form: { _id: 'ot-form', name: '加班申請', category: '人事類', semanticType: 'overtime' },
      startDate: '2026-07-14T10:00:00.000Z',
      endDate: '2026-07-14T13:00:00.000Z',
      noteSummary: '病房交班延遲',
    }))
    expect(byId.ot).not.toHaveProperty('leaveType')
    expect(byId.support).toEqual(expect.objectContaining({ status: 'pending', startDate: '2026-07-20', endDate: '2026-07-21', noteSummary: '支援急診' }))
    // 沒有日期欄位的表單：不帶 startDate / endDate
    expect(byId.keep).not.toHaveProperty('startDate')
    expect(byId.keep).not.toHaveProperty('endDate')
    expect(byId.keep).toEqual(expect.objectContaining({ status: 'returned', noteSummary: '年底前無法休完' }))
    expect(byId.bonus.noteSummary).toBe('績效優良')
    expect(byId.bonus.form.semanticType).toBe('general')
  })

  it('lists requests of every status (pending, approved, rejected, returned, canceled)', async () => {
    const res = await listFor('2026-07', ['pending', 'approved', 'rejected', 'returned', 'canceled'].map((status) => noDates({ _id: status, status })))

    expect(res.body.approvals.map((item) => item.status).sort()).toEqual(['approved', 'canceled', 'pending', 'rejected', 'returned'])
  })

  it('keeps leaves[] as approved leave only, in the original shape, while approvals[] lists the rest', async () => {
    const approvedLeave = row({ _id: 'approved-leave' })
    const pendingLeave = row({ _id: 'pending-leave', status: 'pending' })
    const rejectedLeave = row({ _id: 'rejected-leave', status: 'rejected' })
    const res = await listFor('2026-07', [approvedLeave, pendingLeave, rejectedLeave, noDates({ _id: 'other' })])

    expect(res.body.leaves).toEqual([{
      employee: E1,
      leaveType: '事假',
      startDate: '2026-07-09T16:00:00.000Z',
      endDate: '2026-07-09T16:00:00.000Z',
      status: 'approved',
    }])
    expect(idsOf(res).sort()).toEqual(['approved-leave', 'other', 'pending-leave', 'rejected-leave'])
    // 日曆上的每一筆請假，清單裡都有對應的列
    expect(res.body.approvals.filter((item) => item.isLeave && item.status === 'approved')).toHaveLength(res.body.leaves.length)
  })

  it('still lists other forms when there is no leave form at all', async () => {
    mockGetAllLeaveFieldInfos.mockResolvedValue([])
    const res = await listFor('2026-07', [noDates({ _id: 'keep' })])

    expect(res.body.leaves).toEqual([])
    expect(idsOf(res)).toEqual(['keep'])
  })

  it('lists a leave-like form that is still 一般 (not migrated yet): the list does not depend on the form being a leave form', async () => {
    const res = await listFor('2026-07', [
      row({
        _id: 'legacy',
        form: 'legacy-form',
        status: 'approved',
        createdAt: new Date('2026-05-02T02:00:00.000Z'),
        form_data: { 'legacy-t': '事假', 'legacy-s': '2026-07-09T16:00:00.000Z', 'legacy-e': '2026-07-10T16:00:00.000Z' },
      }),
    ])

    expect(res.body.leaves).toEqual([])
    expect(res.body.approvals).toEqual([expect.objectContaining({
      _id: 'legacy',
      isLeave: false,
      form: expect.objectContaining({ name: '(全)假別申請單', semanticType: 'general' }),
      startDate: '2026-07-09T16:00:00.000Z',
      endDate: '2026-07-10T16:00:00.000Z',
    })])
    expect(res.body.approvals[0]).not.toHaveProperty('leaveType')
  })

  it('lists a request of a deleted form with the placeholder name', async () => {
    const res = await listFor('2026-07', [noDates({ _id: 'orphan', form: 'gone-form', status: 'pending' })])

    expect(res.body.approvals).toEqual([expect.objectContaining({
      _id: 'orphan',
      form: { _id: 'gone-form', name: '（表單已刪除）', category: '', semanticType: 'general' },
      isLeave: false,
      status: 'pending',
    })])
  })

  it('skips a request whose applicant no longer exists', async () => {
    const res = await listFor('2026-07', [noDates({ _id: 'ghost', applicant_employee: null }), noDates({ _id: 'real' })])

    expect(idsOf(res)).toEqual(['real'])
  })

  it('picks the note from the first filled reason-like answer, trimmed to 80 characters', async () => {
    const long = `${'字'.repeat(100)}`
    const res = await listFor('2026-07', [
      noDates({ _id: 'long', form: 'bonus-form', form_data: { 'bonus-r': `  ${long}  ` } }),
      noDates({ _id: 'empty-first', form: 'ot-form', form_data: { 'ot-r': '   ' } }),
      noDates({ _id: 'number-answer', form: 'bonus-form', form_data: { 'bonus-a': 5000 } }),
    ])
    const byId = Object.fromEntries(res.body.approvals.map((item) => [item._id, item]))

    expect(byId.long.noteSummary).toBe('字'.repeat(80))
    expect(byId['empty-first']).not.toHaveProperty('noteSummary')
    expect(byId['number-answer']).not.toHaveProperty('noteSummary')
  })

  it('does not read a numeric answer of a start/end-labelled field of a non-leave form as a date', async () => {
    const res = await listFor('2026-07', [row({
      _id: 'ot-number',
      form: 'ot-form',
      createdAt: new Date('2026-07-05T04:00:00.000Z'),
      form_data: { 'ot-s': 5, 'ot-e': 6 },
    })])

    // 沒有可解的日期，退回用申請日（本月）判斷，而且不帶假日期
    expect(idsOf(res)).toEqual(['ot-number'])
    expect(res.body.approvals[0]).not.toHaveProperty('startDate')
  })

  it('does not read a plain text answer such as "5" in a start/end-labelled field of a non-leave form as a date', async () => {
    const res = await listFor('2026-07', [row({
      _id: 'ot-text',
      form: 'ot-form',
      status: 'pending',
      createdAt: new Date('2026-07-05T04:00:00.000Z'),
      form_data: { 'ot-s': '5', 'ot-e': '12' },
    })])

    // new Date('5') 會被解成 2001-05-01；不能因此把本月的單排除
    expect(idsOf(res)).toEqual(['ot-text'])
    expect(res.body.approvals[0]).not.toHaveProperty('startDate')
  })
})

describe(`本月相關的判斷 (host time zone ${process.env.TZ || 'default'})`, () => {
  it('lists requests created in the viewed Taiwan month and leaves out those created in other months', async () => {
    const res = await listFor('2026-07', [
      noDates({ _id: 'this-month', status: 'approved', createdAt: new Date('2026-07-15T02:00:00.000Z') }),
      noDates({ _id: 'last-month', status: 'approved', createdAt: new Date('2026-06-15T02:00:00.000Z') }),
      noDates({ _id: 'next-month', status: 'approved', createdAt: new Date('2026-08-15T02:00:00.000Z') }),
    ])

    expect(idsOf(res)).toEqual(['this-month'])
  })

  it('uses Taiwan time for the created month (UTC 06-30T16:00 is already Taiwan July 1st)', async () => {
    const res = await listFor('2026-07', [
      noDates({ _id: 'taiwan-july-1', createdAt: new Date('2026-06-30T16:00:00.000Z') }),
      noDates({ _id: 'taiwan-june-30', createdAt: new Date('2026-06-30T15:59:59.000Z') }),
      noDates({ _id: 'taiwan-july-31', createdAt: new Date('2026-07-31T15:59:59.000Z') }),
      noDates({ _id: 'taiwan-aug-1', createdAt: new Date('2026-07-31T16:00:00.000Z') }),
    ])

    expect(idsOf(res).sort()).toEqual(['taiwan-july-1', 'taiwan-july-31'])
  })

  it('keeps requests that are still open (pending, returned) whatever month they were created in', async () => {
    const old = new Date('2026-01-10T02:00:00.000Z')
    const res = await listFor('2026-07', [
      noDates({ _id: 'old-pending', status: 'pending', createdAt: old }),
      noDates({ _id: 'old-returned', status: 'returned', createdAt: old }),
      noDates({ _id: 'old-rejected', status: 'rejected', createdAt: old }),
      noDates({ _id: 'old-canceled', status: 'canceled', createdAt: old }),
      noDates({ _id: 'old-approved', status: 'approved', createdAt: old }),
    ])

    expect(idsOf(res).sort()).toEqual(['old-pending', 'old-returned'])
  })

  it('lists a leave that overlaps the month even if it was filed long before, and leaves out leave of other months', async () => {
    const filedEarly = new Date('2026-04-01T02:00:00.000Z')
    const res = await listFor('2026-07', [
      row({ _id: 'overlaps-from-june', createdAt: filedEarly, form_data: { s: '2026-06-28', e: '2026-07-02', t: '特休' } }),
      row({ _id: 'overlaps-into-august', createdAt: filedEarly, form_data: { s: '2026-07-30', e: '2026-08-03', t: '特休' } }),
      row({ _id: 'only-june', createdAt: filedEarly, form_data: { s: '2026-06-10', e: '2026-06-12', t: '特休' } }),
      row({ _id: 'only-august', createdAt: filedEarly, form_data: { s: '2026-08-10', e: '2026-08-12', t: '特休' } }),
      // 申請日在本月，但請假日在別的月：以請假日為準
      row({ _id: 'filed-now-for-august', status: 'approved', form_data: { s: '2026-08-10', e: '2026-08-12', t: '特休' } }),
    ])

    expect(idsOf(res).sort()).toEqual(['overlaps-from-june', 'overlaps-into-august'])
  })

  it('judges a pending leave by its leave dates, not by being open', async () => {
    const res = await listFor('2026-07', [
      row({ _id: 'pending-august', status: 'pending', createdAt: new Date('2026-06-01T02:00:00.000Z'), form_data: { s: '2026-08-10', e: '2026-08-12', t: '事假' } }),
      row({ _id: 'pending-july', status: 'pending', createdAt: new Date('2026-06-01T02:00:00.000Z'), form_data: { s: '2026-07-10', e: '2026-07-12', t: '事假' } }),
    ])

    expect(idsOf(res)).toEqual(['pending-july'])
  })

  it('applies the Taiwan day rule to the leave dates at the month edges (same rule as the calendar)', async () => {
    const res = await listFor('2026-07', [
      row({ _id: 'taiwan-july-1', createdAt: new Date('2026-05-01T00:00:00.000Z'), form_data: { s: '2026-06-30T16:00:00.000Z', e: '2026-06-30T16:00:00.000Z', t: '事假' } }),
      row({ _id: 'taiwan-june-30', createdAt: new Date('2026-05-01T00:00:00.000Z'), form_data: { s: '2026-06-29T16:00:00.000Z', e: '2026-06-29T16:00:00.000Z', t: '事假' } }),
      row({ _id: 'taiwan-july-31', createdAt: new Date('2026-05-01T00:00:00.000Z'), form_data: { s: '2026-07-30T16:00:00.000Z', e: '2026-07-30T16:00:00.000Z', t: '事假' } }),
      row({ _id: 'taiwan-aug-1', createdAt: new Date('2026-05-01T00:00:00.000Z'), form_data: { s: '2026-07-31T16:00:00.000Z', e: '2026-07-31T16:00:00.000Z', t: '事假' } }),
    ])

    expect(idsOf(res).sort()).toEqual(['taiwan-july-1', 'taiwan-july-31'])
    // 日曆（leaves[]）看到的同一批，清單一定也有
    expect(res.body.leaves).toHaveLength(2)
  })

  it('judges non-leave forms whose start/end can be read by those dates (overtime planned for next month)', async () => {
    const filedEarly = new Date('2026-04-01T02:00:00.000Z')
    const res = await listFor('2026-07', [
      row({ _id: 'ot-in-july', form: 'ot-form', createdAt: filedEarly, form_data: { 'ot-s': '2026-07-14T10:00:00.000Z', 'ot-e': '2026-07-14T13:00:00.000Z' } }),
      row({ _id: 'ot-in-august', form: 'ot-form', status: 'pending', createdAt: new Date('2026-07-05T02:00:00.000Z'), form_data: { 'ot-s': '2026-08-14T10:00:00.000Z', 'ot-e': '2026-08-14T13:00:00.000Z' } }),
      row({ _id: 'support-in-july', form: 'support-form', createdAt: filedEarly, form_data: { 'sup-s': '2026-07-20', 'sup-e': '2026-07-21' } }),
      // 只填了開始日：當作單日
      row({ _id: 'support-start-only', form: 'support-form', createdAt: filedEarly, form_data: { 'sup-s': '2026-07-20' } }),
    ])

    expect(idsOf(res).sort()).toEqual(['ot-in-july', 'support-in-july', 'support-start-only'])
  })

  it('falls back to the created month / open rule for a leave request that has no readable dates', async () => {
    const res = await listFor('2026-07', [
      row({ _id: 'undated-created-now', form_data: { t: '事假' } }),
      row({ _id: 'undated-old-approved', createdAt: new Date('2026-01-01T02:00:00.000Z'), form_data: { t: '事假' } }),
      row({ _id: 'undated-old-pending', status: 'pending', createdAt: new Date('2026-01-01T02:00:00.000Z'), form_data: { t: '事假' } }),
    ])

    expect(idsOf(res).sort()).toEqual(['undated-created-now', 'undated-old-pending'])
  })
})

describe('範圍與查詢條件', () => {
  const unifiedFilter = () => mockApprovalRequest.find.mock.calls.map(([filter]) => filter).find((filter) => !filter.form)

  it('asks the database for the scoped employees only, any form, any status', async () => {
    await listFor('2026-07', [], { query: { employee: 'e1' } })

    const filter = unifiedFilter()
    expect(filter.applicant_employee).toEqual({ $in: ['e1'] })
    expect(filter).not.toHaveProperty('status')
    expect(filter).not.toHaveProperty('form')
    // 本月條件：各表單的日期欄位、申請日在本月、還在流程中
    const relevance = filter.$and.find((part) => part.$or).$or
    expect(relevance).toEqual(expect.arrayContaining([
      { createdAt: { $gte: new Date('2026-06-30T16:00:00.000Z'), $lt: new Date('2026-07-31T16:00:00.000Z') } },
      { status: { $in: ['pending', 'returned'] } },
    ]))
    // 請假表單：開始、結束欄位與本月重疊（兩邊各放寬一天，精準的台灣日期在程式裡判斷）
    const leaveBranch = relevance.find((branch) => branch.form === 'leave-form')
    expect(leaveBranch.$or).toEqual(expect.arrayContaining([
      { 'form_data.s': { $lt: '2026-08-02' }, 'form_data.e': { $gte: '2026-06-30' } },
    ]))
    // 非請假表單用標籤辨識出來的日期欄位（加班：開始時間／結束時間；支援：日期(起)／日期(迄)）
    expect(relevance.find((branch) => branch.form === 'ot-form').$or).toEqual(expect.arrayContaining([
      { 'form_data.ot-s': { $lt: '2026-08-02' }, 'form_data.ot-e': { $gte: '2026-06-30' } },
    ]))
    expect(relevance.find((branch) => branch.form === 'support-form').$or).toEqual(expect.arrayContaining([
      { 'form_data.sup-s': { $lt: '2026-08-02' }, 'form_data.sup-e': { $gte: '2026-06-30' } },
    ]))
    // 沒有日期欄位的表單不產生日期條件
    expect(relevance.find((branch) => branch.form === 'keep-form')).toBeUndefined()
  })

  it('gives the supervisor the same scope as the calendar (self + direct reports) and never an employee outside it', async () => {
    mockEmployee.find.mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([{ _id: 'e1' }, { _id: 'e2' }]) }) })
    await listFor('2026-07', [], { user: { id: 'boss', role: 'supervisor' }, query: { supervisor: 'boss' } })

    expect(unifiedFilter().applicant_employee).toEqual({ $in: ['e1', 'e2'] })

    const outside = createRes()
    mockApprovalRequest.find.mockClear()
    await listLeaveApprovals({ query: { month: '2026-07', employee: 'stranger' }, user: { id: 'boss', role: 'supervisor' } }, outside)
    expect(outside.statusCode).toBe(403)
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })

  it('scopes a plain employee to their own requests and refuses another employee', async () => {
    await listFor('2026-07', [], { user: { id: 'e1', role: 'employee' } })
    expect(unifiedFilter().applicant_employee).toEqual({ $in: ['e1'] })

    mockApprovalRequest.find.mockClear()
    const other = createRes()
    await listLeaveApprovals({ query: { month: '2026-07', employee: 'e2' }, user: { id: 'e1', role: 'employee' } }, other)
    expect(other.statusCode).toBe(403)
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })

  it('applies the department / subDepartment filter to the list as well', async () => {
    await listFor('2026-07', [], { query: { department: 'd1', subDepartment: 'sd1' } })
    expect(unifiedFilter().applicant_employee).toEqual({ $in: ['e1', 'e2'] })

    mockApprovalRequest.find.mockClear()
    await listFor('2026-07', [], { query: { department: 'd1' } })
    const filter = unifiedFilter()
    // 部門條件自己有一個 $or，與本月條件並存
    expect(filter.$and).toHaveLength(2)
    expect(filter.$and[0]).toEqual({ $or: [{ applicant_department: 'd1' }, { applicant_employee: { $in: ['e1', 'e2'] } }] })
  })

  it('returns empty lists, and asks nothing, for an empty scope', async () => {
    mockEmployee.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) })
    const res = await listFor('2026-07', [], { user: { id: 'boss', role: 'supervisor' }, query: { supervisor: 'boss' } })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual({ leaves: [], approvals: [] })
    expect(mockApprovalRequest.find).not.toHaveBeenCalled()
  })
})

describe('筆數上限', () => {
  const many = (count) => Array.from({ length: count }, (_, index) => noDates({
    _id: `m${String(index).padStart(4, '0')}`,
    createdAt: new Date(Date.UTC(2026, 6, 20, 0, 0, 0) - index * 60000),
  }))

  it('returns the newest 500 and marks the response as truncated when there are more', async () => {
    const res = await listFor('2026-07', many(SCHEDULE_APPROVAL_LIMIT + 20))

    expect(res.body.approvals).toHaveLength(SCHEDULE_APPROVAL_LIMIT)
    expect(res.headers['X-Approvals-Truncated']).toBe('true')
    // 最新的在前，被砍掉的是最舊的
    expect(res.body.approvals[0]._id).toBe('m0000')
    expect(res.body.approvals[SCHEDULE_APPROVAL_LIMIT - 1]._id).toBe(`m${String(SCHEDULE_APPROVAL_LIMIT - 1).padStart(4, '0')}`)
  })

  it('does not mark the response when exactly 500 match', async () => {
    const res = await listFor('2026-07', many(SCHEDULE_APPROVAL_LIMIT))

    expect(res.body.approvals).toHaveLength(SCHEDULE_APPROVAL_LIMIT)
    expect(res.headers).not.toHaveProperty('X-Approvals-Truncated')
  })

  it('also marks the response when the database fetch cap is hit, even if few rows pass the month filter', async () => {
    // 申請日在本月（資料庫粗篩撈得到），但請假日在八月：精準判斷後不屬於七月，撈回來的筆數卻已經碰到上限
    const farAway = Array.from({ length: 5001 }, (_, index) => row({
      _id: `far${index}`,
      createdAt: new Date(Date.UTC(2026, 6, 20) - index * 1000),
      form_data: { s: '2026-08-10', e: '2026-08-11', t: '事假' },
    }))
    const res = await listFor('2026-07', farAway)

    expect(res.body.approvals).toHaveLength(0)
    expect(res.headers['X-Approvals-Truncated']).toBe('true')
  })

  it('counts the cap after the month filter, so unrelated rows do not use up the 500', async () => {
    const inMonth = Array.from({ length: 300 }, (_, index) => noDates({
      _id: `july${index}`,
      status: 'approved',
      createdAt: new Date(Date.UTC(2026, 6, 25) - index * 1000),
    }))
    // 申請日在別的月、已核准的單與本月無關
    const otherMonth = Array.from({ length: 300 }, (_, index) => noDates({
      _id: `june${index}`,
      status: 'approved',
      createdAt: new Date(Date.UTC(2026, 5, 10) - index * 1000),
    }))
    const res = await listFor('2026-07', [...inMonth, ...otherMonth])

    expect(res.body.approvals).toHaveLength(300)
    expect(res.headers).not.toHaveProperty('X-Approvals-Truncated')
  })
})
