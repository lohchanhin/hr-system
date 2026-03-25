<template>
  <div
    v-if="!lazyMode || expandedRows.has(row._id)"
    class="modern-schedule-cell"
    :class="{
      'has-leave': cellView.cellMeta.isLeave,
      'missing-shift': cellView.cellMeta.missingShift,
      'is-selected': cellView.isSelected,
      'has-shift': cellView.cellMeta.hasShift
    }"
    :style="cellView.cellMeta.isLeave ? undefined : cellView.cellMeta.style"
    :title="cellView.leaveTitle"
  >
    <div v-if="canEdit && !cellView.cellMeta.isLeave" class="cell-selection" @click.stop>
      <el-checkbox
        :model-value="cellView.isManualSelected"
        @change="val => $emit('toggle-cell', row._id, day.date, val)"
        size="small"
      />
    </div>

    <template v-if="cellView.scheduleCell || cellView.cellMeta.isLeave">
      <ScheduleCellEditor
        v-if="canEdit && !cellView.cellMeta.isLeave"
        :schedule-cell="cellView.scheduleCell"
        :shifts="shifts"
        :format-shift-label="formatShiftLabel"
        @select-shift="val => $emit('select-shift', row._id, day.date, val)"
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

  <div v-else class="modern-schedule-cell collapsed-cell">
    展開班表
  </div>
</template>

<script setup>
import ScheduleCellDisplay from './ScheduleCellDisplay.vue'
import ScheduleCellEditor from './ScheduleCellEditor.vue'

defineProps({
  row: { type: Object, required: true },
  day: { type: Object, required: true },
  cellView: { type: Object, required: true },
  lazyMode: { type: Boolean, default: false },
  expandedRows: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  shifts: { type: Array, default: () => [] },
  formatShiftLabel: { type: Function, required: true }
})

defineEmits(['toggle-cell', 'select-shift'])
</script>
