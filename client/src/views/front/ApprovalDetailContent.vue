<template>
  <div v-loading="loading">
    <div v-if="error" class="detail-error">{{ error }}</div>
    <div v-else-if="doc">
      <p class="mb-2">
        <b>表單：</b>{{ doc.form?.name }}（{{ doc.form?.category }}）
      </p>
      <p class="mb-2">
        <b>申請人：</b>{{ doc.applicant_employee?.name || '-' }}
      </p>
      <p class="mb-2"><b>狀態：</b>{{ getStatusText(doc.status) }}</p>

      <el-divider content-position="left">填寫內容</el-divider>
      <el-descriptions :column="1" size="small" border>
        <el-descriptions-item v-for="fld in doc.form?.fields || []" :key="fld._id" :label="fld.label">
          <span>{{ renderValue(doc.form_data?.[fld._id]) }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">流程</el-divider>
      <el-timeline>
        <el-timeline-item
          v-for="(step, idx) in doc.steps || []"
          :key="idx"
          :timestamp="`第 ${idx + 1} 關`"
          :type="idx === doc.current_step_index ? 'primary' : 'info'"
        >
          <div class="mb-1">
            <span class="mr-2">需全員同意：{{ step.all_must_approve ? '是' : '否' }}</span>
            <span>必簽：{{ step.is_required ? '是' : '否' }}</span>
          </div>
          <el-table :data="step.approvers || []" size="small" border>
            <el-table-column label="審核人" width="200">
              <template #default="{ row }">
                {{ approverName(row.approver) }}
              </template>
            </el-table-column>
            <el-table-column label="決議" width="120">
              <template #default="{ row }">
                {{ getStatusText(row.decision) }}
              </template>
            </el-table-column>
            <el-table-column label="時間" width="200">
              <template #default="{ row }">
                {{ fmt(row.decided_at) }}
              </template>
            </el-table-column>
            <el-table-column prop="comment" label="意見" />
          </el-table>
        </el-timeline-item>
      </el-timeline>
    </div>
  </div>
</template>

<script setup>
import { onBeforeUnmount, ref, watch } from 'vue'
import { apiFetch } from '../../api'

const props = defineProps({
  approvalId: {
    type: String,
    default: ''
  }
})

const loading = ref(false)
const error = ref('')
const doc = ref(null)
const employeeNameCache = ref({})
let activeRequestController = null

const fmt = d => (d ? new Date(d).toLocaleString() : '-')
const renderValue = v => (Array.isArray(v) ? v.join(', ') : v ?? '-')

const getStatusText = status => {
  const map = {
    pending: '待簽核',
    approved: '已核可',
    rejected: '已否決',
    returned: '已退簽'
  }
  return map[status] || status || '-'
}

const approverName = emp => {
  if (emp && typeof emp === 'object') {
    const id = emp._id || emp.employeeId || ''
    return emp.name || employeeNameCache.value[id] || id
  }
  return employeeNameCache.value[emp] || emp || '-'
}

const clearLocalRefs = () => {
  doc.value = null
  error.value = ''
  employeeNameCache.value = {}
  if (activeRequestController) {
    activeRequestController.abort()
    activeRequestController = null
  }
}

const loadDetail = async id => {
  clearLocalRefs()
  if (!id) return
  loading.value = true
  try {
    activeRequestController = new AbortController()
    const res = await apiFetch(`/api/approvals/${id}`, {
      signal: activeRequestController.signal
    })
    if (!res.ok) {
      error.value = '取得審批明細失敗'
      return
    }
    const data = await res.json()
    doc.value = data
    const cache = {}
    const steps = Array.isArray(data?.steps) ? data.steps : []
    steps.forEach(step => {
      const approvers = Array.isArray(step?.approvers) ? step.approvers : []
      approvers.forEach(item => {
        const approver = item?.approver
        if (approver?._id && approver?.name) {
          cache[approver._id] = approver.name
        }
      })
    })
    employeeNameCache.value = cache
  } catch (err) {
    if (err?.name !== 'AbortError') {
      error.value = '取得審批明細失敗'
    }
  } finally {
    loading.value = false
    activeRequestController = null
  }
}

watch(
  () => props.approvalId,
  id => {
    loadDetail(id)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  clearLocalRefs()
})
</script>

<style scoped>
.detail-error {
  color: #dc2626;
}
</style>
