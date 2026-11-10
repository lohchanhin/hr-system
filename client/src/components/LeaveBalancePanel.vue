<!-- src/components/LeaveBalancePanel.vue：各假別的額度、已使用、簽核中、剩餘（單位是小時，天數只是 時數 / 8 的換算）。
     申請頁（自己的餘額）、簽核明細（申請人的餘額，並標出這張單的影響）、待簽核的動作視窗共用。
     傳 balances 就直接顯示（簽核明細已經帶在回應裡）；傳 employeeId 或什麼都不傳就自己向伺服器取。
     簽核明細的 balances 帶有 compensatory（申請人的調休存摺）時，在下方列出每一筆調休的來源、狀態與用在哪張單。 -->
<template>
  <div class="leave-balance-panel" :class="{ compact, 'is-collapsed': collapsed }" data-test="leave-balance-panel">
    <div class="panel-header">
      <div class="panel-title">
        <b>{{ title }}</b>
        <span v-if="data" class="panel-range">{{ rangeText }}</span>
      </div>
      <div class="panel-actions">
        <el-button
          v-if="!balances && !collapsed && !compact"
          link
          type="primary"
          size="small"
          :loading="loading"
          data-test="leave-balance-refresh"
          @click="load"
        >
          重新載入
        </el-button>
        <!-- 可收合（申請頁、簽核明細）：預設只留標題與「這張單的影響」，表格按展開才出現 -->
        <el-button
          v-if="collapsible"
          link
          type="primary"
          size="small"
          data-test="leave-balance-toggle"
          :aria-expanded="!collapsed"
          @click="collapsed = !collapsed"
        >
          {{ collapsed ? '展開' : '收合' }}
        </el-button>
      </div>
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

    <div v-show="!collapsed" class="panel-body" data-test="leave-balance-body">
    <!-- 手機：每個假別一列（剩餘在右、額度與已使用在下一行），不用橫向捲動的寬表格 -->
    <ul v-if="rows.length && isMobile" class="balance-list" data-test="leave-balance-list">
      <li v-for="row in rows" :key="row.key || row.name" class="balance-item" :class="rowClassName({ row })">
        <div class="balance-item__head">
          <span class="type-name">{{ row.name }}</span>
          <el-tag v-if="row.focus" size="small" type="primary" effect="plain" class="row-tag">本次申請</el-tag>
          <span class="balance-item__remaining" :class="remainingClass(row)">{{ mobileRemainingText(row) }}</span>
        </div>
        <div class="row-note">{{ mobileDetailText(row) }}</div>
        <div v-if="overText(row)" class="row-note over">{{ overText(row) }}</div>
        <div v-if="statusLabel(row) || row.expiryDate" class="row-note">
          <span v-if="statusLabel(row)" class="status-label" :class="`status-${row.status}`">{{ statusLabel(row) }}</span>
          <span v-if="row.expiryDate">請休期限 {{ dateText(row.expiryDate) }}</span>
        </div>
      </li>
    </ul>

    <el-table
      v-else-if="rows.length"
      :data="rows"
      size="small"
      border
      class="balance-table"
      :row-class-name="rowClassName"
      empty-text="沒有可顯示的假別"
    >
      <el-table-column label="假別" :min-width="compact ? 86 : 120">
        <template #default="{ row }">
          <span class="type-name">{{ row.name }}</span>
          <el-tag v-if="row.focus" size="small" type="primary" effect="plain" class="row-tag">本次申請</el-tag>
          <el-tag v-if="row.status === 'manual'" size="small" type="info" effect="plain" class="row-tag">人資維護</el-tag>
          <el-tag v-if="row.source === 'bank'" size="small" type="success" effect="plain" class="row-tag">存摺</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="年度額度" :min-width="compact ? 118 : 130">
        <template #default="{ row }">{{ quotaText(row) }}</template>
      </el-table-column>
      <el-table-column label="已使用" :min-width="compact ? 108 : 120">
        <template #default="{ row }">
          {{ rowHoursText(row, row.usedHours) }}
          <!-- 已使用只含已核准的：併入的子假別（家庭照顧假…）簽核中的部分放在「簽核中」那一欄，不然會被當成已使用的一部分 -->
          <div v-for="part in approvedIncludes(row)" :key="part.key" class="row-note" data-test="leave-balance-includes">含{{ part.name }} {{ hoursText(part.hours) }}</div>
        </template>
      </el-table-column>
      <el-table-column v-if="!compact" label="簽核中" min-width="90">
        <template #default="{ row }">
          {{ row.pendingHours > 0 ? rowHoursText(row, row.pendingHours) : '—' }}
          <div v-for="part in pendingIncludes(row)" :key="part.key" class="row-note" data-test="leave-balance-includes-pending">含{{ part.name }} {{ hoursText(part.hours) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="剩餘" :min-width="compact ? 118 : 150">
        <template #default="{ row }">
          <span :class="remainingClass(row)">{{ remainingText(row) }}</span>
          <div v-if="overText(row)" class="row-note over">{{ overText(row) }}</div>
        </template>
      </el-table-column>
      <!-- 備註只留狀態與期限；各假別的規定（法條、給薪方式）收進下方的「說明」，不佔表格寬度 -->
      <el-table-column v-if="!compact" label="備註" min-width="120">
        <template #default="{ row }">
          <span v-if="statusLabel(row)" class="status-label" :class="`status-${row.status}`">{{ statusLabel(row) }}</span>
          <span v-if="row.expiryDate" class="row-note">請休期限 {{ dateText(row.expiryDate) }}</span>
        </template>
      </el-table-column>
    </el-table>

    <div v-else-if="data && !error" class="panel-empty" data-test="leave-balance-empty">目前沒有可顯示的假別餘額</div>

    <!-- 申請人的調休存摺（簽核明細）：調休單一定附上，其他請假單在申請人有調休時附上 -->
    <CompensatoryLeavePanel
      v-if="compensatory"
      :bank="compensatory"
      compact
      :title="compensatory.focus ? '申請人的調休存摺（本次申請調休）' : '申請人的調休存摺'"
      class="compensatory-detail"
      data-test="leave-balance-compensatory"
    />
    <p v-if="thisRequestText" class="panel-footer" data-test="leave-balance-comp-this">{{ thisRequestText }}</p>

    <ul v-if="data && data.unmatched && data.unmatched.length" class="unmatched-list" data-test="leave-balance-unmatched">
      <li v-for="item in data.unmatched" :key="item.name">
        「{{ item.name }}」尚未設定額度：已使用 {{ hoursText(item.usedHours) }}<template v-if="item.pendingHours > 0">、簽核中 {{ hoursText(item.pendingHours) }}</template>
      </li>
    </ul>

    <p v-if="data" class="panel-footer">
      1 天 = {{ data.dayHours || 8 }} 小時
      <el-button
        v-if="!compact"
        link
        type="primary"
        size="small"
        class="help-toggle"
        data-test="leave-balance-help-toggle"
        :aria-expanded="helpOpen"
        @click="helpOpen = !helpOpen"
      >
        {{ helpOpen ? '收合說明' : '說明' }}
      </el-button>
    </p>
    <!-- 計算方式與各假別的規定：預設收合，按「說明」才展開 -->
    <div v-if="data && !compact" v-show="helpOpen" class="panel-help" data-test="leave-balance-help">
      <p>統計期間 {{ rangeText }}；特休依員工資料，調休（移休）依調休存摺（不分年度），其餘假別依法定額度（人資可調整）</p>
      <ul v-if="noteRows.length">
        <li v-for="row in noteRows" :key="row.key || row.name">{{ row.name }}：{{ row.note }}</li>
      </ul>
    </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { apiFetch } from '../api'
import CompensatoryLeavePanel from './CompensatoryLeavePanel.vue'
import { useIsMobile } from '../utils/useIsMobile'
import { toTaipeiDateKey } from '../utils/leaveHours'
import {
  STATUS_LABELS,
  describeOver,
  formatBankHours,
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
  // 可收合：標題列多一個「展開／收合」，預設收合（只留標題、這張單的影響與載入失敗的提示）
  collapsible: { type: Boolean, default: false },
  defaultCollapsed: { type: Boolean, default: true },
})

const emit = defineEmits(['loaded'])

const fetched = ref(null)
const loading = ref(false)
const error = ref('')
let loadSeq = 0
const isMobile = useIsMobile()
// 計算方式與各假別規定的說明：預設收合
const helpOpen = ref(false)
const collapsed = ref(props.collapsible && props.defaultCollapsed)
function expand() {
  collapsed.value = false
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const data = computed(() => {
  const source = props.balances !== null ? props.balances : fetched.value
  return isObject(source) && Array.isArray(source.items) ? source : null
})

const focus = computed(() => (isObject(data.value?.focus) ? data.value.focus : null))

// 申請人的調休存摺（簽核明細才有）
const compensatory = computed(() => (isObject(data.value?.compensatory) && Array.isArray(data.value.compensatory.credits) ? data.value.compensatory : null))
const thisRequestText = computed(() => {
  const used = compensatory.value?.thisRequest
  if (!isObject(used) || !(Number(used.hours) > 0)) return ''
  const parts = (used.credits || []).map(part => `${part.sourceText} ${formatBankHours(part.hours)}`).join('、')
  return `這張單已扣用調休 ${formatBankHours(used.hours)}${parts ? `：${parts}` : ''}`
})

const rows = computed(() => (data.value?.items || []).map(item => ({
  ...item,
  focus: Boolean(focus.value && focus.value.typeKey && focus.value.typeKey === item.key),
})))

const rangeText = computed(() => {
  const range = data.value?.range
  if (!range?.start) return ''
  // 日期全站一致寫完整的 YYYY/MM/DD，期間用「～」連接（和薪資明細相同）
  const start = String(range.start).replaceAll('-', '/')
  const end = String(range.end || '').replaceAll('-', '/')
  return end ? `${start}～${end}` : start
})

const hoursText = (hours) => formatHoursWithDays(hours)
// 調休存摺（移休，以天計）的那一列：天數用小數（4 小時 = 0.5 天），其他假別維持「N 天 M 小時」
const rowHoursText = (row, hours) => (row?.source === 'bank' ? formatBankHours(hours) : formatHoursWithDays(hours))

function quotaText(row) {
  // 調休存摺不是年度額度：顯示累計取得的時數
  if (row.source === 'bank') return `累計取得 ${formatBankHours(row.quotaHours || 0)}`
  if (row.period === 'event') return row.quotaHours == null ? '不設上限' : `每次上限 ${formatHours(row.quotaHours)}`
  if (row.quotaHours == null) return '不設上限'
  return formatHoursWithDays(row.quotaHours)
}

function remainingText(row) {
  if (row.period === 'event' || row.remainingHours == null) return '—'
  if (row.remainingHours < 0) return rowHoursText(row, 0)
  return rowHoursText(row, row.remainingHours)
}

// 併入這個假別的子假別（含家庭照顧假 N 小時）：已核准與簽核中分開帶（approvedHours / pendingHours）；
// 舊版伺服器只有合計（hours），照舊當成已使用
const includesOf = (row) => (Array.isArray(row.includes) ? row.includes : [])
const approvedIncludes = (row) => includesOf(row)
  .map(part => ({ key: part.key, name: part.name, hours: part.approvedHours !== undefined ? Number(part.approvedHours) : Number(part.hours) }))
  .filter(part => part.hours > 0)
const pendingIncludes = (row) => includesOf(row)
  .map(part => ({ key: part.key, name: part.name, hours: Number(part.pendingHours) }))
  .filter(part => part.hours > 0)

const overText = (row) => (row.period === 'event' ? '' : describeOver(row))

// 有規定說明的假別（法條、給薪方式等），列在「說明」裡
const noteRows = computed(() => rows.value.filter(row => typeof row.note === 'string' && row.note.trim()))

// 手機的一列：右邊是剩餘（每次計的假別顯示每次上限），下一行是額度、已使用、簽核中
function mobileRemainingText(row) {
  if (row.period === 'event') return row.quotaHours == null ? '不設上限' : `每次上限 ${formatHours(row.quotaHours)}`
  if (row.remainingHours == null) return row.quotaHours == null ? '不設上限' : '—'
  return `剩 ${remainingText(row)}`
}
function mobileDetailText(row) {
  const parts = []
  if (row.source === 'bank') parts.push(quotaText(row))
  else if (row.period !== 'event' && row.quotaHours != null) parts.push(`額度 ${quotaText(row)}`)
  parts.push(`已使用 ${rowHoursText(row, row.usedHours)}`)
  for (const part of approvedIncludes(row)) parts.push(`含${part.name} ${hoursText(part.hours)}`)
  if (row.pendingHours > 0) parts.push(`簽核中 ${rowHoursText(row, row.pendingHours)}`)
  return parts.join('・')
}
const statusLabel = (row) => STATUS_LABELS[row.status] || ''

function remainingClass(row) {
  if (row.status === 'over') return 'remaining-over'
  if (row.status === 'low') return 'remaining-low'
  return ''
}

const rowClassName = ({ row }) => (row.focus ? 'focus-row' : (row.status === 'over' ? 'over-row' : ''))

// 期限以台灣日期顯示：伺服器存的是時間點，可能是台灣時間的午夜（UTC 的前一天 16:00），
// 直接取字串前 10 碼會少一天
const dateText = (value) => {
  const key = toTaipeiDateKey(value)
  return key ? key.replaceAll('-', '/') : String(value || '')
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

defineExpose({ load, refresh: load, expand })

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
.panel-actions {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
/* 收合時標題列下面不留空白（有「這張單的影響」或錯誤提示時它們自己有間距） */
.leave-balance-panel.is-collapsed > .panel-header {
  margin-bottom: 0;
}
.leave-balance-panel.is-collapsed > .focus-note,
.leave-balance-panel.is-collapsed > .panel-error {
  margin: 8px 0 0;
}
.focus-note {
  margin-bottom: 8px;
}
.compensatory-detail {
  margin-top: 10px;
}
.panel-error {
  color: var(--el-color-warning);
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
  color: var(--el-color-danger);
}
.remaining-over {
  color: var(--el-color-danger);
  font-weight: 600;
}
.remaining-low {
  color: var(--el-color-warning);
  font-weight: 600;
}
.status-label {
  font-size: 12px;
  margin-right: 6px;
}
.status-low {
  color: var(--el-color-warning);
}
.status-over {
  color: var(--el-color-danger);
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
.help-toggle {
  margin-left: 6px;
  vertical-align: baseline;
}
.panel-help {
  margin-top: 4px;
  color: #606266;
  font-size: 12px;
  line-height: 1.7;
}
.panel-help p {
  margin: 0;
}
.panel-help ul {
  margin: 4px 0 0;
  padding-left: 18px;
}
/* 手機的清單 */
.balance-list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.balance-item {
  padding: 8px 0;
  border-top: 1px solid var(--el-border-color-lighter, #ebeef5);
}
.balance-item:first-child {
  border-top: none;
}
.balance-item.focus-row {
  padding-left: 8px;
  padding-right: 8px;
  border-radius: 6px;
  background-color: var(--el-color-primary-light-9);
}
.balance-item__head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.balance-item__remaining {
  margin-left: auto;
  font-weight: 600;
  text-align: right;
}
.balance-item .row-tag {
  margin-left: 0;
}
/* 目前要請的假別那一列：用系統主色的淺色（以前是 Element Plus 預設的藍色） */
:deep(.focus-row) {
  background-color: var(--el-color-primary-light-9);
}
:deep(.over-row) {
  background-color: #fef0f0;
}
</style>
