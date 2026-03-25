<template>
  <div
    v-if="!lazyMode || expandedRows.has(row._id)"
    class="modern-schedule-cell"
    :class="{
      'has-leave': cellMeta.isLeave,
      'missing-shift': cellMeta.missingShift,
      'is-selected': isSelected,
      'has-shift': cellMeta.hasShift
    }"
    :style="cellMeta.isLeave ? undefined : cellMeta.style"
    :title="leaveTitle"
  >
    <div v-if="canEdit && !cellMeta.isLeave" class="cell-selection" @click.stop>
      <el-checkbox
        :model-value="manualSelectedCellsSet.has(cellKey)"
        @change="val => $emit('toggle-cell', row._id, day.date, val)"
        size="small"
      />
    </div>

    <template v-if="scheduleCell">
      <div v-if="cellMeta.isLeave" class="leave-indicator" data-test="leave-indicator">
        <el-tag type="warning" effect="light" size="small" class="leave-tag">
          休假中
        </el-tag>
        <span class="leave-note">已核准請假，不列入工時</span>
      </div>

      <template v-else-if="canEdit">
        <el-select
          v-model="scheduleCell.shiftId"
          placeholder="選擇班別"
          @change="val => $emit('select-shift', row._id, day.date, val)"
          class="cell-select shift-select"
          size="small"
        >
          <el-option
            v-for="opt in shifts"
            :key="opt._id"
            :label="formatShiftLabel(opt)"
            :value="opt._id"
          />
        </el-select>
      </template>

      <template v-else>
        <el-popover v-if="shiftInfo" placement="top" trigger="hover" :width="200">
          <div class="shift-details">
            <div class="detail-row">
              <span class="detail-label">上班時間：</span>
              <span class="detail-value">{{ shiftInfo.startTime }}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">下班時間：</span>
              <span class="detail-value">{{ shiftInfo.endTime }}</span>
            </div>
            <div v-if="shiftInfo.remark" class="detail-row">
              <span class="detail-label">備註：</span>
              <span class="detail-value">{{ shiftInfo.remark }}</span>
            </div>
          </div>
          <template #reference>
            <div class="modern-shift-tag" :style="cellMeta.style">
              {{ formatShiftLabel(shiftInfo) }}
            </div>
          </template>
        </el-popover>
      </template>

      <div v-if="cellMeta.missingShift" class="missing-label">未排班</div>
    </template>

    <span v-else class="empty-cell">-</span>
  </div>

  <div v-else class="modern-schedule-cell collapsed-cell">
    展開班表
  </div>
</template>

<script setup>
defineProps({
  row: { type: Object, required: true },
  day: { type: Object, required: true },
  lazyMode: { type: Boolean, default: false },
  expandedRows: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  cellMeta: { type: Object, required: true },
  leaveTitle: { type: String, default: '' },
  isSelected: { type: Boolean, default: false },
  manualSelectedCellsSet: { type: Object, required: true },
  cellKey: { type: String, required: true },
  scheduleCell: { type: Object, default: null },
  shifts: { type: Array, default: () => [] },
  formatShiftLabel: { type: Function, required: true },
  shiftInfo: { type: Object, default: null }
})

defineEmits(['toggle-cell', 'select-shift'])
</script>
