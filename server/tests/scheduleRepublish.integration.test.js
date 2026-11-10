// 班表的發布 → 員工確認 → 異動 → 重新發布 → 完成發布 的整個循環：真的 Express app + 真的 MongoDB（單機 standalone）。
// R1 重新發布：已經確認、之後沒有異動的日子維持已確認（以前改一天再發布，14 天全部回到待確認）。
// R2 異議 → 調整 → 重新發布。
// R3 已完成發布的月份改一格：那一格回到草稿，發布狀態要回報「還有沒發送的異動」，可以只把那一格再送給員工確認。
// R4 發布狀態（publishSummary）看的是整個範圍，不是目前這一頁的員工。
// 預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27815 npm test -- tests/scheduleRepublish.integration.test.js
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('schedule_republish')
const utc = (key) => new Date(`${key}T00:00:00.000Z`)
const day = (n) => `2026-12-${String(n).padStart(2, '0')}`

kit.describe('班表發布循環 against a real MongoDB through the real app', () => {
  jest.setTimeout(180000)
  const { models } = kit
  const ids = {}

  const rowsOf = (key) => models.ShiftSchedule.find({ employee: kit.people[key]._id }).sort({ date: 1 }).lean()
  const rowOn = async (key, n) => models.ShiftSchedule.findOne({ employee: kit.people[key]._id, date: utc(day(n)) }).lean()
  const statesOf = async (key) => (await rowsOf(key)).map(row => `${row.state}/${row.employeeResponse}`)
  const plan = (key, days, unit, shiftId = ids.D) => kit.post('admin', '/api/schedules/batch', {
    schedules: days.map(n => ({ employee: kit.id(key), date: day(n), shiftId, department: ids.dept, subDepartment: unit })),
  })
  const publish = (unit) => kit.post('admin', '/api/schedules/publish', { month: '2026-12', department: ids.dept, subDepartment: unit })
  const finalize = (unit) => kit.post('admin', '/api/schedules/publish/finalize', { month: '2026-12', department: ids.dept, subDepartment: unit })
  const confirm = async (key, days) => {
    const rows = await rowsOf(key)
    const wanted = rows.filter(row => !days || days.includes(row.date.getUTCDate()))
    return kit.post(key, '/api/schedules/respond/bulk', { scheduleIds: wanted.map(row => String(row._id)), response: 'confirm' })
  }
  const summary = async (unit, extra = '') => {
    const res = await kit.get('admin', `/api/schedules/monthly?month=2026-12&page=1&pageSize=50&department=${ids.dept}&subDepartment=${unit}${extra}`)
    expect(res.status).toBe(200)
    return res.body.publishSummary
  }

  beforeAll(async () => {
    await kit.start()
    const setting = await models.AttendanceSetting.create({
      shifts: [
        { name: '日班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 },
        { name: '小夜', code: 'E', semanticType: 'work', startTime: '16:00', endTime: '24:00', breakDuration: 60 },
        { name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
      ],
    })
    ;[ids.D, ids.E, ids.R] = setting.shifts.map(shift => String(shift._id))
    const dept = await models.Department.create({ name: '護理部', organization: new mongoose.Types.ObjectId() })
    ids.dept = String(dept._id)
    for (const name of ['A', 'B', 'C', 'P']) {
      ids[`unit${name}`] = String((await models.SubDepartment.create({ department: dept._id, name: `${name} 病房` }))._id)
    }
    await kit.addPerson('admin', { role: 'admin' })
    await kit.addPerson('ann', { department: dept._id, subDepartment: ids.unitA })
    await kit.addPerson('bob', { department: dept._id, subDepartment: ids.unitB })
    await kit.addPerson('cat', { department: dept._id, subDepartment: ids.unitC })
    for (const n of [1, 2, 3, 4, 5]) await kit.addPerson(`p${n}`, { name: `員工${n}`, department: dept._id, subDepartment: ids.unitP })
  })

  afterAll(kit.stop)

  it('R1：重新發布只把新增或異動的日子送給員工，已確認的日子維持已確認', async () => {
    const days = Array.from({ length: 14 }, (_, index) => index + 1)
    expect((await plan('ann', days, ids.unitA)).status).toBe(201)
    const first = await publish(ids.unitA)
    expect(first.status).toBe(200)
    expect(first.body.updated).toBe(14)
    expect((await confirm('ann')).status).toBe(200)
    expect(await summary(ids.unitA)).toMatchObject({ status: 'ready', allEmployeesConfirmed: true })

    // 沒有任何異動時再按一次發送：沒有東西要送，已確認的也不會被重設
    const nothing = await publish(ids.unitA)
    expect(nothing.status).toBe(409)
    expect(nothing.body).toMatchObject({ code: 'NOTHING_TO_PUBLISH' })
    expect(nothing.body.error).toContain('已確認')
    expect(new Set(await statesOf('ann'))).toEqual(new Set(['pending_confirmation/confirmed']))

    // 排班人員只改 12/03
    const target = await rowOn('ann', 3)
    expect((await kit.put('admin', `/api/schedules/${target._id}`, { shiftId: ids.E })).status).toBe(200)
    expect(await summary(ids.unitA)).toMatchObject({ unpublishedCount: 1 })

    const second = await publish(ids.unitA)
    expect(second.status).toBe(200)
    // 以前回 updated: 14，14 天全部回到待確認，員工要整個月重新確認一次
    expect(second.body.updated).toBe(1)
    expect(second.body.keptConfirmed).toBe(13)
    const states = await statesOf('ann')
    expect(states.filter(state => state === 'pending_confirmation/confirmed')).toHaveLength(13)
    expect(states[2]).toBe('pending_confirmation/pending')
    expect(await summary(ids.unitA)).toMatchObject({
      status: 'pending',
      pendingEmployees: [expect.objectContaining({ id: kit.id('ann'), pendingCount: 1 })],
      unpublishedCount: 0,
    })
    // 還有一天沒確認：不能完成發布
    expect((await finalize(ids.unitA)).status).toBe(409)

    expect((await confirm('ann', [3])).status).toBe(200)
    expect(await summary(ids.unitA)).toMatchObject({ status: 'ready', allEmployeesConfirmed: true })
    const done = await finalize(ids.unitA)
    expect(done.status).toBe(200)
    expect(done.body.finalized).toBe(14)
    expect(new Set(await statesOf('ann'))).toEqual(new Set(['finalized/confirmed']))
    expect(await summary(ids.unitA)).toMatchObject({ status: 'finalized', unpublishedCount: 0 })
  })

  it('R2：異議 → 調整 → 重新發布，只有調整的那一天再請員工確認；沒調整就重新發送的異議日回到待確認', async () => {
    expect((await plan('bob', [1, 2, 3, 4, 5], ids.unitB)).status).toBe(201)
    expect((await publish(ids.unitB)).body.updated).toBe(5)
    expect((await confirm('bob', [1, 3, 4])).status).toBe(200)
    const disputed = await rowOn('bob', 2)
    const objection = await kit.post('bob', `/api/schedules/${disputed._id}/respond`, { response: 'dispute', note: '當天要回診' })
    expect(objection.status).toBe(200)
    expect(await summary(ids.unitB)).toMatchObject({
      status: 'disputed',
      disputedEmployees: [expect.objectContaining({ id: kit.id('bob'), disputedCount: 1, latestNote: '當天要回診' })],
      pendingEmployees: [expect.objectContaining({ id: kit.id('bob'), pendingCount: 1 })],
    })

    // 排班人員把 12/02 改成休息日後重新發布：12/02（異動）與 12/05（還沒回覆）送出，已確認的三天不動
    expect((await kit.put('admin', `/api/schedules/${disputed._id}`, { shiftId: ids.R })).status).toBe(200)
    const again = await publish(ids.unitB)
    expect(again.status).toBe(200)
    expect(again.body.updated).toBe(2)
    expect(await statesOf('bob')).toEqual([
      'pending_confirmation/confirmed',
      'pending_confirmation/pending',
      'pending_confirmation/confirmed',
      'pending_confirmation/confirmed',
      'pending_confirmation/pending',
    ])
    expect((await rowOn('bob', 2)).responseNote).toBe('')

    // 12/05 提出異議，排班人員和員工談過後不調整、直接重新發送：異議的那一天回到待確認，員工可以改按確認
    const fifth = await rowOn('bob', 5)
    expect((await kit.post('bob', `/api/schedules/${fifth._id}/respond`, { response: 'dispute', note: '想換班' })).status).toBe(200)
    expect((await confirm('bob', [2])).status).toBe(200)
    expect((await finalize(ids.unitB)).status).toBe(409)
    const resend = await publish(ids.unitB)
    expect(resend.body.updated).toBe(1)
    expect((await rowOn('bob', 5))).toMatchObject({ state: 'pending_confirmation', employeeResponse: 'pending' })
    expect((await confirm('bob', [5])).status).toBe(200)
    expect((await finalize(ids.unitB)).body.finalized).toBe(5)
    expect(await summary(ids.unitB)).toMatchObject({ status: 'finalized' })
  })

  it('R3：已完成發布的月份改一格，可以只把那一格再送給員工確認並完成發布', async () => {
    expect((await plan('cat', [1, 2, 3], ids.unitC)).status).toBe(201)
    await publish(ids.unitC)
    await confirm('cat')
    expect((await finalize(ids.unitC)).body.finalized).toBe(3)
    expect(await summary(ids.unitC)).toMatchObject({ status: 'finalized', hasSchedules: true })

    const target = await rowOn('cat', 2)
    expect((await kit.put('admin', `/api/schedules/${target._id}`, { shiftId: ids.E })).status).toBe(200)
    expect(await rowOn('cat', 2)).toMatchObject({ state: 'draft', needsReconfirm: true })
    // 以前只要有一筆已完成發布，整個月就回報「已完成發布」，畫面上不能再發送，這一格永遠送不到員工手上
    const changed = await summary(ids.unitC)
    expect(changed).toMatchObject({ status: 'draft', hasSchedules: true, unpublishedCount: 1 })
    expect(changed.publishedAt).toBeTruthy()

    // 新增一天也一樣
    expect((await plan('cat', [4], ids.unitC)).status).toBe(201)
    expect(await summary(ids.unitC)).toMatchObject({ status: 'draft', unpublishedCount: 2 })

    const resent = await publish(ids.unitC)
    expect(resent.status).toBe(200)
    expect(resent.body.updated).toBe(2)
    expect(await statesOf('cat')).toEqual([
      'finalized/confirmed', 'pending_confirmation/pending', 'finalized/confirmed', 'pending_confirmation/pending',
    ])
    expect(await summary(ids.unitC)).toMatchObject({
      status: 'pending',
      pendingEmployees: [expect.objectContaining({ id: kit.id('cat'), pendingCount: 2 })],
    })
    // 已完成發布的日子員工不能再回覆，待確認的可以
    expect((await kit.post('cat', `/api/schedules/${(await rowOn('cat', 1))._id}/respond`, { response: 'confirm' })).status).toBe(400)
    expect((await confirm('cat', [2, 4])).status).toBe(200)
    expect(await summary(ids.unitC)).toMatchObject({ status: 'ready', allEmployeesConfirmed: true })
    expect((await finalize(ids.unitC)).body.finalized).toBe(2)
    expect(await summary(ids.unitC)).toMatchObject({ status: 'finalized', unpublishedCount: 0 })
  })

  it('R4：發布狀態是整個範圍的，不是目前這一頁（或畫面上這幾位）員工的', async () => {
    for (const n of [1, 2, 3, 4, 5]) expect((await plan(`p${n}`, [1, 2], ids.unitP)).status).toBe(201)
    expect((await publish(ids.unitP)).body.updated).toBe(10)
    // 名單依姓名排序：員工1、員工2 在第一頁；第一頁的兩位都確認了，員工5 提出異議，員工3、4 還沒回覆
    await confirm('p1')
    await confirm('p2')
    const p5 = await rowOn('p5', 1)
    await kit.post('p5', `/api/schedules/${p5._id}/respond`, { response: 'dispute', note: '那天有事' })

    const pageOne = await kit.get('admin', `/api/schedules/monthly?month=2026-12&page=1&pageSize=2&department=${ids.dept}&subDepartment=${ids.unitP}`)
    expect(pageOne.status).toBe(200)
    expect(pageOne.body.employees.map(employee => employee.name)).toEqual(['員工1', '員工2'])
    expect(pageOne.body.pagination).toMatchObject({ total: 5, totalPages: 3 })
    // 以前第一頁回報 ready（可完成發布）、totalEmployees: 2
    expect(pageOne.body.publishSummary).toMatchObject({ status: 'disputed', totalEmployees: 5, allEmployeesConfirmed: false })
    expect(pageOne.body.publishSummary.pendingEmployees.map(item => [item.name, item.pendingCount]).sort()).toEqual([
      ['員工3', 2], ['員工4', 2], ['員工5', 1],
    ])
    expect(pageOne.body.publishSummary.disputedEmployees).toEqual([
      expect.objectContaining({ id: kit.id('p5'), name: '員工5', disputedCount: 1, latestNote: '那天有事' }),
    ])
    expect(pageOne.body.publishSummary.disputedEmployees[0].disputes).toEqual([
      expect.objectContaining({ date: `${day(1)}T00:00:00.000Z`, note: '那天有事' }),
    ])

    // 畫面只要求其中幾位員工的班表（捲動載入、搜尋）時，發布狀態一樣是整個小單位的
    const subset = await kit.get('admin', `/api/schedules/monthly?month=2026-12&page=1&pageSize=50&department=${ids.dept}&subDepartment=${ids.unitP}&employeeIds=${kit.id('p1')},${kit.id('p2')}&search=${encodeURIComponent('員工1')}`)
    expect(subset.body.employees.map(employee => employee.name)).toEqual(['員工1'])
    expect(subset.body.publishSummary).toMatchObject({ status: 'disputed', totalEmployees: 5 })
    // 每一頁的發布狀態都相同
    const pageThree = await kit.get('admin', `/api/schedules/monthly?month=2026-12&page=3&pageSize=2&department=${ids.dept}&subDepartment=${ids.unitP}`)
    expect(pageThree.body.publishSummary).toEqual(pageOne.body.publishSummary)
  })
})
