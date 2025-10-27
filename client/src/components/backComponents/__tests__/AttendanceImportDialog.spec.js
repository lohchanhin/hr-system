import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import AttendanceImportDialog from '../AttendanceImportDialog.vue'
import * as apiModule from '../../../api'
import { ElMessage } from 'element-plus'

vi.mock('element-plus', () => {
  const success = vi.fn()
  const error = vi.fn()
  const warning = vi.fn()
  return {
    ElMessage: { success, error, warning }
  }
})

const elementStubs = {
  'el-dialog': {
    template: '<div class="el-dialog-stub"><slot /><slot name="footer" /></div>',
    props: ['modelValue']
  },
  'el-form': { template: '<form><slot /></form>' },
  'el-form-item': { template: '<div class="el-form-item-stub"><slot /><slot name="label" /></div>' },
  'el-upload': {
    template: '<div class="el-upload-stub"><slot /><slot name="tip" /></div>',
    emits: ['change']
  },
  'el-button': { template: '<button type="button" @click="$emit(\'click\')"><slot /></button>' },
  'el-select': {
    props: ['modelValue', 'disabled'],
    template: '<select :disabled="disabled" @change="$emit(\'update:modelValue\', $event.target.value)"><slot /></select>'
  },
  'el-option': {
    props: ['label', 'value'],
    template: '<option :value="value">{{ label }}</option>'
  },
  'el-table': { template: '<div class="el-table-stub"><slot /></div>', props: ['data'] },
  'el-table-column': { template: '<div class="el-table-column-stub"><slot :row="{}" /></div>' },
  'el-input': {
    props: ['modelValue'],
    template: '<input :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" />'
  },
  'el-alert': { template: '<div class="el-alert-stub"><slot name="title" /><slot /></div>' },
  'el-divider': { template: '<hr />' },
  'el-checkbox': {
    props: ['modelValue'],
    template: '<label><input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" /><slot /></label>'
  }
}

function createApiResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

describe('AttendanceImportDialog', () => {
  let apiFetchMock
  let importAttendanceMock

  const mountComponent = () =>
    shallowMount(AttendanceImportDialog, {
      props: { modelValue: true },
      global: {
        stubs: {
          transition: false,
          teleport: false,
          ...elementStubs
        }
      }
    })

  beforeEach(() => {
    apiFetchMock = vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
      createApiResponse([
        { _id: 'emp1', name: 'Alice', email: 'alice@example.com', employeeId: 'A001' }
      ])
    )
    importAttendanceMock = vi
      .spyOn(apiModule, 'importAttendanceRecords')
      .mockResolvedValue(createApiResponse({
        summary: { totalRows: 1, readyCount: 1, missingCount: 0, ignoredCount: 0, errorCount: 0 },
        preview: [],
        missingUsers: [],
        message: '考勤資料匯入完成'
      }))
    ElMessage.success.mockClear()
    ElMessage.error.mockClear()
    ElMessage.warning.mockClear()
  })

  it('預覽時會攜帶欄位設定與時區資訊', async () => {
    const wrapper = mountComponent()
    wrapper.vm.selectedFile = new File(['content'], 'records.xlsx')

    await wrapper.vm.submitPreview()

    expect(importAttendanceMock).toHaveBeenCalledTimes(1)
    const formData = importAttendanceMock.mock.calls[0][0]
    const entries = Object.fromEntries(formData.entries())
    const parsedOptions = JSON.parse(entries.options)
    expect(parsedOptions).toMatchObject({ dryRun: true })
    expect(parsedOptions.timezone).toBe(wrapper.vm.form.timezone)
    expect(JSON.parse(entries.mappings)).toMatchObject({ userId: 'USERID', timestamp: 'CHECKTIME', type: 'CHECKTYPE' })
    expect(ElMessage.success).toHaveBeenCalledWith('預覽完成，可直接匯入')
  })

  it('當存在缺少的使用者時可設定對應並進行匯入', async () => {
    importAttendanceMock
      .mockResolvedValueOnce(createApiResponse({
        summary: { totalRows: 1, readyCount: 0, missingCount: 1, ignoredCount: 0, errorCount: 0 },
        preview: [
          {
            rowNumber: 2,
            userId: 'external',
            action: 'clockIn',
            timestamp: '2024-01-05T00:00:00.000Z',
            errors: [],
            status: 'missing'
          }
        ],
        missingUsers: [{ identifier: 'external', count: 1, rows: [2], samples: [] }],
        message: '預覽成功'
      }))
      .mockResolvedValueOnce(
        createApiResponse({
          summary: { totalRows: 1, readyCount: 1, missingCount: 0, ignoredCount: 0, errorCount: 0, importedCount: 1 },
          preview: [],
          missingUsers: [],
          message: '考勤資料匯入完成'
        })
      )

    const wrapper = mountComponent()
    wrapper.vm.selectedFile = new File(['content'], 'records.xlsx')

    await wrapper.vm.submitPreview()
    await wrapper.vm.$nextTick()

    wrapper.vm.missingResolutions.external.employeeId = 'emp1'

    await wrapper.vm.submitImport()

    expect(importAttendanceMock).toHaveBeenCalledTimes(2)
    const formData = importAttendanceMock.mock.calls[1][0]
    const entries = Object.fromEntries(formData.entries())
    expect(JSON.parse(entries.options)).toMatchObject({ dryRun: false })
    expect(JSON.parse(entries.userMappings)).toMatchObject({ external: { _id: 'emp1' } })
    expect(ElMessage.success).toHaveBeenCalledWith('考勤資料匯入完成')
    expect(wrapper.emitted()['import-complete']).toBeTruthy()
  })
})
