import { jest } from '@jest/globals'
import { createFakeEmployeeModel, oid } from './helpers/approvalTestKit.js'

// 主管鏈（manager_chain）、關卡的請假長度條件、略過重複的簽核人（services/approverResolution + services/approvalStepBuilder）。
// 用記憶體內的假 Employee 模型：一條「員工 → 護理長 → 主任（一般假單決行）→ 醫療副院長（長假決行）」的主管線，
// 加上廚房（員工 → 營養師（一般假單決行）→ 主任）與行政（員工 → 組長 → 行政副院長（兩個標籤都有））。
const NURSE = oid(1)
const HEAD = oid(2) // 護理長
const DIRECTOR = oid(3) // 主任：一般假單決行
const VP = oid(4) // 醫療副院長：長假決行，沒有上級
const COOK = oid(5)
const DIETITIAN = oid(6) // 營養師：一般假單決行，上級是主任
const CLERK = oid(7)
const LEAD = oid(8) // 總務組長
const ADMIN_VP = oid(9) // 行政副院長：一般假單決行 + 長假決行，沒有上級
const SYS_ADMIN = oid(10)
const HR = oid(11)
const LOOP_A = oid(12)
const LOOP_B = oid(13)
const LOOP_C = oid(14)
const ORPHAN = oid(15)
const GONE_HEAD = oid(16)
const UNDER_GONE = oid(17)
const ACTING = oid(18)

const NORMAL_TAG = '一般假單決行'
const LONG_TAG = '長假決行'

const seed = () => [
  { _id: NURSE, name: '護理師', employeeId: 'N001', supervisor: HEAD, signTags: [] },
  { _id: HEAD, name: '護理長', employeeId: 'N002', supervisor: DIRECTOR, signTags: [] },
  { _id: DIRECTOR, name: '主任', employeeId: 'N003', supervisor: VP, signTags: [NORMAL_TAG] },
  { _id: VP, name: '醫療副院長', employeeId: 'N004', supervisor: null, signTags: [LONG_TAG] },
  { _id: COOK, name: '廚師', employeeId: 'K001', supervisor: DIETITIAN, signTags: [] },
  { _id: DIETITIAN, name: '營養師', employeeId: 'K002', supervisor: DIRECTOR, signTags: [NORMAL_TAG] },
  { _id: CLERK, name: '總務', employeeId: 'G001', supervisor: LEAD, signTags: [] },
  { _id: LEAD, name: '總務組長', employeeId: 'G002', supervisor: ADMIN_VP, signTags: [] },
  { _id: ADMIN_VP, name: '行政副院長', employeeId: 'G003', supervisor: null, signTags: [`${NORMAL_TAG} `, LONG_TAG] },
  { _id: SYS_ADMIN, name: '系統管理員', employeeId: 'S001', role: 'admin', signTags: [] },
  { _id: HR, name: '人資', employeeId: 'H001', signTags: ['人資'] },
  { _id: LOOP_A, name: '甲', supervisor: LOOP_B, signTags: [] },
  { _id: LOOP_B, name: '乙', supervisor: LOOP_C, signTags: [] },
  { _id: LOOP_C, name: '丙', supervisor: LOOP_A, signTags: [] },
  { _id: ORPHAN, name: '沒有主管的人', supervisor: null, signTags: [] },
  // 主任已留職停薪（持有一般假單決行）：由上一級的代理人代為決行
  { _id: GONE_HEAD, name: '留停主任', employeeId: 'X001', supervisor: ACTING, signTags: [NORMAL_TAG], status: '留職停薪' },
  { _id: UNDER_GONE, name: '留停主任的部屬', employeeId: 'X002', supervisor: GONE_HEAD, signTags: [] },
  { _id: ACTING, name: '代理人', employeeId: 'X003', supervisor: VP, signTags: [] },
]

const mockEmployee = createFakeEmployeeModel([])
const mockGetSettings = jest.fn()
let mockShiftRows = []
let mockShifts = []
const mockShiftSchedule = { find: jest.fn(() => ({ lean: async () => mockShiftRows })) }
const mockAttendanceSetting = { findOne: jest.fn(() => ({ lean: async () => ({ shifts: mockShifts }) })) }

let resolution
let builder

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }))
  await jest.unstable_mockModule('../src/models/SubDepartment.js', () => ({ default: { find: jest.fn(async () => []) } }))
  await jest.unstable_mockModule('../src/models/ShiftSchedule.js', () => ({ default: mockShiftSchedule }))
  await jest.unstable_mockModule('../src/models/AttendanceSetting.js', () => ({ default: mockAttendanceSetting }))
  await jest.unstable_mockModule('../src/services/otherControlSettingsStore.js', () => ({
    getSettings: mockGetSettings,
    getDictionaryItems: jest.fn(async () => []),
    getDictionaryDefinitions: jest.fn(async () => []),
  }))
  resolution = await import('../src/services/approverResolution.js')
  builder = await import('../src/services/approvalStepBuilder.js')
})

beforeEach(() => {
  mockEmployee.rows.splice(0, mockEmployee.rows.length, ...seed())
  mockEmployee.find.mockClear()
  mockEmployee.findById.mockClear()
  mockGetSettings.mockReset()
  mockGetSettings.mockResolvedValue({})
  mockShiftRows = []
  mockShifts = []
  mockShiftSchedule.find.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

const person = (id) => mockEmployee.rows.find(row => row._id === id)
const chainStep = (value = {}, extra = {}) => ({ step_order: 1, approver_type: 'manager_chain', approver_value: value, is_required: true, all_must_approve: true, can_return: true, ...extra })
const FORM = { name: '請假' }
const ids = (steps) => steps.map(step => step.approvers.map(item => item.approver))
const names = (steps) => steps.map(step => step.name ?? null)
const leaveOf = (hours, start, end) => builder.computeLeaveLength({ hours, startValue: start, endValue: end, startType: 'date', endType: 'date', employeeId: NURSE })
// 客戶的設定：第1關 主管鏈到「一般假單決行」、必簽；第2關 主管鏈到「長假決行」、請假滿 56 小時才需要、非必簽
const customerWorkflow = (condition = { kind: 'leave_hours_gte', value: 56 }) => ({
  steps: [
    chainStep({ stopAtTag: NORMAL_TAG, maxLevels: 5 }),
    chainStep({ stopAtTag: LONG_TAG, maxLevels: 5 }, { step_order: 2, is_required: false, condition }),
  ],
  policy: {},
})

describe('walkManagerChain：沿著直屬主管往上', () => {
  it('starts at the direct supervisor and stops after the first holder of the stop tag (that person included)', async () => {
    const chain = await resolution.walkManagerChain(chainStep({ stopAtTag: NORMAL_TAG }), person(NURSE))

    expect(chain.levels.map(level => [level.id, level.level, level.stoppedByTag])).toEqual([[HEAD, 1, false], [DIRECTOR, 2, true]])
    expect(chain.end).toBe('tag')
    expect(chain.reason).toBe('')
  })

  it('compares the stop tag after normalising both sides (trailing space, full width)', async () => {
    const chain = await resolution.walkManagerChain(chainStep({ stopAtTag: ' 一般假單決行' }), person(CLERK))

    expect(chain.levels.map(level => level.id)).toEqual([LEAD, ADMIN_VP])
    expect(chain.end).toBe('tag')
  })

  it('walks to the top without a stop tag, and never past maxLevels', async () => {
    const top = await resolution.walkManagerChain(chainStep({}), person(NURSE))
    expect(top.levels.map(level => level.id)).toEqual([HEAD, DIRECTOR, VP])
    expect(top.end).toBe('top')

    const capped = await resolution.walkManagerChain(chainStep({ maxLevels: 2 }), person(NURSE))
    expect(capped.levels.map(level => level.id)).toEqual([HEAD, DIRECTOR])
    expect(capped.end).toBe('max')
  })

  it('skips an inactive person in the middle and goes on upward, with a note naming who was skipped', async () => {
    person(HEAD).status = '離職員工'

    const chain = await resolution.walkManagerChain(chainStep({ stopAtTag: NORMAL_TAG }), person(NURSE))

    expect(chain.levels.map(level => [level.id, level.level])).toEqual([[DIRECTOR, 2]])
    expect(chain.levels[0].notes).toEqual(['已略過已離職的護理長（N002）（第1級主管），改由上一級主管簽核'])
  })

  it('lets the next active supervisor decide when the inactive person held the stop tag, and stops there', async () => {
    const chain = await resolution.walkManagerChain(chainStep({ stopAtTag: NORMAL_TAG }), person(UNDER_GONE))

    expect(chain.levels.map(level => level.id)).toEqual([ACTING])
    expect(chain.end).toBe('inherited')
    expect(chain.levels[0].notes[0]).toContain('持有「一般假單決行」標籤')
    expect(chain.levels[0].notes[0]).toContain('由上一級主管代理人（X003）代為決行')
  })

  it('never includes the applicant and stops on a loop in the supervisor data', async () => {
    const chain = await resolution.walkManagerChain(chainStep({}), person(LOOP_A))

    expect(chain.levels.map(level => level.id)).toEqual([LOOP_B, LOOP_C])
    expect(chain.end).toBe('loop')
    expect(chain.tailNotes[0]).toContain('主管資料形成循環')
  })

  it('reports why the chain is empty: no supervisor, all inactive, or only the applicant', async () => {
    expect((await resolution.walkManagerChain(chainStep({}), person(ORPHAN))).reason).toBe('no-supervisor')
    person(VP).accountEnabled = false
    const inactive = await resolution.walkManagerChain(chainStep({}), person(DIRECTOR))
    expect(inactive.reason).toBe('supervisor-inactive')
    expect(inactive.tailNotes).toEqual(['已略過帳號停用的醫療副院長（N004）（第1級主管），沒有更上層的主管'])
    expect((await resolution.walkManagerChain(chainStep({}), { ...person(ORPHAN), supervisor: ORPHAN })).reason).toBe('only-applicant')
  })

  it('uses five levels and no stop tag for a missing or broken setting', () => {
    expect(resolution.normalizeManagerChainValue(undefined)).toEqual({ stopAtTag: '', maxLevels: 5 })
    expect(resolution.normalizeManagerChainValue({ stopAtTag: '長假決行 ', maxLevels: 11 })).toEqual({ stopAtTag: '長假決行', maxLevels: 5 })
    expect(resolution.normalizeManagerChainValue({ maxLevels: 10 })).toEqual({ stopAtTag: '', maxLevels: 10 })
  })
})

describe('buildRequestSteps：主管鏈每一級一關', () => {
  it('makes one request step per level named 第n級主管, with the flags of the workflow step', async () => {
    const wf = { steps: [chainStep({ stopAtTag: NORMAL_TAG }, { all_must_approve: false, can_return: false })] }

    const { steps, logs } = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM })

    expect(ids(steps)).toEqual([[HEAD], [DIRECTOR]])
    expect(names(steps)).toEqual(['第1級主管', '第2級主管'])
    expect(steps.map(step => [step.step_order, step.all_must_approve, step.is_required, step.can_return])).toEqual([[1, false, true, false], [2, false, true, false]])
    expect(steps.every(step => step.fallback === undefined && step.note === undefined)).toBe(true)
    expect(logs).toEqual([])
  })

  it('puts the workflow step name in front of the level name', async () => {
    const wf = { steps: [chainStep({ stopAtTag: NORMAL_TAG }, { name: '一般假單' })] }

    const { steps } = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM })

    expect(names(steps)).toEqual(['一般假單（第1級主管）', '一般假單（第2級主管）'])
  })

  it('keeps the note of a skipped inactive supervisor on the step and in the log', async () => {
    person(HEAD).status = '留職停薪'

    const { steps, logs } = await builder.buildRequestSteps({ wf: { steps: [chainStep({ stopAtTag: NORMAL_TAG })] }, applicantEmp: person(NURSE), form: FORM })

    expect(ids(steps)).toEqual([[DIRECTOR]])
    expect(steps[0]).toMatchObject({ name: '第2級主管', note: '已略過留職停薪的護理長（N002）（第1級主管），改由上一級主管簽核' })
    expect(logs).toEqual([{ action: 'manager_chain', message: '第1關（主管鏈，到「一般假單決行」為止）：已略過留職停薪的護理長（N002）（第1級主管），改由上一級主管簽核' }])
  })

  it('sends a required chain without any supervisor to the top-level approvers (R5), any one of them', async () => {
    const { steps, logs } = await builder.buildRequestSteps({ wf: { steps: [chainStep({ stopAtTag: NORMAL_TAG })] }, applicantEmp: person(ORPHAN), form: FORM })

    expect(ids(steps)).toEqual([[SYS_ADMIN]])
    expect(steps[0]).toMatchObject({ all_must_approve: false, fallback: { reason: 'no-supervisor', source: 'admins' } })
    expect(steps[0].name).toBeUndefined()
    expect(logs).toEqual([{ action: 'approver_fallback', message: '第1關（主管鏈，到「一般假單決行」為止）（申請人沒有設定直屬主管）：無上級主管，改由系統管理員簽核（任一位核准即可）' }])

    mockGetSettings.mockResolvedValue({ topLevelApproverIds: [HR] })
    const configured = await builder.buildRequestSteps({ wf: { steps: [chainStep({})] }, applicantEmp: person(VP), form: FORM })
    expect(ids(configured.steps)).toEqual([[HR]])
    expect(configured.steps[0].fallback.source).toBe('setting')
  })

  it('leaves out an optional chain without any supervisor, with a log line, instead of an empty step', async () => {
    const { steps, logs } = await builder.buildRequestSteps({ wf: customerWorkflow(), applicantEmp: person(VP), form: FORM, leave: leaveOf(56, '2026-11-16', '2026-11-22') })

    expect(ids(steps)).toEqual([[SYS_ADMIN]])
    expect(logs.map(log => log.message)).toEqual([
      '第1關（主管鏈，到「一般假單決行」為止）（申請人沒有設定直屬主管）：無上級主管，改由系統管理員簽核（任一位核准即可）',
      '第2關（主管鏈，到「長假決行」為止）沒有可簽核的主管（申請人尚未設定直屬主管），這一關略過',
    ])
  })

  it('keeps today\'s error when nobody at all can approve a required chain', async () => {
    mockEmployee.rows.splice(mockEmployee.rows.findIndex(row => row._id === SYS_ADMIN), 1)

    await expect(builder.buildRequestSteps({ wf: { steps: [chainStep({})] }, applicantEmp: person(ORPHAN), form: FORM }))
      .rejects.toMatchObject({ name: 'StepBuildError', status: 400, extra: { code: 'REQUIRED_APPROVER_MISSING', step: 1 } })
  })

  it('refuses more than 20 steps after the chain is expanded, in Chinese', async () => {
    const users = Array.from({ length: 18 }, (_, index) => ({ step_order: index + 2, approver_type: 'user', approver_value: [index % 2 ? HR : SYS_ADMIN] }))
    const wf = { steps: [chainStep({ maxLevels: 3 }), ...users] }

    await expect(builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM }))
      .rejects.toMatchObject({ extra: { code: 'TOO_MANY_STEPS', stepCount: 21 } })
    await expect(builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM }))
      .rejects.toThrow('【請假】的簽核流程展開主管鏈後共有 21 關，超過上限 20 關')
  })
})

describe('buildRequestSteps：請假長度條件', () => {
  it('leaves out the 7-day level for 52 hours and logs why; 56 hours (exactly the threshold) includes it', async () => {
    const short = await builder.buildRequestSteps({ wf: customerWorkflow(), applicantEmp: person(NURSE), form: FORM, leave: leaveOf(52, '2026-11-16', '2026-11-22') })
    expect(ids(short.steps)).toEqual([[HEAD], [DIRECTOR]])
    expect(short.logs).toEqual([{ action: 'step_not_applicable', message: '第2關不適用（請假未滿 56 小時，本次 52 小時）' }])

    const long = await builder.buildRequestSteps({ wf: customerWorkflow(), applicantEmp: person(NURSE), form: FORM, leave: leaveOf(56, '2026-11-16', '2026-11-22') })
    expect(ids(long.steps)).toEqual([[HEAD], [DIRECTOR], [VP]])
    expect(names(long.steps)).toEqual(['第1級主管', '第2級主管', '第3級主管'])
    expect(long.steps[2]).toMatchObject({ is_required: false })
    expect(long.logs).toEqual([{
      action: 'skip_repeated_approver',
      message: '第2關（主管鏈，到「長假決行」為止）略過已是前面關卡簽核人的護理長（N002）（第1級主管）、主任（N003）（第2級主管）',
    }])
  })

  it('counts calendar days (inclusive Taipei dates) for the calendar-day condition', async () => {
    const wf = customerWorkflow({ kind: 'leave_calendar_days_gte', value: 7 })
    const six = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM, leave: leaveOf(48, '2026-11-16', '2026-11-21') })
    expect(six.steps).toHaveLength(2)
    expect(six.logs[0].message).toBe('第2關不適用（請假未滿 7 日，本次 6 日）')

    const seven = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM, leave: leaveOf(52, '2026-11-16', '2026-11-22') })
    expect(ids(seven.steps)).toEqual([[HEAD], [DIRECTOR], [VP]])
  })

  it('counts scheduled working days from the roster (12-hour nurse), and calendar days where there is no roster', async () => {
    const wf = customerWorkflow({ kind: 'leave_scheduled_days_gte', value: 7 })
    mockShifts = [
      { _id: 'shift-day12', name: '白12', startTime: '07:00', endTime: '19:00', breakMinutes: 0 },
      { _id: 'shift-off', name: '休', code: 'OFF', isRestDay: true, startTime: '', endTime: '' },
    ]
    // 11/16–11/27 共 12 天：上 5 天班（12 小時）、休 7 天
    const work = ['2026-11-16', '2026-11-18', '2026-11-20', '2026-11-23', '2026-11-25']
    mockShiftRows = Array.from({ length: 12 }, (_, index) => {
      const key = new Date(Date.UTC(2026, 10, 16 + index)).toISOString().slice(0, 10)
      return { employee: NURSE, date: new Date(`${key}T00:00:00.000Z`), shiftId: work.includes(key) ? 'shift-day12' : 'shift-off' }
    })
    const fiveShifts = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM, leave: leaveOf(60, '2026-11-16', '2026-11-27') })
    expect(fiveShifts.steps).toHaveLength(2)
    expect(fiveShifts.logs[0].message).toBe('第2關不適用（請假未滿 7 個排班日，本次 5 個排班日）')

    mockShiftRows = []
    const noRoster = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM, leave: leaveOf(56, '2026-11-16', '2026-11-22') })
    expect(ids(noRoster.steps)).toEqual([[HEAD], [DIRECTOR], [VP]])
    expect(noRoster.plan.items[1].condition.detail).toBe('請假滿 7 個排班日，本次 7 個排班日，期間沒有班表，以日曆日計算')
  })

  it('reuses the roster already loaded for the hours check instead of querying again', async () => {
    const wf = customerWorkflow({ kind: 'leave_scheduled_days_gte', value: 7 })
    const leave = { ...leaveOf(56, '2026-11-16', '2026-11-22'), schedule: new Map([['2026-11-16', { work: false, hours: 0 }]]) }

    const { steps, plan } = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM, leave })

    expect(mockShiftSchedule.find).not.toHaveBeenCalled()
    expect(steps).toHaveLength(2)
    expect(plan.items[1].condition.detail).toBe('請假未滿 7 個排班日，本次 6 個排班日，其中 6 天沒有班表，以日曆日計算')
  })

  it('keeps a conditional step when the leave length is unknown (better one approval too many than one too few)', async () => {
    const { steps, logs } = await builder.buildRequestSteps({ wf: customerWorkflow(), applicantEmp: person(NURSE), form: FORM, leave: null })

    expect(ids(steps)).toEqual([[HEAD], [DIRECTOR], [VP]])
    expect(logs[0]).toEqual({ action: 'step_condition', message: '第2關照常簽核（無法判斷請假長度）' })
  })

  it('refuses a request whose every step was left out by its condition', async () => {
    const wf = { steps: [chainStep({}, { condition: { kind: 'leave_hours_gte', value: 56 } })] }

    await expect(builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM, leave: leaveOf(8, '2026-11-16', '2026-11-16') }))
      .rejects.toMatchObject({ extra: { code: 'REQUIRED_APPROVER_MISSING' } })
  })
})

describe('buildRequestSteps：略過重複的簽核人', () => {
  it('the customer sheet: kitchen 1 day → 營養師 only; 7 days → 營養師 → 主任 → 醫療副院長', async () => {
    const shortLeave = await builder.buildRequestSteps({ wf: customerWorkflow(), applicantEmp: person(COOK), form: FORM, leave: leaveOf(8, '2026-11-16', '2026-11-16') })
    expect(ids(shortLeave.steps)).toEqual([[DIETITIAN]])

    const longLeave = await builder.buildRequestSteps({ wf: customerWorkflow(), applicantEmp: person(COOK), form: FORM, leave: leaveOf(56, '2026-11-16', '2026-11-22') })
    expect(ids(longLeave.steps)).toEqual([[DIETITIAN], [DIRECTOR], [VP]])
    expect(names(longLeave.steps)).toEqual(['第1級主管', '第2級主管', '第3級主管'])
  })

  it('drops a chain step whose every level already signed earlier, even when it is required (not REQUIRED_APPROVER_MISSING)', async () => {
    const wf = customerWorkflow()
    wf.steps[1].is_required = true

    const { steps, logs } = await builder.buildRequestSteps({ wf, applicantEmp: person(CLERK), form: FORM, leave: leaveOf(56, '2026-11-16', '2026-11-22') })

    expect(ids(steps)).toEqual([[LEAD], [ADMIN_VP]])
    expect(logs).toEqual([{
      action: 'skip_repeated_approver',
      message: '第2關（主管鏈，到「長假決行」為止）的簽核人都已是前面關卡的簽核人（總務組長（G002）（第1級主管）、行政副院長（G003）（第2級主管）），這一關略過',
    }])
  })

  it('always skips chain levels that appear in any earlier step, not only the step right before', async () => {
    const wf = { steps: [
      { step_order: 1, approver_type: 'user', approver_value: [DIRECTOR] },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      chainStep({ stopAtTag: NORMAL_TAG }, { step_order: 3 }),
    ] }

    const { steps } = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM })

    expect(ids(steps)).toEqual([[DIRECTOR], [HR], [HEAD]])
  })

  it('leaves other steps alone unless the workflow switches on skipRepeatedApprovers', async () => {
    const steps = [
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資', is_required: false },
      { step_order: 3, approver_type: 'user', approver_value: [HEAD, HR] },
    ]

    const today = await builder.buildRequestSteps({ wf: { steps }, applicantEmp: person(NURSE), form: FORM })
    expect(ids(today.steps)).toEqual([[HEAD], [HR], [HEAD, HR]])
    expect(today.logs).toEqual([])

    const switched = await builder.buildRequestSteps({ wf: { steps, policy: { skipRepeatedApprovers: true } }, applicantEmp: person(NURSE), form: FORM })
    expect(ids(switched.steps)).toEqual([[HEAD], [HR]])
    expect(switched.logs).toEqual([{ action: 'skip_repeated_approver', message: '第3關（指定員工）的簽核人都已是前面關卡的簽核人（護理長（N002）、人資（H001）），這一關略過' }])
  })

  it('keeps the remaining approvers of a partly repeated step', async () => {
    const steps = [
      { step_order: 1, approver_type: 'user', approver_value: [HR] },
      { step_order: 2, approver_type: 'user', approver_value: [HR, SYS_ADMIN] },
    ]

    const { steps: built, logs } = await builder.buildRequestSteps({ wf: { steps, policy: { skipRepeatedApprovers: true } }, applicantEmp: person(NURSE), form: FORM })

    expect(ids(built)).toEqual([[HR], [SYS_ADMIN]])
    expect(logs).toEqual([{ action: 'skip_repeated_approver', message: '第2關（指定員工）略過已是前面關卡簽核人的人資（H001）' }])
  })
})

describe('buildRequestSteps：沒有用到新設定的流程和以前完全相同', () => {
  it('申請者的主管 + 標籤 人資', async () => {
    const wf = { steps: [
      { step_order: 1, approver_type: 'manager', approver_value: 'APPLICANT_SUPERVISOR', is_required: true, all_must_approve: true, can_return: true },
      { step_order: 2, approver_type: 'tag', approver_value: '人資', is_required: true, all_must_approve: true, can_return: true },
    ], policy: { maxApprovalLevel: 5 } }

    const { steps, logs } = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM, leave: leaveOf(56, '2026-11-16', '2026-11-22') })

    expect(steps).toEqual([
      { step_order: 1, approvers: [{ approver: HEAD, decision: 'pending' }], all_must_approve: true, is_required: true, can_return: true },
      { step_order: 2, approvers: [{ approver: HR, decision: 'pending' }], all_must_approve: true, is_required: true, can_return: true },
    ])
    expect(logs).toEqual([])
  })

  it('still merges consecutive identical steps and still reports a required step without anyone', async () => {
    const wf = { steps: [
      { step_order: 1, approver_type: 'user', approver_value: [HR] },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ] }
    const { steps } = await builder.buildRequestSteps({ wf, applicantEmp: person(NURSE), form: FORM })
    expect(ids(steps)).toEqual([[HR]])

    await expect(builder.buildRequestSteps({ wf: { steps: [{ step_order: 1, approver_type: 'tag', approver_value: '沒有人' }] }, applicantEmp: person(NURSE), form: FORM }))
      .rejects.toThrow('【請假】第1關（標籤：沒有人）找不到可簽核的人員，請聯絡管理員設定')
  })
})

describe('evaluateStepCondition / describeStepCondition', () => {
  it('describes each kind for the preview and treats >= as applicable', () => {
    expect(resolution.describeStepCondition({ kind: 'leave_hours_gte', value: 56 })).toBe('請假滿 56 小時才需要')
    expect(resolution.describeStepCondition({ kind: 'leave_calendar_days_gte', value: 7 })).toBe('請假滿 7 日（日曆日）才需要')
    expect(resolution.describeStepCondition({ kind: 'leave_scheduled_days_gte', value: 7 })).toBe('請假滿 7 個排班日才需要')
    expect(resolution.describeStepCondition(null)).toBe('')
    expect(resolution.evaluateStepCondition({ kind: 'leave_calendar_days_gte', value: 7 }, { calendarDays: 7 }).applies).toBe(true)
    expect(resolution.evaluateStepCondition({ kind: 'leave_hours_gte', value: 56 }, { hours: 55.5 }).applies).toBe(false)
    expect(resolution.evaluateStepCondition({ kind: 'leave_calendar_days_gte', value: 7 }, { calendarDays: 6.5, calendarSource: 'hours' }).detail)
      .toBe('請假未滿 7 日，本次 6.5 日，沒有請假日期，以時數換算')
  })

  it('computes calendar days from dates, and from hours when the form has no dates', () => {
    expect(builder.computeLeaveLength({ hours: 52, startValue: '2026-11-16', endValue: '2026-11-22' })).toMatchObject({ hours: 52, calendarDays: 7, calendarSource: 'dates' })
    expect(builder.computeLeaveLength({ hours: 52 })).toMatchObject({ hours: 52, calendarDays: 6.5, calendarSource: 'hours' })
    // 有時分的請假：碰到的台灣日期都算（11/16 22:00 – 11/17 06:00 是 2 日）
    expect(builder.computeLeaveLength({ hours: 8, startValue: '2026-11-16T14:00:00.000Z', endValue: '2026-11-16T22:00:00.000Z' })).toMatchObject({ calendarDays: 2 })
  })
})
