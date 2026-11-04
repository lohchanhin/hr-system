import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { h } from 'vue'
import ElementPlus, { ElTabs } from 'element-plus'
import * as apiModule from '../src/api'
import { clearEmployeePhotoCache } from '../src/utils/photoUrl'

// 員工管理的「直屬主管」（docs/approval-supervisor-chain.md）：主管鏈要能把別的部門、別的機構的人設成直屬主管
// （康協員工的主管是另一個機構的總幹事、各機構主任的主管是醫療副院長）。
// 沒有輸入時和以前一樣只列同機構同部門的主管；輸入姓名或員工編號時搜尋全部員工，
// 同部門的主管排最前面，選項旁顯示機構／部門，本人、離職、留職停薪、帳號停用的人不列出。
// 回應照伺服器 GET /api/employees（管理員）的形狀：{ employees, pagination }，organization 是機構 _id 字串、department 是部門 _id。

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useRoute: () => ({ name: '' }),
}))

import EmployeeManagement from '../src/components/backComponents/EmployeeManagement.vue'

vi.setConfig({ testTimeout: 60000, hookTimeout: 30000 })

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) await tick()
}

const ok = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const copy = value => JSON.parse(JSON.stringify(value))

const ORG_HOME = '6900000000000000000000a1' // 迦南康復之家
const ORG_ASSOC = '6900000000000000000000a2' // 康協
const ORG_ADMIN = '6900000000000000000000a3' // 體系行政
const DEPT_HOME = '6900000000000000000000d1'
const DEPT_ASSOC = '6900000000000000000000d2'
const DEPT_SEAT = '6900000000000000000000d3'

let server
let apiFetchMock
let wrapper
let management

function person(overrides = {}) {
  return {
    _id: 'x', name: '員工', employeeId: 'X0000', username: 'x', email: 'x@example.com', gender: 'M', role: 'employee',
    organization: ORG_ASSOC, department: DEPT_ASSOC, signTags: [], status: '正職員工', accountEnabled: true, photo: '', ...overrides,
  }
}

function resetServer() {
  server = {
    employees: [
      person({ _id: 'c1', name: '社工甲', employeeId: 'C0092', username: 'c1', supervisor: { _id: 'c33', name: '督導乙', employeeId: 'C0033' } }),
      person({ _id: 'c33', name: '督導乙', employeeId: 'C0033', username: 'c33', role: 'supervisor' }),
      person({ _id: 'c34', name: '督導丙', employeeId: 'C0112', username: 'c34', role: 'supervisor' }),
      person({ _id: 'a2', name: '總幹事丁', employeeId: 'A0002', username: 'a2', role: 'supervisor', organization: ORG_HOME, department: DEPT_HOME }),
      person({ _id: 'a9', name: '總務戊', employeeId: 'A0069', username: 'a9', organization: ORG_ADMIN, department: DEPT_SEAT }),
      person({ _id: 'gone', name: '離職己', employeeId: 'A0099', username: 'gone', status: '離職員工', organization: ORG_HOME, department: DEPT_HOME }),
      person({ _id: 'off', name: '停用庚', employeeId: 'A0098', username: 'off', accountEnabled: false, organization: ORG_HOME, department: DEPT_HOME }),
    ],
    searches: [],
  }
}

function installServer() {
  apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (url, options = {}) => {
    const [path, query = ''] = String(url).split('?')
    const method = options.method || 'GET'
    const params = new URLSearchParams(query)
    if (path === '/api/employees' && method === 'GET') {
      const role = params.get('role')
      const department = params.get('department')
      const search = params.get('search')
      if (search) server.searches.push({ search, pageSize: params.get('pageSize') })
      const employees = server.employees.filter(item => (
        (!role || item.role === role)
        && (!department || item.department === department)
        && (!search || item.name.includes(search) || item.employeeId.includes(search))
      ))
      return ok({ employees: copy(employees), pagination: { total: employees.length, page: 1, pageSize: 20, totalPages: 1 } })
    }
    const employeeMatch = path.match(/^\/api\/employees\/([^/]+)$/)
    if (employeeMatch && method === 'GET') {
      const employee = server.employees.find(item => item._id === employeeMatch[1])
      return employee ? ok(copy(employee)) : ok({ error: 'Not found' }, 404)
    }
    if (path === '/api/organizations') return ok([{ _id: ORG_HOME, name: '迦南康復之家' }, { _id: ORG_ASSOC, name: '康協' }, { _id: ORG_ADMIN, name: '體系行政' }])
    if (path === '/api/departments') {
      return ok([
        { _id: DEPT_HOME, name: '主任室', organization: ORG_HOME },
        { _id: DEPT_ASSOC, name: '社區資源組', organization: ORG_ASSOC },
        { _id: DEPT_SEAT, name: '總務組', organization: ORG_ADMIN },
      ])
    }
    if (path === '/api/employees/sign-tags') return ok({ tags: [] })
    if (path === '/api/other-control-settings/item-settings') return ok({ itemSettings: {} })
    if (/^\/api\/employees\/[^/]+\/photo$/.test(path)) return { ok: false, status: 404, json: async () => ({}) }
    return ok([])
  })
}

async function mountManagement() {
  const Host = { render: () => h(ElTabs, { modelValue: 'employeeMgmt' }, () => [h(EmployeeManagement)]) }
  wrapper = mount(Host, { global: { plugins: [ElementPlus, createPinia()] }, attachTo: document.body })
  management = wrapper.findComponent(EmployeeManagement)
  await flush()
  return management
}

async function openEmployee(id) {
  await mountManagement()
  await management.vm.openEmployeeDialog(id)
  await flush()
}

beforeEach(() => {
  resetServer()
  localStorage.clear()
  sessionStorage.clear()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:picker') })
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

describe('員工管理的直屬主管：可以選任何部門、機構的在職員工', () => {
  it('lists only the supervisors of the same 機構 + 部門 before anything is typed (as before)', async () => {
    await openEmployee('c1')

    expect(management.vm.employeeForm.supervisor).toBe('c33')
    expect(management.vm.supervisorList.map(item => item._id)).toEqual(['c33', 'c34'])
    expect(server.searches).toEqual([])
  })

  it('searches every employee by name or number, same-department supervisors first, with 機構／部門 next to each name', async () => {
    await openEmployee('c1')

    await management.vm.searchSupervisors('A00')
    await flush()

    expect(server.searches).toEqual([{ search: 'A00', pageSize: '50' }])
    // 離職、帳號停用的人不列出；目前的主管（同部門）仍留在選項裡，選單收起來時才找得到姓名
    expect(management.vm.supervisorList.map(item => item._id)).toEqual(['a2', 'a9', 'c33'])
    expect(management.vm.supervisorList.map(item => management.vm.supervisorUnitLabel(item))).toEqual([
      '迦南康復之家／主任室', '體系行政／總務組', '康協／社區資源組',
    ])

    await management.vm.searchSupervisors('督導')
    await flush()
    expect(management.vm.supervisorList.map(item => item._id)).toEqual(['c33', 'c34'])
  })

  it('never offers the employee being edited, and goes back to the default list when the box is cleared or closed', async () => {
    await openEmployee('c33')

    await management.vm.searchSupervisors('督導')
    await flush()
    expect(management.vm.supervisorList.map(item => item._id)).toEqual(['c34'])

    // 清空搜尋：回到和以前一樣的同部門主管名單
    await management.vm.searchSupervisors('')
    await flush()
    expect(management.vm.supervisorSearch.query).toBe('')
    expect(management.vm.supervisorList.map(item => item._id)).toEqual(['c33', 'c34'])

    await management.vm.searchSupervisors('總幹事')
    await flush()
    expect(management.vm.supervisorList.map(item => item._id)).toEqual(['a2'])
    management.vm.handleSupervisorDropdown(false)
    await flush()
    expect(management.vm.supervisorSearch).toEqual({ query: '', results: [], loading: false })
  })

  it('shows the 機構／部門 next to a supervisor of another 機構, and keeps the chosen name when the list closes', async () => {
    await openEmployee('c1')
    await management.vm.searchSupervisors('總幹事')
    await flush()
    management.vm.employeeForm.supervisor = 'a2'
    await flush()

    // 選項：頭像、姓名（員工編號），右邊是機構／部門
    const options = [...document.body.querySelectorAll('.supervisor-option-row')].map(row => [
      row.querySelector('.supervisor-option').lastElementChild.textContent.trim(),
      row.querySelector('[data-test="supervisor-option-unit"]')?.textContent.trim(),
    ])
    expect(options).toEqual(expect.arrayContaining([['總幹事丁（A0002）', '迦南康復之家／主任室']]))
    const selected = document.body.querySelector('.el-select__placeholder .supervisor-option')
    expect(selected.textContent).toContain('總幹事丁（A0002）')
  })
})
