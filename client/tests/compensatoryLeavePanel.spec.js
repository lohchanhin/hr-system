import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'

const { messageError, messageSuccess, messageWarning, prompt } = vi.hoisted(() => ({
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  messageWarning: vi.fn(),
  prompt: vi.fn(),
}))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: Object.assign(vi.fn(), { error: messageError, success: messageSuccess, warning: messageWarning }),
    ElMessageBox: { ...actual.ElMessageBox, prompt },
  }
})
vi.mock('../src/api', () => ({ apiFetch: vi.fn() }))

import { apiFetch } from '../src/api'
import CompensatoryLeavePanel from '../src/components/CompensatoryLeavePanel.vue'
import LeaveBalancePanel from '../src/components/LeaveBalancePanel.vue'

globalThis.ResizeObserver = globalThis.ResizeObserver || class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

const bank = (patch = {}) => ({
  employeeId: 'e1',
  hoursPerCredit: 8,
  expiryMonths: 0,
  earnedHours: 24,
  usedHours: 12,
  balanceHours: 12,
  expiredHours: 0,
  pendingHours: 4,
  availableHours: 8,
  credits: [
    {
      id: 'c2', sourceText: '2026-10-25 臺灣光復暨金門古寧頭大捷紀念日 適逢週日', status: 'partial', statusLabel: '部分使用',
      hours: 8, usedHours: 4, remainingHours: 4, expiredHours: 0, suggestedDate: '2026-10-26', conflict: false,
      usages: [{ id: 'u1', kind: 'leave_request', kindLabel: '調休簽核', hours: 4, approvalStatus: 'approved', days: [{ date: '2026-11-02', hours: 4 }], fullDayDates: [] }],
    },
    {
      id: 'c1', sourceText: '2026-10-10 國慶日 適逢例假', status: 'used', statusLabel: '已使用',
      hours: 8, usedHours: 8, remainingHours: 0, suggestedDate: '2026-10-12', conflict: true, conflictReason: 'trigger_gone',
      usages: [{ id: 'u2', kind: 'hr_assigned', kindLabel: 'HR 指定', hours: 8, days: [{ date: '2026-10-14', hours: 8 }], fullDayDates: ['2026-10-14'], note: '協商' }],
    },
    { id: 'c3', sourceText: '人資手動給予：值班', status: 'available', statusLabel: '未使用', hours: 8, usedHours: 0, remainingHours: 8, suggestedDate: null, usages: [] },
  ],
  ...patch,
})

// el-input 把 data-test 放在原生 input 上（或外層）：兩種都找得到
function noteInput(wrapper) {
  const node = wrapper.find('[data-test="comp-leave-manage-note"]')
  return node.element.tagName === 'INPUT' ? node : node.find('input')
}

const mounted = []
function mountPanel(props = {}) {
  const wrapper = mount(CompensatoryLeavePanel, { props, global: { plugins: [ElementPlus] } })
  mounted.push(wrapper)
  return wrapper
}

beforeEach(() => {
  apiFetch.mockReset()
  messageError.mockReset()
  messageSuccess.mockReset()
  messageWarning.mockReset()
  prompt.mockReset()
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
})

describe('CompensatoryLeavePanel（我的調休）', () => {
  it('loads the caller\'s own bank and shows the balance, every credit with its source, status and the approval that used it', async () => {
    apiFetch.mockResolvedValue(json(bank()))
    const wrapper = mountPanel({ title: '我的調休' })
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith('/api/compensatory-leave/mine')
    expect(wrapper.text()).toContain('我的調休')
    expect(wrapper.find('[data-test="comp-leave-available"]').text()).toBe('可用 8 小時（1 天）')
    const summary = wrapper.find('[data-test="comp-leave-summary"]').text()
    expect(summary).toContain('存摺剩餘 12 小時（1.5 天）')
    expect(summary).toContain('簽核中 4 小時（0.5 天）')
    const text = wrapper.text()
    expect(text).toContain('2026-10-25 臺灣光復暨金門古寧頭大捷紀念日 適逢週日')
    expect(text).toContain('部分使用')
    // 移休以天計（2026/10）：時數旁一律附上天數
    expect(text).toContain('8 小時（1 天），已用 4 小時（0.5 天），剩 4 小時（0.5 天）')
    expect(text).toContain('調休簽核 4 小時（0.5 天；2026/11/02 4 小時，已核准）')
    expect(text).toContain('HR 指定 8 小時（1 天；2026/10/14 整天）：協商')
    expect(text).toContain('2026/10/26')
    expect(wrapper.find('[data-test="comp-leave-conflict"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="comp-leave-help"]').text()).toContain('選假別「調休」')
    // 不是管理員：沒有給予、扣除、作廢
    expect(wrapper.find('[data-test="comp-leave-manage"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="comp-leave-void"]').exists()).toBe(false)
  })

  it('reads another employee\'s bank by id, shows given data without asking the server, and says when it cannot load', async () => {
    apiFetch.mockResolvedValue(json(bank()))
    mountPanel({ employeeId: 'e9' })
    await flushPromises()
    expect(apiFetch).toHaveBeenCalledWith('/api/compensatory-leave?employeeId=e9')

    apiFetch.mockClear()
    const given = mountPanel({ bank: bank(), compact: true })
    await flushPromises()
    expect(apiFetch).not.toHaveBeenCalled()
    expect(given.find('[data-test="comp-leave-help"]').exists()).toBe(false)

    apiFetch.mockResolvedValue(json({ error: 'x' }, 500))
    const broken = mountPanel()
    await flushPromises()
    expect(broken.find('[data-test="comp-leave-error"]').text()).toContain('調休存摺暫時無法載入')
  })

  it('shows an empty bank plainly', async () => {
    apiFetch.mockResolvedValue(json(bank({ credits: [], earnedHours: 0, usedHours: 0, balanceHours: 0, pendingHours: 0, availableHours: 0 })))
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-test="comp-leave-empty"]').text()).toBe('目前沒有調休')
  })

  it('lets an admin give hours with a required note, deduct hours, and void an unused credit with a reason', async () => {
    apiFetch.mockResolvedValue(json(bank()))
    const wrapper = mountPanel({ employeeId: 'e1', canManage: true })
    await flushPromises()
    expect(wrapper.find('[data-test="comp-leave-manage"]').exists()).toBe(true)
    // 只有沒用過的「未使用」額度可以作廢
    expect(wrapper.findAll('[data-test="comp-leave-void"]')).toHaveLength(1)

    await wrapper.find('[data-test="comp-leave-manage-save"]').trigger('click')
    expect(messageWarning).toHaveBeenCalledWith('請填寫備註（給予或調整的原因）')
    expect(apiFetch).toHaveBeenCalledTimes(1)

    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(json({ id: 'c4' }, 201)).mockResolvedValue(json(bank()))
    await noteInput(wrapper).setValue('加班換休')
    await wrapper.find('[data-test="comp-leave-manage-save"]').trigger('click')
    await flushPromises()
    expect(apiFetch.mock.calls[0][0]).toBe('/api/compensatory-leave/credits')
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ employeeId: 'e1', hours: 8, note: '加班換休' })
    expect(messageSuccess).toHaveBeenCalledWith('已給予調休')
    expect(apiFetch.mock.calls[1][0]).toBe('/api/compensatory-leave?employeeId=e1')
    expect(wrapper.emitted('changed')).toHaveLength(1)

    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(json({ error: '調休餘額不足：可用 8 小時，本次需扣 8 小時', code: 'COMP_LEAVE_INSUFFICIENT' }, 409))
    const deduct = wrapper.findAll('label.el-radio-button').find((node) => node.text() === '扣除調整')
    await deduct.find('input').setValue(true)
    await noteInput(wrapper).setValue('更正')
    await wrapper.find('[data-test="comp-leave-manage-save"]').trigger('click')
    await flushPromises()
    expect(apiFetch.mock.calls[0][0]).toBe('/api/compensatory-leave/adjustments')
    expect(messageError).toHaveBeenCalledWith('調休餘額不足：可用 8 小時，本次需扣 8 小時')

    apiFetch.mockClear()
    prompt.mockResolvedValue({ value: '重複給予' })
    apiFetch.mockResolvedValueOnce(json({ id: 'c3', status: 'void' })).mockResolvedValue(json(bank()))
    await wrapper.find('[data-test="comp-leave-void"]').trigger('click')
    await flushPromises()
    expect(apiFetch.mock.calls[0][0]).toBe('/api/compensatory-leave/credits/c3/void')
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ note: '重複給予' })
    expect(messageSuccess).toHaveBeenCalledWith('已作廢')
  })
})

describe('LeaveBalancePanel：簽核人看申請人的調休存摺', () => {
  it('lists the applicant\'s credits under the balances and what this request took from them', async () => {
    const balances = {
      year: 2026,
      range: { start: '2026-01-01', end: '2026-12-31' },
      dayHours: 8,
      items: [{ key: 'comp', name: '調休', source: 'bank', period: 'none', enforcement: 'block', status: 'bank', quotaHours: 24, usedHours: 12, pendingHours: 0, remainingHours: 12, availableHours: 12, includes: [] }],
      unmatched: [],
      focus: { typeKey: 'comp', typeName: '調休', requestedHours: 8, remainingBefore: 12, remainingAfter: 4, exceeded: false },
      compensatory: { ...bank(), focus: true, thisRequest: { hours: 8, credits: [{ creditId: 'c1', sourceText: '2026-10-10 國慶日 適逢例假', hours: 8 }] } },
    }
    const wrapper = mount(LeaveBalancePanel, { props: { balances, title: '申請人假別餘額' }, global: { plugins: [ElementPlus] } })
    mounted.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('累計取得 24 小時（3 天）')
    expect(wrapper.text()).toContain('存摺')
    const compensatory = wrapper.find('[data-test="leave-balance-compensatory"]')
    expect(compensatory.exists()).toBe(true)
    expect(compensatory.text()).toContain('申請人的調休存摺（本次申請調休）')
    expect(compensatory.text()).toContain('2026-10-25 臺灣光復暨金門古寧頭大捷紀念日 適逢週日')
    expect(wrapper.find('[data-test="leave-balance-comp-this"]').text()).toBe('這張單已扣用調休 8 小時（1 天）：2026-10-10 國慶日 適逢例假 8 小時（1 天）')
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

// R4（2026/10）：客戶把調休叫做移休、以天計；管理員可以在員工的人事資料（員工管理的調休存摺）填寫備註，員工在「我的調休」唯讀看得到
describe('CompensatoryLeavePanel：移休的天數與存摺備註', () => {
  const note = { text: '10/10 國慶日改發加倍工資，不另給移休', updatedAt: '2026-10-26T02:00:00.000Z', updatedBy: { id: 'a1', name: '人資小林' } }
  // el-input 把 data-test 放在原生 textarea 上（或外層）：兩種都找得到
  const textareaOf = (wrapper) => {
    const node = wrapper.find('[data-test="comp-leave-note-input"]')
    return node.element.tagName === 'TEXTAREA' ? node : node.find('textarea')
  }

  it('shows the note read-only to the employee, with who wrote it', async () => {
    apiFetch.mockResolvedValue(json(bank({ note })))
    const wrapper = mountPanel({ title: '我的調休' })
    await flushPromises()

    expect(wrapper.find('[data-test="comp-leave-note-text"]').text()).toBe('10/10 國慶日改發加倍工資，不另給移休')
    expect(wrapper.find('[data-test="comp-leave-note"]').text()).toContain('人資小林 2026/10/26 更新')
    expect(wrapper.find('[data-test="comp-leave-note-edit"]').exists()).toBe(false)
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('shows nothing when there is no note, and no note editor on the approval detail', async () => {
    apiFetch.mockResolvedValue(json(bank({ note: { text: '', updatedAt: null, updatedBy: null } })))
    const wrapper = mountPanel()
    await flushPromises()
    expect(wrapper.find('[data-test="comp-leave-note"]').exists()).toBe(false)

    const detail = mountPanel({ bank: bank(), compact: true, canManage: true })
    await flushPromises()
    expect(detail.find('[data-test="comp-leave-note-edit"]').exists()).toBe(false)
  })

  it('lets an admin edit, save and clear the note of the employee', async () => {
    apiFetch.mockResolvedValue(json(bank({ note })))
    const wrapper = mountPanel({ employeeId: 'e1', canManage: true })
    await flushPromises()

    expect(textareaOf(wrapper).element.value).toBe('10/10 國慶日改發加倍工資，不另給移休')
    expect(wrapper.find('[data-test="comp-leave-note-meta"]').text()).toBe('人資小林 2026/10/26 更新')
    // 沒改就不能按儲存
    expect(wrapper.find('[data-test="comp-leave-note-save"]').attributes('disabled')).toBeDefined()

    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(json({ text: '移休請於年底前用完' })).mockResolvedValue(json(bank({ note: { ...note, text: '移休請於年底前用完' } })))
    await textareaOf(wrapper).setValue('  移休請於年底前用完  ')
    await wrapper.find('[data-test="comp-leave-note-save"]').trigger('click')
    await flushPromises()
    expect(apiFetch.mock.calls[0][0]).toBe('/api/compensatory-leave/note')
    expect(apiFetch.mock.calls[0][1].method).toBe('PUT')
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ employeeId: 'e1', note: '移休請於年底前用完' })
    expect(messageSuccess).toHaveBeenCalledWith('已儲存備註')
    expect(apiFetch.mock.calls[1][0]).toBe('/api/compensatory-leave?employeeId=e1')
    expect(textareaOf(wrapper).element.value).toBe('移休請於年底前用完')

    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(json({ text: '' })).mockResolvedValue(json(bank({ note: { text: '', updatedAt: null, updatedBy: null } })))
    await textareaOf(wrapper).setValue('')
    await wrapper.find('[data-test="comp-leave-note-save"]').trigger('click')
    await flushPromises()
    expect(JSON.parse(apiFetch.mock.calls[0][1].body)).toEqual({ employeeId: 'e1', note: '' })
    expect(messageSuccess).toHaveBeenCalledWith('已清除備註')
  })

  it('shows the server message when the note cannot be saved', async () => {
    apiFetch.mockResolvedValue(json(bank()))
    const wrapper = mountPanel({ employeeId: 'e1', canManage: true })
    await flushPromises()
    apiFetch.mockClear()
    apiFetch.mockResolvedValueOnce(json({ error: '找不到這位員工', code: 'EMPLOYEE_NOT_FOUND' }, 404))
    await textareaOf(wrapper).setValue('x')
    await wrapper.find('[data-test="comp-leave-note-save"]').trigger('click')
    await flushPromises()
    expect(messageError).toHaveBeenCalledWith('找不到這位員工')
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('shows the day equivalent next to the hours an admin gives or deducts', async () => {
    apiFetch.mockResolvedValue(json(bank()))
    const wrapper = mountPanel({ employeeId: 'e1', canManage: true })
    await flushPromises()
    expect(wrapper.find('[data-test="comp-leave-manage-days"]').text()).toBe('小時（1 天）')
    expect(wrapper.find('[data-test="comp-leave-summary"]').text()).toContain('累計取得 24 小時（3 天）')
  })
})
