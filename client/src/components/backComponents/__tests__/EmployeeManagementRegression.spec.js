import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import * as apiModule from '../../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

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
import HRManagementSystemSetting from '../HRManagementSystemSetting.vue'

/**
 * 2026/11「優化」回合的回歸測試：員工清單（搜尋／篩選／統計）、編輯視窗（連動、日期、送出的資料、未儲存提醒）、
 * 批量匯入（欄位對應、說明列、重複送出）與刪除（重複點擊、連線中斷）。每一個測試對應一個修掉的問題。
 */

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

const passThrough = { template: '<div><slot /></div>' }
const elementStubs = {
  'el-tabs': passThrough,
  'el-tab-pane': passThrough,
  'el-button': { template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' },
  'el-dialog': { template: '<div class="el-dialog-stub"><slot /><slot name="footer" /></div>', props: ['modelValue'] },
  // 驗證一律通過的表單（必填規則另有 EmployeeManagementSignSettings.spec.js 以真的驗證測試）
  'el-form': {
    template: '<form><slot /></form>',
    methods: { validate: () => Promise.resolve(true), clearValidate() {}, scrollToField() {} }
  },
  'el-form-item': passThrough,
  'el-input': { template: '<input />', props: ['modelValue'] },
  'el-select': { template: '<select><slot /></select>', props: ['modelValue'] },
  'el-option': { template: '<option><slot /></option>' },
  'el-upload': { template: '<div class="el-upload-stub"><slot /><slot name="tip" /></div>' },
  'el-alert': { template: '<div class="el-alert-stub"><slot name="title" /><slot /></div>' },
  'el-switch': { template: '<input type="checkbox" />', props: ['modelValue'] },
  'el-avatar': passThrough,
  'el-tag': { template: '<span class="el-tag-stub" :data-type="type"><slot /></span>', props: ['type'] },
  'el-radio-group': passThrough,
  'el-radio': { template: '<label><slot /></label>' },
  'el-checkbox': { template: '<input type="checkbox" />' },
  'el-date-picker': { template: '<input class="date-picker-stub" :data-value-format="valueFormat" />', props: ['modelValue', 'valueFormat'] },
  'el-input-number': { template: '<input type="number" />', props: ['modelValue'] },
  'el-pagination': { template: '<div class="el-pagination-stub" />' },
  // 依 data 畫出每一列（把列資料交給各欄位的 slot），才能檢查清單實際顯示的內容
  'el-table': {
    props: { data: { type: Array, default: () => [] } },
    provide() {
      return { tableRows: () => this.data }
    },
    template: '<div class="el-table-stub"><slot /><slot v-if="!data.length" name="empty" /></div>'
  },
  'el-table-column': {
    inject: { tableRows: { default: () => () => [] } },
    props: ['label', 'type'],
    template:
      '<div class="el-table-column-stub" :data-label="label"><div v-for="(row, index) in tableRows()" :key="index" class="cell"><slot :row="row" :$index="index" /></div></div>'
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const ORGANIZATIONS = [
  { _id: 'org-1', name: '總院' },
  { _id: 'org-2', name: '分院' }
]
const DEPARTMENTS = [
  { _id: 'dept-1', name: '護理部', code: 'NUR', organization: 'org-1' },
  { _id: 'dept-2', name: '行政部', code: 'ADM', organization: 'org-1' },
  { _id: 'dept-3', name: '照服部', code: 'CARE', organization: 'org-2' }
]
const SUB_DEPARTMENTS = [
  { _id: 'sub-1', name: '3A 病房', department: 'dept-1' },
  { _id: 'sub-2', name: '人事組', department: 'dept-2' },
  { _id: 'sub-3', name: '日照中心', department: 'dept-3' }
]

const makeEmployee = (overrides = {}) => ({
  _id: 'e1',
  name: '王大明',
  employeeId: 'E001',
  username: 'wang',
  email: 'wang@example.com',
  gender: 'M',
  role: 'employee',
  organization: 'org-1',
  department: 'dept-1',
  subDepartment: 'sub-1',
  supervisor: { _id: 'sup-9', name: '林主任', employeeId: 'S009' },
  title: '護理師',
  status: '正職員工',
  signTags: [],
  emergencyContacts: [],
  ...overrides
})

describe('EmployeeManagement - 2026/11 優化回合的回歸測試', () => {
  let apiFetchMock
  let importMock
  let server
  let wrapper

  const mountComponent = async () => {
    wrapper = mount(EmployeeManagement, {
      global: { stubs: { transition: false, teleport: false, ...elementStubs } }
    })
    await flushPromises()
    return wrapper
  }

  const calls = matcher => apiFetchMock.mock.calls.filter(([path, options]) => matcher(String(path), options || {}))
  const listCalls = () => calls(path => path.split('?')[0] === '/api/employees' && !path.includes('role=supervisor'))
  const lastListParams = () => new URLSearchParams(listCalls().at(-1)[0].split('?')[1])
  const writes = method => calls((_path, options) => options.method === method)
  const bodyOf = call => JSON.parse(call[1].body)

  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    server = {
      employees: [makeEmployee()],
      total: null,
      active: null,
      detail: null,
      saveResponse: null,
      deleteImpl: null
    }
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (path, options = {}) => {
      const [cleanPath] = String(path).split('?')
      const method = options.method || 'GET'
      if (cleanPath === '/api/organizations') return json(ORGANIZATIONS)
      if (cleanPath === '/api/departments') return json(DEPARTMENTS)
      if (cleanPath === '/api/sub-departments') return json(SUB_DEPARTMENTS)
      if (cleanPath === '/api/other-control-settings/item-settings') return json({ itemSettings: {} })
      if (cleanPath === '/api/employees/sign-tags') return json({ tags: [] })
      if (cleanPath === '/api/employees/delete-impact') return json({ impact: { messages: [] } })
      if (cleanPath === '/api/employees') {
        if (method === 'POST') return server.saveResponse?.() ?? json({ _id: 'new1' }, 201)
        return json({
          employees: server.employees,
          pagination: { total: server.total ?? server.employees.length, page: 1, pageSize: 20, totalPages: 1 },
          summary: { active: server.active ?? server.employees.length }
        })
      }
      const detail = cleanPath.match(/^\/api\/employees\/([^/]+)$/)
      if (detail) {
        if (method === 'DELETE') return server.deleteImpl ? server.deleteImpl() : json({ success: true })
        if (method === 'PUT') return server.saveResponse?.() ?? json({ _id: detail[1] })
        const found = server.detail ?? server.employees.find(item => item._id === detail[1])
        return found ? json(found) : json({ error: 'Not found' }, 404)
      }
      return json({})
    })
    importMock = vi.spyOn(apiModule, 'importEmployeesBulk').mockResolvedValue(json({ preview: [], errors: [] }))
    ;[ElMessage.success, ElMessage.error, ElMessage.warning, ElMessage.info].forEach(fn => fn.mockClear())
    ElMessageBox.confirm.mockReset().mockResolvedValue('confirm')
    ElMessageBox.alert.mockClear()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    apiFetchMock.mockRestore()
    importMock.mockRestore()
  })

  describe('頁首與清單', () => {
    it('頁面只有一個「員工管理」頁首：沒有另外的頁面標題、單一頁籤與「員工列表」區塊標題', async () => {
      const host = mount(HRManagementSystemSetting, {
        global: { stubs: { transition: false, teleport: false, ...elementStubs } }
      })
      await flushPromises()
      const headers = host.findAll('[data-test="page-header"]')
      expect(headers).toHaveLength(1)
      expect(headers[0].find('h1').text()).toBe('員工管理')
      expect(host.findAll('h2')).toHaveLength(0)
      expect(host.text()).not.toContain('人事管理與系統設定')
      expect(host.text()).not.toContain('員工管理系統')
      expect(host.text()).not.toContain('員工列表')
      // 統計數字與主要動作在頁首
      expect(headers[0].find('[data-test="employee-stat-total"]').text()).toContain('1')
      expect(headers[0].find('[data-test="add-employee-button"]').text()).toBe('新增員工')
      host.unmount()
    })

    it('清單顯示部門／小單位與機構的名稱、直屬主管姓名，不顯示部門代碼或一串識別碼', async () => {
      server.employees = [
        makeEmployee(),
        makeEmployee({ _id: 'e2', name: '舊資料', employeeId: 'E002', department: '507f1f77bcf86cd799439011', subDepartment: null, supervisor: null, title: '' })
      ]
      await mountComponent()
      const cells = wrapper.find('[data-label="機構／部門／小單位"]').findAll('.cell')
      expect(cells[0].find('.employee-unit').text()).toBe('護理部／3A 病房')
      expect(cells[0].find('.employee-unit-org').text()).toBe('總院')
      expect(cells[0].text()).not.toContain('NUR')
      // 清單裡找不到的部門（已刪除）不顯示 24 碼的識別碼
      expect(cells[1].find('.employee-unit').text()).toBe('—')
      expect(cells[1].text()).not.toContain('507f1f77bcf86cd799439011')
      const supervisorCells = wrapper.find('[data-label="直屬主管"]').findAll('.cell').map(cell => cell.text())
      expect(supervisorCells).toEqual(['林主任', '—'])
    })

    it('搜尋只靠職稱符合的員工也會顯示（以前前端又用姓名／編號／Email 過濾一次，畫面變空白）', async () => {
      server.employees = [makeEmployee({ title: '護理師' })]
      await mountComponent()
      vi.useFakeTimers()
      try {
        wrapper.vm.searchQuery = '護理師'
        await wrapper.vm.$nextTick()
        vi.advanceTimersByTime(300)
      } finally {
        vi.useRealTimers()
      }
      await flushPromises()
      expect(lastListParams().get('q')).toBe('護理師')
      expect(wrapper.vm.employeeList).toHaveLength(1)
      expect(wrapper.find('[data-label="員工"]').text()).toContain('王大明')
    })

    it('機構／部門／小單位／在職狀態／系統權限的篩選都送到伺服器，並回到第 1 頁', async () => {
      await mountComponent()
      wrapper.vm.employeePagination.page = 3
      wrapper.vm.organizationFilter = 'org-1'
      await flushPromises()
      expect(lastListParams().get('organization')).toBe('org-1')
      expect(lastListParams().get('page')).toBe('1')

      wrapper.vm.departmentFilter = 'dept-1'
      await flushPromises()
      wrapper.vm.subDepartmentFilter = 'sub-1'
      await flushPromises()
      wrapper.vm.statusFilter = '離職員工'
      await flushPromises()
      wrapper.vm.roleFilter = 'admin'
      await flushPromises()

      const params = lastListParams()
      expect(params.get('department')).toBe('dept-1')
      expect(params.get('subDepartment')).toBe('sub-1')
      expect(params.get('status')).toBe('離職員工')
      expect(params.get('role')).toBe('admin')
    })

    it('換機構後，不屬於新機構的部門與小單位篩選一起清掉，而且只查詢一次', async () => {
      await mountComponent()
      wrapper.vm.organizationFilter = 'org-1'
      await flushPromises()
      wrapper.vm.departmentFilter = 'dept-1'
      await flushPromises()
      wrapper.vm.subDepartmentFilter = 'sub-1'
      await flushPromises()
      const before = listCalls().length

      wrapper.vm.organizationFilter = 'org-2'
      await flushPromises()

      expect(wrapper.vm.departmentFilter).toBeNull()
      expect(wrapper.vm.subDepartmentFilter).toBe('')
      const params = lastListParams()
      expect(params.get('organization')).toBe('org-2')
      expect(params.has('department')).toBe(false)
      expect(params.has('subDepartment')).toBe(false)
      // 連動清除不會多發查詢：每一次有效的條件組合只查一次
      expect(listCalls().length).toBe(before + 1)
    })

    it('部門下拉選單只列出所選機構的部門；小單位只列出所選部門的小單位', async () => {
      await mountComponent()
      expect(wrapper.vm.departmentFilterOptions.map(item => item.label)).toEqual(['護理部（總院）', '行政部（總院）', '照服部（分院）'])
      wrapper.vm.organizationFilter = 'org-2'
      await flushPromises()
      expect(wrapper.vm.departmentFilterOptions.map(item => item.label)).toEqual(['照服部'])
      expect(wrapper.vm.subDepartmentFilterOptions.map(item => item.label)).toEqual(['照服部／日照中心'])
      wrapper.vm.departmentFilter = 'dept-3'
      await flushPromises()
      expect(wrapper.vm.subDepartmentFilterOptions.map(item => item.label)).toEqual(['日照中心'])
    })

    it('頁首的統計是全體人數，不隨篩選變動；符合條件的筆數顯示在清單下方', async () => {
      server.total = 12
      server.active = 9
      await mountComponent()
      expect(wrapper.vm.employeeStats).toMatchObject({ total: 12, active: 9 })

      server.total = 2
      server.active = 1
      wrapper.vm.statusFilter = '試用期員工'
      await flushPromises()

      expect(wrapper.vm.employeeStats).toMatchObject({ total: 12, active: 9 })
      expect(wrapper.find('[data-test="employee-result-count"]').text().replace(/\s+/g, ' ')).toBe('符合條件 2 位')
      expect(wrapper.vm.hasActiveEmployeeFilters).toBe(true)

      wrapper.vm.resetEmployeeFilters()
      await flushPromises()
      expect(wrapper.vm.hasActiveEmployeeFilters).toBe(false)
    })

    it('沒有資料時說明下一步；有篩選時改提示調整條件', async () => {
      server.employees = []
      await mountComponent()
      expect(wrapper.find('[data-test="employee-empty"]').text()).toContain('新增員工')
      wrapper.vm.roleFilter = 'admin'
      await flushPromises()
      expect(wrapper.find('[data-test="employee-empty"]').text()).toContain('找不到符合條件的員工')
    })

    it('沒設定在職狀態的員工用灰色標籤（el-tag 沒有 default 這個類型）', async () => {
      await mountComponent()
      expect(wrapper.vm.getStatusTagType(undefined)).toBe('info')
      expect(wrapper.vm.getStatusTagType('正職員工')).toBe('success')
    })

    it('點列開啟編輯；勾選框那一欄不會', async () => {
      await mountComponent()
      wrapper.vm.handleEmployeeRowClick(wrapper.vm.employeeList[0], { type: 'selection' })
      await flushPromises()
      expect(wrapper.vm.employeeDialogVisible).toBe(false)
      wrapper.vm.handleEmployeeRowClick(wrapper.vm.employeeList[0], { type: 'default' })
      await flushPromises()
      await flushPromises()
      expect(wrapper.vm.employeeDialogVisible).toBe(true)
      expect(wrapper.vm.employeeDialogTitle).toBe('編輯員工：王大明（E001）')
    })
  })

  describe('編輯視窗：機構／部門／小單位／直屬主管的連動', () => {
    it('開啟編輯視窗後，小單位清單仍是完整的（以前只剩該員工部門的小單位，清單與匯入的對應都對不到）', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(wrapper.vm.subDepartmentList.map(item => item._id)).toEqual(['sub-1', 'sub-2', 'sub-3'])
      expect(wrapper.vm.filteredSubDepartments.map(item => item._id)).toEqual(['sub-1'])
      // 不再用 ?department= 只載入一個部門的小單位
      expect(calls(path => path.startsWith('/api/sub-departments?'))).toHaveLength(0)
    })

    it('換機構：原本的部門與小單位清掉，直屬主管保留（主管可以是別的機構的人）', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(wrapper.vm.employeeForm.department).toBe('dept-1')
      expect(wrapper.vm.employeeForm.subDepartment).toBe('sub-1')
      expect(wrapper.vm.employeeForm.supervisor).toBe('sup-9')

      wrapper.vm.employeeForm.organization = 'org-2'
      await flushPromises()

      expect(wrapper.vm.employeeForm.department).toBe('')
      expect(wrapper.vm.employeeForm.subDepartment).toBe('')
      expect(wrapper.vm.employeeForm.supervisor).toBe('sup-9')
    })

    it('換成同機構的另一個部門：小單位清掉、直屬主管保留；換回原部門不會把新選的小單位洗掉', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      wrapper.vm.employeeForm.department = 'dept-2'
      await flushPromises()
      expect(wrapper.vm.employeeForm.subDepartment).toBe('')
      expect(wrapper.vm.employeeForm.supervisor).toBe('sup-9')

      wrapper.vm.employeeForm.subDepartment = 'sub-2'
      await flushPromises()
      expect(wrapper.vm.employeeForm.subDepartment).toBe('sub-2')
    })

    it('開啟視窗載入資料時不會因為連動把原本的部門、小單位洗掉（即使部門清單裡找不到該部門）', async () => {
      server.employees = [makeEmployee({ department: 'dept-legacy', subDepartment: 'sub-legacy' })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(wrapper.vm.employeeForm.department).toBe('dept-legacy')
      expect(wrapper.vm.employeeForm.subDepartment).toBe('sub-legacy')
    })

    it('連按兩次編輯不同的人：畫面是最後按的那一位，先回來的資料不會蓋掉它', async () => {
      server.employees = [makeEmployee(), makeEmployee({ _id: 'e2', name: '李小華', employeeId: 'E002' })]
      await mountComponent()
      let releaseFirst
      const original = apiFetchMock.getMockImplementation()
      apiFetchMock.mockImplementation(async (path, options = {}) => {
        if (String(path) === '/api/employees/e1' && !options.method) {
          await new Promise(resolve => { releaseFirst = resolve })
        }
        return original(path, options)
      })

      const first = wrapper.vm.openEmployeeDialog('e1')
      const second = wrapper.vm.openEmployeeDialog('e2')
      await second
      releaseFirst()
      await first
      await flushPromises()

      expect(wrapper.vm.employeeForm.name).toBe('李小華')
      expect(wrapper.vm.editingEmployeeId).toBe('e2')
      expect(wrapper.vm.employeeDialogLoading).toBe(false)
    })
  })

  describe('編輯視窗：日期以台灣的日期為準', () => {
    it('伺服器存的是 UTC 午夜（批量匯入）或台灣午夜（舊版畫面）都顯示同一天，送出的是 YYYY-MM-DD', async () => {
      server.employees = [makeEmployee({
        birthday: '1990-05-19T16:00:00.000Z', // 台灣 1990/05/20 00:00（舊版畫面存的）
        appointment: {
          hireDate: '2024-02-15T00:00:00.000Z', // UTC 午夜（批量匯入存的）＝台灣 2024/02/15 08:00
          resignationDate: '2026-12-30T16:00:00.000Z'
        },
        annualLeave: { totalHours: 80, usedHours: 0, expiryDate: '2026-12-31T00:00:00.000Z' },
        experiences: [{ unit: '某醫院', title: '護理師', start: '2018-06-30T16:00:00.000Z', end: '2020-12-01T00:00:00.000Z' }],
        licenses: [{ name: '護理師證書', number: 'N-1', startDate: '2019-12-31T16:00:00.000Z', endDate: '2025-12-31T00:00:00.000Z', fileList: [] }],
        trainings: [{ course: 'CPR', courseNo: 'T-1', date: '2025-03-09T16:00:00.000Z', category: [], fileList: [] }]
      })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      const form = wrapper.vm.employeeForm
      expect(form.birthday).toBe('1990-05-20')
      expect(form.hireDate).toBe('2024-02-15')
      expect(form.resignDate).toBe('2026-12-31')
      expect(form.annualLeave.expiryDate).toBe('2026-12-31')
      expect(form.experiences[0]).toMatchObject({ start: '2018-07', end: '2020-12' })
      expect(form.licenses[0]).toMatchObject({ startDate: '2020-01-01', endDate: '2025-12-31' })
      expect(form.trainings[0].date).toBe('2025-03-10')

      // 所有日期選擇器都以字串（YYYY-MM-DD / YYYY-MM）當作值，不產生會隨瀏覽器時區位移的 Date 物件
      const formats = wrapper.findAll('.date-picker-stub').map(node => node.attributes('data-value-format'))
      expect(formats.length).toBeGreaterThanOrEqual(8)
      expect(formats.every(format => ['YYYY-MM-DD', 'YYYY-MM'].includes(format))).toBe(true)

      await wrapper.vm.saveEmployee()
      await flushPromises()
      const body = bodyOf(writes('PUT')[0])
      expect(body.birthday).toBe('1990-05-20')
      expect(body.hireDate).toBe('2024-02-15')
      expect(body.resignDate).toBe('2026-12-31')
      expect(body.annualLeave.expiryDate).toBe('2026-12-31')
      expect(body.licenses[0].startDate).toBe('2020-01-01')
      expect(body.trainings[0].date).toBe('2025-03-10')
    })

    it('沒有請假期限的員工不會被補上空白的 expiryDate', async () => {
      server.employees = [makeEmployee({ annualLeave: { totalHours: 80, usedHours: 8 } })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(Object.prototype.hasOwnProperty.call(wrapper.vm.employeeForm.annualLeave, 'expiryDate')).toBe(false)
    })
  })

  describe('編輯視窗：送出的資料', () => {
    it('緊急聯絡人改得動：不把伺服器原本的 emergencyContacts 陣列送回去（伺服器看到陣列就照寫，會蓋掉畫面上改的）', async () => {
      server.employees = [makeEmployee({
        emergencyContacts: [{ name: '舊聯絡人', relation: '父', phone1: '0911', phone2: '' }],
        emergency1: { name: '舊聯絡人', relation: '父', phone1: '0911', phone2: '' },
        appointment: { hireDate: '2024-02-15T00:00:00.000Z' },
        education: { level: '大學' },
        medicalCheck: { height: 170 },
        militaryService: { serviceType: '免役' }
      })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(wrapper.vm.employeeForm.emergency1.name).toBe('舊聯絡人')

      wrapper.vm.employeeForm.emergency1.name = '新聯絡人'
      wrapper.vm.employeeForm.emergency1.phone1 = '0922'
      await wrapper.vm.saveEmployee()
      await flushPromises()

      const body = bodyOf(writes('PUT')[0])
      expect(body.emergency1).toEqual({ name: '新聯絡人', relation: '父', phone1: '0922', phone2: '' })
      expect(body.emergency2).toEqual({ name: '', relation: '', phone1: '', phone2: '' })
      ;['emergencyContacts', 'appointment', 'education', 'medicalCheck', 'militaryService'].forEach(key => {
        expect(body).not.toHaveProperty(key)
      })
      // 攤平後的欄位照常送出
      expect(body.educationLevel).toBe('大學')
      expect(body.height).toBe(170)
      expect(body.serviceType).toBe('免役')
    })

    // 員工編號／帳號／Email 和別人重複：以前只跳一則訊息，看不出是哪一欄
    it('伺服器回 DUPLICATE_EMPLOYEE 時，紅字標在那個欄位旁；改了那個欄位就拿掉', async () => {
      server.saveResponse = () => json({ error: '員工編號已被其他員工使用，請改用別的員工編號', code: 'DUPLICATE_EMPLOYEE', field: 'employeeId' }, 400)
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(ElMessage.error).toHaveBeenCalledWith('員工編號已被其他員工使用，請改用別的員工編號')
      expect(wrapper.vm.employeeServerFieldErrors).toEqual({ employeeNo: '員工編號已被其他員工使用，請改用別的員工編號' })
      expect(wrapper.vm.employeeFieldErrors.employeeNo).toBe('員工編號已被其他員工使用，請改用別的員工編號')

      wrapper.vm.employeeForm.employeeNo = 'E999'
      await flushPromises()
      expect(wrapper.vm.employeeServerFieldErrors).toEqual({})
      expect(wrapper.vm.employeeFieldErrors.employeeNo).toBeUndefined()
    })

    it('只填了第二位緊急聯絡人（第一位是 null）的員工也打得開，不會因為讀不到欄位整個視窗壞掉', async () => {
      server.employees = [makeEmployee({ emergency1: null, emergency2: { name: '乙', phone1: '0933' } })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(wrapper.vm.employeeDialogVisible).toBe(true)
      expect(wrapper.vm.employeeForm.emergency1).toEqual({ name: '', relation: '', phone1: '', phone2: '' })
      expect(wrapper.vm.employeeForm.emergency2).toEqual({ name: '乙', relation: '', phone1: '0933', phone2: '' })
    })

    it('字典裡已經沒有的薪資項目不會在編輯時被默默清掉：開啟、不改、儲存，項目與金額原樣送回', async () => {
      // 字典（C14）沒有設定時套用預設選項：本薪、全勤、加班費、交通津貼、伙食津貼、績效獎金
      server.employees = [makeEmployee({
        salaryItems: ['本薪', '組長加給'],
        salaryItemAmounts: { 本薪: 30000, 組長加給: 2000 }
      })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      expect(wrapper.vm.employeeForm.salaryItems).toEqual(['本薪', '組長加給'])
      expect(wrapper.vm.employeeForm.salaryItemAmounts).toEqual({ 本薪: 30000, 組長加給: 2000 })
      expect(wrapper.vm.salaryItemOptionsForUI.find(item => item.value === '組長加給').label).toBe('組長加給（字典已無此項目）')

      await wrapper.vm.saveEmployee()
      await flushPromises()
      const body = bodyOf(writes('PUT')[0])
      expect(body.salaryItems).toEqual(['本薪', '組長加給'])
      expect(body.salaryItemAmounts).toEqual({ 本薪: 30000, 組長加給: 2000 })

      // 換開另一位（或新增）員工時，上一位留下的項目不會變成可選的項目
      await wrapper.vm.openEmployeeDialog()
      await flushPromises()
      expect(wrapper.vm.salaryItemOptionsForUI.some(item => item.value === '組長加給')).toBe(false)
      wrapper.vm.employeeForm.salaryItems = ['本薪', '組長加給']
      await flushPromises()
      expect(wrapper.vm.employeeForm.salaryItems).toEqual(['本薪'])
    })

    it('出生地讀得到也不會被洗掉（伺服器的欄位是 birthPlace，以前表單對不到、存檔就送出空白）', async () => {
      server.employees = [makeEmployee({ birthPlace: '高雄' })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(wrapper.vm.employeeForm.birthplace).toBe('高雄')
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(bodyOf(writes('PUT')[0]).birthplace).toBe('高雄')
    })

    it('試用期天數是數字（以前下拉選單存成字串 "30"）', async () => {
      server.employees = [makeEmployee({ probationDays: '90' })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      expect(wrapper.vm.employeeForm.probationDays).toBe(90)
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(bodyOf(writes('PUT')[0]).probationDays).toBe(90)
    })

    it('畫面上不再顯示的欄位（權限職等、需要打卡）原值照送，不會被洗掉；新員工的「需要打卡」沿用預設值', async () => {
      server.employees = [makeEmployee({ permissionGrade: 'L3', isClocking: false })]
      await mountComponent()
      expect(wrapper.text()).not.toContain('權限職等')
      expect(wrapper.text()).not.toContain('需要打卡')

      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      await wrapper.vm.saveEmployee()
      await flushPromises()
      const body = bodyOf(writes('PUT')[0])
      expect(body.permissionGrade).toBe('L3')
      expect(body.isClocking).toBe(false)

      await wrapper.vm.openEmployeeDialog()
      await flushPromises()
      expect(wrapper.vm.employeeForm.isClocking).toBe(true)
      expect(wrapper.vm.employeeForm.employmentStatus).toBe('正職員工')
    })

    it('伺服器回的英文錯誤轉成中文（少了員工編號、最後一位管理員）', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()

      server.saveResponse = () => json({ error: 'Employee number is required' }, 400)
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(ElMessage.error).toHaveBeenLastCalledWith('請輸入員工編號')

      server.saveResponse = () => json({ error: 'At least one active administrator is required' }, 409)
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(ElMessage.error.mock.calls.at(-1)[0]).toContain('至少要保留一位可登入的管理員')
      // 失敗時視窗不關
      expect(wrapper.vm.employeeDialogVisible).toBe(true)
    })

    it('附件：超過 1MB 的檔案選檔時就擋下；整份資料超過伺服器上限時不送出並說明原因', async () => {
      await mountComponent()
      expect(wrapper.vm.handleAttachmentBeforeUpload({ name: 'big.pdf', size: 1024 * 1024 + 1 })).toBe(false)
      expect(ElMessage.warning.mock.calls.at(-1)[0]).toContain('big.pdf')
      expect(wrapper.vm.handleAttachmentBeforeUpload({ name: 'ok.pdf', size: 1024 })).toBe(true)

      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      wrapper.vm.employeeForm.licenses = [{
        name: '證照', number: 'L-1', startDate: '', endDate: '',
        fileList: [{ name: 'a', url: `data:application/pdf;base64,${'A'.repeat(2 * 1024 * 1024)}` }]
      }]
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(writes('PUT')).toHaveLength(0)
      expect(ElMessage.error.mock.calls.at(-1)[0]).toContain('附件合計太大')
      expect(wrapper.vm.employeeDialogTab).toBe('background')
    })
  })

  describe('編輯視窗：未儲存變更的提醒與自己的權限', () => {
    it('沒有改任何東西就關閉：不提醒', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      const closed = await wrapper.vm.requestEmployeeDialogClose()
      expect(closed).toBe(true)
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(wrapper.vm.employeeDialogVisible).toBe(false)
    })

    it('改過欄位再關閉：先確認；選「繼續編輯」視窗不關、內容還在，選「放棄變更」才關', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      wrapper.vm.employeeForm.phone = '0912345678'

      ElMessageBox.confirm.mockRejectedValueOnce('cancel')
      expect(await wrapper.vm.requestEmployeeDialogClose()).toBe(false)
      expect(ElMessageBox.confirm).toHaveBeenCalledWith('有尚未儲存的變更，確定要關閉嗎？', '尚未儲存', expect.objectContaining({
        confirmButtonText: '放棄變更',
        cancelButtonText: '繼續編輯'
      }))
      expect(wrapper.vm.employeeDialogVisible).toBe(true)
      expect(wrapper.vm.employeeForm.phone).toBe('0912345678')

      // 右上角的 X 走同一個流程（before-close）
      const done = vi.fn()
      wrapper.vm.handleEmployeeDialogBeforeClose(done)
      await flushPromises()
      expect(done).toHaveBeenCalledTimes(1)
    })

    it('儲存成功後自動關閉，不會再跳未儲存的提醒', async () => {
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      wrapper.vm.employeeForm.phone = '0912345678'
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(wrapper.vm.employeeDialogVisible).toBe(false)
      expect(ElMessage.success).toHaveBeenCalledWith('儲存成功')
    })

    it('管理員取消自己的管理員權限：先確認會被登出，取消就不送出', async () => {
      sessionStorage.setItem('employeeId', 'e1')
      server.employees = [makeEmployee({ role: 'admin' })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      wrapper.vm.employeeForm.role = 'employee'

      ElMessageBox.confirm.mockRejectedValueOnce('cancel')
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(ElMessageBox.confirm.mock.calls[0][0]).toContain('取消自己的管理員權限')
      expect(writes('PUT')).toHaveLength(0)

      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(writes('PUT')).toHaveLength(1)
    })

    it('改別人的權限、或自己的權限沒變時不多問', async () => {
      sessionStorage.setItem('employeeId', 'someone-else')
      server.employees = [makeEmployee({ role: 'admin' })]
      await mountComponent()
      await wrapper.vm.openEmployeeDialog('e1')
      await flushPromises()
      wrapper.vm.employeeForm.role = 'employee'
      await wrapper.vm.saveEmployee()
      await flushPromises()
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(writes('PUT')).toHaveLength(1)
    })
  })

  describe('刪除單筆員工', () => {
    it('確認視窗還開著時再按一次刪除：不會重複查詢影響、也不會送出兩次', async () => {
      await mountComponent()
      let resolveConfirm
      ElMessageBox.confirm.mockImplementationOnce(() => new Promise(resolve => { resolveConfirm = resolve }))

      const first = wrapper.vm.deleteEmployee('e1')
      await flushPromises()
      expect(wrapper.vm.deletingEmployeeId).toBe('e1')
      await wrapper.vm.deleteEmployee('e1')
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)

      resolveConfirm('confirm')
      await first
      await flushPromises()
      expect(writes('DELETE')).toHaveLength(1)
      expect(wrapper.vm.deletingEmployeeId).toBe('')
      // 確認文字寫出要刪除的是誰
      expect(ElMessageBox.confirm.mock.calls[0][0]).toContain('王大明（E001）')
    })

    it('刪除時連線中斷：顯示訊息並重新載入清單，不會留下沒人處理的錯誤', async () => {
      await mountComponent()
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      server.deleteImpl = () => { throw new TypeError('Failed to fetch') }
      const before = listCalls().length

      await expect(wrapper.vm.deleteEmployee('e1')).resolves.toBeUndefined()

      expect(ElMessage.error).toHaveBeenCalledWith('刪除失敗，已重新載入員工列表，請確認結果後再試')
      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(listCalls().length).toBeGreaterThan(before)
      expect(wrapper.vm.deletingEmployeeId).toBe('')
      warn.mockRestore()
    })
  })

  describe('批量匯入', () => {
    const HEADER = 'employeeId,name,email,idNumber,department,nickname'
    const csvFile = (lines, name = 'staff.csv') => new File([`﻿${lines.join('\n')}`], name, { type: 'text/csv' })
    const pick = async file => {
      await wrapper.vm.handleBulkImportFileChange({ name: file.name, raw: file })
      await flushPromises()
    }
    const sentMappings = (index = 0) => JSON.parse(importMock.mock.calls[index][0].get('mappings'))

    it('只送檔案裡真的有的欄位對應：精簡的檔案不會因為少了選填欄位被整份退回', async () => {
      await mountComponent()
      await pick(csvFile([HEADER, 'E100,甲,a@example.com,A123456789,護理部,小甲']))

      const summary = wrapper.vm.bulkImportColumnSummary
      expect(summary.recognized.map(config => config.key)).toEqual(['employeeNo', 'name', 'idNumber', 'email', 'department'])
      expect(summary.unknown).toEqual(['nickname'])
      // 預覽下方說明會匯入哪些欄位、哪些欄位系統不認得
      expect(wrapper.find('[data-test="bulk-import-columns"]').text()).toContain('nickname')

      await wrapper.vm.submitBulkImport()
      await flushPromises()

      const mappings = sentMappings()
      expect(mappings).toMatchObject({ employeeNo: 'employeeId', name: 'name', email: 'email', idNumber: 'idNumber', department: 'department' })
      // 檔案裡沒有的一般欄位不送（伺服器對每個送去的對應都要求檔案有那一欄）
      ;['birthday', 'gender', 'organization', 'title', 'hireDate', 'salaryType'].forEach(key => {
        expect(mappings).not.toHaveProperty(key)
      })
      // 伺服器本來就允許缺少的欄位（會改用第 2 列的中文名稱比對）照送
      expect(mappings).toMatchObject({ signTags: 'signTags', 'annualLeave.totalHours': 'annualLeave_totalHours', holidayRegime: 'holidayRegime' })
    })

    it('匯入結果的部門用伺服器回的 departmentName；伺服器說檔案缺必填欄位（missingColumns）時寫出是哪一欄', async () => {
      await mountComponent()
      await pick(csvFile([HEADER, 'E100,甲,a@example.com,A123456789,護理部,小甲']))
      importMock.mockResolvedValueOnce(json({
        preview: [{ employeeNo: 'E100', name: '甲', department: '6a0000000000000000000001', departmentName: '外部新部門', email: 'a@example.com', role: 'employee' }],
        errors: [],
        warnings: ['檔案沒有這些欄位，已略過（不影響其他欄位）：血型']
      }))
      await wrapper.vm.submitBulkImport()
      await flushPromises()
      const departmentCells = wrapper.findAll('.bulk-import-preview [data-label="部門"] .cell').map(cell => cell.text())
      expect(departmentCells).toEqual(['外部新部門'])
      expect(wrapper.find('[data-test="bulk-import-warnings"]').text()).toContain('檔案沒有這些欄位，已略過')

      await wrapper.vm.restartBulkImport?.()
      await pick(csvFile([HEADER, 'E101,乙,b@example.com,B123456789,護理部,小乙']))
      importMock.mockResolvedValueOnce(json({
        message: '匯入檔案缺少必要欄位',
        missingColumns: [{ key: 'email', header: 'email', label: '電子郵件' }]
      }, 400))
      await wrapper.vm.submitBulkImport()
      await flushPromises()
      expect(wrapper.vm.bulkImportErrors).toEqual(['找不到必填欄位「電子郵件」（檔案第 1 列要有「email」）'])
    })

    it('沒有中文說明列的檔案：第 2 列就是資料，預覽不會少一筆，列號也從第 2 列算起', async () => {
      await mountComponent()
      await pick(csvFile([HEADER, 'E100,甲,a@example.com,A123456789,護理部,小甲', 'E101,乙,,B123456789,護理部,小乙']))
      expect(wrapper.vm.bulkImportPreview.map(row => row.employeeNo)).toEqual(['E100', 'E101'])
      expect(wrapper.vm.bulkImportErrors).toEqual(['第 3 列缺少必填欄位：電子郵件'])
    })

    it('有範本的中文說明列時照舊略過它，列號從第 3 列算起', async () => {
      await mountComponent()
      // 與伺服器相同的規則：說明列要有 3 格以上和範本的說明文字相同
      const header = 'employeeId,name,email,mobile,department'
      const description = '"員工編號 (必填)","姓名 (必填)","電子郵件 (必填唯一)","手機號碼","部門 ID"'
      await pick(csvFile([header, description, 'E100,甲,,0912,護理部']))
      expect(wrapper.vm.bulkImportPreview.map(row => row.employeeNo)).toEqual(['E100'])
      expect(wrapper.vm.bulkImportErrors).toEqual(['第 3 列缺少必填欄位：電子郵件'])
    })

    it('檔案缺必填欄位或必填儲存格：不能送出，換一份正確的檔案後就可以，而且換檔不必再確認', async () => {
      await mountComponent()
      await pick(csvFile(['employeeId,name', 'E100,甲'], 'bad.csv'))
      expect(wrapper.vm.bulkImportErrors).toEqual(['檔案缺少必填欄位：電子郵件（email）'])
      expect(wrapper.vm.canSubmitBulkImport).toBe(false)
      expect(wrapper.find('.el-alert-stub.bulk-import-error').text()).toContain('請修正後重新選擇檔案')

      await wrapper.vm.submitBulkImport()
      await flushPromises()
      expect(importMock).not.toHaveBeenCalled()
      expect(ElMessage.warning).toHaveBeenLastCalledWith('檔案裡有必填欄位沒有填，請修正檔案後重新選擇')

      // 已經選了檔案時再選一個（el-upload 的 limit=1 只會觸發 on-exceed）：直接換成新檔案
      const good = csvFile([HEADER, 'E100,甲,a@example.com,A123456789,護理部,小甲'], 'good.csv')
      await wrapper.vm.handleBulkImportFileExceed([good])
      await flushPromises()
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(wrapper.vm.bulkImportFile).toBe(good)
      expect(wrapper.vm.bulkImportUploadFileList).toHaveLength(1)
      expect(wrapper.vm.bulkImportErrors).toEqual([])
      expect(wrapper.vm.canSubmitBulkImport).toBe(true)
    })

    it('匯入前的預覽顯示「人員狀態」，不會把它放在「權限」欄', async () => {
      await mountComponent()
      await pick(csvFile(['employeeId,name,email,status', 'E100,甲,a@example.com,試用期']))
      expect(wrapper.vm.bulkImportPreview[0]).toMatchObject({ status: '試用期', role: '' })
      const labels = wrapper.findAll('.bulk-import-preview .el-table-column-stub').map(node => node.attributes('data-label'))
      expect(labels).toContain('人員狀態')
      expect(labels).not.toContain('權限')
    })

    it('匯入中連按兩次只送一次；匯入完成後同一份檔案不能再送，畫面改顯示結果與「完成」', async () => {
      await mountComponent()
      wrapper.vm.openBulkImportDialog()
      await pick(csvFile([HEADER, 'E100,甲,a@example.com,A123456789,護理部,小甲']))
      let resolveImport
      importMock.mockImplementationOnce(() => new Promise(resolve => { resolveImport = resolve }))

      const first = wrapper.vm.submitBulkImport()
      await flushPromises()
      await wrapper.vm.submitBulkImport()
      expect(importMock).toHaveBeenCalledTimes(1)

      resolveImport(json({
        createdCount: 1,
        updatedCount: 0,
        preview: [{ action: 'created', employeeNo: 'E100', name: '甲', department: 'dept-1', role: 'employee', email: 'a@example.com' }],
        warnings: [],
        errors: []
      }))
      await first
      await flushPromises()

      expect(wrapper.vm.bulkImportDone).toBe(true)
      expect(wrapper.find('[data-test="bulk-import-done"]').text()).toContain('匯入完成：新增 1 筆、更新 0 筆')
      expect(wrapper.find('[data-test="bulk-import-done"]').text()).toContain('初始密碼是該員工的身分證號')
      // 結果表把部門的識別碼換成名稱、權限顯示中文
      expect(wrapper.find('.bulk-import-preview').text()).toContain('護理部')
      expect(wrapper.find('.bulk-import-preview').text()).toContain('員工')
      expect(wrapper.find('.bulk-import-preview').text()).not.toContain('dept-1')
      expect(wrapper.find('[data-test="bulk-import-submit"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="bulk-import-finish"]').exists()).toBe(true)

      await wrapper.vm.submitBulkImport()
      expect(importMock).toHaveBeenCalledTimes(1)
      expect(ElMessage.warning).toHaveBeenLastCalledWith('這份檔案已經匯入完成；要再匯入請先選擇其他檔案')

      // 按「完成」直接關閉並清空，不再問「確定要離開？」
      ElMessageBox.confirm.mockClear()
      wrapper.vm.finishBulkImport()
      await flushPromises()
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(wrapper.vm.bulkImportDialogVisible).toBe(false)
      expect(wrapper.vm.bulkImportDone).toBe(false)
      expect(wrapper.vm.bulkImportFile).toBeNull()
      expect(wrapper.vm.bulkImportPreview).toEqual([])
    })

    it('匯入失敗：伺服器的原因留在畫面上（不只是一閃而過的訊息），修正後可以再送', async () => {
      await mountComponent()
      await pick(csvFile([HEADER, 'E100,甲,a@example.com,A123456789,護理部,小甲']))
      importMock.mockResolvedValueOnce(json({ message: '第 2 列資料有誤，已停止匯入', errors: ['第 2 列：員工編號 E100 已存在'] }, 400))

      await wrapper.vm.submitBulkImport()
      await flushPromises()

      expect(wrapper.vm.bulkImportDone).toBe(false)
      const alert = wrapper.find('.el-alert-stub.bulk-import-error')
      expect(alert.text()).toContain('匯入失敗：第 2 列資料有誤，已停止匯入')
      expect(alert.text()).toContain('員工編號 E100 已存在')
      expect(wrapper.vm.canSubmitBulkImport).toBe(true)

      wrapper.vm.bulkImportForm.options.updateExisting = true
      await wrapper.vm.submitBulkImport()
      await flushPromises()
      expect(importMock).toHaveBeenCalledTimes(2)
      expect(wrapper.vm.bulkImportDone).toBe(true)
      expect(wrapper.vm.bulkImportErrorMessage).toBe('')
    })

    it('自動對應後伺服器仍回報對不到：只自動重送一次就停下來，不會一直重送', async () => {
      DEPARTMENTS.push({ _id: 'dept-auto', name: '自動部', code: 'AUTO', organization: 'org-1' })
      try {
        await mountComponent()
        await pick(csvFile([HEADER, 'E100,甲,a@example.com,A123456789,自動部,小甲']))
        const conflict = () => json({
          message: '匯入資料存在未對應的組織、部門或主管資訊，請完成對應後重新提交',
          missingReferences: {
            department: { values: [{ value: '自動部', normalizedValue: '自動部', rows: [2] }], options: [{ id: 'dept-auto', name: '自動部', code: 'AUTO' }] }
          },
          errors: []
        }, 409)
        importMock.mockImplementation(async () => conflict())

        await wrapper.vm.submitBulkImport()
        await flushPromises()

        expect(importMock).toHaveBeenCalledTimes(2)
        expect(ElMessage.error).toHaveBeenLastCalledWith('匯入資料存在未對應的組織、部門或主管資訊，請完成對應後重新提交')
        expect(wrapper.vm.bulkImportDone).toBe(false)
        expect(wrapper.vm.bulkImportLoading).toBe(false)
      } finally {
        DEPARTMENTS.pop()
      }
    })

    it('匯入完成後，清單與頁首統計都重新載入', async () => {
      await mountComponent()
      await pick(csvFile([HEADER, 'E100,甲,a@example.com,A123456789,護理部,小甲']))
      server.total = 2
      server.active = 2
      const before = listCalls().length
      await wrapper.vm.submitBulkImport()
      await flushPromises()
      expect(listCalls().length).toBeGreaterThan(before)
      expect(wrapper.vm.employeeStats).toMatchObject({ total: 2, active: 2 })
    })
  })
})
