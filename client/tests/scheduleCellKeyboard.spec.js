import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import ScheduleGridVirtualBody from '../src/views/front/ScheduleGridVirtualBody.vue'
import ScheduleCellDisplay from '../src/views/front/ScheduleCellDisplay.vue'

// 排班表格子的鍵盤操作與儲存狀態：Enter／F2 開班別選單、Esc 取消、方向鍵移到相鄰的格子、
// 空白鍵選取、Delete 清空；儲存中不能再開選單，伺服器拒絕時在格子上顯示原因。

const shifts = [
  { _id: 's1', code: 'D', name: '白班', startTime: '08:00', endTime: '16:00' },
  { _id: 's2', code: 'N', name: '大夜', startTime: '22:00', endTime: '06:00', crossDay: true, remark: '含夜班津貼' }
]
const formatShiftLabel = shift => (shift ? `${shift.code}(${shift.name})` : '')

const ElSelectStub = defineComponent({
  name: 'ElSelect',
  props: ['modelValue', 'filterable', 'defaultFirstOption'],
  emits: ['update:modelValue', 'change', 'blur', 'visible-change'],
  methods: { focus() { this.$el.focus() } },
  template: `
    <select
      class="schedule-editor-select"
      :value="modelValue"
      :data-filterable="String(filterable !== undefined && filterable !== false)"
      :data-default-first="String(defaultFirstOption !== undefined && defaultFirstOption !== false)"
      @change="$emit('update:modelValue', $event.target.value); $emit('change', $event.target.value)"
    ><slot /></select>
  `
})
const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: ['label', 'value'],
  template: '<option :value="value">{{ label }}</option>'
})
const stubs = { 'el-select': ElSelectStub, 'el-option': ElOptionStub }

const view = ({ shiftId = 's1', isLeave = false, ...extra } = {}) => ({
  scheduleCell: { id: shiftId ? 'row-1' : '', shiftId },
  shiftInfo: shifts.find(shift => shift._id === shiftId) || null,
  cellMeta: { isLeave, missingShift: !isLeave && !shiftId, hasShift: !isLeave && Boolean(shiftId), partialLeaveHours: 0, style: {} },
  isSelected: false,
  isManualSelected: false,
  leaveTitle: '',
  saveState: '',
  saveMessage: '',
  ...extra
})

const mounted = []
const mountCell = (props = {}) => {
  const wrapper = mount(ScheduleGridVirtualBody, {
    attachTo: document.body,
    props: {
      row: { _id: 'emp-1', name: '王小明' },
      day: { date: 5, label: '5(三)' },
      shifts,
      formatShiftLabel,
      canEdit: true,
      cellView: view(),
      ...props
    },
    global: { stubs }
  })
  mounted.push(wrapper)
  return wrapper
}

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
})

describe('排班表格子：鍵盤操作', () => {
  it('Enter 或 F2 開班別選單（可以直接打字篩選），Esc 取消並把焦點放回格子', async () => {
    const wrapper = mountCell()
    const cell = wrapper.get('[data-schedule-cell="1"]')
    cell.element.focus()

    await cell.trigger('keydown', { key: 'Enter' })
    const editor = wrapper.get('.schedule-editor-select')
    expect(editor.attributes('data-filterable')).toBe('true')
    expect(editor.attributes('data-default-first')).toBe('true')
    await nextTick()

    await editor.trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(wrapper.find('.schedule-editor-select').exists()).toBe(false)
    expect(wrapper.emitted('select-shift')).toBeFalsy()
    expect(document.activeElement).toBe(cell.element)

    await cell.trigger('keydown', { key: 'F2' })
    expect(wrapper.find('.schedule-editor-select').exists()).toBe(true)
  })

  it('選完班別後焦點回到格子，可以繼續用鍵盤操作', async () => {
    const wrapper = mountCell()
    const cell = wrapper.get('[data-schedule-cell="1"]')
    await cell.trigger('click')
    await nextTick()
    await wrapper.get('.schedule-editor-select').setValue('s2')
    await nextTick()

    expect(wrapper.emitted('select-shift')[0]).toEqual(['emp-1', 5, 's2'])
    expect(wrapper.find('.schedule-editor-select').exists()).toBe(false)
    expect(document.activeElement).toBe(cell.element)
  })

  it('空白鍵切換選取，Delete 清空這一格的班別；空格子按 Delete 不送出', async () => {
    const wrapper = mountCell()
    const cell = wrapper.get('[data-schedule-cell="1"]')

    await cell.trigger('keydown', { key: ' ' })
    expect(wrapper.emitted('toggle-select')[0]).toEqual(['emp-1', 5])

    await cell.trigger('keydown', { key: 'Delete' })
    expect(wrapper.emitted('select-shift')[0]).toEqual(['emp-1', 5, ''])

    const empty = mountCell({ cellView: view({ shiftId: '' }) })
    await empty.get('[data-schedule-cell="1"]').trigger('keydown', { key: 'Delete' })
    expect(empty.emitted('select-shift')).toBeFalsy()
  })

  it('請假的格子與沒有排班權限時，鍵盤不能編輯、選取或清空', async () => {
    const leave = mountCell({ cellView: view({ shiftId: '', isLeave: true }) })
    const leaveCell = leave.get('[data-schedule-cell="1"]')
    expect(leaveCell.attributes('tabindex')).toBe('-1')
    await leaveCell.trigger('keydown', { key: 'Enter' })
    await leaveCell.trigger('keydown', { key: ' ' })
    await leaveCell.trigger('keydown', { key: 'Delete' })
    expect(leave.find('.schedule-editor-select').exists()).toBe(false)
    expect(leave.emitted()).not.toHaveProperty('toggle-select')
    expect(leave.emitted()).not.toHaveProperty('select-shift')

    const readonly = mountCell({ canEdit: false })
    await readonly.get('[data-schedule-cell="1"]').trigger('keydown', { key: 'Delete' })
    expect(readonly.emitted()).not.toHaveProperty('select-shift')
    expect(readonly.find('.cell-manual-checkbox').exists()).toBe(false)
  })

  it('方向鍵移到相鄰的格子（左右：前後一天；上下：上下一位員工）', async () => {
    const Grid = defineComponent({
      setup() {
        const rows = [{ _id: 'emp-1', name: '甲' }, { _id: 'emp-2', name: '乙' }]
        const days = [{ date: 4, label: '4' }, { date: 5, label: '5' }]
        return () => h('table', [h('tbody', rows.map(row => h('tr', { key: row._id }, days.map(day => h('td', { key: day.date }, [
          h(ScheduleGridVirtualBody, { row, day, shifts, formatShiftLabel, canEdit: true, cellView: view() })
        ])))))])
      }
    })
    const wrapper = mount(Grid, { attachTo: document.body, global: { stubs } })
    mounted.push(wrapper)
    const cellOf = (emp, day) => wrapper.get(`[data-emp-id="${emp}"][data-day="${day}"]`)

    cellOf('emp-1', 4).element.focus()
    await cellOf('emp-1', 4).trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(cellOf('emp-1', 5).element)
    await cellOf('emp-1', 5).trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(cellOf('emp-2', 5).element)
    await cellOf('emp-2', 5).trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cellOf('emp-2', 4).element)
    await cellOf('emp-2', 4).trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(cellOf('emp-1', 4).element)
    // 已經在邊緣：焦點留在原地
    await cellOf('emp-1', 4).trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(cellOf('emp-1', 4).element)
  })
})

describe('排班表格子：儲存狀態', () => {
  it('儲存中顯示「儲存中…」，這時不能再開班別選單（避免同一格連續送出兩筆請求）', async () => {
    const wrapper = mountCell({ cellView: view({ saveState: 'saving' }) })
    const cell = wrapper.get('[data-schedule-cell="1"]')
    expect(cell.classes()).toContain('is-saving')
    expect(wrapper.get('[data-test="cell-save-state"]').text()).toBe('儲存中…')

    await cell.trigger('click')
    await cell.trigger('keydown', { key: 'Enter' })
    await cell.trigger('keydown', { key: 'Delete' })
    expect(wrapper.find('.schedule-editor-select').exists()).toBe(false)
    expect(wrapper.emitted('select-shift')).toBeFalsy()
  })

  it('已儲存與未儲存：未儲存時格子維持原本的班別，提示文字是伺服器的原因', () => {
    const saved = mountCell({ cellView: view({ saveState: 'saved' }) })
    expect(saved.get('[data-schedule-cell="1"]').classes()).toContain('is-saved')
    expect(saved.get('[data-test="cell-save-state"]').text()).toBe('已儲存')

    const reason = '「A 病房」沒有開放使用這個班別，請改選小單位設定的使用班別'
    const failed = mountCell({ cellView: view({ shiftId: 's1', saveState: 'failed', saveMessage: reason }) })
    const cell = failed.get('[data-schedule-cell="1"]')
    expect(cell.classes()).toContain('is-failed')
    expect(cell.attributes('title')).toBe(`未儲存：${reason}`)
    expect(failed.get('[data-test="cell-save-state"]').text()).toBe('未儲存')
    expect(failed.get('[data-test="shift-tag"]').text()).toBe('D(白班)')
  })

  it('空的可排班格子只留「點擊排班」的提示，不顯示「-」；勾選用原生核取方塊', () => {
    const wrapper = mountCell({ cellView: view({ shiftId: '', isManualSelected: true }) })
    expect(wrapper.find('.empty-hint').text()).toBe('點擊排班')
    expect(wrapper.find('.empty-cell').exists()).toBe(false)
    const checkbox = wrapper.get('input.cell-manual-checkbox')
    expect(checkbox.element.checked).toBe(true)
    expect(checkbox.attributes('aria-label')).toContain('王小明')
  })
})

describe('班別顯示（ScheduleCellDisplay）', () => {
  it('提示文字標出跨日班別的下班時間是次日，並附上備註', () => {
    const wrapper = mount(ScheduleCellDisplay, {
      props: { cellMeta: { isLeave: false, style: {} }, shiftInfo: shifts[1], formatShiftLabel }
    })
    const tag = wrapper.get('[data-test="shift-tag"]')
    expect(tag.text()).toBe('N(大夜)')
    expect(tag.attributes('title')).toBe('N(大夜)｜22:00–次日 06:00｜含夜班津貼')
  })

  it('一般班別顯示上下班時間；請假與空白維持原本的顯示', () => {
    const day = mount(ScheduleCellDisplay, {
      props: { cellMeta: { isLeave: false, style: {} }, shiftInfo: shifts[0], formatShiftLabel }
    })
    expect(day.get('[data-test="shift-tag"]').attributes('title')).toBe('D(白班)｜08:00–16:00')

    const leave = mount(ScheduleCellDisplay, {
      props: { cellMeta: { isLeave: true, style: {} }, shiftInfo: null, formatShiftLabel }
    })
    expect(leave.get('[data-test="leave-indicator"]').text()).toContain('休假中')

    const empty = mount(ScheduleCellDisplay, {
      props: { cellMeta: { isLeave: false, style: {} }, shiftInfo: null, formatShiftLabel }
    })
    expect(empty.text()).toBe('-')
  })
})
