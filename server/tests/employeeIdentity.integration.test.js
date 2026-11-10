// 員工管理的新增／修改：帳號、Email、員工編號的整理與重複檢查，以及清空欄位真的清掉。真的 Express app + 真的 MongoDB。
// 預設略過；要執行時指定本機的暫用資料庫：
//   APPROVAL_ENGINE_TEST_MONGODB_URI=mongodb://127.0.0.1:27814 npm test -- tests/employeeIdentity.integration.test.js
import { jest } from '@jest/globals'
import { createRealAppKit } from './helpers/realAppKit.js'

const kit = createRealAppKit('employee_identity')

kit.describe('員工新增／修改 against a real MongoDB through the real app', () => {
  jest.setTimeout(120000)
  const { models } = kit
  const create = (body) => kit.post('admin', '/api/employees', { password: 'Initial-Pass-1', role: 'employee', ...body })

  beforeAll(async () => {
    await kit.start()
    await kit.addPerson('admin', { role: 'admin' })
  })

  afterAll(kit.stop)

  it('stores the account without surrounding spaces and the e-mail in lower case', async () => {
    const res = await create({ name: '林雅婷', employeeNo: ' N-001 ', username: '  amy  ', email: 'Amy.Lin@Example.Test' })
    expect(res.status).toBe(201)
    const saved = await models.Employee.findById(res.body._id).lean()
    // 登入時帳號會先去掉空白：存成「  amy  」的帳號永遠登入不了
    expect(saved.username).toBe('amy')
    expect(saved.email).toBe('amy.lin@example.test')
    expect(saved.employeeId).toBe('N-001')
    expect((await create({ name: '只有空白', employeeNo: 'N-00X', username: '   ', email: 'blank@example.test' })).status).toBe(400)
  })

  it('refuses an 員工編號 another employee already has, on create and on rename', async () => {
    const duplicate = await create({ name: '重複編號', employeeNo: 'N-001', username: 'dup', email: 'dup@example.test' })
    expect(duplicate.status).toBe(400)
    expect(duplicate.body.error).toBe('員工編號「N-001」已被其他員工使用，請改用別的編號')
    expect(await models.Employee.countDocuments({ employeeId: 'N-001' })).toBe(1)

    const second = await create({ name: '陳志明', employeeNo: 'N-002', username: 'ming', email: 'ming@example.test' })
    expect(second.status).toBe(201)
    const renamed = await kit.put('admin', `/api/employees/${second.body._id}`, { employeeNo: 'N-001' })
    expect(renamed.status).toBe(400)
    expect(renamed.body.error).toContain('員工編號「N-001」已被其他員工使用')
    // 編號沒變的存檔照常成功
    const same = await kit.put('admin', `/api/employees/${second.body._id}`, { employeeNo: 'N-002', title: '護理師' })
    expect(same.status).toBe(200)
    expect((await models.Employee.findById(second.body._id).lean())).toMatchObject({ employeeId: 'N-002', title: '護理師' })
  })

  it('does not let an edit blank out the name, number or account', async () => {
    const person = await models.Employee.findOne({ employeeId: 'N-002' })
    const id = String(person._id)
    expect((await kit.put('admin', `/api/employees/${id}`, { name: '   ' })).status).toBe(400)
    expect((await kit.put('admin', `/api/employees/${id}`, { employeeNo: '' })).status).toBe(400)
    // 帳號送空白：不寫入、其他欄位照存
    const blankAccount = await kit.put('admin', `/api/employees/${id}`, { username: '', lineId: 'ming-line' })
    expect(blankAccount.status).toBe(200)
    const saved = await models.Employee.findById(id).lean()
    expect(saved).toMatchObject({ name: '陳志明', employeeId: 'N-002', username: 'ming', lineId: 'ming-line' })
  })

  it('refuses a password that is not text before saving anything else', async () => {
    const person = await models.Employee.findOne({ employeeId: 'N-002' })
    const id = String(person._id)
    // 以前其他欄位先存進去、設定密碼時才出錯：畫面顯示失敗，資料卻已經改了一半
    const res = await kit.put('admin', `/api/employees/${id}`, { title: '不該存進去', password: 12345678 })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('密碼格式不正確')
    expect((await models.Employee.findById(id).lean()).title).toBe('護理師')
    const created = await create({ name: '數字密碼', employeeNo: 'N-003', username: 'num', email: 'num@example.test', password: 12345678 })
    expect(created.status).toBe(400)
    expect(await models.Employee.countDocuments({ employeeId: 'N-003' })).toBe(0)
  })

  it('really clears a date the administrator emptied in the edit form', async () => {
    const person = await models.Employee.findOne({ employeeId: 'N-002' })
    const id = String(person._id)
    const filled = await kit.put('admin', `/api/employees/${id}`, { hireDate: '2020-03-01', resignDate: '2026-10-31', birthday: '1990-05-06', height: 168 })
    expect(filled.status).toBe(200)
    expect((await models.Employee.findById(id).lean()).appointment.resignationDate).toEqual(new Date('2026-10-31'))
    // 編輯畫面開啟時讀到的資料帶著這些欄位（畫面顯示的就是存著的值，沒動過的欄位原樣送回不會被清掉）
    const loaded = await kit.get('admin', `/api/employees/${id}`)
    expect(loaded.body.birthday).toBe('1990-05-06T00:00:00.000Z')
    expect(loaded.body.appointment).toMatchObject({ hireDate: '2020-03-01T00:00:00.000Z', resignationDate: '2026-10-31T00:00:00.000Z' })
    expect(loaded.body.medicalCheck.height).toBe(168)

    // 誤填的離職日期清掉（日期選擇器清空送 null）
    const cleared = await kit.put('admin', `/api/employees/${id}`, { hireDate: '2020-03-01', resignDate: null, birthday: '', height: null })
    expect(cleared.status).toBe(200)
    const saved = await models.Employee.findById(id).lean()
    expect(saved.appointment.resignationDate).toBeUndefined()
    expect(saved.birthDate).toBeUndefined()
    expect(saved.medicalCheck?.height).toBeUndefined()
    expect(saved.appointment.hireDate).toEqual(new Date('2020-03-01'))
    // 回給畫面的資料也沒有離職日期
    const detail = await kit.get('admin', `/api/employees/${id}`)
    expect(detail.body.appointment?.resignationDate ?? null).toBeNull()
  })
})
