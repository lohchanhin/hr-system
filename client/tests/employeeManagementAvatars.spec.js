import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import ElementPlus, { ElTabs } from 'element-plus'
import * as apiModule from '../src/api'
import { clearEmployeePhotoCache } from '../src/utils/photoUrl'

// 人資管理（EmployeeManagement.vue）的頭像：員工資料的「直屬主管」欄位收起來時也顯示主管的頭像；
// 批量匯入的匯入預覽是匯入前確認用的資料（人可能還不存在），不放頭像。
// 掛的是真正的 Element Plus，照片請求換成假伺服器。

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ name: '' }),
}))

import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'

// 掛的是整個員工編輯視窗，機器忙的時候一個測試可能超過預設的 10 秒
vi.setConfig({ testTimeout: 60000, hookTimeout: 30000 })

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) await tick()
}

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const copy = value => JSON.parse(JSON.stringify(value))
const PHOTO = id => `/upload/employees/employee_${id}.png`

let server
let apiFetchMock
let blobCounter
let wrapper
let management

function baseEmployee(overrides = {}) {
  return {
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
    accountEnabled: true,
    photo: '',
    ...overrides,
  }
}

function resetServer() {
  server = {
    employees: [],
    // 員工 id -> 伺服器上有的照片檔名（沒列在這裡的員工要照片就是 404）
    photoOf: {},
    photoRequests: [],
  }
}

function installServer() {
  apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url, options = {}) => {
    const [path, query = ''] = String(url).split('?')
    const method = options.method || 'GET'

    const photoMatch = path.match(/^\/api\/employees\/([^/]+)\/photo$/)
    if (photoMatch && method === 'GET') {
      server.photoRequests.push({ id: photoMatch[1], query })
      const name = server.photoOf[photoMatch[1]]
      if (!name) return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) }
      return { ok: true, status: 200, blob: async () => ({ type: 'image/png', size: 8, name }) }
    }

    if (path === '/api/employees' && method === 'GET') {
      const role = new URLSearchParams(query).get('role')
      const department = new URLSearchParams(query).get('department')
      const employees = server.employees.filter(item => (!role || item.role === role) && (!department || item.department === department))
      return ok({ employees: copy(employees), pagination: { total: employees.length, page: 1, pageSize: 20, totalPages: 1 } })
    }

    const employeeMatch = path.match(/^\/api\/employees\/([^/]+)$/)
    if (employeeMatch && method === 'GET') {
      const employee = server.employees.find(item => item._id === employeeMatch[1])
      return employee ? ok(copy(employee)) : ok({ error: 'Not found' }, 404)
    }
    if (path === '/api/employees/sign-tags') return ok({ tags: [] })
    if (path === '/api/other-control-settings/item-settings') return ok({ itemSettings: {} })
    return ok([])
  })
}

// EmployeeManagement 的根是 el-tab-pane，必須放在 el-tabs 裡面
async function mountManagement() {
  const Host = { render: () => h(ElTabs, { modelValue: 'employeeMgmt' }, () => [h(EmployeeManagement)]) }
  wrapper = mount(Host, { global: { plugins: [ElementPlus, createPinia()] }, attachTo: document.body })
  management = wrapper.findComponent(EmployeeManagement)
  await flush()
  return management
}

beforeEach(() => {
  resetServer()
  blobCounter = 0
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      blobCounter += 1
      return `blob:management-${blobCounter}`
    }),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  setActivePinia(createPinia())
  clearEmployeePhotoCache()
  installServer()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  apiFetchMock.mockRestore()
  clearEmployeePhotoCache()
})

describe('員工資料的直屬主管欄位', () => {
  function seedEmployees({ supervisorDepartment = 'dep1', supervisorPhoto = PHOTO('s1'), supervisorRef } = {}) {
    server.employees = [
      baseEmployee({ supervisor: supervisorRef ?? { _id: 's1', name: '林主任', employeeId: 'S001' } }),
      baseEmployee({ _id: 's1', name: '林主任', employeeId: 'S001', username: 'lin', role: 'supervisor', department: supervisorDepartment, photo: supervisorPhoto }),
    ]
    server.photoOf = supervisorPhoto ? { s1: 'employee_s1.png' } : {}
  }

  async function openEmployeeDialog() {
    await mountManagement()
    await management.vm.openEmployeeDialog('e1')
    await flush()
  }

  it('同部門的主管：收起來的選單也顯示主管的頭像，和選項共用同一份縮圖（20px 要 48px）', async () => {
    seedEmployees()
    await openEmployeeDialog()

    expect(management.vm.employeeForm.supervisor).toBe('s1')
    expect(management.vm.supervisorList).toEqual([
      { _id: 's1', name: '林主任', employeeNo: 'S001', photo: PHOTO('s1') },
    ])
    const selected = document.body.querySelector('.el-select__placeholder .supervisor-option')
    expect(selected).toBeTruthy()
    expect(selected.textContent).toContain('林主任（S001）')
    expect(selected.querySelector('img')?.getAttribute('src')).toMatch(/^blob:management-/)
    expect(selected.querySelector('.el-avatar').getAttribute('aria-label')).toBe('林主任的頭像')
    // 員工列表自己的頭像（40px）要 96px 的縮圖；選單裡的 20px 頭像要 48px 的縮圖，各一份
    expect(server.photoRequests.filter(request => request.id === 's1').map(request => request.query).sort()).toEqual([
      'v=employee_s1.png&size=48',
      'v=employee_s1.png&size=96',
    ])
  })

  it('主管沒有照片：顯示姓名第一個字，不發照片請求', async () => {
    seedEmployees({ supervisorPhoto: '' })
    await openEmployeeDialog()

    const selected = document.body.querySelector('.el-select__placeholder .supervisor-option')
    expect(selected.querySelector('img')).toBeNull()
    expect(selected.querySelector('.el-avatar').textContent.trim()).toBe('林')
    expect(server.photoRequests.filter(request => request.id === 's1')).toEqual([])
  })

  it('主管在別的部門（不在候選名單）：選單裡只有員工資料帶的姓名，頭像是字母，不為它另外發照片請求', async () => {
    seedEmployees({ supervisorDepartment: 'dep2' })
    await openEmployeeDialog()

    expect(management.vm.supervisorList).toEqual([
      { _id: 's1', name: '林主任', employeeNo: 'S001', photo: '' },
    ])
    const selected = document.body.querySelector('.el-select__placeholder .supervisor-option')
    expect(selected.textContent).toContain('林主任（S001）')
    expect(selected.querySelector('.el-avatar').textContent.trim()).toBe('林')
    // 員工列表裡的主管有照片（40px 的頭像要了一份 96px 的縮圖），選單裡的 20px 頭像沒有為它發 48px 的請求
    expect(server.photoRequests.filter(request => request.id === 's1' && request.query.endsWith('size=48'))).toEqual([])
  })
})

describe('批量匯入的匯入預覽', () => {
  it('預覽表格是匯入前確認用的資料（人可能還不存在）：沒有頭像，也不為預覽發任何照片請求', async () => {
    server.employees = [baseEmployee({ _id: 'e9', name: '名單上的人', employeeId: 'E009' })]
    server.photoOf = { e2: 'employee_old.png' }
    await mountManagement()
    management.vm.openBulkImportDialog()
    await flush()
    management.vm.bulkImportPreview = [
      { action: 'created', id: 'n1', photo: '', employeeNo: 'E100', name: '新同事', department: '人資部', role: 'employee', email: 'new@example.com' },
      { action: 'updated', id: 'e2', photo: PHOTO('old'), employeeNo: 'E002', name: '李小華', department: '內科', role: 'employee', email: 'lee@example.com' },
    ]
    await flush()

    const previewRows = [...document.body.querySelectorAll('.el-table__row')].filter(row => row.textContent.includes('E100') || row.textContent.includes('E002'))
    expect(previewRows).toHaveLength(2)
    expect(previewRows[0].textContent).toContain('新同事')
    expect(previewRows[1].textContent).toContain('李小華')
    previewRows.forEach(row => expect(row.querySelector('.el-avatar')).toBeNull())
    expect(server.photoRequests).toEqual([])
  })
})
