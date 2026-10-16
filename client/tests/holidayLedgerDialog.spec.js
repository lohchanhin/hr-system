import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { createPinia, setActivePinia } from 'pinia'

const { messageError, messageSuccess, messageWarning } = vi.hoisted(() => ({
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
}))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: Object.assign(vi.fn(), { error: messageError, success: messageSuccess, warning: messageWarning }),
  }
})
vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from '../src/api'
import { useAuthStore } from '../src/stores/auth'
import HolidayLedgerDialog from '../src/views/front/HolidayLedgerDialog.vue'

const DialogStub = {
  name: 'ElDialog',
  props: ['modelValue', 'title'],
  template: '<div v-if="modelValue" class="dialog-stub" :data-title="title"><slot /><slot name="footer" /></div>',
}
const TableStub = {
  name: 'ElTable',
  props: ['data'],
  provide() {
    return { tableContext: this }
  },
  template: '<div class="table-stub" data-test="holiday-ledger-table"><slot /><div v-if="!(data || []).length" class="table-empty">沒有符合條件的員工</div></div>',
}
const ColumnStub = {
  name: 'ElTableColumn',
  inject: ['tableContext'],
  props: ['label'],
  template: `
    <div class="col" :data-label="label || ''">
      <div class="col-header"><slot name="header" /></div>
      <div v-for="row in (tableContext?.data || [])" :key="row.employeeId" class="cell"><slot :row="row" /></div>
    </div>`,
}
const DatePickerStub = {
  name: 'ElDatePicker',
  props: ['modelValue'],
  emits: ['update:modelValue', 'change'],
  template: '<input class="date-stub" v-bind="$attrs" :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value); $emit(\'change\', $event.target.value)" />',
}
const TooltipStub = { name: 'ElTooltip', template: '<span><slot /></span>' }

const holidays = [
  { id: '2026-09-25', name: '中秋節', date: '2026-09-25', originalDate: '2026-09-25', movedFrom: null },
  { id: '2026-09-28', name: '教師節', date: '2026-09-28', originalDate: '2026-09-28', movedFrom: null },
]

function item(overrides = {}) {
  return {
    holidayId: '2026-09-25',
    holidayName: '中秋節',
    holidayDate: '2026-09-25',
    originalDate: '2026-09-25',
    movedFrom: null,
    status: 'rested_on_date',
    guoDate: '2026-09-25',
    offsetDays: null,
    dateKind: 'holiday',
    reason: null,
    needsAction: null,
    resolution: null,
    ...overrides,
  }
}
function second(overrides = {}) {
  return item({ holidayId: '2026-09-28', holidayName: '教師節', holidayDate: '2026-09-28', originalDate: '2026-09-28', guoDate: '2026-09-28', ...overrides })
}
function person(employeeId, name, items, extra = {}) {
  const list = items
  return {
    employeeId,
    employeeNo: `N${employeeId}`,
    name,
    title: '護理師',
    subDepartmentName: '內科',
    partTime: false,
    provisional: false,
    entitled: list.filter((entry) => entry.status !== 'na').length,
    rested: list.filter((entry) => entry.status === 'rested_on_date').length,
    moved: list.filter((entry) => entry.status === 'moved').length,
    notTaken: list.filter((entry) => entry.status === 'not_taken').length,
    open: list.filter((entry) => entry.needsAction).length,
    items: list,
    extraGuoDates: [],
    ...extra,
  }
}

const LEDGER = {
  months: [{
    month: '2026-09',
    holidays,
    employees: [
      person('a1', '當日休甲', [item(), second({ status: 'moved', guoDate: '2026-09-20', offsetDays: -8, dateKind: 'work' })]),
      person('b2', '未休乙', [
        item({ status: 'not_taken', guoDate: null, reason: 'worked', needsAction: 'resolve', dateKind: 'work' }),
        second({ status: 'not_taken', guoDate: null, reason: 'on_rest_day', dateKind: 'rest_day' }),
      ], { partTime: true }),
      person('c3', '多排丙', [item(), second()], { extraGuoDates: ['2026-09-30'] }),
      person('d4', '新進丁', [
        item({ status: 'na', guoDate: null, reason: 'before_hire' }),
        second({ status: 'not_taken', guoDate: null, reason: 'unscheduled', needsAction: 'resolve', dateKind: 'none' }),
      ]),
      person('e5', '已處理戊', [
        item({
          status: 'not_taken',
          guoDate: null,
          reason: 'worked',
          dateKind: 'work',
          resolution: { id: 'r1', kind: 'compensatory_leave', compensatoryHours: 8, restedDate: null, note: '', resolvedByName: '主管王' },
        }),
        second(),
      ]),
      person('f6', '草稿己', [
        item({ status: 'not_taken', guoDate: null, reason: 'worked', needsAction: 'schedule', dateKind: 'work' }),
        second({ status: 'not_taken', guoDate: null, reason: 'unscheduled', needsAction: 'schedule', dateKind: 'none' }),
      ], { provisional: true }),
    ],
    summary: { employees: 6, holidays: 2, entitled: 11, rested: 4, moved: 1, notTaken: 6, open: 4, extra: 1, excluded: { notScheduled: 2 } },
  }],
  summary: {},
}

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
  blob: () => Promise.resolve(new Blob(['x'])),
})

const SCOPE = { month: '2026-09', department: 'd1', subDepartment: 's1' }

// role：目前登入者的角色（排班頁用的 auth store），viewerId：登入時存下的員工 _id
function mountDialog(props = {}, { role = 'employee', viewerId = '' } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  useAuthStore().role = role
  sessionStorage.clear()
  if (viewerId) sessionStorage.setItem('employeeId', viewerId)
  return mount(HolidayLedgerDialog, {
    props: { modelValue: true, scope: SCOPE, canResolve: true, ...props },
    global: {
      plugins: [ElementPlus, pinia],
      stubs: { ElDialog: DialogStub, ElTable: TableStub, ElTableColumn: ColumnStub, ElDatePicker: DatePickerStub, ElTooltip: TooltipStub },
    },
  })
}

// el-input 會把 data-test 之類的屬性放在真正的 <input>／<textarea> 上，這裡統一取得輸入元素
const fieldOf = (wrapper, dataTest) => {
  const host = wrapper.find(`[data-test="${dataTest}"]`)
  return ['INPUT', 'TEXTAREA'].includes(host.element?.tagName) ? host : host.find('input, textarea')
}

const cellText = (wrapper, employeeId, holidayId) => wrapper.find(`[data-test="ledger-cell-${employeeId}-${holidayId}"]`).text()

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  apiFetch.mockReset()
  messageError.mockReset()
  messageSuccess.mockReset()
  messageWarning.mockReset()
  apiFetch.mockResolvedValue(jsonResponse(LEDGER))
})

describe('HolidayLedgerDialog', () => {
  it('does not call the server until the dialog is opened, then loads the page scope once', async () => {
    const wrapper = mountDialog({ modelValue: false })
    await flushPromises()
    expect(apiFetch).not.toHaveBeenCalled()

    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledTimes(1)
    expect(apiFetch).toHaveBeenCalledWith('/api/holiday-ledger?month=2026-09&department=d1&subDepartment=s1')
  })

  it('shows the holidays, summary and a text label for every state of every employee', async () => {
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.find('[data-test="holiday-ledger-holidays"]').text()).toContain('中秋節')
    expect(wrapper.find('[data-test="holiday-ledger-holidays"]').text()).toContain('09/28（一）')
    const summary = wrapper.find('[data-test="holiday-ledger-summary"]').text()
    expect(summary).toContain('應休 11')
    expect(summary).toContain('當日休 4')
    expect(summary).toContain('移休 1')
    expect(summary).toContain('未休 6')
    expect(summary).toContain('待處理 4')
    expect(summary).toContain('多排的國 1')
    expect(summary).toContain('另有 2 人未排班或不在職，未列入')

    expect(cellText(wrapper, 'a1', '2026-09-25')).toBe('當日休')
    expect(cellText(wrapper, 'a1', '2026-09-28')).toBe('移休 09/20')
    expect(cellText(wrapper, 'b2', '2026-09-25')).toBe('未休·上班')
    expect(cellText(wrapper, 'b2', '2026-09-28')).toBe('適逢休息日')
    expect(cellText(wrapper, 'd4', '2026-09-25')).toBe('—')
    expect(cellText(wrapper, 'd4', '2026-09-28')).toBe('未休·未排班')
    expect(cellText(wrapper, 'e5', '2026-09-25')).toBe('未休·補休 8 小時')
    expect(cellText(wrapper, 'f6', '2026-09-25')).toBe('尚未排國')
    expect(wrapper.find('[data-test="ledger-extra-c3"]').text()).toBe('09/30')
    expect(wrapper.text()).toContain('兼職')
  })

  it('notes a company-moved holiday in the column header', async () => {
    const moved = structuredClone(LEDGER)
    moved.months[0].holidays[0] = { id: '2026-09-25', name: '中秋節', date: '2026-09-24', originalDate: '2026-09-25', movedFrom: '2026-09-25' }
    apiFetch.mockResolvedValue(jsonResponse(moved))
    const wrapper = mountDialog()
    await flushPromises()

    // 第一欄是員工，之後依序是各個假日
    expect(wrapper.findAll('.col-header')[1].text()).toContain('公司挪移自 09/25')
    expect(wrapper.findAll('.col-header')[2].text()).not.toContain('公司挪移')
  })

  it('filters by not taken, moved, open and extra 國, and searches by name or code', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    const names = () => wrapper.findAll('.col:first-child .cell').map((cell) => cell.find('strong').text())
    const choose = async (label) => {
      const radio = wrapper.findAll('label.el-radio-button').find((node) => node.text().startsWith(label))
      await radio.find('input').setValue(true)
      await flushPromises()
    }

    expect(names()).toEqual(['當日休甲', '未休乙', '多排丙', '新進丁', '已處理戊', '草稿己'])
    await choose('未休')
    expect(names()).toEqual(['未休乙', '新進丁', '已處理戊', '草稿己'])
    await choose('移休')
    expect(names()).toEqual(['當日休甲'])
    await choose('待處理')
    expect(names()).toEqual(['未休乙', '新進丁', '草稿己'])
    await choose('多排的國')
    expect(names()).toEqual(['多排丙'])
    await choose('全部')

    await fieldOf(wrapper, 'holiday-ledger-search').setValue('Nb2')
    expect(names()).toEqual(['未休乙'])
    await fieldOf(wrapper, 'holiday-ledger-search').setValue('甲')
    expect(names()).toEqual(['當日休甲'])
    await fieldOf(wrapper, 'holiday-ledger-search').setValue('沒有這個人')
    expect(wrapper.find('.table-empty').exists()).toBe(true)
  })

  it('shows the filter counts in the radio labels', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    const text = wrapper.find('[data-test="holiday-ledger-filter"]').text()
    expect(text).toContain('全部（6）')
    expect(text).toContain('未休（4）')
    expect(text).toContain('移休（1）')
    expect(text).toContain('待處理（3）')
    expect(text).toContain('多排的國（1）')
  })

  it('offers 登記處理 only for items that need it and 修改 for recorded ones, and only when allowed to resolve', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    const button = (employeeId, holidayId) => wrapper.find(`[data-test="ledger-resolve-${employeeId}-${holidayId}"]`)

    expect(button('b2', '2026-09-25').text()).toBe('登記處理')
    expect(button('d4', '2026-09-28').text()).toBe('登記處理')
    expect(button('e5', '2026-09-25').text()).toBe('修改')
    // 適逢休息日、班表還沒排完、已休的都不開放登記
    expect(button('b2', '2026-09-28').exists()).toBe(false)
    expect(button('f6', '2026-09-25').exists()).toBe(false)
    expect(button('a1', '2026-09-25').exists()).toBe(false)
    expect(wrapper.text()).toContain('主管王 登記')

    const readOnly = mountDialog({ canResolve: false })
    await flushPromises()
    expect(readOnly.find('[data-test="ledger-resolve-b2-2026-09-25"]').exists()).toBe(false)
    expect(readOnly.find('[data-test="ledger-resolve-e5-2026-09-25"]').exists()).toBe(false)
  })

  it('hides the 登記處理 button on the supervisor\'s own row, because the server refuses it, but not on the other rows', async () => {
    const button = (wrapper, employeeId, holidayId) => wrapper.find(`[data-test="ledger-resolve-${employeeId}-${holidayId}"]`)

    // 主管 b2（勾了「包含自己」）：自己那一列沒有按鈕，別人的照常有
    const supervisor = mountDialog({ scope: { ...SCOPE, includeSelf: true } }, { role: 'supervisor', viewerId: 'b2' })
    await flushPromises()
    expect(supervisor.find('[data-test="ledger-cell-b2-2026-09-25"]').exists()).toBe(true)
    expect(button(supervisor, 'b2', '2026-09-25').exists()).toBe(false)
    expect(button(supervisor, 'd4', '2026-09-28').text()).toBe('登記處理')
    expect(button(supervisor, 'e5', '2026-09-25').text()).toBe('修改')

    // 管理員可以處理自己的
    const admin = mountDialog({}, { role: 'admin', viewerId: 'b2' })
    await flushPromises()
    expect(button(admin, 'b2', '2026-09-25').text()).toBe('登記處理')

    // 讀不到登入者是誰時不亂藏按鈕
    const unknown = mountDialog({}, { role: 'supervisor' })
    await flushPromises()
    expect(button(unknown, 'b2', '2026-09-25').text()).toBe('登記處理')
  })

  it('reads the viewer again every time the dialog is opened', async () => {
    const wrapper = mountDialog({ modelValue: false }, { role: 'supervisor' })
    await flushPromises()
    sessionStorage.setItem('employeeId', 'b2')

    await wrapper.setProps({ modelValue: true })
    await flushPromises()

    expect(wrapper.find('[data-test="ledger-resolve-b2-2026-09-25"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ledger-resolve-d4-2026-09-28"]').exists()).toBe(true)
  })

  it('shows a stored resolution that clashes with a 國 on the roster, instead of hiding it, and lets it be reviewed and removed', async () => {
    const clash = structuredClone(LEDGER)
    clash.months[0].employees.push(person('g7', '衝突庚', [
      item({
        status: 'moved',
        guoDate: '2026-09-20',
        offsetDays: -5,
        dateKind: 'work',
        resolutionConflict: true,
        resolution: { id: 'r7', kind: 'paid', compensatoryHours: null, restedDate: null, note: '', resolvedByName: '主管王', createdByName: '人資李' },
      }),
      second(),
    ]))
    apiFetch.mockResolvedValue(jsonResponse(clash))
    const wrapper = mountDialog()
    await flushPromises()

    expect(cellText(wrapper, 'g7', '2026-09-25')).toBe('移休 09/20')
    expect(wrapper.find('[data-test="ledger-conflict-g7-2026-09-25"]').text()).toBe('已登記處理但班表已有國，請確認')
    expect(wrapper.find('[data-test="ledger-conflict-g7-2026-09-28"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ledger-conflict-a1-2026-09-25"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="ledger-cell-g7-2026-09-25"]').html()).toContain('el-tag--warning')
    expect(wrapper.find('[data-test="ledger-cell-a1-2026-09-28"]').html()).toContain('el-tag--primary')
    // 登記的人也看得到：最後修改的人，以及最初登記的人
    expect(wrapper.text()).toContain('主管王 登記（最初：人資李）')

    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(jsonResponse({ success: true })).mockResolvedValue(jsonResponse(clash))
    const open = wrapper.find('[data-test="ledger-resolve-g7-2026-09-25"]')
    expect(open.text()).toBe('檢視登記')
    await open.trigger('click')
    await wrapper.find('[data-test="holiday-ledger-remove"]').trigger('click')
    await flushPromises()
    expect(apiFetch.mock.calls[0]).toEqual(['/api/holiday-ledger/resolutions/r7', { method: 'DELETE' }])
    expect(wrapper.find('[data-test="ledger-resolve-g7-2026-09-28"]').exists()).toBe(false)
  })

  it('shows "未休·未排班" without a warning color or a button when it is not something to handle', async () => {
    const partTime = structuredClone(LEDGER)
    partTime.months[0].employees.push(person('p8', '兼職辛', [
      item({ status: 'not_taken', guoDate: null, reason: 'worked', needsAction: 'resolve', dateKind: 'work' }),
      second({ status: 'not_taken', guoDate: null, reason: 'unscheduled', needsAction: null, dateKind: 'none' }),
    ], { partTime: true }))
    apiFetch.mockResolvedValue(jsonResponse(partTime))
    const wrapper = mountDialog()
    await flushPromises()

    expect(cellText(wrapper, 'p8', '2026-09-28')).toBe('未休·未排班')
    expect(wrapper.find('[data-test="ledger-cell-p8-2026-09-28"]').html()).toContain('el-tag--info')
    expect(wrapper.find('[data-test="ledger-resolve-p8-2026-09-28"]').exists()).toBe(false)
    // 上班沒休照樣要處理
    expect(wrapper.find('[data-test="ledger-resolve-p8-2026-09-25"]').text()).toBe('登記處理')
  })

  it('saves a resolution against the original holiday date, then reloads the ledger', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(jsonResponse({ id: 'r9' })).mockResolvedValue(jsonResponse(LEDGER))

    await wrapper.find('[data-test="ledger-resolve-b2-2026-09-25"]').trigger('click')
    expect(wrapper.find('[data-test="holiday-ledger-resolve-dialog"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="holiday-ledger-resolve-dialog"]').attributes('data-title')).toContain('未休乙')
    await fieldOf(wrapper, 'holiday-ledger-note').setValue('  改補休  ')
    await wrapper.find('[data-test="holiday-ledger-save"]').trigger('click')
    await flushPromises()

    const [url, options] = apiFetch.mock.calls[0]
    expect(url).toBe('/api/holiday-ledger/resolutions')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({
      employee: 'b2',
      holidayDate: '2026-09-25',
      kind: 'compensatory_leave',
      compensatoryHours: 8,
      note: '改補休',
    })
    expect(messageSuccess).toHaveBeenCalledWith('已登記處理方式')
    expect(apiFetch.mock.calls[1][0]).toBe('/api/holiday-ledger?month=2026-09&department=d1&subDepartment=s1')
    expect(wrapper.find('[data-test="holiday-ledger-resolve-dialog"]').exists()).toBe(false)
  })

  it('requires a note for 不補 and a date for 已另行補休 before it posts anything', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    apiFetch.mockClear()

    await wrapper.find('[data-test="ledger-resolve-b2-2026-09-25"]').trigger('click')
    const radios = wrapper.findAll('[data-test="holiday-ledger-kind"] label')
    await radios.find((node) => node.text() === '不補').find('input').setValue(true)
    await wrapper.find('[data-test="holiday-ledger-save"]').trigger('click')
    expect(messageWarning).toHaveBeenCalledWith('選擇「不補」時請填寫備註')

    await radios.find((node) => node.text() === '已另行補休').find('input').setValue(true)
    await wrapper.find('[data-test="holiday-ledger-save"]').trigger('click')
    expect(messageWarning).toHaveBeenCalledWith('請選擇實際補休的日期')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sends the chosen date for 已另行補休 and the note for 不補', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(jsonResponse({ id: 'r9' })).mockResolvedValue(jsonResponse(LEDGER))

    await wrapper.find('[data-test="ledger-resolve-d4-2026-09-28"]').trigger('click')
    const radios = wrapper.findAll('[data-test="holiday-ledger-kind"] label')
    await radios.find((node) => node.text() === '已另行補休').find('input').setValue(true)
    await wrapper.find('[data-test="holiday-ledger-rested-date"]').setValue('2026-10-03')
    await wrapper.find('[data-test="holiday-ledger-save"]').trigger('click')
    await flushPromises()

    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({
      employee: 'd4',
      holidayDate: '2026-09-28',
      kind: 'rested_later',
      restedDate: '2026-10-03',
      note: '',
    })
  })

  it('opens an existing record for editing and can delete it', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(jsonResponse({ success: true })).mockResolvedValue(jsonResponse(LEDGER))

    await wrapper.find('[data-test="ledger-resolve-e5-2026-09-25"]').trigger('click')
    expect(fieldOf(wrapper, 'holiday-ledger-hours').element.value).toBe('8')
    await wrapper.find('[data-test="holiday-ledger-remove"]').trigger('click')
    await flushPromises()

    expect(apiFetch.mock.calls[0]).toEqual(['/api/holiday-ledger/resolutions/r1', { method: 'DELETE' }])
    expect(messageSuccess).toHaveBeenCalledWith('已刪除登記')
  })

  it('shows the server message in Chinese when saving fails and keeps the form open', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(jsonResponse({ error: 'holidayDate is not a national holiday' }, 400))

    await wrapper.find('[data-test="ledger-resolve-b2-2026-09-25"]').trigger('click')
    await wrapper.find('[data-test="holiday-ledger-save"]').trigger('click')
    await flushPromises()

    expect(messageError).toHaveBeenCalledWith('這一天不是國定假日，無法登記')
    expect(wrapper.find('[data-test="holiday-ledger-resolve-dialog"]').exists()).toBe(true)
  })

  it('reloads for another month and keeps the rest of the page scope', async () => {
    const wrapper = mountDialog({ scope: { ...SCOPE, includeSelf: true } })
    await flushPromises()
    apiFetch.mockClear()

    await wrapper.find('[data-test="holiday-ledger-month"]').setValue('2026-10')
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith('/api/holiday-ledger?month=2026-10&department=d1&subDepartment=s1&includeSelf=true')
  })

  it('says so when the month has no national holiday', async () => {
    apiFetch.mockResolvedValue(jsonResponse({ months: [{ month: '2026-08', holidays: [], employees: [], summary: { employees: 0, holidays: 0, entitled: 0, rested: 0, moved: 0, notTaken: 0, open: 0, extra: 0, excluded: { notScheduled: 0 } } }], summary: {} }))
    const wrapper = mountDialog({ scope: { ...SCOPE, month: '2026-08' } })
    await flushPromises()

    expect(wrapper.find('[data-test="holiday-ledger-no-holiday"]').text()).toContain('這個月沒有國定假日')
  })

  it('shows a readable error instead of a table when loading fails', async () => {
    apiFetch.mockResolvedValue(jsonResponse({ error: 'too many employees (2500); narrow by department or subDepartment' }, 400))
    const wrapper = mountDialog()
    await flushPromises()

    expect(wrapper.find('[data-test="holiday-ledger-error"]').text()).toContain('員工人數太多')
    expect(wrapper.find('[data-test="holiday-ledger-table"]').exists()).toBe(false)

    apiFetch.mockRejectedValue(new Error('network'))
    const failed = mountDialog()
    await flushPromises()
    expect(failed.find('[data-test="holiday-ledger-error"]').text()).toContain('載入國定假日休假紀錄失敗')
  })

  it('ignores a slow answer for a month that is no longer selected', async () => {
    let releaseFirst
    apiFetch
      .mockImplementationOnce(() => new Promise((resolve) => { releaseFirst = () => resolve(jsonResponse(LEDGER)) }))
      .mockResolvedValue(jsonResponse({ months: [{ month: '2026-10', holidays: [], employees: [], summary: { excluded: { notScheduled: 0 } } }], summary: {} }))
    const wrapper = mountDialog()
    await flushPromises()

    await wrapper.find('[data-test="holiday-ledger-month"]').setValue('2026-10')
    await flushPromises()
    releaseFirst()
    await flushPromises()

    expect(wrapper.find('[data-test="holiday-ledger-no-holiday"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="ledger-cell-a1-2026-09-25"]').exists()).toBe(false)
  })

  it('downloads the Excel export for the chosen month', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    apiFetch.mockClear()
    apiFetch.mockResolvedValue(jsonResponse({}))
    const createObjectURL = vi.fn(() => 'blob:ledger')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function recordDownload() {
      click.download = this.download
    })

    await wrapper.find('[data-test="holiday-ledger-export"]').trigger('click')
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith('/api/holiday-ledger/export?month=2026-09&department=d1&subDepartment=s1')
    expect(click).toHaveBeenCalledTimes(1)
    expect(click.download).toBe('holiday-ledger-2026-09.xlsx')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:ledger')
    click.mockRestore()
    vi.unstubAllGlobals()
  })

  it('exports what is on screen: the active filter and the search text go to the server', async () => {
    const wrapper = mountDialog()
    await flushPromises()
    apiFetch.mockClear()
    apiFetch.mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:ledger'), revokeObjectURL: vi.fn() }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const exportUrls = () => apiFetch.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/holiday-ledger/export'))
    const exportNow = async () => {
      await wrapper.find('[data-test="holiday-ledger-export"]').trigger('click')
      await flushPromises()
    }
    const choose = async (label) => {
      const radio = wrapper.findAll('label.el-radio-button').find((node) => node.text().startsWith(label))
      await radio.find('input').setValue(true)
      await flushPromises()
    }

    await choose('待處理')
    await exportNow()
    await choose('未休')
    await exportNow()
    await choose('全部')
    await fieldOf(wrapper, 'holiday-ledger-search').setValue('  未休乙 ')
    await exportNow()
    await choose('移休')
    await exportNow()

    expect(exportUrls()).toEqual([
      '/api/holiday-ledger/export?month=2026-09&department=d1&subDepartment=s1&status=open',
      '/api/holiday-ledger/export?month=2026-09&department=d1&subDepartment=s1&status=notTaken',
      `/api/holiday-ledger/export?month=2026-09&department=d1&subDepartment=s1&search=${encodeURIComponent('未休乙')}`,
      `/api/holiday-ledger/export?month=2026-09&department=d1&subDepartment=s1&status=moved&search=${encodeURIComponent('未休乙')}`,
    ])
    // 畫面上的資料本身仍是整月（篩選與搜尋在畫面上做），不重新載入
    expect(apiFetch.mock.calls.some(([url]) => url.startsWith('/api/holiday-ledger?'))).toBe(false)
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
