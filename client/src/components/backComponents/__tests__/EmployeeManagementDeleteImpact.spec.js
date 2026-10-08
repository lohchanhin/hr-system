import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import * as apiModule from '../../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

vi.mock('element-plus', () => ({
  ElMessage: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  ElMessageBox: {
    confirm: vi.fn(() => Promise.resolve('confirm')),
    prompt: vi.fn(() => Promise.resolve({ value: '刪除', action: 'confirm' })),
    alert: vi.fn(() => Promise.resolve())
  }
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() })
}))

import EmployeeManagement from '../EmployeeManagement.vue'

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-button': { template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' },
  'el-dialog': { template: '<div class="el-dialog-stub"><slot /><slot name="footer" /></div>', props: ['modelValue'] },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': { template: '<div class="el-form-item-stub"><slot /></div>' },
  'el-input': { template: '<input />', props: ['modelValue'] },
  'el-select': { template: '<select><slot /></select>', props: ['modelValue'] },
  'el-option': { template: '<option><slot /></option>' },
  'el-upload': { template: '<div class="el-upload-stub"><slot /><slot name="tip" /></div>' },
  'el-alert': { template: '<div class="el-alert-stub"><slot name="title" /><slot /></div>' },
  'el-switch': { template: '<input type="checkbox" />', props: ['modelValue'] },
  'el-avatar': { template: '<div class="el-avatar-stub"><slot /></div>' },
  'el-tag': { template: '<span><slot /></span>' },
  'el-radio-group': { template: '<div class="el-radio-group-stub"><slot /></div>' },
  'el-radio': { template: '<label class="el-radio-stub"><slot /></label>' },
  'el-date-picker': { template: '<input type="date" />', props: ['modelValue'] },
  'el-input-number': { template: '<input type="number" />', props: ['modelValue'] },
  'el-pagination': { template: '<div class="el-pagination-stub" />' },
  'el-table': { template: '<div class="el-table-stub"><slot :row="{}" :$index="0" /></div>' },
  'el-table-column': { template: '<div class="el-table-column-stub"><slot :row="{}" :$index="0" /></div>' }
}

function createApiResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const EMPLOYEES = [
  { _id: 'emp1', name: '王主管', employeeId: 'E001', role: 'supervisor' },
  { _id: 'emp2', name: '李人資', employeeId: 'E002', role: 'employee' },
  { _id: 'adm1', name: '管理員', employeeId: 'A001', role: 'admin' }
]

const IMPACT_MESSAGES = [
  '有 2 筆進行中的簽核單正在等這些員工簽核（王主管 2 筆），刪除後這些單會失去簽核人而卡住，請先處理或改由管理員代簽。',
  '有 3 位員工的直屬主管是這次要刪除的人，刪除後他們沒有直屬主管，送出需要主管簽核的申請會被擋下，請重新指定主管。'
]

describe('EmployeeManagement - 刪除員工前的簽核影響', () => {
  let apiFetchMock
  let impactResponse
  let deleteResponse
  let bulkDeleteResponse
  let wrapper

  const mountComponent = async () => {
    wrapper = shallowMount(EmployeeManagement, {
      global: { stubs: { transition: false, teleport: false, ...elementStubs } }
    })
    await flushPromises()
    ;[ElMessage.success, ElMessage.error, ElMessage.warning, ElMessage.info].forEach(fn => fn.mockClear())
    return wrapper
  }

  const callsTo = (matcher) => apiFetchMock.mock.calls.filter(([path, options]) => matcher(path, options))
  const impactCalls = () => callsTo(path => path === '/api/employees/delete-impact')
  const deleteCalls = () => callsTo((path, options) => options?.method === 'DELETE')
  const bulkDeleteCalls = () => callsTo(path => path === '/api/employees/bulk-delete')

  beforeEach(() => {
    impactResponse = () => createApiResponse({ requested: 1, impact: { messages: IMPACT_MESSAGES } })
    deleteResponse = () => createApiResponse({ success: true, unassignedSubordinates: 0, impact: { messages: [] }, warnings: [] })
    bulkDeleteResponse = () => createApiResponse({
      requested: 2,
      deletedCount: 2,
      deleted: [{ _id: 'emp1' }, { _id: 'emp2' }],
      skipped: [],
      unassignedSubordinates: 0,
      impact: { messages: [] },
      warnings: []
    })
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (path, options) => {
      const cleanPath = typeof path === 'string' ? path.split('?')[0] : path
      if (cleanPath === '/api/employees/delete-impact') return impactResponse(options)
      if (cleanPath === '/api/employees/bulk-delete') return bulkDeleteResponse(options)
      if (options?.method === 'DELETE') return deleteResponse(options)
      if (cleanPath === '/api/employees') {
        return createApiResponse({
          employees: EMPLOYEES,
          pagination: { total: EMPLOYEES.length, page: 1, pageSize: 20, totalPages: 1 }
        })
      }
      if (cleanPath === '/api/other-control-settings/item-settings') {
        return createApiResponse({ itemSettings: {} })
      }
      return createApiResponse([])
    })
    ElMessageBox.confirm.mockReset().mockResolvedValue('confirm')
    ElMessageBox.prompt.mockReset().mockResolvedValue({ value: '刪除', action: 'confirm' })
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    apiFetchMock.mockRestore()
  })

  describe('單筆刪除', () => {
    it('刪除前一定會跳出確認視窗，並列出簽核影響；確認後才送出刪除', async () => {
      await mountComponent()
      await wrapper.vm.deleteEmployee('emp1')
      await flushPromises()

      expect(impactCalls()).toHaveLength(1)
      expect(JSON.parse(impactCalls()[0][1].body)).toEqual({ ids: ['emp1'] })
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
      expect(title).toBe('確認刪除員工')
      expect(message).toContain('王主管（E001）')
      expect(message).toContain('此操作無法復原')
      expect(message).toContain('【簽核影響】')
      IMPACT_MESSAGES.forEach(line => expect(message).toContain(`・${line}`))
      expect(options.type).toBe('warning')
      expect(options.dangerouslyUseHTMLString).toBeUndefined()
      expect(deleteCalls()).toHaveLength(1)
      expect(deleteCalls()[0][0]).toBe('/api/employees/emp1')
      expect(ElMessage.success).toHaveBeenCalledWith('刪除成功')
    })

    it('按取消就不會送出刪除', async () => {
      ElMessageBox.confirm.mockRejectedValue('cancel')
      await mountComponent()
      await wrapper.vm.deleteEmployee('emp1')
      await flushPromises()

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      expect(deleteCalls()).toHaveLength(0)
      expect(ElMessage.success).not.toHaveBeenCalled()
    })

    it('沒有簽核影響時，確認視窗不顯示「簽核影響」區塊', async () => {
      impactResponse = () => createApiResponse({ requested: 1, impact: { messages: [] } })
      await mountComponent()
      await wrapper.vm.deleteEmployee('emp2')
      await flushPromises()

      const [message] = ElMessageBox.confirm.mock.calls[0]
      expect(message).not.toContain('簽核影響')
      expect(deleteCalls()).toHaveLength(1)
    })

    it.each([
      ['預覽 API 回 500', () => createApiResponse({ error: 'boom' }, 500)],
      ['預覽 API 回傳格式不對', () => createApiResponse(['x'])],
      ['預覽 API 連線失敗', () => { throw new Error('network down') }]
    ])('%s：不擋刪除，確認視窗照常顯示', async (_label, response) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      impactResponse = response
      await mountComponent()
      await wrapper.vm.deleteEmployee('emp1')
      await flushPromises()

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      expect(ElMessageBox.confirm.mock.calls[0][0]).not.toContain('簽核影響')
      expect(deleteCalls()).toHaveLength(1)
      warn.mockRestore()
    })

    it('刪除完成後再次提醒簽核影響與失去主管的人數', async () => {
      deleteResponse = () => createApiResponse({
        success: true,
        unassignedSubordinates: 3,
        impact: { messages: IMPACT_MESSAGES },
        warnings: []
      })
      await mountComponent()
      await wrapper.vm.deleteEmployee('emp1')
      await flushPromises()

      expect(ElMessage.warning).toHaveBeenCalledTimes(1)
      const warning = ElMessage.warning.mock.calls[0][0]
      expect(warning.message).toContain('2 筆進行中的簽核單')
      expect(ElMessage.info).toHaveBeenCalledTimes(1)
      expect(ElMessage.info.mock.calls[0][0].message).toContain('3 位員工的直屬主管已被刪除')
    })

    it('管理員帳戶不會跳出確認視窗，也不會查詢影響', async () => {
      await mountComponent()
      await wrapper.vm.deleteEmployee('adm1')

      expect(ElMessage.warning).toHaveBeenCalledWith('管理員帳戶不可刪除')
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(impactCalls()).toHaveLength(0)
      expect(deleteCalls()).toHaveLength(0)
    })

    it('刪除失敗時顯示伺服器的錯誤訊息', async () => {
      deleteResponse = () => createApiResponse({ error: '管理員帳戶不可刪除' }, 403)
      await mountComponent()
      await wrapper.vm.deleteEmployee('emp1')
      await flushPromises()

      expect(ElMessage.error).toHaveBeenCalledWith('管理員帳戶不可刪除')
    })
  })

  describe('批量刪除', () => {
    const selectRows = async (...ids) => {
      wrapper.vm.handleEmployeeSelectionChange(EMPLOYEES.filter(emp => ids.includes(emp._id)))
      await flushPromises()
    }

    it('確認視窗列出簽核影響；預覽查詢送的是即將刪除的員工', async () => {
      await mountComponent()
      await selectRows('emp1', 'emp2')
      await wrapper.vm.handleBulkDelete()
      await flushPromises()

      expect(JSON.parse(impactCalls()[0][1].body)).toEqual({ ids: ['emp1', 'emp2'] })
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      const [message] = ElMessageBox.confirm.mock.calls[0]
      expect(message).toContain('即將刪除 2 位員工')
      expect(message).toContain('【簽核影響】')
      IMPACT_MESSAGES.forEach(line => expect(message).toContain(`・${line}`))
      expect(bulkDeleteCalls()).toHaveLength(1)
    })

    it('超過 10 位時簽核影響也會顯示在需要輸入「刪除」的視窗裡', async () => {
      const many = Array.from({ length: 11 }, (_, i) => ({ _id: `m${i}`, name: `員工${i}`, employeeId: `M${i}`, role: 'employee' }))
      await mountComponent()
      wrapper.vm.handleEmployeeSelectionChange(many)
      await flushPromises()
      await wrapper.vm.handleBulkDelete()
      await flushPromises()

      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(ElMessageBox.prompt).toHaveBeenCalledTimes(1)
      const [message] = ElMessageBox.prompt.mock.calls[0]
      expect(message).toContain('【簽核影響】')
      expect(message).toContain('請在下方輸入「刪除」以確認')
    })

    it('取消時不會送出批量刪除', async () => {
      ElMessageBox.confirm.mockRejectedValue('cancel')
      await mountComponent()
      await selectRows('emp1', 'emp2')
      await wrapper.vm.handleBulkDelete()
      await flushPromises()

      expect(bulkDeleteCalls()).toHaveLength(0)
    })

    it('預覽失敗不擋刪除', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      impactResponse = () => createApiResponse({ error: 'boom' }, 500)
      await mountComponent()
      await selectRows('emp1', 'emp2')
      await wrapper.vm.handleBulkDelete()
      await flushPromises()

      expect(ElMessageBox.confirm.mock.calls[0][0]).not.toContain('簽核影響')
      expect(bulkDeleteCalls()).toHaveLength(1)
      warn.mockRestore()
    })

    it('刪除完成後顯示伺服器回報的簽核影響', async () => {
      bulkDeleteResponse = () => createApiResponse({
        requested: 2,
        deletedCount: 2,
        deleted: [{ _id: 'emp1' }, { _id: 'emp2' }],
        skipped: [],
        unassignedSubordinates: 0,
        impact: { messages: IMPACT_MESSAGES },
        warnings: []
      })
      await mountComponent()
      await selectRows('emp1', 'emp2')
      await wrapper.vm.handleBulkDelete()
      await flushPromises()

      expect(ElMessage.success).toHaveBeenCalledWith('已刪除 2 位員工')
      const warnings = ElMessage.warning.mock.calls.map(([arg]) => arg.message ?? arg)
      expect(warnings.some(text => String(text).includes('2 筆進行中的簽核單'))).toBe(true)
    })
  })
})
