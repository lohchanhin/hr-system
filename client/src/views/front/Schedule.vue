<template>
  <div class="schedule-page">
    <!-- Modern header with better typography and spacing -->
    <div class="page-header">
      <h1 class="page-title">排班管理</h1>
      <p class="page-subtitle">管理員工排班與班表預覽</p>
    </div>

    <ScheduleDashboard :summary="summary" />

    <!-- Enhanced filters section with card design -->
    <div class="filters-card">
      <div class="filters-header">
        <h3 class="filters-title">篩選條件</h3>
      </div>
      <div class="filters-content">
        <div class="filter-group">
          <label class="filter-label">選擇月份</label>
          <el-date-picker
            v-model="currentMonth"
            type="month"
            value-format="YYYY-MM"
            @change="onMonthChange"
            class="modern-date-picker"
          />
        </div>
        <div class="filter-group">
          <label class="filter-label">部門</label>
          <el-select
            v-model="selectedDepartment"
            placeholder="請選擇部門"
            @change="onDepartmentChange"
            :disabled="true"
            class="modern-select"
          >
            <el-option
              v-for="dept in departments"
              :key="dept._id"
              :label="dept.name"
              :value="dept._id"
            />
          </el-select>
        </div>
        <div class="filter-group">
          <label class="filter-label">單位</label>
          <el-select
            v-model="selectedSubDepartment"
            placeholder="請選擇單位"
            @change="onSubDepartmentChange"
            class="modern-select"
          >
            <el-option
              v-for="sub in filteredSubDepartments"
              :key="sub._id"
              :label="sub.name"
              :value="sub._id"
            />
          </el-select>
        </div>
        <div v-if="showIncludeSelfToggle" class="filter-group include-self-group">
          <label class="filter-label">包含自己</label>
          <el-switch
            v-model="includeSelf"
            active-text="是"
            inactive-text="否"
            inline-prompt
          />
        </div>
      </div>
    </div>

    <div v-if="canEdit" class="publish-card">
      <div class="publish-header">
        <div class="publish-header-text">
          <h3 class="publish-title">發布狀態</h3>
          <p class="publish-subtitle">追蹤班表送審、回覆與鎖定流程</p>
        </div>
        <span
          class="status-badge"
          :class="`status-${publishSummary.status}`"
          data-test="publish-status-badge"
        >
          {{ publishStatusLabel }}
        </span>
      </div>

      <div class="publish-progress" data-test="publish-steps">
        <el-steps :active="publishStepIndex" finish-status="success" align-center>
          <el-step title="草稿" description="建立班表草稿" :status="stepStatuses.draft" />
          <el-step
            title="待確認"
            :description="pendingStepDescription"
            :status="stepStatuses.pending"
          />
          <el-step
            title="異議"
            :description="disputeStepDescription"
            :status="stepStatuses.disputed"
          />
          <el-step
            title="完成"
            :description="finalStepDescription"
            :status="stepStatuses.finalized"
          />
        </el-steps>
      </div>

      <div class="publish-meta-row">
        <p class="publish-meta" v-if="publishSummary.publishedAt" data-test="publish-meta">
          最近發布：{{ formatPublishDate(publishSummary.publishedAt) }}
        </p>
        <p class="publish-meta" v-else data-test="publish-meta">本月尚未發布。</p>
        <div
          v-if="publishProgress > 0 && publishSummary.status !== 'finalized'"
          class="publish-progress-indicator"
        >
          <el-progress
            :percentage="publishProgress"
            :stroke-width="8"
            status="success"
            :show-text="false"
          />
          <span class="progress-label">{{ publishProgress }}% 完成</span>
        </div>
      </div>

      <div class="publish-actions">
        <el-button
          type="primary"
          class="publish-btn"
          :loading="isPublishing"
          :disabled="publishDisabled"
          @click="confirmPublish"
        >
          發送待確認
        </el-button>
        <el-button
          type="success"
          plain
          class="publish-btn"
          :loading="isFinalizing"
          :disabled="finalizeDisabled"
          @click="confirmFinalize"
        >
          完成發布
        </el-button>
      </div>

      <div class="publish-stats">
        <div
          v-if="pendingCount"
          class="status-card pending"
          data-test="pending-card"
        >
          <div class="card-header">
            <span class="card-title">待回覆</span>
            <span class="card-badge">{{ pendingCount }}</span>
          </div>
          <ul class="card-list">
            <li
              v-for="emp in publishSummary.pendingEmployees"
              :key="emp.id"
              class="card-item"
            >
              <span class="card-name">{{ emp.name }}</span>
              <span class="card-count">{{ emp.pendingCount }} 筆</span>
            </li>
          </ul>
        </div>

        <div
          v-if="disputedCount"
          class="status-card disputed"
          data-test="disputed-card"
        >
          <div class="card-header">
            <span class="card-title">異議</span>
            <span class="card-badge">{{ disputedCount }}</span>
          </div>
          <ul class="card-list">
            <li
              v-for="emp in publishSummary.disputedEmployees"
              :key="emp.id"
              class="card-item"
            >
              <div class="card-item-main">
                <span class="card-name">{{ emp.name }}</span>
                <span class="card-count">{{ emp.disputedCount }} 筆</span>
              </div>
              <div v-if="emp.latestNote" class="card-note">
                最新意見：{{ emp.latestNote }}
              </div>
            </li>
          </ul>
        </div>

        <div
          v-if="!pendingCount && !disputedCount && publishSummary.status !== 'draft' && publishSummary.status !== 'finalized'"
          class="status-card ready"
          data-test="ready-card"
        >
          <div class="card-header">
            <span class="card-title">回覆完成</span>
            <span class="card-badge success">✓</span>
          </div>
          <p class="card-message">所有員工已完成回覆，可執行最終發布。</p>
        </div>

        <div
          v-if="publishSummary.status === 'finalized'"
          class="status-card finalized"
          data-test="finalized-card"
        >
          <div class="card-header">
            <span class="card-title">已鎖定</span>
            <span class="card-badge success">100%</span>
          </div>
          <p class="card-message">班表已完成發布並鎖定。</p>
        </div>
      </div>
    </div>

    <!-- Enhanced actions section with modern button design -->
    <div class="actions-card">
      <div class="primary-actions">
        <el-button
          type="primary"
          class="action-btn primary"
          @click="clearSelection"
          :disabled="!hasAnySelection"
        >
          <i class="el-icon-close"></i>
          清除選取
        </el-button>
        <el-button
          type="primary"
          class="action-btn primary"
          plain
          @click="selectAllEmployees"
          :disabled="!employees.length"
        >
          <i class="el-icon-user"></i>
          全選員工
        </el-button>
        <el-button
          type="primary"
          class="action-btn primary"
          plain
          @click="selectAllDays"
          :disabled="!days.length"
        >
          <i class="el-icon-date"></i>
          全選日期
        </el-button>
      </div>
      <div class="secondary-actions">
        <div class="range-picker-wrapper">
          <label class="range-label">自訂日期範圍</label>
          <el-date-picker
            v-model="customRange"
            type="daterange"
            start-placeholder="開始日期"
            end-placeholder="結束日期"
            range-separator="至"
            unlink-panels
            :disabled="!days.length"
            class="modern-date-picker range-picker"
            @change="onCustomRangeChange"
          />
        </div>
        <el-button @click="preview('week')" class="action-btn secondary">
          <i class="el-icon-calendar"></i>
          預覽週表
        </el-button>
        <el-button @click="preview('month')" class="action-btn secondary">
          <i class="el-icon-date"></i>
          預覽月表
        </el-button>
        <el-button @click="() => exportSchedules('pdf')" class="action-btn export">
          <i class="el-icon-download"></i>
          匯出 PDF
        </el-button>
        <el-button @click="() => exportSchedules('excel')" class="action-btn export">
          <i class="el-icon-s-grid"></i>
          匯出 Excel
        </el-button>
      </div>
    </div>

    <!-- Enhanced schedule table with modern design -->
    <div class="schedule-card">
      <div class="schedule-header">
        <h3 class="schedule-title">員工排班表</h3>
        <div class="schedule-legend" data-test="schedule-legend">
          <template v-if="legendShifts.length">
            <span
              v-for="legend in legendShifts"
              :key="legend.key"
              class="legend-item"
              :style="legend.style"
              data-test="shift-legend-item"
            >
              {{ legend.label }}
            </span>
          </template>
          <span v-else class="legend-empty" data-test="shift-legend-empty">
            尚未設定班別
          </span>
          <span class="legend-item leave">請假</span>
        </div>
        <el-input
          v-model="employeeSearch"
          placeholder="搜尋員工"
          clearable
          class="employee-search"
        />
        <el-select v-model="statusFilter" placeholder="狀態" class="status-filter">
          <el-option label="全部" value="all" />
          <el-option label="缺班" value="unscheduled" />
          <el-option label="待審核請假" value="onLeave" />
        </el-select>
      </div>

      <div v-if="canEdit" class="batch-toolbar">
        <el-select
          v-model="batchShiftId"
          placeholder="套用班別"
          class="modern-select batch-select"
          filterable
          data-test="batch-shift-select"
        >
          <el-option
            v-for="opt in shifts"
            :key="opt._id"
            :label="formatShiftLabel(opt)"
            :value="opt._id"
          />
        </el-select>
        <el-select
          v-model="batchDepartment"
          placeholder="套用部門"
          clearable
          class="modern-select batch-select"
          data-test="batch-dept-select"
        >
          <el-option
            v-for="dept in departments"
            :key="dept._id"
            :label="dept.name"
            :value="dept._id"
          />
        </el-select>
        <el-select
          v-model="batchSubDepartment"
          placeholder="套用單位"
          clearable
          class="modern-select batch-select"
          :disabled="!batchDepartment"
          data-test="batch-subdept-select"
        >
          <el-option
            v-for="sub in batchSubDepartments"
            :key="sub._id"
            :label="sub.name"
            :value="sub._id"
          />
        </el-select>
        <el-button
          type="primary"
          class="action-btn primary apply-btn"
          :disabled="!hasAnySelection || !batchShiftId || isApplyingBatch"
          :loading="isApplyingBatch"
          @click="applyBatch"
          data-test="batch-apply-button"
        >
          套用至選取
        </el-button>
      </div>

      <el-table
        class="modern-schedule-table"
        :data="filteredEmployees"
        :header-cell-style="{ backgroundColor: '#ecfeff', color: '#164e63', fontWeight: '600' }"
        :row-style="{ backgroundColor: '#ffffff' }"
        @row-click="row => lazyMode && toggleRow(row._id)"
      >
        <el-table-column label="部門／單位" width="180" fixed="left">
          <template #default="{ row }">
            <div class="employee-info">
              <div class="department-name">{{ row.department }}</div>
              <div v-if="row.subDepartment" class="sub-department">{{ row.subDepartment }}</div>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="員工姓名" width="150" fixed="left">
          <template #default="{ row }">
            <div class="employee-name">
              <el-checkbox
                v-if="canEdit"
                class="row-checkbox"
                :model-value="selectedEmployeesSet.has(row._id)"
                @change="val => toggleEmployee(row._id, val)"
              />
              <component
                v-if="employeeStatus(row._id) === 'unscheduled'"
                :is="CircleCloseFilled"
                class="status-icon unscheduled"
              />
              <component
                v-else-if="employeeStatus(row._id) === 'onLeave'"
                :is="WarningFilled"
                class="status-icon on-leave"
              />
              {{ row.name }}
            </div>
          </template>
        </el-table-column>
        <el-table-column
          v-for="d in days"
          :key="d.date"
          :label="d.label"
          width="140"
          align="center"
        >
          <template #header>
            <div class="day-header">
              <span>{{ d.label }}</span>
              <el-checkbox
                v-if="canEdit"
                class="day-checkbox"
                :model-value="selectedDaysSet.has(d.date)"
                @change="val => toggleDay(d.date, val)"
              />
            </div>
          </template>
          <template #default="{ row }">
            <div
              v-if="!lazyMode || expandedRows.has(row._id)"
              class="modern-schedule-cell"
              :class="[
                {
                  'has-leave': scheduleMap[row._id]?.[d.date]?.leave,
                  'missing-shift':
                    !scheduleMap[row._id]?.[d.date]?.shiftId &&
                    !scheduleMap[row._id]?.[d.date]?.leave,
                  'is-selected': isCellSelected(row._id, d.date),
                  'has-shift':
                    !scheduleMap[row._id]?.[d.date]?.leave &&
                    !!scheduleMap[row._id]?.[d.date]?.shiftId
                }
              ]"
              :style="
                scheduleMap[row._id]?.[d.date]?.leave
                  ? undefined
                  : shiftClass(scheduleMap[row._id]?.[d.date]?.shiftId)
              "
              :title="leaveTooltip(row._id, d.date)"
            >
              <div v-if="canEdit" class="cell-selection" @click.stop>
                <el-checkbox
                  :model-value="manualSelectedCellsSet.has(buildCellKey(row._id, d.date))"
                  :disabled="!isSelectableCell(row._id, d.date)"
                  @change="val => toggleCell(row._id, d.date, val)"
                  size="small"
                />
              </div>
              <template v-if="scheduleMap[row._id]?.[d.date]">
                <div
                  v-if="scheduleMap[row._id][d.date].leave"
                  class="leave-indicator"
                  data-test="leave-indicator"
                >
                  <el-tag
                    type="warning"
                    effect="light"
                    size="small"
                    class="leave-tag"
                  >
                    休假中
                  </el-tag>
                  <span class="leave-note">已核准請假，不列入工時</span>
                </div>
                <template v-else-if="canEdit">
                  <el-select
                    v-model="scheduleMap[row._id][d.date].shiftId"
                    placeholder="選擇班別"
                    @change="val => onSelect(row._id, d.date, val)"
                    class="cell-select shift-select"
                    size="small"
                  >
                    <el-option
                      v-for="opt in shifts"
                      :key="opt._id"
                      :label="formatShiftLabel(opt)"
                      :value="opt._id"
                    />
                  </el-select>
                  <div class="department-selects">
                    <el-select
                      v-model="scheduleMap[row._id][d.date].department"
                      placeholder="部門"
                      size="small"
                      @change="() => (scheduleMap[row._id][d.date].subDepartment = '')"
                      class="cell-select dept-select"
                    >
                      <el-option
                        v-for="dept in departments"
                        :key="dept._id"
                        :label="dept.name"
                        :value="dept._id"
                      />
                    </el-select>
                    <el-select
                      v-model="scheduleMap[row._id][d.date].subDepartment"
                      placeholder="單位"
                      size="small"
                      class="cell-select sub-dept-select"
                    >
                      <el-option
                        v-for="sub in subDepsFor(scheduleMap[row._id][d.date].department)"
                        :key="sub._id"
                        :label="sub.name"
                        :value="sub._id"
                      />
                    </el-select>
                  </div>
                </template>
                <template v-else>
                  <el-popover
                    v-if="shiftInfo(scheduleMap[row._id][d.date].shiftId)"
                    placement="top"
                    trigger="hover"
                    :width="200"
                  >
                    <div class="shift-details">
                      <div class="detail-row">
                        <span class="detail-label">上班時間：</span>
                        <span class="detail-value">{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).startTime }}</span>
                      </div>
                      <div class="detail-row">
                        <span class="detail-label">下班時間：</span>
                        <span class="detail-value">{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).endTime }}</span>
                      </div>
                      <div
                        v-if="shiftInfo(scheduleMap[row._id][d.date].shiftId).remark"
                        class="detail-row"
                      >
                        <span class="detail-label">備註：</span>
                        <span class="detail-value">{{ shiftInfo(scheduleMap[row._id][d.date].shiftId).remark }}</span>
                      </div>
                    </div>
                    <template #reference>
                      <div
                        class="modern-shift-tag"
                        :style="shiftClass(shiftInfo(scheduleMap[row._id][d.date].shiftId))"
                      >
                        {{ formatShiftLabel(shiftInfo(scheduleMap[row._id][d.date].shiftId)) }}
                      </div>
                    </template>
                  </el-popover>
                </template>
                <div
                  v-if="
                    !scheduleMap[row._id][d.date].shiftId &&
                    !scheduleMap[row._id][d.date].leave
                  "
                  class="missing-label"
                >
                  未排班
                </div>
              </template>
              <span v-else class="empty-cell">-</span>
            </div>
            <div v-else class="modern-schedule-cell collapsed-cell">展開班表</div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- Enhanced approval list with modern card design -->
    <div v-if="approvalList.length" class="approval-card">
      <div class="approval-header">
        <h3 class="approval-title">待處理審批</h3>
        <div class="approval-count">{{ approvalList.length }} 項待處理</div>
      </div>
      <el-table
        class="modern-approval-table"
        :data="approvalList"
        :header-cell-style="{ backgroundColor: '#f1f5f9', color: '#164e63', fontWeight: '600' }"
      >
        <el-table-column label="申請人" width="120">
          <template #default="{ row }">
            <div class="applicant-name">{{ row.applicant_employee?.name }}</div>
          </template>
        </el-table-column>
        <el-table-column label="申請類型" width="150">
          <template #default="{ row }">
            <div class="form-type">
              {{ formatApprovalCategory(row.form?.category, row.form?.name) }}
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="狀態" width="100">
          <template #default="{ row }">
            <el-tag
              :type="row.status === 'approved' ? 'success' : row.status === 'rejected' ? 'danger' : 'warning'"
              class="status-tag"
            >
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row._id)" :disabled="!row._id">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>

  <el-dialog v-model="detail.visible" title="申請單明細" width="760px">
    <div v-if="detail.doc">
      <p class="mb-2"><b>表單：</b>{{ detail.doc.form?.name }}（{{ detail.doc.form?.category }}）</p>
      <p class="mb-2"><b>申請人：</b>{{ detail.doc.applicant_employee?.name || '-' }}</p>
      <p class="mb-2"><b>狀態：</b>{{ getStatusText(detail.doc.status) }}</p>
      <el-divider content-position="left">填寫內容</el-divider>
      <el-descriptions :column="1" size="small" border>
        <el-descriptions-item
          v-for="fld in detail.doc.form?.fields || []"
          :key="fld._id"
          :label="fld.label"
        >
          <span>{{ renderValue(detail.doc.form_data?.[fld._id]) }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">流程</el-divider>
      <el-timeline>
        <el-timeline-item
          v-for="(s, idx) in detail.doc.steps"
          :key="idx"
          :timestamp="`第 ${idx + 1} 關`"
          :type="idx === detail.doc.current_step_index ? 'primary' : 'info'"
        >
          <div class="mb-1">
            <span class="mr-2">需全員同意：{{ s.all_must_approve ? '是' : '否' }}</span>
            <span>必簽：{{ s.is_required ? '是' : '否' }}</span>
          </div>
          <el-table :data="s.approvers" size="small" border>
            <el-table-column label="審核人" width="200">
              <template #default="{ row }">{{ approverName(row.approver) }}</template>
            </el-table-column>
            <el-table-column label="決議" width="120">
              <template #default="{ row }">{{ getStatusText(row.decision) }}</template>
            </el-table-column>
            <el-table-column label="時間" width="200">
              <template #default="{ row }">{{ fmt(row.decided_at) }}</template>
            </el-table-column>
            <el-table-column prop="comment" label="意見" />
          </el-table>
        </el-timeline-item>
      </el-timeline>
    </div>
    <template #footer>
      <el-button @click="detail.visible = false">關閉</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, watch, reactive } from 'vue'
import dayjs from 'dayjs'
import { apiFetch } from '../../api'
import { useAuthStore } from '../../stores/auth'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import { useRouter } from 'vue-router'
import ScheduleDashboard from './ScheduleDashboard.vue'
import { CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'
import { buildShiftStyle } from '../../utils/shiftColors'

const fmt = d => (d ? new Date(d).toLocaleString() : '-')
const renderValue = v => (Array.isArray(v) ? v.join(', ') : v ?? '-')

const FORM_CATEGORY_LABELS = {
  leave: '請假',
  attendance: '出勤',
  overtime: '加班',
  shift: '排班',
  reimbursement: '報銷',
  expense: '費用',
  travel: '出差',
  recruitment: '招募',
  onboarding: '入職',
  general: '一般'
}

const formatApprovalCategory = (category, fallbackName = '') => {
  if (category === null || category === undefined) {
    return fallbackName || '未知類型'
  }
  const normalized = String(category).trim()
  if (!normalized) {
    return fallbackName || '未知類型'
  }
  const mapped = FORM_CATEGORY_LABELS[normalized.toLowerCase()]
  return mapped || normalized
}

const currentMonth = ref(dayjs().format('YYYY-MM'))
const scheduleMap = ref({})
const rawSchedules = ref([])
const shifts = ref([])
const employees = ref([])
const approvalList = ref([])
const departments = ref([])
const subDepartments = ref([])
const selectedDepartment = ref('')
const selectedSubDepartment = ref('')
const supervisorDepartmentId = ref('')
const supervisorDepartmentName = ref('')
const supervisorSubDepartmentId = ref('')
const supervisorSubDepartmentName = ref('')
const supervisorAssignableSubDepartmentIds = ref([])
const supervisorProfile = ref(null)
const includeSelf = ref(false)
const includeSelfStoragePrefix = 'schedule-include-self'
let isInitializingIncludeSelf = true
const summary = ref({ direct: 0, unscheduled: 0, onLeave: 0 })
const employeeSearch = ref('')
const statusFilter = ref('all')
const expandedRows = ref(new Set())
const selectedEmployees = ref(new Set())
const selectedDays = ref(new Set())
const manualSelectedCells = ref(new Set())
const customRange = ref([])
const batchShiftId = ref('')
const batchDepartment = ref('')
const batchSubDepartment = ref('')
const isApplyingBatch = ref(false)
const isPublishing = ref(false)
const isFinalizing = ref(false)
const detail = reactive({ visible: false, doc: null })
const employeeNameCache = reactive({})

function getSupervisorIdFromStorage() {
  if (typeof window === 'undefined') return ''
  const sessionId = window.sessionStorage?.getItem('employeeId')
  if (sessionId && sessionId !== 'undefined') return sessionId
  const localId = window.localStorage?.getItem('employeeId')
  if (localId && localId !== 'undefined') return localId
  return ''
}

function includeSelfStorageKey(supervisorId) {
  if (!supervisorId) return ''
  return `${includeSelfStoragePrefix}:${String(supervisorId)}`
}

function loadIncludeSelfPreference(supervisorId = getSupervisorIdFromStorage()) {
  if (typeof window === 'undefined') return null
  const key = includeSelfStorageKey(supervisorId)
  if (!key) return null
  const stored = window.localStorage?.getItem(key)
  if (stored === 'true') return true
  if (stored === 'false') return false
  return null
}

function persistIncludeSelfPreference(value, supervisorId = getSupervisorIdFromStorage()) {
  if (typeof window === 'undefined') return
  const key = includeSelfStorageKey(supervisorId)
  if (!key) return
  try {
    window.localStorage?.setItem(key, value ? 'true' : 'false')
  } catch (err) {
    console.warn('Failed to persist includeSelf preference', err)
  }
}

const selectedEmployeesSet = computed(() => selectedEmployees.value)
const selectedDaysSet = computed(() => selectedDays.value)
const manualSelectedCellsSet = computed(() => manualSelectedCells.value)

const legendShifts = computed(() => {
  if (!Array.isArray(shifts.value) || !shifts.value.length) {
    return []
  }
  const seen = new Set()
  return shifts.value.reduce((acc, shift) => {
    if (!shift) return acc
    const label = formatShiftLabel(shift) || shift.name || shift.code || '未命名班別'
    const key = String(shift._id || `${shift.code ?? ''}-${shift.name ?? ''}`)
    if (!label || !key || seen.has(key)) return acc
    seen.add(key)
    acc.push({
      key,
      label,
      style: shiftClass(shift)
    })
    return acc
  }, [])
})

const buildCellKey = (empId, day) => `${empId}-${day}`
const parseCellKey = key => {
  const [empId, day] = String(key).split('-')
  return { empId, day: Number(day) }
}

const isSelectableCell = (empId, day) => {
  const dayMap = scheduleMap.value[empId]
  if (!dayMap) return false
  const cell = dayMap[day]
  if (!cell) return false
  return !cell.leave
}

const allSelectedCells = computed(() => {
  const result = new Set()
  const dayList = days.value
  const employeeList = employees.value
  const addIfSelectable = (empId, day) => {
    if (isSelectableCell(empId, day)) {
      result.add(buildCellKey(empId, day))
    }
  }

  manualSelectedCells.value.forEach(key => {
    const { empId, day } = parseCellKey(key)
    addIfSelectable(empId, day)
  })

  selectedEmployees.value.forEach(empId => {
    dayList.forEach(d => addIfSelectable(empId, d.date))
  })

  selectedDays.value.forEach(day => {
    employeeList.forEach(emp => addIfSelectable(emp._id, day))
  })

  return result
})

const hasAnySelection = computed(() => allSelectedCells.value.size > 0)

const batchSubDepartments = computed(() =>
  batchDepartment.value ? subDepsFor(batchDepartment.value) : []
)

const isCellSelected = (empId, day) =>
  allSelectedCells.value.has(buildCellKey(empId, day))

const pruneSelections = () => {
  const validEmployees = new Set(employees.value.map(e => e._id))
  const validDays = new Set(days.value.map(d => d.date))

  selectedEmployees.value = new Set(
    Array.from(selectedEmployees.value).filter(id => validEmployees.has(id))
  )
  selectedDays.value = new Set(
    Array.from(selectedDays.value).filter(day => validDays.has(day))
  )
  const nextManual = new Set()
  manualSelectedCells.value.forEach(key => {
    const { empId, day } = parseCellKey(key)
    if (validEmployees.has(empId) && validDays.has(day) && isSelectableCell(empId, day)) {
      nextManual.add(buildCellKey(empId, day))
    }
  })
  manualSelectedCells.value = nextManual
}

const clearSelection = () => {
  selectedEmployees.value = new Set()
  selectedDays.value = new Set()
  manualSelectedCells.value = new Set()
  customRange.value = []
}

const toggleEmployee = (empId, explicit) => {
  const next = new Set(selectedEmployees.value)
  const shouldSelect =
    typeof explicit === 'boolean' ? explicit : !next.has(empId)
  if (shouldSelect) {
    next.add(empId)
  } else {
    next.delete(empId)
  }
  selectedEmployees.value = next
}

const toggleDay = (day, explicit) => {
  const next = new Set(selectedDays.value)
  const shouldSelect =
    typeof explicit === 'boolean' ? explicit : !next.has(day)
  if (shouldSelect) {
    next.add(day)
  } else {
    next.delete(day)
  }
  selectedDays.value = next
}

const toggleCell = (empId, day, explicit) => {
  if (!isSelectableCell(empId, day)) return
  const key = buildCellKey(empId, day)
  const next = new Set(manualSelectedCells.value)
  const shouldSelect =
    typeof explicit === 'boolean' ? explicit : !next.has(key)
  if (shouldSelect) {
    next.add(key)
  } else {
    next.delete(key)
  }
  manualSelectedCells.value = next
}

const selectAllEmployees = () => {
  selectedEmployees.value = new Set(employees.value.map(e => e._id))
}

const selectAllDays = () => {
  selectedDays.value = new Set(days.value.map(d => d.date))
}

const sortEmployeesByDept = list =>
  [...list].sort((a, b) => {
    const deptCompare = (a.department || '').localeCompare(b.department || '')
    if (deptCompare !== 0) return deptCompare
    return (a.name || '').localeCompare(b.name || '')
  })

const onCustomRangeChange = range => {
  if (!Array.isArray(range) || range.length !== 2) return
  const [startRaw, endRaw] = range
  if (!startRaw || !endRaw) return
  const monthStart = dayjs(`${currentMonth.value}-01`)
  const start = dayjs(startRaw)
  const end = dayjs(endRaw)
  if (!start.isValid() || !end.isValid()) return
  const monthEnd = monthStart.endOf('month')
  let cursor = start.isBefore(monthStart) ? monthStart : start
  const collected = []
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    if (
      cursor.year() === monthStart.year() &&
      cursor.month() === monthStart.month()
    ) {
      collected.push(cursor.date())
    }
    if (cursor.isSame(monthEnd, 'day')) break
    cursor = cursor.add(1, 'day')
  }
  selectedDays.value = new Set(collected)
}

watch(batchDepartment, (newVal, oldVal) => {
  if (newVal !== oldVal) {
    batchSubDepartment.value = ''
  }
})

watch(batchSubDepartments, newList => {
  if (
    batchSubDepartment.value &&
    !newList.some(sub => sub._id === batchSubDepartment.value)
  ) {
    batchSubDepartment.value = ''
  }
})

watch(includeSelf, async (val, oldVal) => {
  if (val === oldVal) return
  const supervisorId = getStoredSupervisorId() || getSupervisorIdFromStorage()
  persistIncludeSelfPreference(val, supervisorId)
  authStore.refreshRole({ forceRefresh: true })
  if (isInitializingIncludeSelf) return
  if (!showIncludeSelfToggle.value) return
  await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
  await fetchSchedules()
  await fetchSummary()
})

const employeeStatus = empId => {
  const days = scheduleMap.value[empId] || {}
  const values = Object.values(days)
  const hasShift = values.some(v => v.shiftId)
  const hasLeave = values.some(v => v.leave)
  if (!hasShift) return 'unscheduled'
  if (hasLeave) return 'onLeave'
  return 'scheduled'
}

const filteredEmployees = computed(() => {
  let list = employeeSearch.value
    ? employees.value.filter(e => e.name.includes(employeeSearch.value))
    : employees.value
  if (statusFilter.value !== 'all') {
    list = list.filter(e => employeeStatus(e._id) === statusFilter.value)
  }
  return list
})

const lazyMode = computed(() => employees.value.length > 50)
const toggleRow = id => {
  if (expandedRows.value.has(id)) expandedRows.value.delete(id)
  else expandedRows.value.add(id)
}

const filteredSubDepartments = computed(() =>
  subDepartments.value.filter(s => s.department === selectedDepartment.value)
)

const router = useRouter()

const authStore = useAuthStore()
authStore.loadUser()

const canUseSupervisorFilter = computed(() => ['supervisor', 'admin'].includes(authStore.role))
const showIncludeSelfToggle = computed(() => authStore.role === 'supervisor')
const canEdit = canUseSupervisorFilter
const missingSupervisorScheduleNoticeKey = ref('')

const publishSummary = computed(() => {
  const result = {
    status: 'draft',
    pendingEmployees: [],
    disputedEmployees: [],
    publishedAt: null,
    hasSchedules: false,
    totalEmployees: 0,
    allEmployeesConfirmed: false
  }
  const list = Array.isArray(rawSchedules.value) ? rawSchedules.value : []
  if (!list.length) return result

  result.hasSchedules = true
  const employeeMap = new Map()
  let latestPublishedAt = null
  let hasPublished = false
  let hasDisputed = false
  let hasFinalized = false

  list.forEach(item => {
    if (!item) return
    const state = item.state || 'draft'
    const response = item.employeeResponse || 'pending'
    const employee = item.employee || {}
    const rawId = employee?._id ?? employee?.id ?? item.employee
    const id = rawId ? String(rawId) : ''
    const name = employee?.name || item.employeeName || id

    if (state !== 'draft') hasPublished = true
    if (state === 'changes_requested' || response === 'disputed') hasDisputed = true
    if (state === 'finalized') hasFinalized = true

    if (item?.publishedAt) {
      const published = new Date(item.publishedAt)
      if (!Number.isNaN(published)) {
        if (!latestPublishedAt || latestPublishedAt < published) {
          latestPublishedAt = published
        }
      }
    }

    if (!id) return
    if (!employeeMap.has(id)) {
      employeeMap.set(id, {
        id,
        name: name || id,
        pendingCount: 0,
        disputedCount: 0,
        latestNote: '',
        latestResponseAt: null
      })
    }

    const entry = employeeMap.get(id)
    if (state === 'pending_confirmation' && response === 'pending') {
      entry.pendingCount += 1
    }
    if (response === 'disputed' || state === 'changes_requested') {
      entry.disputedCount += 1
      if (item?.responseNote) {
        entry.latestNote = item.responseNote
      }
    }
    if (item?.responseAt) {
      const responded = new Date(item.responseAt)
      if (!Number.isNaN(responded)) {
        if (!entry.latestResponseAt || entry.latestResponseAt < responded) {
          entry.latestResponseAt = responded
        }
      }
    }
  })

  const pendingEmployees = []
  const disputedEmployees = []

  employeeMap.forEach(entry => {
    if (entry.pendingCount > 0) {
      pendingEmployees.push({
        id: entry.id,
        name: entry.name,
        pendingCount: entry.pendingCount
      })
    }
    if (entry.disputedCount > 0) {
      disputedEmployees.push({
        id: entry.id,
        name: entry.name,
        disputedCount: entry.disputedCount,
        latestNote: entry.latestNote,
        latestResponseAt: entry.latestResponseAt
          ? entry.latestResponseAt.toISOString()
          : null
      })
    }
  })

  result.pendingEmployees = pendingEmployees
  result.disputedEmployees = disputedEmployees
  result.totalEmployees = employeeMap.size
  result.publishedAt = latestPublishedAt ? latestPublishedAt.toISOString() : null

  if (hasFinalized) {
    result.status = 'finalized'
  } else if (hasDisputed) {
    result.status = 'disputed'
  } else if (hasPublished) {
    result.status = pendingEmployees.length ? 'pending' : 'ready'
  } else {
    result.status = 'draft'
  }

  result.allEmployeesConfirmed =
    result.status === 'ready' && pendingEmployees.length === 0 && disputedEmployees.length === 0

  return result
})

const publishStatusLabel = computed(() => {
  const map = {
    draft: '尚未發布',
    pending: '待員工確認',
    ready: '可完成發布',
    disputed: '需處理異議',
    finalized: '已完成發布'
  }
  return map[publishSummary.value.status] || '尚未發布'
})

const pendingCount = computed(() =>
  publishSummary.value.pendingEmployees.reduce(
    (total, emp) => total + (Number(emp?.pendingCount) || 0),
    0
  )
)

const disputedCount = computed(() =>
  publishSummary.value.disputedEmployees.reduce(
    (total, emp) => total + (Number(emp?.disputedCount) || 0),
    0
  )
)

const publishStepIndex = computed(() => {
  const status = publishSummary.value.status
  if (status === 'pending') return 1
  if (status === 'disputed') return 2
  if (status === 'ready' || status === 'finalized') return 3
  return 0
})

const stepStatuses = computed(() => {
  const status = publishSummary.value.status
  const hasPending = pendingCount.value > 0
  const hasDisputed = disputedCount.value > 0
  return {
    draft: status === 'draft' ? 'process' : 'finish',
    pending:
      status === 'draft'
        ? 'wait'
        : hasPending || status === 'pending'
          ? 'process'
          : 'finish',
    disputed: hasDisputed ? 'error' : status === 'draft' || status === 'pending' ? 'wait' : 'finish',
    finalized:
      status === 'finalized' ? 'success' : status === 'ready' ? 'process' : 'wait'
  }
})

const pendingStepDescription = computed(() => {
  if (!publishSummary.value.hasSchedules) return '尚未發送確認'
  if (pendingCount.value > 0) {
    return `${pendingCount.value} 筆待回覆`
  }
  return '員工已完成回覆'
})

const disputeStepDescription = computed(() => {
  if (!publishSummary.value.hasSchedules) return '尚未進入異議流程'
  if (disputedCount.value > 0) {
    return `${disputedCount.value} 筆異議待處理`
  }
  return '無異議紀錄'
})

const finalStepDescription = computed(() => {
  if (publishSummary.value.status === 'finalized') return '班表已鎖定'
  if (publishSummary.value.status === 'ready') return '可執行最終發布'
  return '等待完成發布'
})

const publishProgress = computed(() => {
  if (publishSummary.value.status === 'finalized') return 100
  const total = publishSummary.value.totalEmployees
  if (!total || total <= 0) return publishSummary.value.status === 'draft' ? 0 : 20
  const responded = Math.max(total - publishSummary.value.pendingEmployees.length, 0)
  const percentage = Math.round((responded / total) * 100)
  return Math.min(Math.max(percentage, 0), 100)
})

const publishDisabled = computed(
  () =>
    isPublishing.value ||
    !publishSummary.value.hasSchedules ||
    publishSummary.value.status === 'finalized'
)

const finalizeDisabled = computed(
  () =>
    isFinalizing.value ||
    publishSummary.value.status !== 'ready'
)

watch(showIncludeSelfToggle, newVal => {
  const supervisorId = getStoredSupervisorId() || getSupervisorIdFromStorage()
  if (!newVal) {
    if (includeSelf.value) {
      includeSelf.value = false
    }
    persistIncludeSelfPreference(false, supervisorId)
    return
  }
  const stored = loadIncludeSelfPreference(supervisorId)
  if (stored === true) {
    includeSelf.value = true
  } else if (stored === false && supervisorId) {
    persistIncludeSelfPreference(false, supervisorId)
  }
})

const callWarning = message => {
  const moduleWarn = ElMessage?.warning
  if (typeof moduleWarn === 'function') {
    moduleWarn(message)
  }
  const globalWarn = typeof window !== 'undefined' ? window.ElMessage?.warning : undefined
  if (typeof globalWarn === 'function' && globalWarn !== moduleWarn) {
    globalWarn(message)
  }
}

const callInfo = message => {
  const moduleInfo = ElMessage?.info
  if (typeof moduleInfo === 'function') {
    moduleInfo(message)
  }
  const globalInfo = typeof window !== 'undefined' ? window.ElMessage?.info : undefined
  if (typeof globalInfo === 'function' && globalInfo !== moduleInfo) {
    globalInfo(message)
  }
}

const callSuccess = message => {
  const moduleSuccess = ElMessage?.success
  if (typeof moduleSuccess === 'function') {
    moduleSuccess(message)
  }
  const globalSuccess = typeof window !== 'undefined' ? window.ElMessage?.success : undefined
  if (typeof globalSuccess === 'function' && globalSuccess !== moduleSuccess) {
    globalSuccess(message)
  }
}

const formatPublishDate = value => {
  if (!value) return ''
  const parsed = dayjs(value)
  if (!parsed.isValid()) return ''
  return parsed.format('YYYY/MM/DD HH:mm')
}

function buildPublishPayload() {
  const payload = { month: currentMonth.value }
  if (selectedDepartment.value) payload.department = selectedDepartment.value
  if (selectedSubDepartment.value) payload.subDepartment = selectedSubDepartment.value
  if (includeSelf.value && showIncludeSelfToggle.value) payload.includeSelf = true
  return payload
}

async function publishSchedulesForMonth() {
  if (isPublishing.value) return
  try {
    isPublishing.value = true
    const res = await apiFetch('/api/schedules/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPublishPayload())
    })
    if (!res.ok) {
      let message = '發布失敗'
      try {
        const data = await res.json()
        if (data?.error) message = data.error
      } catch (err) {
        // ignore
      }
      throw new Error(message)
    }
    callSuccess('已將班表發送給員工確認')
    await fetchSchedules()
    await fetchSummary()
  } catch (err) {
    callWarning(err?.message || '發布失敗')
  } finally {
    isPublishing.value = false
  }
}

async function finalizeSchedulesForMonth() {
  if (isFinalizing.value) return
  try {
    isFinalizing.value = true
    const res = await apiFetch('/api/schedules/publish/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPublishPayload())
    })
    if (res.status === 409) {
      let message = '仍有員工未回覆'
      try {
        const data = await res.json()
        if (data?.error) message = data.error
      } catch (err) {
        // ignore
      }
      callWarning(message)
      await fetchSchedules()
      return
    }
    if (!res.ok) {
      let message = '完成發布失敗'
      try {
        const data = await res.json()
        if (data?.error) message = data.error
      } catch (err) {
        // ignore
      }
      throw new Error(message)
    }
    callSuccess('班表已完成發布')
    await fetchSchedules()
    await fetchSummary()
  } catch (err) {
    callWarning(err?.message || '完成發布失敗')
  } finally {
    isFinalizing.value = false
  }
}

async function confirmPublish() {
  if (publishDisabled.value) {
    callWarning('目前沒有可發布的班表')
    return
  }
  try {
    await ElMessageBox.confirm('確認要將本月班表發送給員工確認嗎？', '批次發布', {
      type: 'warning',
      confirmButtonText: '送出',
      cancelButtonText: '取消'
    })
  } catch (err) {
    return
  }
  await publishSchedulesForMonth()
}

async function confirmFinalize() {
  if (publishSummary.value.status === 'finalized') {
    callInfo('班表已完成發布')
    return
  }
  if (finalizeDisabled.value) {
    callWarning('仍有員工尚未回覆，請確認後再完成發布')
    return
  }
  try {
    await ElMessageBox.confirm('全部員工已確認，是否完成發布並鎖定班表？', '完成發布', {
      type: 'success',
      confirmButtonText: '完成',
      cancelButtonText: '取消'
    })
  } catch (err) {
    return
  }
  await finalizeSchedulesForMonth()
}

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
    return emp.name || employeeNameCache[id] || id
  }
  return employeeNameCache[emp] || emp || '-'
}

const leaveTooltip = (empId, day) => {
  const cell = scheduleMap.value?.[empId]?.[day]
  if (cell?.leave) {
    return '已核准請假，該日不列入工作時數'
  }
  return ''
}

const days = computed(() => {
  const dt = dayjs(currentMonth.value + '-01')
  const end = dt.endOf('month').date()
  const week = ['日', '一', '二', '三', '四', '五', '六']
  return Array.from({ length: end }, (_, i) => {
    const date = i + 1
    const wd = week[dt.date(date).day()]
    return { date, label: `${date}(${wd})` }
  })
})

watch(employees, pruneSelections)
watch(days, pruneSelections)

async function fetchShiftOptions() {
  const res = await apiFetch('/api/shifts')
  if (res.ok) {
    const data = await res.json()
    const list = Array.isArray(data?.shifts)
      ? data.shifts
      : Array.isArray(data)
        ? data
        : []
    if (Array.isArray(list)) {
      shifts.value = list.map(s => ({
        _id: s._id,
        code: s.code,
        name: s.name ?? '',
        startTime: s.startTime,
        endTime: s.endTime,
        remark: s.remark
      }))
    }
  } else {
    if (res.status === 403) {
      alert('缺少權限，請重新登入或聯絡管理員')
    } else {
      console.error('取得班表設定失敗', res.status)
    }
  }
}

async function fetchSubDepartments(dept = '') {
  try {
    const targetDept = dept || supervisorDepartmentId.value
    const url = targetDept
      ? `/api/sub-departments?department=${targetDept}`
      : '/api/sub-departments'
    const res = await apiFetch(url)
    if (!res.ok) throw new Error('Failed to fetch sub departments')
    const subData = await res.json()
    const deptMap = departments.value.reduce((acc, d) => {
      const id = String(d._id)
      acc[id] = id
      if (d.name) acc[d.name] = id
      return acc
    }, {})
    if (supervisorDepartmentId.value) {
      deptMap[supervisorDepartmentId.value] = supervisorDepartmentId.value
    }
    if (supervisorDepartmentName.value) {
      deptMap[supervisorDepartmentName.value] = supervisorDepartmentId.value || supervisorDepartmentName.value
    }
    const normalized = Array.isArray(subData)
      ? subData
          .map(s => {
            const rawDept = s?.department
            let deptId = ''
            if (rawDept && typeof rawDept === 'object') {
              deptId = rawDept?._id || rawDept?.id || deptMap[rawDept?.name] || ''
            } else {
              deptId = deptMap[rawDept] || rawDept || ''
            }
            return {
              ...s,
              _id: String(s?._id ?? s?.id ?? ''),
              department: String(deptId)
            }
          })
          .filter(s => s._id)
      : []
    let filtered = normalized
    if (targetDept) {
      filtered = normalized.filter(s => s.department === String(targetDept))
      if (!filtered.length && supervisorSubDepartmentId.value) {
        const matched = normalized.find(s => s._id === supervisorSubDepartmentId.value)
        if (matched) {
          filtered = [matched]
        } else {
          filtered = [
            {
              _id: supervisorSubDepartmentId.value,
              name: supervisorSubDepartmentName.value || '',
              department: String(targetDept)
            }
          ]
        }
      }
    }
    if (authStore.role === 'supervisor') {
      const baseIds = supervisorAssignableSubDepartmentIds.value.length
        ? supervisorAssignableSubDepartmentIds.value
        : supervisorSubDepartmentId.value
          ? [supervisorSubDepartmentId.value]
          : []
      const allowedSet = new Set(baseIds.map(id => String(id)))
      if (allowedSet.size) {
        filtered = filtered.filter(s => allowedSet.has(String(s._id)))
      } else {
        filtered = []
      }
    }
    subDepartments.value = filtered
    if (subDepartments.value.length) {
      if (
        supervisorSubDepartmentId.value &&
        subDepartments.value.some(s => s._id === supervisorSubDepartmentId.value)
      ) {
        selectedSubDepartment.value = supervisorSubDepartmentId.value
      } else if (
        selectedSubDepartment.value &&
        subDepartments.value.some(s => s._id === selectedSubDepartment.value)
      ) {
        // keep existing selection
      } else {
        selectedSubDepartment.value = subDepartments.value[0]._id
      }
    } else {
      selectedSubDepartment.value = ''
    }
  } catch (err) {
    console.error(err)
    subDepartments.value = []
    selectedSubDepartment.value = ''
  }
}

async function fetchOptions() {
  try {
    const deptRes = await apiFetch('/api/departments')
    const deptData = deptRes.ok ? await deptRes.json() : []
    const normalized = Array.isArray(deptData)
      ? deptData
          .map(d => {
            const id = d?._id ?? d?.id ?? d?.value ?? ''
            return {
              ...d,
              _id: String(id),
              name: d?.name ?? ''
            }
          })
          .filter(d => d._id)
      : []
    const targetDeptId = selectedDepartment.value || supervisorDepartmentId.value
    let filtered = normalized
    if (targetDeptId) {
      filtered = normalized.filter(
        d =>
          d._id === targetDeptId ||
          (supervisorDepartmentName.value && d.name === supervisorDepartmentName.value)
      )
      if (!filtered.length && targetDeptId) {
        filtered = [
          {
            _id: targetDeptId,
            name:
              supervisorDepartmentName.value ||
              normalized.find(d => d._id === targetDeptId)?.name ||
              ''
          }
        ]
      }
    }
    departments.value = filtered.length ? filtered : normalized
    if (departments.value.length) {
      if (!departments.value.some(d => d._id === selectedDepartment.value)) {
        selectedDepartment.value = departments.value[0]._id
      }
    } else if (!selectedDepartment.value && targetDeptId) {
      selectedDepartment.value = targetDeptId
    }
    const deptForSubs =
      selectedDepartment.value ||
      supervisorDepartmentId.value ||
      (departments.value.length ? departments.value[0]._id : '')
    await fetchSubDepartments(deptForSubs)
  } catch (err) {
    console.error(err)
  }
}

function getStoredSupervisorId() {
  if (!canUseSupervisorFilter.value) return ''
  return getSupervisorIdFromStorage()
}

async function fetchSupervisorContext() {
  if (authStore.role !== 'supervisor') {
    supervisorDepartmentId.value = ''
    supervisorDepartmentName.value = ''
    supervisorSubDepartmentId.value = ''
    supervisorSubDepartmentName.value = ''
    supervisorAssignableSubDepartmentIds.value = []
    supervisorProfile.value = null
    return
  }
  const supervisorId = getStoredSupervisorId()
  if (!supervisorId) {
    supervisorDepartmentId.value = ''
    supervisorDepartmentName.value = ''
    supervisorSubDepartmentId.value = ''
    supervisorSubDepartmentName.value = ''
    supervisorAssignableSubDepartmentIds.value = []
    supervisorProfile.value = null
    return
  }
  let data = null
  try {
    const res = await apiFetch(`/api/employees/${supervisorId}`)
    if (!res.ok) throw new Error('Failed to fetch supervisor context')
    data = await res.json()
  } catch (err) {
    console.error(err)
    supervisorProfile.value = null
  }
  supervisorProfile.value = data || null
  const deptInfo = data?.department
  let deptId = ''
  let deptName = ''
  if (deptInfo && typeof deptInfo === 'object') {
    deptId = deptInfo?._id || deptInfo?.id || deptInfo?.value || ''
    deptName = deptInfo?.name || data?.departmentName || ''
  } else if (typeof deptInfo === 'string') {
    const matchedDept = departments.value.find(
      dept =>
        String(dept?._id) === deptInfo ||
        String(dept?.id ?? '') === deptInfo ||
        dept?.code === deptInfo ||
        dept?.name === deptInfo
    )
    deptId = matchedDept?._id || matchedDept?.id || deptInfo
    deptName = matchedDept?.name || data?.departmentName || deptInfo
  }
  supervisorDepartmentId.value = deptId ? String(deptId) : ''
  supervisorDepartmentName.value = deptName ? String(deptName) : ''
  if (supervisorDepartmentId.value) {
    selectedDepartment.value = supervisorDepartmentId.value
  } else {
    selectedDepartment.value = ''
  }
  const subInfo = data?.subDepartment
  let subId = ''
  let subName = ''
  if (subInfo && typeof subInfo === 'object') {
    subId = subInfo?._id || subInfo?.id || subInfo?.value || ''
    subName = subInfo?.name || data?.subDepartmentName || ''
  } else if (typeof subInfo === 'string') {
    const matchedSub = subDepartments.value.find(
      sub =>
        String(sub?._id) === subInfo ||
        String(sub?.id ?? '') === subInfo ||
        sub?.code === subInfo ||
        sub?.name === subInfo
    )
    subId = matchedSub?._id || matchedSub?.id || subInfo
    subName = matchedSub?.name || data?.subDepartmentName || subInfo
  }
  supervisorSubDepartmentId.value = subId ? String(subId) : ''
  supervisorSubDepartmentName.value = subName ? String(subName) : ''
  if (supervisorSubDepartmentId.value) {
    selectedSubDepartment.value = supervisorSubDepartmentId.value
  } else {
    selectedSubDepartment.value = ''
  }
  await fetchSupervisorSubDepartmentScope(supervisorId)
}

async function fetchSupervisorSubDepartmentScope(supervisorId = '') {
  if (authStore.role !== 'supervisor') {
    supervisorAssignableSubDepartmentIds.value = []
    return
  }
  const targetId = supervisorId || getStoredSupervisorId()
  if (!targetId) {
    supervisorAssignableSubDepartmentIds.value = supervisorSubDepartmentId.value
      ? [String(supervisorSubDepartmentId.value)]
      : []
    return
  }
  try {
    const res = await apiFetch(`/api/employees?supervisor=${targetId}`)
    if (!res.ok) throw new Error('Failed to fetch direct reports')
    const payload = await res.json()
    const list = Array.isArray(payload) ? payload : []
    const seen = new Set()
    const allowed = []
    const add = value => {
      if (!value && value !== 0) return
      const str = String(value)
      if (!str) return
      if (!seen.has(str)) {
        seen.add(str)
        allowed.push(str)
      }
    }
    list.forEach(emp => {
      const raw = emp?.subDepartment
      if (raw && typeof raw === 'object') {
        add(raw?._id || raw?.id || raw?.value)
      } else {
        add(raw)
      }
    })
    add(supervisorSubDepartmentId.value)
    supervisorAssignableSubDepartmentIds.value = allowed
  } catch (err) {
    console.error(err)
    supervisorAssignableSubDepartmentIds.value = supervisorSubDepartmentId.value
      ? [String(supervisorSubDepartmentId.value)]
      : []
  }
}

async function fetchSchedules() {
  const supervisorId = getStoredSupervisorId()
  const params = [`month=${currentMonth.value}`]
  if (supervisorId) params.push(`supervisor=${supervisorId}`)
  if (includeSelf.value && showIncludeSelfToggle.value) params.push('includeSelf=true')
  const query = `?${params.join('&')}`
  try {
    const res = await apiFetch(`/api/schedules/monthly${query}`)
    if (!res.ok) throw new Error('Failed to fetch schedules')
    const data = await res.json()
    const schedules = Array.isArray(data) ? data : []
    rawSchedules.value = schedules

    const ds = days.value
    scheduleMap.value = {}
    if (!employees.value.length && schedules.length) {
      await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
    }
    employees.value.forEach(emp => {
      const empKey = String(emp._id)
      scheduleMap.value[empKey] = {}
      ds.forEach(d => {
        scheduleMap.value[empKey][d.date] = {
          shiftId: '',
          department: emp.departmentId,
          subDepartment: emp.subDepartmentId
        }
      })
    })
    schedules.forEach(s => {
      const rawId = s.employee?._id || s.employee
      if (!rawId) return
      const empId = String(rawId)
      if (!scheduleMap.value[empId]) {
        scheduleMap.value[empId] = {}
        ds.forEach(d => {
          scheduleMap.value[empId][d.date] = {
            shiftId: '',
            department: '',
            subDepartment: ''
          }
        })
      }
      const d = dayjs(s.date).date()
      const emp = employees.value.find(e => String(e._id) === empId) || {}
      scheduleMap.value[empId][d] = {
        id: s._id,
        shiftId: s.shiftId,
        department: s.department || emp.departmentId,
        subDepartment: s.subDepartment || emp.subDepartmentId
      }
    })

    const leaveParams = params.slice()
    const deptId = selectedDepartment.value
    const subId = selectedSubDepartment.value
    if (deptId) leaveParams.push(`department=${deptId}`)
    if (subId) leaveParams.push(`subDepartment=${subId}`)
    const leaveQuery = `?${leaveParams.join('&')}`
    const res2 = await apiFetch(`/api/schedules/leave-approvals${leaveQuery}`)
    if (res2.ok) {
      const extra = await res2.json()
      const approvals = Array.isArray(extra?.approvals) ? extra.approvals : []
      const leaves = Array.isArray(extra?.leaves) ? extra.leaves : []
      approvalList.value = approvals
      const monthStart = dayjs(`${currentMonth.value}-01`).startOf('day')
      const monthEnd = monthStart.endOf('month').startOf('day')
      leaves.forEach(l => {
        if (l.status !== 'approved') return
        const rawEmp = l.employee?._id || l.employee
        if (!rawEmp) return
        const empId = String(rawEmp)
        const startDate = dayjs(l.startDate).startOf('day')
        const endDate = dayjs(l.endDate).startOf('day')
        if (!startDate.isValid() || !endDate.isValid()) return
        let pointer = startDate.isBefore(monthStart) ? monthStart : startDate
        const boundary = endDate.isAfter(monthEnd) ? monthEnd : endDate
        while (!pointer.isAfter(boundary)) {
          const dayNum = pointer.date()
          const cell = scheduleMap.value?.[empId]?.[dayNum]
          if (cell) {
            cell.leave = {
              type: l.leaveType,
              startDate: l.startDate,
              endDate: l.endDate,
              excludesHours: true
            }
          }
          pointer = pointer.add(1, 'day')
        }
      })
    }
    const supervisorId = getStoredSupervisorId() || getSupervisorIdFromStorage()
    const shouldCheckSupervisorSchedule =
      includeSelf.value && showIncludeSelfToggle.value && supervisorId
    if (shouldCheckSupervisorSchedule) {
      const hasSupervisorSchedule = schedules.some(s => {
        const rawEmp = s?.employee?._id || s?.employee
        return rawEmp && String(rawEmp) === supervisorId
      })
      const noticeKey = [
        currentMonth.value,
        selectedDepartment.value || '',
        selectedSubDepartment.value || ''
      ].join('|')
      if (!hasSupervisorSchedule) {
        if (missingSupervisorScheduleNoticeKey.value !== noticeKey) {
          callInfo('尚未為主管建立班表，請先建立排班。')
          missingSupervisorScheduleNoticeKey.value = noticeKey
        }
      } else if (missingSupervisorScheduleNoticeKey.value) {
        missingSupervisorScheduleNoticeKey.value = ''
      }
    } else if (missingSupervisorScheduleNoticeKey.value) {
      missingSupervisorScheduleNoticeKey.value = ''
    }
    pruneSelections()
  } catch (err) {
    console.error(err)
    ElMessage.error('取得排班資料失敗')
    rawSchedules.value = []
  }
}

async function openDetail(id) {
  if (!id) return
  detail.visible = false
  detail.doc = null
  const res = await apiFetch(`/api/approvals/${id}`)
  if (!res.ok) return
  const data = await res.json()
  detail.doc = data
  detail.visible = true
  const steps = Array.isArray(detail.doc?.steps) ? detail.doc.steps : []
  steps.forEach(step => {
    const approvers = Array.isArray(step?.approvers) ? step.approvers : []
    approvers.forEach(a => {
      if (a?.approver?._id && a?.approver?.name) {
        employeeNameCache[a.approver._id] = a.approver.name
      }
    })
  })
}

function preview(type) {
  sessionStorage.setItem(
    'schedulePreview',
    JSON.stringify({
      scheduleMap: scheduleMap.value,
      employees: employees.value,
      days: days.value,
      shifts: shifts.value
    })
  )
  router.push({ name: type === 'week' ? 'PreviewWeek' : 'PreviewMonth' })
}

async function exportSchedules(format) {
  try {
    const res = await apiFetch(
      `/api/schedules/export?month=${currentMonth.value}&format=${format}`
    )
    if (!res.ok) throw new Error()
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `schedules-${currentMonth.value}.${
      format === 'excel' ? 'xlsx' : 'pdf'
    }`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    ElMessage.error('匯出失敗')
  }
}

async function onSelect(empId, day, value) {
  const dateStr = `${currentMonth.value}-${String(day).padStart(2, '0')}`
  const existing = scheduleMap.value[empId][day]
  if (existing?.leave) {
    callInfo('該日已核准請假，無法調整排班')
    return
  }
  const prev = existing?.shiftId ?? ''
  if (existing && existing.id) {
    try {
      const res = await apiFetch(`/api/schedules/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftId: value,
          department: existing.department,
          subDepartment: existing.subDepartment
        })
      })
      if (!res.ok) {
        await handleScheduleError(res, '更新排班失敗', empId, day, prev)
      }
    } catch (err) {
      await handleScheduleError(null, '更新排班失敗', empId, day, prev)
    }
  } else {
    try {
      const res = await apiFetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee: empId,
          date: dateStr,
          shiftId: value,
          department: existing.department,
          subDepartment: existing.subDepartment
        })
      })
      if (res.ok) {
        const saved = await res.json()
        scheduleMap.value[empId][day] = {
          id: saved._id,
          shiftId: saved.shiftId,
          department: existing.department,
          subDepartment: existing.subDepartment
        }
      } else {
        await handleScheduleError(res, '新增排班失敗', empId, day, prev)
      }
    } catch (err) {
      await handleScheduleError(null, '新增排班失敗', empId, day, prev)
    }
  }
}

async function onDepartmentChange() {
  selectedSubDepartment.value = ''
  await fetchSubDepartments(selectedDepartment.value)
  await fetchEmployees(selectedDepartment.value, '')
  await fetchSchedules()
}

async function onSubDepartmentChange() {
  await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
  await fetchSchedules()
}

async function handleScheduleError(res, defaultMsg, empId, day, prev) {
  if (!scheduleMap.value[empId]) {
    scheduleMap.value[empId] = {}
  }
  const current = scheduleMap.value[empId][day] || {
    shiftId: '',
    department: '',
    subDepartment: ''
  }
  current.shiftId = prev
  scheduleMap.value[empId][day] = current
  let msg = ''
  try {
    if (res) {
      const data = await res.json()
      msg = data?.error || ''
    }
  } catch (e) {}
  if (msg === 'employee conflict') {
    ElMessageBox.alert('人員衝突')
  } else if (msg === 'department overlap') {
    ElMessageBox.alert('跨區重複')
  } else if (msg === 'leave conflict') {
    ElMessageBox.alert('請假衝突')
  } else {
    ElMessage.error(defaultMsg)
  }
}

async function handleBatchApiError(res, defaultMsg = '批次套用失敗') {
  let msg = ''
  try {
    if (res) {
      const data = await res.json()
      msg = data?.error || ''
    }
  } catch (err) {}
  if (msg === 'employee conflict') {
    ElMessage.warning('部分員工既有排班已更新，請重新整理檢查')
  } else if (msg === 'department overlap') {
    ElMessageBox.alert('部門或單位與既有資料不一致，無法套用')
  } else if (msg === 'leave conflict') {
    ElMessageBox.alert('選取日期包含已核准請假，無法套用')
  } else if (msg) {
    ElMessage.error(msg)
  } else {
    ElMessage.error(defaultMsg)
  }
}

async function applyBatch() {
  if (!hasAnySelection.value) {
    callWarning('請先選取要套用的儲存格')
    return
  }
  if (!batchShiftId.value) {
    callWarning('請選擇欲套用的班別')
    return
  }
  const batchPayload = []
  allSelectedCells.value.forEach(key => {
    const { empId, day } = parseCellKey(key)
    const info = scheduleMap.value[empId]?.[day]
    if (!info || info.leave) return
    const department = batchDepartment.value || info.department || ''
    let subDepartment = info.subDepartment || ''
    if (batchDepartment.value) {
      subDepartment = batchSubDepartment.value || ''
    } else if (batchSubDepartment.value) {
      subDepartment = batchSubDepartment.value
    }
    batchPayload.push({
      employee: empId,
      day,
      date: `${currentMonth.value}-${String(day).padStart(2, '0')}`,
      shiftId: batchShiftId.value,
      department,
      subDepartment
    })
  })

  if (!batchPayload.length) {
    callInfo('選取的儲存格皆無需更新')
    return
  }

  const payloadMap = new Map()
  batchPayload.forEach(item => {
    payloadMap.set(buildCellKey(item.employee, item.day), item)
  })

  isApplyingBatch.value = true
  const loadingInstance = ElLoading.service({
    fullscreen: true,
    lock: true,
    text: '批次套用中...'
  })

  try {
    let res
    try {
      res = await apiFetch('/api/schedules/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          schedules: batchPayload.map(({ day, ...rest }) => rest)
        })
      })
    } catch (err) {
      await handleBatchApiError(null)
      return
    }
    if (!res.ok) {
      await handleBatchApiError(res)
      return
    }

    const result = await res.json()

    if (!Array.isArray(result) || !result.length) {
      callInfo('沒有可更新的資料')
      return
    }

    result.forEach(entry => {
      const empId = entry.employee?._id || entry.employee
      const d = dayjs(entry.date).date()
      if (!scheduleMap.value[empId]) {
        scheduleMap.value[empId] = {}
      }
      const key = buildCellKey(empId, d)
      const payload = payloadMap.get(key) || {}
      const current = scheduleMap.value[empId][d] || {}
      scheduleMap.value[empId][d] = {
        ...current,
        id: entry._id || payload.id || current.id,
        shiftId: entry.shiftId || payload.shiftId || current.shiftId,
        department:
          payload.department ?? entry.department ?? current.department ?? '',
        subDepartment:
          payload.subDepartment ?? entry.subDepartment ?? current.subDepartment ?? ''
      }
      delete scheduleMap.value[empId][d].leave
    })

    callSuccess('批次套用完成')
  } finally {
    loadingInstance?.close()
    isApplyingBatch.value = false
  }
}

function shiftInfo(id) {
  return shifts.value.find(s => s._id === id)
}

function formatShiftLabel(shift) {
  if (!shift) return ''
  const code = shift.code ?? ''
  const name = shift.name ?? ''
  if (!code && !name) return ''
  return name ? `${code}(${name})` : code
}

function shiftClass(idOrShift) {
  const info =
    idOrShift && typeof idOrShift === 'object'
      ? idOrShift
      : shiftInfo(idOrShift)
  if (!info) return {}
  return buildShiftStyle(info)
}

function subDepsFor(deptId) {
  return subDepartments.value.filter(s => s.department === deptId)
}

async function fetchEmployees(department = '', subDepartment = '') {
  const supervisorId = getStoredSupervisorId()
  const params = []
  const deptId = department || selectedDepartment.value || supervisorDepartmentId.value
  const subId = subDepartment || selectedSubDepartment.value
  if (supervisorId) params.push(`supervisor=${supervisorId}`)
  if (deptId) params.push(`department=${deptId}`)
  if (subId) params.push(`subDepartment=${subId}`)
  const url = `/api/employees${params.length ? `?${params.join('&')}` : ''}`
  try {
    const empRes = await apiFetch(url)
    if (!empRes.ok) throw new Error('Failed to fetch employees')
    const empData = await empRes.json()
    const deptMap = departments.value.reduce((acc, d) => {
      acc[d._id] = d.name
      return acc
    }, {})
    const subMap = subDepartments.value.reduce((acc, s) => {
      acc[s._id] = s.name
      return acc
    }, {})
    const normalized = empData
      .map(e => {
        const id = e?._id ?? e?.id ?? ''
        const deptId = e?.department ?? ''
        const subId = e?.subDepartment ?? ''
        const normalizedId = id ? String(id) : ''
        const normalizedDept = deptId ? String(deptId) : ''
        const normalizedSub = subId ? String(subId) : ''
        return {
          _id: normalizedId,
          name: e.name,
          departmentId: normalizedDept,
          subDepartmentId: normalizedSub,
          department: deptMap[normalizedDept] || '',
          subDepartment: subMap[normalizedSub] || ''
        }
      })
    let next = sortEmployeesByDept(normalized)
    if (includeSelf.value && showIncludeSelfToggle.value) {
      const supervisorIdStr = supervisorId ? String(supervisorId) : ''
      if (supervisorIdStr && !next.some(e => e._id === supervisorIdStr)) {
        next = sortEmployeesByDept([
          ...next,
          {
            _id: supervisorIdStr,
            name: supervisorProfile.value?.name || '主管本人',
            departmentId: supervisorDepartmentId.value || '',
            subDepartmentId: supervisorSubDepartmentId.value || '',
            department: supervisorDepartmentName.value || '',
            subDepartment: supervisorSubDepartmentName.value || ''
          }
        ])
      }
    }
    employees.value = next
    pruneSelections()
  } catch (err) {
    console.error(err)
    ElMessage.error('取得員工資料失敗')
  }
}

async function fetchSummary() {
  try {
    const params = [`month=${currentMonth.value}`]
    if (includeSelf.value && showIncludeSelfToggle.value) {
      params.push('includeSelf=true')
    }
    const res = await apiFetch(`/api/schedules/summary?${params.join('&')}`)
    if (res.ok) {
      const data = await res.json()
      summary.value = {
        direct: data.length,
        unscheduled: data.filter(e => e.shiftCount === 0).length,
        onLeave: data.filter(e => e.leaveCount > 0).length
      }
    }
  } catch (err) {
    console.error(err)
  }
}

async function onMonthChange(value) {
  const next = value ? dayjs(value) : dayjs()
  currentMonth.value = next.isValid() ? next.format('YYYY-MM') : dayjs().format('YYYY-MM')
  await fetchSchedules()
  await fetchSummary()
}

onMounted(async () => {
  const supervisorId = getSupervisorIdFromStorage()
  const storedPreference = loadIncludeSelfPreference(supervisorId)
  if (storedPreference === true && showIncludeSelfToggle.value) {
    includeSelf.value = true
  }
  try {
    await fetchSummary()
    await fetchShiftOptions()
    await fetchSupervisorContext()
    await fetchOptions()
    await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
    await fetchSchedules()
  } finally {
    isInitializingIncludeSelf = false
  }
})
</script>

<style scoped lang="scss">
@use "element-plus/theme-chalk/src/common/var.scss" as *;

/* Modern HR system styling with professional design */
.schedule-page {
  padding: 24px;
  background: linear-gradient(135deg, #f8fafc 0%, #ecfeff 100%);
  min-height: 100vh;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

.page-header {
  margin-bottom: 32px;
  text-align: center;
  
  .page-title {
    font-size: 2.5rem;
    font-weight: 800;
    color: #164e63;
    margin: 0 0 8px 0;
    letter-spacing: -0.025em;
  }
  
  .page-subtitle {
    font-size: 1.125rem;
    color: #475569;
    margin: 0;
    font-weight: 400;
  }
}

.filters-card, .publish-card, .actions-card, .schedule-card, .approval-card {
  background: white;
  border-radius: 16px;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
  margin-bottom: 24px;
  overflow: hidden;
  border: 1px solid #ecfeff;
}

.filters-card {
  .filters-header {
    background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
    padding: 20px 24px;
    
    .filters-title {
      color: white;
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0;
    }
  }
  
  .filters-content {
    padding: 24px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 20px;
  }
  
  .filter-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    
    .filter-label {
      font-weight: 600;
      color: #164e63;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  }
}

.publish-card {
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 24px;

  .publish-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;

    .publish-header-text {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .publish-title {
      font-size: 1.5rem;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
    }

    .publish-subtitle {
      margin: 0;
      color: #475569;
      font-size: 0.95rem;
    }
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    padding: 8px 16px;
    font-weight: 600;
    font-size: 0.95rem;
    text-transform: none;
    letter-spacing: 0.02em;

    &.status-draft {
      background: rgba(148, 163, 184, 0.16);
      color: #475569;
    }

    &.status-pending {
      background: rgba(249, 115, 22, 0.18);
      color: #c2410c;
    }

    &.status-ready {
      background: rgba(34, 197, 94, 0.18);
      color: #166534;
    }

    &.status-disputed {
      background: rgba(248, 113, 113, 0.2);
      color: #b91c1c;
    }

    &.status-finalized {
      background: rgba(59, 130, 246, 0.18);
      color: #1d4ed8;
    }
  }

  .publish-progress {
    padding: 16px 20px;
    border-radius: 16px;
    background: linear-gradient(135deg, rgba(14, 116, 144, 0.08), rgba(45, 212, 191, 0.08));

    .el-step__title.is-success,
    .el-step__description.is-success {
      color: #0f172a;
    }

    .el-step__title.is-error,
    .el-step__description.is-error {
      color: #b91c1c;
    }

    .el-step__description {
      font-size: 0.85rem;
      color: #475569;
    }
  }

  .publish-meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 12px 20px;

    .publish-meta {
      margin: 0;
      color: #0f172a;
      font-weight: 500;
    }

    .publish-progress-indicator {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 160px;

      .el-progress {
        flex: 1 1 120px;
      }

      .progress-label {
        font-size: 0.85rem;
        color: #0f172a;
        font-weight: 600;
      }
    }
  }

  .publish-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;

    .publish-btn {
      min-width: 140px;
      border-radius: 999px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
  }

  .publish-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 16px;
  }

  .status-card {
    border-radius: 16px;
    padding: 20px;
    border: 1px solid transparent;
    background: #f8fafc;
    display: flex;
    flex-direction: column;
    gap: 12px;

    &.pending {
      background: rgba(250, 204, 21, 0.18);
      border-color: rgba(217, 119, 6, 0.45);
    }

    &.disputed {
      background: rgba(248, 113, 113, 0.12);
      border-color: rgba(220, 38, 38, 0.45);
    }

    &.ready {
      background: rgba(134, 239, 172, 0.18);
      border-color: rgba(34, 197, 94, 0.45);
    }

    &.finalized {
      background: rgba(191, 219, 254, 0.28);
      border-color: rgba(37, 99, 235, 0.4);
    }

    .card-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .card-title {
      font-size: 1.05rem;
      font-weight: 700;
      color: #0f172a;
    }

    .card-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 48px;
      padding: 6px 12px;
      border-radius: 999px;
      font-weight: 700;
      background: white;
      color: #0f172a;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.08);

      &.success {
        background: #10b981;
        color: white;
        box-shadow: none;
      }
    }

    .card-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .card-item {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.75);

      .card-item-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .card-name {
        font-weight: 600;
        color: #0f172a;
      }

      .card-count {
        font-weight: 600;
        color: #334155;
      }
    }

    .card-note {
      font-size: 0.85rem;
      color: #475569;
      line-height: 1.4;
    }

    .card-message {
      margin: 0;
      color: #0f172a;
      font-weight: 600;
      line-height: 1.5;
    }
  }
}

@media (max-width: 1024px) {
  .publish-card {
    padding: 24px;

    .publish-progress {
      padding: 12px 16px;
    }
  }
}

@media (max-width: 768px) {
  .publish-card {
    .publish-header {
      flex-direction: column;
      align-items: flex-start;
    }

    .publish-actions {
      flex-direction: column;
      align-items: stretch;

      .publish-btn {
        width: 100%;
      }
    }

    .publish-meta-row {
      flex-direction: column;
      align-items: flex-start;
    }
  }
}

.modern-date-picker, .modern-select {
  ::v-deep(.el-input__wrapper) {
    border-radius: 8px;
    border: 2px solid #ecfeff;
    transition: all 0.2s ease;
    
    &:hover {
      border-color: #10b981;
    }
    
    &.is-focus {
      border-color: #10b981;
      box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.1);
    }
  }
}

.actions-card {
  padding: 20px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  
  .primary-actions, .secondary-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .range-picker-wrapper {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 220px;
  }

  .range-label {
    font-weight: 600;
    color: #164e63;
    font-size: 0.75rem;
    letter-spacing: 0.05em;
  }

  .range-picker {
    width: 240px;
  }
}

.action-btn {
  border-radius: 8px;
  font-weight: 600;
  padding: 12px 20px;
  transition: all 0.2s ease;
  
  &.primary {
    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    border: none;
    color: white;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.4);
    }
  }

  &.primary.is-disabled,
  &.primary:disabled {
    background: linear-gradient(135deg, #94a3b8 0%, #64748b 100%);
    box-shadow: none;
    transform: none;
    cursor: not-allowed;
    color: rgba(255, 255, 255, 0.85);
  }

  &.primary.is-disabled:hover,
  &.primary:disabled:hover {
    transform: none;
    box-shadow: none;
  }

  &.secondary {
    background: white;
    border: 2px solid #164e63;
    color: #164e63;
    
    &:hover {
      background: #164e63;
      color: white;
      transform: translateY(-1px);
    }
  }
  
  &.export {
    background: white;
    border: 2px solid #10b981;
    color: #10b981;
    
    &:hover {
      background: #10b981;
      color: white;
      transform: translateY(-1px);
    }
  }
}

.schedule-card {
  .schedule-header {
    background: linear-gradient(135deg, #f1f5f9 0%, #ecfeff 100%);
    padding: 20px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    
    .schedule-title {
      color: #164e63;
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0;
    }
    
    .schedule-legend {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      
      .legend-item {
        padding: 4px 12px;
        border-radius: 20px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        background: var(--shift-tag-bg, #f1f5f9);
        color: var(--shift-text-color, #475569);
        border: 1px solid var(--shift-border-color, rgba(148, 163, 184, 0.45));
      }

      .legend-item.leave {
        background: #fef3c7;
        color: #d97706;
        border: 1px solid rgba(217, 119, 6, 0.4);
      }

      .legend-empty {
        font-size: 0.75rem;
        color: #64748b;
        padding: 4px 0;
      }
    }

    .employee-search {
      max-width: 200px;
    }
    .status-filter {
      max-width: 160px;
    }
  }

  .batch-toolbar {
    padding: 16px 24px;
    background: #f8fafc;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 12px;
  }

  .batch-select {
    min-width: 180px;
  }

  .apply-btn {
    min-width: 140px;
  }
}

.modern-schedule-table {
  ::v-deep(.el-table__header) {
    th {
      border-bottom: 2px solid #ecfeff;
    }
  }
  
  ::v-deep(.el-table__row) {
    &:hover {
      background-color: #f8fafc !important;
    }
  }
}

.employee-info {
  .department-name {
    font-weight: 600;
    color: #164e63;
    font-size: 0.875rem;
  }
  
  .sub-department {
    font-size: 0.75rem;
    color: #64748b;
    margin-top: 2px;
  }
}

.employee-name {
  font-weight: 600;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 6px;
}

.row-checkbox {
  margin-right: 2px;
}

.status-icon {
  margin-right: 4px;
  &.unscheduled { color: #dc2626; }
  &.on-leave { color: #f59e0b; }
}

.day-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-weight: 600;
  color: #0f172a;
}

.day-checkbox {
  margin-left: 4px;
}

.modern-schedule-cell {
  padding: 8px;
  border-radius: 8px;
  min-height: 60px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.2s ease;
  position: relative;
  border: 1px solid rgba(203, 213, 225, 0.6);

  &.has-shift {
    background: linear-gradient(
      135deg,
      var(--shift-cell-bg-start, #f1f5f9) 0%,
      var(--shift-cell-bg-end, #e2e8f0) 100%
    );
    border: 1px solid var(--shift-border-color, #cbd5e1);
    color: var(--shift-text-color, #0f172a);
  }
  
  &.has-leave {
    background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
    border: 1px solid #fbbf24;
    cursor: not-allowed;
  }

  &.is-selected {
    box-shadow: 0 0 0 2px rgba(14, 165, 233, 0.6) inset;
    background-color: rgba(224, 242, 254, 0.6);
  }
}

.cell-selection {
  position: absolute;
  top: 4px;
  left: 4px;
  background: rgba(255, 255, 255, 0.85);
  border-radius: 4px;
  padding: 2px;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.1);
  z-index: 2;
}

.modern-schedule-cell.has-leave .cell-selection {
  display: none;
}

.collapsed-cell {
  color: #94a3b8;
  text-align: center;
}

.cell-select {
  ::v-deep(.el-input__wrapper) {
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.9);
    backdrop-filter: blur(4px);
  }
}

.department-selects {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.modern-shift-tag {
  background: var(--shift-tag-bg, white);
  color: var(--shift-text-color, #164e63);
  padding: 4px 8px;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.75rem;
  text-align: center;
  cursor: pointer;
  border: 1px solid var(--shift-border-color, rgba(22, 78, 99, 0.2));
  transition: all 0.2s ease;

  &:hover {
    background: var(--shift-border-color, #164e63);
    color: white;
    transform: scale(1.05);
  }
}

.shift-details {
  .detail-row {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    
    .detail-label {
      font-weight: 600;
      color: #475569;
    }
    
    .detail-value {
      color: #164e63;
      font-weight: 500;
    }
  }
}

.leave-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: linear-gradient(135deg, #fefce8 0%, #fef3c7 100%);
  border-radius: 8px;
  border: 1px dashed rgba(217, 119, 6, 0.45);
  padding: 6px 8px;
  color: #92400e;
  font-size: 0.75rem;
  font-weight: 600;
  text-align: center;
  min-height: 48px;
}

.leave-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(217, 119, 6, 0.12);
  border: 1px solid rgba(217, 119, 6, 0.35);
  color: #b45309;
  letter-spacing: 0.08em;
}

.leave-note {
  font-size: 0.7rem;
  font-weight: 500;
  color: #b45309;
}

.missing-shift {
  background: #fee2e2;
}

.missing-label {
  color: #b91c1c;
  font-size: 0.75rem;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  &::before {
    content: '⚠';
    margin-right: 4px;
  }
}

.empty-cell {
  color: #94a3b8;
  font-size: 1.25rem;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.approval-card {
  .approval-header {
    background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
    padding: 20px 24px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    
    .approval-title {
      color: white;
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0;
    }
    
    .approval-count {
      background: rgba(255, 255, 255, 0.2);
      color: white;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.875rem;
      font-weight: 600;
    }
  }
}

.modern-approval-table {
  ::v-deep(.el-table__row) {
    &:hover {
      background-color: #f8fafc !important;
    }
  }
}

.applicant-name, .form-type {
  font-weight: 500;
  color: #1e293b;
}

.status-tag {
  font-weight: 600;
  border-radius: 6px;
}

@media (max-width: 768px) {
  .schedule-page {
    padding: 16px;
  }
  
  .page-header .page-title {
    font-size: 2rem;
  }
  
  .filters-content {
    grid-template-columns: 1fr;
  }
  
  .actions-card {
    flex-direction: column;
    align-items: stretch;
    
    .primary-actions, .secondary-actions {
      justify-content: center;
    }
  }
  
  .schedule-header {
    flex-direction: column;
    align-items: flex-start;
  }
  
  .modern-schedule-table {
    ::v-deep(.el-table__fixed-column--left) {
      z-index: 10;
    }
  }
}
</style>
