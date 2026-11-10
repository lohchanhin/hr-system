<template>
  <!-- 頁首的精簡統計（共用樣式 .hr-stat，見 docs/ui-guidelines.md） -->
  <div class="schedule-stats" role="group" aria-label="排班摘要">
    <span
      v-for="item in metrics"
      :key="item.label"
      class="hr-stat"
      :class="{ 'hr-stat--attention': item.attention && item.value > 0 }"
      :data-test="item.test"
    >
      <span class="hr-stat__label">{{ item.label }}</span>
      <strong class="hr-stat__value">{{ item.value }}</strong>
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
defineOptions({ name: 'ScheduleDashboard' })
const props = defineProps({
  summary: {
    type: Object,
    default: () => ({ direct: 0, unscheduled: 0, onLeave: 0 })
  }
})

const metrics = computed(() => [
  // 排班員工數（2026/11 客戶：「直屬」改為「排班」）：排班頁目前看的員工，和名單同一個範圍（部門、小單位與排班權限），不是直屬部屬
  { label: '排班員工數', value: props.summary.direct, test: 'schedule-stat-total' },
  { label: '未排班員工', value: props.summary.unscheduled, test: 'schedule-stat-unscheduled', attention: true },
  { label: '請假中員工', value: props.summary.onLeave, test: 'schedule-stat-leave' }
])
</script>

<style scoped>
.schedule-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.hr-stat__value {
  font-variant-numeric: tabular-nums;
}

/* 還有人沒排班：數字用提醒色（沿用排班頁原本的提醒色，不新增顏色） */
.hr-stat--attention .hr-stat__value {
  color: #a15c05;
}

@media (max-width: 700px) {
  .schedule-stats {
    gap: 6px;
  }
}
</style>
