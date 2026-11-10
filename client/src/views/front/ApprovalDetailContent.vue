<!-- src/views/front/ApprovalDetailContent.vue：申請單明細的內容（表單、申請人、狀態、填寫內容、申請人餘額、流程、簽核紀錄）。
     簽核頁的「申請單明細」與排班頁的「相關簽核」共用：
     - 傳 approvalId：元件自己向伺服器取明細（排班頁）
     - 傳 doc：直接顯示已經取好的單據（簽核頁，取明細與按鈕權限都在頁面上處理）
     手機寬度時，流程與簽核紀錄改成一行一筆的清單，不用橫向捲動的表格。 -->
<template>
  <div v-loading="loading" class="approval-detail">
    <div v-if="error" class="detail-error">{{ error }}</div>
    <div v-else-if="current">
      <div class="detail-head">
        <div class="detail-head__title">
          <span class="detail-head__form">{{ current.form?.name || '（表單已刪除）' }}</span>
          <span v-if="current.form?.category" class="detail-head__category">{{ current.form.category }}</span>
        </div>
        <el-tag :type="getStatusTagType(current.status)" data-test="detail-status">{{ getStatusText(current.status) }}</el-tag>
      </div>
      <p class="mb-2 person-line applicant-line">
        <EmployeeAvatar :employee="personOf(current.applicant_employee)" :size="24" class="applicant-avatar" />
        <span>{{ current.applicant_employee?.name || '-' }}</span>
        <span v-if="current.createdAt" class="detail-head__time">{{ fmt(current.createdAt) }} 送出</span>
      </p>
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

      <el-divider content-position="left">填寫內容</el-divider>
      <el-descriptions :column="1" size="small" border class="detail-fields">
        <el-descriptions-item v-for="fld in fieldList" :key="fld._id" :label="fld.label">
          <div v-if="attachmentItems(current.form_data?.[fld._id]).length" class="attachment-list">
            <el-link
              v-for="file in attachmentItems(current.form_data?.[fld._id])"
              :key="file.url || file.path || file.name"
              href="#"
              type="primary"
              @click.prevent="downloadAttachment(file)"
            >
              {{ attachmentDisplayName(file) }}
            </el-link>
          </div>
          <span v-else class="detail-value">{{ renderValue(current.form_data?.[fld._id], fld) }}</span>
        </el-descriptions-item>
      </el-descriptions>
      <p v-if="!fieldList.length" class="detail-empty">這張申請單沒有填寫內容</p>

      <!-- 申請人所有假別的剩餘時數：預設只顯示「這張單核准前後剩多少」，完整的表格按「展開」才出現 -->
      <LeaveBalancePanel
        v-if="current.leave_balances && typeof current.leave_balances === 'object'"
        :balances="current.leave_balances"
        title="申請人假別餘額"
        collapsible
        class="detail-balances"
      />
      <el-alert
        v-else-if="current.form?.semanticType === 'leave' && current.leave_balance"
        type="info"
        :closable="false"
        class="leave-balance-alert detail-balances"
      >
        <template #title>
          特休餘額：已使用 {{ current.leave_balance.usedHours ?? current.leave_balance.usedDays }} 小時／剩餘 {{ current.leave_balance.remainingHours ?? current.leave_balance.remainingDays }} 小時（年度總時數 {{ current.leave_balance.totalHours ?? current.leave_balance.totalDays }} 小時）
        </template>
      </el-alert>

      <el-divider content-position="left">流程</el-divider>
      <el-timeline class="detail-steps">
        <el-timeline-item
          v-for="(step, idx) in steps"
          :key="idx"
          :timestamp="requestStepTitle(step, idx)"
          :type="stepType(idx)"
          :hollow="!isCurrentStep(idx)"
          placement="top"
        >
          <!-- 只有一位簽核人時不必說明「需全員同意／任一位即可」 -->
          <div v-if="isCurrentStep(idx) || approversOf(step).length > 1 || step.is_required === false" class="step-meta">
            <el-tag v-if="isCurrentStep(idx)" size="small" type="warning" effect="plain" data-test="step-current">目前關卡</el-tag>
            <span v-if="approversOf(step).length > 1">{{ step.all_must_approve ? '需全員同意' : '任一位核可即可' }}</span>
            <span v-if="step.is_required === false">選填關卡</span>
          </div>
          <!-- 主管鏈往上找時略過離職、留職停薪的主管等說明 -->
          <p v-if="requestStepNote(step)" class="step-note" data-test="step-note">{{ requestStepNote(step) }}</p>
          <!-- 主管關卡找不到可簽核的主管時改由最高層簽核人簽核：說明改送的原因 -->
          <p v-if="describeFallbackStep(step)" class="step-fallback" data-test="step-fallback">{{ describeFallbackStep(step) }}</p>

          <ul v-if="isMobile" class="approver-list" data-test="approver-list">
            <li v-for="(row, rowIdx) in approversOf(step)" :key="rowIdx" class="approver-item">
              <div class="person-line applicant-info">
                <EmployeeAvatar :employee="personOf(row.approver, approverName(row.approver))" :size="24" class="applicant-avatar" />
                <span class="approver-item__name">{{ approverName(row.approver) }}</span>
                <el-tag size="small" :type="decisionTagType(row)" effect="plain">{{ decisionText(row) }}</el-tag>
              </div>
              <div v-if="row.decided_at" class="approver-item__meta">{{ fmt(row.decided_at) }}</div>
              <div v-if="row.comment" class="approver-item__comment">{{ row.comment }}</div>
            </li>
          </ul>
          <el-table v-else :data="approversOf(step)" size="small" border>
            <el-table-column label="審核人" min-width="150">
              <template #default="{ row }">
                <div class="person-line applicant-info">
                  <EmployeeAvatar :employee="personOf(row.approver, approverName(row.approver))" :size="24" class="applicant-avatar" />
                  <span>{{ approverName(row.approver) }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="決議" width="140">
              <template #default="{ row }">
                <el-tag size="small" :type="decisionTagType(row)" effect="plain">{{ decisionText(row) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="時間" width="150">
              <template #default="{ row }">
                {{ fmt(row.decided_at) }}
              </template>
            </el-table-column>
            <el-table-column prop="comment" label="意見" min-width="140" />
          </el-table>
        </el-timeline-item>
      </el-timeline>
      <p v-if="!steps.length" class="detail-empty">這張申請單沒有簽核關卡</p>

      <template v-if="logRows.length">
        <el-divider content-position="left">簽核紀錄</el-divider>
        <ul v-if="isMobile" class="detail-logs log-list">
          <li v-for="row in logRows" :key="row.key" class="log-item">
            <div class="log-item__head">
              <span class="log-item__action">{{ row.action }}</span>
              <span class="log-item__time">{{ row.time }}</span>
            </div>
            <div class="log-item__body">
              <span class="log-item__actor">{{ row.actor }}</span>
              <span v-if="row.message">：{{ row.message }}</span>
            </div>
          </li>
        </ul>
        <el-table v-else :data="logRows" size="small" border class="detail-logs">
          <el-table-column prop="time" label="時間" width="150" />
          <el-table-column prop="actor" label="處理人" width="150">
            <template #default="{ row }">
              <div v-if="row.actorPerson" class="person-line applicant-info">
                <EmployeeAvatar :employee="personOf(row.actorPerson)" :size="22" class="applicant-avatar" />
                <span>{{ row.actor }}</span>
              </div>
              <span v-else>{{ row.actor }}</span>
            </template>
          </el-table-column>
          <el-table-column prop="action" label="動作" width="130" />
          <el-table-column prop="message" label="說明" min-width="160" />
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
import { describeFallbackStep, isLeaveForm, isLeaveHoursField } from '../../utils/approvalForm'
import { formatHoursWithDays } from '../../utils/leaveBalance'
import { useIsMobile } from '../../utils/useIsMobile'
import {
  attachmentDisplayName,
  attachmentItems,
  buildLogRows,
  detailFields,
  downloadApprovalAttachment,
  findReturnInfo,
  getStatusTagType,
  getStatusText,
  requestStepNote,
  requestStepTitle
} from '../../utils/approvalDetail'

const props = defineProps({
  // 申請單編號：元件自己向伺服器取明細（有傳 doc 時不用）
  approvalId: {
    type: String,
    default: ''
  },
  // 已經取好的單據（簽核頁）：傳了就直接顯示，不再向伺服器取
  doc: {
    type: Object,
    default: null
  },
  // 以下三個都是選用，由已經有員工／部門／機構資料的頁面提供，省掉重複的查詢：
  // 把申請人、審核人（物件或只有編號）轉成頭像要用的員工物件
  personResolver: {
    type: Function,
    default: null
  },
  // 員工編號 -> 姓名
  nameResolver: {
    type: Function,
    default: null
  },
  // 欄位值的名稱對照 { user(id), department(id), org(id) }；沒傳時元件需要時才向伺服器取
  valueLookups: {
    type: Object,
    default: null
  },
  // 下載附件的處理（傳入附件物件）；沒傳時元件自己下載並以訊息提示失敗原因
  downloadHandler: {
    type: Function,
    default: null
  }
})

const isMobile = useIsMobile()
const loading = ref(false)
const error = ref('')
const fetchedDoc = ref(null)
const employeeNameCache = ref({})
// 員工 / 部門 / 機構欄位存的是編號，需要時才向伺服器取名稱對照
const lookupNames = ref({ user: {}, department: {}, org: {} })
let activeRequestController = null
// 每次載入遞增；只有最新一次的請求可以更新畫面或收尾（避免被取消的舊請求把 loading 關掉）
let requestToken = 0

// 目前顯示的單據：頁面傳進來的優先，否則是自己取回來的
const current = computed(() => props.doc || fetchedDoc.value)
const steps = computed(() => (Array.isArray(current.value?.steps) ? current.value.steps : []))
const approversOf = step => (Array.isArray(step?.approvers) ? step.approvers : [])

const fmt = d => formatTaipeiDateTime(d)
const externalLookup = (kind, id) => (typeof props.valueLookups?.[kind] === 'function' ? props.valueLookups[kind](id) : '')
const valueLookups = {
  user: id => externalLookup('user', id) || lookupNames.value.user[id] || employeeNameCache.value[id],
  department: id => externalLookup('department', id) || lookupNames.value.department[id],
  org: id => externalLookup('org', id) || lookupNames.value.org[id]
}
// 請假單的時數旁補上天數（1 天 = 8 小時）：8 -> 「8 小時（1 天）」、4 -> 「4 小時」
const isLeaveDoc = computed(() => isLeaveForm(current.value?.form))
const renderValue = (value, field) => {
  if (isLeaveDoc.value && isLeaveHoursField(field) && Number.isFinite(Number(value)) && value !== '' && value !== null && !Array.isArray(value)) {
    return formatHoursWithDays(Number(value))
  }
  return formatFormValue(field, value, { lookups: valueLookups })
}
const nameOfEmployee = id => (
  employeeNameCache.value[id] || (props.nameResolver ? props.nameResolver(id) : '') || lookupNames.value.user[id] || ''
)

const fieldList = computed(() => (current.value ? detailFields(current.value) : []))
const logRows = computed(() => (current.value ? buildLogRows(current.value, nameOfEmployee) : []))
const returnInfo = computed(() => (current.value ? findReturnInfo(current.value, nameOfEmployee) : null))

// 審核人的決議：單據已經不在簽核中（撤回、否決、被退簽…）時，還沒簽的人不是「待簽核」而是「未簽核」
const isUnsignedAfterEnd = row => row?.decision === 'pending' && current.value?.status !== 'pending'
const decisionText = row => (isUnsignedAfterEnd(row) ? '未簽核' : getStatusText(row?.decision))
const decisionTagType = row => (isUnsignedAfterEnd(row) ? 'info' : getStatusTagType(row?.decision))

// 進行中的單據才有「目前關卡」；已結束的單（核可、否決、撤回）每一關都是過去式
const isCurrentStep = idx => current.value?.status === 'pending' && idx === current.value?.current_step_index
const stepType = idx => (isCurrentStep(idx) ? 'primary' : 'info')

const downloadAttachment = async file => {
  if (props.downloadHandler) {
    await props.downloadHandler(file)
    return
  }
  try {
    await downloadApprovalAttachment(current.value?._id, file)
  } catch (err) {
    ElMessage.error(`附件下載失敗：${describeError(err).message}`)
  }
}

// 申請人 / 審核人可能是已展開的員工物件（含 _id、name、photo），也可能只是編號字串；頭像元件只接受物件
const personOf = (value, fallbackName = '') => {
  if (props.personResolver) return props.personResolver(value, fallbackName)
  if (value && typeof value === 'object') return value
  return { _id: value ? String(value) : '', name: fallbackName }
}

const approverName = emp => {
  if (emp && typeof emp === 'object') {
    const id = emp._id || emp.employeeId || ''
    return personNameOrFallback(emp.name || nameOfEmployee(id), id)
  }
  return personNameOrFallback(nameOfEmployee(emp), emp)
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

// 單據上已經帶姓名的審核人先記下來（簽核紀錄的處理人只有編號時用它找姓名）
const rememberApproverNames = data => {
  const cache = {}
  const list = Array.isArray(data?.steps) ? data.steps : []
  list.forEach(step => {
    approversOf(step).forEach(item => {
      const approver = item?.approver
      if (approver?._id && approver?.name) {
        cache[approver._id] = approver.name
      }
    })
  })
  employeeNameCache.value = cache
}

const loadDetail = async id => {
  requestToken += 1
  const token = requestToken
  abortActiveRequest()
  fetchedDoc.value = null
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
    fetchedDoc.value = data
    rememberApproverNames(data)
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

// 頁面直接給單據：不取明細；頁面沒有提供名稱對照時才自己查
const showGivenDoc = data => {
  requestToken += 1
  const token = requestToken
  abortActiveRequest()
  loading.value = false
  error.value = ''
  fetchedDoc.value = null
  lookupNames.value = { user: {}, department: {}, org: {} }
  rememberApproverNames(data)
  if (data && !props.valueLookups) loadLookups(data, token)
}

watch(
  () => [props.approvalId, props.doc],
  ([id, given]) => {
    if (given) showGivenDoc(given)
    else loadDetail(id)
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

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.detail-head__title {
  min-width: 0;
}

.detail-head__form {
  font-size: 16px;
  font-weight: 600;
  color: var(--hr-gray-900, #0f172a);
}

.detail-head__category {
  margin-left: 8px;
  font-size: 13px;
  color: var(--hr-gray-500, #64748b);
}

.detail-head__time {
  margin-left: auto;
  font-size: 12px;
  color: var(--hr-gray-500, #64748b);
}

.mb-2 {
  margin-bottom: 8px;
}

.detail-value {
  white-space: pre-wrap;
  word-break: break-word;
}

.detail-empty {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--hr-gray-500, #64748b);
}

.detail-balances {
  margin-top: 12px;
}

.step-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  color: var(--hr-gray-500, #64748b);
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

.step-note {
  margin: 0 0 6px;
  color: #475569;
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

/* 手機：審核人與簽核紀錄的清單 */
.approver-list,
.log-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.approver-item {
  padding: 6px 0;
  border-top: 1px solid var(--hr-gray-200, #e2e8f0);
}

.approver-item:first-child {
  border-top: none;
}

.approver-item__name {
  flex: 1 1 auto;
  min-width: 0;
}

.approver-item__meta,
.approver-item__comment {
  margin: 2px 0 0 32px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--hr-gray-500, #64748b);
}

.approver-item__comment {
  color: var(--hr-gray-700, #334155);
  white-space: pre-wrap;
  word-break: break-word;
}

.log-item {
  padding: 6px 0;
  border-top: 1px solid var(--hr-gray-200, #e2e8f0);
  font-size: 13px;
  line-height: 1.5;
}

.log-item:first-child {
  border-top: none;
}

.log-item__head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.log-item__action {
  font-weight: 600;
}

.log-item__time {
  font-size: 12px;
  color: var(--hr-gray-500, #64748b);
}

.log-item__body {
  color: var(--hr-gray-600, #475569);
  word-break: break-word;
}

@media (max-width: 767px) {
  .detail-steps {
    padding-left: 0;
  }

  .detail-fields :deep(.el-descriptions__label) {
    width: 96px;
  }
}
</style>
