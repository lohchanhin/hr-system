<template>
  <div class="dashboard">
    <el-card class="metric-card" v-for="item in metrics" :key="item.label">
      <div class="metric-label">{{ item.label }}</div>
      <div class="metric-value">{{ item.value }}</div>
    </el-card>
  </div>
</template>

<script setup>
import { computed } from 'vue'
const props = defineProps({
  summary: {
    type: Object,
    default: () => ({ direct: 0, unscheduled: 0, onLeave: 0 })
  }
})

const metrics = computed(() => [
  { label: '直屬員工數', value: props.summary.direct },
  { label: '未排班員工', value: props.summary.unscheduled },
  { label: '請假中員工', value: props.summary.onLeave }
])
</script>

<style scoped>
.dashboard {
  display: flex;
  gap: 16px;
  margin: 24px 0;
}
.metric-card {
  flex: 1;
  text-align: center;
}
.metric-label {
  color: #475569;
  margin-bottom: 8px;
}
.metric-value {
  font-size: 1.5rem;
  font-weight: 600;
  color: #0f766e;
}
</style>
