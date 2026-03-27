import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, defineComponent, reactive } from 'vue'
import ScheduleGridVirtualBody from '../src/views/front/ScheduleGridVirtualBody.vue'

const shifts = [
  { _id: 's1', name: '早班' },
  { _id: 's2', name: '晚班' },
  { _id: 's3', name: '小夜' }
]

const formatShiftLabel = shift => shift?.name || ''

const ElSelectStub = defineComponent({
  name: 'ElSelect',
  props: {
    modelValue: { type: String, default: '' },
    disabled: { type: Boolean, default: false }
  },
  emits: ['update:modelValue', 'change', 'blur', 'visible-change'],
  template: `
    <select
      class="schedule-editor-select"
      :value="modelValue"
      :disabled="disabled"
      @change="onChange"
      @blur="$emit('blur')"
    >
      <slot />
    </select>
  `,
  methods: {
    onChange(event) {
      const value = event.target.value
      this.$emit('update:modelValue', value)
      this.$emit('change', value)
      this.$emit('visible-change', false)
    }
  }
})

const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: {
    label: { type: String, default: '' },
    value: { type: String, default: '' }
  },
  template: '<option :value="value">{{ label }}</option>'
})

const ElPopoverStub = defineComponent({
  name: 'ElPopover',
  template: '<span class="popover-stub"><slot name="reference" /><slot /></span>'
})

const ElCheckboxStub = defineComponent({
  name: 'ElCheckbox',
  inheritAttrs: false,
  props: {
    modelValue: { type: Boolean, default: false }
  },
  template: '<input class="checkbox-stub" type="checkbox" :checked="modelValue" />'
})

const mountCell = props =>
  mount(ScheduleGridVirtualBody, {
    props: {
      row: { _id: 'emp-1', name: '王小明' },
      day: { date: '2026-03-05', label: '3/5' },
      shifts,
      formatShiftLabel,
      ...props
    },
    global: {
      stubs: {
        'el-select': ElSelectStub,
        'el-option': ElOptionStub,
        'el-popover': ElPopoverStub,
        'el-checkbox': ElCheckboxStub
      }
    }
  })

const createCellView = ({ shiftId = 's1', isLeave = false } = {}) => {
  const shiftInfo = shifts.find(item => item._id === shiftId) || null
  return {
    scheduleCell: { shiftId },
    shiftInfo,
    cellMeta: {
      isLeave,
      missingShift: !shiftId,
      hasShift: Boolean(shiftId),
      style: { backgroundColor: '#fff' }
    },
    isSelected: false,
    isManualSelected: false,
    leaveTitle: isLeave ? '已核准請假，該日不列入工作時數' : ''
  }
}

describe('ScheduleGridVirtualBody 可編輯行為', () => {
  it('主管/管理者權限可進入編輯，並觸發 onSelect', async () => {
    const wrapper = mountCell({
      canEdit: true,
      cellView: createCellView({ shiftId: 's1' })
    })

    await wrapper.get('[data-schedule-cell="1"]').trigger('click')
    expect(wrapper.find('.schedule-editor-select').exists()).toBe(true)

    await wrapper.get('.schedule-editor-select').setValue('s2')
    const emitted = wrapper.emitted('select-shift')
    expect(emitted).toBeTruthy()
    expect(emitted[0]).toEqual(['emp-1', '2026-03-05', 's2'])
  })

  it('無排班權限僅顯示 ScheduleCellDisplay，不可觸發編輯', async () => {
    const wrapper = mountCell({
      canEdit: false,
      cellView: createCellView({ shiftId: 's1' })
    })

    await wrapper.get('[data-schedule-cell="1"]').trigger('click')
    expect(wrapper.find('.schedule-editor-select').exists()).toBe(false)
    expect(wrapper.find('.cell-view-content').exists()).toBe(true)
    expect(wrapper.emitted('select-shift')).toBeFalsy()
  })

  it('大量員工/日期的虛擬化可見區，點擊 cell 仍可編輯與換班', async () => {
    const VirtualizedHarness = defineComponent({
      components: { ScheduleGridVirtualBody },
      setup() {
        const state = reactive({
          scheduleMap: {
            'emp-125': {
              12: { shiftId: 's1' }
            }
          }
        })

        const allEmployees = Array.from({ length: 200 }, (_, index) => ({
          _id: `emp-${index + 1}`,
          name: `員工${index + 1}`
        }))
        const allDays = Array.from({ length: 31 }, (_, index) => ({
          date: index + 1,
          label: `3/${index + 1}`
        }))

        const virtualVisibleEmployees = computed(() => allEmployees.slice(120, 140))
        const virtualVisibleDays = computed(() => allDays.slice(10, 20))

        const getCellView = (empId, day) => {
          const shiftId = state.scheduleMap?.[empId]?.[day]?.shiftId || ''
          const shiftInfo = shifts.find(item => item._id === shiftId) || null
          return {
            scheduleCell: { shiftId },
            shiftInfo,
            cellMeta: {
              isLeave: false,
              missingShift: !shiftId,
              hasShift: Boolean(shiftId),
              style: { backgroundColor: '#fff' }
            },
            isSelected: false,
            isManualSelected: false,
            leaveTitle: ''
          }
        }

        const onSelect = (empId, day, value) => {
          if (!state.scheduleMap[empId]) state.scheduleMap[empId] = {}
          state.scheduleMap[empId][day] = { shiftId: value }
        }

        return {
          state,
          shifts,
          formatShiftLabel,
          virtualVisibleEmployees,
          virtualVisibleDays,
          getCellView,
          onSelect
        }
      },
      template: `
        <div class="virtual-grid">
          <div
            v-for="employee in virtualVisibleEmployees"
            :key="employee._id"
            class="virtual-row"
          >
            <ScheduleGridVirtualBody
              v-for="day in virtualVisibleDays"
              :key="employee._id + '-' + day.date"
              :row="employee"
              :day="day"
              :cell-view="getCellView(employee._id, day.date)"
              :can-edit="true"
              :shifts="shifts"
              :format-shift-label="formatShiftLabel"
              @select-shift="onSelect"
            />
          </div>
        </div>
      `
    })

    const wrapper = mount(VirtualizedHarness, {
      global: {
        stubs: {
          'el-select': ElSelectStub,
          'el-option': ElOptionStub,
          'el-popover': ElPopoverStub,
          'el-checkbox': ElCheckboxStub
        }
      }
    })

    const targetCell = wrapper.get('[data-emp-id="emp-125"][data-day="12"]')
    await targetCell.trigger('click')

    const editor = wrapper.get('[data-emp-id="emp-125"][data-day="12"] .schedule-editor-select')
    await editor.setValue('s3')

    expect(wrapper.vm.state.scheduleMap['emp-125'][12].shiftId).toBe('s3')
  })

  it('請假格不可編輯，維持保護', async () => {
    const wrapper = mountCell({
      canEdit: true,
      cellView: createCellView({ shiftId: '', isLeave: true })
    })

    await wrapper.get('[data-schedule-cell="1"]').trigger('click')
    expect(wrapper.find('.schedule-editor-select').exists()).toBe(false)
    expect(wrapper.find('[data-test="leave-indicator"]').exists()).toBe(true)
    expect(wrapper.emitted('select-shift')).toBeFalsy()
  })

  it('編輯後畫面與資料同步更新（含 scheduleMap 對應格）', async () => {
    const EditorSyncHarness = defineComponent({
      components: { ScheduleGridVirtualBody },
      setup() {
        const state = reactive({
          scheduleMap: {
            'emp-1': {
              5: { shiftId: 's1' }
            }
          }
        })

        const row = { _id: 'emp-1', name: '王小明' }
        const day = { date: 5, label: '3/5' }

        const getCellView = () => {
          const shiftId = state.scheduleMap[row._id][day.date].shiftId
          const shiftInfo = shifts.find(item => item._id === shiftId) || null
          return {
            scheduleCell: { shiftId },
            shiftInfo,
            cellMeta: {
              isLeave: false,
              missingShift: !shiftId,
              hasShift: Boolean(shiftId),
              style: { backgroundColor: '#fff' }
            },
            isSelected: false,
            isManualSelected: false,
            leaveTitle: ''
          }
        }

        const onSelect = (empId, targetDay, value) => {
          state.scheduleMap[empId][targetDay] = { shiftId: value }
        }

        return { state, row, day, shifts, formatShiftLabel, getCellView, onSelect }
      },
      template: `
        <ScheduleGridVirtualBody
          :row="row"
          :day="day"
          :cell-view="getCellView()"
          :can-edit="true"
          :shifts="shifts"
          :format-shift-label="formatShiftLabel"
          @select-shift="onSelect"
        />
      `
    })

    const wrapper = mount(EditorSyncHarness, {
      global: {
        stubs: {
          'el-select': ElSelectStub,
          'el-option': ElOptionStub,
          'el-popover': ElPopoverStub,
          'el-checkbox': ElCheckboxStub
        }
      }
    })

    expect(wrapper.text()).toContain('早班')

    await wrapper.get('[data-schedule-cell="1"]').trigger('click')
    await wrapper.get('.schedule-editor-select').setValue('s2')

    expect(wrapper.vm.state.scheduleMap['emp-1'][5].shiftId).toBe('s2')
    expect(wrapper.text()).toContain('晚班')
  })
})
