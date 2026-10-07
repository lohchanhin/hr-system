import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { defineComponent, h, inject, provide, watch, nextTick } from 'vue'
import * as apiModule from '../../../api'
import { ElMessage, ElMessageBox } from 'element-plus'

const { routerPush, tableClearSelection } = vi.hoisted(() => ({
  routerPush: vi.fn(),
  tableClearSelection: vi.fn()
}))

vi.mock('xlsx', () => {
  const xlsx = {
    read: vi.fn(() => ({ SheetNames: [], Sheets: {} })),
    utils: { sheet_to_json: vi.fn(() => []) },
    writeFile: vi.fn()
  }
  return { ...xlsx, default: xlsx }
}, { virtual: true })

vi.mock('element-plus', () => {
  const success = vi.fn()
  const error = vi.fn()
  const warning = vi.fn()
  const info = vi.fn()
  const confirm = vi.fn(() => Promise.resolve())
  const prompt = vi.fn(() => Promise.resolve({ value: '刪除', action: 'confirm' }))
  const alert = vi.fn(() => Promise.resolve())
  return {
    ElMessage: { success, error, warning, info },
    ElMessageBox: { confirm, prompt, alert }
  }
})

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerPush })
}))

import EmployeeManagement from '../EmployeeManagement.vue'

const flushPromises = () => new Promise(resolve => setTimeout(resolve))

/**
 * el-table 替身：依 data 畫出每列的勾選框，並模擬 reserve-selection（換頁後保留勾選）、
 * selection-change 事件與 clearSelection()。勾選框是否可用由 selection 欄位的 selectable 決定。
 */
const ElTableStub = defineComponent({
  name: 'ElTableStub',
  props: {
    data: { type: Array, default: () => [] },
    rowKey: { type: String, default: '' }
  },
  emits: ['selection-change'],
  setup(props, { slots, emit, expose }) {
    const registry = { selectionColumn: null }
    provide('tableRegistry', registry)
    const selected = new Map()

    const emitSelection = () => emit('selection-change', Array.from(selected.values()))
    const toggleRow = (row, checked) => {
      if (checked) selected.set(row._id, row)
      else selected.delete(row._id)
      emitSelection()
    }
    const clearSelection = () => {
      tableClearSelection()
      const hadSelection = selected.size > 0
      selected.clear()
      if (hadSelection) emit('selection-change', [])
    }

    // 與真正的 el-table（Element Plus 2.12）相同：資料更新時不會替換、剔除或重新通知保留中的勾選
    // （reserve-selection 只在 clearSelection / toggleRowSelection / 全選時才會發出 selection-change），
    // 所以元件必須自己在重新載入後清除勾選，否則會留下指向已刪除或已變更資料的「幽靈列」。

    expose({ clearSelection })

    return () => h('div', { class: 'el-table-stub' }, [
      slots.default?.(),
      ...props.data.map(row => {
        const column = registry.selectionColumn
        const selectable = column?.selectable ? column.selectable(row) : true
        return h('input', {
          type: 'checkbox',
          class: 'row-checkbox',
          'data-test': `row-checkbox-${row._id}`,
          disabled: !selectable,
          checked: selected.has(row._id),
          onChange: event => toggleRow(row, event.target.checked)
        })
      })
    ])
  }
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumnStub',
  props: {
    type: { type: String, default: '' },
    selectable: { type: Function, default: null },
    reserveSelection: { type: Boolean, default: false }
  },
  setup(props) {
    const registry = inject('tableRegistry', null)
    if (registry && props.type === 'selection') registry.selectionColumn = props
    return () => null
  }
})

const elementStubs = {
  'el-tabs': { template: '<div><slot /></div>' },
  'el-tab-pane': { template: '<div><slot /></div>' },
  'el-button': {
    props: ['loading', 'disabled'],
    emits: ['click'],
    template:
      '<button type="button" :data-loading="loading ? \'true\' : \'false\'" :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  'el-dialog': {
    template: '<div class="el-dialog-stub"><slot /><slot name="footer" /></div>',
    props: ['modelValue']
  },
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
  'el-table': ElTableStub,
  'el-table-column': ElTableColumnStub
}

function createApiResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

const BULK_DELETE_PATH = '/api/employees/bulk-delete'

const makeEmployee = (index, overrides = {}) => ({
  _id: `emp${index}`,
  name: `員工${index}`,
  employeeId: `E${String(index).padStart(3, '0')}`,
  role: 'employee',
  ...overrides
})

const ADMIN = {
  _id: 'admin1',
  name: '系統管理員',
  employeeId: 'A001',
  role: 'admin'
}

const makeEmployees = count => Array.from({ length: count }, (_, i) => makeEmployee(i + 1))

const clearMessageMocks = () => {
  ;[ElMessage.success, ElMessage.error, ElMessage.warning, ElMessage.info].forEach(fn => fn.mockClear())
}

describe('EmployeeManagement - 批量刪除員工', () => {
  let apiFetchMock
  let serverEmployees
  let bulkDeleteImpl
  let wrapper

  const defaultBulkDeleteImpl = ({ ids }) => {
    serverEmployees = serverEmployees.filter(emp => !ids.includes(emp._id))
    return createApiResponse({
      requested: ids.length,
      deletedCount: ids.length,
      deleted: ids.map(id => ({ _id: id })),
      skipped: [],
      unassignedSubordinates: 0
    })
  }

  const mountComponent = async (employees = makeEmployees(3)) => {
    serverEmployees = [...employees]
    wrapper = shallowMount(EmployeeManagement, {
      global: {
        stubs: {
          transition: false,
          teleport: false,
          ...elementStubs
        }
      }
    })
    await flushPromises()
    // 掛載時字典預設值會觸發一則警告，與本功能無關，先清掉再開始斷言
    clearMessageMocks()
    return wrapper
  }

  const bulkDeleteCalls = () =>
    apiFetchMock.mock.calls.filter(([path]) => path === BULK_DELETE_PATH)
  const listCalls = () =>
    apiFetchMock.mock.calls.filter(
      ([path]) => typeof path === 'string' && path.split('?')[0] === '/api/employees'
    )
  const bulkDeleteButton = () => wrapper.find('[data-test="bulk-delete-button"]')
  const checkbox = id => wrapper.find(`[data-test="row-checkbox-${id}"]`)
  const selectRows = async ids => {
    for (const id of ids) {
      await checkbox(id).setValue(true)
    }
  }
  const selectedIds = () => wrapper.vm.selectedEmployees.map(emp => emp._id)
  const clickBulkDelete = async () => {
    await bulkDeleteButton().trigger('click')
    await flushPromises()
  }
  const sentIds = (callIndex = 0) => JSON.parse(bulkDeleteCalls()[callIndex][1].body).ids

  beforeEach(() => {
    serverEmployees = []
    bulkDeleteImpl = defaultBulkDeleteImpl

    apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockImplementation(async (path, options) => {
      const cleanPath = typeof path === 'string' ? path.split('?')[0] : path
      if (cleanPath === BULK_DELETE_PATH) {
        return bulkDeleteImpl(JSON.parse(options.body), options)
      }
      if (cleanPath === '/api/employees') {
        return createApiResponse({
          employees: serverEmployees,
          pagination: {
            total: serverEmployees.length,
            page: 1,
            pageSize: 20,
            totalPages: 1
          }
        })
      }
      if (cleanPath === '/api/other-control-settings/item-settings') {
        return createApiResponse({ itemSettings: {} })
      }
      if (
        cleanPath === '/api/departments' ||
        cleanPath === '/api/organizations' ||
        cleanPath === '/api/sub-departments'
      ) {
        return createApiResponse([])
      }
      return createApiResponse({})
    })

    clearMessageMocks()
    ElMessageBox.confirm.mockReset().mockResolvedValue('confirm')
    ElMessageBox.prompt.mockReset().mockResolvedValue({ value: '刪除', action: 'confirm' })
    ElMessageBox.alert.mockReset().mockResolvedValue('confirm')
    routerPush.mockClear()
    tableClearSelection.mockClear()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    apiFetchMock.mockRestore()
  })

  describe('工具列與勾選欄', () => {
    it('沒有勾選時不顯示批量刪除按鈕，勾選後顯示已選人數與取消選取', async () => {
      await mountComponent()
      expect(bulkDeleteButton().exists()).toBe(false)
      expect(wrapper.find('[data-test="bulk-delete-clear-button"]').exists()).toBe(false)

      await selectRows(['emp1'])
      expect(bulkDeleteButton().exists()).toBe(true)
      expect(bulkDeleteButton().text()).toBe('批量刪除（已選 1 位）')
      expect(wrapper.find('[data-test="bulk-delete-clear-button"]').text()).toBe('取消選取')

      await selectRows(['emp2', 'emp3'])
      expect(bulkDeleteButton().text()).toBe('批量刪除（已選 3 位）')

      await checkbox('emp2').setValue(false)
      expect(bulkDeleteButton().text()).toBe('批量刪除（已選 2 位）')

      await checkbox('emp1').setValue(false)
      await checkbox('emp3').setValue(false)
      expect(bulkDeleteButton().exists()).toBe(false)
    })

    it('表格使用 row-key 與 reserve-selection 的勾選欄，管理員列不可勾選', async () => {
      await mountComponent([...makeEmployees(2), ADMIN])

      const table = wrapper.findComponent(ElTableStub)
      expect(table.props('rowKey')).toBe('_id')

      const selectionColumn = wrapper
        .findAllComponents(ElTableColumnStub)
        .find(column => column.props('type') === 'selection')
      expect(selectionColumn).toBeTruthy()
      expect(selectionColumn.props('reserveSelection')).toBe(true)

      const selectable = selectionColumn.props('selectable')
      expect(selectable(ADMIN)).toBe(false)
      expect(selectable(makeEmployee(1))).toBe(true)
      expect(selectable(makeEmployee(2, { role: 'supervisor' }))).toBe(true)

      expect(checkbox('admin1').attributes('disabled')).toBeDefined()
      expect(checkbox('emp1').attributes('disabled')).toBeUndefined()

      await checkbox('admin1').setValue(true)
      expect(selectedIds()).toEqual([])
      expect(bulkDeleteButton().exists()).toBe(false)
    })

    it('按「取消選取」會清除勾選並隱藏批量刪除按鈕', async () => {
      await mountComponent()
      await selectRows(['emp1', 'emp2'])
      expect(bulkDeleteButton().exists()).toBe(true)

      await wrapper.find('[data-test="bulk-delete-clear-button"]').trigger('click')
      await flushPromises()

      expect(selectedIds()).toEqual([])
      expect(bulkDeleteButton().exists()).toBe(false)
      expect(tableClearSelection).toHaveBeenCalled()
      expect(bulkDeleteCalls()).toHaveLength(0)
    })
  })

  describe('確認視窗', () => {
    it('少於 5 位時列出全部「姓名（員工編號）」並明講無法復原與不會刪除歷史紀錄', async () => {
      await mountComponent()
      await selectRows(['emp1', 'emp2', 'emp3'])
      await clickBulkDelete()

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      const [message, title, options] = ElMessageBox.confirm.mock.calls[0]
      expect(title).toBe('確認批量刪除')
      expect(message).toContain('3 位員工')
      expect(message).toContain('員工1（E001）')
      expect(message).toContain('員工2（E002）')
      expect(message).toContain('員工3（E003）')
      expect(message).not.toContain('…等共')
      expect(message).toContain('此操作無法復原')
      expect(message).toContain('帳號與資料將被永久刪除')
      expect(message).toContain('考勤、薪資、排班等歷史紀錄不會一併刪除')
      expect(options.type).toBe('warning')
      expect(options.confirmButtonClass).toContain('danger')
      expect(options.confirmButtonText).toBe('確認刪除')
    })

    it('超過 5 位時只列出前 5 位並以「…等共 N 位」收尾', async () => {
      await mountComponent(makeEmployees(8))
      await selectRows(makeEmployees(8).map(emp => emp._id))
      await clickBulkDelete()

      const [message] = ElMessageBox.confirm.mock.calls[0]
      expect(message).toContain('員工1（E001）')
      expect(message).toContain('員工5（E005）')
      expect(message).not.toContain('員工6（E006）')
      expect(message).toContain('…等共 8 位')
    })

    it('姓名或員工編號為空時以預設文字顯示', async () => {
      await mountComponent([makeEmployee(1, { name: '', employeeId: '' })])
      await selectRows(['emp1'])
      await clickBulkDelete()

      const [message] = ElMessageBox.confirm.mock.calls[0]
      expect(message).toContain('未設定（無編號）')
    })

    it('訊息以純文字傳入，不啟用 HTML 渲染', async () => {
      await mountComponent([makeEmployee(1, { name: '<img src=x onerror=alert(1)>' })])
      await selectRows(['emp1'])
      await clickBulkDelete()

      const [message, , options] = ElMessageBox.confirm.mock.calls[0]
      expect(typeof message).toBe('string')
      expect(options.dangerouslyUseHTMLString).toBeUndefined()
    })

    it('按取消時不會送出任何請求，勾選也會保留', async () => {
      ElMessageBox.confirm.mockRejectedValue('cancel')
      await mountComponent()
      await selectRows(['emp1', 'emp2'])
      await clickBulkDelete()

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      expect(bulkDeleteCalls()).toHaveLength(0)
      expect(selectedIds()).toEqual(['emp1', 'emp2'])
      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(ElMessage.error).not.toHaveBeenCalled()
      expect(wrapper.vm.bulkDeleting).toBe(false)
    })
  })

  describe('送出條件', () => {
    it('10 位（含）以下只需確認一次，不需輸入文字', async () => {
      const employees = makeEmployees(10)
      await mountComponent(employees)
      await selectRows(employees.map(emp => emp._id))
      await clickBulkDelete()

      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)
      expect(ElMessageBox.prompt).not.toHaveBeenCalled()
      expect(bulkDeleteCalls()).toHaveLength(1)
      expect(sentIds()).toHaveLength(10)
    })

    it('超過 10 位必須輸入「刪除」才會送出', async () => {
      const employees = makeEmployees(11)
      await mountComponent(employees)
      await selectRows(employees.map(emp => emp._id))
      await clickBulkDelete()

      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(ElMessageBox.prompt).toHaveBeenCalledTimes(1)
      const [message, title, options] = ElMessageBox.prompt.mock.calls[0]
      expect(title).toBe('確認批量刪除')
      expect(message).toContain('…等共 11 位')
      expect(message).toContain('此操作無法復原')
      expect(message).toContain('輸入「刪除」')
      expect(options.type).toBe('warning')
      expect(options.confirmButtonClass).toContain('danger')

      // 驗證器只接受「刪除」
      const { inputValidator } = options
      expect(inputValidator('刪除')).toBe(true)
      expect(inputValidator(' 刪除 ')).toBe(true)
      for (const wrong of ['', '   ', '删除', 'delete', '刪', '刪除刪除', null, undefined]) {
        const result = inputValidator(wrong)
        expect(result).not.toBe(true)
        expect(typeof result).toBe('string')
      }

      expect(bulkDeleteCalls()).toHaveLength(1)
      expect(sentIds()).toHaveLength(11)
    })

    it('超過 10 位但取消輸入視窗時不會送出', async () => {
      ElMessageBox.prompt.mockRejectedValue('cancel')
      const employees = makeEmployees(12)
      await mountComponent(employees)
      await selectRows(employees.map(emp => emp._id))
      await clickBulkDelete()

      expect(ElMessageBox.prompt).toHaveBeenCalledTimes(1)
      expect(bulkDeleteCalls()).toHaveLength(0)
      expect(selectedIds()).toHaveLength(12)
      expect(wrapper.vm.bulkDeleting).toBe(false)
    })

    it('請求只包含非管理員的 id，且使用 JSON POST', async () => {
      await mountComponent([...makeEmployees(2), ADMIN])
      await selectRows(['emp1', 'emp2'])

      // 模擬管理員列被意外勾選（例如勾選後角色才被改成管理員）
      const adminRow = { ...ADMIN }
      wrapper
        .findComponent(ElTableStub)
        .vm.$emit('selection-change', [...wrapper.vm.selectedEmployees, adminRow])
      await nextTick()
      expect(selectedIds()).toContain('admin1')
      expect(bulkDeleteButton().text()).toBe('批量刪除（已選 2 位）')

      await clickBulkDelete()

      expect(bulkDeleteCalls()).toHaveLength(1)
      const [path, options] = bulkDeleteCalls()[0]
      expect(path).toBe(BULK_DELETE_PATH)
      expect(options.method).toBe('POST')
      expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
      expect(JSON.parse(options.body)).toEqual({ ids: ['emp1', 'emp2'] })

      const [message] = ElMessageBox.confirm.mock.calls[0]
      expect(message).not.toContain('系統管理員')
    })

    it('重複的列只會送出一次 id', async () => {
      await mountComponent()
      const row = wrapper.vm.employeeList[0]
      wrapper.findComponent(ElTableStub).vm.$emit('selection-change', [row, { ...row }])
      await nextTick()

      await clickBulkDelete()
      expect(sentIds()).toEqual(['emp1'])
    })

    it('只剩管理員被勾選時不送出，也不開確認視窗', async () => {
      await mountComponent([...makeEmployees(1), ADMIN])
      wrapper.findComponent(ElTableStub).vm.$emit('selection-change', [{ ...ADMIN }])
      await nextTick()

      expect(bulkDeleteButton().text()).toBe('批量刪除（已選 0 位）')
      await clickBulkDelete()

      expect(ElMessage.warning).toHaveBeenCalledWith('請先勾選要刪除的員工')
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(bulkDeleteCalls()).toHaveLength(0)
    })

    it('超過後端上限 200 位時在前端直接擋下', async () => {
      await mountComponent()
      const rows = makeEmployees(201)
      wrapper.findComponent(ElTableStub).vm.$emit('selection-change', rows)
      await nextTick()

      await clickBulkDelete()

      expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining('200'))
      expect(ElMessageBox.confirm).not.toHaveBeenCalled()
      expect(ElMessageBox.prompt).not.toHaveBeenCalled()
      expect(bulkDeleteCalls()).toHaveLength(0)
    })

    it('快速連點只會送出一次（確認視窗開啟期間）', async () => {
      let resolveConfirm
      ElMessageBox.confirm.mockImplementation(
        () => new Promise(resolve => { resolveConfirm = resolve })
      )
      await mountComponent()
      await selectRows(['emp1', 'emp2'])

      const button = bulkDeleteButton()
      button.trigger('click')
      button.trigger('click')
      await flushPromises()
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)

      resolveConfirm('confirm')
      await flushPromises()
      expect(bulkDeleteCalls()).toHaveLength(1)
    })

    it('請求進行中顯示載入狀態並忽略再次點擊，完成後恢復', async () => {
      let releaseRequest
      bulkDeleteImpl = ({ ids }) =>
        new Promise(resolve => {
          releaseRequest = () => resolve(defaultBulkDeleteImpl({ ids }))
        })
      await mountComponent()
      await selectRows(['emp1', 'emp2'])

      await clickBulkDelete()
      expect(bulkDeleteCalls()).toHaveLength(1)
      expect(wrapper.vm.bulkDeleting).toBe(true)
      expect(bulkDeleteButton().attributes('data-loading')).toBe('true')
      expect(wrapper.find('[data-test="bulk-delete-clear-button"]').attributes('disabled')).toBeDefined()

      await clickBulkDelete()
      await clickBulkDelete()
      expect(bulkDeleteCalls()).toHaveLength(1)
      expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1)

      releaseRequest()
      await flushPromises()
      expect(wrapper.vm.bulkDeleting).toBe(false)
      expect(bulkDeleteCalls()).toHaveLength(1)
    })
  })

  describe('成功之後', () => {
    it('顯示成功訊息、清除勾選並重新載入列表', async () => {
      await mountComponent()
      await selectRows(['emp1', 'emp2'])
      const listCallsBefore = listCalls().length

      await clickBulkDelete()

      expect(ElMessage.success).toHaveBeenCalledWith('已刪除 2 位員工')
      expect(ElMessage.warning).not.toHaveBeenCalled()
      expect(ElMessage.info).not.toHaveBeenCalled()
      expect(ElMessage.error).not.toHaveBeenCalled()
      expect(listCalls().length).toBeGreaterThan(listCallsBefore)
      expect(selectedIds()).toEqual([])
      expect(tableClearSelection).toHaveBeenCalled()
      expect(bulkDeleteButton().exists()).toBe(false)
      expect(wrapper.vm.bulkDeleting).toBe(false)
      expect(checkbox('emp1').exists()).toBe(false)
      expect(checkbox('emp2').exists()).toBe(false)
      expect(checkbox('emp3').exists()).toBe(true)
    })

    it('有略過的項目時以警告列出每一筆與原因', async () => {
      bulkDeleteImpl = () =>
        createApiResponse({
          requested: 3,
          deletedCount: 1,
          deleted: [{ _id: 'emp3', name: '員工3', employeeNo: 'E003' }],
          skipped: [
            { _id: 'emp1', name: '員工1', employeeNo: 'E001', reason: 'admin', message: '管理員帳戶不可刪除' },
            // 後端找不到時沒有姓名，改由前端勾選資料補上
            { _id: 'emp2', reason: 'not_found', message: '找不到該員工（可能已被刪除）' }
          ],
          unassignedSubordinates: 0
        })
      await mountComponent()
      await selectRows(['emp1', 'emp2', 'emp3'])

      await clickBulkDelete()

      expect(ElMessage.success).toHaveBeenCalledWith('已刪除 1 位員工')
      expect(ElMessage.warning).toHaveBeenCalledTimes(1)
      const warning = ElMessage.warning.mock.calls[0][0]
      expect(warning.message).toContain('2 位')
      expect(warning.message).toContain('員工1（E001）：管理員帳戶不可刪除')
      expect(warning.message).toContain('員工2（E002）：找不到該員工（可能已被刪除）')
      expect(warning.duration).toBeGreaterThanOrEqual(5000)
      expect(selectedIds()).toEqual([])
    })

    it('略過訊息缺少 message 時依 reason 補上預設說明，且限制列出筆數', async () => {
      const employees = makeEmployees(8)
      bulkDeleteImpl = ({ ids }) =>
        createApiResponse({
          requested: ids.length,
          deletedCount: 0,
          deleted: [],
          skipped: ids.map(id => ({ _id: id, reason: 'changed' })),
          unassignedSubordinates: 0
        })
      await mountComponent(employees)
      await selectRows(employees.map(emp => emp._id))

      await clickBulkDelete()

      // 一位都沒刪掉時只顯示警告，不顯示綠色的成功訊息
      expect(ElMessage.success).not.toHaveBeenCalled()
      const warning = ElMessage.warning.mock.calls[0][0]
      expect(warning.message).toContain('8 位')
      expect(warning.message).toContain('員工1（E001）：資料狀態已變更，未刪除')
      expect(warning.message).toContain('員工5（E005）')
      expect(warning.message).not.toContain('員工6（E006）')
      expect(warning.message).toContain('…等共 8 位')
    })

    it('有員工被清除直屬主管時顯示提示', async () => {
      bulkDeleteImpl = () =>
        createApiResponse({
          requested: 1,
          deletedCount: 1,
          deleted: [{ _id: 'emp1', name: '員工1', employeeNo: 'E001' }],
          skipped: [],
          unassignedSubordinates: 3
        })
      await mountComponent()
      await selectRows(['emp1'])

      await clickBulkDelete()

      expect(ElMessage.info).toHaveBeenCalledTimes(1)
      const info = ElMessage.info.mock.calls[0][0]
      expect(info.message).toContain('3 位員工')
      expect(info.message).toContain('直屬主管')
      expect(info.message).toContain('重新指定')
      expect(ElMessage.warning).not.toHaveBeenCalled()
    })
  })

  describe('伺服器的警告與確認視窗設定', () => {
    it('伺服器回傳 warnings 時以警告顯示', async () => {
      bulkDeleteImpl = ({ ids }) =>
        createApiResponse({
          requested: ids.length,
          deletedCount: ids.length,
          deleted: ids.map(id => ({ _id: id })),
          skipped: [],
          unassignedSubordinates: 0,
          warnings: ['無法確認刪除結果，請重新整理員工列表檢查']
        })
      await mountComponent()
      await selectRows(['emp1'])

      await clickBulkDelete()

      expect(ElMessage.success).toHaveBeenCalledWith('已刪除 1 位員工')
      const warning = ElMessage.warning.mock.calls.at(-1)[0]
      expect(warning.message).toBe('無法確認刪除結果，請重新整理員工列表檢查')
    })

    it('確認視窗不自動聚焦在「確認刪除」，避免連按 Enter 直接刪除', async () => {
      await mountComponent()
      await selectRows(['emp1'])

      await clickBulkDelete()

      const options = ElMessageBox.confirm.mock.calls[0][2]
      expect(options.autofocus).toBe(false)
    })

    it('一位都沒刪掉也沒有略過項目時顯示資訊而不是成功', async () => {
      bulkDeleteImpl = ({ ids }) =>
        createApiResponse({ requested: ids.length, deletedCount: 0, deleted: [], skipped: [], unassignedSubordinates: 0 })
      await mountComponent()
      await selectRows(['emp1'])

      await clickBulkDelete()

      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(ElMessage.info).toHaveBeenCalledWith('沒有員工被刪除')
    })
  })

  describe('失敗情境', () => {
    it('伺服器回傳錯誤時顯示伺服器訊息，並重新載入列表（勾選一併清除）', async () => {
      bulkDeleteImpl = () =>
        createApiResponse({ error: '一次最多只能刪除 200 位員工' }, 400)
      await mountComponent()
      await selectRows(['emp1', 'emp2'])
      const listCallsBefore = listCalls().length

      await clickBulkDelete()

      expect(ElMessage.error).toHaveBeenCalledWith('一次最多只能刪除 200 位員工')
      expect(ElMessage.success).not.toHaveBeenCalled()
      expect(listCalls().length).toBe(listCallsBefore + 1)
      expect(selectedIds()).toEqual([])
      expect(wrapper.vm.bulkDeleting).toBe(false)
    })

    it('伺服器沒有提供錯誤內容時使用預設訊息', async () => {
      bulkDeleteImpl = () => new Response('Internal Server Error', { status: 500 })
      await mountComponent()
      await selectRows(['emp1'])

      await clickBulkDelete()

      expect(ElMessage.error).toHaveBeenCalledWith('批量刪除失敗')
      expect(selectedIds()).toEqual([])
    })

    it('網路錯誤時顯示失敗訊息並釋放送出鎖，之後可以重試', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      let attempt = 0
      bulkDeleteImpl = body => {
        attempt += 1
        if (attempt === 1) throw new Error('network down')
        return defaultBulkDeleteImpl(body)
      }
      await mountComponent()
      await selectRows(['emp1'])

      const listCallsBefore = listCalls().length
      await clickBulkDelete()
      expect(ElMessage.error).toHaveBeenCalledWith('批量刪除失敗，已重新載入員工列表，請確認結果後再試')
      expect(wrapper.vm.bulkDeleting).toBe(false)
      // 連線中斷時伺服器可能已處理完成，所以會重新載入列表，勾選也一併清掉
      expect(listCalls().length).toBe(listCallsBefore + 1)
      expect(selectedIds()).toEqual([])

      await selectRows(['emp1'])
      await clickBulkDelete()
      expect(bulkDeleteCalls()).toHaveLength(2)
      expect(ElMessage.success).toHaveBeenCalledWith('已刪除 1 位員工')
      warnSpy.mockRestore()
    })

    it('登入逾時（401）時導向登入頁，不顯示成功', async () => {
      bulkDeleteImpl = () => createApiResponse({ error: 'Unauthorized' }, 401)
      await mountComponent()
      await selectRows(['emp1'])

      await clickBulkDelete()

      expect(ElMessage.error).toHaveBeenCalledWith('登入逾時，請重新登入')
      expect(routerPush).toHaveBeenCalledWith('/manager/login')
      expect(ElMessage.success).not.toHaveBeenCalled()
    })
  })

  describe('勾選的生命週期', () => {
    it('搜尋文字改變時清除勾選', async () => {
      await mountComponent()
      await selectRows(['emp1', 'emp2'])
      expect(bulkDeleteButton().exists()).toBe(true)
      tableClearSelection.mockClear()

      wrapper.vm.searchQuery = '員工'
      await flushPromises()

      expect(selectedIds()).toEqual([])
      expect(tableClearSelection).toHaveBeenCalled()
      expect(bulkDeleteButton().exists()).toBe(false)
    })

    it('部門篩選改變時清除勾選', async () => {
      await mountComponent()
      await selectRows(['emp1', 'emp2'])
      expect(bulkDeleteButton().exists()).toBe(true)
      tableClearSelection.mockClear()

      wrapper.vm.departmentFilter = 'dept-1'
      await flushPromises()

      expect(selectedIds()).toEqual([])
      expect(tableClearSelection).toHaveBeenCalled()
      expect(bulkDeleteButton().exists()).toBe(false)
    })

    it('換頁時保留勾選，而且送出的就是這些人', async () => {
      await mountComponent()
      await selectRows(['emp1', 'emp3'])
      tableClearSelection.mockClear()
      const listCallsBefore = listCalls().length

      wrapper.vm.handleEmployeePageChange(2)
      await flushPromises()

      expect(listCalls().length).toBe(listCallsBefore + 1)
      expect(listCalls().at(-1)[0]).toContain('page=2')
      expect(selectedIds()).toEqual(['emp1', 'emp3'])
      expect(bulkDeleteButton().text()).toBe('批量刪除（已選 2 位）')
      expect(tableClearSelection).not.toHaveBeenCalled()

      await clickBulkDelete()
      expect(sentIds()).toEqual(['emp1', 'emp3'])
    })

    it('換每頁筆數時同樣保留勾選', async () => {
      await mountComponent()
      await selectRows(['emp2'])
      tableClearSelection.mockClear()

      wrapper.vm.handleEmployeePageSizeChange(50)
      await flushPromises()

      expect(selectedIds()).toEqual(['emp2'])
      expect(tableClearSelection).not.toHaveBeenCalled()
    })

    it('以單筆「刪除」刪掉已勾選的員工後，該員工不會留在勾選裡被送出', async () => {
      await mountComponent(makeEmployees(3))
      await selectRows(['emp1', 'emp2'])
      apiFetchMock.mockImplementation(async (path, options) => {
        const cleanPath = typeof path === 'string' ? path.split('?')[0] : path
        if (options?.method === 'DELETE') {
          serverEmployees = serverEmployees.filter(emp => `/api/employees/${emp._id}` !== path)
          return createApiResponse({ success: true })
        }
        if (cleanPath === '/api/employees') {
          return createApiResponse({
            employees: serverEmployees,
            pagination: { total: serverEmployees.length, page: 1, pageSize: 20, totalPages: 1 }
          })
        }
        return createApiResponse([])
      })

      await wrapper.vm.deleteEmployee('emp1')
      await flushPromises()

      expect(selectedIds()).toEqual([])
      expect(bulkDeleteButton().exists()).toBe(false)
    })

    it('權限被改成管理員的員工重新載入後，不會留在勾選裡', async () => {
      await mountComponent(makeEmployees(2))
      await selectRows(['emp1'])
      serverEmployees = serverEmployees.map(emp => (emp._id === 'emp1' ? { ...emp, role: 'admin' } : emp))

      await wrapper.vm.fetchEmployees()
      await flushPromises()

      expect(selectedIds()).toEqual([])
    })

    it('搜尋防抖到期、送出查詢之前會再清一次勾選', async () => {
      await mountComponent()
      await selectRows(['emp1'])
      vi.useFakeTimers()
      try {
        wrapper.vm.searchQuery = '員工'
        await wrapper.vm.$nextTick()
        // 防抖等待期間畫面還是舊資料，使用者可能又勾了一列
        await checkbox('emp2').setValue(true)
        expect(selectedIds()).toEqual(['emp2'])

        // 同步推進計時器：只執行防抖回呼本身，查詢結果回來之前勾選就必須已經被清掉
        vi.advanceTimersByTime(300)

        expect(selectedIds()).toEqual([])
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
