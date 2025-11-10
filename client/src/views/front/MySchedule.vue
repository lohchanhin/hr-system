<template>
  <div class="my-schedule">
    <div class="status-card">
      <div class="status-header">
        <h2>本月排班狀態</h2>
        <el-tag :type="stateTagType" effect="plain">{{ stateLabel }}</el-tag>
      </div>
      <div class="status-meta">
        <span>員工回覆：{{ responseStatusLabel }}</span>
        <span v-if="responseAtText">回覆時間：{{ responseAtText }}</span>
      </div>
      <el-input
        v-model="responseNote"
        type="textarea"
        :rows="3"
        maxlength="500"
        show-word-limit
        class="response-note"
        placeholder="如需提出異議，請輸入原因"
        :disabled="!canRespond || isSubmitting"
      />
      <p v-if="latestDisputeNote && !canRespond" class="dispute-note">
        最近異議：{{ latestDisputeNote }}
      </p>
      <p v-else-if="!canRespond" class="hint">
        {{ monthState === 'finalized' ? '班表已完成發布，若需變更請洽主管。' : '等待主管發布後即可回覆。' }}
      </p>
      <div class="status-actions">
        <el-button
          type="success"
          :disabled="!canRespond || isSubmitting"
          :loading="isSubmitting"
          @click="handleConfirm"
        >
          確認排班
        </el-button>
        <el-button
          type="danger"
          plain
          :disabled="!canRespond || isSubmitting"
          :loading="isSubmitting"
          @click="handleDispute"
        >
          提出異議
        </el-button>
      </div>
    </div>
    <el-date-picker v-model="selectedMonth" type="month" value-format="YYYY-MM" />
    <el-table v-if="schedules.length" :data="schedules" class="schedule-table">
      <el-table-column prop="date" label="日期" width="120" />
      <el-table-column prop="shiftName" label="班別" />
    </el-table>
    <p v-else>目前無排班資料</p>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import dayjs from 'dayjs'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'
import { ElMessage, ElMessageBox } from 'element-plus'

const schedules = ref([])
const shiftMap = ref({})
const selectedMonth = ref(dayjs().format('YYYY-MM'))
const monthState = ref('draft')
const employeeStatus = ref({ status: 'pending', notes: [], responseAt: null })
const responseNote = ref('')
const isSubmitting = ref(false)
const currentEmployeeId = ref('')

function formatShiftLabel(shift) {
  if (!shift) return ''
  const name = (shift.name || '').trim()
  const code = (shift.code || '').trim()
  if (name && code) return `${name} (${code})`
  return name || code
}

const stateLabel = computed(() => {
  const map = {
    draft: '草稿',
    pending_confirmation: '待確認',
    finalized: '已完成',
  }
  return map[monthState.value] || '未設定'
})

const stateTagType = computed(() => {
  switch (monthState.value) {
    case 'finalized':
      return 'success'
    case 'pending_confirmation':
      return 'warning'
    default:
      return 'info'
  }
})

const responseStatusLabel = computed(() => {
  const map = {
    pending: '尚未回覆',
    confirmed: '已確認',
    disputed: '已提出異議',
  }
  return map[employeeStatus.value.status] || '尚未回覆'
})

const responseAtText = computed(() => {
  const value = employeeStatus.value.responseAt
  if (!value) return ''
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format('YYYY/MM/DD HH:mm') : ''
})

const latestDisputeNote = computed(() => {
  if (employeeStatus.value.status !== 'disputed') return ''
  if (!Array.isArray(employeeStatus.value.notes) || !employeeStatus.value.notes.length) return ''
  return employeeStatus.value.notes[employeeStatus.value.notes.length - 1]
})

const canRespond = computed(() =>
  monthState.value === 'pending_confirmation' && employeeStatus.value.status !== 'confirmed'
)

function applyEmployeeMeta(meta, employeeId) {
  const toDate = value => {
    if (!value) return null
    const parsed = dayjs(value)
    return parsed.isValid() ? parsed.toDate() : null
  }
  monthState.value = meta?.state || 'draft'
  if (!employeeId) {
    employeeStatus.value = { status: 'pending', notes: [], responseAt: null }
    responseNote.value = ''
    return
  }
  const list = Array.isArray(meta?.employeeStatuses) ? meta.employeeStatuses : []
  const found = list.find(entry => String(entry.employeeId) === String(employeeId))
  if (found) {
    const notes = Array.isArray(found.notes) ? found.notes : []
    employeeStatus.value = {
      status: found.status || 'pending',
      notes,
      responseAt: toDate(found.lastResponseAt),
    }
    if (found.status === 'disputed' && notes.length) {
      responseNote.value = notes[notes.length - 1]
    } else {
      responseNote.value = ''
    }
  } else {
    employeeStatus.value = { status: 'pending', notes: [], responseAt: null }
    responseNote.value = ''
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

async function loadSchedules() {
  const token = getToken()
  if (!token) return
  try {
    await fetchShifts()
    const payload = JSON.parse(atob(token.split('.')[1]))
    const userId =
      payload.employeeId || payload.id || payload._id || payload.sub
    if (!userId) return
    currentEmployeeId.value = String(userId)
    const params = new URLSearchParams({ month: selectedMonth.value })
    params.set('employee', currentEmployeeId.value)
    const res = await apiFetch(`/api/schedules/monthly?${params.toString()}`)
    if (res.ok) {
      const data = await res.json()
      let items = []
      let meta = {}
      if (Array.isArray(data)) {
        items = data
      } else {
        items = Array.isArray(data?.schedules) ? data.schedules : []
        meta = data?.meta || {}
      }
      schedules.value = items.map(s => {
        const shift = shiftMap.value[s.shiftId]
        return {
          ...s,
          date: dayjs(s.date).format('YYYY/MM/DD'),
          shiftName: formatShiftLabel(shift) || s.shiftName || ''
        }
      })
      applyEmployeeMeta(meta, currentEmployeeId.value)
    }
  } catch (err) {
    console.error(err)
  }
}

onMounted(loadSchedules)

watch(selectedMonth, loadSchedules)

async function submitResponse(responseType) {
  if (!currentEmployeeId.value) return
  isSubmitting.value = true
  try {
    const payload = {
      month: selectedMonth.value,
      response: responseType,
    }
    if (responseType === 'disputed') {
      payload.note = responseNote.value.trim()
    }
    const res = await apiFetch('/api/schedules/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const result = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(result?.error || '送出失敗')
    }
    if (responseType === 'confirmed') {
      ElMessage.success?.('已確認班表')
    } else {
      ElMessage.success?.('已送出異議')
    }
    await loadSchedules()
  } catch (err) {
    ElMessage.error?.(err?.message || '送出失敗')
  } finally {
    isSubmitting.value = false
  }
}

async function handleConfirm() {
  if (isSubmitting.value) return
  try {
    await ElMessageBox.confirm(
      '確認本月班表無誤，是否送出確認？',
      '確認班表',
      {
        type: 'success',
        confirmButtonText: '確認',
        cancelButtonText: '取消',
      }
    )
  } catch (err) {
    return
  }
  responseNote.value = ''
  await submitResponse('confirmed')
}

async function handleDispute() {
  if (isSubmitting.value) return
  if (!responseNote.value.trim()) {
    ElMessage.warning?.('請先輸入異議原因')
    return
  }
  try {
    await ElMessageBox.confirm(
      '確定要提交異議嗎？',
      '提出異議',
      {
        type: 'warning',
        confirmButtonText: '送出',
        cancelButtonText: '取消',
      }
    )
  } catch (err) {
    return
  }
  await submitResponse('disputed')
}
</script>

<style scoped>
.my-schedule {
  padding: 20px;
}

.status-card {
  margin-bottom: 20px;
  padding: 20px;
  border-radius: 16px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(14, 165, 233, 0.08) 100%);
  border: 1px solid rgba(14, 165, 233, 0.2);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.status-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;

  h2 {
    margin: 0;
    font-size: 1.25rem;
    color: #0f172a;
  }
}

.status-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  color: #0f172a;
  font-weight: 600;
}

.status-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.response-note {
  ::v-deep(textarea) {
    border-radius: 12px;
  }
}

.dispute-note {
  margin: 0;
  font-size: 0.9rem;
  color: #b91c1c;
}

.hint {
  margin: 0;
  font-size: 0.85rem;
  color: #475569;
}

.schedule-table {
  width: 100%;
}
</style>
