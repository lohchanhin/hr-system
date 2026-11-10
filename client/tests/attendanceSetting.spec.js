import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus, { ElMessage } from 'element-plus'
import AttendanceSetting from '../src/components/backComponents/AttendanceSetting.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn()
}))

const SERVER_SETTING = {
  abnormalRules: {
    lateGrace: 10,
    earlyLeaveGrace: 10,
    missingThreshold: 3,
    autoNotify: true,
    lateDeductionEnabled: true,
    lateDeductionAmount: 100,
    earlyLeaveDeductionEnabled: false,
    earlyLeaveDeductionAmount: 0
  },
  actionBuffers: { clockIn: { earlyMinutes: 60, lateMinutes: 240 }, clockOut: { earlyMinutes: 240, lateMinutes: 120 } },
  laborRules: {
    workTimeRegime: 'standard',
    workTimeRegimeApprovalReference: '',
    minShiftRestMinutes: 660,
    restIntervalExceptionEnabled: false,
    restIntervalExceptionMinutes: 480,
    restIntervalApprovalReference: '',
    extendedOvertimeEnabled: false,
    monthlyOvertimeHours: 46,
    threeMonthOvertimeHours: 138,
    overtimeApprovalReference: '',
    strictCompanyWeeklyRest: true
  },
  management: { allowMakeUpClock: true }
}

function respond(body, ok = true, status = 200) {
  return Promise.resolve({ ok, status, json: async () => body })
}

function putCalls() {
  return apiFetch.mock.calls.filter(([url, options]) => url === '/api/attendance-settings' && options?.method === 'PUT')
}

async function mountSetting() {
  const wrapper = mount(AttendanceSetting, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return wrapper
}

describe('AttendanceSetting.vue（出勤設定）', () => {
  beforeEach(() => {
    apiFetch.mockReset()
    apiFetch.mockImplementation((url, options = {}) => {
      if (options.method === 'PUT') return respond({ ...SERVER_SETTING, ...JSON.parse(options.body) })
      return respond(SERVER_SETTING)
    })
    vi.spyOn(ElMessage, 'success').mockImplementation(() => {})
    vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('三組設定在同一頁，只有一個「儲存」', async () => {
    const wrapper = await mountSetting()

    expect(wrapper.find('[data-test="page-header"]').text()).toContain('出勤設定')
    for (const title of ['遲到與早退', '打卡開放時段', '勞動規則（排班檢核）']) {
      expect(wrapper.text()).toContain(title)
    }
    expect(wrapper.findAll('.el-tabs')).toHaveLength(0)
    const saveButtons = wrapper.findAll('button').filter((button) => button.text() === '儲存')
    expect(saveButtons).toHaveLength(1)
    // 沒有改動時不顯示「有未儲存的變更」
    expect(wrapper.find('[data-test="attendance-setting-dirty"]').exists()).toBe(false)
  })

  // 以前「儲存勞動規則」按鈕綁定的函式被寫在另一個函式的 catch 區塊裡，樣板拿不到，按了沒有任何反應
  it('改了勞動規則按儲存會送出，並保留畫面上沒有的設定值', async () => {
    const wrapper = await mountSetting()

    wrapper.vm.laborRuleForm.workTimeRegime = 'four_week'
    wrapper.vm.laborRuleForm.workTimeRegimeApprovalReference = '勞資會議 115-2'
    wrapper.vm.abnormalForm.lateGrace = 3
    await flushPromises()
    expect(wrapper.find('[data-test="attendance-setting-dirty"]').exists()).toBe(true)

    await wrapper.find('[data-test="attendance-setting-save"]').trigger('click')
    await flushPromises()

    expect(putCalls()).toHaveLength(1)
    const body = JSON.parse(putCalls()[0][1].body)
    expect(body.laborRules).toMatchObject({
      workTimeRegime: 'four_week',
      workTimeRegimeApprovalReference: '勞資會議 115-2',
      threeMonthOvertimeHours: 138,
      restIntervalExceptionMinutes: 480,
      strictCompanyWeeklyRest: true
    })
    // 畫面上沒有的設定（missingThreshold、autoNotify）與沒改的遲到扣款照原值送回，不會被清掉
    expect(body.abnormalRules).toEqual({ ...SERVER_SETTING.abnormalRules, lateGrace: 3 })
    expect(body.actionBuffers).toEqual(SERVER_SETTING.actionBuffers)
    expect(body.management).toBeUndefined()
    expect(ElMessage.success).toHaveBeenCalledWith('出勤設定已儲存')
    expect(wrapper.find('[data-test="attendance-setting-dirty"]').exists()).toBe(false)
  })

  it('以 08:00–17:00 的班顯示打卡緩衝算出來的時段，改數字會跟著變', async () => {
    const wrapper = await mountSetting()

    expect(wrapper.find('[data-test="example-clock-in"]').text()).toBe('07:00–12:00')
    expect(wrapper.find('[data-test="example-clock-out"]').text()).toBe('13:00–19:00')

    wrapper.vm.actionBufferForm.clockIn.earlyMinutes = 90
    wrapper.vm.actionBufferForm.clockOut.lateMinutes = 480
    await flushPromises()
    expect(wrapper.find('[data-test="example-clock-in"]').text()).toBe('06:30–12:00')
    expect(wrapper.find('[data-test="example-clock-out"]').text()).toBe('13:00–翌日 01:00')

    // 簽到最晚到下班時間、簽退最早從上班時間算起（與打卡頁、伺服器相同）
    wrapper.vm.actionBufferForm.clockIn.lateMinutes = 720
    wrapper.vm.actionBufferForm.clockOut.earlyMinutes = 720
    await flushPromises()
    expect(wrapper.find('[data-test="example-clock-in"]').text()).toBe('06:30–17:00')
    expect(wrapper.find('[data-test="example-clock-out"]').text()).toBe('08:00–翌日 01:00')
  })

  it('啟用例外或延長工時卻沒填核准文件編號：顯示中文原因、不送出', async () => {
    const wrapper = await mountSetting()

    wrapper.vm.laborRuleForm.restIntervalExceptionEnabled = true
    wrapper.vm.laborRuleForm.extendedOvertimeEnabled = true
    await wrapper.vm.save()
    await flushPromises()

    expect(putCalls()).toHaveLength(0)
    expect(ElMessage.error).toHaveBeenCalledWith('啟用 11 小時間隔例外必須填寫例外核准文件編號')
    expect(wrapper.text()).toContain('延長每月加班上限必須填寫核准文件編號')
    expect(wrapper.findAll('.has-error').length).toBeGreaterThanOrEqual(2)
    // 啟用例外後才出現「例外時的班次間隔」，一般的班次間隔停用
    expect(wrapper.find('[data-test="rest-exception-minutes"]').exists()).toBe(true)
  })

  it('數字清空或超出範圍時不送出', async () => {
    const wrapper = await mountSetting()

    wrapper.vm.abnormalForm.lateGrace = null
    await wrapper.vm.save()
    expect(ElMessage.error).toHaveBeenCalledWith('請填寫遲到容許')

    wrapper.vm.abnormalForm.lateGrace = 5
    wrapper.vm.actionBufferForm.clockOut.lateMinutes = 9999
    await wrapper.vm.save()
    expect(ElMessage.error).toHaveBeenCalledWith('下班簽退：最晚可延後需介於 0 到 720 分鐘')
    expect(putCalls()).toHaveLength(0)
  })

  it('伺服器的英文檢查訊息換成中文顯示', async () => {
    apiFetch.mockImplementation((url, options = {}) => {
      if (options.method === 'PUT') return respond({ error: 'extended overtime requires an approval reference' }, false, 400)
      return respond(SERVER_SETTING)
    })
    const wrapper = await mountSetting()
    wrapper.vm.abnormalForm.lateGrace = 6

    await wrapper.vm.save()
    await flushPromises()

    expect(ElMessage.error).toHaveBeenCalledWith('延長每月加班上限必須填寫核准文件編號')
    expect(ElMessage.success).not.toHaveBeenCalled()
    // 存失敗：變更還在、仍標示未儲存
    expect(wrapper.vm.abnormalForm.lateGrace).toBe(6)
    expect(wrapper.vm.dirty).toBe(true)
  })

  // 伺服器擋下的欄位（code／field）標在畫面上對應的欄位旁，不只跳一則訊息
  it('伺服器回 INVALID_DEDUCTION_SETTING 或核准文件的 code 時，錯誤標在那個欄位旁', async () => {
    let putBody = { error: '遲到每次扣款金額需介於 0 到 100000 元的整數', code: 'INVALID_DEDUCTION_SETTING', field: 'abnormalRules.lateDeductionAmount' }
    apiFetch.mockImplementation((url, options = {}) => {
      if (options.method === 'PUT') return respond(putBody, false, 400)
      return respond(SERVER_SETTING)
    })
    const wrapper = await mountSetting()
    wrapper.vm.abnormalForm.lateGrace = 6

    await wrapper.vm.save()
    await flushPromises()
    expect(ElMessage.error).toHaveBeenCalledWith('儲存失敗：遲到每次扣款金額需介於 0 到 100000 元的整數')
    expect(wrapper.vm.errors.lateDeductionAmount).toBe('遲到每次扣款金額需介於 0 到 100000 元的整數')

    putBody = { error: '採用變形工時必須填寫核准文件編號', code: 'WORK_TIME_REGIME_APPROVAL_REQUIRED' }
    await wrapper.vm.save()
    await flushPromises()
    expect(wrapper.vm.errors.workTimeRegimeApprovalReference).toBe('採用變形工時必須填寫核准文件編號')
  })

  it('關掉延長加班上限時把超過 46 的上限拉回 46', async () => {
    apiFetch.mockImplementation(() => respond({
      ...SERVER_SETTING,
      laborRules: { ...SERVER_SETTING.laborRules, extendedOvertimeEnabled: true, monthlyOvertimeHours: 54, overtimeApprovalReference: 'A-1' }
    }))
    const wrapper = await mountSetting()
    expect(wrapper.vm.laborRuleForm.monthlyOvertimeHours).toBe(54)

    wrapper.findComponent('[data-test="extended-overtime-switch"]').vm.$emit('update:modelValue', false)
    wrapper.findComponent('[data-test="extended-overtime-switch"]').vm.$emit('change', false)
    await flushPromises()

    expect(wrapper.vm.laborRuleForm.monthlyOvertimeHours).toBe(46)
  })

  // 以前讀取失敗只寫在 console，畫面顯示預設值，按儲存就把伺服器上的設定蓋成預設值
  it('讀取失敗時顯示錯誤、不能儲存，重新載入成功後恢復', async () => {
    let fail = true
    apiFetch.mockImplementation((url, options = {}) => {
      if (options.method === 'PUT') return respond(SERVER_SETTING)
      return fail ? respond({ error: '資料庫連線失敗' }, false, 500) : respond(SERVER_SETTING)
    })
    const wrapper = await mountSetting()

    expect(wrapper.find('[data-test="attendance-setting-load-error"]').text()).toContain('讀取出勤設定失敗：資料庫連線失敗')
    expect(wrapper.find('[data-test="attendance-setting-save"]').attributes('disabled')).toBeDefined()
    await wrapper.vm.save()
    expect(putCalls()).toHaveLength(0)

    fail = false
    await wrapper.vm.loadSettings()
    await flushPromises()
    expect(wrapper.find('[data-test="attendance-setting-load-error"]').exists()).toBe(false)
    expect(wrapper.vm.abnormalForm.lateGrace).toBe(10)
    expect(wrapper.find('[data-test="attendance-setting-save"]').attributes('disabled')).toBeUndefined()
  })

  // 薪資計算會讀遲到／早退扣款（abnormalRules.*Deduction*），以前畫面上沒有地方設定
  it('遲到／早退扣款：顯示伺服器的值，開關關著時金額不能改，說明寫出會扣多少', async () => {
    const wrapper = await mountSetting()

    expect(wrapper.find('[data-test="deduction-section"]').text()).toContain('遲到／早退扣款')
    expect(wrapper.vm.abnormalForm.lateDeductionEnabled).toBe(true)
    expect(wrapper.vm.abnormalForm.lateDeductionAmount).toBe(100)
    expect(wrapper.find('[data-test="late-deduction-hint"]').text()).toBe('每遲到一次，從當月薪資扣 100 元')
    expect(wrapper.findComponent('[data-test="late-deduction-amount"]').props('disabled')).toBe(false)

    expect(wrapper.find('[data-test="early-leave-deduction-hint"]').text()).toBe('未啟用，早退不扣薪資')
    expect(wrapper.findComponent('[data-test="early-leave-deduction-amount"]').props('disabled')).toBe(true)

    wrapper.findComponent('[data-test="early-leave-deduction-switch"]').vm.$emit('update:modelValue', true)
    wrapper.vm.abnormalForm.earlyLeaveDeductionAmount = 50
    await flushPromises()
    expect(wrapper.findComponent('[data-test="early-leave-deduction-amount"]').props('disabled')).toBe(false)
    expect(wrapper.find('[data-test="early-leave-deduction-hint"]').text()).toBe('每早退一次，從當月薪資扣 50 元')
    expect(wrapper.vm.dirty).toBe(true)

    await wrapper.vm.save()
    await flushPromises()
    const body = JSON.parse(putCalls()[0][1].body)
    expect(body.abnormalRules).toMatchObject({
      lateDeductionEnabled: true,
      lateDeductionAmount: 100,
      earlyLeaveDeductionEnabled: true,
      earlyLeaveDeductionAmount: 50
    })
    expect(wrapper.vm.dirty).toBe(false)
  })

  it('扣款金額要是 0 以上的整數；沒啟用的那一項不檢查，清空時送 0', async () => {
    const wrapper = await mountSetting()

    wrapper.vm.abnormalForm.lateDeductionAmount = 50.5
    await wrapper.vm.save()
    expect(ElMessage.error).toHaveBeenCalledWith('遲到每次扣款金額必須是整數')
    wrapper.vm.abnormalForm.lateDeductionAmount = -1
    await wrapper.vm.save()
    expect(ElMessage.error).toHaveBeenCalledWith('遲到每次扣款金額需介於 0 到 100000 元')
    wrapper.vm.abnormalForm.lateDeductionAmount = null
    await wrapper.vm.save()
    expect(ElMessage.error).toHaveBeenCalledWith('請填寫遲到每次扣款金額')
    expect(putCalls()).toHaveLength(0)

    wrapper.vm.abnormalForm.lateDeductionAmount = 200
    wrapper.vm.abnormalForm.earlyLeaveDeductionAmount = null
    await wrapper.vm.save()
    await flushPromises()
    expect(putCalls()).toHaveLength(1)
    const body = JSON.parse(putCalls()[0][1].body)
    expect(body.abnormalRules.lateDeductionAmount).toBe(200)
    expect(body.abnormalRules.earlyLeaveDeductionEnabled).toBe(false)
    expect(body.abnormalRules.earlyLeaveDeductionAmount).toBe(0)
  })

  it('舊資料沒有扣款設定時：預設不啟用、金額 0', async () => {
    apiFetch.mockImplementation(() => respond({
      ...SERVER_SETTING,
      abnormalRules: { lateGrace: 5, earlyLeaveGrace: 5 }
    }))
    const wrapper = await mountSetting()

    expect(wrapper.vm.abnormalForm).toMatchObject({
      lateDeductionEnabled: false,
      lateDeductionAmount: 0,
      earlyLeaveDeductionEnabled: false,
      earlyLeaveDeductionAmount: 0
    })
    expect(wrapper.vm.dirty).toBe(false)
    expect(wrapper.find('[data-test="late-deduction-hint"]').text()).toBe('未啟用，遲到不扣薪資')
  })

  it('儲存中再按一次不會送第二次；「還原」回到上次儲存的內容', async () => {
    let resolvePut
    apiFetch.mockImplementation((url, options = {}) => {
      if (options.method === 'PUT') return new Promise((resolve) => { resolvePut = () => resolve({ ok: true, status: 200, json: async () => SERVER_SETTING }) })
      return respond(SERVER_SETTING)
    })
    const wrapper = await mountSetting()

    wrapper.vm.abnormalForm.earlyLeaveGrace = 20
    await flushPromises()
    await wrapper.find('[data-test="attendance-setting-reset"]').trigger('click')
    expect(wrapper.vm.abnormalForm.earlyLeaveGrace).toBe(10)
    expect(wrapper.vm.dirty).toBe(false)

    wrapper.vm.abnormalForm.earlyLeaveGrace = 15
    const first = wrapper.vm.save()
    const second = wrapper.vm.save()
    await flushPromises()
    expect(putCalls()).toHaveLength(1)
    resolvePut()
    await Promise.all([first, second])
  })
})
