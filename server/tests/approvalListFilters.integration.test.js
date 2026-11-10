// 簽核清單（我的申請 /api/approvals、待我簽核 /inbox、我已簽核 /history）的篩選參數與每一列的內容摘要，
// 用真的 app 與真的 MongoDB 驗證：篩選後的總筆數（X-Total-Count）正確、摘要不必另外查表單欄位（跨部門也看得到）、
// 參數格式不對回 400 中文訊息。需要 APPROVAL_ENGINE_TEST_MONGODB_URI（見 helpers/realAppKit.js）。
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

jest.setTimeout(60000)

const kit = createRealAppKit('approval_list_filters')

const LEAVE_FIELDS = [
  { label: '假別', type_1: 'select', options: [{ value: 'personal', label: '事假' }, { value: 'sick', label: '病假' }] },
  { label: '開始時間', type_1: 'datetime' },
  { label: '結束時間', type_1: 'datetime' },
  { label: '時數', type_1: 'number' },
]
const OTHER_FIELDS = [
  { label: '附件', type_1: 'file' },
  { label: '事由', type_1: 'textarea' },
  { label: '金額', type_1: 'number' },
  { label: '品項', type_1: 'text' },
  { label: '備註', type_1: 'text' },
]

kit.describe('簽核清單的篩選與摘要', () => {
  let leave
  let other
  const ids = {}

  // 直接寫入 collection：createdAt 要能指定（Mongoose 的 timestamps 會改掉）
  async function insertRequest(key, { form, applicant, createdAt, status = 'pending', formData = {}, decided = false }) {
    const doc = {
      form: form.form._id,
      workflow: form.workflow._id,
      form_data: formData,
      applicant_employee: kit.people[applicant]._id,
      status,
      current_step_index: 0,
      steps: [{
        step_order: 1,
        approvers: [{
          approver: kit.people.boss._id,
          decision: decided ? 'approved' : 'pending',
          ...(decided ? { decided_at: new Date(createdAt) } : {}),
        }],
        all_must_approve: true,
      }],
      createdAt: new Date(createdAt),
      updatedAt: new Date(createdAt),
    }
    const { insertedId } = await kit.models.ApprovalRequest.collection.insertOne(doc)
    ids[key] = String(insertedId)
  }

  beforeAll(async () => {
    await kit.start()
    await kit.addPerson('boss', { role: 'supervisor', name: '林主管', employeeId: 'S001' })
    await kit.addPerson('amy', { name: '王小美', employeeId: 'E1001' })
    await kit.addPerson('bob', { name: '陳大明', employeeId: 'E2002' })
    await kit.addPerson('admin', { role: 'admin', name: '管理員', employeeId: 'A001' })
    const steps = [{ step_order: 1, approver_type: 'user', approver_value: [kit.people.boss._id] }]
    leave = await kit.makeForm('請假', 'leave', steps, LEAVE_FIELDS)
    other = await kit.makeForm('請購單', 'general', steps, OTHER_FIELDS)

    await insertRequest('amyLeave', {
      form: leave,
      applicant: 'amy',
      // 台灣 2026-03-01 00:30（UTC 是 2/28）：日期篩選要用台灣日期
      createdAt: '2026-02-28T16:30:00.000Z',
      formData: {
        [leave.fieldOf('假別')]: 'personal',
        [leave.fieldOf('開始時間')]: '2026-03-02T01:00:00.000Z',
        [leave.fieldOf('結束時間')]: '2026-03-02T05:00:00.000Z',
        [leave.fieldOf('時數')]: 4,
      },
    })
    await insertRequest('bobOther', {
      form: other,
      applicant: 'bob',
      createdAt: '2026-03-10T02:00:00.000Z',
      formData: {
        [other.fieldOf('附件')]: ['/upload/x.pdf'],
        [other.fieldOf('事由')]: '  補充   夜班用品  ',
        [other.fieldOf('金額')]: 1200,
        [other.fieldOf('品項')]: '手套',
        [other.fieldOf('備註')]: '第四個欄位不放進摘要',
      },
    })
    await insertRequest('amyOld', { form: other, applicant: 'amy', createdAt: '2026-01-05T02:00:00.000Z', status: 'approved', decided: true })
  })
  afterAll(kit.stop)

  it('inbox: each row carries a server-built summary (leave: 假別/開始/結束/時數; others: first filled fields)', async () => {
    const res = await kit.get('boss', '/api/approvals/inbox?page=1&limit=20')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    const byId = new Map(res.body.items.map(item => [String(item._id), item]))
    expect(byId.get(ids.amyLeave).summary).toEqual({
      kind: 'leave',
      leaveType: '事假',
      hours: 4,
      start: '2026-03-02T01:00:00.000Z',
      end: '2026-03-02T05:00:00.000Z',
      dateOnly: false,
      items: [
        { label: '假別', value: '事假' },
        { label: '開始時間', value: '2026/03/02 09:00' },
        { label: '結束時間', value: '2026/03/02 13:00' },
        { label: '時數', value: '4 小時' },
      ],
    })
    expect(byId.get(ids.bobOther).summary).toEqual({
      kind: 'fields',
      items: [
        { label: '事由', value: '補充 夜班用品' },
        { label: '金額', value: '1200' },
        { label: '品項', value: '手套' },
      ],
    })
  })

  it('filters by form, Taiwan date range, applicant name / employee number, and keeps the filtered total', async () => {
    const byForm = await kit.get('boss', `/api/approvals/inbox?form=${leave.form._id}`)
    expect(byForm.body.map(item => String(item._id))).toEqual([ids.amyLeave])
    expect(byForm.headers['x-total-count']).toBe('1')

    // 台灣 3/1 建立的單（UTC 2/28）算在 3/1
    const onMarchFirst = await kit.get('boss', '/api/approvals/inbox?from=2026-03-01&to=2026-03-01')
    expect(onMarchFirst.body.map(item => String(item._id))).toEqual([ids.amyLeave])
    const february = await kit.get('boss', '/api/approvals/inbox?from=2026-02-01&to=2026-02-28')
    expect(february.body).toEqual([])

    const byName = await kit.get('boss', '/api/approvals/inbox?q=大明')
    expect(byName.body.map(item => String(item._id))).toEqual([ids.bobOther])
    const byNumber = await kit.get('boss', '/api/approvals/inbox?q=e1001&page=1&limit=5')
    expect(byNumber.body).toMatchObject({ total: 1, page: 1, limit: 5 })
    expect(byNumber.headers['x-total-count']).toBe('1')
    const nobody = await kit.get('boss', '/api/approvals/inbox?q=不存在的人')
    expect(nobody.body).toEqual([])
    expect(nobody.headers['x-total-count']).toBe('0')
    // 正規表示式的特殊字元當成一般文字
    expect((await kit.get('boss', '/api/approvals/inbox?q=.*')).body).toEqual([])
  })

  it('sort=oldest flips the order; default stays newest first', async () => {
    const newest = await kit.get('boss', '/api/approvals/inbox')
    expect(newest.body.map(item => String(item._id))).toEqual([ids.bobOther, ids.amyLeave])
    const oldest = await kit.get('boss', '/api/approvals/inbox?sort=oldest')
    expect(oldest.body.map(item => String(item._id))).toEqual([ids.amyLeave, ids.bobOther])
  })

  it('my requests: status filter and summaries on the applicant list', async () => {
    const all = await kit.get('amy', '/api/approvals')
    expect(all.body.map(item => String(item._id))).toEqual([ids.amyLeave, ids.amyOld])
    expect(all.body[0].summary.kind).toBe('leave')
    // 沒有任何答案的單：summary 是 null
    expect(all.body[1].summary).toBeNull()
    const approved = await kit.get('amy', '/api/approvals?status=approved')
    expect(approved.body.map(item => String(item._id))).toEqual([ids.amyOld])
    // 只看得到自己的單：用別人的姓名搜尋是空的
    expect((await kit.get('amy', '/api/approvals?q=陳大明')).body).toEqual([])
  })

  it('history: summaries too, and filters on what this approver signed', async () => {
    const mine = await kit.get('boss', '/api/approvals/history')
    expect(mine.body.map(item => String(item._id))).toEqual([ids.amyOld])
    expect(mine.body[0]).toHaveProperty('summary', null)
    const admin = await kit.get('admin', `/api/approvals/history?form=${leave.form._id}&status=pending`)
    expect(admin.body.map(item => String(item._id))).toEqual([ids.amyLeave])
    expect(admin.body[0].summary.leaveType).toBe('事假')
    expect(admin.body[0]).not.toHaveProperty('form_data')
  })

  it('rejects malformed filters with a Chinese message (400)', async () => {
    const cases = [
      ['/api/approvals/inbox?form=abc', '表單參數格式不正確'],
      ['/api/approvals/inbox?from=2026-02-30', '開始日期格式不正確，請用 YYYY-MM-DD'],
      ['/api/approvals?to=2026/03/01', '結束日期格式不正確，請用 YYYY-MM-DD'],
      ['/api/approvals/history?from=2026-03-02&to=2026-03-01', '開始日期不可晚於結束日期'],
      ['/api/approvals/inbox?sort=latest', '排序只能是 newest（新到舊）或 oldest（舊到新）'],
      ['/api/approvals/inbox?q=a&q=b', '關鍵字只能指定一個值'],
      [`/api/approvals/inbox?q=${'x'.repeat(51)}`, '關鍵字最多 50 個字'],
    ]
    for (const [url, message] of cases) {
      const res = await kit.get('boss', url)
      expect({ url, status: res.status, error: res.body.error, code: res.body.code })
        .toEqual({ url, status: 400, error: message, code: 'INVALID_LIST_FILTER' })
    }
  })
})
