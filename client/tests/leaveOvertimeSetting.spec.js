import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import LeaveOvertimeSetting from '../src/components/backComponents/LeaveOvertimeSetting.vue'

const { messageSuccess, messageError, messageInfo } = vi.hoisted(() => ({ messageSuccess: vi.fn(), messageError: vi.fn(), messageInfo: vi.fn() }))
vi.mock('element-plus', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, ElMessage: Object.assign(vi.fn(), { success: messageSuccess, error: messageError, info: messageInfo, warning: vi.fn() }) }
})

beforeAll(() => {
  globalThis.ResizeObserver = globalThis.ResizeObserver || class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  messageSuccess.mockReset()
  messageError.mockReset()
  messageInfo.mockReset()
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
    type({ key: 'annual', name: '特休', aliases: ['特休假', '特別休假'], source: 'employee_annual', enforcement: 'block' }),
    type({ key: 'personal', name: '事假', quotaHours: 112 }),
    type({ key: 'family_care', name: '家庭照顧假', quotaHours: 56, countsAgainst: { key: 'personal', exemptHours: 0 } }),
    type({ key: 'official', name: '公假', period: 'none', enforcement: 'none', display: 'when_used' }),
  ],
})

function installFetch({ policy = defaultPolicy(), putResponse } = {}) {
  const calls = []
  vi.spyOn(window, 'fetch').mockImplementation((url, init = {}) => {
    const method = init.method || 'GET'
    calls.push({ url: String(url), method, body: init.body })
    if (!String(url).includes('/api/other-control-settings/leave-policy')) return Promise.resolve(json({}))
    if (method === 'PUT') {
      return Promise.resolve(putResponse || json({ policy: JSON.parse(init.body), defaults: defaultPolicy() }))
    }
    return Promise.resolve(json({ policy: JSON.parse(JSON.stringify(policy)), defaults: defaultPolicy() }))
  })
  return calls
}

const mounted = []
async function mountSetting() {
  const wrapper = mount(LeaveOvertimeSetting, { global: { plugins: [ElementPlus] } })
  mounted.push(wrapper)
  await flushPromises()
  return wrapper
}
afterEach(() => { while (mounted.length) mounted.pop().unmount() })

describe('LeaveOvertimeSetting 假別額度與餘額規則', () => {
  it('loads the policy and lists every leave type with its quota in hours and the day equivalent', async () => {
    const calls = installFetch()
    const wrapper = await mountSetting()

    expect(calls.some(call => call.method === 'GET' && call.url.endsWith('/api/other-control-settings/leave-policy'))).toBe(true)
    const card = wrapper.find('[data-test="leave-policy-card"]')
    expect(card.text()).toContain('假別額度與餘額規則')
    expect(card.text()).toContain('請假一律以小時為單位（1 天 = 8 小時）')
    expect(wrapper.vm.policy.types.map(item => item.name)).toEqual(['特休', '事假', '家庭照顧假', '公假'])
    expect(card.text()).toContain('依員工的年度特休時數')
    expect(card.text()).toContain('約 14 天') // 事假 112 小時
    expect(card.text()).toContain('約 7 天') // 家庭照顧假 56 小時
    expect(card.text()).toContain('不設上限')
    expect(wrapper.find('[data-test="policy-max-hours"] input').element.value).toBe('8')
  })

  it('saves the whole policy with the admin\'s changes (quota, block switch, daily maximum)', async () => {
    const calls = installFetch()
    const wrapper = await mountSetting()

    wrapper.vm.policy.maxHoursPerDay = 12
    wrapper.vm.policy.types[1].quotaHours = 80
    wrapper.vm.setBlocking(wrapper.vm.policy.types[1], true)
    await wrapper.find('[data-test="policy-save"]').trigger('click')
    await flushPromises()

    const put = calls.find(call => call.method === 'PUT')
    expect(put.url).toContain('/api/other-control-settings/leave-policy')
    const body = JSON.parse(put.body)
    expect(body.maxHoursPerDay).toBe(12)
    expect(body.types.find(item => item.key === 'personal')).toMatchObject({ quotaHours: 80, enforcement: 'block' })
    expect(messageSuccess).toHaveBeenCalledWith('已儲存假別額度規則')
  })

  it('the block switch means block vs warn, and a type without a quota cannot block anything', async () => {
    installFetch()
    const wrapper = await mountSetting()
    const [, personal, , official] = wrapper.vm.policy.types

    wrapper.vm.setBlocking(personal, true)
    expect(personal.enforcement).toBe('block')
    wrapper.vm.setBlocking(personal, false)
    expect(personal.enforcement).toBe('warn')

    official.quotaHours = null
    wrapper.vm.setBlocking(official, false)
    expect(official.enforcement).toBe('none')
  })

  it('shows the server\'s Chinese message when saving fails and keeps the edits', async () => {
    installFetch({ putResponse: json({ error: '假別名稱不可重複：事假' }, 400) })
    const wrapper = await mountSetting()
    wrapper.vm.policy.types[2].name = '事假'

    await wrapper.find('[data-test="policy-save"]').trigger('click')
    await flushPromises()

    expect(messageError).toHaveBeenCalledWith('假別名稱不可重複：事假')
    expect(wrapper.find('.policy-error').text()).toContain('假別名稱不可重複：事假')
    expect(wrapper.vm.policy.types[2].name).toBe('事假')
  })

  it('shows a read error with a reload button instead of an empty card', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(json({ error: '無法讀取假別額度規則，請稍後再試' }, 500))
    const wrapper = await mountSetting()
    expect(wrapper.find('.policy-error').text()).toContain('無法讀取假別額度規則')
    expect(wrapper.vm.policy).toBeNull()
  })

  it('adds a custom type, restores the defaults without saving, and removing a type clears what counted against it', async () => {
    installFetch()
    const wrapper = await mountSetting()

    wrapper.vm.addCustomType()
    wrapper.vm.addCustomType()
    const custom = wrapper.vm.policy.types.filter(item => !item.builtin)
    expect(custom.map(item => item.key)).toEqual(['custom_1', 'custom_2'])
    expect(custom[0]).toMatchObject({ source: 'policy', enabled: true, enforcement: 'none' })

    wrapper.vm.removeType(wrapper.vm.policy.types.findIndex(item => item.key === 'personal'))
    expect(wrapper.vm.policy.types.find(item => item.key === 'family_care').countsAgainst).toBeNull()

    wrapper.vm.restorePolicyDefaults()
    expect(wrapper.vm.policy.types.map(item => item.key)).toEqual(['annual', 'personal', 'family_care', 'official'])
    expect(messageInfo).toHaveBeenCalledWith('已還原成預設值，按「儲存假別規則」才會生效')
  })

  it('formats the per-event ceiling and the counted-against setting', async () => {
    installFetch()
    const wrapper = await mountSetting()
    expect(wrapper.vm.quotaDaysText({ quotaHours: 64, period: 'event' })).toBe('約 8 天（每次）')
    expect(wrapper.vm.quotaDaysText({ quotaHours: null })).toBe('不設上限')

    wrapper.vm.setCountsAgainst(wrapper.vm.policy.types[1], 'official')
    expect(wrapper.vm.policy.types[1].countsAgainst).toEqual({ key: 'official', exemptHours: 0 })
    wrapper.vm.setCountsAgainst(wrapper.vm.policy.types[1], '')
    expect(wrapper.vm.policy.types[1].countsAgainst).toBeNull()
  })
})
