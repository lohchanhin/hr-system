import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import LeaveOvertimeSetting from '../src/components/backComponents/LeaveOvertimeSetting.vue'

// 請假加班設定：
// - 加班倍率以前是可以輸入的欄位，但只存在瀏覽器的 localStorage（overtime_rules_v2），薪資計算固定用勞基法倍率、從來不讀它，
//   改了也不會生效；現在只顯示薪資實際使用的倍率，不再有假的「儲存倍率」。
// - 假別規則只有一顆「儲存」，有未儲存的變更會標示出來。

const { messageSuccess, messageError, messageInfo, confirmMock } = vi.hoisted(() => ({
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
  messageInfo: vi.fn(),
  confirmMock: vi.fn(),
}))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: Object.assign(vi.fn(), { success: messageSuccess, error: messageError, info: messageInfo, warning: vi.fn() }),
    ElMessageBox: { ...actual.ElMessageBox, confirm: confirmMock },
  }
})

vi.setConfig({ testTimeout: 30000 })

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

const type = (patch) => ({
  aliases: [], quotaHours: null, period: 'year', source: 'policy', enforcement: 'warn', display: 'always',
  countsAgainst: null, builtin: true, enabled: true, note: '', ...patch,
})
const defaultPolicy = () => ({
  version: 1,
  yearBasis: 'calendar',
  maxHoursPerDay: 8,
  minUnitHours: 0.5,
  types: [
    type({ key: 'annual', name: '特休', aliases: ['特休假'], source: 'employee_annual', enforcement: 'block' }),
    type({ key: 'personal', name: '事假', quotaHours: 112 }),
    type({ key: 'custom_1', name: '榮譽假', quotaHours: 8, builtin: false }),
    type({ key: 'sick', name: '病假', quotaHours: 240, countsAgainst: { key: 'custom_1', exemptHours: 0 } }),
  ],
})

let calls
let putHandler
const mounted = []

beforeEach(() => {
  calls = []
  putHandler = (init) => json({ policy: JSON.parse(init.body), defaults: defaultPolicy() })
  localStorage.clear()
  messageSuccess.mockReset()
  messageError.mockReset()
  messageInfo.mockReset()
  confirmMock.mockReset()
  vi.spyOn(window, 'fetch').mockImplementation((url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url: String(url), method, body: init.body })
    if (!String(url).includes('/api/other-control-settings/leave-policy')) return Promise.resolve(json({}))
    if (method === 'PUT') return Promise.resolve(putHandler(init))
    return Promise.resolve(json({ policy: defaultPolicy(), defaults: defaultPolicy() }))
  })
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  vi.restoreAllMocks()
})

async function mountSetting() {
  const wrapper = mount(LeaveOvertimeSetting, { global: { plugins: [ElementPlus] } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('LeaveOvertimeSetting 版面', () => {
  it('頁首是「請假加班設定」，沒有自己的「說明」按鈕與「已移除頁籤」的殘留文字', async () => {
    const wrapper = await mountSetting()

    expect(wrapper.find('[data-test="page-header"] h1').text()).toBe('請假加班設定')
    expect(wrapper.text()).not.toContain('僅保留加班倍率設定')
    expect(wrapper.text()).not.toContain('已移除')
    expect(wrapper.findAll('button').some(button => button.text() === '說明')).toBe(false)
    // 一個區塊一顆主要按鈕，文字是「儲存」
    const primaryButtons = wrapper.findAll('.el-button--primary')
    expect(primaryButtons).toHaveLength(1)
    expect(primaryButtons[0].text()).toBe('儲存')
  })
})

// 2026/11：加班費倍率改成後台可以調整的計薪規則（GET / PUT /api/payroll/policy），放在「加班與計薪」頁籤
// （元件 PayrollPolicySetting，細節在 payrollPolicySetting.spec.js）；以前這裡是寫死在前端的唯讀倍率表
describe('LeaveOvertimeSetting 加班費倍率', () => {
  const payrollPolicy = () => ({
    proration: { method: 'days30' },
    overtime: { rates: { weekdayFirst2: 4 / 3 }, newEmployeeAutoCalc: true },
    defaults: { proration: { method: 'days30' }, overtime: { rates: { weekdayFirst2: 4 / 3 }, newEmployeeAutoCalc: true } },
    customized: { prorationMethod: false, overtimeRates: [], newEmployeeAutoCalc: false },
    options: {
      prorationMethods: [{ value: 'days30', label: '按 30 天計算', description: '月薪 × 在職日曆天數 ÷ 30' }],
      overtimeRates: [{ key: 'weekdayFirst2', dayType: 'workday', label: '平日加班前 2 小時', default: 4 / 3, defaultText: '4/3', min: 1, max: 5 }],
    },
    stats: { activeEmployees: 3, autoOvertimeCalcOn: 1, autoOvertimeCalcOff: 2 },
    updatedAt: null,
  })
  beforeEach(() => {
    const leaveFetch = window.fetch.getMockImplementation()
    window.fetch.mockImplementation((url, init = {}) => {
      if (String(url).includes('/api/payroll/policy')) {
        calls.push({ url: String(url), method: init.method || 'GET', body: init.body })
        return Promise.resolve(json(payrollPolicy()))
      }
      return leaveFetch(url, init)
    })
  })

  it('假別規則頁籤沒有寫死的倍率表；「加班與計薪」第一次點開才向伺服器讀倍率', async () => {
    const wrapper = await mountSetting()
    expect(wrapper.findAll('.el-tabs__item').map(item => item.text())).toEqual(['假別規則', '加班與計薪'])
    expect(wrapper.text()).not.toContain('薪資計算固定採用勞動基準法的倍率')
    expect(calls.some(call => call.url.includes('/api/payroll/policy'))).toBe(false)

    wrapper.vm.activeTab = 'payroll'
    await flushPromises()
    expect(calls.filter(call => call.url.includes('/api/payroll/policy'))).toHaveLength(1)
    const section = wrapper.find('[data-test="overtime-rates"]')
    expect(section.find('[data-test="rate-row-weekdayFirst2"]').text()).toContain('前 2 小時')
    expect(section.find('[data-test="rate-input-weekdayFirst2"]').element.value).toBe('4/3')
  })

  it('不讀也不寫瀏覽器裡舊的倍率（overtime_rules_v2），原本存的資料留著不動', async () => {
    const stored = JSON.stringify({ workday: { first2: 7.77, next2: 7.77 } })
    localStorage.setItem('overtime_rules_v2', stored)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const wrapper = await mountSetting()
    wrapper.vm.activeTab = 'payroll'
    await flushPromises()

    expect(wrapper.find('[data-test="overtime-rates"]').text()).not.toContain('7.77')
    await wrapper.find('[data-test="policy-save"]').trigger('click')
    await flushPromises()
    expect(setItem.mock.calls.some(([key]) => key === 'overtime_rules_v2')).toBe(false)
    expect(localStorage.getItem('overtime_rules_v2')).toBe(stored)
  })
})

describe('LeaveOvertimeSetting 未儲存的變更', () => {
  it('改了設定會標示「有未儲存的變更」，儲存成功後消失', async () => {
    const wrapper = await mountSetting()
    expect(wrapper.find('[data-test="policy-dirty"]').exists()).toBe(false)

    wrapper.vm.policy.maxHoursPerDay = 12
    await flushPromises()
    expect(wrapper.find('[data-test="policy-dirty"]').text()).toBe('有未儲存的變更')

    await wrapper.find('[data-test="policy-save"]').trigger('click')
    await flushPromises()
    expect(messageSuccess).toHaveBeenCalledWith('已儲存假別額度規則')
    expect(wrapper.find('[data-test="policy-dirty"]').exists()).toBe(false)
  })

  it('儲存失敗時變更仍然算未儲存；離開頁面（重新整理、關閉分頁）前會提醒', async () => {
    putHandler = () => json({ error: '假別名稱不可為空' }, 400)
    const wrapper = await mountSetting()
    wrapper.vm.policy.types[1].name = ''
    await wrapper.find('[data-test="policy-save"]').trigger('click')
    await flushPromises()

    expect(messageError).toHaveBeenCalledWith('假別名稱不可為空')
    expect(wrapper.vm.policyDirty).toBe(true)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('沒有變更時離開頁面不提醒；卸載後不再攔截', async () => {
    const wrapper = await mountSetting()
    const clean = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(clean)
    expect(clean.defaultPrevented).toBe(false)

    wrapper.vm.policy.maxHoursPerDay = 10
    await flushPromises()
    mounted.pop().unmount()
    const afterUnmount = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(afterUnmount)
    expect(afterUnmount.defaultPrevented).toBe(false)
  })

  it('儲存中再按一次不會重複送出', async () => {
    let release
    putHandler = (init) => new Promise(resolve => { release = () => resolve(json({ policy: JSON.parse(init.body), defaults: defaultPolicy() })) })
    const wrapper = await mountSetting()
    wrapper.vm.policy.maxHoursPerDay = 9

    const first = wrapper.vm.savePolicy()
    const second = wrapper.vm.savePolicy()
    await flushPromises()
    expect(calls.filter(call => call.method === 'PUT')).toHaveLength(1)
    release()
    await Promise.all([first, second])
    expect(wrapper.vm.policySaving).toBe(false)
  })

  it('網路中斷時顯示中文訊息', async () => {
    putHandler = () => Promise.reject(new TypeError('Failed to fetch'))
    const wrapper = await mountSetting()
    await wrapper.find('[data-test="policy-save"]').trigger('click')
    await flushPromises()
    expect(messageError).toHaveBeenCalledWith('儲存失敗，請確認網路連線後再試')
  })
})

describe('LeaveOvertimeSetting 刪除自訂假別', () => {
  it('按「刪除」先確認：確認後才從清單拿掉，併入它的假別一併清掉', async () => {
    confirmMock.mockResolvedValue('confirm')
    const wrapper = await mountSetting()
    const index = wrapper.vm.policy.types.findIndex(item => item.key === 'custom_1')

    await wrapper.vm.confirmRemoveType(index)
    expect(confirmMock).toHaveBeenCalledWith(expect.stringContaining('要刪除自訂假別「榮譽假」嗎'), '刪除假別', expect.objectContaining({ confirmButtonText: '刪除' }))
    expect(wrapper.vm.policy.types.map(item => item.key)).toEqual(['annual', 'personal', 'sick'])
    expect(wrapper.vm.policy.types.find(item => item.key === 'sick').countsAgainst).toBeNull()
    expect(wrapper.vm.policyDirty).toBe(true)
  })

  it('取消就不刪除', async () => {
    confirmMock.mockRejectedValue('cancel')
    const wrapper = await mountSetting()
    await wrapper.vm.confirmRemoveType(wrapper.vm.policy.types.findIndex(item => item.key === 'custom_1'))

    expect(wrapper.vm.policy.types.map(item => item.key)).toEqual(['annual', 'personal', 'custom_1', 'sick'])
    expect(wrapper.vm.policyDirty).toBe(false)
  })
})
