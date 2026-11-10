import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'

// 勞健保設定：級距表直接顯示（不用再按「顯示級距表」），讀取或更新失敗要說出來，更新中不能重複送出。
// 掛真正的 Element Plus，只把網路請求換成假伺服器。

const { apiFetchMock, messageSuccess, messageError } = vi.hoisted(() => ({
  apiFetchMock: vi.fn(),
  messageSuccess: vi.fn(),
  messageError: vi.fn(),
}))
vi.mock('../src/api', () => ({ apiFetch: apiFetchMock }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    ElMessage: Object.assign(vi.fn(), { success: messageSuccess, error: messageError, info: vi.fn(), warning: vi.fn() }),
  }
})

import SocialInsuranceRetirementSetting from '../src/components/backComponents/SocialInsuranceRetirementSetting.vue'

vi.setConfig({ testTimeout: 30000 })

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
const laborRates = [
  { level: 1, insuredSalary: 29500, workerFee: 738, employerFee: 2582, ordinaryRate: 11.5, employmentInsuranceRate: 1 },
  { level: 2, insuredSalary: 45800, workerFee: 1145, employerFee: 4008, ordinaryRate: 11.5, employmentInsuranceRate: 1 },
]

let ratesHandler
let refreshHandler
let calls
const mounted = []

beforeEach(() => {
  calls = []
  ratesHandler = (type) => json(type === 'laborInsurance' ? laborRates : [{ level: 1, insuredSalary: 28590, workerFee: 443, employerFee: 1384 }])
  refreshHandler = () => json({ success: true, message: '已載入 2026-01-01 生效的勞保官方基準（非即時連線）；結薪前仍應核對最新公告' })
  messageSuccess.mockReset()
  messageError.mockReset()
  apiFetchMock.mockReset()
  apiFetchMock.mockImplementation(async (url, init = {}) => {
    const parsed = new URL(String(url), 'http://localhost')
    const type = parsed.searchParams.get('type')
    calls.push({ pathname: parsed.pathname, type, method: init.method || 'GET' })
    if (parsed.pathname === '/api/payroll/insurance/rates') return ratesHandler(type)
    if (parsed.pathname === '/api/payroll/insurance/refresh') return refreshHandler(type)
    return json([])
  })
})

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
  vi.restoreAllMocks()
})

async function mountPage() {
  const wrapper = mount(SocialInsuranceRetirementSetting, { global: { plugins: [ElementPlus] }, attachTo: document.body })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}

describe('SocialInsuranceRetirementSetting.vue', () => {
  it('頁首是「勞健保設定」，級距表直接顯示，沒有自己的「說明」與「顯示級距表」按鈕', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="page-header"] h1').text()).toBe('勞健保設定')
    const buttons = wrapper.findAll('button').map(button => button.text())
    expect(buttons).not.toContain('說明')
    expect(buttons.some(text => text.includes('級距表'))).toBe(false)
    const laborPane = wrapper.find('#pane-laborInsurance')
    expect(laborPane.text()).toContain('NT$ 45,800')
    expect(laborPane.text()).toContain('NT$ 1,145')
    // 每個頁籤說明這張表的用途
    expect(laborPane.text()).toContain('薪資的勞保費依本薪對照這張表的「員工負擔」計算')
    expect(wrapper.find('#pane-healthInsurance').text()).toContain('僅供查閱：健保費以每位員工在「員工管理」設定的自付額計算')
    expect(wrapper.find('#pane-retirement').text()).toContain('僅供查閱：勞退自提以每位員工在「員工管理」設定的金額計算')
  })

  // 以前讀取失敗只留一張空表、更新失敗沒有任何反應
  it('級距讀取失敗時顯示原因', async () => {
    ratesHandler = (type) => (type === 'healthInsurance' ? json({ error: 'boom' }, 500) : json(laborRates))
    const wrapper = await mountPage()

    expect(wrapper.find('[data-test="error-healthInsurance"]').text()).toContain('健保級距載入失敗，請稍後再試')
    expect(wrapper.find('[data-test="error-laborInsurance"]').exists()).toBe(false)
  })

  it('更新成功：顯示訊息與上次更新時間（台灣時間 YYYY/MM/DD HH:mm），並重新讀取級距', async () => {
    const wrapper = await mountPage()
    const before = calls.filter(call => call.pathname.endsWith('/rates') && call.type === 'laborInsurance').length

    await wrapper.find('[data-test="refresh-laborInsurance"]').trigger('click')
    await flushPromises()

    expect(calls.some(call => call.pathname.endsWith('/refresh') && call.type === 'laborInsurance' && call.method === 'POST')).toBe(true)
    expect(calls.filter(call => call.pathname.endsWith('/rates') && call.type === 'laborInsurance')).toHaveLength(before + 1)
    expect(messageSuccess).toHaveBeenCalledWith('勞保級距已更新')
    const status = wrapper.find('[data-test="status-laborInsurance"]').text()
    expect(status).toMatch(/上次更新：\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}/)
    expect(status).toContain('已載入 2026-01-01 生效的勞保官方基準')
  })

  it('更新失敗時顯示原因（英文的伺服器訊息換成中文），不會顯示成已更新', async () => {
    refreshHandler = () => json({ error: 'connect ECONNREFUSED' }, 500)
    const wrapper = await mountPage()

    await wrapper.find('[data-test="refresh-laborInsurance"]').trigger('click')
    await flushPromises()

    expect(messageError).toHaveBeenCalledWith('勞保級距更新失敗，請稍後再試')
    expect(messageSuccess).not.toHaveBeenCalled()
    expect(wrapper.find('[data-test="status-laborInsurance"]').exists()).toBe(false)
    expect(wrapper.vm.refreshing.laborInsurance).toBe(false)
  })

  it('更新中再按一次不會重複送出', async () => {
    let release
    refreshHandler = () => new Promise(resolve => { release = () => resolve(json({ success: true, message: 'ok' })) })
    const wrapper = await mountPage()

    const first = wrapper.vm.refreshLaborInsuranceRates('laborInsurance')
    const second = wrapper.vm.refreshLaborInsuranceRates('laborInsurance')
    await flushPromises()
    expect(calls.filter(call => call.pathname.endsWith('/refresh'))).toHaveLength(1)
    expect(wrapper.vm.refreshing.laborInsurance).toBe(true)
    release()
    await Promise.all([first, second])
    expect(wrapper.vm.refreshing.laborInsurance).toBe(false)
  })

  it('級距資料缺欄位時顯示「-」，不會讓整頁壞掉', async () => {
    ratesHandler = () => json([{ level: 1, insuredSalary: 29500 }])
    const wrapper = await mountPage()
    expect(wrapper.vm.formatCurrency(undefined)).toBe('-')
    expect(wrapper.find('#pane-laborInsurance').text()).toContain('NT$ 29,500')
  })
})
