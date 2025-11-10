<template>
  <div class="my-schedule">
    <div class="toolbar">
      <el-date-picker v-model="selectedMonth" type="month" value-format="YYYY-MM" />
    </div>
    <div v-if="scheduleBanner" class="status-banner" :class="scheduleBanner.type">
      {{ scheduleBanner.message }}
    </div>
    <div
      v-if="confirmableRows.length"
      class="batch-toolbar"
    >
      <div class="batch-info">
        可確認班表：{{ selection.length }} / {{ confirmableRows.length }}
      </div>
      <div class="batch-actions">
        <el-button
          size="small"
          type="primary"
          plain
          :disabled="!confirmableRows.length"
          @click="handleSelectAllConfirmable"
        >
          {{ isAllConfirmableSelected ? '取消全選' : '全選可確認' }}
        </el-button>
        <el-button
          size="small"
          type="success"
          :disabled="!canBulkConfirm"
          :loading="bulkLoading"
          @click="handleBulkConfirm"
        >
          批次確認
        </el-button>
      </div>
    </div>

    <el-table
      v-if="schedules.length"
      ref="scheduleTableRef"
      :data="schedules"
      class="schedule-table"
      border
      stripe
      @selection-change="handleSelectionChange"
    >
      <el-table-column type="selection" width="48" :selectable="isRowSelectable" />
      <el-table-column prop="date" label="日期" width="140" />
      <el-table-column prop="shiftName" label="班別" min-width="160" />
      <el-table-column label="狀態" width="140">
        <template #default="{ row }">
          <el-tag :type="resolveStatus(row).type" effect="light">
            {{ resolveStatus(row).text }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="異議備註" min-width="220">
        <template #default="{ row }">
          <div class="note-text">
            {{ row.responseNote ? row.responseNote : '—' }}
          </div>
          <div v-if="row.responseAt" class="note-time">更新於 {{ row.responseAt }}</div>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="220">
        <template #default="{ row }">
          <div class="actions-cell">
            <el-button
              size="small"
              type="success"
              :loading="respondingId === row._id"
              :disabled="!canConfirm(row)"
              @click="handleConfirm(row)"
            >
              確認
            </el-button>
            <el-button
              size="small"
              type="danger"
              plain
              :loading="respondingId === row._id"
              :disabled="!canDispute(row)"
              @click="openDispute(row)"
            >
              提出異議
            </el-button>
          </div>
        </template>
      </el-table-column>
    </el-table>
    <p v-else class="empty-text">目前無排班資料</p>

    <el-dialog
      v-model="disputeDialog.visible"
      title="提出異議"
      width="480px"
      @closed="disputeDialog.schedule = null"
    >
      <p class="dialog-tip">請填寫異議原因，送出後主管會收到通知並重新調整班表。</p>
      <el-input
        v-model="disputeDialog.note"
        type="textarea"
        :rows="4"
        maxlength="500"
        show-word-limit
        placeholder="請輸入異議原因"
      />
      <template #footer>
        <el-button @click="disputeDialog.visible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="respondingId === (disputeDialog.schedule?._id || '')"
          @click="submitDispute"
        >
          送出異議
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed, reactive } from 'vue'
import dayjs from 'dayjs'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'

const schedules = ref([])
const shiftMap = ref({})
const selectedMonth = ref(dayjs().format('YYYY-MM'))
const respondingId = ref('')
const bulkLoading = ref(false)
const disputeDialog = reactive({ visible: false, schedule: null, note: '' })
const selection = ref([])
const scheduleTableRef = ref(null)

function formatShiftLabel(shift) {
  if (!shift) return ''
  const name = (shift.name || '').trim()
  const code = (shift.code || '').trim()
  if (name && code) return `${name} (${code})`
  return name || code
}

function resolveStatus(row) {
  if (!row) return { text: '未發布', type: 'info' }
  if (row.state === 'finalized') {
    return { text: '已完成', type: 'success' }
  }
  if (row.state === 'changes_requested' || row.employeeResponse === 'disputed') {
    return { text: '已提出異議', type: 'danger' }
  }
  if (row.state === 'pending_confirmation') {
    if (row.employeeResponse === 'confirmed') {
      return { text: '已確認', type: 'success' }
    }
    return { text: '待確認', type: 'warning' }
  }
  return { text: '草稿', type: 'info' }
}

const scheduleBanner = computed(() => {
  if (!schedules.value.length) return null
  const list = schedules.value
  const finalized = list.every(item => item.state === 'finalized')
  if (finalized) {
    return { type: 'success', message: '本月班表已完成發布，感謝您的回覆。' }
  }
  const hasDispute = list.some(item => item.state === 'changes_requested' || item.employeeResponse === 'disputed')
  if (hasDispute) {
    return { type: 'danger', message: '您已提交異議，主管調整後將再通知您。' }
  }
  const hasPending = list.some(item => item.state === 'pending_confirmation' && item.employeeResponse === 'pending')
  if (hasPending) {
    return { type: 'warning', message: '尚有班表待確認，如有疑問請提出異議。' }
  }
  const hasConfirmed = list.some(item => item.state === 'pending_confirmation' && item.employeeResponse === 'confirmed')
  if (hasConfirmed) {
    return { type: 'info', message: '已完成確認，等待主管完成發布。' }
  }
  return null
})

const canConfirm = row =>
  row?.state === 'pending_confirmation' &&
  row?.employeeResponse !== 'confirmed' &&
  row?.state !== 'changes_requested' &&
  row?.state !== 'finalized' &&
  respondingId.value !== row?._id

const canDispute = row =>
  row?.state === 'pending_confirmation' &&
  row?.employeeResponse !== 'disputed' &&
  row?.state !== 'finalized' &&
  respondingId.value !== row?._id

const confirmableRows = computed(() => schedules.value.filter(item => canConfirm(item)))

const isAllConfirmableSelected = computed(() => {
  const confirmableIds = new Set(confirmableRows.value.map(item => item._id))
  if (!confirmableIds.size) return false
  return confirmableRows.value.every(item =>
    selection.value.some(sel => sel?._id === item._id)
  )
})

const canBulkConfirm = computed(() =>
  selection.value.length > 0 && selection.value.every(item => canConfirm(item))
)

const isRowSelectable = row => canConfirm(row)

function handleSelectionChange(rows) {
  selection.value = Array.isArray(rows) ? rows : []
}

function clearSelection() {
  selection.value = []
  const table = scheduleTableRef.value
  table?.clearSelection?.()
}

function handleSelectAllConfirmable() {
  const table = scheduleTableRef.value
  if (!table) return
  const rows = confirmableRows.value
  if (!rows.length) return
  if (isAllConfirmableSelected.value) {
    rows.forEach(row => table.toggleRowSelection?.(row, false))
    selection.value = []
    return
  }
  table.clearSelection?.()
  rows.forEach(row => table.toggleRowSelection?.(row, true))
}

async function respondToSchedulesBulkRequest(scheduleIds, action, note = '') {
  if (!Array.isArray(scheduleIds) || !scheduleIds.length) return
  bulkLoading.value = true
  try {
    const res = await apiFetch('/api/schedules/respond/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scheduleIds, response: action, note })
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const message = payload?.error || '批次操作失敗'
      throw new Error(message)
    }
    const count = typeof payload?.count === 'number'
      ? payload.count
      : scheduleIds.length
    ElMessage.success(`已批次確認 ${count} 筆班表`)
    clearSelection()
    await loadSchedules()
  } catch (err) {
    ElMessage.error(err?.message || '批次操作失敗')
    throw err
  } finally {
    bulkLoading.value = false
  }
}

async function handleBulkConfirm() {
  if (!selection.value.length) return
  try {
    await ElMessageBox.confirm(
      `確認批次確認 ${selection.value.length} 筆班表嗎？`,
      '批次確認',
      {
        type: 'success',
        confirmButtonText: '確認',
        cancelButtonText: '取消'
      }
    )
  } catch (err) {
    return
  }

  const ids = selection.value.map(item => item?._id).filter(Boolean)
  if (!ids.length) return
  try {
    await respondToSchedulesBulkRequest(ids, 'confirm')
  } catch (err) {
    // 已顯示錯誤訊息
  }
}

async function fetchShifts() {
  try {
    const res = await apiFetch('/api/shifts')
    const data = await res.json().catch(() => null)
    if (!res.ok) return
    const list = Array.isArray(data) ? data : []
    shiftMap.value = Object.fromEntries(
      list.map(s => [
        s._id,
        {
          name: s.name || '',
          code: s.code || ''
        }
      ])
    )
  } catch (err) {
    console.error(err)
  }
}

async function respondToSchedule(scheduleId, action, note = '') {
  if (!scheduleId) return
  respondingId.value = scheduleId
  try {
    const res = await apiFetch(`/api/schedules/${scheduleId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response: action, note })
    })
    const payload = await res.json().catch(() => null)
    if (!res.ok) {
      const message = payload?.error || '回覆失敗'
      throw new Error(message)
    }
    ElMessage.success(action === 'confirm' ? '已確認班表' : '異議已送出')
    await loadSchedules()
  } catch (err) {
    ElMessage.error(err?.message || '回覆失敗')
    throw err
  } finally {
    respondingId.value = ''
  }
}

async function handleConfirm(row) {
  if (!row?._id) return
  try {
    await ElMessageBox.confirm(`確認 ${row.date} 的班表安排嗎？`, '確認排班', {
      type: 'success',
      confirmButtonText: '確認',
      cancelButtonText: '取消'
    })
  } catch (err) {
    return
  }
  try {
    await respondToSchedule(row._id, 'confirm')
  } catch (err) {
    // 已顯示錯誤訊息
  }
}

function openDispute(row) {
  if (!row?._id) return
  disputeDialog.schedule = row
  disputeDialog.note = row.responseNote || ''
  disputeDialog.visible = true
}

async function submitDispute() {
  const scheduleId = disputeDialog.schedule?._id
  if (!scheduleId) {
    disputeDialog.visible = false
    disputeDialog.note = ''
    return
  }
  const trimmed = (disputeDialog.note || '').trim()
  if (!trimmed) {
    ElMessage.warning('請輸入異議原因')
    return
  }
  try {
    await respondToSchedule(scheduleId, 'dispute', trimmed)
    disputeDialog.visible = false
    disputeDialog.note = ''
    disputeDialog.schedule = null
  } catch (err) {
    // 錯誤已提示
  }
}

async function loadSchedules() {
  const token = getToken()
  if (!token) return
  try {
    await fetchShifts()
    const payload = JSON.parse(atob(token.split('.')[1]))
    const userId =
      payload.employeeId || payload.id || payload._id || payload.sub
    if (!userId) return
    const params = new URLSearchParams({ month: selectedMonth.value })
    params.set('employee', userId)
    const res = await apiFetch(`/api/schedules/monthly?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      schedules.value = data.map(s => {
        const shift = shiftMap.value[s.shiftId]
        const state = s.state || 'draft'
        const employeeResponse = s.employeeResponse || 'pending'
        const responseNote = s.responseNote || ''
        const responseAtRaw = s.responseAt || ''
        const responseAt = responseAtRaw
          ? dayjs(responseAtRaw).format('YYYY/MM/DD HH:mm')
          : ''
        const publishedAt = s.publishedAt
          ? dayjs(s.publishedAt).format('YYYY/MM/DD HH:mm')
          : ''
        return {
          ...s,
          date: dayjs(s.date).format('YYYY/MM/DD'),
          shiftName: formatShiftLabel(shift) || s.shiftName || '',
          state,
          employeeResponse,
          responseNote,
          responseAt,
          responseAtRaw,
          publishedAt
        }
      })
      clearSelection()
    }
  } catch (err) {
    console.error(err)
  }
}

onMounted(loadSchedules)

watch(selectedMonth, loadSchedules)
</script>

<style scoped>
.my-schedule {
  padding: 24px;
  max-width: 960px;
  margin: 0 auto;
}

.toolbar {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 16px;
}

.batch-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 16px;
  color: #1e293b;
}

.batch-actions {
  display: flex;
  gap: 8px;
}

.status-banner {
  margin-bottom: 16px;
  padding: 12px 16px;
  border-radius: 12px;
  font-weight: 600;
  border: 1px solid transparent;
}

.status-banner.success {
  background: #dcfce7;
  border-color: #bbf7d0;
  color: #047857;
}

.status-banner.warning {
  background: #fef3c7;
  border-color: #fde68a;
  color: #b45309;
}

.status-banner.danger {
  background: #fee2e2;
  border-color: #fecaca;
  color: #b91c1c;
}

.status-banner.info {
  background: #eff6ff;
  border-color: #bfdbfe;
  color: #1d4ed8;
}

.schedule-table {
  width: 100%;
  border-radius: 12px;
  overflow: hidden;
}

.actions-cell {
  display: flex;
  gap: 8px;
}

.note-text {
  color: #334155;
  white-space: pre-wrap;
}

.note-time {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
}

.empty-text {
  margin-top: 24px;
  text-align: center;
  color: #64748b;
}

.dialog-tip {
  margin-bottom: 12px;
  color: #475569;
  font-size: 0.9rem;
}
</style>
