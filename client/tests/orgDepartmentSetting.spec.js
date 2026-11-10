import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage, ElMessageBox } from 'element-plus'
import OrgDepartmentSetting from '../src/components/backComponents/OrgDepartmentSetting.vue'
import { apiFetch } from '../src/api'
import { backendHelpContent } from '../src/constants/backendHelpContent'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

// 對話框裡的 el-select（以 data-test 找）
const findSelect = (wrapper, dataTest) =>
  wrapper.findAllComponents({ name: 'ElSelect' }).find(select => select.attributes('data-test') === dataTest)

describe('OrgDepartmentSetting.vue', () => {
  beforeEach(() => {
    apiFetch.mockClear()
    vi.stubGlobal('fetch', vi.fn())
    vi.stubGlobal('alert', vi.fn())
    apiFetch.mockImplementation(() => Promise.resolve({ ok: true, json: async () => [] }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fetches all lists on mount', async () => {
    mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await new Promise(resolve => setTimeout(resolve, 0))
    const calls = apiFetch.mock.calls
    expect(calls.find(c => c[0] === '/api/organizations')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/departments')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/sub-departments')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/dept-managers')).toBeTruthy()
    expect(calls.find(c => c[0] === '/api/shifts')).toBeTruthy()
  })

  it('posts to correct endpoint when creating org', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    wrapper.vm.openDialog('org')
    wrapper.vm.form = { name: 'A', systemCode: 'SC' }
    wrapper.vm.editIndex = null
    await wrapper.vm.saveItem()
    expect(apiFetch).toHaveBeenCalledWith('/api/organizations', expect.objectContaining({ method: 'POST' }))
  })

  // 客戶 2026/11「可以把一些沒有功能性的拿掉」：部門表單不再有統一編號、預設週休二日等沒有功能的欄位（資料保留在伺服器）
  it('shows organization select in dept form', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await wrapper.vm.openDialog('dept')
    expect(wrapper.findComponent({ name: 'ElSelect' }).exists()).toBe(true)
    expect(wrapper.vm.form).toHaveProperty('organization')
    expect(wrapper.vm.form).not.toHaveProperty('defaultTwoDayOff')
    expect(wrapper.vm.form).not.toHaveProperty('uniformNumber')
  })

  it('fetchList adds parent id query', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    apiFetch.mockImplementationOnce(() =>
      Promise.resolve({
        ok: true,
        json: async () => ([{ _id: 'd1', name: 'HR' }])
      })
    )
    await wrapper.vm.fetchList('dept', '123')
    expect(apiFetch).toHaveBeenCalledWith('/api/departments?organization=123')
    expect(wrapper.vm.deptList).toEqual([
      expect.objectContaining({ _id: 'd1', organization: '123' })
    ])
  })

  // 預設週休二日、允許臨時調班、統一編號已不在畫面上：編輯時不帶入表單，存檔也不送（伺服器上的值不動）
  it('merges schedule defaults when editing dept without data', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    wrapper.vm.deptList = [
      {
        _id: 'd1',
        name: 'HR',
        organization: 'org1',
        defaultTwoDayOff: false
      }
    ]
    await wrapper.vm.openDialog('dept', 0)
    expect(wrapper.vm.form).toEqual({
      organization: 'org1',
      name: 'HR',
      code: '',
      unitName: '',
      deptManager: '',
      scheduleNotes: '',
      allowedFormIds: []
    })
  })

  it('saves department with schedule fields', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    apiFetch.mockClear()
    await wrapper.vm.openDialog('dept')
    wrapper.vm.form = {
      ...wrapper.vm.form,
      name: '人資',
      organization: 'org1',
      code: 'D1',
      unitName: '',
      institutionCode: 'IC-010',
      uniformNumber: '12345678',
      laborInsuranceNumber: 'LAB123',
      healthInsuranceNumber: 'HEA123',
      taxRegistrationNumber: 'TAX123',
      location: '',
      phone: '',
      manager: '',
      responsiblePerson: '王主管',
      defaultTwoDayOff: false,
      tempChangeAllowed: true,
      deptManager: 'mgr1',
      scheduleNotes: '備註'
    }
    wrapper.vm.editIndex = null
    await wrapper.vm.saveItem()
    const postCall = apiFetch.mock.calls.find(([url, options]) => url === '/api/departments' && options?.method === 'POST')
    expect(postCall).toBeTruthy()
    const [, options] = postCall
    const payload = JSON.parse(options.body)
    // 只送畫面上的欄位：預設週休二日、允許臨時調班與證號等不再送出（新增時用資料庫的預設值）
    expect(payload).toEqual({
      organization: 'org1',
      name: '人資',
      code: 'D1',
      unitName: '',
      deptManager: 'mgr1',
      scheduleNotes: '備註',
      allowedFormIds: []
    })
    expect(apiFetch.mock.calls.some(([url]) => url.includes('break-settings'))).toBe(false)
  })

  it('小單位表單開啟時會載入班別選項', async () => {
    const shifts = [{ _id: 's1', name: '早班', code: 'A1' }]
    apiFetch.mockImplementation(url => {
      if (url === '/api/shifts') {
        return Promise.resolve({ ok: true, json: async () => shifts })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await Promise.resolve()
    await Promise.resolve()
    apiFetch.mockClear()
    await wrapper.vm.openDialog('sub')
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(apiFetch.mock.calls.some(([url]) => url === '/api/shifts')).toBe(true)
    expect(wrapper.vm.shiftOptions).toEqual(shifts)
  })

  // 客戶要求拿掉「班表拉選」與沒有功能的欄位（2026/11）：編輯時不再帶入，伺服器上的資料不動
  it('編輯小單位時不再帶入班表拉選與沒有功能的舊欄位', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await new Promise(resolve => setTimeout(resolve, 0))
    wrapper.vm.subList = [
      { _id: 'sd1', name: '夜班組', department: 'dept1', shift: 's2', shiftId: 's2', uniformNumber: '12345678', manager: '王組長' }
    ]
    await wrapper.vm.$nextTick()
    await wrapper.vm.openDialog('sub', 0)
    expect(wrapper.vm.form).toEqual({ department: 'dept1', name: '夜班組', code: '', schedulers: [], allowedShiftIds: [] })
  })

  it('新增小單位時只送畫面上的欄位（不再有班別ID與證號等欄位）', async () => {
    apiFetch.mockImplementation(url => {
      if (url === '/api/shifts') {
        return Promise.resolve({ ok: true, json: async () => [{ _id: 's1', name: '早班' }] })
      }
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await wrapper.vm.openDialog('sub')
    await Promise.resolve()
    await Promise.resolve()
    expect(wrapper.vm.form).toEqual({ name: '', code: '', department: '', schedulers: [], allowedShiftIds: [] })
    wrapper.vm.form = {
      ...wrapper.vm.form,
      name: '夜班組',
      department: 'dept1',
      code: 'N1'
    }
    wrapper.vm.editIndex = null
    apiFetch.mockClear()
    await wrapper.vm.saveItem()
    const call = apiFetch.mock.calls.find(([url, options]) => url === '/api/sub-departments' && options?.method === 'POST')
    expect(call).toBeTruthy()
    const [, options] = call
    const payload = JSON.parse(options.body)
    expect(payload).toEqual({ department: 'dept1', name: '夜班組', code: 'N1', schedulers: [], allowedShiftIds: [] })
  })

  // 2026/11：三個分頁各一張清單（加上「機構-部門」標籤說明目前篩選的部門）改成一張階層表，機構 › 部門 › 小單位直接看得到
  const treeNames = wrapper => wrapper.findAll('[data-test="org-tree"] .el-table__body tr [data-test="node-name"]').map(node => node.text())
  const treeRow = (wrapper, name) => wrapper.findAll('[data-test="org-tree"] .el-table__body tr').find(row => row.find('[data-test="node-name"]').text() === name)

  it('shows 機構 › 部門 › 小單位 as one tree with the counts of what each one contains', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.orgList = [
      { _id: 'org1', name: '總公司' },
      { _id: 'org2', name: '分公司' }
    ]
    wrapper.vm.deptList = [
      { _id: 'dept1', name: '人資部', organization: 'org1' },
      { _id: 'dept2', name: '研發部', organization: 'org2' }
    ]
    wrapper.vm.subList = [
      { _id: 'sub1', name: '招募組', department: 'dept1' },
      { _id: 'sub2', name: '薪資組', department: 'dept1' }
    ]
    wrapper.vm.managerList = [
      { label: '王小明', value: 'e1', department: 'dept1', subDepartment: 'sub1', active: true },
      { label: '李小華', value: 'e2', department: 'dept1', subDepartment: null, active: true },
      { label: '陳大文', value: 'e3', department: 'dept2', subDepartment: null, active: true }
    ]
    await flushPromises()

    expect(treeNames(wrapper)).toEqual(['總公司', '人資部', '招募組', '薪資組', '分公司', '研發部'])
    expect(treeRow(wrapper, '總公司').find('[data-test="node-counts"]').text()).toBe('1 部門・2 小單位・2 人')
    expect(treeRow(wrapper, '人資部').find('[data-test="node-counts"]').text()).toBe('2 小單位・2 人')
    expect(treeRow(wrapper, '招募組').find('[data-test="node-counts"]').text()).toBe('1 人')
    expect(treeRow(wrapper, '研發部').find('[data-test="node-counts"]').text()).toBe('0 小單位・1 人')
    // 上方的數字是全部的筆數
    expect(wrapper.find('[data-test="stat-org"]').text()).toBe('2')
    expect(wrapper.find('[data-test="stat-dept"]').text()).toBe('2')
    expect(wrapper.find('[data-test="stat-sub"]').text()).toBe('2')
  })

  it('pre-fills the parent when a child is added from its parent row, and names the organisation of each department in the unit form', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.orgList = [{ _id: 'org1', name: '總公司' }, { _id: 'org2', name: '分公司' }]
    wrapper.vm.deptList = [
      { _id: 'dept1', name: '護理部', organization: 'org1' },
      { _id: 'dept2', name: '護理部', organization: 'org2' }
    ]
    await flushPromises()

    await treeRow(wrapper, '分公司').find('[data-test="add-child"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.dialogVisible).toBe(true)
    expect(wrapper.vm.editIndex).toBeNull()
    expect(wrapper.vm.form.organization).toBe('org2')

    const deptRows = wrapper.findAll('[data-test="org-tree"] .el-table__body tr').filter(row => row.find('[data-test="node-name"]').text() === '護理部')
    await deptRows[1].find('[data-test="add-child"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.form.department).toBe('dept2')
    // 同名的部門後面附上機構名稱才分得出來
    expect(wrapper.vm.deptSelectOptions).toEqual([
      { value: 'dept1', label: '護理部（總公司）' },
      { value: 'dept2', label: '護理部（分公司）' }
    ])
  })

  it('keeps departments and units whose parent no longer exists visible, and shows a deleted parent by name in the form instead of a raw id', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.orgList = [{ _id: 'org1', name: '總公司' }]
    wrapper.vm.deptList = [{ _id: 'dept9', name: '舊部門', organization: 'gone-org' }]
    wrapper.vm.subList = [{ _id: 'sub9', name: '舊小組', department: 'gone-dept' }]
    await flushPromises()

    expect(treeNames(wrapper)).toEqual([
      '總公司',
      '找不到所屬機構（請編輯部門重新選擇）',
      '舊部門',
      '找不到所屬部門（請編輯小單位重新選擇）',
      '舊小組'
    ])
    // 找不到的上層那一列沒有操作按鈕
    expect(treeRow(wrapper, '找不到所屬機構（請編輯部門重新選擇）').find('[data-test="edit-node"]').exists()).toBe(false)

    await treeRow(wrapper, '舊部門').find('[data-test="edit-node"]').trigger('click')
    await flushPromises()
    expect(wrapper.vm.orgSelectOptions).toEqual([
      { value: 'org1', label: '總公司' },
      { value: 'gone-org', label: '已刪除的機構' }
    ])
  })

  describe('排班人員、使用班別、使用簽核表單', () => {
    const managers = [
      { label: '王小明', value: 'e1', employeeId: 'N001', role: 'employee', active: true },
      { label: '李主管', value: 'e2', employeeId: 'S001', role: 'supervisor', active: true },
      { label: '陳離職', value: 'e3', employeeId: 'N009', role: 'employee', active: false }
    ]
    const shifts = [
      { _id: 'day', name: '白班', code: 'D', semanticType: 'work' },
      { _id: 'night', name: '大夜', code: 'N', semanticType: 'work' },
      { _id: 'rest', name: '休息日', code: '休', semanticType: 'rest_day' }
    ]
    const forms = [
      { _id: 'f1', name: '請假單', is_active: true },
      { _id: 'f2', name: '加班單', is_active: true },
      { _id: 'f3', name: '舊表單', is_active: false }
    ]

    beforeEach(() => {
      apiFetch.mockImplementation(url => {
        if (url === '/api/dept-managers') return Promise.resolve({ ok: true, json: async () => managers })
        if (url === '/api/shifts') return Promise.resolve({ ok: true, json: async () => shifts })
        if (url === '/api/approvals/forms') return Promise.resolve({ ok: true, json: async () => forms })
        return Promise.resolve({ ok: true, json: async () => [] })
      })
    })

    it('lists any active employee (with employee code) for the unit schedulers, keeping an inactive one only when already chosen', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      await wrapper.vm.openDialog('sub')
      expect(wrapper.vm.schedulerSelectOptions).toEqual([
        { value: 'e1', label: '王小明（N001）' },
        { value: 'e2', label: '李主管（S001）' }
      ])
      wrapper.vm.form.schedulers = ['e3', 'gone']
      await wrapper.vm.$nextTick()
      expect(wrapper.vm.schedulerSelectOptions).toEqual(expect.arrayContaining([
        { value: 'e3', label: '陳離職（N009）（已停用）' },
        { value: 'gone', label: '已刪除的員工' }
      ]))
    })

    it('saves the schedulers and the shifts of a unit, and copies them when editing', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      wrapper.vm.subList = [{ _id: 'sd1', name: '內科', department: 'dept1', schedulers: ['e1'], allowedShiftIds: ['night', 'rest'] }]
      await wrapper.vm.openDialog('sub', 0)
      expect(wrapper.vm.form.schedulers).toEqual(['e1'])
      expect(wrapper.vm.form.allowedShiftIds).toEqual(['night', 'rest'])
      // 選單只顯示上班的班別；舊設定裡選過的休息日照樣保留
      expect(wrapper.vm.selectedWorkShiftIds).toEqual(['night'])
      wrapper.vm.form.schedulers.push('e2')
      expect(wrapper.vm.subList[0].schedulers).toEqual(['e1'])

      // 使用班別要從選單改（直接改資料不算有改，修改時不送這個欄位）
      wrapper.vm.selectedWorkShiftIds = ['night', 'day']
      apiFetch.mockClear()
      await wrapper.vm.saveItem()
      const call = apiFetch.mock.calls.find(([url, options]) => url === '/api/sub-departments/sd1' && options?.method === 'PUT')
      expect(JSON.parse(call[1].body)).toMatchObject({ schedulers: ['e1', 'e2'], allowedShiftIds: ['night', 'day', 'rest'] })
    })

    // 以前選了班別卻沒有休息類班別時會提醒「排班時將無法排休」；現在不用上班的班別一律可以用，選單只列上班的班別
    it('lists only work shifts in 使用班別, says rest-type shifts are always available and no longer warns about a missing rest shift', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      await wrapper.vm.openDialog('sub')
      await flushPromises()
      const select = findSelect(wrapper, 'sub-allowed-shifts')
      expect(select.findAllComponents({ name: 'ElOption' }).map(option => option.props('value'))).toEqual(['day', 'night'])
      expect(wrapper.find('[data-test="sub-shift-rest-hint"]').text()).toContain('不用上班的班別一律可以使用')

      select.vm.$emit('update:modelValue', ['day', 'night'])
      await flushPromises()
      expect(wrapper.vm.form.allowedShiftIds).toEqual(['day', 'night'])
      expect(wrapper.find('[data-test="sub-shift-rest-warning"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="sub-shift-no-work-warning"]').exists()).toBe(false)
    })

    it('saves the 使用簽核表單 of a department from the active forms', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      wrapper.vm.deptList = [{ _id: 'd1', name: '護理部', organization: 'org1', allowedFormIds: ['f3'], deptManager: 'e1' }]
      await wrapper.vm.openDialog('dept', 0)
      expect(wrapper.vm.formSelectOptions).toEqual([
        { value: 'f1', label: '請假單' },
        { value: 'f2', label: '加班單' },
        { value: 'f3', label: '舊表單（已停用）' }
      ])
      expect(wrapper.vm.deptManagerOptions.map(opt => opt.value)).toEqual(['e1', 'e2'])

      wrapper.vm.form.allowedFormIds = ['f1']
      apiFetch.mockClear()
      await wrapper.vm.saveItem()
      const call = apiFetch.mock.calls.find(([url, options]) => url === '/api/departments/d1' && options?.method === 'PUT')
      expect(JSON.parse(call[1].body)).toMatchObject({ allowedFormIds: ['f1'], deptManager: 'e1' })
    })

    it('summarises the settings in the tables', async () => {
      const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
      await flushPromises()
      expect(wrapper.vm.formScopeText({ allowedFormIds: [] })).toBe('全部表單')
      expect(wrapper.vm.formScopeText({ allowedFormIds: ['f1', 'f2'] })).toBe('2 張表單')
      expect(wrapper.vm.schedulerNames({ schedulers: ['e1', 'gone'] })).toBe('王小明、已刪除的員工')
      expect(wrapper.vm.schedulerNames({})).toBe('未指定')
      expect(wrapper.vm.shiftScopeText({ allowedShiftIds: [] })).toBe('全部班別')
      // 只摘要上班的班別（休息日一律可以用，與對話框相同）
      expect(wrapper.vm.shiftScopeText({ allowedShiftIds: ['night', 'rest'] })).toBe('N')
      expect(wrapper.vm.shiftScopeText({ allowedShiftIds: ['rest'] })).toBe('沒有上班班別')
    })
  })

  // 2026/11：篩選改成在畫面上篩（以前換篩選會重新向伺服器要一份縮小的清單，上方的數字和其他分頁的選單跟著變少）
  it('filters the tree by organisation and by keyword without refetching, and the counters keep showing the totals', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    wrapper.vm.orgList = [{ _id: 'org1', name: '總公司' }, { _id: 'org2', name: '分公司' }]
    wrapper.vm.deptList = [
      { _id: 'd1', name: '人資部', organization: 'org1' },
      { _id: 'd2', name: '財務部', organization: 'org2', code: 'FIN' }
    ]
    wrapper.vm.subList = [{ _id: 's1', name: '出納組', department: 'd2' }]
    await flushPromises()
    apiFetch.mockClear()

    wrapper.vm.selectedOrg = 'org2'
    await flushPromises()
    expect(treeNames(wrapper)).toEqual(['分公司', '財務部', '出納組'])

    wrapper.vm.selectedOrg = ''
    wrapper.vm.keyword = '出納'
    await flushPromises()
    // 符合的小單位連同它的上層一起留下
    expect(treeNames(wrapper)).toEqual(['分公司', '財務部', '出納組'])

    wrapper.vm.keyword = 'fin'
    await flushPromises()
    expect(treeNames(wrapper)).toEqual(['分公司', '財務部', '出納組'])

    wrapper.vm.keyword = '沒有這個名稱'
    await flushPromises()
    expect(treeNames(wrapper)).toEqual([])
    expect(wrapper.find('[data-test="org-tree-empty"]').text()).toBe('找不到符合的機構、部門或小單位')

    expect(apiFetch).not.toHaveBeenCalled()
    expect(wrapper.vm.deptList).toHaveLength(2)
    expect(wrapper.find('[data-test="stat-dept"]').text()).toBe('2')
  })

  it('asks before deleting, says what is lost, shows the reason of the server when it refuses, and reloads the lists', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm')
    const alert = vi.spyOn(ElMessageBox, 'alert').mockResolvedValue('confirm')
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    const successSpy = vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    let deleteResponse = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) })
    apiFetch.mockImplementation((url, options = {}) => {
      if (options.method === 'DELETE') return deleteResponse()
      if (url === '/api/organizations') return Promise.resolve({ ok: true, json: async () => [{ _id: 'org1', name: '總公司' }] })
      if (url === '/api/departments') return Promise.resolve({ ok: true, json: async () => [{ _id: 'd1', name: '人資部', organization: 'org1' }] })
      if (url === '/api/sub-departments') return Promise.resolve({ ok: true, json: async () => [{ _id: 's1', name: '招募組', department: 'd1' }] })
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    const deletes = () => apiFetch.mock.calls.filter(([, options]) => options?.method === 'DELETE')

    // 底下還有小單位的部門：不能刪，說明原因，不送出請求
    await treeRow(wrapper, '人資部').find('[data-test="delete-node"]').trigger('click')
    await flushPromises()
    expect(alert).toHaveBeenCalledTimes(1)
    expect(alert.mock.calls[0][0]).toBe('「人資部」還有 1 個小單位，請先把它們移到其他部門或刪除後，再刪除這個部門')
    expect(confirm).not.toHaveBeenCalled()
    expect(deletes()).toHaveLength(0)

    // 取消確認：不送出
    confirm.mockRejectedValueOnce('cancel')
    await treeRow(wrapper, '招募組').find('[data-test="delete-node"]').trigger('click')
    await flushPromises()
    expect(confirm.mock.calls[0][0]).toBe('確定要刪除小單位「招募組」嗎？這個小單位的排班人員與使用班別設定會一併刪除，被指定的排班人員不能再排這個小單位，無法復原。')
    expect(deletes()).toHaveLength(0)

    // 伺服器拒絕（還有員工、或簽核流程指定了這個小單位）：顯示它的原因
    deleteResponse = () => Promise.resolve({
      ok: false,
      status: 409,
      json: async () => ({ error: '「招募組」還有 2 位員工在使用，請先把員工移到其他小單位、調整簽核流程後，再刪除這個小單位', code: 'IN_USE' })
    })
    await treeRow(wrapper, '招募組').find('[data-test="delete-node"]').trigger('click')
    await flushPromises()
    expect(deletes()).toHaveLength(1)
    expect(deletes()[0][0]).toBe('/api/sub-departments/s1')
    expect(errorSpy).toHaveBeenLastCalledWith('「招募組」還有 2 位員工在使用，請先把員工移到其他小單位、調整簽核流程後，再刪除這個小單位')
    expect(successSpy).not.toHaveBeenCalled()
    expect(treeNames(wrapper)).toContain('招募組')

    // 成功：提示並重新讀清單（不是只把畫面上那一列拿掉）
    deleteResponse = () => Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) })
    const listCallsBefore = apiFetch.mock.calls.filter(([url]) => url === '/api/sub-departments').length
    await treeRow(wrapper, '招募組').find('[data-test="delete-node"]').trigger('click')
    await flushPromises()
    expect(deletes()).toHaveLength(2)
    expect(successSpy).toHaveBeenLastCalledWith('已刪除小單位')
    expect(apiFetch.mock.calls.filter(([url]) => url === '/api/sub-departments').length).toBe(listCallsBefore + 1)
  })

  it('sends a save only once when the button is pressed twice', async () => {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openDialog('org')
    wrapper.vm.form.name = '新機構'
    apiFetch.mockClear()

    const first = wrapper.vm.saveItem()
    const second = wrapper.vm.saveItem()
    await Promise.all([first, second])

    expect(apiFetch.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1)
  })
})

// 客戶 2026/11：「將人力需求下面的排班拿掉，因為我們應該是使用最下方的使用班別」「可以把一些沒有功能性的拿掉」；
// 不用上班的班別一律可以用；儲存失敗要看得到伺服器的原因
describe('OrgDepartmentSetting.vue 小單位設定只留有功能的欄位', () => {
  const DEPARTMENTS = [{ _id: '6650000000000000000000d1', name: '護理部', organization: '6650000000000000000000a1' }]
  const SHIFTS = [
    { _id: 'day', name: '白班', code: 'D', semanticType: 'work', startTime: '08:00', endTime: '16:00' },
    { _id: 'night', name: '大夜', code: 'N', semanticType: 'work', startTime: '00:00', endTime: '08:00', crossDay: false },
    { _id: 'rest', name: '休息日', code: '休', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
    { _id: 'regular', name: '例假', code: '例', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
    { _id: 'holiday', name: '國定假日', code: '國', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
    { _id: 'personal', name: '事假', code: '事', semanticType: 'leave', startTime: '00:00', endTime: '00:00' }
  ]
  const MANAGERS = [{ label: '王小明', value: '6650000000000000000000e1', employeeId: 'N001', role: 'employee', active: true }]
  // GET /api/sub-departments 回傳的樣子（formatSubDepartment：含 shift 與 shiftId、時間戳記）
  const realUnit = overrides => ({
    _id: '6650000000000000000000b1',
    department: DEPARTMENTS[0]._id,
    code: 'B1',
    name: 'B1 病房',
    unitName: '舊單位名稱',
    institutionCode: 'IC-9',
    uniformNumber: '12345678',
    laborInsuranceNumber: 'LAB-1',
    healthInsuranceNumber: 'HEA-1',
    taxRegistrationNumber: 'TAX-1',
    location: '三樓',
    phone: '02-1234-5678',
    responsiblePerson: '林負責',
    manager: '王組長',
    headcount: 12,
    shift: 'day',
    shiftId: 'day',
    scheduleSetting: '舊排班設定',
    schedulers: [MANAGERS[0].value],
    allowedShiftIds: ['night', 'rest'],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    __v: 0,
    ...overrides
  })
  let units
  let saveResponse

  beforeEach(() => {
    apiFetch.mockClear()
    units = [realUnit()]
    saveResponse = () => Promise.resolve({ ok: true, status: 200, json: async () => units[0] })
    apiFetch.mockImplementation((url, options = {}) => {
      const path = String(url).split('?')[0]
      if (options.method === 'PUT' || options.method === 'POST') return saveResponse(url, options)
      if (path === '/api/departments') return Promise.resolve({ ok: true, json: async () => DEPARTMENTS })
      if (path === '/api/sub-departments') return Promise.resolve({ ok: true, json: async () => units })
      if (path === '/api/shifts') return Promise.resolve({ ok: true, json: async () => SHIFTS })
      if (path === '/api/dept-managers') return Promise.resolve({ ok: true, json: async () => MANAGERS })
      return Promise.resolve({ ok: true, json: async () => [] })
    })
  })

  afterEach(() => {
    ElMessage.closeAll()
    document.body.innerHTML = ''
  })

  async function mountAndOpenUnit() {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] }, attachTo: document.body })
    await flushPromises()
    await wrapper.vm.openDialog('sub', 0)
    await flushPromises()
    return wrapper
  }

  const lastSave = () => {
    const call = apiFetch.mock.calls.filter(([, options]) => options?.method === 'PUT' || options?.method === 'POST').at(-1)
    return call ? { url: call[0], method: call[1].method, body: JSON.parse(call[1].body) } : null
  }

  it('shows only 所屬部門／名稱／代碼／排班人員／使用班別 in the dialog and drops the non-functional table columns', async () => {
    const wrapper = await mountAndOpenUnit()
    const labels = wrapper.findAll('.dialog-form .el-form-item__label').map(label => label.text())
    expect(labels).toEqual(['所屬部門', '小單位名稱', '代碼', '排班人員', '使用班別'])
    const dialogText = wrapper.find('.dialog-form').text()
    // （「單位名稱」是「小單位名稱」的一部分，已由上面的欄位清單檢查）
    for (const removed of ['班表拉選', '人力需求數', '部門主管', '負責人', '機構代碼', '統一編號', '勞保證號', '健保編號', '稅籍編號', '連絡電話', '位置']) {
      expect(dialogText).not.toContain(removed)
    }
    // 排班人員的說明不再提「部門主管」欄位，改說簽核看員工資料的直屬主管
    const schedulerHint = wrapper.find('[data-test="sub-schedulers-hint"]').text()
    expect(schedulerHint).toContain('員工資料設定的直屬主管')
    expect(schedulerHint).not.toContain('「部門主管」')

    // 2026/11：小單位列在階層表裡（機構 › 部門 › 小單位），欄位是名稱、代碼、排班、可使用、包含、操作
    const tree = wrapper.find('[data-test="org-tree"]')
    const headers = tree.findAll('thead th').map(th => th.text()).filter(Boolean)
    expect(headers).toEqual(['名稱', '代碼', '排班', '可使用', '包含', '操作'])
    const unitRow = tree.findAll('.el-table__body tr').find(row => row.text().includes('B1 病房'))
    expect(unitRow.text()).toContain('排班人員：王小明')
    expect(tree.text()).not.toContain('舊單位名稱')
    for (const hidden of ['IC-9', '12345678', '三樓', '林負責', '王組長', '舊排班設定']) {
      expect(tree.text()).not.toContain(hidden)
    }
    // 列表的使用班別只摘要上班的班別
    expect(unitRow.find('[data-test="sub-shift-scope"]').text()).toBe('N')
    wrapper.unmount()
  })

  it('saves an untouched unit with only the shown fields, so the hidden values and the shift selection stay on the server', async () => {
    const wrapper = await mountAndOpenUnit()
    expect(wrapper.vm.selectedWorkShiftIds).toEqual(['night'])
    await wrapper.vm.saveItem()
    expect(lastSave()).toEqual({
      url: `/api/sub-departments/${units[0]._id}`,
      method: 'PUT',
      body: { department: DEPARTMENTS[0]._id, name: 'B1 病房', code: 'B1', schedulers: [MANAGERS[0].value] }
    })
    expect(wrapper.vm.dialogVisible).toBe(false)
    wrapper.unmount()
  })

  it('keeps an old rest shift of the selection when the work shifts change, and clearing the selection means every shift', async () => {
    const wrapper = await mountAndOpenUnit()
    const select = findSelect(wrapper, 'sub-allowed-shifts')
    expect(select.props('modelValue')).toEqual(['night'])
    expect(select.findAllComponents({ name: 'ElOption' }).map(option => option.props('value'))).toEqual(['day', 'night'])

    select.vm.$emit('update:modelValue', ['day'])
    await flushPromises()
    await wrapper.vm.saveItem()
    expect(lastSave().body.allowedShiftIds).toEqual(['day', 'rest'])

    await wrapper.vm.openDialog('sub', 0)
    await flushPromises()
    findSelect(wrapper, 'sub-allowed-shifts').vm.$emit('update:modelValue', [])
    await flushPromises()
    await wrapper.vm.saveItem()
    expect(lastSave().body.allowedShiftIds).toEqual([])
    wrapper.unmount()
  })

  it('warns when a saved selection has no work shift left (deleted shifts or rest shifts only) and still saves the rest untouched', async () => {
    units = [realUnit({ allowedShiftIds: ['rest', '6650000000000000000000ff'] })]
    const wrapper = await mountAndOpenUnit()
    expect(wrapper.find('[data-test="sub-shift-no-work-warning"]').exists()).toBe(true)
    expect(wrapper.vm.shiftScopeText(units[0])).toBe('沒有上班班別')
    // 沒改使用班別：不送這個欄位（已刪除的班別不會讓存檔失敗）
    await wrapper.vm.saveItem()
    expect(lastSave().body).not.toHaveProperty('allowedShiftIds')

    await wrapper.vm.openDialog('sub', 0)
    await flushPromises()
    findSelect(wrapper, 'sub-allowed-shifts').vm.$emit('update:modelValue', ['day'])
    await flushPromises()
    expect(wrapper.find('[data-test="sub-shift-no-work-warning"]').exists()).toBe(false)
    await wrapper.vm.saveItem()
    // 已刪除的班別去掉，休息日保留
    expect(lastSave().body.allowedShiftIds).toEqual(['day', 'rest'])
    wrapper.unmount()
  })

  it('shows the Chinese message of the server when a save fails and keeps the dialog open', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error')
    saveResponse = () => Promise.resolve({ ok: false, status: 400, json: async () => ({ error: '使用班別包含不存在的班別，請重新選擇' }) })
    const wrapper = await mountAndOpenUnit()
    await wrapper.vm.saveItem()
    expect(errorSpy).toHaveBeenLastCalledWith('使用班別包含不存在的班別，請重新選擇')
    expect(wrapper.vm.dialogVisible).toBe(true)
    await flushPromises()
    expect(document.body.textContent).toContain('使用班別包含不存在的班別，請重新選擇')

    // Mongoose 驗證訊息：去掉英文前綴，只留各欄位的中文說明
    saveResponse = () => Promise.resolve({
      ok: false,
      status: 400,
      json: async () => ({ error: 'SubDepartment validation failed: uniformNumber: 統一編號需為 8 碼數字, phone: 連絡電話格式不正確' })
    })
    await wrapper.vm.saveItem()
    expect(errorSpy).toHaveBeenLastCalledWith('統一編號需為 8 碼數字；連絡電話格式不正確')

    saveResponse = () => Promise.resolve({
      ok: false,
      status: 400,
      json: async () => ({ error: 'SubDepartment validation failed: name: Path `name` is required.' })
    })
    await wrapper.vm.saveItem()
    expect(errorSpy).toHaveBeenLastCalledWith('請填寫必填欄位（標示 * 的欄位）')

    saveResponse = () => Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'Not found' }) })
    await wrapper.vm.saveItem()
    expect(errorSpy).toHaveBeenLastCalledWith('找不到這筆資料，可能已被處理或刪除，請重新整理')

    saveResponse = () => Promise.reject(new TypeError('Failed to fetch'))
    await wrapper.vm.saveItem()
    expect(errorSpy).toHaveBeenLastCalledWith('網路連線異常，請確認網路後再試一次')
    expect(wrapper.vm.dialogVisible).toBe(true)
    wrapper.unmount()
  })

  it('shows the server message for an organisation or department save as well', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error')
    saveResponse = () => Promise.resolve({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Department validation failed: uniformNumber: 統一編號需為 8 碼數字' })
    })
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    await wrapper.vm.openDialog('dept', 0)
    await wrapper.vm.saveItem()
    expect(errorSpy).toHaveBeenLastCalledWith('統一編號需為 8 碼數字')
    expect(wrapper.vm.dialogVisible).toBe(true)
    wrapper.unmount()
  })
})

// 客戶 2026/11「可以把一些沒有功能性的拿掉」「避免他們混淆」，開發端同意部門與機構的對話框也一樣處理：
// 只留有功能的欄位；不顯示的欄位資料保留（存檔只送畫面上的欄位，伺服器只更新有送的欄位）
describe('OrgDepartmentSetting.vue 部門與機構設定只留有功能的欄位', () => {
  const ORG_ID = '6650000000000000000000a1'
  const MANAGERS = [
    { label: '王小明', value: '6650000000000000000000e1', employeeId: 'N001', role: 'employee', active: true },
    { label: '李主管', value: '6650000000000000000000e2', employeeId: 'S001', role: 'supervisor', active: true }
  ]
  const FORMS = [{ _id: '6650000000000000000000f1', name: '請假單', is_active: true }]
  // GET /api/organizations、/api/departments 回傳的樣子（Mongoose 文件：含所有舊欄位、時間戳記）
  const realOrg = overrides => ({
    _id: ORG_ID,
    name: '迦南醫院',
    systemCode: 'SYS-01',
    unitName: '醫療部門',
    orgCode: 'ORG-01',
    taxIdNumber: '12345678',
    laborInsuranceNo: 'L-001',
    healthInsuranceNo: 'H-001',
    taxCode: 'T-001',
    address: '屏東縣',
    phone: '08-7654321',
    principal: '陳院長',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    __v: 0,
    ...overrides
  })
  const realDept = overrides => ({
    _id: '6650000000000000000000d1',
    name: '護理部',
    code: 'NUR',
    unitName: '護理單位',
    institutionCode: 'IC-9',
    uniformNumber: '87654321',
    laborInsuranceNumber: 'LAB-1',
    healthInsuranceNumber: 'HEA-1',
    taxRegistrationNumber: 'TAX-1',
    location: '三樓',
    phone: '02-1234-5678',
    responsiblePerson: '林負責',
    manager: '王護理長',
    defaultTwoDayOff: false,
    tempChangeAllowed: true,
    deptManager: MANAGERS[1].value,
    allowedFormIds: [FORMS[0]._id],
    scheduleNotes: '11/3 與 B 組調班',
    organization: ORG_ID,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    __v: 0,
    ...overrides
  })
  let orgs
  let depts

  beforeEach(() => {
    apiFetch.mockClear()
    orgs = [realOrg()]
    depts = [realDept()]
    apiFetch.mockImplementation((url, options = {}) => {
      const path = String(url).split('?')[0]
      if (options.method === 'PUT' || options.method === 'POST') {
        return Promise.resolve({ ok: true, status: options.method === 'POST' ? 201 : 200, json: async () => JSON.parse(options.body) })
      }
      if (path === '/api/organizations') return Promise.resolve({ ok: true, json: async () => orgs })
      if (path === '/api/departments') return Promise.resolve({ ok: true, json: async () => depts })
      if (path === '/api/dept-managers') return Promise.resolve({ ok: true, json: async () => MANAGERS })
      if (path === '/api/approvals/forms') return Promise.resolve({ ok: true, json: async () => FORMS })
      return Promise.resolve({ ok: true, json: async () => [] })
    })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  async function mountPage() {
    const wrapper = mount(OrgDepartmentSetting, { global: { plugins: [ElementPlus] }, attachTo: document.body })
    await flushPromises()
    return wrapper
  }

  const lastSave = () => {
    const call = apiFetch.mock.calls.filter(([, options]) => options?.method === 'PUT' || options?.method === 'POST').at(-1)
    return call ? { url: call[0], method: call[1].method, body: JSON.parse(call[1].body) } : null
  }
  const dialogLabels = wrapper => wrapper.findAll('.dialog-form .el-form-item__label').map(label => label.text())
  const headersOf = table => table.findAll('thead th').map(th => th.text()).filter(Boolean)

  it('shows only the functional department fields, explains the 排班管理者, and drops the non-functional columns', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openDialog('dept', 0)
    await flushPromises()
    expect(dialogLabels(wrapper)).toEqual(['所屬機構', '部門名稱', '部門代碼', '單位名稱', '排班管理者', '排班備註', '使用簽核表單'])
    const dialogText = wrapper.find('.dialog-form').text()
    for (const removed of ['位置', '連絡電話', '部門主管', '負責人', '機構代碼', '統一編號', '勞保證號', '健保編號', '稅籍編號', '預設週休二日', '允許臨時調班', '法規資訊']) {
      expect(dialogText).not.toContain(removed)
    }
    // 排班管理者：整個部門（所有小單位與沒有小單位的員工），與是不是主管無關；簽核看每位員工的直屬主管
    const hint = wrapper.find('[data-test="dept-manager-hint"]').text()
    expect(hint).toContain('不論是不是主管')
    expect(hint).toContain('整個部門')
    expect(hint).toContain('所有小單位的員工')
    expect(hint).toContain('沒有小單位的員工')
    expect(hint).toContain('簽核找的是每位員工資料設定的直屬主管')
    expect(wrapper.find('[data-test="dept-code-hint"]').text()).toContain('員工批次匯入')
    expect(wrapper.find('[data-test="dept-unit-name-hint"]').text()).toContain('匯出排班表')

    // 2026/11：部門列在階層表裡，帶出排班管理者與使用簽核表單
    const tree = wrapper.find('[data-test="org-tree"]')
    expect(headersOf(tree)).toEqual(['名稱', '代碼', '排班', '可使用', '包含', '操作'])
    const deptRow = tree.findAll('.el-table__body tr').find(row => row.text().includes('護理部'))
    expect(deptRow.text()).toContain('護理單位')
    expect(deptRow.text()).toContain('NUR')
    expect(deptRow.find('[data-test="dept-manager-name"]').text()).toBe('排班管理者：李主管')
    expect(deptRow.find('[data-test="dept-form-scope"]').text()).toBe('簽核表單：1 張表單')
    for (const hidden of ['IC-9', '87654321', '三樓', '林負責', '王護理長']) {
      expect(tree.text()).not.toContain(hidden)
    }
    wrapper.unmount()
  })

  it('shows only the functional organisation fields and drops the 連絡電話 and 負責人 columns', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openDialog('org', 0)
    await flushPromises()
    expect(dialogLabels(wrapper)).toEqual(['機構名稱', '系統代碼', '單位名稱', '機構代碼'])
    const dialogText = wrapper.find('.dialog-form').text()
    for (const removed of ['統一編號', '勞保編號', '健保編號', '稅籍編號', '位置', '連絡電話', '負責人', '證照資訊', '聯絡資訊']) {
      expect(dialogText).not.toContain(removed)
    }
    expect(wrapper.find('[data-test="org-import-hint"]').text()).toContain('員工批次匯入')

    const tree = wrapper.find('[data-test="org-tree"]')
    const orgRow = tree.findAll('.el-table__body tr').find(row => row.text().includes('迦南醫院'))
    expect(orgRow.text()).toContain('SYS-01')
    expect(orgRow.find('[data-test="node-counts"]').text()).toBe('1 部門・0 小單位・0 人')
    expect(tree.text()).not.toContain('08-7654321')
    expect(tree.text()).not.toContain('陳院長')
    wrapper.unmount()
  })

  it('saves an edited department with only the shown fields, so the hidden values stay on the server', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openDialog('dept', 0)
    expect(wrapper.vm.form).toEqual({
      organization: ORG_ID,
      name: '護理部',
      code: 'NUR',
      unitName: '護理單位',
      deptManager: MANAGERS[1].value,
      scheduleNotes: '11/3 與 B 組調班',
      allowedFormIds: [FORMS[0]._id]
    })
    wrapper.vm.form.scheduleNotes = '11/3 與 B 組調班；11/10 與 C 組調班'
    await wrapper.vm.saveItem()
    expect(lastSave()).toEqual({
      url: `/api/departments/${depts[0]._id}`,
      method: 'PUT',
      body: {
        organization: ORG_ID,
        name: '護理部',
        code: 'NUR',
        unitName: '護理單位',
        deptManager: MANAGERS[1].value,
        scheduleNotes: '11/3 與 B 組調班；11/10 與 C 組調班',
        allowedFormIds: [FORMS[0]._id]
      }
    })
    expect(wrapper.vm.dialogVisible).toBe(false)
    wrapper.unmount()
  })

  it('really clears the 排班管理者 when the select is cleared (the select gives undefined, which JSON would drop)', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openDialog('dept', 0)
    await flushPromises()
    findSelect(wrapper, 'dept-manager-select').vm.$emit('update:modelValue', undefined)
    await flushPromises()
    await wrapper.vm.saveItem()
    expect(lastSave().body).toHaveProperty('deptManager', '')
    wrapper.unmount()
  })

  it('creates a department without the hidden fields, so the database defaults apply as before', async () => {
    const wrapper = await mountPage()
    wrapper.vm.selectedOrg = ORG_ID
    await flushPromises()
    await wrapper.vm.openDialog('dept')
    wrapper.vm.form.name = '藥劑部'
    wrapper.vm.form.code = 'PHA'
    await wrapper.vm.saveItem()
    expect(lastSave()).toEqual({
      url: '/api/departments',
      method: 'POST',
      body: { organization: ORG_ID, name: '藥劑部', code: 'PHA', unitName: '', deptManager: '', scheduleNotes: '', allowedFormIds: [] }
    })
    wrapper.unmount()
  })

  it('saves an organisation with only 名稱、系統代碼、單位名稱、機構代碼, both when editing and when creating', async () => {
    const wrapper = await mountPage()
    await wrapper.vm.openDialog('org', 0)
    expect(wrapper.vm.form).toEqual({ name: '迦南醫院', systemCode: 'SYS-01', unitName: '醫療部門', orgCode: 'ORG-01' })
    wrapper.vm.form.orgCode = 'ORG-02'
    await wrapper.vm.saveItem()
    expect(lastSave()).toEqual({
      url: `/api/organizations/${ORG_ID}`,
      method: 'PUT',
      body: { name: '迦南醫院', systemCode: 'SYS-01', unitName: '醫療部門', orgCode: 'ORG-02' }
    })

    await wrapper.vm.openDialog('org')
    wrapper.vm.form.name = '迦南護理之家'
    await wrapper.vm.saveItem()
    expect(lastSave()).toEqual({
      url: '/api/organizations',
      method: 'POST',
      body: { name: '迦南護理之家', systemCode: '', unitName: '', orgCode: '' }
    })
    wrapper.unmount()
  })

  it('explains the slimmer organisation and department settings in the page help', () => {
    const help = backendHelpContent.OrgDepartmentSetting
    const text = [help.description, ...help.scenarios, ...help.tips, ...help.steps].join('\n')
    expect(text).toContain('機構只需設定名稱、系統代碼、單位名稱與機構代碼')
    expect(text).toContain('部門只需設定所屬機構')
    // 說明改寫成頁面現在的樣子：不再列出以前隱藏的舊欄位（預設週休二日、允許臨時調班…）
    expect(text).not.toContain('已不顯示')
    expect(text).toContain('同一棵樹')
    expect(text).toContain('排班管理者」不論是不是主管，都可以排整個部門的班')
    expect(text).toContain('沒有小單位的員工')
    expect(text).toContain('簽核找的是員工資料設定的直屬主管')
  })
})
