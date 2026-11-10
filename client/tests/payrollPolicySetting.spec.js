import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import PayrollPolicySetting from '../src/components/backComponents/PayrollPolicySetting.vue'

// 計薪規則（請假加班設定 › 加班與計薪）：月中到職／離職的月薪比例、加班費倍率、新進員工是否自動計算加班費、
// 現有員工整批開啟／關閉。契約見 docs/payroll-policy.md

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

const DEFAULT_RATES = {
  weekdayFirst2: 4 / 3,
  weekdayAfter2: 5 / 3,
  restDayFirst2: 4 / 3,
  restDayHours3To8: 5 / 3,
  restDayHours9To12: 8 / 3,
  holidayWithin8: 1,
  holidayAfter8First2: 4 / 3,
  holidayAfter10: 5 / 3,
}
const RATE_OPTIONS = [
  ['weekdayFirst2', 'workday', '平日加班前 2 小時', '4/3'],
  ['weekdayAfter2', 'workday', '平日加班第 3～4 小時', '5/3'],
  ['restDayFirst2', 'rest_day', '休息日加班前 2 小時', '4/3'],
  ['restDayHours3To8', 'rest_day', '休息日加班第 3～8 小時', '5/3'],
  ['restDayHours9To12', 'rest_day', '休息日加班第 9～12 小時', '8/3'],
  ['holidayWithin8', 'national_holiday', '國定假日出勤 8 小時內（加發一日工資）', '1'],
  ['holidayAfter8First2', 'national_holiday', '國定假日出勤超過 8 小時的前 2 小時', '4/3'],
  ['holidayAfter10', 'national_holiday', '國定假日出勤超過 10 小時的 2 小時', '5/3'],
].map(([key, dayType, label, defaultText]) => ({ key, dayType, label, default: DEFAULT_RATES[key], defaultText, min: 1, max: 5 }))

function policyBody(patch = {}) {
  return {
    proration: { method: 'days30' },
    overtime: { rates: { ...DEFAULT_RATES }, newEmployeeAutoCalc: true },
    defaults: { proration: { method: 'days30' }, overtime: { rates: { ...DEFAULT_RATES }, newEmployeeAutoCalc: true } },
    customized: { prorationMethod: false, overtimeRates: [], newEmployeeAutoCalc: false },
    options: {
      prorationMethods: [
        { value: 'days30', label: '按 30 天計算', description: '月中到職或離職的月薪 = 月薪 × 在職日曆天數 ÷ 30（最多一個月）。' },
        { value: 'calendarDays', label: '按當月日曆天數計算', description: '月中到職或離職的月薪 = 月薪 × 在職日曆天數 ÷ 當月天數。' },
        { value: 'none', label: '不按比例', description: '當月只要有在職就給整個月的月薪。' },
      ],
      overtimeRates: RATE_OPTIONS,
    },
    stats: { activeEmployees: 10, autoOvertimeCalcOn: 2, autoOvertimeCalcOff: 8 },
    updatedAt: null,
    ...patch,
  }
}

let calls
let handlers
const mounted = []

beforeEach(() => {
  calls = []
  handlers = {
    get: () => json(policyBody()),
    put: (body) => json(policyBody({
      proration: { method: body.proration?.method || 'days30' },
      overtime: { rates: { ...DEFAULT_RATES, ...(body.overtime?.rates || {}) }, newEmployeeAutoCalc: body.overtime?.newEmployeeAutoCalc ?? true },
    })),
    bulk: (body) => (body.dryRun
      ? json({ enabled: body.enabled, dryRun: true, scope: 'active', matched: 10, willChange: body.enabled ? 8 : 2 })
      : json({ enabled: body.enabled, dryRun: false, scope: 'active', matched: 10, willChange: 8, changed: 8, stats: { activeEmployees: 10, autoOvertimeCalcOn: 10, autoOvertimeCalcOff: 0 } })),
  }
  for (const mock of [messageSuccess, messageError, messageInfo, confirmMock]) mock.mockReset()
  vi.spyOn(window, 'fetch').mockImplementation((url, init = {}) => {
    const method = init.method || 'GET'
    const body = init.body ? JSON.parse(init.body) : undefined
    calls.push({ url: String(url), method, body })
    if (String(url).includes('/api/payroll/policy')) return Promise.resolve(method === 'PUT' ? handlers.put(body) : handlers.get())
    if (String(url).includes('/api/employees/auto-overtime-calc')) return Promise.resolve(handlers.bulk(body))
    return Promise.resolve(json({}))
  })
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  vi.restoreAllMocks()
})

async function mountSetting() {
  const wrapper = mount(PayrollPolicySetting, { global: { plugins: [ElementPlus] } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

const puts = () => calls.filter(call => call.method === 'PUT')
const rateInput = (wrapper, key) => wrapper.find(`[data-test="rate-input-${key}"]`)

describe('PayrollPolicySetting 顯示', () => {
  it('三種計薪方式各有一句說明、標出預設；8 個倍率依情境分組，顯示預設的分數寫法', async () => {
    const wrapper = await mountSetting()
    const proration = wrapper.find('[data-test="proration-section"]')
    expect(proration.findAll('.method-option__label').map(node => node.text())).toEqual(['按 30 天計算 預設', '按當月日曆天數計算', '不按比例'])
    expect(proration.text()).toContain('月薪 × 在職日曆天數 ÷ 當月天數')
    expect(wrapper.vm.$el.querySelector('input[value="days30"]').checked).toBe(true)

    const rows = wrapper.findAll('[data-test="rates-table"] tbody tr').map(row => row.findAll('th, td').map(cell => cell.text()))
    expect(rows.map(cells => cells.filter(Boolean))).toEqual([
      ['平日', '前 2 小時', '4/3'],
      ['第 3～4 小時', '5/3'],
      ['休息日', '前 2 小時', '4/3'],
      ['第 3～8 小時', '5/3'],
      ['第 9～12 小時', '8/3'],
      ['國定假日', '8 小時內（加發一日工資）', '1'],
      ['超過 8 小時的前 2 小時', '4/3'],
      ['超過 10 小時的 2 小時', '5/3'],
    ])
    expect(rateInput(wrapper, 'weekdayFirst2').element.value).toBe('4/3')
    expect(rateInput(wrapper, 'holidayWithin8').element.value).toBe('1')
    expect(wrapper.find('[data-test="auto-calc-stats"]').text()).toBe('開啟 2 位／關閉 8 位')
    // 沒有變更時「儲存」按不下去，也沒有「還原預設」
    expect(wrapper.find('[data-test="payroll-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-test="rate-restore-weekdayFirst2"]').exists()).toBe(false)
    // 一個區塊一顆主要按鈕
    expect(wrapper.findAll('.el-button--primary:not(.is-link)')).toHaveLength(1)
  })

  it('改過的倍率照伺服器的值顯示（兩位小數照寫、三分之一的倍數寫成分數）', async () => {
    handlers.get = () => json(policyBody({ overtime: { rates: { ...DEFAULT_RATES, weekdayFirst2: 1.5, restDayHours9To12: 7 / 3 }, newEmployeeAutoCalc: false } }))
    const wrapper = await mountSetting()
    expect(rateInput(wrapper, 'weekdayFirst2').element.value).toBe('1.5')
    expect(rateInput(wrapper, 'restDayHours9To12').element.value).toBe('7/3')
    expect(wrapper.find('[data-test="rate-restore-weekdayFirst2"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="new-employee-auto-calc"]').classes()).not.toContain('is-checked')
  })

  it('讀取失敗時顯示伺服器的中文原因與「重新載入」', async () => {
    handlers.get = () => json({ error: '只有管理員可以查看薪資設定' }, 403)
    const wrapper = await mountSetting()
    expect(wrapper.find('[data-test="payroll-policy-error"]').text()).toContain('只有管理員可以查看薪資設定')
    handlers.get = () => json(policyBody())
    await wrapper.find('[data-test="payroll-policy-error"] button').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-test="payroll-policy-error"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="rates-table"]').exists()).toBe(true)
  })

  it('parseRate 與伺服器相同：1～5、最多兩位小數或三分之一的倍數、可以寫分數', async () => {
    const wrapper = await mountSetting()
    const { parseRate, formatRate } = wrapper.vm
    expect(parseRate('1.5')).toBe(1.5)
    expect(parseRate('4/3')).toBeCloseTo(4 / 3, 12)
    expect(parseRate(' 2 ')).toBe(2)
    expect(parseRate('1.333')).toBeNull()
    expect(parseRate('0.9')).toBeNull()
    expect(parseRate('5.01')).toBeNull()
    expect(parseRate('abc')).toBeNull()
    expect(parseRate('')).toBeNull()
    expect(formatRate(8 / 3)).toBe('8/3')
    expect(formatRate(1.25)).toBe('1.25')
  })
})

describe('PayrollPolicySetting 儲存', () => {
  it('只送改過的欄位；倍率送數字、送預設值就是還原', async () => {
    const wrapper = await mountSetting()
    await wrapper.find('input[value="calendarDays"]').setValue(true)
    await rateInput(wrapper, 'weekdayFirst2').setValue('1.5')
    await rateInput(wrapper, 'holidayAfter10').setValue('2')
    expect(wrapper.find('[data-test="payroll-dirty"]').text()).toBe('有未儲存的變更')

    await wrapper.find('[data-test="payroll-save"]').trigger('click')
    await flushPromises()
    expect(puts()).toHaveLength(1)
    expect(puts()[0].body).toEqual({ proration: { method: 'calendarDays' }, overtime: { rates: { weekdayFirst2: 1.5, holidayAfter10: 2 } } })
    expect(messageSuccess).toHaveBeenCalledWith('已儲存計薪規則')
    expect(wrapper.find('[data-test="payroll-dirty"]').exists()).toBe(false)

    // 每一列的「還原預設」：改回預設的分數，儲存時送預設值
    await wrapper.find('[data-test="rate-restore-weekdayFirst2"]').trigger('click')
    expect(rateInput(wrapper, 'weekdayFirst2').element.value).toBe('4/3')
    await wrapper.find('[data-test="payroll-save"]').trigger('click')
    await flushPromises()
    expect(puts()[1].body.overtime.rates.weekdayFirst2).toBeCloseTo(4 / 3, 12)
  })

  it('「全部還原預設」把三項設定都改回預設（按「儲存」才生效）', async () => {
    handlers.get = () => json(policyBody({
      proration: { method: 'none' },
      overtime: { rates: { ...DEFAULT_RATES, weekdayAfter2: 2 }, newEmployeeAutoCalc: false },
    }))
    const wrapper = await mountSetting()
    await wrapper.find('[data-test="payroll-restore-all"]').trigger('click')
    expect(messageInfo).toHaveBeenCalledWith('已還原成預設值，按「儲存」才會生效')
    expect(puts()).toHaveLength(0)
    await wrapper.find('[data-test="payroll-save"]').trigger('click')
    await flushPromises()
    expect(puts()[0].body.proration).toEqual({ method: 'days30' })
    expect(puts()[0].body.overtime.newEmployeeAutoCalc).toBe(true)
    expect(puts()[0].body.overtime.rates.weekdayAfter2).toBeCloseTo(5 / 3, 12)
  })

  it('倍率格式不對：欄位旁顯示原因、不送出', async () => {
    const wrapper = await mountSetting()
    await rateInput(wrapper, 'weekdayAfter2').setValue('1.333')
    expect(wrapper.find('[data-test="rate-error-weekdayAfter2"]').text()).toContain('1～5 的數字')
    await rateInput(wrapper, 'restDayFirst2').setValue('')
    expect(wrapper.find('[data-test="rate-error-restDayFirst2"]').text()).toBe('請填倍率')
    await wrapper.find('[data-test="payroll-save"]').trigger('click')
    await flushPromises()
    expect(puts()).toHaveLength(0)
    expect(messageError).toHaveBeenCalledWith('加班費倍率有格式不對的欄位，請修正後再儲存')
  })

  it('伺服器擋下時顯示它的中文原因，變更仍然算未儲存', async () => {
    handlers.put = () => json({ error: '「平日加班前 2 小時」的倍率必須是 1 到 5 之間的數字' }, 400)
    const wrapper = await mountSetting()
    await rateInput(wrapper, 'weekdayFirst2').setValue('3')
    await wrapper.find('[data-test="payroll-save"]').trigger('click')
    await flushPromises()
    expect(messageError).toHaveBeenCalledWith('「平日加班前 2 小時」的倍率必須是 1 到 5 之間的數字')
    expect(wrapper.vm.dirty).toBe(true)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('儲存中再按一次不會重複送出；網路中斷時顯示中文', async () => {
    let release
    handlers.put = () => new Promise(resolve => { release = () => resolve(json(policyBody())) })
    const wrapper = await mountSetting()
    await wrapper.find('[data-test="new-employee-auto-calc"]').trigger('click')
    const first = wrapper.vm.save()
    const second = wrapper.vm.save()
    await flushPromises()
    expect(puts()).toHaveLength(1)
    expect(puts()[0].body).toEqual({ overtime: { newEmployeeAutoCalc: false } })
    release()
    await Promise.all([first, second])

    handlers.put = () => Promise.reject(new TypeError('Failed to fetch'))
    await wrapper.find('[data-test="new-employee-auto-calc"]').trigger('click')
    await wrapper.vm.save()
    await flushPromises()
    expect(messageError).toHaveBeenCalledWith('儲存失敗，請確認網路連線後再試')
  })
})

describe('PayrollPolicySetting 現有員工整批設定', () => {
  it('「全部開啟」先試算再確認，確認後才真的改並更新人數', async () => {
    confirmMock.mockResolvedValue('confirm')
    const wrapper = await mountSetting()
    await wrapper.find('[data-test="bulk-enable"]').trigger('click')
    await flushPromises()
    const bulkCalls = calls.filter(call => call.url.includes('/api/employees/auto-overtime-calc'))
    expect(bulkCalls.map(call => call.body)).toEqual([{ enabled: true, dryRun: true }, { enabled: true, dryRun: false }])
    expect(confirmMock.mock.calls[0][0]).toContain('將開啟 8 位員工的自動計算加班費（已開啟 2 位）')
    expect(confirmMock.mock.calls[0][1]).toBe('全部開啟')
    expect(messageSuccess).toHaveBeenCalledWith('已開啟 8 位員工的自動計算加班費')
    expect(wrapper.find('[data-test="auto-calc-stats"]').text()).toBe('開啟 10 位／關閉 0 位')
  })

  it('取消確認就不改；沒有人會改變時直接說明，不跳確認', async () => {
    confirmMock.mockRejectedValue('cancel')
    const wrapper = await mountSetting()
    await wrapper.find('[data-test="bulk-disable"]').trigger('click')
    await flushPromises()
    expect(confirmMock.mock.calls[0][0]).toContain('將關閉 2 位員工的自動計算加班費（已關閉 8 位）')
    expect(calls.filter(call => call.url.includes('auto-overtime-calc')).map(call => call.body.dryRun)).toEqual([true])

    handlers.bulk = () => json({ enabled: true, dryRun: true, scope: 'active', matched: 10, willChange: 0 })
    confirmMock.mockReset()
    await wrapper.find('[data-test="bulk-enable"]').trigger('click')
    await flushPromises()
    expect(confirmMock).not.toHaveBeenCalled()
    expect(messageInfo).toHaveBeenCalledWith('在職員工的自動計算加班費都已經開啟')
  })

  it('執行中兩顆按鈕都按不下去；失敗時顯示伺服器的中文原因', async () => {
    let release
    handlers.bulk = () => new Promise(resolve => { release = () => resolve(json({ error: '「自動計算加班費」只能是 true 或 false' }, 400)) })
    const wrapper = await mountSetting()
    const running = wrapper.vm.runBulk(true)
    await flushPromises()
    expect(wrapper.find('[data-test="bulk-disable"]').attributes('disabled')).toBeDefined()
    await wrapper.vm.runBulk(false)
    expect(calls.filter(call => call.url.includes('auto-overtime-calc'))).toHaveLength(1)
    release()
    await running
    await flushPromises()
    expect(messageError).toHaveBeenCalledWith('「自動計算加班費」只能是 true 或 false')
    expect(wrapper.find('[data-test="bulk-disable"]').attributes('disabled')).toBeUndefined()
  })
})
