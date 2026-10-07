import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ElementPlus, { ElMessage } from 'element-plus'
import ShiftScheduleSetting from '../src/components/backComponents/ShiftScheduleSetting.vue'
import { apiFetch } from '../src/api'

vi.mock('../src/api', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: async () => [] }))
}))

describe('ShiftScheduleSetting.vue 班別性質', () => {
  let wrapper

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    apiFetch.mockReset()
    apiFetch.mockImplementation(() => Promise.resolve({ ok: true, json: async () => [] }))
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  async function mountSetting(shifts = []) {
    apiFetch.mockImplementation((url) => {
      if (url === '/api/shifts') return Promise.resolve({ ok: true, json: async () => ({ shifts }) })
      return Promise.resolve({ ok: true, json: async () => [] })
    })
    wrapper = mount(ShiftScheduleSetting, {
      attachTo: document.body,
      global: { plugins: [ElementPlus] }
    })
    await flushPromises()
    return wrapper
  }

  function postedShift() {
    const call = apiFetch.mock.calls.find(([url, options]) => url === '/api/shifts' && options?.method === 'POST')
    return call ? JSON.parse(call[1].body) : null
  }

  it('新增班別時依輸入的代碼自動帶入班別性質，並套用 00:00-00:00、休息 0 分鐘', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()

    wrapper.vm.shiftForm.code = '休'
    await nextTick()
    expect(wrapper.vm.shiftForm).toMatchObject({
      semanticType: 'rest_day', startTime: '00:00', endTime: '00:00', breakDuration: 0, crossDay: false
    })

    wrapper.vm.shiftForm.code = '公傷'
    await nextTick()
    expect(wrapper.vm.shiftForm.semanticType).toBe('leave')

    wrapper.vm.shiftForm.code = '國'
    await nextTick()
    expect(wrapper.vm.shiftForm.semanticType).toBe('holiday')

    wrapper.vm.shiftForm.code = '例'
    await nextTick()
    expect(wrapper.vm.shiftForm.semanticType).toBe('regular_rest')
  })

  it('名稱也會參與判斷（自訂代碼 + 標準假別名稱）', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()

    wrapper.vm.shiftForm.code = 'V1'
    wrapper.vm.shiftForm.name = '家庭照顧假'
    await nextTick()

    expect(wrapper.vm.shiftForm.semanticType).toBe('leave')
    expect(wrapper.vm.shiftForm.startTime).toBe('00:00')
  })

  it('從非工作班別改成一般上班代碼時，清掉自動帶入的時間並還原預設休息時長', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()

    wrapper.vm.shiftForm.code = '休'
    await nextTick()
    wrapper.vm.shiftForm.code = '休D'
    await nextTick()

    expect(wrapper.vm.shiftForm).toMatchObject({
      semanticType: 'work', startTime: '', endTime: '', breakDuration: 60
    })
  })

  it('一般上班代碼維持工作班，不動管理者已填的時間', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()
    wrapper.vm.shiftForm.startTime = '08:00'
    wrapper.vm.shiftForm.endTime = '17:00'

    wrapper.vm.shiftForm.code = '日'
    wrapper.vm.shiftForm.name = '日班'
    await nextTick()

    expect(wrapper.vm.shiftForm).toMatchObject({
      semanticType: 'work', startTime: '08:00', endTime: '17:00', breakDuration: 60
    })
  })

  it('管理者手動選過班別性質後，不再被代碼自動覆蓋', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()
    wrapper.vm.shiftForm.code = 'X1'
    await nextTick()

    wrapper.vm.onSemanticTypeChange('holiday')
    expect(wrapper.vm.shiftForm).toMatchObject({
      semanticType: 'holiday', startTime: '00:00', endTime: '00:00', breakDuration: 0
    })

    wrapper.vm.shiftForm.code = '休'
    await nextTick()
    expect(wrapper.vm.shiftForm.semanticType).toBe('holiday')
  })

  it('選擇非工作類型會重設夜班與休息時段；改回工作班後可重新填寫', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()
    wrapper.vm.shiftForm.startTime = '22:00'
    wrapper.vm.shiftForm.endTime = '06:00'
    wrapper.vm.shiftForm.crossDay = true
    wrapper.vm.shiftForm.isNightShift = true
    wrapper.vm.shiftForm.breakWindows = [{ start: '01:00', end: '02:00', label: '夜間' }]

    wrapper.vm.onSemanticTypeChange('leave')
    await nextTick()
    expect(wrapper.vm.shiftForm).toMatchObject({
      semanticType: 'leave', startTime: '00:00', endTime: '00:00',
      breakDuration: 0, crossDay: false, isNightShift: false, breakWindows: []
    })

    wrapper.vm.onSemanticTypeChange('work')
    expect(wrapper.vm.shiftForm).toMatchObject({ semanticType: 'work', startTime: '', endTime: '', breakDuration: 60 })
  })

  it('在班別性質下拉選單選擇後，套用非工作班別的固定設定', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()
    await flushPromises()
    wrapper.vm.shiftForm.startTime = '09:00'
    wrapper.vm.shiftForm.endTime = '18:00'

    const select = wrapper.findComponent('[data-test="shift-semantic-select"]')
    expect(select.exists()).toBe(true)
    select.vm.$emit('update:modelValue', 'regular_rest')
    await flushPromises()

    expect(wrapper.vm.shiftForm).toMatchObject({
      semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00', breakDuration: 0
    })
    expect(wrapper.vm.semanticTouched).toBe(true)
  })

  it('非工作類型時上下班時間與休息欄位停用，改回工作班後恢復', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()
    await flushPromises()
    const disabledEditors = () => document.body.querySelectorAll('.el-date-editor.is-disabled').length
    expect(disabledEditors()).toBe(0)

    wrapper.vm.onSemanticTypeChange('rest_day')
    await flushPromises()
    expect(wrapper.vm.isNonWorkForm).toBe(true)
    expect(disabledEditors()).toBe(2)
    expect(document.body.querySelectorAll('.el-input-number.is-disabled').length).toBeGreaterThan(0)

    wrapper.vm.onSemanticTypeChange('work')
    await flushPromises()
    expect(disabledEditors()).toBe(0)
  })

  it('表單顯示班別性質說明，工作班沒有工作時間時顯示警示並阻擋儲存', async () => {
    const errorSpy = vi.spyOn(ElMessage, 'error').mockImplementation(() => {})
    await mountSetting()
    wrapper.vm.openShiftDialog()
    await flushPromises()
    expect(document.body.textContent).toContain('系統會依班別代碼／名稱自動判斷')
    expect(document.body.textContent).toContain('不需上班')
    expect(document.body.querySelector('[data-test="shift-work-time-warning"]')).toBeNull()

    wrapper.vm.shiftForm.code = 'ZZ'
    wrapper.vm.shiftForm.name = '測試班'
    wrapper.vm.shiftForm.startTime = '09:00'
    wrapper.vm.shiftForm.endTime = '09:00'
    await flushPromises()
    expect(document.body.querySelector('[data-test="shift-work-time-warning"]')?.textContent).toContain('等於沒有工作時間')

    apiFetch.mockClear()
    await wrapper.vm.saveShift()
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('上班與下班時間不可相同'))
    expect(postedShift()).toBeNull()
    expect(wrapper.vm.shiftDialogVisible).toBe(true)
  })

  it('儲存非工作班別時送出 semanticType 與固定的 00:00-00:00、休息 0 分鐘', async () => {
    await mountSetting()
    wrapper.vm.openShiftDialog()
    wrapper.vm.shiftForm.code = '病'
    wrapper.vm.shiftForm.name = '病假'
    await nextTick()
    apiFetch.mockClear()

    await wrapper.vm.saveShift()

    expect(postedShift()).toMatchObject({
      code: '病', name: '病假', semanticType: 'leave', startTime: '00:00', endTime: '00:00', breakDuration: 0, crossDay: false
    })
  })

  it('編輯舊班別（沒有班別性質）時依代碼推斷，且改代碼不再自動變動', async () => {
    await mountSetting([
      { _id: 's1', code: '公傷', name: '公傷假', startTime: '00:00', endTime: '00:00' },
      { _id: 's2', code: '日', name: '日班', startTime: '08:00', endTime: '17:00', semanticType: 'work' }
    ])

    wrapper.vm.openShiftDialog(0)
    expect(wrapper.vm.shiftForm.semanticType).toBe('leave')
    wrapper.vm.shiftForm.code = '日'
    await nextTick()
    expect(wrapper.vm.shiftForm.semanticType).toBe('leave')

    wrapper.vm.openShiftDialog(1)
    expect(wrapper.vm.shiftForm.semanticType).toBe('work')
    expect(wrapper.vm.shiftForm.startTime).toBe('08:00')
  })

  it('列表新增班別性質欄，顯示中文名稱並標出沒有工作時間的工作班', async () => {
    await mountSetting([
      { _id: 's1', code: '休', name: '休假', semanticType: 'rest_day', startTime: '00:00', endTime: '00:00' },
      { _id: 's2', code: '例', name: '例假', semanticType: 'regular_rest', startTime: '00:00', endTime: '00:00' },
      { _id: 's3', code: '國', name: '國定假日', semanticType: 'holiday', startTime: '00:00', endTime: '00:00' },
      { _id: 's4', code: '事', name: '事假', semanticType: 'leave', startTime: '00:00', endTime: '00:00' },
      { _id: 's5', code: '日', name: '日班', semanticType: 'work', startTime: '08:00', endTime: '17:00' },
      { _id: 's6', code: 'BAD', name: '壞資料', semanticType: 'work', startTime: '00:00', endTime: '00:00' },
      { _id: 's7', code: '病', name: '病假', startTime: '00:00', endTime: '00:00' }
    ])

    expect(wrapper.text()).toContain('班別性質')
    const tags = wrapper.findAll('.semantic-tag').map(tag => tag.text())
    expect(tags).toEqual(['休息日', '例假', '國定假日', '請假', '工作班', '工作班', '請假'])
    // 不需上班的班別不再顯示「日班」標籤
    expect(wrapper.findAll('.shift-not-applicable')).toHaveLength(5)
    const warnings = wrapper.findAll('.shift-type-warning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].text()).toContain('工作班沒有工作時間')
  })
})
