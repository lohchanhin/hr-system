<template>
  <span v-if="cellMeta.isLeave" class="leave-text" data-test="leave-indicator">休假中（不列入工時）</span>

  <!-- 班別明細（上下班時間、跨日、備註）用原生提示文字：每一格不再各建一個彈出框元件，一百人一個月的表格才不會卡 -->
  <span
    v-else-if="shiftInfo"
    class="modern-shift-tag text-only"
    :style="cellMeta.style"
    :title="shiftTitle"
    data-test="shift-tag"
  >
    {{ formatShiftLabel(shiftInfo) }}
  </span>

  <span v-else class="empty-cell">-</span>
</template>

<script setup>
import { computed } from 'vue'
import { describeShiftTooltip } from '../../utils/scheduleFormatting'

const props = defineProps({
  cellMeta: { type: Object, required: true },
  shiftInfo: { type: Object, default: null },
  formatShiftLabel: { type: Function, required: true }
})

const shiftTitle = computed(() => describeShiftTooltip(props.shiftInfo))
</script>

<style scoped>
/* 格子本身已經用班別的底色與框線，班別名稱只需要文字 */
.modern-shift-tag {
  display: block;
  overflow: hidden;
  color: var(--shift-text-color, #344054);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.35;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.leave-text,
.empty-cell {
  display: block;
  color: #52606b;
  font-size: 11px;
  line-height: 1.35;
  text-align: center;
}

.leave-text {
  color: #744907;
}
</style>
