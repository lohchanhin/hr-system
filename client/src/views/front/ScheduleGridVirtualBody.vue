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
    :tabindex="isEditableCell ? 0 : -1"
    @keydown.enter.prevent="startEditing"
    @click.stop="handleCellClick"
  >
    <div v-if="canEdit && !cellView.cellMeta.isLeave" class="cell-selection" @click.stop>
      <el-checkbox
        class="cell-manual-checkbox"
        :model-value="cellView.isManualSelected"
        size="small"
      />
    </div>

    <template v-if="cellView.scheduleCell || cellView.cellMeta.isLeave">
      <div v-if="isEditing" class="cell-editor-wrapper" @click.stop @mousedown.stop>
        <ScheduleCellEditor
          :schedule-cell="cellView.scheduleCell"
          :shifts="shifts"
          :format-shift-label="formatShiftLabel"
          :is-fullscreen="isFullscreen"
          :fullscreen-popper-target="fullscreenPopperTarget"
          :emp-id="String(row._id)"
          :day="day.date"
          @select-shift="handleSelectShift"
          @close="stopEditing"
        />
      </div>
      <div v-else class="cell-view-content">
        <ScheduleCellDisplay
          :cell-meta="cellView.cellMeta"
          :shift-info="cellView.shiftInfo"
          :format-shift-label="formatShiftLabel"
        />
        <div v-if="showEmptyHint" class="empty-hint">點擊排班</div>
        <div v-else-if="cellView.cellMeta.missingShift" class="missing-label">未排班</div>
      </div>
    </template>

    <span v-else class="empty-cell">-</span>
  </div>

</template>

<script setup>
import { computed, ref, watch } from 'vue'
import ScheduleCellDisplay from './ScheduleCellDisplay.vue'
import ScheduleCellEditor from './ScheduleCellEditor.vue'

const props = defineProps({
  row: { type: Object, required: true },
  day: { type: Object, required: true },
  cellView: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  shifts: { type: Array, default: () => [] },
  formatShiftLabel: { type: Function, required: true },
  isFullscreen: { type: Boolean, default: false },
  fullscreenPopperTarget: { type: [String, Object], default: null }
})

const emit = defineEmits(['select-shift'])
const isEditing = ref(false)

const isEditableCell = computed(() => props.canEdit && !props.cellView.cellMeta.isLeave)
const showEmptyHint = computed(() => isEditableCell.value && props.cellView.cellMeta.missingShift)

const handleSelectShift = value => {
  emit('select-shift', props.row._id, props.day.date, value)
}

const handleCellClick = () => {
  startEditing()
}

const startEditing = () => {
  if (!isEditableCell.value) return
  if (!props.cellView.scheduleCell) return
  isEditing.value = true
}

const stopEditing = () => {
  isEditing.value = false
}

watch(
  () => [props.row._id, props.day.date, props.cellView.scheduleCell?.shiftId, props.canEdit],
  () => {
    isEditing.value = false
  }
)
</script>

<style scoped>
.cell-editor-wrapper {
  width: 100%;
}

.cell-view-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 44px;
}

.empty-hint {
  font-size: 12px;
  color: #0369a1;
  text-align: center;
  border: 1px dashed rgba(3, 105, 161, 0.45);
  border-radius: 6px;
  padding: 2px 6px;
  background: rgba(224, 242, 254, 0.7);
}
</style>
