<template>
  <div v-loading="loading">
    <div v-if="error" class="detail-error">{{ error }}</div>
    <div v-else-if="doc">
      <p class="mb-2">
        <b>表單：</b>{{ doc.form?.name }}（{{ doc.form?.category }}）
      </p>
      <p class="mb-2 person-line">
        <b>申請人：</b>
        <EmployeeAvatar :employee="personOf(doc.applicant_employee)" :size="24" />
        <span>{{ doc.applicant_employee?.name || '-' }}</span>
      </p>
      <p class="mb-2"><b>狀態：</b>{{ getStatusText(doc.status) }}</p>
      <el-alert
        v-if="returnInfo"
        type="warning"
        :closable="false"
        show-icon
        class="return-reason-alert mb-2"
      >
        <template #title>
          被退簽{{ returnInfo.by ? `（${returnInfo.by}）` : '' }}：{{ returnInfo.message || '簽核人未填寫原因' }}
        </template>
      </el-alert>
      <!-- 申請人所有假別的剩餘時數，並標出這張單核准前後的差別 -->
      <LeaveBalancePanel
        v-if="doc.leave_balances && typeof doc.leave_balances === 'object'"
        :balances="doc.leave_balances"
        title="申請人假別餘額"
        class="mb-2"
      />
      <el-alert
        v-else-if="doc.form?.semanticType === 'leave' && doc.leave_balance"
        type="info"
        :closable="false"
        class="leave-balance-alert mb-2"
      >
        <template #title>
          特休餘額：已使用 {{ doc.leave_balance.usedHours ?? doc.leave_balance.usedDays }} 小時／剩餘 {{ doc.leave_balance.remainingHours ?? doc.leave_balance.remainingDays }} 小時（年度總時數 {{ doc.leave_balance.totalHours ?? doc.leave_balance.totalDays }} 小時）
        </template>
      </el-alert>

      <el-divider content-position="left">填寫內容</el-divider>
      <el-descriptions :column="1" size="small" border>
        <el-descriptions-item v-for="fld in fieldList" :key="fld._id" :label="fld.label">
          <div v-if="attachmentItems(doc.form_data?.[fld._id]).length" class="attachment-list">
            <el-link
              v-for="file in attachmentItems(doc.form_data?.[fld._id])"
              :key="file.url || file.path || file.name"
              href="#"
              type="primary"
              @click.prevent="downloadAttachment(file)"
            >
              {{ attachmentDisplayName(file) }}
            </el-link>
          </div>
          <span v-else>{{ renderValue(doc.form_data?.[fld._id], fld) }}</span>
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
          <!-- 主管關卡找不到可簽核的主管時改由最高層簽核人簽核：說明改送的原因 -->
          <p v-if="describeFallbackStep(step)" class="step-fallback" data-test="step-fallback">{{ describeFallbackStep(step) }}</p>
          <el-table :data="Array.isArray(step.approvers) ? step.approvers : []" size="small" border>
            <el-table-column label="審核人" width="200">
              <template #default="{ row }">
                <div class="person-line">
                  <EmployeeAvatar :employee="personOf(row.approver, approverName(row.approver))" :size="24" />
                  <span>{{ approverName(row.approver) }}</span>
                </div>
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

      <template v-if="logRows.length">
        <el-divider content-position="left">簽核紀錄</el-divider>
        <el-table :data="logRows" size="small" border class="detail-logs">
          <el-table-column prop="time" label="時間" width="160" />
          <el-table-column prop="actor" label="處理人" width="150">
            <template #default="{ row }">
              <div v-if="row.actorPerson" class="person-line">
                <EmployeeAvatar :employee="personOf(row.actorPerson)" :size="22" />
                <span>{{ row.actor }}</span>
              </div>
              <span v-else>{{ row.actor }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="action" label="動作" width="130" />
          <el-table-column prop="message" label="說明" />
        </el-table>
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../../api'
import EmployeeAvatar from '../../components/EmployeeAvatar.vue'
import LeaveBalancePanel from '../../components/LeaveBalancePanel.vue'
import { formatFormValue, formatTaipeiDateTime, personNameOrFallback } from '../../utils/approvalDisplay'
import { describeError, readApiError } from '../../utils/approvalErrors'
import { describeFallbackStep } from '../../utils/approvalForm'
import {
  attachmentDisplayName,
  attachmentItems,
  buildLogRows,
  detailFields,
  downloadApprovalAttachment,
  findReturnInfo,
  getStatusText
} from '../../utils/approvalDetail'

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
// 員工 / 部門 / 機構欄位存的是編號，需要時才向伺服器取名稱對照
const lookupNames = ref({ user: {}, department: {}, org: {} })
let activeRequestController = null
// 每次載入遞增；只有最新一次的請求可以更新畫面或收尾（避免被取消的舊請求把 loading 關掉）
let requestToken = 0

const fmt = d => formatTaipeiDateTime(d)
const valueLookups = {
  user: id => lookupNames.value.user[id] || employeeNameCache.value[id],
  department: id => lookupNames.value.department[id],
  org: id => lookupNames.value.org[id]
}
const renderValue = (value, field) => formatFormValue(field, value, { lookups: valueLookups })
const nameOfEmployee = id => employeeNameCache.value[id] || lookupNames.value.user[id] || ''

const fieldList = computed(() => (doc.value ? detailFields(doc.value) : []))
const logRows = computed(() => (doc.value ? buildLogRows(doc.value, nameOfEmployee) : []))
const returnInfo = computed(() => (doc.value ? findReturnInfo(doc.value, nameOfEmployee) : null))

const downloadAttachment = async file => {
  try {
    await downloadApprovalAttachment(doc.value?._id, file)
  } catch (err) {
    ElMessage.error(`附件下載失敗：${describeError(err).message}`)
  }
}

// 申請人 / 審核人可能是已展開的員工物件（含 _id、name、photo），也可能只是編號字串；頭像元件只接受物件
const personOf = (value, fallbackName = '') => {
  if (value && typeof value === 'object') return value
  return { _id: value ? String(value) : '', name: fallbackName }
}

const approverName = emp => {
  if (emp && typeof emp === 'object') {
    const id = emp._id || emp.employeeId || ''
    return personNameOrFallback(emp.name || employeeNameCache.value[id], id)
  }
  return personNameOrFallback(employeeNameCache.value[emp], emp)
}

const abortActiveRequest = () => {
  if (activeRequestController) {
    activeRequestController.abort()
    activeRequestController = null
  }
}

const fetchNameMap = async (path, pickId) => {
  try {
    const res = await apiFetch(path)
    if (!res.ok) return {}
    const list = await res.json()
    const map = {}
    ;(Array.isArray(list) ? list : []).forEach(item => {
      const id = pickId(item)
      if (id) map[id] = item.name
    })
    return map
  } catch {
    return {}
  }
}

const loadLookups = async (data, token) => {
  const fields = Array.isArray(data?.form?.fields) ? data.form.fields : []
  const used = type => fields.some(
    field => field.type_1 === type && data.form_data?.[field._id] != null && data.form_data[field._id] !== ''
  )
  const [user, department, org] = await Promise.all([
    used('user') ? fetchNameMap('/api/employees/options', e => e.id || e._id) : {},
    used('department') ? fetchNameMap('/api/departments', d => d._id || d.code || d.name) : {},
    used('org') ? fetchNameMap('/api/organizations', o => o._id || o.code || o.name) : {}
  ])
  if (token !== requestToken) return
  lookupNames.value = { user, department, org }
}

const loadDetail = async id => {
  requestToken += 1
  const token = requestToken
  abortActiveRequest()
  doc.value = null
  error.value = ''
  employeeNameCache.value = {}
  lookupNames.value = { user: {}, department: {}, org: {} }
  if (!id) {
    loading.value = false
    return
  }
  loading.value = true
  const controller = new AbortController()
  activeRequestController = controller
  try {
    const res = await apiFetch(`/api/approvals/${id}`, { signal: controller.signal })
    if (token !== requestToken) return
    if (!res.ok) {
      const apiError = await readApiError(res)
      if (token !== requestToken) return
      error.value = `取得審批明細失敗：${apiError.message}`
      return
    }
    const data = await res.json()
    if (token !== requestToken) return
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
    // 名稱對照在背景載入，畫面先顯示內容
    loadLookups(data, token)
  } catch (err) {
    if (token === requestToken && err?.name !== 'AbortError') {
      error.value = `取得審批明細失敗：${describeError(err).message}`
    }
  } finally {
    if (token === requestToken) {
      loading.value = false
      activeRequestController = null
    }
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
  requestToken += 1
  abortActiveRequest()
})
</script>

<style scoped>
.detail-error {
  color: #dc2626;
}

.step-fallback {
  margin: 0 0 6px;
  padding: 4px 8px;
  border-radius: 4px;
  background: #fdf6ec;
  color: #b88230;
  font-size: 12px;
  line-height: 1.6;
}

.person-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.attachment-list {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
</style>
