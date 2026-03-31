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
          <el-date-picker v-model="currentMonth" type="month" value-format="YYYY-MM" @change="onMonthChange"
            class="modern-date-picker" />
        </div>
        <div class="filter-group" :class="{ 'filter-group-hidden': shouldHideDepartmentFilters }">
          <label class="filter-label">部門</label>
          <el-select v-model="selectedDepartment" placeholder="請選擇部門" @change="onDepartmentChange" :disabled="true"
            class="modern-select">
            <el-option v-for="dept in departments" :key="dept._id" :label="dept.name" :value="dept._id" />
          </el-select>
        </div>
        <div class="filter-group" :class="{ 'filter-group-hidden': shouldHideDepartmentFilters }">
          <label class="filter-label">單位</label>
          <el-select v-model="selectedSubDepartment" placeholder="請選擇單位" @change="onSubDepartmentChange"
            class="modern-select">
            <el-option v-for="sub in filteredSubDepartments" :key="sub._id" :label="sub.name" :value="sub._id" />
          </el-select>
        </div>
        <div v-if="showIncludeSelfToggle" class="filter-group include-self-group">
          <label class="filter-label">包含自己</label>
          <el-switch v-model="includeSelf" active-text="是" inactive-text="否" inline-prompt />
        </div>
      </div>
    </div>

    <div v-if="canEditSchedule" class="publish-card">
      <div class="publish-header">
        <div class="publish-header-text">
          <h3 class="publish-title">發布狀態</h3>
          <p class="publish-subtitle">追蹤班表送審、回覆與鎖定流程</p>
        </div>
        <span class="status-badge" :class="`status-${publishSummary.status}`" data-test="publish-status-badge">
          {{ publishStatusLabel }}
        </span>
      </div>

      <div class="publish-progress" data-test="publish-steps">
        <el-steps :active="publishStepIndex" finish-status="success" align-center>
          <el-step title="草稿" description="建立班表草稿" :status="stepStatuses.draft" />
          <el-step title="待確認" :description="pendingStepDescription" :status="stepStatuses.pending" />
          <el-step title="異議" :description="disputeStepDescription" :status="stepStatuses.disputed" />
          <el-step title="完成" :description="finalStepDescription" :status="stepStatuses.finalized" />
        </el-steps>
      </div>

      <div class="publish-meta-row">
        <p class="publish-meta" v-if="publishSummary.publishedAt" data-test="publish-meta">
          最近發布：{{ formatPublishDate(publishSummary.publishedAt) }}
        </p>
        <p class="publish-meta" v-else data-test="publish-meta">本月尚未發布。</p>
        <div v-if="publishProgress > 0 && publishSummary.status !== 'finalized'" class="publish-progress-indicator">
          <el-progress :percentage="publishProgress" :stroke-width="8" status="success" :show-text="false" />
          <span class="progress-label">{{ publishProgress }}% 完成</span>
        </div>
      </div>

      <div class="publish-actions">
        <el-button type="primary" class="publish-btn" :loading="isPublishing" :disabled="publishDisabled"
          @click="confirmPublish">
          發送待確認
        </el-button>
        <el-button type="success" plain class="publish-btn" :loading="isFinalizing" :disabled="finalizeDisabled"
          @click="confirmFinalize">
          完成發布
        </el-button>
      </div>
      <div v-if="publishDisabled || finalizeDisabled" class="publish-disable-reasons" data-test="publish-disable-reasons">
        <p v-if="publishDisabledReason" class="publish-disable-reason">
          發送待確認不可點：{{ publishDisabledReason }}
        </p>
        <p v-if="finalizeDisabledReason" class="publish-disable-reason">
          完成發布不可點：{{ finalizeDisabledReason }}
        </p>
      </div>

      <div class="publish-stats">
        <div v-if="pendingCount" class="status-card pending" data-test="pending-card">
          <div class="card-header">
            <span class="card-title">待回覆</span>
            <span class="card-badge">{{ pendingCount }}</span>
          </div>
          <ul class="card-list">
            <li v-for="emp in publishSummary.pendingEmployees" :key="emp.id" class="card-item">
              <span class="card-name">{{ emp.name }}</span>
              <span class="card-count">{{ emp.pendingCount }} 筆</span>
            </li>
          </ul>
        </div>

        <div v-if="disputedCount" class="status-card disputed" data-test="disputed-card">
          <div class="card-header">
            <span class="card-title">異議</span>
            <span class="card-badge">{{ disputedCount }}</span>
          </div>
          <ul class="card-list">
            <li v-for="emp in publishSummary.disputedEmployees" :key="emp.id" class="card-item">
              <div class="card-item-main">
                <span class="card-name">{{ emp.name }}</span>
                <span class="card-count">{{ emp.disputedCount }} 筆</span>
              </div>
              <div v-if="emp.disputes && emp.disputes.length > 0" class="disputes-list">
                <div v-for="(dispute, idx) in emp.disputes" :key="idx" class="dispute-item">
                  <div class="dispute-date">
                    {{ formatDisputeDate(dispute.date) }}
                  </div>
                  <div v-if="dispute.note" class="dispute-note">
                    {{ dispute.note }}
                  </div>
                  <div v-else class="dispute-note empty">
                    （無具體說明）
                  </div>
                </div>
              </div>
            </li>
          </ul>
        </div>

        <div v-if="
          !pendingCount &&
          !disputedCount &&
          publishSummary.status !== 'draft' &&
          publishSummary.status !== 'finalized'
        " class="status-card ready" data-test="ready-card">
          <div class="card-header">
            <span class="card-title">回覆完成</span>
            <span class="card-badge success">✓</span>
          </div>
          <p class="card-message">所有員工已完成回覆，可執行最終發布。</p>
        </div>

        <div v-if="publishSummary.status === 'finalized'" class="status-card finalized" data-test="finalized-card">
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
        <el-button type="primary" class="action-btn primary" @click="clearSelection" :disabled="!hasAnySelection">
          <i class="el-icon-close"></i>
          清除選取
        </el-button>
        <el-button type="primary" class="action-btn primary" plain @click="selectAllEmployeesOnPage"
          :disabled="!employees.length">
          <i class="el-icon-user"></i>
          本頁全選
        </el-button>
        <el-button type="primary" class="action-btn primary" plain @click="selectAllEmployeesAcrossPages"
          :loading="isSelectingAllEmployeesAcrossPages"
          :disabled="!serverPaginationTotal || isSelectingAllEmployeesAcrossPages">
          <i class="el-icon-user-solid"></i>
          全部人員全選
        </el-button>
        <el-button type="primary" class="action-btn primary" plain @click="selectAllDays" :disabled="!days.length">
          <i class="el-icon-date"></i>
          全選日期
        </el-button>
      </div>
      <p v-if="selectedEmployeesSet.size > 0" class="selection-scope-hint" data-test="selection-scope-hint">
        {{ allEmployeesSelectionHint }}
      </p>
      <div class="secondary-actions">
        <div class="range-picker-wrapper">
          <label class="range-label">自訂日期範圍</label>
          <el-date-picker v-model="customRange" type="daterange" start-placeholder="開始日期" end-placeholder="結束日期"
            range-separator="至" unlink-panels :disabled="!days.length" class="modern-date-picker range-picker"
            @change="onCustomRangeChange" />
        </div>
        <el-button @click="preview('week')" class="action-btn secondary">
          <i class="el-icon-calendar"></i>
          預覽週表
        </el-button>
        <el-button @click="preview('month')" class="action-btn secondary">
          <i class="el-icon-date"></i>
          預覽月表
        </el-button>
        <el-button @click="exportPdf" class="action-btn export">
          <i class="el-icon-download"></i>
          匯出 PDF
        </el-button>
        <el-button @click="exportExcel" class="action-btn export">
          <i class="el-icon-s-grid"></i>
          匯出 Excel
        </el-button>
      </div>
    </div>

    <!-- Enhanced schedule table with modern design -->
    <div ref="scheduleCardRef" class="schedule-card" :class="{ 'is-fullscreen': isTableFullscreen }" data-test="schedule-card">
      <div
        ref="fullscreenPopperHostRef"
        class="schedule-fullscreen-popper-host"
        data-test="fullscreen-popper-host"
      ></div>
      <div ref="scheduleHeaderRef" class="schedule-header">
        <div class="schedule-title-wrapper">
          <h3 class="schedule-title">員工排班表</h3>
          <p v-if="isTableFullscreen" class="fullscreen-filter-hint">
            目前部門/單位：{{ fullscreenFilterHint }}
          </p>
        </div>
        <el-button class="action-btn secondary fullscreen-toggle" @click="toggleTableFullscreen"
          data-test="fullscreen-toggle-button">
          {{ isTableFullscreen ? '退出全螢幕' : '進入全螢幕' }}
        </el-button>
        <el-button v-if="isTableFullscreen" class="action-btn secondary fullscreen-collapse-toggle"
          @click="toggleFullscreenToolbar" data-test="fullscreen-toolbar-toggle-button">
          {{ isFullscreenToolbarCollapsed ? '展開上方工具' : '隱藏上方工具' }}
        </el-button>
        <div v-show="!isTableFullscreen || !isFullscreenToolbarCollapsed" class="schedule-legend" data-test="schedule-legend">
          <template v-if="legendShifts.length">
            <span v-for="legend in legendShifts" :key="legend.key" class="legend-item" :style="legend.style"
              data-test="shift-legend-item">
              {{ legend.label }}
            </span>
          </template>
          <span v-else class="legend-empty" data-test="shift-legend-empty">
            尚未設定班別
          </span>
          <span class="legend-item leave">請假</span>
        </div>
        <el-input v-show="!isTableFullscreen || !isFullscreenToolbarCollapsed" v-model="employeeSearch" placeholder="搜尋員工"
          clearable class="employee-search" />
        <el-select v-show="!isTableFullscreen || !isFullscreenToolbarCollapsed" v-model="statusFilter" placeholder="狀態"
          class="status-filter">
          <el-option label="全部" value="all" />
          <el-option label="缺班" value="unscheduled" />
          <el-option label="待審核請假" value="onLeave" />
        </el-select>
        <p
          v-if="shouldUseVirtualRender && visibleEmployees.length > 0"
          class="virtual-render-hint"
          data-test="virtual-render-hint"
        >
          目前共 {{ serverPaginationTotal }} 位員工，為提升效能已啟用虛擬顯示，請在表格中上下滾動查看全部資料。
        </p>
      </div>

      <div
        ref="batchToolbarRef"
        v-if="canEditSchedule"
        v-show="!isTableFullscreen || !isFullscreenToolbarCollapsed"
        class="batch-toolbar"
      >
        <el-select v-model="batchShiftId" placeholder="套用班別" class="modern-select batch-select" filterable
          data-test="batch-shift-select">
          <el-option v-for="opt in shifts" :key="opt._id" :label="formatShiftLabel(opt)" :value="opt._id" />
        </el-select>
        <el-select v-model="batchDepartment" placeholder="套用部門" clearable class="modern-select batch-select"
          data-test="batch-dept-select">
          <el-option v-for="dept in departments" :key="dept._id" :label="dept.name" :value="dept._id" />
        </el-select>
        <el-select v-model="batchSubDepartment" placeholder="套用單位" clearable class="modern-select batch-select"
          :disabled="!batchDepartment" data-test="batch-subdept-select">
          <el-option v-for="sub in batchSubDepartments" :key="sub._id" :label="sub.name" :value="sub._id" />
        </el-select>
        <el-select v-model="batchRowColorIndex" placeholder="設定整列顏色" clearable class="modern-select batch-select"
          data-test="batch-row-color-select">
          <el-option v-for="opt in rowColorOptions" :key="opt.index" :label="opt.label" :value="opt.index">
            <span class="row-color-option">
              <span class="row-color-dot" :style="{ backgroundColor: opt.bg, borderColor: opt.border }"></span>
              {{ opt.label }}
            </span>
          </el-option>
        </el-select>
        <el-button class="action-btn secondary apply-btn" :disabled="!canApplyRowColor" @click="applyRowColor"
          data-test="batch-row-color-apply">
          套用列色
        </el-button>
        <el-button class="action-btn secondary apply-btn" plain :disabled="!selectedEmployeesSet.size" @click="clearRowColor"
          data-test="batch-row-color-clear">
          清除列色
        </el-button>
        <el-button type="primary" class="action-btn primary apply-btn"
          :disabled="!hasAnySelection || !batchShiftId || isApplyingBatch" :loading="isApplyingBatch"
          @click="applyBatch" data-test="batch-apply-button">
          套用至選取
        </el-button>
        <span class="row-color-hint">列色僅暫存於目前瀏覽器 session</span>
      </div>
      <div
        ref="stressToolbarRef"
        v-if="stressScenarioEnabled"
        v-show="!isTableFullscreen || !isFullscreenToolbarCollapsed"
        class="stress-toolbar"
        data-test="stress-toolbar"
      >
        <el-button class="action-btn secondary" @click="seedStressScenario">
          建立壓測場景（200 員工 × 31 天）
        </el-button>
        <span class="stress-metric">
          可見格數：{{ virtualVisibleEmployees.length * virtualVisibleDays.length }}
          / 全部格數：{{ visibleEmployees.length * days.length }}
        </span>
        <span class="stress-metric">
          預估 DOM 節點：{{ estimatedRenderedNodes }}
        </span>
        <span class="stress-metric">
          最近互動延遲：{{ lastInteractionLatencyMs }}ms
        </span>
        <span class="stress-metric">
          status重算：{{ perfSnapshot.employeeStatusRecomputeCount }} 次 / {{ perfSnapshot.employeeStatusAvgMs }}ms
        </span>
        <span class="stress-metric">
          cellMeta計算：{{ perfSnapshot.cellMetaComputeCount }} 次 / {{ perfSnapshot.cellMetaAvgMs }}ms
        </span>
      </div>

      <div ref="scheduleTableWrapperRef" class="schedule-table-wrapper" :class="{ 'is-fullscreen': isTableFullscreen }"
        data-test="schedule-table-wrapper" @click.capture="handleTableDelegatedClick"
        @change.capture="handleTableDelegatedChange">
        <el-table ref="scheduleTableRef" class="modern-schedule-table" :data="virtualVisibleEmployees" :max-height="tableMaxHeight" :header-cell-style="{
          backgroundColor: '#ecfeff',
          color: '#164e63',
          fontWeight: '600'
        }" :row-style="scheduleRowStyle" :row-class-name="scheduleRowClassName">
        <el-table-column prop="name" label="員工姓名" width="180" fixed="left">
          <template #default="{ row }">
            <div class="employee-name">
              <el-checkbox v-if="canEditSchedule" class="row-checkbox" :model-value="selectedEmployeesSet.has(row._id)"
                :data-schedule-action="'toggle-employee'" :data-emp-id="String(row._id)" />
              <span class="employee-name-text" :title="row.name || '-'">
                {{ row.name || '-' }}
              </span>
              <span class="employee-status-secondary" aria-label="排班狀態">
                <component
                  v-if="(employeeStatusMap[row._id] || employeeStatus(row._id)) === 'unscheduled'"
                  :is="CircleCloseFilled"
                  class="status-icon unscheduled"
                />
                <component
                  v-else-if="(employeeStatusMap[row._id] || employeeStatus(row._id)) === 'onLeave'"
                  :is="WarningFilled"
                  class="status-icon on-leave"
                />
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="subDepartmentName" label="單位" width="160" fixed="left" class-name="sub-department-column">
          <template #default="{ row }">
            <span class="sub-department-text" :title="row.subDepartmentName || row.subDepartment || '-'">
              {{ row.subDepartmentName || row.subDepartment || '-' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="職稱 / 職位" width="220" fixed="left" class-name="title-position-column">
          <template #default="{ row }">
            <div class="title-position-cell">
              <span class="title-line">{{ row.title || '-' }}</span>
              <span class="practice-title-line">{{ row.practiceTitle || '-' }}</span>
            </div>
          </template>
        </el-table-column>
        
        <el-table-column label="特休剩餘" width="120" fixed="left">
          <template #default="{ row }">
            <div v-if="row.annualLeave" class="annual-leave-info">
              <el-tag size="small" type="info">
                {{ row.annualLeave.remainingDays || 0 }}天
              </el-tag>
              <span class="leave-hours">
                ({{ (row.annualLeave.remainingDays || 0) * 8 }}小時)
              </span>
            </div>
            <span v-else class="no-leave-info">-</span>
          </template>
        </el-table-column>

        <el-table-column
          v-if="virtualLeadingSpacerWidth > 0"
          key="virtual-leading-spacer"
          label=""
          :width="virtualLeadingSpacerWidth"
          align="center"
        >
          <template #default>
            <div class="virtual-spacer-cell" aria-hidden="true"></div>
          </template>
        </el-table-column>

        <el-table-column v-for="d in virtualVisibleDays" :key="d.date" :label="d.label" :width="dayColumnWidth" align="center">
          <template #header>
            <div class="day-header">
              <span>{{ d.label }}</span>
              <el-checkbox v-if="canEditSchedule" class="day-checkbox" :model-value="selectedDaysSet.has(d.date)"
                :data-schedule-action="'toggle-day'" :data-day="String(d.date)" />
            </div>
          </template>

          <template #default="{ row }">
            <ScheduleGridVirtualBody
              :row="row"
              :day="d"
              :cell-view="getRenderedCell(row._id, d.date)"
              :can-edit="canEditSchedule"
              :shifts="shifts"
              :format-shift-label="formatShiftLabel"
              :is-fullscreen="isTableFullscreen"
              :fullscreen-popper-target="fullscreenPopperTarget"
              @select-shift="onSelect"
            />
          </template>
        </el-table-column>

        <el-table-column
          v-if="virtualTrailingSpacerWidth > 0"
          key="virtual-trailing-spacer"
          label=""
          :width="virtualTrailingSpacerWidth"
          align="center"
        >
          <template #default>
            <div class="virtual-spacer-cell" aria-hidden="true"></div>
          </template>
        </el-table-column>
        </el-table>
      </div>

      <div ref="paginationBarRef" class="pagination-bar" v-if="serverPaginationTotal > 0">
        <el-pagination background layout="prev, pager, next, ->, sizes, total" :total="serverPaginationTotal"
          :page-size="pageSize" :current-page="currentPage" :page-sizes="[20, 30, 50, 100]"
          @current-change="onPageChange" @size-change="onPageSizeChange" />
      </div>
    </div>

    <!-- Enhanced approval list with modern card design -->
    <div v-if="relatedApprovalRows.length" class="approval-card">
      <div class="approval-header">
        <h3 class="approval-title">相關簽核</h3>
        <div class="approval-count">{{ relatedApprovalRows.length }} 項</div>
        <el-button text class="approval-collapse-btn" @click="approvalCollapsed = !approvalCollapsed">
          {{ approvalCollapsed ? '展開列表' : '收合列表' }}
        </el-button>
      </div>
      <el-table class="modern-approval-table" :data="displayedApprovalRows" :header-cell-style="{
        backgroundColor: '#f1f5f9',
        color: '#164e63',
        fontWeight: '600'
      }">
        <el-table-column label="資料類型" width="120">
          <template #default="{ row }">
            <el-tag :type="row.sourceType === 'schedule_confirmation' ? 'primary' : 'info'" class="status-tag">
              {{ row.sourceTypeLabel }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="申請人" width="120">
          <template #default="{ row }">
            <div class="applicant-name">
              {{ row.applicantName }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="申請類型" width="150">
          <template #default="{ row }">
            <div class="form-type">
              {{ row.approvalType }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="期間" width="210">
          <template #default="{ row }">
            <div class="period-text">
              {{ row.periodText }}
            </div>
          </template>
        </el-table-column>
        <el-table-column prop="statusLabel" label="狀態" width="110">
          <template #default="{ row }">
            <el-tag :type="row.statusTagType" class="status-tag">
              {{ row.statusLabel }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="備註摘要" min-width="180">
          <template #default="{ row }">
            <el-tooltip v-if="row.noteSummary && row.noteSummary.length > 26" :content="row.noteSummary" placement="top">
              <span>{{ row.noteSummary.slice(0, 26) }}...</span>
            </el-tooltip>
            <span v-else>
              {{ row.noteSummary || '-' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="查看詳情" width="120">
          <template #default="{ row }">
            <el-button size="small" @click="openDetail(row._id)" :disabled="!row._id || row.sourceType !== 'leave_approval'">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <div v-if="!approvalCollapsed && relatedApprovalRows.length > approvalPageSize" class="approval-pagination">
        <el-pagination
          background
          layout="prev, pager, next"
          :total="relatedApprovalRows.length"
          :page-size="approvalPageSize"
          :current-page="approvalCurrentPage"
          @current-change="onApprovalPageChange"
        />
      </div>
      <p v-if="approvalCollapsed && hasMoreApprovals" class="approval-collapse-hint">
        僅顯示前 {{ approvalCollapsedLimit }} 筆，點擊「展開列表」檢視全部。
      </p>
    </div>
  </div>

  <el-dialog v-model="detail.visible" title="申請單明細" width="760px" destroy-on-close @closed="onDetailClosed">
    <component :is="ApprovalDetailContent" v-if="detail.visible" :approval-id="detail.approvalId" />
    <template #footer>
      <el-button @click="detail.visible = false">關閉</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, onUpdated, watch, reactive, shallowRef, triggerRef, defineAsyncComponent, nextTick } from 'vue'
import dayjs from 'dayjs'
import { apiFetch } from '../../api'
import { useAuthStore } from '../../stores/auth'
import { useMenuStore } from '../../stores/menu'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import { useRouter } from 'vue-router'
import ScheduleDashboard from './ScheduleDashboard.vue'
import ScheduleGridVirtualBody from './ScheduleGridVirtualBody.vue'
import { CircleCloseFilled, WarningFilled } from '@element-plus/icons-vue'
import { buildShiftStyle } from '../../utils/shiftColors'
import { ROW_COLOR_PALETTE, normalizeRowColorIndex, resolveRowColor } from '../../utils/rowColors'

const ApprovalDetailContent = defineAsyncComponent(() => import('./ApprovalDetailContent.vue'))
const authStore = useAuthStore()
const menuStore = useMenuStore()

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

const currentMonth = ref(dayjs().add(1, 'month').format('YYYY-MM'))



const scheduleMap = shallowRef({})
const rawSchedules = ref([])
const holidays = ref([])
const holidayMap = ref({})

const shifts = ref([])
const employees = ref([])
const employeeIndexMap = shallowRef(new Map())
const employeeById = computed(() => Object.fromEntries(employeeIndexMap.value))
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
const perfMetrics = reactive({
  employeeStatusRecomputeCount: 0,
  employeeStatusTotalMs: 0,
  cellMetaComputeCount: 0,
  cellMetaTotalMs: 0
})
const employeeSearch = ref('')
const statusFilter = ref('all')
const selectedEmployees = ref(new Set())
const allEmployeesForSelection = ref(new Set())
const selectedAllEmployeesAcrossPages = ref(false)
const isSelectingAllEmployeesAcrossPages = ref(false)
const selectedDays = ref(new Set())
const manualSelectedCells = ref(new Set())
const selectedCellsCache = ref(new Map())
const customRange = ref([])
const batchShiftId = ref('')
const batchDepartment = ref('')
const batchSubDepartment = ref('')
const batchRowColorIndex = ref(null)
const rowColorAssignments = ref({})
const ROW_COLOR_SESSION_KEY = 'schedule-row-colors'
const isApplyingBatch = ref(false)
const isPublishing = ref(false)
const isFinalizing = ref(false)
const isTableFullscreen = ref(false)
const isFullscreenToolbarCollapsed = ref(false)
const scheduleCardRef = ref(null)
const fullscreenPopperHostRef = ref(null)
const scheduleHeaderRef = ref(null)
const batchToolbarRef = ref(null)
const stressToolbarRef = ref(null)
const paginationBarRef = ref(null)
const scheduleTableWrapperRef = ref(null)
const scheduleTableRef = ref(null)
const measuredLayoutHeight = ref(0)
const listenerMetrics = reactive({
  delegatedActive: 0,
  elementLevelEstimated: 0
})
let layoutResizeObserver = null
let tableBodyScrollEl = null
let tableHeaderScrollEl = null
let tableScrollRaf = null
let managedResizeHandler = null
const viewportHeight = ref(
  typeof window === 'undefined' ? 900 : window.innerHeight
)
const detail = reactive({ visible: false, approvalId: '' })
const approvalCollapsed = ref(true)
const approvalCollapsedLimit = 10
const approvalPageSize = 10
const approvalCurrentPage = ref(1)
const pageSize = ref(50)
const currentPage = ref(1)
const serverPaginationTotal = ref(0)
const renderStrategyPreference = ref('auto')
const rowRange = ref({ start: 0, end: 0 })
const columnRange = ref({ start: 0, end: 0 })
const lastInteractionLatencyMs = ref(0)
const stressScenarioEnabled = computed(() => {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search || '')
  return params.get('stress') === '1'
})
const perfSnapshot = computed(() => {
  const statusAvg = perfMetrics.employeeStatusRecomputeCount
    ? perfMetrics.employeeStatusTotalMs / perfMetrics.employeeStatusRecomputeCount
    : 0
  const cellMetaAvg = perfMetrics.cellMetaComputeCount
    ? perfMetrics.cellMetaTotalMs / perfMetrics.cellMetaComputeCount
    : 0
  return {
    employeeStatusRecomputeCount: perfMetrics.employeeStatusRecomputeCount,
    employeeStatusAvgMs: Number(statusAvg.toFixed(2)),
    cellMetaComputeCount: perfMetrics.cellMetaComputeCount,
    cellMetaAvgMs: Number(cellMetaAvg.toFixed(2))
  }
})
const publishSnapshot = ref(null)
const PUBLISHED_MONTH_HINT_KEY = 'my-schedule:published-month-hint'
const loadedEmployeeIds = ref(new Set())
const isFetchingSchedules = ref(false)
const activeScheduleRequest = {
  key: '',
  requestId: 0,
  promise: null
}
const scheduleRequestStats = {
  started: 0,
  deduped: 0,
  completed: 0
}
const fetchAllCache = {
  fulfilled: new Set(),
  inFlight: new Map()
}
const FILTER_DEBOUNCE_MS = 200
let filterRefreshTimer = null
const invalidateFetchAllCache = () => {
  fetchAllCache.fulfilled.clear()
}

const debugScheduleRequest = (event, extra = {}) => {
  if (!import.meta.env.DEV) return
  console.debug('[ScheduleRequest]', event, {
    ...scheduleRequestStats,
    ...extra
  })
}

const APPROVAL_STATUS_LABELS = {
  pending: '待簽核',
  disputed: '有異議',
  confirmed: '已確認',
  approved: '已核准',
  rejected: '已駁回'
}

const APPROVAL_STATUS_TAG_MAP = {
  pending: 'warning',
  disputed: 'danger',
  confirmed: 'success',
  approved: 'success',
  rejected: 'danger'
}

// ========= includeSelf 偏好存取 =========

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

// ========= 選取相關的基礎結構 =========

const selectedEmployeesSet = computed(() => selectedEmployees.value)
const selectedDaysSet = computed(() => selectedDays.value)
const manualSelectedCellsSet = computed(() => manualSelectedCells.value)

const rowColorOptions = computed(() => ROW_COLOR_PALETTE)

const canApplyRowColor = computed(() => {
  const hasEmployees = selectedEmployeesSet.value.size > 0
  const index = normalizeRowColorIndex(batchRowColorIndex.value)
  return hasEmployees && index !== null
})

// ✅ 用 "::" 當分隔，避免 ObjectId 裡面的 "-" 把字串拆爛
const buildCellKey = (empId, day) => `${empId}::${day}`

const parseCellKey = key => {
  const str = String(key)
  const idx = str.lastIndexOf('::')
  if (idx === -1) {
    return { empId: str, day: NaN }
  }
  const empId = str.slice(0, idx)
  const day = Number(str.slice(idx + 2))
  return { empId, day }
}

// ✅ 這個月所有「已核准」請假的快取：{ [empId]: { [dayNumber]: true } }
const leaveIndex = shallowRef({})

// 只用 leaveIndex 判斷該格是不是請假日
const isLeaveCell = (empId, day) => {
  const empLeaves = leaveIndex.value[String(empId)]
  if (!empLeaves) return false
  return !!empLeaves[Number(day)]
}

const shiftInfoMap = computed(() => {
  const map = new Map()
  shifts.value.forEach(shift => {
    const key = String(shift?._id || '')
    if (key) map.set(key, shift)
  })
  return map
})

const employeeStatusMap = shallowRef({})
const cellMetaCache = shallowRef(new Map())

const markScheduleMapDirty = () => triggerRef(scheduleMap)
const markLeaveIndexDirty = () => triggerRef(leaveIndex)

const invalidateCellMetaCache = (empId = '', day = null) => {
  if (!empId) {
    cellMetaCache.value = new Map()
    return
  }
  const next = new Map(cellMetaCache.value)
  if (day === null) {
    const prefix = `${String(empId)}::`
    for (const key of next.keys()) {
      if (key.startsWith(prefix)) next.delete(key)
    }
  } else {
    next.delete(buildCellKey(String(empId), Number(day)))
  }
  cellMetaCache.value = next
}

const recomputeEmployeeStatusFor = empId => {
  const startAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const safeEmpId = String(empId || '')
  if (!safeEmpId) return
  const daysMap = scheduleMap.value[safeEmpId] || {}
  const cells = Object.values(daysMap)
  let status = 'scheduled'
  if (!cells.length) {
    status = 'unscheduled'
  } else {
    const hasAnyEmptyDay = cells.some(c => !c.shiftId && !c.leave && !isLeaveCell(safeEmpId, c.day))
    const hasAnyLeave = cells.some(c => c.leave || isLeaveCell(safeEmpId, c.day))
    if (hasAnyEmptyDay) status = 'unscheduled'
    else if (hasAnyLeave) status = 'onLeave'
  }
  employeeStatusMap.value = {
    ...employeeStatusMap.value,
    [safeEmpId]: status
  }
  const endAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  perfMetrics.employeeStatusRecomputeCount += 1
  perfMetrics.employeeStatusTotalMs += endAt - startAt
}

const recomputeEmployeeStatuses = empIds => {
  ;(Array.isArray(empIds) ? empIds : []).forEach(empId => recomputeEmployeeStatusFor(empId))
}

const getCellMeta = (empId, day) => {
  const startAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const key = buildCellKey(String(empId), Number(day))
  const cached = cellMetaCache.value.get(key)
  if (cached) return cached
  const isLeave = isLeaveCell(empId, day)
  const shiftId = scheduleMap.value?.[empId]?.[day]?.shiftId
  const computedMeta = {
    isLeave,
    hasShift: !isLeave && !!shiftId,
    missingShift: !isLeave && !shiftId,
    style: !isLeave ? shiftClass(shiftId) : {}
  }
  const next = new Map(cellMetaCache.value)
  next.set(key, computedMeta)
  cellMetaCache.value = next
  const endAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  perfMetrics.cellMetaComputeCount += 1
  perfMetrics.cellMetaTotalMs += endAt - startAt
  return computedMeta
}

const cellViewMap = computed(() => {
  const map = new Map()
  const visibleRows = virtualVisibleEmployees.value
  const visibleDays = virtualVisibleDays.value
  for (let i = 0; i < visibleRows.length; i++) {
    const row = visibleRows[i]
    const empId = String(row?._id || '')
    if (!empId) continue
    for (let j = 0; j < visibleDays.length; j++) {
      const day = visibleDays[j].date
      const cellKey = buildCellKey(empId, day)
      const scheduleCell = scheduleMap.value?.[empId]?.[day] || null
      const cellMeta = getCellMeta(empId, day)
      const shiftInfo = scheduleCell?.shiftId
        ? shiftInfoMap.value.get(String(scheduleCell.shiftId)) || null
        : null
      map.set(cellKey, {
        key: cellKey,
        cellMeta,
        leaveTitle: cellMeta.isLeave ? '已核准請假，該日不列入工作時數' : '',
        isSelected: isCellSelected(empId, day),
        isManualSelected: manualSelectedCellsSet.value.has(cellKey),
        scheduleCell,
        shiftInfo
      })
    }
  }
  return map
})

const getRenderedCell = (empId, day) => {
  const cellKey = buildCellKey(String(empId), Number(day))
  const cached = cellViewMap.value.get(cellKey)
  if (cached) return cached
  const safeEmpId = String(empId)
  const safeDay = Number(day)
  const scheduleCell = scheduleMap.value?.[safeEmpId]?.[safeDay] || null
  const cellMeta = getCellMeta(safeEmpId, safeDay)
  return {
    key: cellKey,
    cellMeta,
    leaveTitle: cellMeta.isLeave ? '已核准請假，該日不列入工作時數' : '',
    isSelected: isCellSelected(safeEmpId, safeDay),
    isManualSelected: manualSelectedCellsSet.value.has(cellKey),
    scheduleCell,
    shiftInfo: scheduleCell?.shiftId
      ? shiftInfoMap.value.get(String(scheduleCell.shiftId)) || null
      : null
  }
}

// 只能選「有 cell 且不是請假日」的格子
const isSelectableCell = (empId, day) => {
  const dayMap = scheduleMap.value[empId]
  if (!dayMap) return false
  const cell = dayMap[day]
  if (!cell) return false
  return !isLeaveCell(empId, day)
}

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

const allSelectedCells = computed(
  () => new Set(selectedCellsCache.value.keys())
)

const updateSelectionCache = updater => {
  const nextCache = new Map(selectedCellsCache.value)
  updater(nextCache)
  selectedCellsCache.value = nextCache
}

const applyCacheChange = (cache, empId, day, source, isSelected) => {
  const key = buildCellKey(empId, day)

  // 不可選格子，強制清掉
  if (!isSelectableCell(empId, day)) {
    cache.delete(key)
    return
  }

  if (!isSelected) {
    const existing = cache.get(key)
    if (!existing) return
    existing[source] = false
    if (existing.manual || existing.employee || existing.day) {
      cache.set(key, existing)
    } else {
      cache.delete(key)
    }
    return
  }

  const existing = cache.get(key) || {
    manual: false,
    employee: false,
    day: false
  }
  existing[source] = true
  cache.set(key, existing)
}

const rebuildSelectionCache = () => {
  const nextCache = new Map()
  const add = (empId, day, source) => {
    if (!isSelectableCell(empId, day)) return
    const key = buildCellKey(empId, day)
    const existing = nextCache.get(key) || {
      manual: false,
      employee: false,
      day: false
    }
    existing[source] = true
    nextCache.set(key, existing)
  }

  // Process manual selections (typically small set)
  manualSelectedCells.value.forEach(key => {
    const { empId, day } = parseCellKey(key)
    add(empId, day, 'manual')
  })

  // Process selected employees x days
  if (selectedEmployees.value.size > 0) {
    const daysArray = days.value
    selectedEmployees.value.forEach(empId => {
      for (let i = 0; i < daysArray.length; i++) {
        add(empId, daysArray[i].date, 'employee')
      }
    })
  }

  // Process selected days x employees
  if (selectedDays.value.size > 0) {
    const employeesArray = employees.value
    selectedDays.value.forEach(day => {
      for (let i = 0; i < employeesArray.length; i++) {
        add(employeesArray[i]._id, day, 'day')
      }
    })
  }

  selectedCellsCache.value = nextCache
}

const hasAnySelection = computed(() => allSelectedCells.value.size > 0)

const batchSubDepartments = computed(() =>
  batchDepartment.value ? subDepsFor(batchDepartment.value) : []
)
const allEmployeesSelectionHint = computed(() =>
  selectedAllEmployeesAcrossPages.value
    ? `已全選 ${selectedEmployeesSet.value.size} 位員工（全部人員），切換分頁仍會維持勾選。`
    : `目前已選 ${selectedEmployeesSet.value.size} 位員工（本頁/手動）。`
)

// ✅ UI 上是否標成「已選取」：請假格子一律 false
const isCellSelected = (empId, day) => {
  if (!isSelectableCell(empId, day)) return false
  return allSelectedCells.value.has(buildCellKey(empId, day))
}

const pruneSelections = () => {
  const validEmployees = new Set(employees.value.map(e => e._id))
  if (selectedAllEmployeesAcrossPages.value) {
    allEmployeesForSelection.value.forEach(id => validEmployees.add(id))
  }
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
    if (
      validEmployees.has(empId) &&
      validDays.has(day) &&
      isSelectableCell(empId, day)
    ) {
      nextManual.add(buildCellKey(empId, day))
    }
  })
  manualSelectedCells.value = nextManual
  if (
    selectedAllEmployeesAcrossPages.value &&
    (selectedEmployees.value.size !== allEmployeesForSelection.value.size ||
      Array.from(allEmployeesForSelection.value).some(id => !selectedEmployees.value.has(id)))
  ) {
    selectedAllEmployeesAcrossPages.value = false
  }
  rebuildSelectionCache()
}

const clearSelection = () => {
  selectedEmployees.value = new Set()
  allEmployeesForSelection.value = new Set()
  selectedAllEmployeesAcrossPages.value = false
  selectedDays.value = new Set()
  manualSelectedCells.value = new Set()
  selectedCellsCache.value = new Map()
  customRange.value = []
}

const toggleEmployee = (empId, explicit) => {
  selectedAllEmployeesAcrossPages.value = false
  const next = new Set(selectedEmployees.value)
  const shouldSelect =
    typeof explicit === 'boolean' ? explicit : !next.has(empId)
  if (shouldSelect) {
    next.add(empId)
  } else {
    next.delete(empId)
  }
  selectedEmployees.value = next

  updateSelectionCache(cache => {
    days.value.forEach(d =>
      applyCacheChange(cache, empId, d.date, 'employee', shouldSelect)
    )
  })
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

  updateSelectionCache(cache => {
    employees.value.forEach(emp =>
      applyCacheChange(cache, emp._id, day, 'day', shouldSelect)
    )
  })
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

  updateSelectionCache(cache =>
    applyCacheChange(cache, empId, day, 'manual', shouldSelect)
  )
}

const exportPdf = () => exportSchedules('pdf')
const exportExcel = () => exportSchedules('excel')

const parseDelegatedBoolean = target => {
  if (!target) return undefined
  if (typeof target.checked === 'boolean') return target.checked
  return undefined
}

const handleTableDelegatedChange = event => {
  const target = event?.target
  if (!target) return
  const actionNode = target.closest?.('[data-schedule-action]')
  if (!actionNode) return
  const action = actionNode.dataset.scheduleAction
  if (action === 'toggle-employee') {
    const empId = actionNode.dataset.empId
    if (!empId) return
    toggleEmployee(empId, parseDelegatedBoolean(target))
    return
  }
  if (action === 'toggle-day') {
    const day = Number(actionNode.dataset.day)
    if (!Number.isFinite(day)) return
    toggleDay(day, parseDelegatedBoolean(target))
    return
  }
}

const handleTableDelegatedClick = event => {
  const target = event?.target
  if (!target) return
  const cellNode = target.closest?.('[data-schedule-cell]')
  if (!cellNode) return
  const checkboxNode = target.closest?.('.el-checkbox')
  if (!checkboxNode) return
  const empId = cellNode.dataset.empId
  const day = Number(cellNode.dataset.day)
  if (!empId || !Number.isFinite(day)) return
  const input = checkboxNode.querySelector('input[type="checkbox"]')
  toggleCell(empId, day, typeof input?.checked === 'boolean' ? input.checked : undefined)
}

const selectAllEmployeesOnPage = () => {
  selectedAllEmployeesAcrossPages.value = false
  const targetIds = filteredEmployees.value.map(e => e._id)
  const prev = selectedEmployees.value

  // 只保留「本頁 + 原本其它頁手動勾選」的邏輯
  const next = new Set(prev)

  let shouldSelectAllOnPage = false
  // 判斷：如果本頁有任何一個沒被勾，就做「本頁全選」
  if (targetIds.some(id => !next.has(id))) {
    shouldSelectAllOnPage = true
  }

  if (shouldSelectAllOnPage) {
    targetIds.forEach(id => next.add(id))
  } else {
    // 如果本頁都勾了，再按一次就「取消本頁的勾選」
    targetIds.forEach(id => next.delete(id))
  }

  selectedEmployees.value = next

  updateSelectionCache(cache => {
    targetIds.forEach(empId => {
      days.value.forEach(d => {
        if (!isSelectableCell(empId, d.date)) return
        applyCacheChange(cache, empId, d.date, 'employee', shouldSelectAllOnPage)
      })
    })
  })
}
const selectAllEmployees = selectAllEmployeesOnPage

const fetchAllEmployeeIdsForCurrentFilter = async () => {
  const maxPageSize = Math.max(Number(serverPaginationTotal.value || 0), pageSize.value, employees.value.length, 1)
  const allIds = new Set()
  let page = 1
  let totalPagesToFetch = 1
  const supervisorId = getStoredSupervisorId()

  while (page <= totalPagesToFetch) {
    const params = [`month=${currentMonth.value}`, `page=${page}`, `pageSize=${maxPageSize}`]
    const deptId = selectedDepartment.value || supervisorDepartmentId.value
    const subId = selectedSubDepartment.value
    if (supervisorId) params.push(`supervisor=${supervisorId}`)
    if (deptId) params.push(`department=${deptId}`)
    if (subId) params.push(`subDepartment=${subId}`)
    if (statusFilter.value && statusFilter.value !== 'all') {
      params.push(`status=${statusFilter.value}`)
    }
    if (employeeSearch.value) {
      params.push(`search=${encodeURIComponent(employeeSearch.value)}`)
    }
    const url = `/api/employees/schedule?${params.join('&')}`
    const res = await apiFetch(url)
    if (!res.ok) throw new Error('Failed to fetch all employee ids')
    const payload = typeof res.json === 'function' ? await res.json() : []
    const employeeList = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.employees)
        ? payload.employees
        : []
    employeeList.forEach(emp => {
      const id = String(emp?._id || emp?.id || '')
      if (id) allIds.add(id)
    })
    const pagination = payload?.pagination && typeof payload.pagination === 'object'
      ? payload.pagination
      : null
    if (pagination) {
      const total = Number(pagination.total || allIds.size)
      const size = Number(pagination.pageSize || maxPageSize || 1)
      totalPagesToFetch = Math.max(1, Math.ceil(total / Math.max(size, 1)))
    } else {
      totalPagesToFetch = 1
    }
    page += 1
  }

  return Array.from(allIds)
}

const selectAllEmployeesAcrossPages = async () => {
  if (isSelectingAllEmployeesAcrossPages.value) return
  isSelectingAllEmployeesAcrossPages.value = true
  try {
    await ensureFetchAllLoaded()
    const allIds = await fetchAllEmployeeIdsForCurrentFilter()
    const next = new Set(allIds)
    selectedEmployees.value = next
    allEmployeesForSelection.value = new Set(allIds)
    selectedAllEmployeesAcrossPages.value = allIds.length > 0
    rebuildSelectionCache()
  } catch (err) {
    console.error(err)
    ElMessage.error('全選全部人員失敗')
  } finally {
    isSelectingAllEmployeesAcrossPages.value = false
  }
}



async function refreshFrontMenu() {
  if (authStore.role !== 'supervisor') return
  try {
    await menuStore.fetchMenu()
  } catch (error) {
    // 避免影響主流程，僅在選單更新失敗時靜默略過
  }
}

async function syncIncludeSelfPreference(value) {
  if (authStore.role !== 'supervisor') return
  try {
    const res = await apiFetch('/api/schedules/preferences/include-self', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeSelf: Boolean(value) })
    })
    if (!res.ok) throw new Error('Failed to sync includeSelf preference')
  } catch (error) {
    console.warn('Failed to sync includeSelf preference', error)
  }
}

async function refreshScheduleData({
  reset = false,
  reason = 'unknown',
  fetchAll = false,
  includeSummary = true
} = {}) {
  const tasks = [fetchSchedules({ reset, fetchAll, reason })]
  if (includeSummary) {
    tasks.push(fetchSummary())
  }
  await Promise.all(tasks)
}

const scheduleDebouncedRefresh = ({ reset = true, reason = 'filters-change' } = {}) => {
  if (filterRefreshTimer) {
    clearTimeout(filterRefreshTimer)
  }
  filterRefreshTimer = setTimeout(() => {
    filterRefreshTimer = null
    refreshScheduleData({ reset, reason }).catch(err => {
      console.error(err)
    })
  }, FILTER_DEBOUNCE_MS)
}

const selectAllDays = () => {
  const prev = selectedDays.value
  const allDayValues = days.value.map(d => d.date)

  // 判斷是不是「已全選」
  const alreadyAllSelected = allDayValues.every(d => prev.has(d))

  const next = new Set(prev)

  if (alreadyAllSelected) {
    // 已經是全選 → 再按一次就把所有天取消
    allDayValues.forEach(d => next.delete(d))
  } else {
    // 不是全選 → 把這個月所有天都加進來
    allDayValues.forEach(d => next.add(d))
  }

  selectedDays.value = next

  const shouldSelect = !alreadyAllSelected

  updateSelectionCache(cache => {
    allDayValues.forEach(day => {
      visibleEmployees.value.forEach(emp => {
        if (!isSelectableCell(emp._id, day)) return
        applyCacheChange(cache, emp._id, day, 'day', shouldSelect)
      })
    })
  })
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

  const prev = selectedDays.value
  const nextDays = new Set(collected)
  selectedDays.value = nextDays

  const added = collected.filter(day => !prev.has(day))
  const removed = Array.from(prev).filter(day => !nextDays.has(day))

  updateSelectionCache(cache => {
    added.forEach(day => {
      visibleEmployees.value.forEach(emp => applyCacheChange(cache, emp._id, day, 'day', true))
    })
    removed.forEach(day => {
      visibleEmployees.value.forEach(emp => applyCacheChange(cache, emp._id, day, 'day', false))
    })
  })

}

// ========= watcher：避免選取殘留 =========

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

  await syncIncludeSelfPreference(val)
  await refreshFrontMenu()
  currentPage.value = 1
  await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
  await refreshScheduleData({ reset: true, reason: 'include-self-change' })
})

watch([employeeSearch, statusFilter], () => {
  currentPage.value = 1
  fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
  scheduleDebouncedRefresh({ reset: true, reason: 'filter-change' })
})

watch(
  employees,
  newEmployees => {
    const nextIndex = new Map()
    const ids = []
    ;(Array.isArray(newEmployees) ? newEmployees : []).forEach(emp => {
      const id = String(emp?._id || '')
      if (!id) return
      nextIndex.set(id, emp)
      ids.push(id)
    })
    employeeIndexMap.value = nextIndex
    invalidateCellMetaCache()
    recomputeEmployeeStatuses(ids)
  },
  { immediate: true }
)

watch(shifts, () => {
  invalidateCellMetaCache()
})


const employeeStatus = empId => {
  const cachedStatus = employeeStatusMap.value[String(empId)]
  if (cachedStatus) return cachedStatus
  const daysMap = scheduleMap.value[empId] || {}
  const cells = Object.values(daysMap)

  if (!cells.length) {
    return 'unscheduled'
  }

  const hasAnyEmptyDay = cells.some(c => !c.shiftId && !c.leave && !isLeaveCell(empId, c.day))
  const hasAnyLeave = cells.some(c => c.leave || isLeaveCell(empId, c.day))

  if (hasAnyEmptyDay) return 'unscheduled'
  if (hasAnyLeave) return 'onLeave'
  return 'scheduled'
}

const filteredEmployees = computed(() => {
  return employees.value
})

const totalPages = computed(() => {
  const total = Number(serverPaginationTotal.value || 0)
  if (!total) return 1
  return Math.max(1, Math.ceil(total / pageSize.value))
})

const visibleEmployees = computed(() => {
  return filteredEmployees.value
})

const overscanRows = 8
const overscanCols = 3
const rowApproxHeight = 76

const shouldUseVirtualRender = computed(() => {
  return false
})

const effectiveRowRange = computed(() => {
  if (!shouldUseVirtualRender.value) {
    return { start: 0, end: visibleEmployees.value.length }
  }
  return {
    start: Math.max(0, rowRange.value.start),
    end: Math.min(visibleEmployees.value.length, rowRange.value.end)
  }
})

const effectiveColumnRange = computed(() => {
  if (!shouldUseVirtualRender.value) {
    return { start: 0, end: days.value.length }
  }
  return {
    start: Math.max(0, columnRange.value.start),
    end: Math.min(days.value.length, columnRange.value.end)
  }
})

const virtualVisibleEmployees = computed(() => {
  const { start, end } = effectiveRowRange.value
  return visibleEmployees.value.slice(start, end)
})

const virtualVisibleDays = computed(() => {
  const { start, end } = effectiveColumnRange.value
  return days.value.slice(start, end)
})

const virtualLeadingSpacerWidth = computed(() =>
  effectiveColumnRange.value.start * dayColumnWidth.value
)

const virtualTrailingSpacerWidth = computed(() =>
  Math.max(0, days.value.length - effectiveColumnRange.value.end) *
  dayColumnWidth.value
)

const estimatedRenderedNodes = computed(() => {
  const baseRows = virtualVisibleEmployees.value.length
  const baseCols = virtualVisibleDays.value.length
  return baseRows * baseCols * 6
})

const visibleEmployeeIds = computed(() =>
  visibleEmployees.value.map(emp => String(emp._id))
)

const relatedEmployeeIds = computed(() => {
  if (selectedEmployees.value.size > 0) {
    return new Set(Array.from(selectedEmployees.value).map(id => String(id)))
  }
  return new Set(visibleEmployeeIds.value)
})

const formatApprovalStatus = status => {
  const normalized = String(status || '').trim().toLowerCase()
  if (!normalized) return '待簽核'
  return APPROVAL_STATUS_LABELS[normalized] || normalized
}

const approvalStatusTagType = status => {
  const normalized = String(status || '').trim().toLowerCase()
  return APPROVAL_STATUS_TAG_MAP[normalized] || 'info'
}

const formatApprovalPeriod = approval => {
  const data = approval?.form_data || {}
  const from =
    data.startDate ||
    data.start_date ||
    data.fromDate ||
    data.from_date ||
    approval?.startDate
  const to =
    data.endDate ||
    data.end_date ||
    data.toDate ||
    data.to_date ||
    approval?.endDate
  if (from && to) {
    return `${dayjs(from).format('YYYY/MM/DD')} ~ ${dayjs(to).format('YYYY/MM/DD')}`
  }
  if (from) {
    return dayjs(from).format('YYYY/MM/DD')
  }
  return '-'
}

const leaveApprovalRows = computed(() => {
  const relatedSet = relatedEmployeeIds.value
  return approvalList.value
    .filter(approval => {
      const id = approval?.applicant_employee?._id
      if (!id) return false
      return relatedSet.has(String(id))
    })
    .map(approval => {
      const rawStatus = String(approval?.status || 'pending').toLowerCase()
      return {
        ...approval,
        sourceType: 'leave_approval',
        sourceTypeLabel: '請假簽核',
        applicantName: approval?.applicant_employee?.name || '-',
        approvalType: formatApprovalCategory(
          approval?.form?.category,
          approval?.form?.name
        ),
        periodText: formatApprovalPeriod(approval),
        status: rawStatus,
        statusLabel: formatApprovalStatus(rawStatus),
        statusTagType: approvalStatusTagType(rawStatus),
        noteSummary:
          approval?.remark ||
          approval?.comment ||
          approval?.note ||
          approval?.form_data?.reason ||
          ''
      }
    })
})

const relatedApprovalRows = computed(() => [...leaveApprovalRows.value])

const hasMoreApprovals = computed(() => relatedApprovalRows.value.length > approvalCollapsedLimit)

const displayedApprovalRows = computed(() => {
  const rows = relatedApprovalRows.value
  if (approvalCollapsed.value) {
    return rows.slice(0, approvalCollapsedLimit)
  }
  const start = (approvalCurrentPage.value - 1) * approvalPageSize
  return rows.slice(start, start + approvalPageSize)
})

watch([relatedApprovalRows, approvalCollapsed], () => {
  const totalPages = Math.max(1, Math.ceil(relatedApprovalRows.value.length / approvalPageSize))
  if (approvalCurrentPage.value > totalPages) {
    approvalCurrentPage.value = totalPages
  }
})

function onApprovalPageChange(page) {
  approvalCurrentPage.value = page
}

function onDetailClosed() {
  detail.approvalId = ''
}

watch([filteredEmployees, pageSize], () => {
  const maxPage = totalPages.value
  if (currentPage.value > maxPage) {
    currentPage.value = maxPage
    refreshScheduleData({ reason: 'page-normalized' })
  }
})

// 只要員工 / 天數 / 請假索引有變化，都清一次選取
watch(employees, pruneSelections)


watch(leaveIndex, pruneSelections)


// ========= table height for sticky header =========
const dayColumnWidth = computed(() => (isTableFullscreen.value ? 92 : 140))
const fullscreenPopperTarget = computed(() => {
  if (!isTableFullscreen.value) return undefined
  return fullscreenPopperHostRef.value || '.schedule-fullscreen-popper-host'
})

const tableMaxHeight = computed(() => {
  if (isTableFullscreen.value) {
    const dynamicHeight = measuredLayoutHeight.value
    if (dynamicHeight > 0) {
      return Math.max(320, dynamicHeight)
    }
  }
  const reservedHeight = isTableFullscreen.value ? 230 : 400
  return Math.max(320, viewportHeight.value - reservedHeight)
})

const updateViewportHeight = () => {
  if (typeof window === 'undefined') return
  viewportHeight.value = window.innerHeight
  updateFullscreenLayoutHeight()
  recalculateViewportRanges()
}

const createThrottle = (fn, wait = 120) => {
  let lastTime = 0
  let timer = null
  return (...args) => {
    const now = Date.now()
    const remain = wait - (now - lastTime)
    if (remain <= 0) {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      lastTime = now
      fn(...args)
      return
    }
    if (timer) return
    timer = setTimeout(() => {
      timer = null
      lastTime = Date.now()
      fn(...args)
    }, remain)
  }
}

const recalculateViewportRanges = () => {
  if (!shouldUseVirtualRender.value) {
    rowRange.value = { start: 0, end: visibleEmployees.value.length }
    columnRange.value = { start: 0, end: days.value.length }
    return
  }
  const body = tableBodyScrollEl
  const header = tableHeaderScrollEl
  const verticalEl = body || scheduleTableWrapperRef.value
  const horizontalEl = header || body || scheduleTableWrapperRef.value
  if (!verticalEl || !horizontalEl) {
    rowRange.value = { start: 0, end: Math.min(visibleEmployees.value.length, 24) }
    columnRange.value = { start: 0, end: Math.min(days.value.length, 10) }
    return
  }
  const scrollTop = Number(verticalEl.scrollTop || 0)
  const clientHeight = Number(verticalEl.clientHeight || tableMaxHeight.value || 0)
  const rowStart = Math.max(0, Math.floor(scrollTop / rowApproxHeight) - overscanRows)
  const rowCount = Math.max(8, Math.ceil(clientHeight / rowApproxHeight) + overscanRows * 2)

  rowRange.value = {
    start: rowStart,
    end: Math.min(visibleEmployees.value.length, rowStart + rowCount)
  }

  const scrollLeft = Number(horizontalEl.scrollLeft || 0)
  const clientWidth = Number(horizontalEl.clientWidth || 0)
  const colStart = Math.max(0, Math.floor(scrollLeft / dayColumnWidth.value) - overscanCols)
  const colCount = Math.max(
    6,
    Math.ceil(clientWidth / dayColumnWidth.value) + overscanCols * 2
  )
  columnRange.value = {
    start: colStart,
    end: Math.min(days.value.length, colStart + colCount)
  }
}

const onTableScroll = () => {
  const startAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  if (tableScrollRaf) cancelAnimationFrame(tableScrollRaf)
  tableScrollRaf = requestAnimationFrame(() => {
    recalculateViewportRanges()
    const endAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
    lastInteractionLatencyMs.value = Number((endAt - startAt).toFixed(1))
    tableScrollRaf = null
  })
}

const removeTableScrollListeners = () => {
  if (tableBodyScrollEl) {
    tableBodyScrollEl.removeEventListener('scroll', onTableScroll)
    listenerMetrics.delegatedActive = Math.max(0, listenerMetrics.delegatedActive - 1)
    tableBodyScrollEl = null
  }
  if (tableHeaderScrollEl && tableHeaderScrollEl !== tableBodyScrollEl) {
    tableHeaderScrollEl.removeEventListener('scroll', onTableScroll)
    listenerMetrics.delegatedActive = Math.max(0, listenerMetrics.delegatedActive - 1)
    tableHeaderScrollEl = null
  }
}

const bindTableScrollListeners = () => {
  removeTableScrollListeners()
  if (!scheduleTableWrapperRef.value) return
  const body = scheduleTableWrapperRef.value.querySelector('.el-table__body-wrapper')
  const header = scheduleTableWrapperRef.value.querySelector('.el-table__header-wrapper')
  if (body) {
    tableBodyScrollEl = body
    tableBodyScrollEl.addEventListener('scroll', onTableScroll, { passive: true })
    listenerMetrics.delegatedActive += 1
  }
  if (header) {
    tableHeaderScrollEl = header
    tableHeaderScrollEl.addEventListener('scroll', onTableScroll, { passive: true })
    listenerMetrics.delegatedActive += 1
  }
  recalculateViewportRanges()
}

const seedStressScenario = () => {
  const totalEmployees = 200
  const monthStart = dayjs(`${currentMonth.value}-01`)
  const dayCount = monthStart.daysInMonth()
  shifts.value = [
    { _id: 'stress-morning', name: '早班', startTime: '08:00', endTime: '16:00' },
    { _id: 'stress-evening', name: '晚班', startTime: '16:00', endTime: '00:00' }
  ]
  employees.value = Array.from({ length: totalEmployees }, (_, idx) => ({
    _id: `stress-emp-${idx + 1}`,
    name: `壓測員工 ${String(idx + 1).padStart(3, '0')}`,
    department: '壓測部門',
    subDepartment: '壓測單位',
    annualLeave: { remainingDays: idx % 12 }
  }))
  const nextMap = {}
  const nextLeaveIndex = {}
  employees.value.forEach((emp, idx) => {
    const dayMap = {}
    for (let day = 1; day <= dayCount; day += 1) {
      dayMap[day] = {
        employeeId: emp._id,
        day,
        shiftId: day % 2 === 0 ? 'stress-morning' : 'stress-evening',
        leave: false
      }
    }
    nextMap[emp._id] = dayMap
    if (idx % 10 === 0) {
      const leaveDay = (idx % dayCount) + 1
      nextLeaveIndex[emp._id] = { [leaveDay]: true }
      nextMap[emp._id][leaveDay].shiftId = ''
    }
  })
  leaveIndex.value = nextLeaveIndex
  scheduleMap.value = nextMap
  markLeaveIndexDirty()
  recomputeEmployeeStatuses(employees.value.map(emp => emp._id))
  invalidateCellMetaCache()
  pageSize.value = 200
  currentPage.value = 1
  renderStrategyPreference.value = 'virtual'
  recalculateViewportRanges()
}

const updateFullscreenLayoutHeight = () => {
  if (!isTableFullscreen.value) {
    measuredLayoutHeight.value = 0
    return
  }

  const cardHeight = scheduleCardRef.value?.clientHeight || viewportHeight.value
  const headerHeight = scheduleHeaderRef.value?.offsetHeight || 0
  const toolbarHeight = batchToolbarRef.value?.offsetHeight || 0
  const stressToolbarHeight = stressToolbarRef.value?.offsetHeight || 0
  const paginationHeight = paginationBarRef.value?.offsetHeight || 0
  const reservedGap = 16
  const availableHeight =
    cardHeight - headerHeight - toolbarHeight - stressToolbarHeight - paginationHeight - reservedGap

  measuredLayoutHeight.value = Math.max(320, availableHeight)
}

const syncFullscreenState = () => {
  if (typeof document === 'undefined') return
  const target = scheduleCardRef.value
  const isNowFullscreen = !!target && document.fullscreenElement === target
  isTableFullscreen.value = isNowFullscreen
  isFullscreenToolbarCollapsed.value = isNowFullscreen
  updateFullscreenLayoutHeight()
}

const toggleTableFullscreen = () => {
  if (typeof document === 'undefined') return
  const target = scheduleCardRef.value
  if (!target || typeof target.requestFullscreen !== 'function') {
    const nextIsFullscreen = !isTableFullscreen.value
    isTableFullscreen.value = nextIsFullscreen
    isFullscreenToolbarCollapsed.value = nextIsFullscreen
    updateViewportHeight()
    updateFullscreenLayoutHeight()
    return
  }

  if (document.fullscreenElement === target) {
    document.exitFullscreen?.().catch(() => {
      isTableFullscreen.value = false
      isFullscreenToolbarCollapsed.value = false
      updateViewportHeight()
      updateFullscreenLayoutHeight()
    })
    return
  }

  target.requestFullscreen().catch(() => {
    isTableFullscreen.value = true
    isFullscreenToolbarCollapsed.value = true
    updateViewportHeight()
    updateFullscreenLayoutHeight()
  })
  updateViewportHeight()
  updateFullscreenLayoutHeight()
}

const toggleFullscreenToolbar = () => {
  if (!isTableFullscreen.value) return
  isFullscreenToolbarCollapsed.value = !isFullscreenToolbarCollapsed.value
  nextTick(() => {
    updateFullscreenLayoutHeight()
  })
}

const registerHighFrequencyListeners = () => {
  if (typeof window === 'undefined') return
  if (!managedResizeHandler) {
    managedResizeHandler = createThrottle(updateViewportHeight, 120)
  }
  window.removeEventListener('resize', managedResizeHandler)
  window.addEventListener('resize', managedResizeHandler, { passive: true })
  listenerMetrics.delegatedActive += 1
}

const unregisterHighFrequencyListeners = () => {
  if (typeof window === 'undefined' || !managedResizeHandler) return
  window.removeEventListener('resize', managedResizeHandler)
  listenerMetrics.delegatedActive = Math.max(0, listenerMetrics.delegatedActive - 1)
}

const filteredSubDepartments = computed(() =>
  subDepartments.value.filter(s => s.department === selectedDepartment.value)
)

const router = useRouter()

authStore.loadUser()

const canUseSupervisorFilter = computed(() =>
  ['supervisor', 'admin'].includes(authStore.role)
)
const shouldHideDepartmentFilters = computed(() => isTableFullscreen.value)
const selectedDepartmentName = computed(() =>
  departments.value.find(dept => dept._id === selectedDepartment.value)?.name || '全部部門'
)
const selectedSubDepartmentName = computed(() =>
  subDepartments.value.find(sub => sub._id === selectedSubDepartment.value)?.name || '全部單位'
)
const fullscreenFilterHint = computed(() =>
  `${selectedDepartmentName.value} / ${selectedSubDepartmentName.value}`
)
const showIncludeSelfToggle = computed(() => authStore.role === 'supervisor')
// 注意：可篩選(主管視角)與可編輯(排班維護)是兩種不同權限，避免共用同一判定。
const canEditScheduleRoles = ['supervisor', 'admin', 'manager', 'scheduler']
const canEditSchedule = computed(() =>
  canEditScheduleRoles.includes(authStore.role)
)
const missingSupervisorScheduleNoticeKey = ref('')

// ========= 發布狀態相關 =========

const buildPublishSummaryFromRawSchedules = () => {
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
        latestResponseAt: null,
        disputes: []
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
      entry.disputes.push({
        date: item.date,
        note: item.responseNote || '',
        responseAt: item.responseAt
      })
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
          : null,
        disputes: entry.disputes
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
    result.status === 'ready' &&
    pendingEmployees.length === 0 &&
    disputedEmployees.length === 0

  return result
}

const publishSummary = computed(() => {
  const fallbackSummary = buildPublishSummaryFromRawSchedules()

  if (publishSnapshot.value) {
    const snapshot = publishSnapshot.value
    const status =
      typeof snapshot.status === 'string' && snapshot.status
        ? snapshot.status
        : fallbackSummary.status
    const pendingEmployees = Array.isArray(snapshot.pendingEmployees)
      ? snapshot.pendingEmployees
      : fallbackSummary.pendingEmployees
    const disputedEmployees = Array.isArray(snapshot.disputedEmployees)
      ? snapshot.disputedEmployees
      : fallbackSummary.disputedEmployees
    const hasSchedules =
      typeof snapshot.hasSchedules === 'boolean'
        ? snapshot.hasSchedules
        : fallbackSummary.hasSchedules
    const totalEmployees = Number.isFinite(snapshot.totalEmployees)
      ? snapshot.totalEmployees
      : fallbackSummary.totalEmployees
    const allEmployeesConfirmed =
      typeof snapshot.allEmployeesConfirmed === 'boolean'
        ? snapshot.allEmployeesConfirmed
        : fallbackSummary.allEmployeesConfirmed

    return {
      status,
      pendingEmployees,
      disputedEmployees,
      publishedAt: snapshot.publishedAt || fallbackSummary.publishedAt || null,
      hasSchedules,
      totalEmployees,
      allEmployeesConfirmed
    }
  }

  return fallbackSummary
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
    disputed:
      hasDisputed
        ? 'error'
        : status === 'draft' || status === 'pending'
          ? 'wait'
          : 'finish',
    finalized:
      status === 'finalized'
        ? 'success'
        : status === 'ready'
          ? 'process'
          : 'wait'
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
  if (!total || total <= 0) {
    return publishSummary.value.status === 'draft' ? 0 : 20
  }
  const responded = Math.max(
    total - publishSummary.value.pendingEmployees.length,
    0
  )
  const percentage = Math.round((responded / total) * 100)
  return Math.min(Math.max(percentage, 0), 100)
})

const finalHasSchedules = computed(() => publishSummary.value.hasSchedules)

const publishDisabled = computed(
  () =>
    isPublishing.value ||
    !finalHasSchedules.value ||
    publishSummary.value.status === 'finalized'
)

const finalizeDisabled = computed(
  () =>
    isFinalizing.value ||
    publishSummary.value.status !== 'ready'
)

const publishDisabledReason = computed(() => {
  if (!publishDisabled.value) return ''
  if (isPublishing.value) return '系統正在送出中，請稍候。'
  if (!finalHasSchedules.value) return '目前範圍沒有可發布班表，請先確認本月是否已完成排班。'
  if (publishSummary.value.status === 'finalized') return '本月班表已完成發布並鎖定。'
  return '目前不符合發送條件。'
})

const finalizeDisabledReason = computed(() => {
  if (!finalizeDisabled.value) return ''
  if (isFinalizing.value) return '系統正在完成發布，請稍候。'
  if (!publishSummary.value.hasSchedules) return '尚未發送待確認，請先執行「發送待確認」。'
  if (publishSummary.value.status === 'finalized') return '班表已完成發布。'
  if (publishSummary.value.status === 'pending') return '仍有員工尚未回覆，請先完成確認。'
  if (publishSummary.value.status === 'disputed') return '仍有員工提出異議，請先處理異議。'
  return '尚未達到完成發布條件。'
})

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

// ========= 提示工具 =========

const callWarning = message => {
  const moduleWarn = ElMessage?.warning
  if (typeof moduleWarn === 'function') {
    moduleWarn(message)
  }
  const globalWarn =
    typeof window !== 'undefined' ? window.ElMessage?.warning : undefined
  if (typeof globalWarn === 'function' && globalWarn !== moduleWarn) {
    globalWarn(message)
  }
}

const callInfo = message => {
  const moduleInfo = ElMessage?.info
  if (typeof moduleInfo === 'function') {
    moduleInfo(message)
  }
  const globalInfo =
    typeof window !== 'undefined' ? window.ElMessage?.info : undefined
  if (typeof globalInfo === 'function' && globalInfo !== moduleInfo) {
    globalInfo(message)
  }
}

const callSuccess = message => {
  const moduleSuccess = ElMessage?.success
  if (typeof moduleSuccess === 'function') {
    moduleSuccess(message)
  }
  const globalSuccess =
    typeof window !== 'undefined' ? window.ElMessage?.success : undefined
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

const formatDisputeDate = value => {
  if (!value) return ''
  const parsed = dayjs(value)
  if (!parsed.isValid()) return ''
  return parsed.format('MM/DD')
}

function buildPublishPayload() {
  const payload = { month: currentMonth.value }
  const fixedDepartment =
    selectedDepartment.value ||
    supervisorDepartmentId.value ||
    employees.value[0]?.departmentId ||
    ''
  const fixedSubDepartment =
    selectedSubDepartment.value ||
    supervisorSubDepartmentId.value ||
    employees.value[0]?.subDepartmentId ||
    ''

  if (fixedDepartment) payload.department = fixedDepartment
  if (fixedSubDepartment) payload.subDepartment = fixedSubDepartment
  if (includeSelf.value && showIncludeSelfToggle.value) payload.includeSelf = true
  return payload
}

// ========= 發布 / 完成 =========

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
    const payload = await res.json().catch(() => null)
    const publishedMonth = payload?.publishedMonth || currentMonth.value
    if (publishedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(publishedMonth)) {
      localStorage.setItem(PUBLISHED_MONTH_HINT_KEY, publishedMonth)
    }
    callSuccess('已將班表發送給員工確認')
    invalidateFetchAllCache()
    await refreshScheduleData({ reason: 'publish-success' })
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
      await refreshScheduleData({ reason: 'finalize-conflict' })
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
    invalidateFetchAllCache()
    await refreshScheduleData({ reason: 'finalize-success' })
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

const days = computed(() => {
  const dt = dayjs(currentMonth.value + '-01')
  const end = dt.endOf('month').date()
  const week = ['日', '一', '二', '三', '四', '五', '六']
  return Array.from({ length: end }, (_, i) => {
    const date = i + 1
    const wd = week[dt.date(date).day()]
    const dateStr = `${currentMonth.value}-${String(date).padStart(2, '0')}`
    const holiday = holidayMap.value[dateStr]
    const label = holiday ? `${date}(${wd}) 🎊${holiday.name}` : `${date}(${wd})`
    return { date, label, holiday }
  })
})

// ========= 假日管理 =========

async function fetchHolidays() {
  try {
    // Fetch holidays for current month
    const res = await apiFetch(`/api/holidays-public/by-month?month=${currentMonth.value}`)
    if (res.ok) {
      const data = await res.json()
      holidays.value = Array.isArray(data) ? data : []
      
      // Build holiday map by date string for quick lookup
      const map = {}
      holidays.value.forEach(h => {
        if (h.date) {
          const dateStr = dayjs(h.date).format('YYYY-MM-DD')
          map[dateStr] = h
        }
      })
      holidayMap.value = map
    }
  } catch (err) {
    console.warn('Failed to fetch holidays:', err)
  }
}


// ========= 班別 / 部門 / 主管 context =========

async function fetchShiftOptions() {
  const res = await apiFetch('/api/shifts')
  if (res.ok) {
    const data =
      typeof res.json === 'function' ? await res.json() : []
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
      deptMap[supervisorDepartmentName.value] =
        supervisorDepartmentId.value || supervisorDepartmentName.value
    }

    const normalized = Array.isArray(subData)
      ? subData
        .map(s => {
          const rawDept = s?.department
          let deptId = ''
          if (rawDept && typeof rawDept === 'object') {
            deptId =
              rawDept?._id ||
              rawDept?.id ||
              deptMap[rawDept?.name] ||
              ''
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
      filtered = normalized.filter(
        s => s.department === String(targetDept)
      )
      if (!filtered.length && supervisorSubDepartmentId.value) {
        const matched = normalized.find(
          s => s._id === supervisorSubDepartmentId.value
        )
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
    if (!filtered.length && normalized.length) {
      filtered = normalized
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
      }
    }

    subDepartments.value = filtered

    if (subDepartments.value.length) {
      if (
        supervisorSubDepartmentId.value &&
        subDepartments.value.some(
          s => s._id === supervisorSubDepartmentId.value
        )
      ) {
        selectedSubDepartment.value = supervisorSubDepartmentId.value
      } else if (
        selectedSubDepartment.value &&
        subDepartments.value.some(
          s => s._id === selectedSubDepartment.value
        )
      ) {
        // keep existing
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

    const targetDeptId =
      selectedDepartment.value || supervisorDepartmentId.value

    let filtered = normalized
    if (targetDeptId) {
      filtered = normalized.filter(
        d =>
          d._id === targetDeptId ||
          (supervisorDepartmentName.value &&
            d.name === supervisorDepartmentName.value)
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

  // 部門
  const deptInfo = data?.department
  let deptId = ''
  let deptName = ''
  if (deptInfo && typeof deptInfo === 'object') {
    deptId =
      deptInfo?._id || deptInfo?.id || deptInfo?.value || ''
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

  // 單位
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

// ========= 排班資料 =========

function ensureEmployeeSchedule(empId) {
  const key = String(empId)
  if (!scheduleMap.value[key]) {
    scheduleMap.value[key] = {}
  }
  const employee = employeeById.value[key] || {}
  const defaults = {
    shiftId: '',
    department: employee.departmentId || '',
    subDepartment: employee.subDepartmentId || ''
  }
  days.value.forEach(d => {
    if (!scheduleMap.value[key][d.date]) {
      scheduleMap.value[key][d.date] = { ...defaults }
    } else {
      scheduleMap.value[key][d.date].shiftId =
        scheduleMap.value[key][d.date].shiftId || ''
      scheduleMap.value[key][d.date].department =
        scheduleMap.value[key][d.date].department || defaults.department
      scheduleMap.value[key][d.date].subDepartment =
        scheduleMap.value[key][d.date].subDepartment ||
        defaults.subDepartment
    }
  })
  invalidateCellMetaCache(key)
  recomputeEmployeeStatusFor(key)
  markScheduleMapDirty()
}

const patchScheduleMapForEmployees = (targetEmployees, daysList, employeeMap, schedules) => {
  const targetSet = new Set(targetEmployees.map(id => String(id)))
  const incomingScheduleByEmployee = new Map()

  schedules.forEach(item => {
    const rawId = item?.employee?._id || item?.employee
    if (!rawId) return
    const empId = String(rawId)
    if (!targetSet.has(empId)) return
    const list = incomingScheduleByEmployee.get(empId) || []
    list.push(item)
    incomingScheduleByEmployee.set(empId, list)
  })

  targetSet.forEach(empId => {
    const employee = employeeMap[empId] || {}
    const defaults = {
      shiftId: '',
      department: employee.departmentId || '',
      subDepartment: employee.subDepartmentId || ''
    }
    const currentDayMap = scheduleMap.value[empId] || {}
    const nextDayMap = {}

    daysList.forEach(d => {
      const existingCell = currentDayMap[d.date]
      nextDayMap[d.date] = existingCell
        ? {
          ...existingCell,
          shiftId: existingCell.shiftId || '',
          department: existingCell.department || defaults.department,
          subDepartment: existingCell.subDepartment || defaults.subDepartment,
          leave: existingCell.leave
        }
        : { ...defaults }
    })

    const incomingSchedules = incomingScheduleByEmployee.get(empId) || []
    incomingSchedules.forEach(s => {
      const dateNum = dayjs(s.date).date()
      nextDayMap[dateNum] = {
        id: s._id,
        shiftId: s.shiftId,
        department: s.department || employee.departmentId,
        subDepartment: s.subDepartment || employee.subDepartmentId
      }
    })

    scheduleMap.value[empId] = nextDayMap
    invalidateCellMetaCache(empId)
  })
  recomputeEmployeeStatuses(Array.from(targetSet))
  markScheduleMapDirty()
}

const buildLeaveIndexAndScheduleMap = ({
  leaves,
  targetSet,
  month,
  employeesList
}) => {
  const nextLeaveIndex = {}
  const monthStart = dayjs(`${month}-01`).startOf('day')
  const monthEnd = monthStart.endOf('month').startOf('day')

  leaves.forEach(l => {
    const leaveStatus = String(l.status || l.decision || '').toLowerCase()
    if (leaveStatus !== 'approved') return

    const rawEmp = l.employee?._id || l.employee
    if (!rawEmp) return
    const empId = String(rawEmp)
    const isVisibleEmployee =
      targetSet.size > 0
        ? targetSet.has(empId)
        : employeesList.some(e => String(e?._id) === empId)
    if (!isVisibleEmployee) return

    const startDate = dayjs(l.startDate).startOf('day')
    const endDate = dayjs(l.endDate).startOf('day')
    if (!startDate.isValid() || !endDate.isValid()) return

    let pointer = startDate.isBefore(monthStart) ? monthStart : startDate
    const boundary = endDate.isAfter(monthEnd) ? monthEnd : endDate

    while (!pointer.isAfter(boundary)) {
      const dayNum = pointer.date()
      if (!nextLeaveIndex[empId]) nextLeaveIndex[empId] = {}
      nextLeaveIndex[empId][dayNum] = true

      const employeeSchedule = scheduleMap.value[empId]
      if (employeeSchedule?.[dayNum]) {
        scheduleMap.value[empId] = {
          ...employeeSchedule,
          [dayNum]: {
            ...employeeSchedule[dayNum],
            leave: {
              type: l.leaveType,
              startDate: l.startDate,
              endDate: l.endDate,
              excludesHours: true
            }
          }
        }
      }

      pointer = pointer.add(1, 'day')
    }
  })

  return { nextLeaveIndex }
}

function resetScheduleCache() {
  activeScheduleRequest.key = ''
  activeScheduleRequest.promise = null
  scheduleMap.value = {}
  rawSchedules.value = []
  publishSnapshot.value = null
  loadedEmployeeIds.value = new Set()
  approvalList.value = []
  leaveIndex.value = {}
  markLeaveIndexDirty()
  employeeStatusMap.value = {}
  cellMetaCache.value = new Map()
  fetchAllCache.fulfilled.clear()
  fetchAllCache.inFlight.clear()
}

async function fetchSchedules({ reset = false, fetchAll = false, reason = 'unknown' } = {}) {
  let targetEmployees = fetchAll
    ? employees.value.map(e => String(e._id))
    : visibleEmployeeIds.value
  if (!targetEmployees.length && employees.value.length) {
    const start = (currentPage.value - 1) * pageSize.value
    const end = start + pageSize.value
    targetEmployees = employees.value
      .slice(start, end)
      .map(e => String(e._id))
  }
  const hasVisibleEmployees = targetEmployees.length > 0

  if (reset) {
    resetScheduleCache()
  }

  const shouldFetch =
    reset ||
    !hasVisibleEmployees ||
    targetEmployees.some(id => !loadedEmployeeIds.value.has(id)) ||
    fetchAll
  if (!shouldFetch) {
    return
  }

  const supervisorId = getStoredSupervisorId()
  const params = [`month=${currentMonth.value}`]
  if (hasVisibleEmployees || supervisorId) {
    if (!fetchAll) {
      params.push(`page=${currentPage.value}`)
      params.push(`pageSize=${pageSize.value}`)
    }
    if (targetEmployees.length > 0) {
      params.push(`employeeIds=${targetEmployees.join(',')}`)
    }
  }
  if (selectedDepartment.value) params.push(`department=${selectedDepartment.value}`)
  if (selectedSubDepartment.value) params.push(`subDepartment=${selectedSubDepartment.value}`)
  if (!fetchAll && statusFilter.value && statusFilter.value !== 'all') {
    params.push(`status=${statusFilter.value}`)
  }
  if (!fetchAll && employeeSearch.value) {
    params.push(`search=${encodeURIComponent(employeeSearch.value)}`)
  }
  if (supervisorId) params.push(`supervisor=${supervisorId}`)
  if (includeSelf.value && showIncludeSelfToggle.value)
    params.push('includeSelf=true')
  const query = `?${params.join('&')}`
  const requestKey = JSON.stringify({
    query,
    fetchAll,
    reset,
    targetEmployees
  })

  if (activeScheduleRequest.key === requestKey && activeScheduleRequest.promise) {
    scheduleRequestStats.deduped += 1
    debugScheduleRequest('deduped', { reason, requestKey })
    return activeScheduleRequest.promise
  }

  const requestId = activeScheduleRequest.requestId + 1
  activeScheduleRequest.requestId = requestId
  activeScheduleRequest.key = requestKey
  scheduleRequestStats.started += 1
  debugScheduleRequest('start', { reason, requestId, requestKey })
  isFetchingSchedules.value = true

  const requestPromise = (async () => {
    const res = await apiFetch(`/api/schedules/monthly${query}`)
    if (!res.ok) throw new Error('Failed to fetch schedules')
    const data =
      typeof res.json === 'function' ? await res.json() : []
    const schedules = Array.isArray(data)
      ? data
      : Array.isArray(data?.schedules)
        ? data.schedules
        : []

    const summaryData = Array.isArray(data) ? null : data?.publishSummary
    const isNewFormat = summaryData &&
      (
        typeof summaryData.hasSchedules === 'boolean' ||
        Array.isArray(summaryData.pendingEmployees)
      )
    const isLegacyFormat = summaryData &&
      Array.isArray(summaryData.currentRoundPendingEmployees)

    if (isNewFormat) {
      publishSnapshot.value = {
        status: summaryData.status || 'draft',
        pendingEmployees: Array.isArray(summaryData.pendingEmployees)
          ? summaryData.pendingEmployees
          : [],
        disputedEmployees: Array.isArray(summaryData.disputedEmployees)
          ? summaryData.disputedEmployees
          : [],
        publishedAt: summaryData.publishedAt || null,
        hasSchedules: summaryData.hasSchedules ?? (schedules.length > 0),
        totalEmployees: summaryData.totalEmployees ?? 0,
        allEmployeesConfirmed:
          summaryData.allEmployeesConfirmed ?? false
      }
    } else if (isLegacyFormat) {
      publishSnapshot.value = {
        status: summaryData.status || 'draft',
        pendingEmployees: summaryData.currentRoundPendingEmployees,
        disputedEmployees: [],
        publishedAt: summaryData.publishedAt || null,
        hasSchedules: schedules.length > 0,
        totalEmployees: summaryData.totalEmployees ?? 0,
        allEmployeesConfirmed:
          summaryData.allEmployeesConfirmed ?? false
      }
    } else {
      publishSnapshot.value = null
    }

    const targetSet = new Set(targetEmployees)
    patchScheduleMapForEmployees(
      targetEmployees,
      days.value,
      employeeById.value,
      schedules
    )

    // ========= 取得請假資料，建立 leaveIndex =========

    const leaveParams = [`month=${currentMonth.value}`]
    if (targetEmployees.length > 0) {
      leaveParams.push(`employeeIds=${targetEmployees.join(',')}`)
    }
    if (includeSelf.value && showIncludeSelfToggle.value) {
      leaveParams.push('includeSelf=true')
    }
    if (supervisorId) leaveParams.push(`supervisor=${supervisorId}`)
    const deptId = selectedDepartment.value
    const subId = selectedSubDepartment.value
    if (deptId) leaveParams.push(`department=${deptId}`)
    if (subId) leaveParams.push(`subDepartment=${subId}`)
    const leaveQuery = `?${leaveParams.join('&')}`

    const res2 = await apiFetch(`/api/schedules/leave-approvals${leaveQuery}`)
    if (res2?.ok && typeof res2.json === 'function') {
      const extra = await res2.json()
      const approvals = Array.isArray(extra?.approvals)
        ? extra.approvals
        : []
      const leaves = Array.isArray(extra?.leaves) ? extra.leaves : []
      const { nextLeaveIndex } = buildLeaveIndexAndScheduleMap({
        leaves,
        targetSet,
        month: currentMonth.value,
        employeesList: employees.value
      })
      if (activeScheduleRequest.requestId !== requestId) return
      rawSchedules.value = schedules
      approvalList.value = approvals
      leaveIndex.value = nextLeaveIndex
      markLeaveIndexDirty()
      recomputeEmployeeStatuses(targetEmployees)
      targetEmployees.forEach(empId => invalidateCellMetaCache(empId))
      markScheduleMapDirty()
    } else {
      if (activeScheduleRequest.requestId !== requestId) return
      rawSchedules.value = schedules
      approvalList.value = []
      leaveIndex.value = {}
      markLeaveIndexDirty()
      recomputeEmployeeStatuses(targetEmployees)
      targetEmployees.forEach(empId => invalidateCellMetaCache(empId))
    }

    // ========= 主管自己是否有排班提示 =========

    const supervisorIdForCheck =
      getStoredSupervisorId() || getSupervisorIdFromStorage()
    const shouldCheckSupervisorSchedule =
      includeSelf.value &&
      showIncludeSelfToggle.value &&
      supervisorIdForCheck
    if (shouldCheckSupervisorSchedule) {
      const hasSupervisorSchedule = schedules.some(s => {
        const rawEmp = s?.employee?._id || s?.employee
        return rawEmp && String(rawEmp) === supervisorIdForCheck
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

    const updated = new Set(loadedEmployeeIds.value)
    targetEmployees.forEach(id => updated.add(id))
    loadedEmployeeIds.value = updated
    if (fetchAll) {
      fetchAllCache.fulfilled.add(buildFetchAllCacheKey())
    }

    pruneSelections()
  })()
  activeScheduleRequest.promise = requestPromise

  try {
    await requestPromise
  } catch (err) {
    console.error(err)
    ElMessage.error('取得排班資料失敗')
    rawSchedules.value = []
  } finally {
    if (activeScheduleRequest.requestId === requestId) {
      scheduleRequestStats.completed += 1
      debugScheduleRequest('complete', { reason, requestId })
      isFetchingSchedules.value = false
      activeScheduleRequest.promise = null
      activeScheduleRequest.key = ''
    }
  }
}

// ========= 分頁 =========

function onPageChange(page) {
  currentPage.value = page
  fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
    .then(() => refreshScheduleData({ reason: 'page-change' }))
}

function onPageSizeChange(size) {
  pageSize.value = size
  currentPage.value = 1
  fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
    .then(() => refreshScheduleData({ reason: 'page-size-change' }))
}

// ========= 審批明細 =========

function openDetail(id) {
  if (!id) return
  detail.approvalId = String(id)
  detail.visible = true
}

// ========= 預覽 / 匯出 =========

const buildFetchAllCacheKey = () =>
  [
    currentMonth.value,
    selectedDepartment.value || '',
    selectedSubDepartment.value || '',
    includeSelf.value && showIncludeSelfToggle.value ? '1' : '0'
  ].join('|')

async function ensureFetchAllLoaded() {
  const key = buildFetchAllCacheKey()
  if (
    fetchAllCache.fulfilled.has(key) &&
    employees.value.every(emp => loadedEmployeeIds.value.has(String(emp._id)))
  ) {
    return
  }
  if (fetchAllCache.inFlight.has(key)) {
    await fetchAllCache.inFlight.get(key)
    return
  }
  const task = refreshScheduleData({
    fetchAll: true,
    includeSummary: false,
    reason: 'ensure-fetch-all'
  })
    .then(() => {
      fetchAllCache.fulfilled.add(key)
    })
    .finally(() => {
      fetchAllCache.inFlight.delete(key)
    })
  fetchAllCache.inFlight.set(key, task)
  await task
}

async function preview(type) {
  // Fetch schedules for all employees before previewing
  const loading = ElLoading.service({
    lock: true,
    text: '正在載入所有員工排班資料...',
    background: 'rgba(0, 0, 0, 0.7)'
  })
  
  try {
    await ensureFetchAllLoaded()
    
    sessionStorage.setItem(
      'schedulePreview',
      JSON.stringify({
        scheduleMap: scheduleMap.value,
        employees: employees.value,
        days: days.value,
        shifts: shifts.value
      })
    )
    router.push({
      name: type === 'week' ? 'PreviewWeek' : 'PreviewMonth'
    })
  } catch (err) {
    console.error(err)
    ElMessage.error('載入排班資料失敗')
  } finally {
    loading.close()
  }
}

async function exportSchedules(format) {
  try {
    const params = new URLSearchParams({
      month: currentMonth.value,
      format: format,
      department: selectedDepartment.value
    })
    if (selectedSubDepartment.value) {
      params.append('subDepartment', selectedSubDepartment.value)
    }
    if (statusFilter.value && statusFilter.value !== 'all') {
      params.append('status', statusFilter.value)
    }
    if (employeeSearch.value) {
      params.append('search', employeeSearch.value)
    }
    const res = await apiFetch(
      `/api/schedules/export?${params.toString()}`
    )
    if (!res.ok) throw new Error()
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `schedules-${currentMonth.value}.${format === 'excel' ? 'xlsx' : 'pdf'
      }`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    ElMessage.error('匯出失敗')
  }
}

// ========= 單格即時排班（非批次）=========

async function onSelect(empId, day, value) {
  const dateStr = `${currentMonth.value}-${String(day).padStart(2, '0')}`
  const existing = scheduleMap.value[empId][day]
  const employee = employeeById.value[String(empId)] || {}
  const department =
    existing?.department || employee.departmentId || ''
  const subDepartment =
    existing?.subDepartment || employee.subDepartmentId || ''

  // 該格只要被視為請假，就直接擋掉
  if (existing?.leave || isLeaveCell(empId, day)) {
    callInfo('該日已核准請假，無法調整排班')
    return
  }

  const prev = existing?.shiftId ?? ''

  // 已有 schedule -> 更新
  if (existing && existing.id) {
    try {
      const res = await apiFetch(`/api/schedules/${existing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shiftId: value,
          department,
          subDepartment
        })
      })
      if (!res.ok) {
        await handleScheduleError(
          res,
          '更新排班失敗',
          empId,
          day,
          prev
        )
      } else {
        invalidateFetchAllCache()
        invalidateCellMetaCache(empId, day)
        recomputeEmployeeStatusFor(empId)
        markScheduleMapDirty()
        await fetchSummary()
        await refreshFrontMenu()
      }
    } catch (err) {
      await handleScheduleError(
        null,
        '更新排班失敗',
        empId,
        day,
        prev
      )
    }
  } else {
    // 沒有 schedule -> 新增
    try {
      const res = await apiFetch('/api/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee: empId,
          date: dateStr,
          shiftId: value,
          department,
          subDepartment
        })
      })
      if (res.ok) {
        const saved = await res.json()
        scheduleMap.value[empId][day] = {
          id: saved._id,
          shiftId: saved.shiftId,
          department,
          subDepartment
        }
        invalidateCellMetaCache(empId, day)
        recomputeEmployeeStatusFor(empId)
        markScheduleMapDirty()
        invalidateFetchAllCache()
        await fetchSummary()
        await refreshFrontMenu()
      } else {
        await handleScheduleError(
          res,
          '新增排班失敗',
          empId,
          day,
          prev
        )
      }
    } catch (err) {
      await handleScheduleError(
        null,
        '新增排班失敗',
        empId,
        day,
        prev
      )
    }
  }
}

// ========= 篩選切換 =========

async function onDepartmentChange() {
  selectedSubDepartment.value = ''
  await fetchSubDepartments(selectedDepartment.value)
  await fetchEmployees(selectedDepartment.value, '')
  currentPage.value = 1
  await refreshScheduleData({ reset: true, reason: 'department-change' })
}

async function onSubDepartmentChange() {
  await fetchEmployees(
    selectedDepartment.value,
    selectedSubDepartment.value
  )
  currentPage.value = 1
  await refreshScheduleData({ reset: true, reason: 'sub-department-change' })
}

// ========= 單筆錯誤處理 =========

async function handleScheduleError(
  res,
  defaultMsg,
  empId,
  day,
  prev
) {
  if (!scheduleMap.value[empId]) {
    scheduleMap.value[empId] = {}
  }
  const current =
    scheduleMap.value[empId][day] || {
      shiftId: '',
      department: '',
      subDepartment: ''
    }
  current.shiftId = prev
  scheduleMap.value[empId][day] = current
  invalidateCellMetaCache(empId, day)
  recomputeEmployeeStatusFor(empId)
  markScheduleMapDirty()

  let msg = ''
  try {
    if (res) {
      const data = await res.json()
      msg = data?.error || ''
    }
  } catch (e) { }

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

// ========= 批次套用 =========

async function handleBatchApiError(res, defaultMsg = '批次套用失敗') {
  let msg = ''
  try {
    if (res) {
      const data = await res.json()
      msg = data?.error || ''
    }
  } catch (err) { }
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

    // 沒資料或本月被視為請假 → 略過
    if (!info || isLeaveCell(empId, day)) return

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
    callInfo('選取的儲存格皆無需更新（或皆為請假日）')
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

    const affectedEmployees = new Set()
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
          payload.department ??
          entry.department ??
          current.department ??
          '',
        subDepartment:
          payload.subDepartment ??
          entry.subDepartment ??
          current.subDepartment ??
          ''
      }
      affectedEmployees.add(String(empId))
      invalidateCellMetaCache(empId, d)
      // leave 標記由 leaveIndex + 後端請假資料決定，這裡不主動刪掉
    })
    recomputeEmployeeStatuses(Array.from(affectedEmployees))
    markScheduleMapDirty()

    callSuccess('批次套用完成')
    invalidateFetchAllCache()
    await fetchSummary()
    clearSelection()
    await refreshFrontMenu()
  } finally {
    loadingInstance?.close()
    isApplyingBatch.value = false
  }
}


function loadRowColorsFromSession() {
  if (typeof window === 'undefined') return {}
  try {
    const stored = window.sessionStorage?.getItem(ROW_COLOR_SESSION_KEY)
    const parsed = stored ? JSON.parse(stored) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    console.warn('Failed to parse row colors from session', err)
    return {}
  }
}

function persistRowColors() {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage?.setItem(ROW_COLOR_SESSION_KEY, JSON.stringify(rowColorAssignments.value))
  } catch (err) {
    console.warn('Failed to persist row colors', err)
  }
}

function scheduleRowClassName({ row }) {
  const empId = String(row?._id || '')
  if (!empId) return ''
  if (selectedEmployeesSet.value.has(empId)) {
    return 'schedule-row schedule-row--selected'
  }
  if (normalizeRowColorIndex(rowColorAssignments.value[empId]) !== null) {
    return 'schedule-row schedule-row--colored'
  }
  return 'schedule-row'
}

function scheduleRowStyle({ row }) {
  const empId = String(row?._id || '')
  const color = resolveRowColor(rowColorAssignments.value[empId])
  return {
    backgroundColor: color?.bg || '#ffffff',
    '--row-color-bg': color?.bg || '#ffffff',
    '--row-color-border': color?.border || '#e2e8f0'
  }
}

function applyRowColor() {
  const nextIndex = normalizeRowColorIndex(batchRowColorIndex.value)
  if (nextIndex === null || !selectedEmployeesSet.value.size) return
  const next = { ...rowColorAssignments.value }
  selectedEmployeesSet.value.forEach(empId => {
    next[String(empId)] = nextIndex
  })
  rowColorAssignments.value = next
  persistRowColors()
}

function clearRowColor() {
  if (!selectedEmployeesSet.value.size) return
  const next = { ...rowColorAssignments.value }
  selectedEmployeesSet.value.forEach(empId => {
    delete next[String(empId)]
  })
  rowColorAssignments.value = next
  persistRowColors()
}

// ========= 共用小工具 =========

function shiftInfo(id) {
  const key = String(id || '')
  if (!key) return undefined
  return shiftInfoMap.value.get(key) || shifts.value.find(s => s._id === id)
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

async function fetchEmployees(
  department = '',
  subDepartment = ''
) {
  const supervisorId = getStoredSupervisorId()
  const params = []
  const deptId =
    department ||
    selectedDepartment.value ||
    supervisorDepartmentId.value
  const subId = subDepartment || selectedSubDepartment.value
  if (supervisorId) params.push(`supervisor=${supervisorId}`)
  if (deptId) params.push(`department=${deptId}`)
  if (subId) params.push(`subDepartment=${subId}`)
  params.push(`month=${currentMonth.value}`)
  params.push(`page=${currentPage.value}`)
  params.push(`pageSize=${pageSize.value}`)
  if (statusFilter.value && statusFilter.value !== 'all') {
    params.push(`status=${statusFilter.value}`)
  }
  if (employeeSearch.value) {
    params.push(`search=${encodeURIComponent(employeeSearch.value)}`)
  }
  const url = `/api/employees/schedule${params.length ? `?${params.join('&')}` : ''
    }`
  try {
    const empRes = await apiFetch(url)
    if (!empRes.ok) throw new Error('Failed to fetch employees')
    const payload =
      typeof empRes.json === 'function' ? await empRes.json() : []
    const empData = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.employees)
        ? payload.employees
        : []
    const pagination = payload?.pagination && typeof payload.pagination === 'object'
      ? payload.pagination
      : null
    const deptMap = departments.value.reduce((acc, d) => {
      acc[d._id] = d.name
      return acc
    }, {})
    const subMap = subDepartments.value.reduce((acc, s) => {
      acc[s._id] = s.name
      return acc
    }, {})
    const normalized = empData.map(e => {
      const id = e?._id ?? e?.id ?? ''
      const deptId = e?.department ?? ''
      const subId = e?.subDepartment ?? ''
      const normalizedId = id ? String(id) : ''
      const normalizedDept = deptId ? String(deptId) : ''
      const normalizedSub = subId ? String(subId) : ''
      
      const remainingDays = Number(e?.annualLeave?.remainingDays || 0)
      const annualLeave = {
        remainingDays,
        remainingHours: Math.max(0, remainingDays) * 8
      }

      return {
        _id: normalizedId,
        name: e.name,
        title: e.title || '',
        practiceTitle: e.practiceTitle || '',
        photo: e.photo,
        departmentId: normalizedDept,
        subDepartmentId: normalizedSub,
        department: deptMap[normalizedDept] || '',
        subDepartment: subMap[normalizedSub] || '',
        annualLeave,
        scheduleRowColor: normalizeRowColorIndex(e?.scheduleRowColor)
      }
    })

    let next = sortEmployeesByDept(normalized)

    if (includeSelf.value && showIncludeSelfToggle.value) {
      const supervisorIdStr = supervisorId ? String(supervisorId) : ''
      if (
        supervisorIdStr &&
        !next.some(e => e._id === supervisorIdStr)
      ) {
        next = sortEmployeesByDept([
          ...next,
          {
            _id: supervisorIdStr,
            name: supervisorProfile.value?.name || '主管本人',
            departmentId: supervisorDepartmentId.value || '',
            subDepartmentId:
              supervisorSubDepartmentId.value || '',
            department: supervisorDepartmentName.value || '',
            subDepartment:
              supervisorSubDepartmentName.value || ''
          }
        ])
      }
    }

    employees.value = next
    if (pagination) {
      const total = Number(pagination.total || 0)
      serverPaginationTotal.value = total
    } else {
      serverPaginationTotal.value = next.length
    }
    const sessionColors = loadRowColorsFromSession()
    rowColorAssignments.value = next.reduce((acc, emp) => {
      const empId = String(emp?._id || '')
      if (!empId) return acc
      const employeeColor = normalizeRowColorIndex(emp?.scheduleRowColor)
      const sessionColor = normalizeRowColorIndex(sessionColors[empId])
      const resolved = employeeColor ?? sessionColor
      if (resolved !== null) acc[empId] = resolved
      return acc
    }, {})
    persistRowColors()
    pruneSelections()
  } catch (err) {
    console.error(err)
    ElMessage.error('取得員工資料失敗')
  }
}

// ========= Summary =========

async function fetchSummary() {
  try {
    const params = [`month=${currentMonth.value}`]
    if (selectedDepartment.value) {
      params.push(`department=${selectedDepartment.value}`)
    }
    if (selectedSubDepartment.value) {
      params.push(`subDepartment=${selectedSubDepartment.value}`)
    }
    if (includeSelf.value && showIncludeSelfToggle.value) {
      params.push('includeSelf=true')
    }

    const res = await apiFetch(
      `/api/schedules/summary?${params.join('&')}`
    )
    if (!res.ok) return

    const data = await res.json()
    if (data && typeof data === 'object' && data.stats) {
      summary.value = {
        direct: Number(data.stats.direct || 0),
        unscheduled: Number(data.stats.unscheduled || 0),
        onLeave: Number(data.stats.onLeave || 0)
      }
      return
    }

    const list = Array.isArray(data) ? data : []
    const daysInMonth = dayjs(`${currentMonth.value}-01`).daysInMonth()
    summary.value = {
      direct: list.length,
      unscheduled: list.filter(e => Number(e.shiftCount || 0) + Number(e.leaveCount || 0) < daysInMonth).length,
      onLeave: list.filter(e => Number(e.leaveCount || 0) > 0).length
    }
  } catch (err) {
    console.error(err)
  }
}

// ========= 月份切換 =========

async function onMonthChange(value) {
  const next = value ? dayjs(value) : dayjs()
  currentMonth.value = next.isValid()
    ? next.format('YYYY-MM')
    : dayjs().format('YYYY-MM')
  currentPage.value = 1
  await fetchHolidays()
  await refreshScheduleData({ reset: true, reason: 'month-change' })
}

// ========= 初始化 =========

onBeforeUnmount(() => {
  if (filterRefreshTimer) {
    clearTimeout(filterRefreshTimer)
    filterRefreshTimer = null
  }
  unregisterHighFrequencyListeners()
  if (typeof document !== 'undefined') {
    document.removeEventListener('fullscreenchange', syncFullscreenState)
    listenerMetrics.delegatedActive = Math.max(0, listenerMetrics.delegatedActive - 1)
  }
  if (layoutResizeObserver) {
    layoutResizeObserver.disconnect()
    layoutResizeObserver = null
  }
  removeTableScrollListeners()
  if (tableScrollRaf) {
    cancelAnimationFrame(tableScrollRaf)
    tableScrollRaf = null
  }
})

onMounted(async () => {
  if (typeof window !== 'undefined') {
    updateViewportHeight()
    registerHighFrequencyListeners()
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('fullscreenchange', syncFullscreenState)
    listenerMetrics.delegatedActive += 1
  }
  if (typeof ResizeObserver !== 'undefined') {
    layoutResizeObserver = new ResizeObserver(() => {
      updateFullscreenLayoutHeight()
    })
    ;[
      scheduleCardRef.value,
      scheduleHeaderRef.value,
      batchToolbarRef.value,
      stressToolbarRef.value,
      paginationBarRef.value
    ]
      .filter(Boolean)
      .forEach(target => layoutResizeObserver.observe(target))
  }
  updateFullscreenLayoutHeight()
  bindTableScrollListeners()
  listenerMetrics.elementLevelEstimated = (virtualVisibleEmployees.value.length * (virtualVisibleDays.value.length + 1)) + virtualVisibleDays.value.length
  if (import.meta.env.DEV) {
    console.info('[ScheduleListenerMetrics]', {
      estimatedElementLevelBeforeDelegation: listenerMetrics.elementLevelEstimated,
      delegatedActive: listenerMetrics.delegatedActive
    })
  }
  const supervisorId = getSupervisorIdFromStorage()
  const storedPreference = loadIncludeSelfPreference(supervisorId)
  let resolvedIncludeSelf = storedPreference
  if (showIncludeSelfToggle.value) {
    try {
      const res = await apiFetch('/api/schedules/preferences/include-self')
      if (res.ok && typeof res.json === 'function') {
        const data = await res.json()
        resolvedIncludeSelf = Boolean(data?.includeSelf)
      }
    } catch (error) {
      console.warn('Failed to load includeSelf preference from server', error)
    }
  }
  if (resolvedIncludeSelf === true && showIncludeSelfToggle.value) {
    includeSelf.value = true
  }
  persistIncludeSelfPreference(Boolean(includeSelf.value), supervisorId)
  try {
    await fetchHolidays()
    await fetchShiftOptions()
    await fetchSupervisorContext()
    await fetchOptions()
    await fetchEmployees(
      selectedDepartment.value,
      selectedSubDepartment.value
    )
    await refreshScheduleData({ reset: true, reason: 'mounted-init' })
  } finally {
    isInitializingIncludeSelf = false
  }
})

watch(isTableFullscreen, () => {
  updateFullscreenLayoutHeight()
  bindTableScrollListeners()
})

watch(
  [visibleEmployees, days, shouldUseVirtualRender, dayColumnWidth],
  () => {
    recalculateViewportRanges()
    bindTableScrollListeners()
  },
  { flush: 'post' }
)

watch(days, () => {
  invalidateCellMetaCache()
})

watch(tableMaxHeight, () => {
  bindTableScrollListeners()
})

watch([virtualVisibleEmployees, virtualVisibleDays], () => {
  listenerMetrics.elementLevelEstimated =
    (virtualVisibleEmployees.value.length * (virtualVisibleDays.value.length + 1)) +
    virtualVisibleDays.value.length
  if (import.meta.env.DEV) {
    console.info('[ScheduleListenerMetrics:update]', {
      estimatedElementLevelBeforeDelegation: listenerMetrics.elementLevelEstimated,
      delegatedActive: listenerMetrics.delegatedActive
    })
  }
})

watch(
  () => [perfMetrics.employeeStatusRecomputeCount, perfMetrics.cellMetaComputeCount],
  () => {
    if (!import.meta.env.DEV) return
    console.info('[SchedulePerfMetrics]', perfSnapshot.value)
  }
)

onUpdated(() => {
  updateFullscreenLayoutHeight()
})
</script>


<style scoped lang="scss">
@use "element-plus/theme-chalk/src/common/var.scss" as *;

/* Mixin for ultra-enhanced scrollbar styling */
@mixin enhanced-table-scrollbar {
  /* Force scrollbar to always be visible */
  overflow-x: scroll !important;
  overflow-y: scroll !important;
  
  /* Firefox: thick scrollbar with bright colors for better visibility */
  scrollbar-color: #06b6d4 #cbd5e1 !important; /* Brighter cyan thumb, darker track */
  scrollbar-width: thick !important; /* Use thick instead of auto for Firefox */
  
  /* Webkit browsers (Chrome, Safari, Edge) */
  /* Large scrollbar: 32px for improved visibility and easier interaction */
  &::-webkit-scrollbar {
    height: 32px !important; /* Increased from 24px to 32px for better visibility */
    width: 32px !important;
    -webkit-appearance: none !important;
  }
  
  &::-webkit-scrollbar-track {
    background: #cbd5e1 !important; /* Darker track for better contrast */
    border-radius: 8px !important;
    border: 2px solid #94a3b8 !important; /* Border for better definition */
    box-shadow: inset 0 0 6px rgba(0, 0, 0, 0.1) !important; /* Subtle depth effect */
  }
  
  &::-webkit-scrollbar-thumb {
    background: #06b6d4 !important; /* Bright cyan for high visibility */
    border-radius: 8px !important;
    border: 2px solid #ffffff !important; /* White border for contrast */
    min-height: 60px !important; /* Larger grabbing area for easier interaction */
    min-width: 60px !important;
    box-shadow: 0 2px 8px rgba(6, 182, 212, 0.3) !important; /* Glow effect for prominence */
    
    &:hover {
      background: #0891b2 !important; /* Slightly darker on hover for feedback */
      box-shadow: 0 2px 12px rgba(6, 182, 212, 0.5) !important; /* Stronger glow on hover */
    }
    
    &:active {
      background: #0e7490 !important; /* Darker when actively dragging */
      box-shadow: 0 2px 16px rgba(6, 182, 212, 0.6) !important; /* Maximum glow when active */
    }
  }
  
  /* Hide scrollbar arrow buttons for cleaner appearance */
  &::-webkit-scrollbar-button {
    display: none !important;
  }
}

/* Modern HR system styling with professional design */
.schedule-page {
  --header-bg-color: #ecfeff;
  --table-max-height-offset: 400px; /* Accounts for page header, filters, actions, and pagination */
  
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

.filters-card,
.publish-card,
.actions-card,
.schedule-card,
.approval-card {
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

    &.filter-group-hidden {
      visibility: hidden;
      pointer-events: none;
    }

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

  .publish-disable-reasons {
    margin-top: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;

    .publish-disable-reason {
      margin: 0;
      color: #92400e;
      font-size: 0.86rem;
      line-height: 1.45;
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

    .disputes-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: 8px;
    }

    .dispute-item {
      padding: 8px 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.9);
      border-left: 3px solid #dc2626;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .dispute-date {
      font-size: 0.8rem;
      font-weight: 700;
      color: #b91c1c;
    }

    .dispute-note {
      font-size: 0.85rem;
      color: #475569;
      line-height: 1.4;
      padding-left: 4px;

      &.empty {
        color: #94a3b8;
        font-style: italic;
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

.modern-date-picker,
.modern-select {
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

  .primary-actions,
  .secondary-actions {
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

  .selection-scope-hint {
    width: 100%;
    margin: 0;
    font-size: 0.9rem;
    color: #0f766e;
    font-weight: 600;
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
  --schedule-card-margin-bottom: 24px;
  --schedule-inline-padding: clamp(20px, 2vw, 32px);
  --schedule-header-block-padding: 20px;
  --schedule-batch-toolbar-block-padding: 16px;
  --schedule-stress-toolbar-block-padding: 10px;
  --schedule-table-wrapper-block-padding: 0;

  margin: 0 0 var(--schedule-card-margin-bottom);

  &.is-fullscreen {
    --schedule-card-margin-bottom: 0;
    --schedule-inline-padding: clamp(24px, 3vw, 40px);
    --schedule-header-block-padding: 20px;
    --schedule-batch-toolbar-block-padding: 16px;
    --schedule-stress-toolbar-block-padding: 10px;
    --schedule-table-wrapper-block-padding: 0;

    position: fixed;
    inset: 0;
    z-index: 3000;
    margin: 0;
    border-radius: 0;
    border: none;
    box-shadow: none;
    display: flex;
    flex-direction: column;
    background: #fff;
  }

  .schedule-header {
    background: linear-gradient(135deg, #f1f5f9 0%, #ecfeff 100%);
    padding: var(--schedule-header-block-padding) var(--schedule-inline-padding);
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 16px;
    min-height: 96px;

    .schedule-title-wrapper {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-height: 48px;
      justify-content: center;
    }

    .schedule-title {
      color: #164e63;
      font-size: 1.25rem;
      font-weight: 700;
      margin: 0;
    }

    .fullscreen-filter-hint {
      margin: 0;
      font-size: 0.85rem;
      color: #334155;
      font-weight: 500;
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
    padding: var(--schedule-batch-toolbar-block-padding) var(--schedule-inline-padding);
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
    min-width: 120px;
  }

  .row-color-option {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .row-color-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1px solid #94a3b8;
    display: inline-block;
  }

  .row-color-hint {
    font-size: 12px;
    color: #64748b;
  }
}

.schedule-table-wrapper {
  overflow-x: auto;
  padding: var(--schedule-table-wrapper-block-padding) var(--schedule-inline-padding);

  &.is-fullscreen {
    flex: 1;
    min-height: 0;
  }

  /* Element Plus table handles its own scrolling with max-height prop */
  /* Enhanced scrollbar styling for improved visibility and usability */
  :deep(.el-table__body-wrapper) {
    @include enhanced-table-scrollbar;
  }

  /* Additional Element Plus Scrollbar styling - z-index to ensure visibility */
  :deep(.el-scrollbar__bar.is-horizontal) {
    z-index: 10 !important; /* Ensure it's on top */
  }
}

.stress-toolbar {
  padding: var(--schedule-stress-toolbar-block-padding) var(--schedule-inline-padding);
  border-bottom: 1px dashed #cbd5e1;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  background: #f8fafc;
}

.stress-metric {
  font-size: 12px;
  color: #475569;
}

.modern-schedule-table {
  min-width: max-content;

  :deep(.el-table__body .schedule-row > td.el-table__cell) {
    background-color: var(--row-color-bg, #ffffff);
    border-bottom-color: var(--row-color-border, #e2e8f0);
  }

  :deep(.el-table__body .schedule-row--selected > td.el-table__cell) {
    background-color: #dbeafe !important;
  }

  /* Element Plus handles sticky header when max-height is set */
  :deep(.el-table__header-wrapper) {
    background: var(--header-bg-color);
  }

  :deep(.el-table__header) {
    th {
      border-bottom: 2px solid #ecfeff;
    }
  }

  :deep(.el-table__row) {
    &:hover {
      background-color: var(--row-color-bg, #f8fafc) !important;
    }
  }

  :deep(.el-table__cell) {
    font-size: 13px;
  }
}

.virtual-spacer-cell {
  min-height: 1px;
}

.schedule-card.is-fullscreen {
  .schedule-fullscreen-popper-host {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 3000;
  }

  .modern-schedule-table {
    :deep(.el-table__cell) {
      font-size: 12px;
    }

    :deep(.title-position-column .cell) {
      min-width: 220px;
    }

    :deep(.day-header) {
      font-size: 12px;
    }
  }

  :deep(.el-table__fixed),
  :deep(.el-table__fixed-right),
  :deep(.el-table__fixed-column--left) {
    z-index: 25;
  }

  :deep(.schedule-cell-editor-popper--fullscreen) {
    z-index: 3001 !important;
    pointer-events: auto;
  }

  :deep(.schedule-fullscreen-popper-host .schedule-cell-editor-popper--fullscreen),
  :deep(.schedule-fullscreen-popper-host .el-select-dropdown),
  :deep(.schedule-fullscreen-popper-host .el-popper) {
    pointer-events: auto;
  }
}

.pagination-bar {
  padding: 16px 0;
  display: flex;
  justify-content: flex-end;
}

.employee-name {
  font-weight: 600;
  color: #1e293b;
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  font-size: 1rem;
  line-height: 1.25;
}

.employee-name-text {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.employee-status-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  flex-shrink: 0;
}

.title-position-cell {
  min-height: 40px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  line-height: 1.25;
}

.title-line,
.practice-title-line {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.title-line {
  font-weight: 600;
  color: #334155;
}

.practice-title-line {
  font-size: 0.75rem;
  color: #64748b;
}

.row-checkbox {
  margin-right: 0;
  transform: translateY(1px);
}

.status-icon {
  font-size: 0.9rem;
  margin-left: 2px;

  &.unscheduled {
    color: #dc2626;
  }

  &.on-leave {
    color: #f59e0b;
  }
}

.sub-department-text {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #334155;
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
    background: linear-gradient(135deg,
        var(--shift-cell-bg-start, #f1f5f9) 0%,
        var(--shift-cell-bg-end, #e2e8f0) 100%);
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

  &.text-only {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    padding: 2px 6px;
    background: transparent;
    border-style: dashed;
    transform: none;

    &:hover {
      background: rgba(14, 165, 233, 0.12);
      color: var(--shift-text-color, #164e63);
      transform: none;
    }
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

.leave-text {
  font-size: 0.75rem;
  color: #b45309;
  font-weight: 600;
  letter-spacing: 0.05em;
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
  /* Enhanced scrollbar styling for better visibility and usability */
  :deep(.el-table__body-wrapper) {
    @include enhanced-table-scrollbar;
  }

  ::v-deep(.el-table__row) {
    &:hover {
      background-color: #f8fafc !important;
    }
  }
}

.applicant-name,
.form-type {
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

    .primary-actions,
    .secondary-actions {
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

/* Annual Leave Column Styling */
.annual-leave-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  
  .leave-hours {
    font-size: 0.75rem;
    color: #64748b;
  }
}

.no-leave-info {
  color: #94a3b8;
  font-size: 0.875rem;
}
</style>
