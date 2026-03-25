<template>
  <div
    class="modern-schedule-cell"
    data-schedule-cell="1"
    :data-emp-id="String(row._id)"
    :data-day="String(day.date)"
    :class="{
      'has-leave': cellView.cellMeta.isLeave,
      'missing-shift': cellView.cellMeta.missingShift,
      'is-selected': cellView.isSelected,
      'has-shift': cellView.cellMeta.hasShift
    }"
    :style="cellView.cellMeta.isLeave ? undefined : cellView.cellMeta.style"
    :title="cellView.leaveTitle"
  >
    <div v-if="canEdit && !cellView.cellMeta.isLeave" class="cell-selection">
      <el-checkbox
        class="cell-manual-checkbox"
        :model-value="cellView.isManualSelected"
        size="small"
      />
    </div>

    <template v-if="cellView.scheduleCell || cellView.cellMeta.isLeave">
      <ScheduleCellEditor
        v-if="canEdit && !cellView.cellMeta.isLeave"
        :schedule-cell="cellView.scheduleCell"
        :shifts="shifts"
        :format-shift-label="formatShiftLabel"
        :emp-id="String(row._id)"
        :day="day.date"
        @select-shift="handleSelectShift"
      />
      <ScheduleCellDisplay
        v-else
        :cell-meta="cellView.cellMeta"
        :shift-info="cellView.shiftInfo"
        :format-shift-label="formatShiftLabel"
      />
      <div v-if="cellView.cellMeta.missingShift" class="missing-label">未排班</div>
    </template>

    <span v-else class="empty-cell">-</span>
  </div>

</template>

<script setup>
import ScheduleCellDisplay from './ScheduleCellDisplay.vue'
import ScheduleCellEditor from './ScheduleCellEditor.vue'

const props = defineProps({
  row: { type: Object, required: true },
  day: { type: Object, required: true },
  cellView: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  shifts: { type: Array, default: () => [] },
  formatShiftLabel: { type: Function, required: true }
})

const emit = defineEmits(['select-shift'])

const handleSelectShift = value => {
  emit('select-shift', props.row._id, props.day.date, value)
}
</script>
