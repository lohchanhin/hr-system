<template>
  <section class="dashboard" aria-label="排班摘要">
    <div
      v-for="item in metrics"
      :key="item.label"
      class="metric-card"
      :class="`metric-card--${item.tone}`"
    >
      <span class="metric-icon-shell" aria-hidden="true">
        <component :is="item.icon" class="metric-icon" />
      </span>
      <span class="metric-label">{{ item.label }}</span>
      <strong class="metric-value">{{ item.value }}</strong>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue'
import { UserFilled, CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'
defineOptions({ name: 'ScheduleDashboard' })
const props = defineProps({
  summary: {
    type: Object,
    default: () => ({ direct: 0, unscheduled: 0, onLeave: 0 })
  }
})

const metrics = computed(() => [
  { label: '直屬員工數', value: props.summary.direct, icon: UserFilled, tone: 'neutral' },
  { label: '未排班員工', value: props.summary.unscheduled, icon: CircleCloseFilled, tone: 'warning' },
  { label: '請假中員工', value: props.summary.onLeave, icon: WarningFilled, tone: 'leave' }
])
</script>

<style scoped>
.dashboard {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0 0 16px;
  overflow: hidden;
  background: #fff;
  border: 1px solid #dfe3e6;
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(16, 24, 40, 0.04);
}

.metric-card {
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  min-height: 62px;
  padding: 12px 16px;
  border-right: 1px solid #e8ebed;
}

.metric-card:last-child {
  border-right: 0;
}

.metric-icon-shell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: #52606b;
  background: #f1f3f5;
}

.metric-card--warning .metric-icon-shell {
  color: #a15c05;
  background: #fff7e8;
}

.metric-card--leave .metric-icon-shell {
  color: #1769aa;
  background: #edf6ff;
}

.metric-icon {
  width: 16px;
  height: 16px;
}

.metric-label {
  min-width: 0;
  color: #66727c;
  font-size: 13px;
  font-weight: 500;
}

.metric-value {
  color: #182026;
  font-size: 22px;
  font-variant-numeric: tabular-nums;
  font-weight: 680;
  line-height: 1;
}

@media (max-width: 700px) {
  .dashboard {
    grid-template-columns: 1fr;
  }

  .metric-card {
    border-right: 0;
    border-bottom: 1px solid #e8ebed;
  }

  .metric-card:last-child {
    border-bottom: 0;
  }
}
</style>
