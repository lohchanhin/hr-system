<!-- src/components/LeaveBalancePanel.vue：各假別的額度、已使用、簽核中、剩餘（單位是小時，天數只是 時數 / 8 的換算）。
     申請頁（自己的餘額）、簽核明細（申請人的餘額，並標出這張單的影響）、待簽核的動作視窗共用。
     傳 balances 就直接顯示（簽核明細已經帶在回應裡）；傳 employeeId 或什麼都不傳就自己向伺服器取。 -->
<template>
  <div class="leave-balance-panel" :class="{ compact }" data-test="leave-balance-panel">
    <div class="panel-header">
      <div class="panel-title">
        <b>{{ title }}</b>
        <span v-if="data" class="panel-range">{{ rangeText }}</span>
      </div>
      <el-button
        v-if="!balances"
        link
        type="primary"
        size="small"
        :loading="loading"
        data-test="leave-balance-refresh"
        @click="load"
      >
        重新整理
      </el-button>
    </div>

    <el-alert
      v-if="focusNote"
      :type="focusNote.type"
      :closable="false"
      show-icon
      class="focus-note"
      data-test="leave-balance-focus"
      :title="focusNote.text"
    />

    <div v-if="error" class="panel-error" data-test="leave-balance-error">
      {{ error }}
      <el-button link type="primary" size="small" @click="load">再試一次</el-button>
    </div>

    <el-table
      v-if="rows.length"
      :data="rows"
      size="small"
      border
      class="balance-table"
      :row-class-name="rowClassName"
      empty-text="沒有可顯示的假別"
    >
      <el-table-column label="假別" min-width="120">
        <template #default="{ row }">
          <span class="type-name">{{ row.name }}</span>
          <el-tag v-if="row.focus" size="small" type="primary" effect="plain" class="row-tag">本次申請</el-tag>
          <el-tag v-if="row.status === 'manual'" size="small" type="info" effect="plain" class="row-tag">人資維護</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="年度額度" min-width="130">
        <template #default="{ row }">{{ quotaText(row) }}</template>
      </el-table-column>
      <el-table-column label="已使用" min-width="120">
        <template #default="{ row }">
          {{ hoursText(row.usedHours) }}
          <div v-for="part in row.includes || []" :key="part.key" class="row-note">含{{ part.name }} {{ hoursText(part.hours) }}</div>
        </template>
      </el-table-column>
      <el-table-column v-if="!compact" label="簽核中" min-width="90">
        <template #default="{ row }">{{ row.pendingHours > 0 ? hoursText(row.pendingHours) : '—' }}</template>
      </el-table-column>
      <el-table-column label="剩餘" min-width="150">
        <template #default="{ row }">
          <span :class="remainingClass(row)">{{ remainingText(row) }}</span>
          <div v-if="overText(row)" class="row-note over">{{ overText(row) }}</div>
        </template>
      </el-table-column>
      <el-table-column v-if="!compact" label="備註" min-width="160">
        <template #default="{ row }">
          <span v-if="statusLabel(row)" class="status-label" :class="`status-${row.status}`">{{ statusLabel(row) }}</span>
          <span v-if="row.note" class="row-note">{{ row.note }}</span>
          <span v-if="row.expiryDate" class="row-note">請休期限 {{ dateText(row.expiryDate) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <div v-else-if="data && !error" class="panel-empty" data-test="leave-balance-empty">目前沒有可顯示的假別餘額</div>

    <ul v-if="data && data.unmatched && data.unmatched.length" class="unmatched-list" data-test="leave-balance-unmatched">
      <li v-for="item in data.unmatched" :key="item.name">
        「{{ item.name }}」尚未設定額度：已使用 {{ hoursText(item.usedHours) }}<template v-if="item.pendingHours > 0">、簽核中 {{ hoursText(item.pendingHours) }}</template>
      </li>
    </ul>

    <p v-if="data" class="panel-footer">
      1 天 = {{ data.dayHours || 8 }} 小時；統計期間 {{ rangeText }}；特休依員工資料，其餘假別依法定額度（人資可調整）
    </p>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../api'
import {
  STATUS_LABELS,
  describeOver,
  formatDaysAndHours,
  formatHours,
  formatHoursWithDays,
} from '../utils/leaveBalance'

const props = defineProps({
  // 向伺服器取這位員工的餘額；不傳就取登入者自己的
  employeeId: { type: String, default: '' },
  // 已經取好的餘額（簽核明細的回應裡就有），傳了就不再向伺服器取
  balances: { type: Object, default: null },
  // 精簡模式（待簽核的動作視窗）：不顯示簽核中與備註
  compact: { type: Boolean, default: false },
  title: { type: String, default: '假別餘額' },
  // 向伺服器取時的年度（預設今年）
  year: { type: [Number, String], default: '' },
})

const emit = defineEmits(['loaded'])

const fetched = ref(null)
const loading = ref(false)
const error = ref('')
let loadSeq = 0

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const data = computed(() => {
  const source = props.balances !== null ? props.balances : fetched.value
  return isObject(source) && Array.isArray(source.items) ? source : null
})

const focus = computed(() => (isObject(data.value?.focus) ? data.value.focus : null))

const rows = computed(() => (data.value?.items || []).map(item => ({
  ...item,
  focus: Boolean(focus.value && focus.value.typeKey && focus.value.typeKey === item.key),
})))

const rangeText = computed(() => {
  const range = data.value?.range
  if (!range?.start) return ''
  const start = String(range.start).replaceAll('-', '/')
  const end = String(range.end || '').slice(5).replaceAll('-', '/')
  return `${start}-${end}`
})

const hoursText = (hours) => formatHoursWithDays(hours)

function quotaText(row) {
  if (row.period === 'event') return row.quotaHours == null ? '不設上限' : `每次上限 ${formatHours(row.quotaHours)}`
  if (row.quotaHours == null) return '不設上限'
  return formatHoursWithDays(row.quotaHours)
}

function remainingText(row) {
  if (row.period === 'event' || row.remainingHours == null) return '—'
  if (row.remainingHours < 0) return formatHoursWithDays(0)
  return formatHoursWithDays(row.remainingHours)
}

const overText = (row) => (row.period === 'event' ? '' : describeOver(row))
const statusLabel = (row) => STATUS_LABELS[row.status] || ''

function remainingClass(row) {
  if (row.status === 'over') return 'remaining-over'
  if (row.status === 'low') return 'remaining-low'
  return ''
}

const rowClassName = ({ row }) => (row.focus ? 'focus-row' : (row.status === 'over' ? 'over-row' : ''))

const dateText = (value) => {
  const text = String(value || '')
  return text.length >= 10 ? text.slice(0, 10).replaceAll('-', '/') : text
}

// 簽核明細帶來的「這張單」說明：核准前後的剩餘，超額時用警告色
const focusNote = computed(() => {
  const info = focus.value
  if (!info || !info.typeName) return null
  const head = `本次申請：${info.typeName} ${formatHours(info.requestedHours)}`
  if (info.remainingBefore != null && info.remainingAfter != null) {
    const text = `${head}，核准前剩 ${formatHoursWithDays(info.remainingBefore)}，核准後剩 ${formatHoursWithDays(info.remainingAfter)}`
    if (info.exceeded) return { type: 'warning', text: `${text}（${info.message || '已超出額度'}）` }
    return { type: 'info', text }
  }
  if (info.exceeded) return { type: 'warning', text: `${head}（${info.message || '已超出額度'}）` }
  return { type: 'info', text: `${head}（約 ${formatDaysAndHours(info.requestedHours)}）` }
})

async function load() {
  if (props.balances !== null) return
  const seq = ++loadSeq
  loading.value = true
  error.value = ''
  try {
    const query = new URLSearchParams()
    if (props.employeeId) query.set('employeeId', props.employeeId)
    if (props.year) query.set('year', String(props.year))
    const suffix = query.toString() ? `?${query.toString()}` : ''
    const res = await apiFetch(`/api/approvals/leave-balances${suffix}`)
    if (seq !== loadSeq) return
    if (!res.ok) throw new Error(`status ${res.status}`)
    const json = await res.json()
    fetched.value = isObject(json) ? json : null
    emit('loaded', fetched.value)
  } catch {
    if (seq !== loadSeq) return
    // 餘額只是參考資訊：載入失敗只顯示一行提示，不擋住申請與簽核
    error.value = '假別餘額暫時無法載入'
  } finally {
    if (seq === loadSeq) loading.value = false
  }
}

defineExpose({ load, refresh: load })

onMounted(load)
watch(() => [props.employeeId, props.year], () => {
  if (props.balances === null) load()
})
</script>

<style scoped>
.leave-balance-panel {
  border: 1px solid var(--el-border-color-lighter, #ebeef5);
  border-radius: 8px;
  padding: 12px 14px;
  background: #fff;
  margin-bottom: 12px;
}
.leave-balance-panel.compact {
  padding: 8px 10px;
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.panel-range {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
.focus-note {
  margin-bottom: 8px;
}
.panel-error {
  color: #e6a23c;
  font-size: 13px;
  margin-bottom: 8px;
}
.panel-empty {
  color: #909399;
  font-size: 13px;
}
.balance-table {
  width: 100%;
}
.type-name {
  font-weight: 600;
}
.row-tag {
  margin-left: 6px;
}
.row-note {
  display: block;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}
.row-note.over {
  color: #f56c6c;
}
.remaining-over {
  color: #f56c6c;
  font-weight: 600;
}
.remaining-low {
  color: #e6a23c;
  font-weight: 600;
}
.status-label {
  font-size: 12px;
  margin-right: 6px;
}
.status-low {
  color: #e6a23c;
}
.status-over {
  color: #f56c6c;
}
.unmatched-list {
  margin: 8px 0 0;
  padding-left: 18px;
  color: #909399;
  font-size: 12px;
}
.panel-footer {
  margin: 8px 0 0;
  color: #909399;
  font-size: 12px;
}
:deep(.focus-row) {
  background-color: #ecf5ff;
}
:deep(.over-row) {
  background-color: #fef0f0;
}
</style>
