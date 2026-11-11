// 刪除班別時要一起從小單位的「使用班別」（SubDepartment.allowedShiftIds）拿掉：
// 以前留著已不存在的 _id，只選了這個上班班別的小單位清單不是空的（不算全部）卻沒有能用的上班班別，排班一律被擋。
// 需要 APPROVAL_ENGINE_TEST_MONGODB_URI（見 helpers/realAppKit.js）。
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

jest.setTimeout(60000)

const kit = createRealAppKit('shift_delete_units')

kit.describe('DELETE /api/shifts/:id 清理小單位的使用班別', () => {
  const shiftIds = {}
  const units = {}

  beforeAll(async () => {
    await kit.start()
    await kit.addPerson('admin', { role: 'admin' })
    for (const [key, body] of Object.entries({
      day: { name: '白班', code: 'D', startTime: '08:00', endTime: '16:00' },
      night: { name: '大夜', code: 'N', startTime: '00:00', endTime: '08:00' },
      evening: { name: '小夜', code: 'E', startTime: '16:00', endTime: '00:00', crossDay: true },
      rest: { name: '休息日', code: '休', startTime: '00:00', endTime: '00:00', semanticType: 'rest_day' },
    })) {
      const res = await kit.post('admin', '/api/shifts', body)
      expect(res.status).toBe(201)
      shiftIds[key] = String(res.body._id)
    }
    const organization = await kit.models.Organization.create({ name: '機構' })
    const department = await kit.models.Department.create({ name: '護理部', organization: organization._id })
    const unit = (name, allowedShiftIds) => kit.models.SubDepartment.create({ department: department._id, name, allowedShiftIds })
    units.onlyDay = await unit('只排白班', [shiftIds.day, shiftIds.rest])
    units.dayAndNight = await unit('白班大夜', [shiftIds.day, shiftIds.night])
    units.all = await unit('不限', [])
    units.nightOnly = await unit('只排大夜', [shiftIds.night])
  })
  afterAll(kit.stop)

  const allowedOf = async (key) => (await kit.models.SubDepartment.findById(units[key]._id).lean()).allowedShiftIds

  it('pulls the deleted shift; a unit left without any existing shift goes back to 全部 (empty list)', async () => {
    const res = await kit.del('admin', `/api/shifts/${shiftIds.day}`)
    expect(res.status).toBe(204)

    // 2026/11/11 起休假類的班別也受「使用班別」限制：剩下的休息日是管理員選的，照樣保留（畫面會提醒沒有上班的班別）
    expect(await allowedOf('onlyDay')).toEqual([shiftIds.rest])
    expect(await allowedOf('dayAndNight')).toEqual([shiftIds.night])
    expect(await allowedOf('all')).toEqual([])
    expect(await allowedOf('nightOnly')).toEqual([shiftIds.night])
  })

  it('a unit whose only shift is deleted can schedule every work shift again', async () => {
    const res = await kit.del('admin', `/api/shifts/${shiftIds.night}`)
    expect(res.status).toBe(204)
    expect(await allowedOf('nightOnly')).toEqual([])
    expect(await allowedOf('dayAndNight')).toEqual([])
    const { getAllowedShiftIdsFor } = await import('../src/services/scheduleAccessService.js')
    expect(await getAllowedShiftIdsFor({ subDepartmentIds: [String(units.nightOnly._id)] })).toEqual([])
  })
})
