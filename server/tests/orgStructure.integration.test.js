// 機構／部門／小單位的刪除保護、儲存驗證、搬移連動：真的 Express app + 真的 MongoDB。
// 預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27814 npm test -- tests/orgStructure.integration.test.js
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('org_structure')

kit.describe('機構／部門／小單位 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  const ids = {}
  const { models } = kit

  beforeAll(async () => {
    await kit.start()
    const orgA = await models.Organization.create({ name: '安康護理之家' })
    const orgB = await models.Organization.create({ name: '惠民康復之家' })
    const nursing = await models.Department.create({ name: '護理部', organization: orgA._id, uniformNumber: '12345678', scheduleNotes: '夜班兩人' })
    const admin = await models.Department.create({ name: '行政部', organization: orgA._id })
    const ward = await models.SubDepartment.create({ name: '一樓護理站', department: nursing._id, headcount: 6 })
    const night = await models.SubDepartment.create({ name: '夜班照護組', department: nursing._id })
    Object.assign(ids, {
      orgA: String(orgA._id), orgB: String(orgB._id), nursing: String(nursing._id), admin: String(admin._id), ward: String(ward._id), night: String(night._id),
    })
    await kit.addPerson('admin', { role: 'admin' })
    await kit.addPerson('nurse', { organization: ids.orgA, department: nursing._id, subDepartment: ward._id })
    await kit.addPerson('clerk', { organization: ids.orgA, department: admin._id })
  })

  afterAll(kit.stop)

  it('refuses to delete a 機構, 部門 or 小單位 that is still in use, and says what uses it', async () => {
    const sub = await kit.del('admin', `/api/sub-departments/${ids.ward}`)
    expect(sub.status).toBe(409)
    expect(sub.body.code).toBe('IN_USE')
    expect(sub.body.error).toContain('一樓護理站')
    expect(sub.body.error).toContain('1 位員工')
    expect(await models.SubDepartment.exists({ _id: ids.ward })).toBeTruthy()

    const dept = await kit.del('admin', `/api/departments/${ids.nursing}`)
    expect(dept.status).toBe(409)
    expect(dept.body.code).toBe('IN_USE')
    expect(dept.body.error).toContain('2 個小單位')
    expect(dept.body.error).toContain('1 位員工')
    expect(await models.Department.exists({ _id: ids.nursing })).toBeTruthy()

    const org = await kit.del('admin', `/api/organizations/${ids.orgA}`)
    expect(org.status).toBe(409)
    expect(org.body.code).toBe('IN_USE')
    expect(org.body.error).toContain('2 個部門')
    expect(org.body.error).toContain('2 位員工')
    expect(await models.Organization.exists({ _id: ids.orgA })).toBeTruthy()

    // 員工資料仍然指向存在的機構、部門、小單位
    const nurse = await models.Employee.findById(kit.id('nurse')).lean()
    expect(String(nurse.subDepartment)).toBe(ids.ward)
  })

  it('refuses to delete a 小單位 that a workflow 群組 step points at, and still deletes unused ones', async () => {
    const form = await models.FormTemplate.create({ name: '物品請購', is_active: true })
    const workflow = await models.ApprovalWorkflow.create({
      form: form._id,
      steps: [{ step_order: 1, approver_type: 'group', approver_value: [ids.night] }],
    })
    const blocked = await kit.del('admin', `/api/sub-departments/${ids.night}`)
    expect(blocked.status).toBe(409)
    expect(blocked.body.error).toContain('1 個簽核流程的「群組」關卡')

    await models.ApprovalWorkflow.deleteOne({ _id: workflow._id })
    const removed = await kit.del('admin', `/api/sub-departments/${ids.night}`)
    expect(removed.status).toBe(200)
    expect(removed.body).toEqual({ success: true })
    expect(await models.SubDepartment.exists({ _id: ids.night })).toBeNull()

    // 沒有人用的機構照常可以刪除
    const spare = await models.Organization.create({ name: '備用機構' })
    expect((await kit.del('admin', `/api/organizations/${spare._id}`)).status).toBe(200)
    expect((await kit.del('admin', `/api/organizations/${spare._id}`)).status).toBe(404)
  })

  it('validates edits like creation does, and keeps the fields a slim dialog does not send', async () => {
    const blankDept = await kit.put('admin', `/api/departments/${ids.nursing}`, { name: '', organization: ids.orgA })
    expect(blankDept.status).toBe(400)
    const badNumber = await kit.put('admin', `/api/departments/${ids.nursing}`, { name: '護理部', organization: ids.orgA, uniformNumber: 'abc' })
    expect(badNumber.status).toBe(400)
    expect(badNumber.body.error).toContain('統一編號需為 8 碼數字')
    const noOrg = await kit.put('admin', `/api/departments/${ids.nursing}`, { name: '護理部', organization: null })
    expect(noOrg.status).toBe(400)
    const blankSub = await kit.put('admin', `/api/sub-departments/${ids.ward}`, { name: '' })
    expect(blankSub.status).toBe(400)
    const badHeadcount = await kit.put('admin', `/api/sub-departments/${ids.ward}`, { headcount: -3 })
    expect(badHeadcount.status).toBe(400)
    const blankOrg = await kit.put('admin', `/api/organizations/${ids.orgA}`, { name: '' })
    expect(blankOrg.status).toBe(400)
    expect((await kit.post('admin', '/api/organizations', { name: '' })).status).toBe(400)
    expect((await kit.post('admin', '/api/organizations', {})).status).toBe(400)

    // 沒有一筆被改壞
    const dept = await models.Department.findById(ids.nursing).lean()
    expect(dept).toMatchObject({ name: '護理部', uniformNumber: '12345678', scheduleNotes: '夜班兩人' })
    expect(String(dept.organization)).toBe(ids.orgA)
    expect((await models.SubDepartment.findById(ids.ward).lean())).toMatchObject({ name: '一樓護理站', headcount: 6 })
    expect((await models.Organization.findById(ids.orgA).lean()).name).toBe('安康護理之家')

    // 只送部分欄位的儲存照常成功，沒送的欄位不動
    const renamed = await kit.put('admin', `/api/departments/${ids.nursing}`, { name: '護理一部' })
    expect(renamed.status).toBe(200)
    expect(renamed.body).toMatchObject({ name: '護理一部', uniformNumber: '12345678', scheduleNotes: '夜班兩人' })
    const sub = await kit.put('admin', `/api/sub-departments/${ids.ward}`, { name: '1F 護理站' })
    expect(sub.status).toBe(200)
    expect(sub.body).toMatchObject({ name: '1F 護理站', headcount: 6 })
  })

  it('moves the employees along when a 部門 changes 機構 or a 小單位 changes 部門', async () => {
    const moved = await kit.put('admin', `/api/departments/${ids.nursing}`, { name: '護理一部', organization: ids.orgB })
    expect(moved.status).toBe(200)
    // 員工資料上的機構跟著部門走：簽核的機構範圍、員工清單與薪資的機構篩選看的是這個欄位
    expect((await models.Employee.findById(kit.id('nurse')).lean()).organization).toBe(ids.orgB)
    // 別的部門的人不動
    expect((await models.Employee.findById(kit.id('clerk')).lean()).organization).toBe(ids.orgA)
    const listed = await kit.get('admin', `/api/employees?organization=${ids.orgB}`)
    expect(listed.status).toBe(200)
    expect(listed.body.employees.map(item => item.name)).toEqual(['nurse'])

    const unitMoved = await kit.put('admin', `/api/sub-departments/${ids.ward}`, { department: ids.admin })
    expect(unitMoved.status).toBe(200)
    const nurse = await models.Employee.findById(kit.id('nurse')).lean()
    expect(String(nurse.department)).toBe(ids.admin)
    expect(nurse.organization).toBe(ids.orgA)
    expect(String(nurse.subDepartment)).toBe(ids.ward)
  })
})
