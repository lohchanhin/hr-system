import { describe, it, expect, beforeEach, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import { h, defineComponent, computed, provide, inject } from 'vue'
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

const ElTableStub = defineComponent({
  name: 'ElTableStub',
  props: {
    data: {
      type: Array,
      default: () => []
    }
  },
  setup(props, { slots }) {
    const tableData = computed(() => props.data ?? [])
    provide('tableData', tableData)
    return () => h('div', { class: 'el-table-stub' }, slots.default ? slots.default() : [])
  }
})

const ElTableColumnStub = defineComponent({
  name: 'ElTableColumnStub',
  setup(_, { slots }) {
    const tableData = inject('tableData', computed(() => []))
    return () =>
      h(
        'div',
        { class: 'el-table-column-stub' },
        tableData.value.flatMap((row, index) =>
          (slots.default ? slots.default({ row, $index: index }) : []) || []
        )
      )
  }
})

const ElTagStub = defineComponent({
  name: 'ElTagStub',
  setup(_, { slots }) {
    return () => h('span', { class: 'el-tag-stub' }, slots.default ? slots.default() : [])
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
  'el-table': ElTableStub,
  'el-table-column': ElTableColumnStub,
  'el-tag': ElTagStub,
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
    expect(JSON.parse(entries.mappings)).toMatchObject({ userId: '編號', timestamp: '日期時間', type: '簽到/退' })
    expect(ElMessage.success).toHaveBeenCalledWith('預覽完成，可直接匯入')
  })

  it('預覽表格顯示 clockIn 與 clockOut 對應中文標籤', async () => {
    importAttendanceMock.mockResolvedValueOnce(
      createApiResponse({
        summary: { totalRows: 2, readyCount: 2, missingCount: 0, ignoredCount: 0, errorCount: 0 },
        preview: [
          {
            rowNumber: 1,
            userId: 'emp1',
            action: 'clockIn',
            timestamp: '2024-01-05T08:00:00.000Z',
            status: 'ready'
          },
          {
            rowNumber: 2,
            userId: 'emp1',
            action: 'clockOut',
            timestamp: '2024-01-05T17:00:00.000Z',
            status: 'ready'
          }
        ],
        missingUsers: [],
        message: '預覽成功'
      })
    )

    const wrapper = mountComponent()
    wrapper.vm.selectedFile = new File(['content'], 'records.xlsx')

    await wrapper.vm.submitPreview()
    await wrapper.vm.$nextTick()

    const tags = wrapper.findAll('.el-tag-stub')
    const tagTexts = tags.map((tag) => tag.text())

    expect(tagTexts).toContain('I / 上班')
    expect(tagTexts).toContain('O / 下班')
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

  it('匯入 API 回傳失敗摘要時會顯示錯誤並保留對話框', async () => {
    importAttendanceMock
      .mockResolvedValueOnce(createApiResponse({
        summary: { totalRows: 1, readyCount: 0, missingCount: 1, ignoredCount: 0, errorCount: 0 },
        preview: [
          {
            rowNumber: 1,
            userId: 'unknown',
            action: 'clockIn',
            timestamp: '2024-01-05T00:00:00.000Z',
            status: 'missing',
            errors: []
          }
        ],
        missingUsers: [{ identifier: 'unknown', count: 1, rows: [1], samples: [] }],
        message: '預覽成功'
      }))
      .mockResolvedValueOnce(
        createApiResponse(
          {
            summary: {
              totalRows: 1,
              readyCount: 0,
              missingCount: 1,
              ignoredCount: 0,
              errorCount: 0,
              importedCount: 0
            },
            preview: [],
            missingUsers: [{ identifier: 'unknown', count: 1, rows: [1], samples: [] }],
            message: '所有資料均未匯入',
            failureReasons: ['1 筆資料缺少對應員工']
          },
          400
        )
      )

    const wrapper = mountComponent()
    wrapper.vm.selectedFile = new File(['content'], 'records.xlsx')

    await wrapper.vm.submitPreview()
    await wrapper.vm.$nextTick()
    wrapper.vm.missingResolutions.unknown.ignore = true
    await wrapper.vm.submitImport()
    await wrapper.vm.$nextTick()

    expect(ElMessage.error).toHaveBeenCalledWith('所有資料均未匯入：1 筆資料缺少對應員工')
    expect(ElMessage.success).not.toHaveBeenCalled()
    expect(wrapper.vm.visible).toBe(true)
    expect(wrapper.emitted()['import-complete']).toBeFalsy()
    expect(wrapper.vm.previewState.summary.importedCount).toBe(0)
  })
})
