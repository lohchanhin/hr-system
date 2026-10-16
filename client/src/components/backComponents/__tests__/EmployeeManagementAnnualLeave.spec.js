import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import * as apiModule from '../../../api'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  ElMessageBox: {
    confirm: vi.fn(() => Promise.resolve()),
    prompt: vi.fn(() => Promise.resolve()),
    alert: vi.fn(() => Promise.resolve())
  }
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

import EmployeeManagement from '../EmployeeManagement.vue'

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

const elStubs = [
  'el-table', 'el-table-column', 'el-button', 'el-tabs', 'el-tab-pane', 'el-form', 'el-form-item',
  'el-input', 'el-select', 'el-option', 'el-dialog', 'el-avatar', 'el-tag', 'el-radio', 'el-radio-group',
  'el-date-picker', 'el-input-number', 'el-upload', 'el-switch', 'el-alert', 'el-pagination'
]

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })

// 伺服器上的員工資料（測試中途可以改，模擬「視窗開著的時候簽核核准了特休」）
let server
const baseEmployee = () => ({
  _id: 'e1',
  name: '王大明',
  employeeId: 'E001',
  username: 'wang',
  email: 'wang@example.com',
  gender: 'M',
  role: 'employee',
  organization: 'org1',
  department: 'dep1',
  signTags: [],
  status: '正職員工',
  annualLeave: {
    totalHours: 80,
    usedHours: 0,
    year: 2026,
    accumulatedLeave: 0,
    compensatoryHours: 0,
    notes: '',
    appliedApprovalRequestIds: ['64b7f0f0f0f0f0f0f0f0a001']
  }
})

describe('EmployeeManagement - 特休已使用時數不會被舊的編輯視窗蓋回去', () => {
  let apiFetchMock
  let wrapper

  const writeCalls = (method) => apiFetchMock.mock.calls.filter(([, options]) => options?.method === method)
  const putAnnualLeave = () => JSON.parse(writeCalls('PUT').at(-1)[1].body).annualLeave

  async function mountAndOpen(employeeId = 'e1') {
    wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    await flushPromises()
    wrapper.vm.formRef = { validate: vi.fn(() => Promise.resolve(true)), clearValidate: vi.fn() }
    if (employeeId) await wrapper.vm.openEmployeeDialog(employeeId)
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    server = { employee: baseEmployee() }
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url, options = {}) => {
      const path = String(url).split('?')[0]
      const method = options.method || 'GET'
      if (method !== 'GET') return ok({ _id: 'e1' })
      if (path === '/api/employees/e1') return ok(JSON.parse(JSON.stringify(server.employee)))
      if (path === '/api/employees') {
        return ok({
          employees: [JSON.parse(JSON.stringify(server.employee))],
          pagination: { total: 1, page: 1, pageSize: 20, totalPages: 1 }
        })
      }
      if (path === '/api/employees/sign-tags') return ok({ tags: [] })
      if (path === '/api/other-control-settings/item-settings') return ok({ itemSettings: {} })
      return ok([])
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    apiFetchMock.mockRestore()
  })

  it('打開視窗後，簽核核准扣了 8 小時；管理員只改別的欄位儲存：不送 usedHours 也不送 appliedApprovalRequestIds', async () => {
    await mountAndOpen()
    expect(wrapper.vm.employeeForm.annualLeave.usedHours).toBe(0)

    // 視窗開著的時候，一張 8 小時的特休核准了：伺服器上 usedHours = 8
    server.employee.annualLeave.usedHours = 8
    server.employee.annualLeave.appliedApprovalRequestIds.push('64b7f0f0f0f0f0f0f0f0a002')

    wrapper.vm.employeeForm.name = '王大明（改名）'
    wrapper.vm.employeeForm.annualLeave.notes = '只改備註'
    await wrapper.vm.saveEmployee()
    await flushPromises()

    expect(writeCalls('PUT')).toHaveLength(1)
    const annualLeave = putAnnualLeave()
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedHours')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedHoursBase')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'appliedApprovalRequestIds')).toBe(false)
    // 其他特休欄位維持原本的行為：照樣送出
    expect(annualLeave).toMatchObject({ totalHours: 80, year: 2026, accumulatedLeave: 0, compensatoryHours: 0, notes: '只改備註' })
    // 舊的天數欄位與伺服器換算的欄位永遠不送回去（伺服器會把送來的天數乘 8 當成時數）
    for (const key of ['totalDays', 'usedDays', 'remainingHours', 'remainingDays', 'unitSource']) {
      expect(Object.prototype.hasOwnProperty.call(annualLeave, key)).toBe(false)
    }
    expect(JSON.parse(writeCalls('PUT')[0][1].body).name).toBe('王大明（改名）')
  })

  it('管理員真的改了已使用時數：送出新的 usedHours，並附上打開視窗時的值 usedHoursBase', async () => {
    await mountAndOpen()
    server.employee.annualLeave.usedHours = 8 // 視窗開著時被簽核扣了 8 小時

    wrapper.vm.employeeForm.annualLeave.usedHours = 24
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(annualLeave.usedHours).toBe(24)
    expect(annualLeave.usedHoursBase).toBe(0)
    // appliedApprovalRequestIds 永遠不從編輯表單寫入
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'appliedApprovalRequestIds')).toBe(false)
    expect(annualLeave.totalHours).toBe(80)
  })

  it('管理員清空欄位（null）也算改過：以 0 送出，base 是原本的時數', async () => {
    server.employee.annualLeave.usedHours = 32
    await mountAndOpen()

    wrapper.vm.employeeForm.annualLeave.usedHours = null
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(annualLeave.usedHours).toBe(0)
    expect(annualLeave.usedHoursBase).toBe(32)
  })

  it('改了又改回原本的數字，等於沒改：不送', async () => {
    await mountAndOpen()
    wrapper.vm.employeeForm.annualLeave.usedHours = 40
    wrapper.vm.employeeForm.annualLeave.usedHours = 0
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedHours')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedHoursBase')).toBe(false)
  })

  it('員工原本沒有特休資料時，預設的 0 也不當成管理員要寫入的值', async () => {
    delete server.employee.annualLeave
    await mountAndOpen()
    expect(wrapper.vm.employeeForm.annualLeave.usedHours).toBe(0)

    wrapper.vm.employeeForm.annualLeave.totalHours = 56
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(annualLeave.totalHours).toBe(56)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedHours')).toBe(false)
  })

  it('每次重新打開視窗都以當下的值為準', async () => {
    await mountAndOpen()
    server.employee.annualLeave.usedHours = 16
    await wrapper.vm.openEmployeeDialog('e1')
    await flushPromises()
    expect(wrapper.vm.employeeForm.annualLeave.usedHours).toBe(16)

    wrapper.vm.employeeForm.annualLeave.usedHours = 32
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(annualLeave.usedHours).toBe(32)
    expect(annualLeave.usedHoursBase).toBe(16)
  })

  // 行為有意改變：有新照片時，整份資料放在 multipart 的 data 欄位（JSON 字串），照片放在 photo 欄位；
  // 不再把每個欄位各自放進 FormData（原本 annualLeave 是獨立的 JSON 字串欄位）
  it('有新照片改用 multipart 時，特休欄位同樣只在管理員改過時才帶 usedHours', async () => {
    await mountAndOpen()
    server.employee.annualLeave.usedHours = 8
    wrapper.vm.employeeForm.photoList = [{ name: 'p.png', raw: new File(['x'], 'p.png', { type: 'image/png' }) }]

    await wrapper.vm.saveEmployee()
    await flushPromises()

    expect(writeCalls('PUT')).toHaveLength(1)
    const call = writeCalls('PUT').at(-1)
    expect(call[1].body).toBeInstanceOf(FormData)
    expect([...call[1].body.keys()]).toEqual(['data', 'photo'])
    expect(call[1].body.get('photo')).toBeInstanceOf(File)
    const annualLeave = JSON.parse(call[1].body.get('data')).annualLeave
    expect(annualLeave.totalHours).toBe(80)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedHours')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'appliedApprovalRequestIds')).toBe(false)

    // 同一個視窗：改過才帶，而且附上 base
    wrapper.vm.employeeForm.annualLeave.usedHours = 48
    wrapper.vm.employeeForm.photoList = [{ name: 'p.png', raw: new File(['x'], 'p.png', { type: 'image/png' }) }]
    await wrapper.vm.saveEmployee()
    await flushPromises()
    const changed = JSON.parse(writeCalls('PUT').at(-1)[1].body.get('data')).annualLeave
    expect(changed.usedHours).toBe(48)
    expect(changed.usedHoursBase).toBe(0)
  })

  it('新增員工維持原本的行為：整包特休資料照送，不帶 usedHoursBase', async () => {
    await mountAndOpen(null)
    await wrapper.vm.openEmployeeDialog()
    await flushPromises()
    Object.assign(wrapper.vm.employeeForm, {
      username: 'new-user',
      password: 'secret',
      name: '新員工',
      email: 'new@example.com',
      gender: 'F',
      organization: 'org1',
      department: 'dep1'
    })
    wrapper.vm.employeeForm.annualLeave.totalHours = 40

    await wrapper.vm.saveEmployee()
    await flushPromises()

    expect(writeCalls('PUT')).toHaveLength(0)
    const post = writeCalls('POST').at(-1)
    expect(post[0]).toBe('/api/employees')
    const annualLeave = JSON.parse(post[1].body).annualLeave
    expect(annualLeave).toMatchObject({ totalHours: 40, usedHours: 0 })
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedHoursBase')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'totalDays')).toBe(false)
  })
})

// 特休一律用小時顯示與編輯：舊格式（只有天數）的資料在畫面上換算，已被判定為「原本就是小時」的要請管理員確認
describe('EmployeeManagement - 特休以小時顯示（舊天數資料、單位確認、剩餘時數）', () => {
  let apiFetchMock
  let wrapper

  const writeCalls = (method) => apiFetchMock.mock.calls.filter(([, options]) => options?.method === method)
  const putAnnualLeave = () => JSON.parse(writeCalls('PUT').at(-1)[1].body).annualLeave

  // 編輯視窗的內容要真的畫出來才看得到提醒：容器元件直接顯示內容，其餘維持原本的 stub
  const passThrough = { template: '<div><slot name="title" /><slot /></div>' }
  const renderedStubs = {
    ...Object.fromEntries(elStubs.map(name => [name, true])),
    'el-dialog': passThrough,
    'el-tabs': passThrough,
    'el-tab-pane': passThrough,
    'el-form': {
      template: '<div><slot /></div>',
      methods: { validate: () => Promise.resolve(true), validateField: () => Promise.resolve(true), clearValidate() {}, resetFields() {} }
    },
    'el-alert': passThrough
  }

  async function mountAndOpen(employeeId = 'e1') {
    wrapper = mount(EmployeeManagement, { global: { stubs: renderedStubs } })
    await flushPromises()
    wrapper.vm.formRef = { validate: vi.fn(() => Promise.resolve(true)), clearValidate: vi.fn() }
    if (employeeId) await wrapper.vm.openEmployeeDialog(employeeId)
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    server = { employee: baseEmployee() }
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url, options = {}) => {
      const path = String(url).split('?')[0]
      const method = options.method || 'GET'
      if (method !== 'GET') return ok({ _id: 'e1' })
      if (path === '/api/employees/e1') return ok(JSON.parse(JSON.stringify(server.employee)))
      if (path === '/api/employees') {
        return ok({
          employees: [JSON.parse(JSON.stringify(server.employee))],
          pagination: { total: 1, page: 1, pageSize: 20, totalPages: 1 }
        })
      }
      if (path === '/api/employees/sign-tags') return ok({ tags: [] })
      if (path === '/api/other-control-settings/item-settings') return ok({ itemSettings: {} })
      return ok([])
    })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    apiFetchMock.mockRestore()
  })

  it('還沒轉成小時的舊資料（只有天數欄位）：編輯視窗直接顯示小時，儲存時不送舊的天數欄位', async () => {
    server.employee.annualLeave = { totalDays: 10, usedDays: 2, year: 2026, notes: '舊資料' }
    await mountAndOpen()

    const form = wrapper.vm.employeeForm.annualLeave
    expect(form.totalHours).toBe(80)
    expect(form.usedHours).toBe(16)
    expect(Object.prototype.hasOwnProperty.call(form, 'totalDays')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(form, 'usedDays')).toBe(false)
    expect(wrapper.vm.annualLeaveRemainingHours(form)).toBe(64)
    expect(wrapper.vm.annualLeaveDaysText(64)).toBe('8')

    wrapper.vm.employeeForm.annualLeave.notes = '改備註'
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(annualLeave.totalHours).toBe(80)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedHours')).toBe(false)
    for (const key of ['totalDays', 'usedDays', 'remainingHours', 'remainingDays', 'unitSource']) {
      expect(Object.prototype.hasOwnProperty.call(annualLeave, key)).toBe(false)
    }
  })

  it('舊資料的數字超過 40（判定為本來就是小時）：視窗顯示確認提醒，勾選確認後才送 unitConfirmed', async () => {
    server.employee.annualLeave = { totalHours: 120, usedHours: 0, unitSource: 'migrated-hours', year: 2026 }
    await mountAndOpen()

    expect(wrapper.vm.employeeForm.annualLeave.totalHours).toBe(120)
    expect(wrapper.find('.annual-leave-unit-warning').exists()).toBe(true)

    // 沒勾選就儲存：不帶 unitConfirmed（伺服器保留「待確認」的標記），unitSource 是唯讀欄位不送
    await wrapper.vm.saveEmployee()
    await flushPromises()
    let annualLeave = putAnnualLeave()
    expect(annualLeave.totalHours).toBe(120)
    expect(annualLeave.unitConfirmed).toBeFalsy()
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'unitSource')).toBe(false)

    wrapper.vm.employeeForm.annualLeave.unitConfirmed = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.annual-leave-unit-warning').exists()).toBe(false)
    await wrapper.vm.saveEmployee()
    await flushPromises()
    annualLeave = putAnnualLeave()
    expect(annualLeave.unitConfirmed).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'unitSource')).toBe(false)
  })

  it('小時資料或舊天數資料換算成天數的小數：不出現提醒（只有判定為小時才提醒）', async () => {
    server.employee.annualLeave = { totalDays: 14, usedDays: 0, unitSource: 'migrated-days', year: 2026 }
    await mountAndOpen()
    expect(wrapper.vm.employeeForm.annualLeave.totalHours).toBe(112)
    expect(wrapper.find('.annual-leave-unit-warning').exists()).toBe(false)
  })

  it('剩餘時數：伺服器有給就用伺服器的（不會小於 0），沒給就用總時數減已使用時數；天數是小時除以 8', async () => {
    await mountAndOpen(null)
    const remaining = wrapper.vm.annualLeaveRemainingHours
    expect(remaining({ totalHours: 80, usedHours: 24 })).toBe(56)
    expect(remaining({ totalHours: 80, usedHours: 24, remainingHours: 50 })).toBe(50)
    expect(remaining({ totalHours: 16, usedHours: 24 })).toBe(0)
    expect(remaining({ totalHours: 16, usedHours: 24, remainingHours: -8 })).toBe(0)
    expect(remaining(null)).toBe(0)
    expect(remaining({})).toBe(0)

    expect(wrapper.vm.annualLeaveDaysText(60)).toBe('7.5')
    expect(wrapper.vm.annualLeaveDaysText(0)).toBe('0')
    expect(wrapper.vm.annualLeaveDaysText(undefined)).toBe('0')
    expect(wrapper.vm.annualLeaveDaysText('abc')).toBe('0')
  })

  it('員工列表的資料也先換算成小時（沒有特休資料的員工不受影響）', async () => {
    server.employee.annualLeave = { totalDays: 5, usedDays: 1 }
    wrapper = mount(EmployeeManagement, { global: { stubs: elStubs } })
    await flushPromises()

    const row = wrapper.vm.employeeList.find(item => item._id === 'e1')
    expect(row.annualLeave.totalHours).toBe(40)
    expect(row.annualLeave.usedHours).toBe(8)
    expect(wrapper.vm.annualLeaveRemainingHours(row.annualLeave)).toBe(32)

    expect(wrapper.vm.normalizeEmployeeRecord({ _id: 'x', name: '無特休' }).annualLeave).toBeUndefined()
  })
})
