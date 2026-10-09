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
    totalDays: 10,
    usedDays: 0,
    year: 2026,
    accumulatedLeave: 0,
    compensatoryHours: 0,
    notes: '',
    appliedApprovalRequestIds: ['64b7f0f0f0f0f0f0f0f0a001']
  }
})

describe('EmployeeManagement - 特休已使用天數不會被舊的編輯視窗蓋回去', () => {
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

  it('打開視窗後，簽核核准扣了 1 天；管理員只改別的欄位儲存：不送 usedDays 也不送 appliedApprovalRequestIds', async () => {
    await mountAndOpen()
    expect(wrapper.vm.employeeForm.annualLeave.usedDays).toBe(0)

    // 視窗開著的時候，一張 1 天的特休核准了：伺服器上 usedDays = 1
    server.employee.annualLeave.usedDays = 1
    server.employee.annualLeave.appliedApprovalRequestIds.push('64b7f0f0f0f0f0f0f0f0a002')

    wrapper.vm.employeeForm.name = '王大明（改名）'
    wrapper.vm.employeeForm.annualLeave.notes = '只改備註'
    await wrapper.vm.saveEmployee()
    await flushPromises()

    expect(writeCalls('PUT')).toHaveLength(1)
    const annualLeave = putAnnualLeave()
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedDays')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedDaysBase')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'appliedApprovalRequestIds')).toBe(false)
    // 其他特休欄位維持原本的行為：照樣送出
    expect(annualLeave).toMatchObject({ totalDays: 10, year: 2026, accumulatedLeave: 0, compensatoryHours: 0, notes: '只改備註' })
    expect(JSON.parse(writeCalls('PUT')[0][1].body).name).toBe('王大明（改名）')
  })

  it('管理員真的改了已使用天數：送出新的 usedDays，並附上打開視窗時的值 usedDaysBase', async () => {
    await mountAndOpen()
    server.employee.annualLeave.usedDays = 1 // 視窗開著時被簽核扣了 1 天

    wrapper.vm.employeeForm.annualLeave.usedDays = 3
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(annualLeave.usedDays).toBe(3)
    expect(annualLeave.usedDaysBase).toBe(0)
    // appliedApprovalRequestIds 永遠不從編輯表單寫入
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'appliedApprovalRequestIds')).toBe(false)
    expect(annualLeave.totalDays).toBe(10)
  })

  it('管理員清空欄位（null）也算改過：以 0 送出，base 是原本的天數', async () => {
    server.employee.annualLeave.usedDays = 4
    await mountAndOpen()

    wrapper.vm.employeeForm.annualLeave.usedDays = null
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(annualLeave.usedDays).toBe(0)
    expect(annualLeave.usedDaysBase).toBe(4)
  })

  it('改了又改回原本的數字，等於沒改：不送', async () => {
    await mountAndOpen()
    wrapper.vm.employeeForm.annualLeave.usedDays = 5
    wrapper.vm.employeeForm.annualLeave.usedDays = 0
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedDays')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedDaysBase')).toBe(false)
  })

  it('員工原本沒有特休資料時，預設的 0 也不當成管理員要寫入的值', async () => {
    delete server.employee.annualLeave
    await mountAndOpen()
    expect(wrapper.vm.employeeForm.annualLeave.usedDays).toBe(0)

    wrapper.vm.employeeForm.annualLeave.totalDays = 7
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(annualLeave.totalDays).toBe(7)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedDays')).toBe(false)
  })

  it('每次重新打開視窗都以當下的值為準', async () => {
    await mountAndOpen()
    server.employee.annualLeave.usedDays = 2
    await wrapper.vm.openEmployeeDialog('e1')
    await flushPromises()
    expect(wrapper.vm.employeeForm.annualLeave.usedDays).toBe(2)

    wrapper.vm.employeeForm.annualLeave.usedDays = 4
    await wrapper.vm.saveEmployee()
    await flushPromises()

    const annualLeave = putAnnualLeave()
    expect(annualLeave.usedDays).toBe(4)
    expect(annualLeave.usedDaysBase).toBe(2)
  })

  it('有新照片改用 multipart 時，特休欄位同樣只在管理員改過時才帶 usedDays', async () => {
    await mountAndOpen()
    server.employee.annualLeave.usedDays = 1
    wrapper.vm.employeeForm.photoList = [{ name: 'p.png', raw: new File(['x'], 'p.png', { type: 'image/png' }) }]

    await wrapper.vm.saveEmployee()
    await flushPromises()

    const call = writeCalls('PUT').at(-1)
    expect(call[1].body).toBeInstanceOf(FormData)
    const annualLeave = JSON.parse(call[1].body.get('annualLeave'))
    expect(annualLeave.totalDays).toBe(10)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedDays')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'appliedApprovalRequestIds')).toBe(false)

    // 同一個視窗：改過才帶，而且附上 base
    wrapper.vm.employeeForm.annualLeave.usedDays = 6
    wrapper.vm.employeeForm.photoList = [{ name: 'p.png', raw: new File(['x'], 'p.png', { type: 'image/png' }) }]
    await wrapper.vm.saveEmployee()
    await flushPromises()
    const changed = JSON.parse(writeCalls('PUT').at(-1)[1].body.get('annualLeave'))
    expect(changed.usedDays).toBe(6)
    expect(changed.usedDaysBase).toBe(0)
  })

  it('新增員工維持原本的行為：整包特休資料照送，不帶 usedDaysBase', async () => {
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
    wrapper.vm.employeeForm.annualLeave.totalDays = 5

    await wrapper.vm.saveEmployee()
    await flushPromises()

    expect(writeCalls('PUT')).toHaveLength(0)
    const post = writeCalls('POST').at(-1)
    expect(post[0]).toBe('/api/employees')
    const annualLeave = JSON.parse(post[1].body).annualLeave
    expect(annualLeave).toMatchObject({ totalDays: 5, usedDays: 0 })
    expect(Object.prototype.hasOwnProperty.call(annualLeave, 'usedDaysBase')).toBe(false)
  })
})
