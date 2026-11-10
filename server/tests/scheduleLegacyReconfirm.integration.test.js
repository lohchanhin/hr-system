// 2026-03 以前建立的班表沒有 needsReconfirm 欄位（舊資料形狀，沒有做資料移轉）：
// 發布只選 needsReconfirm: true 的列，這些班表永遠發布不了；已發送（pending_confirmation）的也不能完成發布（404 NO_SCHEDULES）。
// 查詢改成「沒有這個欄位、又還沒完成發布的列」也算需要確認。需要 APPROVAL_ENGINE_TEST_MONGODB_URI（見 helpers/realAppKit.js）。
import { jest } from '@jest/globals'
import mongoose from 'mongoose'
import { createRealAppKit } from './helpers/realAppKit.js'

jest.setTimeout(120000)

const kit = createRealAppKit('schedule_legacy_reconfirm')
const utc = (key) => new Date(`${key}T00:00:00.000Z`)

kit.describe('舊資料（沒有 needsReconfirm）的班表發布與完成發布', () => {
  const { models } = kit
  const ids = {}

  // 直接寫入 collection，模擬沒有 needsReconfirm 欄位的舊資料
  async function legacyRow(personKey, date, extra = {}) {
    const doc = {
      employee: kit.people[personKey]._id,
      date: utc(date),
      shiftId: ids.D,
      department: ids.dept,
      subDepartment: ids.unit,
      state: 'draft',
      employeeResponse: 'pending',
      responseNote: '',
      createdAt: new Date('2026-01-05T00:00:00Z'),
      updatedAt: new Date('2026-01-05T00:00:00Z'),
      ...extra,
    }
    const { insertedId } = await models.ShiftSchedule.collection.insertOne(doc)
    return insertedId
  }

  beforeAll(async () => {
    await kit.start()
    const setting = await models.AttendanceSetting.create({
      shifts: [{ name: '日班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60 }],
    })
    ids.D = setting.shifts[0]._id
    const dept = await models.Department.create({ name: '護理部', organization: new mongoose.Types.ObjectId() })
    ids.dept = dept._id
    ids.unit = (await models.SubDepartment.create({ department: dept._id, name: 'A 病房' }))._id
    await kit.addPerson('admin', { role: 'admin' })
    await kit.addPerson('ann', { department: dept._id, subDepartment: ids.unit })
    await kit.addPerson('bob', { department: dept._id, subDepartment: ids.unit })
  })
  afterAll(kit.stop)

  const body = (month) => ({ month, department: String(ids.dept), subDepartment: String(ids.unit) })

  it('publishes old draft rows and counts them as unpublished in the summary', async () => {
    await legacyRow('ann', '2026-02-02')
    await legacyRow('ann', '2026-02-03')
    const before = await kit.get('admin', `/api/schedules/monthly?month=2026-02&page=1&pageSize=50&department=${ids.dept}&subDepartment=${ids.unit}`)
    expect(before.status).toBe(200)
    expect(before.body.publishSummary).toMatchObject({ status: 'draft' })

    const res = await kit.post('admin', '/api/schedules/publish', body('2026-02'))
    expect(res.status).toBe(200)
    expect(res.body.updated).toBe(2)
    const rows = await models.ShiftSchedule.find({ employee: kit.people.ann._id }).lean()
    expect(rows.map(row => row.state)).toEqual(['pending_confirmation', 'pending_confirmation'])
  })

  it('finalizes old rows that were already sent and confirmed', async () => {
    // 舊資料：已經發送、員工也確認了，但沒有 needsReconfirm
    await legacyRow('bob', '2026-01-12', { state: 'pending_confirmation', employeeResponse: 'confirmed', publishedAt: new Date('2026-01-06T00:00:00Z') })
    await legacyRow('bob', '2026-01-13', { state: 'pending_confirmation', employeeResponse: 'confirmed', publishedAt: new Date('2026-01-06T00:00:00Z') })
    const res = await kit.post('admin', '/api/schedules/publish/finalize', body('2026-01'))
    expect(res.status).toBe(200)
    expect(res.body.finalized).toBe(2)
    const rows = await models.ShiftSchedule.find({ employee: kit.people.bob._id }).lean()
    expect(rows.map(row => [row.state, row.needsReconfirm])).toEqual([['finalized', false], ['finalized', false]])

    // 已完成發布的舊資料（finalized、沒有欄位）不會被重新發送
    const again = await kit.post('admin', '/api/schedules/publish', body('2026-01'))
    expect(again.status).toBe(404)
    expect(again.body.code).toBe('NO_SCHEDULES')
  })

  it('an old row that was sent but not answered blocks finalize with the employee listed (not a 404)', async () => {
    await legacyRow('ann', '2026-03-02', { state: 'pending_confirmation', employeeResponse: 'pending' })
    const res = await kit.post('admin', '/api/schedules/publish/finalize', body('2026-03'))
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('UNCONFIRMED_EMPLOYEES')
    expect(res.body.pendingEmployees.map(entry => entry.id)).toEqual([kit.id('ann')])
  })
})
