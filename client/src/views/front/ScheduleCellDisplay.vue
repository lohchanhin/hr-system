<template>
  <span v-if="cellMeta.isLeave" class="leave-text" data-test="leave-indicator">休假中（不列入工時）</span>

  <el-popover
    v-else-if="shiftInfo"
    placement="top"
    trigger="hover"
    :width="200"
  >
    <template #default>
      <div v-if="popoverReady" class="shift-details">
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
    </template>
    <template #reference>
      <span
        class="modern-shift-tag text-only"
        :style="cellMeta.style"
        @mouseenter="popoverReady = true"
      >
        {{ formatShiftLabel(shiftInfo) }}
      </span>
    </template>
  </el-popover>

  <span v-else class="empty-cell">-</span>
</template>

<script setup>
import { ref } from 'vue'

const popoverReady = ref(false)

defineProps({
  cellMeta: { type: Object, required: true },
  shiftInfo: { type: Object, default: null },
  formatShiftLabel: { type: Function, required: true }
})
</script>
