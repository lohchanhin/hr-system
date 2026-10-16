<!-- src/components/LeaveRequestHint.vue：填請假單時，即時提示「這次申請的假別還剩多少、會不會超額」。
     只是提示（超額是否能送出由伺服器依該假別的設定決定），不會停用送出按鈕。 -->
<template>
  <el-alert
    v-if="result"
    :type="alertType"
    :closable="false"
    show-icon
    class="leave-request-hint"
    data-test="leave-request-hint"
    :title="result.text"
  />
</template>

<script setup>
import { computed } from 'vue'
import { evaluateRequest, matchBalanceItem } from '../utils/leaveBalance'

const props = defineProps({
  // 餘額列表（GET /api/approvals/leave-balances 的 items）
  items: { type: Array, default: () => [] },
  // 申請人選的假別（名稱）
  typeText: { type: String, default: '' },
  // 申請的時數
  hours: { type: [Number, String], default: null },
})

const result = computed(() => {
  const requested = Number(props.hours)
  if (!(requested > 0) || !props.typeText) return null
  const item = matchBalanceItem(props.items, props.typeText)
  if (!item) return null
  return evaluateRequest(item, props.items, requested)
})

const alertType = computed(() => {
  if (!result.value) return 'info'
  if (result.value.level === 'error') return 'error'
  if (result.value.level === 'warning') return 'warning'
  return 'info'
})
</script>

<style scoped>
.leave-request-hint {
  margin-top: 8px;
}
</style>
