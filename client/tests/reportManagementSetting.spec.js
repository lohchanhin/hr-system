import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ReportManagementSetting from '../src/components/backComponents/ReportManagementSetting.vue'

vi.mock('../src/api.js', () => ({
  apiFetch: vi.fn()
}))

vi.mock('element-plus', () => ({
  __esModule: true,
  ElMessage: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  },
  ElMessageBox: {
    confirm: vi.fn()
  }
}))

const { apiFetch } = await import('../src/api.js')
const { ElMessage, ElMessageBox } = await import('element-plus')

function createWrapper() {
  return mount(ReportManagementSetting, {
    global: {
      stubs: {
        'el-tabs': { template: '<div><slot /></div>' },
        'el-tab-pane': { template: '<div><slot /></div>' },
        'el-table': {
          props: ['data'],
          emits: ['current-change'],
          template:
            '<div><div v-for="(row, index) in data" :key="row?.id ?? index"><slot :row="row" :$index="index" /></div></div>'
        },
        'el-table-column': { template: '<div></div>' },
        'el-button': {
          emits: ['click'],
          template: '<button @click="$emit(\'click\')"><slot /></button>'
        },
        'el-dialog': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>'
        },
        'el-form': { template: '<form><slot /></form>' },
        'el-form-item': { template: '<div><slot /></div>' },
        'el-input': {
          props: ['modelValue'],
          emits: ['update:modelValue', 'keyup'],
          template:
            '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" @keyup="$emit(\'keyup\', $event)" />'
        },
        'el-select': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<select :value="modelValue" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>'
        },
        'el-option': {
          props: ['label', 'value'],
          template: '<option :value="value">{{ label }}</option>'
        },
        'el-tag': {
          emits: ['close'],
          template: '<span><slot /></span>'
        },
        'el-switch': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />'
        },
        'el-checkbox-group': { template: '<div><slot /></div>' },
        'el-checkbox': { template: '<label><slot /></label>' },
        'el-input-number': {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template:
            '<input type="number" :value="modelValue" @input="$emit(\'update:modelValue\', Number($event.target.value))" />'
        },
        'el-alert': { props: ['title'], template: '<div><slot />{{ title }}</div>' }
      }
    }
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  apiFetch.mockReset()
  ElMessage.success.mockReset()
  ElMessage.error.mockReset()
  ElMessage.warning.mockReset()
  ElMessageBox.confirm.mockReset()
  ElMessageBox.confirm.mockResolvedValue()
})

describe('ReportManagementSetting.vue', () => {
  it('載入報表模板並預設選擇第一筆', async () => {
    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        {
          id: 'r1',
          name: '出勤報表',
          type: 'custom',
          fields: ['員工'],
          exportSettings: { formats: ['PDF'], includeLogo: false, footerNote: '' },
          permissionSettings: {
            supervisorDept: false,
            hrAllDept: true,
            employeeDownload: false,
            historyMonths: 6
          },
          notificationSettings: { autoSend: false, sendFrequency: '', recipients: [] }
        }
      ]
    })

    const wrapper = createWrapper()
    await flushPromises()

    expect(apiFetch).toHaveBeenCalledWith('/api/reports')
    expect(wrapper.vm.reportTemplates).toHaveLength(1)
    expect(wrapper.vm.selectedTemplateId).toBe('r1')
    expect(wrapper.vm.exportForm.formats).toEqual(['PDF'])
  })

  it('新增報表模板後更新列表', async () => {
    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => [] })

    const wrapper = createWrapper()
    await flushPromises()

    const created = {
      id: 'r2',
      name: '請假報表',
      type: '請假',
      fields: ['姓名'],
      exportSettings: { formats: [], includeLogo: false, footerNote: '' },
      permissionSettings: {
        supervisorDept: false,
        hrAllDept: false,
        employeeDownload: false,
        historyMonths: 6
      },
      notificationSettings: { autoSend: false, sendFrequency: '', recipients: [] }
    }

    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => created })

    wrapper.vm.openTemplateDialog()
    wrapper.vm.templateForm.name = '請假報表'
    wrapper.vm.templateForm.type = '請假'
    wrapper.vm.templateForm.fields = ['姓名']

    await wrapper.vm.saveTemplate()
    await flushPromises()

    const lastCall = apiFetch.mock.calls.at(-1)
    expect(lastCall[0]).toBe('/api/reports')
    expect(lastCall[1]).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const payload = JSON.parse(lastCall[1].body)
    expect(payload).toMatchObject({
      name: '請假報表',
      type: '請假',
      fields: ['姓名']
    })
    expect(wrapper.vm.reportTemplates).toHaveLength(1)
    expect(wrapper.vm.reportTemplates[0].name).toBe('請假報表')
    expect(wrapper.vm.selectedTemplateId).toBe('r2')
  })

  it('儲存匯出設定會呼叫對應 API', async () => {
    const baseTemplate = {
      id: 'r3',
      name: '薪資報表',
      type: 'custom',
      fields: ['姓名'],
      exportSettings: { formats: ['PDF'], includeLogo: false, footerNote: '' },
      permissionSettings: {
        supervisorDept: false,
        hrAllDept: false,
        employeeDownload: false,
        historyMonths: 6
      },
      notificationSettings: { autoSend: false, sendFrequency: '', recipients: [] }
    }
    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => [baseTemplate] })

    const wrapper = createWrapper()
    await flushPromises()

    apiFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ...baseTemplate,
        exportSettings: { formats: ['CSV'], includeLogo: true, footerNote: '備註' }
      })
    })

    wrapper.vm.exportForm.formats = ['CSV']
    wrapper.vm.exportForm.includeLogo = true
    wrapper.vm.exportForm.footerNote = '備註'

    await wrapper.vm.saveExportSetting()
    await flushPromises()

    expect(apiFetch).toHaveBeenLastCalledWith(
      '/api/reports/r3',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          exportSettings: { formats: ['CSV'], includeLogo: true, footerNote: '備註' }
        })
      })
    )
    expect(wrapper.vm.reportTemplates[0].exportSettings.formats).toEqual(['CSV'])
    expect(ElMessage.success).toHaveBeenCalledWith('匯出設定已更新')
  })

  it('刪除報表模板後同步更新列表', async () => {
    const baseTemplate = {
      id: 'r4',
      name: '考勤報表',
      type: 'custom',
      fields: ['姓名'],
      exportSettings: { formats: ['PDF'], includeLogo: false, footerNote: '' },
      permissionSettings: {
        supervisorDept: false,
        hrAllDept: false,
        employeeDownload: false,
        historyMonths: 6
      },
      notificationSettings: { autoSend: false, sendFrequency: '', recipients: [] }
    }
    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => [baseTemplate] })

    const wrapper = createWrapper()
    await flushPromises()

    apiFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })

    await wrapper.vm.deleteTemplate(wrapper.vm.reportTemplates[0])
    await flushPromises()

    expect(ElMessageBox.confirm).toHaveBeenCalled()
    expect(apiFetch).toHaveBeenLastCalledWith(
      '/api/reports/r4',
      expect.objectContaining({ method: 'DELETE' })
    )
    expect(wrapper.vm.reportTemplates).toHaveLength(0)
    expect(wrapper.vm.selectedTemplateId).toBeNull()
    expect(ElMessage.success).toHaveBeenCalledWith('報表模板已刪除')
  })
})
