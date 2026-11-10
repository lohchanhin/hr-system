<template>
  <div ref="schedulePageRef" class="schedule-page" @keydown="handlePageKeydown">
    <!-- 頁首：標題、三個統計數字，月份／部門／單位在同一列（規範見 docs/ui-guidelines.md） -->
    <PageHeader compact title="排班管理">
      <template #stats>
        <ScheduleDashboard :summary="summary" />
      </template>
      <template #actions>
        <div class="schedule-filters" role="group" aria-label="排班範圍">
          <div class="month-switcher">
            <el-button class="month-step" aria-label="上個月" title="上個月" data-test="month-prev" @click="stepMonth(-1)">
              <el-icon><ArrowLeft /></el-icon>
            </el-button>
            <el-date-picker v-model="currentMonth" type="month" value-format="YYYY-MM" format="YYYY/MM"
              :clearable="false" :editable="false" aria-label="月份" class="schedule-filter schedule-filter--month"
              @change="onMonthChange" />
            <el-button class="month-step" aria-label="下個月" title="下個月" data-test="month-next" @click="stepMonth(1)">
              <el-icon><ArrowRight /></el-icon>
            </el-button>
          </div>
          <el-select v-model="selectedDepartment" placeholder="部門" aria-label="部門" @change="onDepartmentChange"
            :disabled="!canSwitchDepartment" class="schedule-filter schedule-filter--department"
            data-test="schedule-department-select">
            <el-option v-for="dept in departments" :key="dept._id" :label="departmentLabel(dept)" :value="dept._id" />
          </el-select>
          <el-select v-model="selectedSubDepartment" placeholder="單位" aria-label="單位" @change="onSubDepartmentChange"
            class="schedule-filter schedule-filter--unit" data-test="schedule-subdepartment-select">
            <el-option v-for="sub in filteredSubDepartments" :key="sub._id" :label="sub.name" :value="sub._id" />
          </el-select>
          <label v-if="showIncludeSelfToggle" class="include-self-toggle">
            <span>包含自己</span>
            <el-switch v-model="includeSelf" active-text="是" inactive-text="否" inline-prompt />
          </label>
        </div>
      </template>
    </PageHeader>

    <!-- 發布狀態：一列。目前狀態、待回覆與異議筆數、下一步的按鈕；四個步驟與名單按「流程詳情」才展開 -->
    <section v-if="canEditSchedule" ref="publishBarRef" class="publish-bar" aria-label="發布狀態">
      <div class="publish-bar__row">
        <span class="publish-bar__label">發布狀態</span>
        <span class="status-badge" :class="`status-${publishSummary.status}`" data-test="publish-status-badge">
          {{ publishStatusLabel }}
        </span>
        <span class="publish-bar__meta" data-test="publish-meta">
          {{ publishSummary.publishedAt ? `最近發布 ${formatPublishDate(publishSummary.publishedAt)}` : '本月尚未發布' }}
        </span>
        <button v-if="pendingCount" type="button" class="publish-chip publish-chip--pending"
          data-test="publish-pending-chip" @click="publishDetailVisible = true">
          待回覆 {{ pendingCount }} 筆
        </button>
        <button v-if="disputedCount" type="button" class="publish-chip publish-chip--disputed"
          data-test="publish-disputed-chip" @click="publishDetailVisible = true">
          異議 {{ disputedCount }} 筆
        </button>
        <span v-if="unpublishedNotice" class="publish-chip publish-chip--static" data-test="publish-unsent-chip">
          {{ unpublishedNotice }}
        </span>
        <el-button text class="publish-bar__detail-toggle" :aria-expanded="publishDetailVisible"
          data-test="publish-detail-toggle" @click="publishDetailVisible = !publishDetailVisible">
          {{ publishDetailVisible ? '收合流程' : '流程詳情' }}
        </el-button>
        <span class="publish-bar__spacer"></span>
        <span v-if="publishActionHint" class="publish-bar__hint" :title="publishActionHint"
          data-test="publish-disable-reasons">
          {{ publishActionHint }}
        </span>
        <template v-if="publishSummary.status !== 'finalized'">
          <!-- 已經發送過：可以重新發送（改過班表後），下一步是完成發布 -->
          <template v-if="isPublishedRound">
            <el-button :type="hasUnpublishedChanges ? 'primary' : 'default'" class="publish-btn" :loading="isPublishing"
              :disabled="publishDisabled || scheduleRuleValidation.checking" data-test="publish-button"
              @click="confirmPublish">
              重新發送
            </el-button>
            <el-button :type="hasUnpublishedChanges ? 'default' : 'primary'" class="publish-btn" :loading="isFinalizing"
              :disabled="finalizeDisabled || scheduleRuleValidation.checking" data-test="finalize-button"
              @click="confirmFinalize">
              完成發布
            </el-button>
          </template>
          <el-button v-else type="primary" class="publish-btn" :loading="isPublishing"
            :disabled="publishDisabled || scheduleRuleValidation.checking" data-test="publish-button"
            @click="confirmPublish">
            發送待確認
          </el-button>
        </template>
      </div>

      <div v-show="publishDetailVisible" class="publish-detail" data-test="publish-detail">
        <div class="publish-progress" data-test="publish-steps">
          <el-steps :active="publishStepIndex" finish-status="success" align-center>
            <el-step title="草稿" description="建立班表草稿" :status="stepStatuses.draft" />
            <el-step title="待確認" :description="pendingStepDescription" :status="stepStatuses.pending" />
            <el-step title="異議" :description="disputeStepDescription" :status="stepStatuses.disputed" />
            <el-step title="完成" :description="finalStepDescription" :status="stepStatuses.finalized" />
          </el-steps>
        </div>

        <div v-if="publishProgress > 0 && publishSummary.status !== 'finalized'" class="publish-progress-indicator">
          <el-progress :percentage="publishProgress" :stroke-width="8" status="success" :show-text="false" />
          <span class="progress-label">{{ publishProgress }}% 已回覆</span>
        </div>

        <div class="publish-stats">
          <div v-if="pendingCount" class="status-card pending" data-test="pending-card">
            <div class="card-header">
              <span class="card-title">待回覆</span>
              <span class="card-badge">{{ pendingCount }}</span>
            </div>
            <ul class="card-list">
              <li v-for="emp in publishSummary.pendingEmployees" :key="emp.id" class="card-item">
                <span class="card-name card-name--avatar">
                  <EmployeeAvatar :employee="publishEmployeeAvatar(emp)" :size="20" class="schedule-employee-avatar" />
                  {{ emp.name }}
                </span>
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
                  <span class="card-name card-name--avatar">
                    <EmployeeAvatar :employee="publishEmployeeAvatar(emp)" :size="20" class="schedule-employee-avatar" />
                    {{ emp.name }}
                  </span>
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
            </div>
            <p class="card-message">所有員工已完成回覆，可以完成發布。</p>
          </div>

          <div v-if="publishSummary.status === 'finalized'" class="status-card finalized" data-test="finalized-card">
            <div class="card-header">
              <span class="card-title">已鎖定</span>
            </div>
            <p class="card-message">班表已完成發布並鎖定。</p>
          </div>
        </div>
      </div>
    </section>

    <div ref="scheduleCardRef" class="schedule-card" :class="{ 'is-fullscreen': isTableFullscreen }" data-test="schedule-card">
      <div
        ref="fullscreenPopperHostRef"
        class="schedule-fullscreen-popper-host"
        data-test="fullscreen-popper-host"
      ></div>
      <div ref="scheduleHeaderRef" class="schedule-header">
        <!-- 第一列：人數與最近一次變更的狀態在左，工具在右（常用的直接顯示，其餘收進「更多」） -->
        <div class="schedule-toolbar">
          <div class="schedule-toolbar__status" aria-live="polite">
            <span class="schedule-scope-count" data-test="schedule-scope-count">
              <template v-if="isTableFullscreen">{{ fullscreenFilterHint }}｜</template>{{ serverPaginationTotal }} 位員工
            </span>
            <span v-if="gridBusyText" class="schedule-status" data-state="saving" data-test="grid-busy-status">
              {{ gridBusyText }}
            </span>
            <span v-else-if="lastChange" class="schedule-status" :data-state="lastChange.status"
              :title="lastChange.text" data-test="last-change-status">
              <span class="schedule-status__text">{{ lastChange.text }}</span>
              <el-button v-if="canUndoLastChange" link type="primary" class="schedule-status__undo"
                title="復原上一次變更（Ctrl+Z）" data-test="undo-last-change" @click="undoLastChange">
                復原
              </el-button>
            </span>
          </div>
          <div class="approval-summary-inline" data-test="approval-summary-inline">
            <span class="approval-summary-inline-item">
              <span class="approval-summary-inline-label">待簽核</span>
              <strong class="approval-summary-inline-value" data-test="approval-summary-pending">{{ pendingApprovalCount }}</strong>
            </span>
            <span class="approval-summary-inline-item">
              <span class="approval-summary-inline-label">異議</span>
              <strong class="approval-summary-inline-value" data-test="approval-summary-disputed">{{ disputedApprovalCount }}</strong>
            </span>
            <el-button
              link
              type="primary"
              class="approval-jump-btn"
              :disabled="!relatedApprovalRows.length"
              data-test="approval-jump-button"
              @click="jumpToApprovalSection"
            >
              查看簽核
            </el-button>
          </div>
          <div class="schedule-view-actions">
            <input
              ref="scheduleImportInput"
              type="file"
              accept=".xlsx"
              hidden
              @change="onScheduleImportFile"
            />
            <el-button
              class="action-btn secondary"
              :loading="isImportingSchedule"
              :disabled="!selectedDepartment"
              data-test="schedule-import-button"
              @click="openScheduleImport"
            >
              <el-icon><Upload /></el-icon>
              匯入
            </el-button>
            <el-popover
              v-model:visible="exportMenuVisible"
              trigger="click"
              placement="bottom-end"
              :width="168"
              :append-to="toolbarPopperAppendTarget"
              :popper-class="toolbarPopperClassName"
            >
              <template #reference>
                <el-button class="action-btn secondary" :loading="Boolean(isExporting)" :disabled="exportDisabled"
                  :title="exportDisabled ? exportDisabledReason : ''" data-test="schedule-export-button">
                  <el-icon><Download /></el-icon>
                  匯出
                </el-button>
              </template>
              <div class="schedule-menu" role="menu" aria-label="匯出格式">
                <button type="button" class="schedule-menu__item" role="menuitem" :disabled="exportDisabled"
                  data-test="export-excel-button" @click="runMenuAction('export', exportExcel)">
                  匯出 Excel
                </button>
                <button type="button" class="schedule-menu__item" role="menuitem" :disabled="exportDisabled"
                  data-test="export-pdf-button" @click="runMenuAction('export', exportPdf)">
                  匯出 PDF
                </button>
              </div>
            </el-popover>
            <el-badge
              :value="scheduleRuleValidation.count || scheduleRuleValidation.pendingCount"
              :hidden="!scheduleRuleValidation.count && !scheduleRuleValidation.pendingCount"
              :type="scheduleRuleValidation.count ? 'danger' : 'info'"
              :max="999"
            >
              <el-button
                class="action-btn secondary"
                data-test="schedule-rule-issues-button"
                :loading="scheduleRuleValidation.checking"
                @click="inspectScheduleRules"
              >
                <el-icon><WarningFilled /></el-icon>
                排班檢核
              </el-button>
            </el-badge>
            <el-popover
              v-model:visible="moreMenuVisible"
              trigger="click"
              placement="bottom-end"
              :width="208"
              :append-to="toolbarPopperAppendTarget"
              :popper-class="toolbarPopperClassName"
            >
              <template #reference>
                <el-button class="action-btn secondary" data-test="schedule-more-button">
                  更多
                  <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                </el-button>
              </template>
              <div class="schedule-menu" role="menu" aria-label="更多功能">
                <button type="button" class="schedule-menu__item" role="menuitem" :disabled="!employees.length"
                  data-test="preview-week-button" @click="runMenuAction('more', () => preview('week'))">
                  預覽週表
                </button>
                <button type="button" class="schedule-menu__item" role="menuitem" :disabled="!employees.length"
                  data-test="preview-month-button" @click="runMenuAction('more', () => preview('month'))">
                  預覽月表
                </button>
                <button type="button" class="schedule-menu__item" role="menuitem"
                  data-test="notification-log-button" @click="runMenuAction('more', () => { notificationDrawerVisible = true })">
                  通知日誌<span v-if="scheduleNotifications.length" class="schedule-menu__count">{{ scheduleNotifications.length }}</span>
                </button>
                <button v-if="canEditSchedule" type="button" class="schedule-menu__item" role="menuitem"
                  data-test="holiday-ledger-button" @click="runMenuAction('more', openHolidayLedger)">
                  國定假日休假
                </button>
                <button type="button" class="schedule-menu__item" role="menuitem"
                  data-test="toggle-info-columns-button" @click="runMenuAction('more', toggleEmployeeInfoColumns)">
                  {{ showEmployeeInfoColumns ? '隱藏單位、職稱與特休欄' : '顯示單位、職稱與特休欄' }}
                </button>
              </div>
            </el-popover>
            <el-button class="action-btn secondary fullscreen-toggle" @click="toggleTableFullscreen"
              data-test="fullscreen-toggle-button">
              <el-icon><FullScreen /></el-icon>
              {{ isTableFullscreen ? '退出全螢幕' : '全螢幕' }}
            </el-button>
            <el-button v-if="isTableFullscreen" class="action-btn secondary fullscreen-collapse-toggle"
              @click="toggleFullscreenToolbar" data-test="fullscreen-toolbar-toggle-button">
              <el-icon><component :is="isFullscreenToolbarCollapsed ? Expand : Fold" /></el-icon>
              {{ isFullscreenToolbarCollapsed ? '展開工具' : '收合工具' }}
            </el-button>
          </div>
        </div>

        <!-- 第二列：平常是班別圖例與搜尋；勾選了員工、日期或格子之後，同一列換成批次操作（表格不會上下跳動） -->
        <div
          ref="batchToolbarRef"
          v-show="!isTableFullscreen || !isFullscreenToolbarCollapsed"
          class="batch-toolbar"
          :class="{ 'is-selecting': hasSelectionContext }"
        >
          <div v-show="!hasSelectionContext" class="grid-toolbar__idle">
            <div class="schedule-legend" data-test="schedule-legend">
              <template v-if="legendShifts.length">
                <span v-for="legend in legendShifts" :key="legend.key" class="legend-item" :style="legend.style"
                  :title="legend.title" data-test="shift-legend-item">
                  {{ legend.label }}
                </span>
              </template>
              <span v-else class="legend-empty" data-test="shift-legend-empty">
                尚未設定班別
              </span>
              <span class="legend-item leave">請假</span>
            </div>
            <div class="schedule-search-controls">
              <el-input v-model="employeeSearch" placeholder="搜尋員工"
                :prefix-icon="Search" clearable class="employee-search" />
              <el-select v-model="statusFilter" placeholder="狀態" aria-label="排班狀態" class="status-filter"
                :teleported="isToolbarDropdownTeleported"
                :append-to="toolbarPopperAppendTarget"
                :popper-class="toolbarPopperClassName">
                <el-option label="全部" value="all" />
                <el-option label="缺班" value="unscheduled" />
                <el-option label="待審核請假" value="onLeave" />
              </el-select>
              <el-input v-model="jobTypeFilter" placeholder="搜尋職別"
                :prefix-icon="Filter" clearable class="employee-search" />
            </div>
          </div>

          <div
            v-if="canEditSchedule"
            v-show="hasSelectionContext"
            class="grid-toolbar__selection"
            role="toolbar"
            aria-label="批次操作"
            data-test="selection-bar"
          >
            <span class="selection-bar__count" :title="allEmployeesSelectionHint" data-test="selection-scope-hint">
              {{ selectionSummaryText }}
            </span>
            <el-select
              v-model="batchShiftId"
              placeholder="套用班別"
              aria-label="套用班別"
              class="modern-select batch-select"
              filterable
              :teleported="isToolbarDropdownTeleported"
              :append-to="toolbarPopperAppendTarget"
              :popper-class="toolbarPopperClassName"
              data-test="batch-shift-select"
            >
              <el-option v-for="opt in availableShifts" :key="opt._id" :label="formatShiftLabel(opt)" :value="opt._id" />
            </el-select>
            <el-button type="primary" class="action-btn primary apply-btn"
              :disabled="!hasAnySelection || !batchShiftId || isApplyingBatch" :loading="isApplyingBatch"
              @click="applyBatch" data-test="batch-apply-button">
              套用
            </el-button>
            <el-button type="danger" plain class="action-btn apply-btn"
              :disabled="!selectedPersistedSchedules.length || isClearingBatch" :loading="isClearingBatch"
              @click="clearSelectedSchedules" data-test="batch-clear-button">
              <el-icon><Delete /></el-icon>
              清空排班
            </el-button>
            <el-popover
              trigger="click"
              placement="bottom-start"
              :width="260"
              :append-to="toolbarPopperAppendTarget"
              :popper-class="toolbarPopperClassName"
            >
              <template #reference>
                <el-button class="action-btn secondary" :disabled="!selectedEmployeesSet.size"
                  :title="selectedEmployeesSet.size ? '' : '勾選員工（整列）後才能設定列色'" data-test="batch-row-color-button">
                  列色
                  <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                </el-button>
              </template>
              <div class="batch-popover">
                <el-select
                  v-model="batchRowColorIndex"
                  placeholder="設定整列顏色"
                  aria-label="整列顏色"
                  clearable
                  class="modern-select batch-select"
                  :teleported="isToolbarDropdownTeleported"
                  :append-to="toolbarPopperAppendTarget"
                  :popper-class="toolbarPopperClassName"
                  data-test="batch-row-color-select"
                >
                  <el-option v-for="opt in rowColorOptions" :key="opt.index" :label="opt.label" :value="opt.index">
                    <span class="row-color-option">
                      <span class="row-color-dot" :style="{ backgroundColor: opt.bg, borderColor: opt.border }"></span>
                      {{ opt.label }}
                    </span>
                  </el-option>
                </el-select>
                <div class="batch-popover__actions">
                  <el-button class="action-btn secondary apply-btn" :disabled="!canApplyRowColor" @click="applyRowColor"
                    data-test="batch-row-color-apply">
                    套用列色
                  </el-button>
                  <el-button class="action-btn secondary apply-btn" plain :disabled="!selectedEmployeesSet.size" @click="clearRowColor"
                    data-test="batch-row-color-clear">
                    清除列色
                  </el-button>
                </div>
                <p class="row-color-hint">列色只保留在這次瀏覽，關閉分頁後清除。</p>
              </div>
            </el-popover>
            <el-popover
              trigger="click"
              placement="bottom-start"
              :width="280"
              :append-to="toolbarPopperAppendTarget"
              :popper-class="toolbarPopperClassName"
            >
              <template #reference>
                <el-button class="action-btn secondary" :class="{ 'is-active': hasBatchScopeOverride }"
                  data-test="batch-scope-button">
                  {{ batchScopeLabel }}
                  <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                </el-button>
              </template>
              <div class="batch-popover">
                <template v-if="isTableFullscreen">
                  <div class="batch-readonly-field" data-test="batch-dept-readonly">
                    <span class="batch-readonly-field__label">套用部門</span>
                    <span class="batch-readonly-field__value">{{ batchDepartmentDisplayName }}</span>
                  </div>
                  <div class="batch-readonly-field" data-test="batch-subdept-readonly">
                    <span class="batch-readonly-field__label">套用單位</span>
                    <span class="batch-readonly-field__value">{{ batchSubDepartmentDisplayName }}</span>
                  </div>
                </template>
                <template v-else>
                  <el-select
                    v-model="batchDepartment"
                    placeholder="套用部門"
                    aria-label="套用部門"
                    clearable
                    class="modern-select batch-select"
                    data-test="batch-dept-select"
                  >
                    <el-option v-for="dept in departments" :key="dept._id" :label="departmentLabel(dept)" :value="dept._id" />
                  </el-select>
                  <el-select
                    v-model="batchSubDepartment"
                    placeholder="套用單位"
                    aria-label="套用單位"
                    clearable
                    class="modern-select batch-select"
                    :disabled="!batchDepartment"
                    data-test="batch-subdept-select"
                  >
                    <el-option v-for="sub in batchSubDepartments" :key="sub._id" :label="sub.name" :value="sub._id" />
                  </el-select>
                </template>
                <p class="row-color-hint">套用班別時一併把班表掛到這個部門與單位；不指定就維持各格原本的設定。</p>
              </div>
            </el-popover>
            <span class="grid-toolbar__spacer"></span>
            <el-button class="action-btn secondary" title="取消選取（Esc）" data-test="selection-cancel-button"
              @click="clearSelection">
              <el-icon><Close /></el-icon>
              取消選取
            </el-button>
          </div>

          <el-popover
            v-if="canEditSchedule"
            v-model:visible="selectionMenuVisible"
            trigger="click"
            placement="bottom-end"
            :width="300"
            :append-to="toolbarPopperAppendTarget"
            :popper-class="toolbarPopperClassName"
          >
            <template #reference>
              <el-button class="action-btn secondary selection-menu-button" data-test="selection-menu-button">
                選取
                <el-icon class="el-icon--right"><ArrowDown /></el-icon>
              </el-button>
            </template>
            <div class="batch-popover">
              <SelectionActions
                :compact="isTableFullscreen"
                :has-any-selection="hasSelectionContext"
                :employees-length="employees.length"
                :server-pagination-total="serverPaginationTotal"
                :is-selecting-all-employees-across-pages="isSelectingAllEmployeesAcrossPages"
                :days-length="days.length"
                @clear-selection="clearSelection"
                @select-all-employees-on-page="selectAllEmployeesOnPage"
                @select-all-employees-across-pages="selectAllEmployeesAcrossPages"
                @select-all-days="selectAllDays"
              />
              <el-date-picker v-model="customRange" type="daterange" format="YYYY/MM/DD" start-placeholder="選取日期：開始" end-placeholder="結束"
                range-separator="至" unlink-panels :disabled="!days.length" :teleported="!isTableFullscreen"
                class="range-picker" data-test="selection-range-picker" @change="onCustomRangeChange" />
              <p class="row-color-hint">也可以直接勾選員工、日期或格子；按住 Shift 點第二格可選取一整塊範圍。</p>
            </div>
          </el-popover>
        </div>
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

      <!-- 排班檢核結果：平常只佔一行，明細按「展開」才列出（排班規範只提醒、不擋發布） -->
      <section v-if="scheduleIssues.lines.length" class="schedule-rule-results" :class="{ 'is-collapsed': !ruleResultsExpanded }"
        aria-label="完整排班檢核結果" data-test="schedule-rule-results">
        <div class="schedule-rule-heading">
          <h3>{{ scheduleIssues.title }}（共 {{ scheduleIssues.lines.length }} 項）</h3>
          <el-button link type="primary" :aria-expanded="ruleResultsExpanded" data-test="schedule-rule-results-toggle"
            @click="ruleResultsExpanded = !ruleResultsExpanded">
            {{ ruleResultsExpanded ? '收合' : '展開明細' }}
          </el-button>
        </div>
        <ol v-show="ruleResultsExpanded" tabindex="0" aria-label="全部不合規明細">
          <li v-for="(line, index) in scheduleIssues.lines" :key="index">{{ line }}</li>
        </ol>
      </section>
      <section v-if="schedulePendingLines.length" class="schedule-rule-pending" :class="{ 'is-collapsed': !rulePendingExpanded }"
        aria-label="尚無法判斷的跨月週" data-test="schedule-rule-pending">
        <div class="schedule-rule-heading">
          <h3>尚無法判斷的跨月週（共 {{ schedulePendingLines.length }} 項）</h3>
          <el-button link type="primary" :aria-expanded="rulePendingExpanded" data-test="schedule-rule-pending-toggle"
            @click="rulePendingExpanded = !rulePendingExpanded">
            {{ rulePendingExpanded ? '收合' : '展開明細' }}
          </el-button>
        </div>
        <div v-show="rulePendingExpanded">
          <p class="schedule-rule-pending-hint">{{ PENDING_WEEK_HINT }}</p>
          <ol tabindex="0" aria-label="尚無法判斷的跨月週明細">
            <li v-for="(line, index) in schedulePendingLines" :key="index">{{ line }}</li>
          </ol>
        </div>
      </section>
      <!-- 公司行事曆尚未建立或尚未核定：一行提醒，管理員可以直接前往設定 -->
      <p
        v-if="calendarStatus?.provisional && calendarStatus?.message"
        class="calendar-provisional-alert"
        role="status"
        data-test="calendar-provisional-alert"
      >
        <el-icon aria-hidden="true"><WarningFilled /></el-icon>
        <span>{{ calendarStatus.message }}</span>
        <el-button v-if="isAdminUser" link type="primary" data-test="calendar-settings-link" @click="goToCalendarSettings">
          前往行事曆設定
        </el-button>
      </p>
      <div ref="scheduleTableWrapperRef" class="schedule-table-wrapper" :class="{ 'is-fullscreen': isTableFullscreen }"
        data-test="schedule-table-wrapper" @click.capture="handleTableDelegatedClick"
        @change.capture="handleTableDelegatedChange">
        <el-table ref="scheduleTableRef" class="modern-schedule-table" :data="virtualVisibleEmployees" :max-height="tableMaxHeight"
          :empty-text="gridEmptyText" :header-cell-style="{
          backgroundColor: '#f4f6f7',
          color: '#344054',
          fontWeight: '650'
        }" :row-style="scheduleRowStyle" :row-class-name="scheduleRowClassName">
        <el-table-column prop="name" label="員工姓名" :width="isNarrowViewport ? 124 : 160" fixed="left" class-name="schedule-fixed-column">
          <template #header>
            <div class="employee-name-header">
              <el-checkbox v-if="canEditSchedule" class="row-checkbox" :model-value="isPageFullySelected"
                :indeterminate="isPagePartiallySelected" :disabled="!employees.length" aria-label="本頁全選"
                title="本頁全選" data-test="select-page-checkbox" @change="selectAllEmployeesOnPage" />
              <span>員工姓名</span>
            </div>
          </template>
          <template #default="{ row }">
            <div class="employee-name">
              <el-checkbox v-if="canEditSchedule" class="row-checkbox" :model-value="selectedEmployeesSet.has(row._id)"
                :data-schedule-action="'toggle-employee'" :data-emp-id="String(row._id)" />
              <EmployeeAvatar :employee="row" :size="22" class="schedule-employee-avatar" />
              <span class="employee-name-text" :title="row.name || '-'">
                {{ row.name || '-' }}
              </span>
              <span class="employee-status-secondary" aria-label="排班狀態">
                <el-tooltip v-if="row.partTime" content="兼職人員不套用排班規範檢核" placement="top">
                  <span class="employee-status-badge part-time" data-test="part-time-badge">兼職</span>
                </el-tooltip>
                <el-tooltip
                  v-if="(employeeStatusMap[row._id] || employeeStatus(row._id)) === 'unscheduled'"
                  content="尚有未排班日期，仍可點擊日期格安排班別"
                  placement="top"
                >
                  <span class="employee-status-badge unscheduled">缺班</span>
                </el-tooltip>
                <el-tooltip
                  v-else-if="(employeeStatusMap[row._id] || employeeStatus(row._id)) === 'onLeave'"
                  content="本月含請假日期"
                  placement="top"
                >
                  <span class="employee-status-badge on-leave">請假</span>
                </el-tooltip>
              </span>
            </div>
          </template>
        </el-table-column>
        <el-table-column v-if="showEmployeeInfoColumns" prop="subDepartmentName" label="單位" width="92"
          :fixed="isNarrowViewport ? false : 'left'" class-name="schedule-fixed-column sub-department-column">
          <template #default="{ row }">
            <span class="sub-department-text" :title="row.subDepartmentName || row.subDepartment || '-'">
              {{ row.subDepartmentName || row.subDepartment || '-' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column v-if="showEmployeeInfoColumns" label="職稱 / 職位" width="166"
          :fixed="isNarrowViewport ? false : 'left'" class-name="schedule-fixed-column title-position-column">
          <template #default="{ row }">
            <div class="title-position-cell">
              <span class="title-line" :title="row.title || row.practiceTitle || '-'">
                {{ row.title || row.practiceTitle || '-' }}
              </span>
              <span v-if="row.title && row.practiceTitle && row.practiceTitle !== row.title"
                class="practice-title-line" :title="row.practiceTitle">
                {{ row.practiceTitle }}
              </span>
            </div>
          </template>
        </el-table-column>

        <el-table-column v-if="showEmployeeInfoColumns" label="特休剩餘" width="96"
          :fixed="isNarrowViewport ? false : 'left'" class-name="schedule-fixed-column">
          <template #default="{ row }">
            <div v-if="row.annualLeave" class="annual-leave-info">
              <el-tag size="small" type="info">
                {{ row.annualLeave.remainingHours || 0 }}小時
              </el-tag>
              <span class="leave-hours">
                ({{ row.annualLeave.remainingDays || 0 }}天)
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
            <div class="day-header" :class="{ 'is-weekend': weekendDays.has(d.date), 'is-holiday': Boolean(d.holiday) }">
              <span class="day-header-label" :title="d.label">{{ d.label }}</span>
              <span
                v-for="info in d.infos || []"
                :key="info"
                class="day-header-info"
                :data-test="`day-header-info-${d.date}`"
              >{{ info }}</span>
              <div v-if="canEditSchedule" class="day-header-tools">
                <el-checkbox class="day-checkbox" :model-value="selectedDaysSet.has(d.date)"
                  :data-schedule-action="'toggle-day'" :data-day="String(d.date)" />
                <el-tooltip :content="dayMemos[d.date] || '新增日期備忘錄'" placement="top">
                  <el-button text circle class="day-memo-button" :class="{ 'has-content': !!dayMemos[d.date] }"
                    :aria-label="`${d.label}備忘錄`" :data-test="`day-memo-${d.date}`" @click.stop="openDayMemo(d.date)">
                    <el-icon><EditPen /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
            </div>
          </template>

          <template #default="{ row }">
            <ScheduleGridVirtualBody
              :row="row"
              :day="d"
              :cell-view="cellViewFor(row._id, d.date)"
              :can-edit="canEditSchedule"
              :shifts="availableShifts"
              :format-shift-label="formatShiftLabel"
              :is-fullscreen="isTableFullscreen"
              :fullscreen-popper-target="fullscreenPopperTarget"
              @select-shift="onSelect"
              @toggle-select="toggleCell"
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
        <el-pagination background layout="total, sizes, ->, prev, pager, next" :total="serverPaginationTotal"
          :page-size="pageSize" :current-page="currentPage" :page-sizes="[20, 30, 50, 100]"
          @current-change="onPageChange" @size-change="onPageSizeChange" />
      </div>
    </div>

    <!-- 相關簽核：預設收合，只顯示筆數；展開後分頁列出 -->
    <div ref="approvalCardRef" class="approval-card" :class="{ 'is-collapsed': approvalCollapsed }">
      <div class="approval-header">
        <h3 class="approval-title">相關簽核</h3>
        <div class="approval-count">{{ relatedApprovalRows.length }} 項</div>
        <el-button text class="approval-collapse-btn" :aria-expanded="!approvalCollapsed"
          data-test="approval-collapse-button" @click="approvalCollapsed = !approvalCollapsed">
          {{ approvalCollapsed ? '展開列表' : '收合列表' }}
        </el-button>
      </div>
      <el-alert
        v-if="approvalFetchError"
        class="approval-error-alert"
        type="warning"
        :closable="false"
        show-icon
        data-test="approval-error-alert"
        :title="approvalFetchError"
      />
      <div v-show="!approvalCollapsed" class="approval-body" data-test="approval-body">
      <p v-if="!approvalFetchError && !relatedApprovalRows.length" class="approval-empty-hint" data-test="approval-empty-hint">
        目前沒有相關簽核資料。
      </p>
      <el-table class="modern-approval-table" :data="displayedApprovalRows" :header-cell-style="{
        backgroundColor: '#f1f5f9',
        color: '#164e63',
        fontWeight: '600'
      }" v-if="relatedApprovalRows.length">
        <el-table-column label="資料類型" width="150">
          <template #default="{ row }">
            <el-tag :type="row.sourceType === 'schedule_confirmation' ? 'primary' : 'info'" class="status-tag" :title="row.sourceTypeLabel">
              {{ row.sourceTypeLabel }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="申請人" width="120">
          <template #default="{ row }">
            <div class="applicant-name applicant-name--avatar">
              <EmployeeAvatar :employee="approvalApplicant(row)" :size="22" class="schedule-employee-avatar" />
              <span>{{ row.applicantName }}</span>
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
            <el-button size="small" @click="openDetail(row._id)" :disabled="!row._id || row.sourceType === 'schedule_confirmation'">
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
      <p v-if="approvalTruncated" class="approval-collapse-hint" data-test="approval-truncated-hint">
        相關簽核超過 500 筆，只列出最新的 500 筆；可以縮小部門或單位範圍檢視。
      </p>
      </div>
    </div>
  </div>

  <el-dialog v-model="detail.visible" title="申請單明細" width="760px" destroy-on-close
    :append-to="toolbarPopperAppendTarget" @closed="onDetailClosed">
    <component :is="ApprovalDetailContent" v-if="detail.visible" :approval-id="detail.approvalId" />
    <template #footer>
      <el-button @click="detail.visible = false">關閉</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="memoDialog.visible" :title="`${memoDialog.date} 備忘錄`" width="520px" destroy-on-close
    :append-to="toolbarPopperAppendTarget">
    <el-input v-model="memoDialog.content" type="textarea" :rows="6" maxlength="1000" show-word-limit
      placeholder="輸入此日期的排班備忘錄，內容會一併匯出。" data-test="day-memo-input" />
    <template #footer>
      <el-button v-if="dayMemos[memoDialog.day]" type="danger" plain :disabled="memoDialog.saving"
        @click="clearDayMemo">清除備忘錄</el-button>
      <el-button @click="memoDialog.visible = false">取消</el-button>
      <el-button type="primary" :loading="memoDialog.saving" @click="saveDayMemo" data-test="day-memo-save">儲存</el-button>
    </template>
  </el-dialog>

  <HolidayLedgerDialog
    v-if="holidayLedgerRequested"
    v-model="holidayLedgerVisible"
    :scope="holidayLedgerScope"
    :can-resolve="canEditSchedule"
    :append-to="toolbarPopperAppendTarget"
  />

  <el-drawer v-model="notificationDrawerVisible" title="排班通知日誌" size="min(440px, 92vw)" append-to-body
    :append-to="toolbarPopperAppendTarget" class="schedule-notification-drawer">
    <div class="notification-log-toolbar">
      <span>保留最近 {{ NOTIFICATION_LIMIT }} 筆</span>
      <el-button text type="danger" :disabled="!scheduleNotifications.length" @click="clearScheduleNotifications">
        <el-icon><Delete /></el-icon>
        清空日誌
      </el-button>
    </div>
    <el-empty v-if="!scheduleNotifications.length" description="目前沒有通知" />
    <div v-else class="notification-log-list" data-test="notification-log-list">
      <article v-for="item in scheduleNotifications" :key="item.id" class="notification-log-item" :data-type="item.type">
        <div class="notification-log-item__heading">
          <div class="notification-log-item__title">
            <el-icon aria-hidden="true"><component :is="notificationIcon(item.type)" /></el-icon>
            <strong>{{ item.title }}</strong>
          </div>
          <time>{{ formatNotificationTime(item.createdAt) }}</time>
        </div>
        <p>{{ item.message }}</p>
        <ol v-if="item.details?.length" class="notification-log-item__details">
          <li v-for="(detail, detailIndex) in item.details" :key="`${item.id}-${detailIndex}`">
            {{ formatLaborRuleViolation(detail) }}
          </li>
        </ol>
        <el-button
          v-if="item.details?.length"
          class="notification-log-item__details-button"
          text
          @click="reopenNotificationDetails(item)"
        >
          在視窗檢視完整明細（{{ item.details.length }}）
        </el-button>
      </article>
    </div>
  </el-drawer>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, onUpdated, watch, reactive, shallowRef, triggerRef, defineAsyncComponent, nextTick } from 'vue'
import dayjs from 'dayjs'
import { apiFetch, importScheduleRecords } from '../../api'
import { useAuthStore } from '../../stores/auth'
import { useMenuStore } from '../../stores/menu'
import { useProfileStore } from '../../stores/profile'
import {
  filterScopeDepartments,
  filterScopeSubDepartments,
  normalizeScheduleAccess,
  resolveAllowedShiftIds,
  restrictShifts
} from '../../utils/scheduleScope'
import { ElMessage, ElMessageBox, ElLoading } from 'element-plus'
import { useRouter } from 'vue-router'
import ScheduleDashboard from './ScheduleDashboard.vue'
import ScheduleGridVirtualBody from './ScheduleGridVirtualBody.vue'
import SelectionActions from './SelectionActions.vue'
import EmployeeAvatar from '../../components/EmployeeAvatar.vue'
import PageHeader from '../../components/PageHeader.vue'
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Close,
  Delete,
  Download,
  EditPen,
  Expand,
  Filter,
  Fold,
  FullScreen,
  CircleCheckFilled,
  CircleCloseFilled,
  InfoFilled,
  Search,
  Upload,
  WarningFilled
} from '@element-plus/icons-vue'
import { buildShiftStyle } from '../../utils/shiftColors'
import { ROW_COLOR_PALETTE, normalizeRowColorIndex, resolveRowColor } from '../../utils/rowColors'
import { buildMonthDays, buildHolidayMap } from '../../utils/scheduleCalendar'
import { formatTaipeiDate } from '../../utils/approvalDisplay'
import {
  approvalStatusTagType as sharedApprovalStatusTagType,
  approvalStatusText as sharedApprovalStatusText
} from '../../utils/approvalStatus'
import { describeLeaveDays, parseLeaveInterval } from '../../utils/leaveHours'
import { leaveCoversRosteredShift, isNonWorkShift as isCoverageNonWorkShift } from '../../utils/leaveCoverage'
import {
  buildCellKey,
  parseCellKey,
  normalizeOptionalReferenceId,
  sortEmployeesByDept,
  parseScheduleDate,
  scheduleDateKey,
  scheduleDayOfMonth,
} from '../../utils/scheduleKeys'
import {
  formatShiftLabel,
  describeShiftTooltip,
  formatScheduleImportIssue,
  formatScheduleImportPayloadIssues,
  formatScheduleImportWarning,
  buildScheduleImportConfirmMessage,
  buildPendingWeekLines,
  limitDialogLines,
  normalizeNotificationDetails,
  parseDelegatedBoolean,
  getEmployeeIssueLabel,
  formatLaborRuleViolation as formatLaborRuleViolationCore,
} from '../../utils/scheduleFormatting'
import {
  resolvePublishSummary,
  getPublishStatusLabel,
  getPendingCount,
  getDisputedCount,
  getPublishStepIndex,
  getStepStatuses,
  getPendingStepDescription,
  getDisputeStepDescription,
  getFinalStepDescription,
  getPublishProgress,
  isPublishDisabled,
  isFinalizeDisabled,
  getPublishDisabledReason,
  getFinalizeDisabledReason,
  getUnpublishedNotice,
  describePublishError,
  describePublishSuccess,
} from '../../utils/schedulePublishStatus'

const ApprovalDetailContent = defineAsyncComponent(() => import('./ApprovalDetailContent.vue'))
// 國定假日休假紀錄視窗：第一次按下按鈕才載入元件與資料，開啟排班頁時不多發任何請求
const HolidayLedgerDialog = defineAsyncComponent(() => import('./HolidayLedgerDialog.vue'))
const authStore = useAuthStore()
const menuStore = useMenuStore()
// 排班權限（個人資料的 scheduleAccess，進入排班頁時路由已讀取）：被指定為排班人員的員工任何角色都能排班，
// 只看得到被指定的小單位；沒有這份資料（舊版伺服器或讀取失敗）時維持依角色判斷
const profileStore = useProfileStore()
const scheduleAccess = computed(() => normalizeScheduleAccess(profileStore.profile?.scheduleAccess))
// 主管範圍（自己與直屬部屬）：其他控制設定存成「主管與排班人員」時才有（2026/11 起預設「只有排班人員」，主管沒有這個範圍）
const usesSupervisorScope = computed(() =>
  authStore.role === 'supervisor' && (scheduleAccess.value ? scheduleAccess.value.supervisorScope : true)
)
const isSchedulerView = computed(() => authStore.role !== 'admin' && Boolean(scheduleAccess.value?.isScheduler))

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
const dayMemos = ref({})
const memoDialog = reactive({ visible: false, day: null, date: '', content: '', saving: false })
const notificationDrawerVisible = ref(false)
const holidayLedgerVisible = ref(false)
const holidayLedgerRequested = ref(false)
const holidayLedgerScope = computed(() => buildPublishPayload())
const openHolidayLedger = () => {
  holidayLedgerRequested.value = true
  holidayLedgerVisible.value = true
}
const scheduleNotifications = ref([])
const NOTIFICATION_LIMIT = 200
const NOTIFICATION_STORAGE_BYTES = 900_000
// pending：跨月週（鄰月還沒排）目前無法判斷的週別，不算違規，ok / count 仍只代表違規
const scheduleRuleValidation = reactive({ checking: false, ok: true, count: 0, violations: [], pending: [], pendingCount: 0 })
const schedulePendingLines = ref([])
const scheduleIssues = reactive({ title: '', lines: [] })
let scheduleRuleValidationTimer = null
let lastLoggedRuleSignature = ''
const rawSchedules = ref([])
const holidays = ref([])
const holidayMap = ref({})
// 本月所屬年度的公司行事曆狀態（尚未核定時顯示提醒）
const calendarStatus = ref(null)

const shifts = ref([])
const employees = ref([])
const employeeIndexMap = shallowRef(new Map())
const employeeById = computed(() => Object.fromEntries(employeeIndexMap.value))
const approvalList = ref([])
const publishEmployeeAvatar = emp => {
  const id = String(emp?.id ?? emp?._id ?? '')
  return employeeById.value[id] || { _id: id, name: emp?.name || '', photo: emp?.photo, hasPhoto: emp?.hasPhoto }
}
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
// 壓測用的計數：一般物件（不放進響應式系統），只有壓測工具列按下按鈕或捲動時才讀出來顯示。
// 以前是 reactive，每算一格就寫一次，等於在 computed 裡面改響應式狀態
const perfMetrics = {
  employeeStatusRecomputeCount: 0,
  employeeStatusTotalMs: 0,
  cellMetaComputeCount: 0,
  cellMetaTotalMs: 0
}
const perfTick = ref(0)
const employeeSearch = ref('')
const statusFilter = ref('all')
const jobTypeFilter = ref('')
const selectedEmployees = ref(new Set())
const allEmployeesForSelection = ref(new Set())
const selectedAllEmployeesAcrossPages = ref(false)
const isSelectingAllEmployeesAcrossPages = ref(false)
const selectedDays = ref(new Set())
const manualSelectedCells = ref(new Set())
const selectedCellsCache = ref(new Map())
const customRange = ref([])
const scheduleImportInput = ref(null)
const isImportingSchedule = ref(false)
const batchShiftId = ref('')
const batchDepartment = ref('')
const batchSubDepartment = ref('')
const batchRowColorIndex = ref(null)
const rowColorAssignments = ref({})
const ROW_COLOR_SESSION_KEY = 'schedule-row-colors'
const isApplyingBatch = ref(false)
const isClearingBatch = ref(false)
const isPublishing = ref(false)
const isFinalizing = ref(false)
// 正在匯出的格式（'excel'／'pdf'），空字串代表沒有在匯出
const isExporting = ref('')
const isFetchingEmployees = ref(false)
const isTableFullscreen = ref(false)
const isFullscreenToolbarCollapsed = ref(false)
// 發布流程的四個步驟與待回覆、異議名單：按「流程詳情」才展開
const publishDetailVisible = ref(false)
const exportMenuVisible = ref(false)
const moreMenuVisible = ref(false)
const selectionMenuVisible = ref(false)
// 排班檢核結果與跨月週提醒：平常只佔一行
const ruleResultsExpanded = ref(false)
const rulePendingExpanded = ref(false)
const schedulePageRef = ref(null)
const publishBarRef = ref(null)
const scheduleCardRef = ref(null)
const approvalCardRef = ref(null)
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
const viewportWidth = ref(
  typeof window === 'undefined' ? 1280 : window.innerWidth
)
// 手機寬度：只固定姓名欄，其餘資訊欄不固定（四個固定欄加起來比手機螢幕還寬，日期欄會完全被擋住）
const isNarrowViewport = computed(() => viewportWidth.value > 0 && viewportWidth.value < 768)
// 表格上緣到視窗上緣的距離（頁面捲到最上面時）：表格高度用它算，上方的區塊變高變矮時表格跟著調整
const tableTopOffset = ref(0)
// 單位、職稱、特休剩餘三個資訊欄可以收起來，多看幾天的班表；偏好記在這台電腦的瀏覽器
const INFO_COLUMNS_STORAGE_KEY = 'schedule-show-info-columns'
const loadInfoColumnsPreference = () => {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage?.getItem(INFO_COLUMNS_STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch (err) {
    // 讀不到偏好就用預設
  }
  return null
}
const infoColumnsPreference = ref(loadInfoColumnsPreference())
const showEmployeeInfoColumns = computed(() => infoColumnsPreference.value ?? !isNarrowViewport.value)
const toggleEmployeeInfoColumns = () => {
  const next = !showEmployeeInfoColumns.value
  infoColumnsPreference.value = next
  try {
    window.localStorage?.setItem(INFO_COLUMNS_STORAGE_KEY, next ? 'true' : 'false')
  } catch (err) {
    // 存不了偏好不影響這次操作
  }
}
const detail = reactive({ visible: false, approvalId: '' })
const approvalCollapsed = ref(true)
const approvalCollapsedLimit = 10
const approvalPageSize = 10
const approvalCurrentPage = ref(1)
const approvalFetchError = ref('')
// 伺服器只回傳最新 500 筆相關簽核，超過時以 X-Approvals-Truncated 標頭告知
const approvalTruncated = ref(false)
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
  // perfTick：壓測工具列要更新數字時才遞增
  void perfTick.value
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

// 簽核狀態的文字與顏色和簽核頁共用（utils/approvalStatus：待簽核、已核可、已否決、已退簽、已撤回；canceled / cancelled 兩種拼法都認）；
// 以前這裡自己寫成「已核准／已駁回／已退回」，退簽的顏色也和簽核頁不同。排班確認單另有「有異議」「已確認」
const SCHEDULE_STATUS_LABELS = {
  disputed: '有異議',
  confirmed: '已確認'
}

const SCHEDULE_STATUS_TAG_MAP = {
  disputed: 'danger',
  confirmed: 'success'
}

// 「資料類型」欄：請假、加班單獨標示，其餘顯示表單名稱
const APPROVAL_KIND_LABELS = {
  leave: '請假簽核',
  overtime: '加班簽核'
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

// ✅ 這個月所有「已核准」請假的快取：{ [empId]: { [dayNumber]: true | LEAVE_COVERS_SHIFT } }
// true：整天請假（含有時分的假整天都在請假中的日子）；LEAVE_COVERS_SHIFT：有時分的假涵蓋了這天排的整個上班班別。
// 兩種都和以前一樣當作請假日（休假中、不能排班），與伺服器的完整性檢查、匯出、國定假日休假紀錄一致
const leaveIndex = shallowRef({})
const LEAVE_COVERS_SHIFT = 'covers_shift'
// 只請幾小時的假（沒有整天都在請假中，也沒有涵蓋這天排的整個上班班別）：{ [empId]: { [dayNumber]: 請假時數 } }。
// 這些日子仍可排班（存檔時伺服器用所選的班別判斷），格子上只提示有請假
const partialLeaveHours = shallowRef({})

// 只用 leaveIndex 判斷該格是不是請假日
const isLeaveCell = (empId, day) => {
  const empLeaves = leaveIndex.value[String(empId)]
  if (!empLeaves) return false
  return !!empLeaves[Number(day)]
}

// 只請幾小時的日子：仍可排班，但員工狀態（排班中／未排班／請假中）和以前、和伺服器的狀態篩選一樣算「有請假」
const hasPartialLeave = (empId, day) => !!partialLeaveHours.value[String(empId)]?.[Number(day)]

const shiftInfoMap = computed(() => {
  const map = new Map()
  shifts.value.forEach(shift => {
    const key = String(shift?._id || '')
    if (key) map.set(key, shift)
  })
  return map
})

const employeeStatusMap = shallowRef({})
// 每一格的顯示資訊快取：{ 員工 id → { 日 → 資訊 } }。一般的 Map（不放進響應式系統），失效時遞增版本號，讓用到它的 computed 重算。
// 以前每算一格就複製整個 Map 再整個換掉：一百人一個月（3100 格）要複製三千次、每次三千筆，而且是在 computed 裡面寫響應式狀態
const cellMetaStore = new Map()
const cellMetaVersion = ref(0)
// 每一格交給格子元件的顯示物件：內容沒變就沿用同一個物件，勾一格、改一格時其他三千格不用重新渲染
const cellViewStore = new Map()

const markScheduleMapDirty = () => triggerRef(scheduleMap)
const markLeaveIndexDirty = () => triggerRef(leaveIndex)

const invalidateCellMetaCache = (empId = '', day = null) => {
  if (!empId) {
    cellMetaStore.clear()
  } else if (day === null) {
    cellMetaStore.delete(String(empId))
  } else {
    cellMetaStore.get(String(empId))?.delete(Number(day))
  }
  cellMetaVersion.value += 1
}

const computeEmployeeStatus = safeEmpId => {
  const startAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const daysMap = scheduleMap.value[safeEmpId] || {}
  const cells = Object.values(daysMap)
  let status = 'scheduled'
  if (!cells.length) {
    status = 'unscheduled'
  } else {
    const hasAnyEmptyDay = cells.some(c => !c.shiftId && !c.leave && !isLeaveCell(safeEmpId, c.day) && !hasPartialLeave(safeEmpId, c.day))
    const hasAnyLeave = cells.some(c => c.leave || isLeaveCell(safeEmpId, c.day) || hasPartialLeave(safeEmpId, c.day))
    if (hasAnyEmptyDay) status = 'unscheduled'
    else if (hasAnyLeave) status = 'onLeave'
  }
  const endAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  perfMetrics.employeeStatusRecomputeCount += 1
  perfMetrics.employeeStatusTotalMs += endAt - startAt
  return status
}

const recomputeEmployeeStatusFor = empId => {
  const safeEmpId = String(empId || '')
  if (!safeEmpId) return
  employeeStatusMap.value = {
    ...employeeStatusMap.value,
    [safeEmpId]: computeEmployeeStatus(safeEmpId)
  }
}

// 多位員工一次算完再換掉整個物件（以前每位員工各複製一次整份狀態表）
const recomputeEmployeeStatuses = empIds => {
  const ids = (Array.isArray(empIds) ? empIds : []).map(empId => String(empId || '')).filter(Boolean)
  if (!ids.length) return
  const next = { ...employeeStatusMap.value }
  ids.forEach(safeEmpId => {
    next[safeEmpId] = computeEmployeeStatus(safeEmpId)
  })
  employeeStatusMap.value = next
}

const getCellMeta = (empId, day) => {
  // 讀版本號：快取失效（invalidateCellMetaCache）時，用到這一格的 computed 會重算
  void cellMetaVersion.value
  const safeEmpId = String(empId)
  const safeDay = Number(day)
  let employeeMetas = cellMetaStore.get(safeEmpId)
  const cached = employeeMetas?.get(safeDay)
  if (cached) return cached
  const startAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const isLeave = isLeaveCell(empId, day)
  const shiftId = scheduleMap.value?.[empId]?.[day]?.shiftId
  const computedMeta = {
    isLeave,
    partialLeaveHours: isLeave ? 0 : Number(partialLeaveHours.value[safeEmpId]?.[safeDay] || 0),
    hasShift: !isLeave && !!shiftId,
    missingShift: !isLeave && !shiftId,
    style: !isLeave ? shiftClass(shiftId) : {}
  }
  if (!employeeMetas) {
    employeeMetas = new Map()
    cellMetaStore.set(safeEmpId, employeeMetas)
  }
  employeeMetas.set(safeDay, computedMeta)
  const endAt = typeof performance !== 'undefined' ? performance.now() : Date.now()
  perfMetrics.cellMetaComputeCount += 1
  perfMetrics.cellMetaTotalMs += endAt - startAt
  return computedMeta
}

const formatLeaveHours = hours => String(Number(Number(hours).toFixed(2)))
// 格子的提示文字：整天請假的格子不能排班；只請幾小時的格子可以排班，只提示當天有請假
const leaveTitleOf = cellMeta => {
  if (cellMeta.isLeave) return '已核准請假，該日不列入工作時數'
  return cellMeta.partialLeaveHours ? `當天有 ${formatLeaveHours(cellMeta.partialLeaveHours)} 小時核准請假` : ''
}

// ========= 單格變更的儲存狀態（儲存中／已儲存／未儲存）與復原 =========

// { 格子 key → { status: 'saving' | 'saved' | 'failed', message } }
const cellSaveStates = shallowRef(new Map())
const cellSaveTimers = new Map()
const CELL_SAVED_HINT_MS = 1800

const setCellSaveState = (empId, day, status, message = '') => {
  const key = buildCellKey(String(empId), Number(day))
  const timer = cellSaveTimers.get(key)
  if (timer) {
    clearTimeout(timer)
    cellSaveTimers.delete(key)
  }
  const next = new Map(cellSaveStates.value)
  if (status) next.set(key, { status, message: String(message || '') })
  else next.delete(key)
  cellSaveStates.value = next
  if (status === 'saved') {
    // 「已儲存」只顯示一下子，格子就回到平常的樣子
    cellSaveTimers.set(key, setTimeout(() => {
      cellSaveTimers.delete(key)
      if (cellSaveStates.value.get(key)?.status !== 'saved') return
      const cleared = new Map(cellSaveStates.value)
      cleared.delete(key)
      cellSaveStates.value = cleared
    }, CELL_SAVED_HINT_MS))
  }
}

const clearCellSaveStates = () => {
  cellSaveTimers.forEach(timer => clearTimeout(timer))
  cellSaveTimers.clear()
  if (cellSaveStates.value.size) cellSaveStates.value = new Map()
}

// 工具列上的一行狀態：最近一次單格變更（儲存中、已儲存可復原、未儲存與原因）
const lastChange = ref(null)
// 可以復原的上一次單格變更：{ empId, day, previousShiftId, month }
const lastCellChange = ref(null)

const resetChangeFeedback = () => {
  clearCellSaveStates()
  lastChange.value = null
  lastCellChange.value = null
}

const buildCellView = (empId, day) => {
  const cellKey = buildCellKey(empId, day)
  const scheduleCell = scheduleMap.value?.[empId]?.[day] || null
  const cellMeta = getCellMeta(empId, day)
  const shiftInfo = scheduleCell?.shiftId
    ? shiftInfoMap.value.get(String(scheduleCell.shiftId)) || null
    : null
  const isSelected = isCellSelected(empId, day)
  const isManualSelected = manualSelectedCellsSet.value.has(cellKey)
  const save = cellSaveStates.value.get(cellKey)
  const saveState = save?.status || ''
  const saveMessage = save?.message || ''
  const previous = cellViewStore.get(cellKey)
  if (
    previous &&
    previous.cellMeta === cellMeta &&
    previous.scheduleCell === scheduleCell &&
    previous.shiftInfo === shiftInfo &&
    previous.isSelected === isSelected &&
    previous.isManualSelected === isManualSelected &&
    previous.saveState === saveState &&
    previous.saveMessage === saveMessage
  ) {
    return previous
  }
  const view = {
    key: cellKey,
    cellMeta,
    leaveTitle: leaveTitleOf(cellMeta),
    isSelected,
    isManualSelected,
    scheduleCell,
    shiftInfo,
    saveState,
    saveMessage
  }
  cellViewStore.set(cellKey, view)
  return view
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
      map.set(buildCellKey(empId, day), buildCellView(empId, day))
    }
  }
  return map
})

const getRenderedCell = (empId, day) => {
  const cellKey = buildCellKey(String(empId), Number(day))
  return cellViewMap.value.get(cellKey) || buildCellView(String(empId), Number(day))
}

// 表格的每一格各自訂閱自己的顯示物件（cellViewRefs 裡的 shallowRef，由檔案最後的 watch 依 cellViewMap 同步）。
// 以前每一格都直接讀 cellViewMap：勾一格、改一格，表格裡的每一格（一百人一個月是 3100 格）都要重跑一次；
// 現在只有內容真的變了的那幾格會重新渲染
const cellViewRefs = new Map()
const EMPTY_CELL_VIEW = Object.freeze({
  key: '',
  cellMeta: Object.freeze({ isLeave: false, partialLeaveHours: 0, hasShift: false, missingShift: false, style: {} }),
  leaveTitle: '',
  isSelected: false,
  isManualSelected: false,
  scheduleCell: null,
  shiftInfo: null,
  saveState: '',
  saveMessage: ''
})
const cellViewFor = (empId, day) => {
  // el-table 為了找巢狀欄位會用空的資料列試畫一次欄位內容：沒有員工就給固定的空格子，不讀任何狀態
  if (empId === undefined || empId === null || empId === '') return EMPTY_CELL_VIEW
  const holder = cellViewRefs.get(buildCellKey(String(empId), Number(day)))
  return holder ? holder.value : getRenderedCell(empId, day)
}

// 只能選「有 cell 且不是請假日」的格子
const isSelectableCell = (empId, day) => {
  const dayMap = scheduleMap.value[empId]
  if (!dayMap) return false
  const cell = dayMap[day]
  if (!cell) return false
  return !isLeaveCell(empId, day)
}

// 正在看的小單位的「使用班別」：班別下拉、套用班別與圖例只列這些班別（小單位沒有設定就是全部），
// 不用上班的班別（休息日、例假、國定假日、請假）一律列出；既有班表的班別名稱與顏色照樣用完整的班別設定顯示
const viewedSubDepartments = computed(() => {
  if (selectedSubDepartment.value) {
    const selected = subDepartments.value.find(sub => sub._id === selectedSubDepartment.value)
    return selected ? [selected] : []
  }
  return subDepartments.value.filter(sub => sub.department === selectedDepartment.value)
})
const availableShifts = computed(() =>
  restrictShifts(shifts.value, resolveAllowedShiftIds(viewedSubDepartments.value))
)

const legendShifts = computed(() => {
  if (!Array.isArray(availableShifts.value) || !availableShifts.value.length) {
    return []
  }
  const seen = new Set()
  return availableShifts.value.reduce((acc, shift) => {
    if (!shift) return acc
    const label = formatShiftLabel(shift) || shift.name || shift.code || '未命名班別'
    const key = String(shift._id || `${shift.code ?? ''}-${shift.name ?? ''}`)
    if (!label || !key || seen.has(key)) return acc
    seen.add(key)
    acc.push({
      key,
      label,
      // 圖例的提示文字：上下班時間（跨日的班別標「次日」）與備註
      title: describeShiftTooltip(shift),
      style: shiftClass(shift)
    })
    return acc
  }, [])
})

// 換到另一個小單位後，原本選的「套用班別」不在可用班別內就清掉（伺服器也會拒絕不允許的班別）
watch(availableShifts, list => {
  if (batchShiftId.value && !list.some(shift => String(shift?._id) === String(batchShiftId.value))) {
    batchShiftId.value = ''
  }
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
const selectedPersistedSchedules = computed(() => Array.from(allSelectedCells.value).flatMap(key => {
  const { empId, day } = parseCellKey(key)
  const id = scheduleMap.value[empId]?.[day]?.id
  return id ? [{ key, empId, day, id: String(id) }] : []
}))

const batchSubDepartments = computed(() =>
  batchDepartment.value ? subDepsFor(batchDepartment.value) : []
)
const effectiveBatchDepartment = computed(() =>
  isTableFullscreen.value ? (batchDepartment.value || selectedDepartment.value || '') : batchDepartment.value
)
const effectiveBatchSubDepartment = computed(() => {
  if (isTableFullscreen.value) {
    return batchSubDepartment.value || selectedSubDepartment.value || ''
  }
  return batchSubDepartment.value
})
const batchDepartmentDisplayName = computed(
  () => departments.value.find(dept => dept._id === effectiveBatchDepartment.value)?.name || '全部部門'
)
const batchSubDepartmentDisplayName = computed(
  () => subDepartments.value.find(sub => sub._id === effectiveBatchSubDepartment.value)?.name || '全部單位'
)
const allEmployeesSelectionHint = computed(() =>
  selectedAllEmployeesAcrossPages.value
    ? `已全選 ${selectedEmployeesSet.value.size} 位員工（全部人員），目前涵蓋 ${allSelectedCells.value.size} 個可排班日期格。`
    : `目前已選 ${selectedEmployeesSet.value.size} 位員工，共 ${allSelectedCells.value.size} 個可排班日期格；勾選員工會選取該員工本月全部可排班日期。`
)

// ✅ UI 上是否標成「已選取」：請假格子一律 false
const isCellSelected = (empId, day) => {
  if (!isSelectableCell(empId, day)) return false
  return selectedCellsCache.value.has(buildCellKey(empId, day))
}

// 有任何選取（格子、整列的員工或整欄的日期）：工具列第二列換成批次操作
const hasSelectionContext = computed(() =>
  hasAnySelection.value || selectedEmployees.value.size > 0 || selectedDays.value.size > 0
)
const selectionSummaryText = computed(() => {
  const cells = allSelectedCells.value.size
  const people = selectedEmployees.value.size
  if (!people) return `已選取 ${cells} 格`
  return `已選取 ${cells} 格（${people} 位員工${selectedAllEmployeesAcrossPages.value ? '，全部人員' : ''}）`
})
// 姓名欄標頭的核取方塊：本頁全選／部分選取
const isPageFullySelected = computed(() =>
  employees.value.length > 0 && employees.value.every(emp => selectedEmployees.value.has(emp._id))
)
const isPagePartiallySelected = computed(() =>
  !isPageFullySelected.value && employees.value.some(emp => selectedEmployees.value.has(emp._id))
)
// 「套用部門／單位」：指定了就把選取的班表改掛到那個部門與單位；按鈕上直接顯示目前的設定，收起來也看得到
const hasBatchScopeOverride = computed(() => Boolean(effectiveBatchDepartment.value || effectiveBatchSubDepartment.value))
const batchScopeLabel = computed(() => {
  if (!hasBatchScopeOverride.value) return '套用部門／單位'
  return `掛到 ${batchDepartmentDisplayName.value}／${batchSubDepartmentDisplayName.value}`
})

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

// 上一次用滑鼠勾選的格子：按住 Shift 點另一格時，選取兩格之間的整塊範圍
let selectionAnchor = null

const clearSelection = () => {
  selectedEmployees.value = new Set()
  allEmployeesForSelection.value = new Set()
  selectedAllEmployeesAcrossPages.value = false
  selectedDays.value = new Set()
  manualSelectedCells.value = new Set()
  selectedCellsCache.value = new Map()
  customRange.value = []
  selectionAnchor = null
}

// 選取 from、to 兩格之間的所有可排班格子（員工依畫面上的順序）；任一格的員工不在畫面上就不處理
const selectCellRange = (from, to) => {
  const ids = visibleEmployees.value.map(emp => String(emp._id))
  const fromRow = ids.indexOf(String(from.empId))
  const toRow = ids.indexOf(String(to.empId))
  if (fromRow === -1 || toRow === -1) return false
  const [rowStart, rowEnd] = fromRow <= toRow ? [fromRow, toRow] : [toRow, fromRow]
  const [dayStart, dayEnd] = from.day <= to.day ? [from.day, to.day] : [to.day, from.day]
  const next = new Set(manualSelectedCells.value)
  updateSelectionCache(cache => {
    for (let rowIndex = rowStart; rowIndex <= rowEnd; rowIndex += 1) {
      for (let day = dayStart; day <= dayEnd; day += 1) {
        if (!isSelectableCell(ids[rowIndex], day)) continue
        next.add(buildCellKey(ids[rowIndex], day))
        applyCacheChange(cache, ids[rowIndex], day, 'manual', true)
      }
    }
  })
  manualSelectedCells.value = next
  return true
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

function issueDialogAppendTarget() {
  if (!isTableFullscreen.value) return undefined
  return scheduleCardRef.value || fullscreenPopperHostRef.value || undefined
}

function openScheduleIssueDialog(title, lines, fallbackMessage, options = {}) {
  const normalizedLines = (Array.isArray(lines) ? lines : []).filter(Boolean)
  scheduleIssues.title = title
  scheduleIssues.lines = normalizedLines.length ? normalizedLines : [fallbackMessage || '操作失敗']
  const message = normalizedLines.join('\n') || fallbackMessage || '操作失敗'
  const type = options.type || 'error'
  if (options.record !== false) {
    const summary = normalizedLines.length
      ? `共 ${normalizedLines.length} 項問題，請開啟完整明細檢視。`
      : message
    appendScheduleNotification(type, title, summary, normalizedLines)
  }
  const alertOptions = {
    confirmButtonText: '關閉',
    type: type === 'info' ? 'info' : type,
    customClass: 'schedule-issue-dialog',
    modalClass: 'schedule-issue-overlay',
    zIndex: 4000,
    closeOnClickModal: false,
    showClose: true
  }
  const appendTo = issueDialogAppendTarget()
  if (appendTo) alertOptions.appendTo = appendTo
  return Promise.resolve(ElMessageBox.alert(message, title, alertOptions)).catch(() => {})
}

function employeeIssueLabel(employeeId) {
  return getEmployeeIssueLabel(employeeId, employees.value)
}

function formatLaborRuleViolation(item = {}) {
  return formatLaborRuleViolationCore(item, employees.value)
}

function scheduleRuleQueryParams() {
  const payload = buildPublishPayload()
  const params = new URLSearchParams({ month: payload.month })
  if (payload.department) params.set('department', payload.department)
  if (payload.subDepartment) params.set('subDepartment', payload.subDepartment)
  if (payload.includeSelf) params.set('includeSelf', 'true')
  return params
}

// 跨月週（鄰月還沒排）無法判斷時的共同說明；每週一例一休要等整週的日子都有班表才判斷得了
const PENDING_WEEK_HINT = '這些週別有部分日期落在相鄰月份且尚未排班，暫時無法判斷一例一休；相鄰月份排定後會重新檢核。'

function pendingWeekConfirmNote(pendingWeeks) {
  const count = Array.isArray(pendingWeeks) ? pendingWeeks.length : 0
  return count
    ? `另有 ${count} 項跨月週尚無法判斷一例一休（相鄰月份尚未排班），不影響發布，待相鄰月份班表排定後會重新檢核。`
    : ''
}

function openPendingWeeksDialog(pendingWeeks) {
  const count = pendingWeeks.length
  const alertOptions = {
    confirmButtonText: '關閉',
    type: 'info',
    customClass: 'schedule-issue-dialog',
    modalClass: 'schedule-issue-overlay',
    zIndex: 4000,
    closeOnClickModal: false,
    showClose: true
  }
  const appendTo = issueDialogAppendTarget()
  if (appendTo) alertOptions.appendTo = appendTo
  const lines = limitDialogLines(buildPendingWeekLines(pendingWeeks, employees.value))
  const message = [PENDING_WEEK_HINT, ...lines.map(line => `・${line}`)].join('\n')
  return Promise.resolve(
    ElMessageBox.alert(message, `排班規範預檢已通過，另有 ${count} 項跨月週尚無法判斷`, alertOptions)
  ).catch(() => {})
}

// 同一時間只跑一次檢核，後來的呼叫排在後面、不丟掉：前一次結束後，用「當下」的月份與篩選再檢核一次
// （前一次的結果若已經過期會被丟掉，所以連續切換月份 A→B→C，最後一定會檢核到 C）。
//   - 切換月份後的背景檢核、編輯後的延遲檢核：排在後面照常執行
//   - 排班檢核、發布、完成發布：等前一次結束，再自己檢核一次，不會沒有反應就直接返回
// 還沒開始跑的排隊檢核，選項相同的呼叫共用同一次（連續切換月份只會多跑一次）。
let scheduleRuleCheckTail = Promise.resolve()
let scheduleRuleCheckBusy = 0 // 正在跑加上排隊等候的檢核數
let scheduleRuleCheckDisposed = false
const scheduleRuleCheckQueued = new Map()

function fetchScheduleRuleValidation({ showIssues = false, notify = true, quiet = false, announcePending = true } = {}) {
  const key = [showIssues, notify, quiet, announcePending].join('|')
  const queued = scheduleRuleCheckQueued.get(key)
  if (queued) return queued
  scheduleRuleCheckBusy += 1
  scheduleRuleValidation.checking = true
  const job = scheduleRuleCheckTail
    .then(() => {
      scheduleRuleCheckQueued.delete(key)
      // 頁面已經離開：排隊中的檢核不用再跑
      if (scheduleRuleCheckDisposed) return null
      return runScheduleRuleValidation({ showIssues, notify, quiet, announcePending })
    })
    .finally(() => {
      scheduleRuleCheckBusy -= 1
      if (scheduleRuleCheckBusy <= 0) {
        scheduleRuleCheckBusy = 0
        scheduleRuleValidation.checking = false
      }
    })
  scheduleRuleCheckTail = job.catch(() => null)
  scheduleRuleCheckQueued.set(key, job)
  return job
}

// quiet：切換月份後的背景重新檢核，只更新徽章、完整檢核結果與跨月週提醒，不彈窗、不跳提示、不寫通知
// announcePending：預檢通過但有跨月週待判斷時，是否另外跳出說明視窗（發布／完成發布自己會在確認視窗註明，所以傳 false）
async function runScheduleRuleValidation({ showIssues, notify, quiet, announcePending }) {
  const query = scheduleRuleQueryParams().toString()
  try {
    const res = await apiFetch(`/api/schedules/rules/validate?${query}`)
    const payload = await res.json().catch(() => ({}))
    if (query !== scheduleRuleQueryParams().toString()) return null
    const violations = Array.isArray(payload.violations) ? payload.violations : []
    if ((!res.ok || !payload.ok) && !violations.length) throw new Error(payload.error || '排班規範預檢未完成，請重試')
    const pendingWeeks = Array.isArray(payload.pendingWeeks) ? payload.pendingWeeks : []
    scheduleRuleValidation.ok = res.ok && Boolean(payload.ok) && violations.length === 0
    scheduleRuleValidation.count = Number(payload.count ?? violations.length)
    scheduleRuleValidation.violations = violations
    scheduleRuleValidation.pending = pendingWeeks
    scheduleRuleValidation.pendingCount = pendingWeeks.length
    schedulePendingLines.value = pendingWeeks.map(formatLaborRuleViolation)
    const lines = violations.map(formatLaborRuleViolation)
    scheduleIssues.title = '排班規範檢核未通過'
    scheduleIssues.lines = lines
    if (quiet) return { ...payload, ok: scheduleRuleValidation.ok, violations, pendingWeeks }
    // finalized：整個範圍都已完成發布，伺服器檢核的是已鎖定的班表（完成發布不被排班規範擋下，鎖定後仍可能有違規）
    const lockedMonth = payload.finalized === true
    const signature = lines.join('\n')
    if (notify && lines.length && signature !== lastLoggedRuleSignature) {
      appendScheduleNotification(
        'warning',
        lockedMonth ? '已完成發布的班表仍有排班規範問題' : '排班草稿待修正',
        `目前共有 ${lines.length} 項排班規範問題。`,
        violations
      )
      lastLoggedRuleSignature = signature
    } else if (!lines.length) {
      lastLoggedRuleSignature = ''
    }
    if (showIssues) {
      if (lines.length) {
        await openScheduleIssueDialog('排班規範檢核未通過', lines, '請先修正排班規範問題', {
          type: 'warning',
          record: false
        })
      } else if (pendingWeeks.length && announcePending) {
        await openPendingWeeksDialog(pendingWeeks)
      } else {
        callSuccess('排班規範預檢已通過')
      }
    }
    return { ...payload, ok: scheduleRuleValidation.ok, violations, pendingWeeks }
  } catch (error) {
    scheduleRuleValidation.ok = false
    if (showIssues) callWarning(error?.message || '排班規範預檢失敗')
    return null
  }
}

function scheduleDraftRuleValidation() {
  if (typeof document !== 'undefined' && scheduleCardRef.value && !scheduleCardRef.value.isConnected) return
  if (scheduleRuleValidationTimer) clearTimeout(scheduleRuleValidationTimer)
  scheduleRuleValidationTimer = setTimeout(() => {
    scheduleRuleValidationTimer = null
    fetchScheduleRuleValidation().catch(() => {})
  }, 650)
}

const inspectScheduleRules = () => fetchScheduleRuleValidation({ showIssues: true, notify: true })

async function handleScheduleActionApiError(res, fallbackMessage) {
  let data = null
  try {
    data = await res?.json()
  } catch (err) {
    // Keep the fallback message when the server does not return JSON.
  }

  const violations = Array.isArray(data?.violations) ? data.violations : []
  if (violations.length) {
    await openScheduleIssueDialog(
      '排班規範檢核未通過',
      violations.map(formatLaborRuleViolation),
      data?.error || fallbackMessage
    )
    return data
  }

  callWarning(describePublishError(data, fallbackMessage))
  return data
}

const openScheduleImport = () => {
  if (!selectedDepartment.value) {
    callWarning('請先選擇部門')
    return
  }
  scheduleImportInput.value?.click()
}

// 匯入回應的 warnings 轉成可讀文字（與 errors 同一種 {row, day, code, message} 格式）
function formatImportWarnings(warnings) {
  return (Array.isArray(warnings) ? warnings : []).map(formatScheduleImportWarning).filter(Boolean)
}

async function submitScheduleImport(file, mode, overwrite = false) {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('month', currentMonth.value)
  formData.append('department', selectedDepartment.value)
  if (selectedSubDepartment.value) {
    formData.append('subDepartment', selectedSubDepartment.value)
  }
  formData.append('includeSelf', String(includeSelf.value && showIncludeSelfToggle.value))
  formData.append('mode', mode)
  formData.append('overwrite', String(overwrite))
  const response = await importScheduleRecords(formData)
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

async function onScheduleImportFile(event) {
  const file = event?.target?.files?.[0]
  if (event?.target) event.target.value = ''
  if (!file) return
  isImportingSchedule.value = true
  try {
    let overwrite = false
    let preview = await submitScheduleImport(file, 'preview', false)
    if (!preview.response.ok) {
      const issues = formatScheduleImportPayloadIssues(preview.payload)
      const violations = (preview.payload.violations || []).map(formatLaborRuleViolation)
      await openScheduleIssueDialog(
        violations.length ? '排班規範檢核未通過' : '班表匯入檢核未通過',
        issues.length ? issues : violations,
        preview.payload.error || '班表預覽失敗'
      )
      return
    }

    // 已有班表時先以覆蓋模式重新預覽，讓下方的確認視窗一次顯示「覆蓋後」的提醒與排班規範問題
    const overwriteCount = Number(preview.payload.overwriteCount || preview.payload.overwriteConflicts?.length || 0)
    if (overwriteCount > 0) {
      overwrite = true
      preview = await submitScheduleImport(file, 'preview', true)
      if (!preview.response.ok) {
        const issues = formatScheduleImportPayloadIssues(preview.payload)
        const violations = (preview.payload.violations || []).map(formatLaborRuleViolation)
        await openScheduleIssueDialog(
          violations.length ? '覆蓋排班規範檢核未通過' : '覆蓋匯入檢核未通過',
          issues.length ? issues : violations,
          preview.payload.error || '覆蓋匯入預覽失敗'
        )
        return
      }
    }

    const previewWarnings = formatImportWarnings(preview.payload.warnings)
    const previewViolations = Array.isArray(preview.payload.violations)
      ? preview.payload.violations.map(formatLaborRuleViolation)
      : []
    // 跨月週（鄰月還沒排）目前無法判斷的週別：不擋匯入，確認視窗裡每週一行、列出員工與尚未排班的月份
    const previewPendingWeeks = Array.isArray(preview.payload.pendingWeeks) ? preview.payload.pendingWeeks : []
    const confirmOptions = {
      confirmButtonText: overwrite ? '覆蓋匯入' : '確認匯入',
      cancelButtonText: '取消',
      type: 'warning',
      customClass: 'schedule-issue-dialog',
      modalClass: 'schedule-issue-overlay',
      zIndex: 4000,
      closeOnClickModal: false
    }
    const confirmAppendTo = issueDialogAppendTarget()
    if (confirmAppendTo) confirmOptions.appendTo = confirmAppendTo
    await ElMessageBox.confirm(
      buildScheduleImportConfirmMessage({
        employees: preview.payload.employees,
        scheduleDays: preview.payload.scheduleDays,
        informationalDays: preview.payload.informationalDays,
        skippedDays: preview.payload.skippedDays,
        overwriteCount: overwrite ? overwriteCount : 0,
        warnings: previewWarnings,
        violations: previewViolations,
        ruleExemptEmployees: preview.payload.ruleExemptEmployees,
        pendingWeekLines: buildPendingWeekLines(previewPendingWeeks, employees.value),
        pendingWeekCount: previewPendingWeeks.length
      }),
      overwrite ? '確認覆蓋既有排班' : '確認匯入班表',
      confirmOptions
    )
    const committed = await submitScheduleImport(file, 'commit', overwrite)
    if (!committed.response.ok) {
      const issues = formatScheduleImportPayloadIssues(committed.payload)
      const violations = (committed.payload.violations || []).map(formatLaborRuleViolation)
      await openScheduleIssueDialog(
        violations.length ? '排班規範檢核未通過' : '班表匯入失敗',
        issues.length ? issues : violations,
        committed.payload.error || '班表匯入失敗'
      )
      return
    }
    callSuccess(`已匯入 ${committed.payload.imported} 個班次${overwrite ? '（含覆蓋）' : ''}`)
    // 匯入後才出現的提醒（例如事後檢核無法完成）預覽看不到，完整列出而不是忽略
    const committedWarnings = formatImportWarnings(committed.payload.warnings)
    if (committedWarnings.length) {
      appendScheduleNotification(
        'warning',
        '匯入提醒',
        `匯入完成，另有 ${committedWarnings.length} 項資料提醒。`,
        committedWarnings
      )
      const previewWarningSet = new Set(previewWarnings)
      const newWarnings = committedWarnings.filter(line => !previewWarningSet.has(line))
      if (newWarnings.length) {
        openScheduleIssueDialog('班表匯入提醒', newWarnings, '班表匯入提醒', {
          type: 'warning',
          record: false
        })
      }
    }
    const committedViolationDetails = Array.isArray(committed.payload.violations)
      ? committed.payload.violations
      : []
    const committedViolations = committedViolationDetails.map(formatLaborRuleViolation)
    if (committedViolations.length) {
      appendScheduleNotification(
        'warning',
        '匯入草稿待修正',
        `匯入完成，但仍有 ${committedViolations.length} 項排班規範問題。`,
        committedViolationDetails
      )
    }
    const committedPendingWeeks = Array.isArray(committed.payload.pendingWeeks) ? committed.payload.pendingWeeks : []
    if (committedPendingWeeks.length) {
      appendScheduleNotification(
        'info',
        '跨月週待判斷',
        `匯入完成，另有 ${committedPendingWeeks.length} 項跨月週尚無法判斷一例一休（相鄰月份尚未排班）。`,
        committedPendingWeeks
      )
    }
    await refreshScheduleData({ reset: true, reason: 'excel-import' })
    scheduleDraftRuleValidation()
  } catch (error) {
    if (error === 'cancel' || error === 'close') return
    callError(error?.message || '班表匯入失敗')
  } finally {
    isImportingSchedule.value = false
  }
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
  // 格子左上角的核取方塊（原生 input；舊版是 el-checkbox）
  const checkboxNode = target.closest?.('.cell-selection, .el-checkbox')
  if (!checkboxNode) return
  const empId = cellNode.dataset.empId
  const day = Number(cellNode.dataset.day)
  if (!empId || !Number.isFinite(day)) return
  const input = checkboxNode.querySelector('input[type="checkbox"]')
  const key = buildCellKey(empId, day)
  if (event.shiftKey && selectionAnchor && selectCellRange(selectionAnchor, { empId, day })) {
    // 按住 Shift：從上一次勾的那一格到這一格，整塊選取
    selectionAnchor = { empId, day }
  } else {
    toggleCell(empId, day, typeof input?.checked === 'boolean' ? input.checked : undefined)
    if (manualSelectedCells.value.has(key)) selectionAnchor = { empId, day }
  }
  // 核取方塊跟著實際的選取狀態（不能選的格子、Shift 範圍選取時，瀏覽器自己切換的勾選要改回來）
  if (input && input.matches?.('.cell-manual-checkbox')) {
    input.checked = manualSelectedCells.value.has(key)
  }
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
    if (jobTypeFilter.value) {
      params.push(`jobType=${encodeURIComponent(jobTypeFilter.value)}`)
    }
    params.push(`includeSelf=${includeSelf.value && showIncludeSelfToggle.value}`)
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
    callError('全選全部人員失敗')
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

function scheduleNotificationStorageKey() {
  const owner = authStore.user?.id || authStore.user?._id || getSupervisorIdFromStorage() || 'anonymous'
  return `schedule-notifications:${String(owner)}`
}

function persistScheduleNotifications() {
  if (typeof window === 'undefined') return
  try {
    const bounded = scheduleNotifications.value.slice(0, NOTIFICATION_LIMIT)
    let serialized = JSON.stringify(bounded)
    while (bounded.length > 1 && new Blob([serialized]).size > NOTIFICATION_STORAGE_BYTES) {
      bounded.pop()
      serialized = JSON.stringify(bounded)
    }
    scheduleNotifications.value = bounded
    window.localStorage?.setItem(scheduleNotificationStorageKey(), serialized)
  } catch (err) {
    console.warn('Failed to persist schedule notifications', err)
  }
}

function loadScheduleNotifications() {
  if (typeof window === 'undefined') return
  try {
    const stored = window.localStorage?.getItem(scheduleNotificationStorageKey())
    const parsed = stored ? JSON.parse(stored) : []
    scheduleNotifications.value = Array.isArray(parsed)
      ? parsed.slice(0, NOTIFICATION_LIMIT).map(item => ({
        ...item,
        details: Array.isArray(item.details) ? item.details : []
      }))
      : []
  } catch (err) {
    scheduleNotifications.value = []
    console.warn('Failed to load schedule notifications', err)
  }
}

function appendScheduleNotification(type, title, message, details = []) {
  const normalizedMessage = String(message || '').trim()
  if (!normalizedMessage) return
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
  scheduleNotifications.value = [{
    id: `${Date.now()}-${randomPart}`,
    type,
    title,
    message: normalizedMessage,
    details: normalizeNotificationDetails(details),
    createdAt: new Date().toISOString()
  }, ...scheduleNotifications.value].slice(0, NOTIFICATION_LIMIT)
  persistScheduleNotifications()
}

function clearScheduleNotifications() {
  scheduleNotifications.value = []
  persistScheduleNotifications()
}

function formatNotificationTime(value) {
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format('YYYY/MM/DD HH:mm:ss') : ''
}

function notificationIcon(type) {
  if (type === 'success') return CircleCheckFilled
  if (type === 'warning') return WarningFilled
  if (type === 'error') return CircleCloseFilled
  return InfoFilled
}

function reopenNotificationDetails(item) {
  notificationDrawerVisible.value = false
  return openScheduleIssueDialog(
    item.title,
    normalizeNotificationDetails(item.details).map(formatLaborRuleViolation),
    item.message,
    {
      type: item.type,
      record: false
    }
  )
}

function scheduleMemoDate(day) {
  return `${currentMonth.value}-${String(day).padStart(2, '0')}`
}

// 各種讀取的請求序號：只採用最後一次請求的回應（見各 fetch 函式）
let dayMemoRequestSeq = 0
let holidayRequestSeq = 0
let summaryRequestSeq = 0
let employeeRequestSeq = 0
let subDepartmentRequestSeq = 0

async function fetchDayMemos() {
  if (!selectedDepartment.value) {
    dayMemos.value = {}
    return
  }
  const params = new URLSearchParams({
    month: currentMonth.value,
    department: selectedDepartment.value
  })
  if (selectedSubDepartment.value) params.set('subDepartment', selectedSubDepartment.value)
  // 只採用最後一次請求的回應：切換月份、單位時，上一個範圍較慢的回應不能蓋掉現在的備忘錄（備忘錄用「幾號」對應，蓋錯就會存到別的月份）
  const seq = ++dayMemoRequestSeq
  try {
    const res = await apiFetch(`/api/schedules/memos?${params.toString()}`)
    if (seq !== dayMemoRequestSeq) return
    if (!res.ok) throw new Error('日期備忘錄載入失敗')
    const rows = await res.json()
    if (seq !== dayMemoRequestSeq) return
    dayMemos.value = Object.fromEntries((Array.isArray(rows) ? rows : []).map(row => [
      scheduleDayOfMonth(row.date),
      String(row.content || '')
    ]))
  } catch (err) {
    if (seq !== dayMemoRequestSeq) return
    dayMemos.value = {}
    callWarning(err?.message || '日期備忘錄載入失敗')
  }
}

function openDayMemo(day) {
  memoDialog.day = day
  memoDialog.date = scheduleMemoDate(day)
  memoDialog.content = dayMemos.value[day] || ''
  memoDialog.visible = true
}

async function persistDayMemo(content) {
  if (!memoDialog.day || !selectedDepartment.value) return
  memoDialog.saving = true
  try {
    const res = await apiFetch(`/api/schedules/memos/${memoDialog.date}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department: selectedDepartment.value,
        subDepartment: selectedSubDepartment.value || '',
        content
      })
    })
    const payload = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(payload.error || '備忘錄儲存失敗')
    const next = { ...dayMemos.value }
    if (payload.content) next[memoDialog.day] = payload.content
    else delete next[memoDialog.day]
    dayMemos.value = next
    memoDialog.visible = false
    callSuccess(payload.content ? '日期備忘錄已儲存' : '日期備忘錄已清除')
  } catch (err) {
    callError(err?.message || '備忘錄儲存失敗')
  } finally {
    memoDialog.saving = false
  }
}

const saveDayMemo = () => persistDayMemo(String(memoDialog.content || '').trim())
const clearDayMemo = () => persistDayMemo('')

async function refreshScheduleData({
  reset = false,
  reason = 'unknown',
  fetchAll = false,
  includeSummary = true
} = {}) {
  const tasks = [fetchSchedules({ reset, fetchAll, reason })]
  if (canEditSchedule.value && selectedDepartment.value) {
    tasks.push(fetchDayMemos())
  }
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

watch([employeeSearch, statusFilter, jobTypeFilter], () => {
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
    cellViewStore.clear()
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

  const hasAnyEmptyDay = cells.some(c => !c.shiftId && !c.leave && !isLeaveCell(empId, c.day) && !hasPartialLeave(empId, c.day))
  const hasAnyLeave = cells.some(c => c.leave || isLeaveCell(empId, c.day) || hasPartialLeave(empId, c.day))

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
  return SCHEDULE_STATUS_LABELS[normalized] || sharedApprovalStatusText(normalized)
}

const approvalStatusTagType = status => {
  const normalized = String(status || '').trim().toLowerCase()
  return SCHEDULE_STATUS_TAG_MAP[normalized] || sharedApprovalStatusTagType(normalized)
}

// 期間：台灣時間的 起日 ~ 迄日（同一天只顯示一天）；沒有日期的單據顯示申請日
const formatApprovalPeriod = approval => {
  const data = approval?.form_data || {}
  const from =
    approval?.startDate ||
    data.startDate ||
    data.start_date ||
    data.fromDate ||
    data.from_date
  const to =
    approval?.endDate ||
    data.endDate ||
    data.end_date ||
    data.toDate ||
    data.to_date
  const fromText = formatTaipeiDate(from, '')
  const toText = formatTaipeiDate(to, '')
  if (fromText && toText) {
    return fromText === toText ? fromText : `${fromText} ~ ${toText}`
  }
  if (fromText || toText) {
    return fromText || toText
  }
  const createdText = formatTaipeiDate(approval?.createdAt, '')
  return createdText ? `申請日 ${createdText}` : '-'
}

// 申請人：伺服器放在 applicant_employee（舊欄位 employee 內容相同）
const approvalApplicant = approval => {
  const applicant = approval?.applicant_employee || approval?.employee
  if (!applicant) return null
  return typeof applicant === 'object' ? applicant : { _id: applicant }
}

// 表單性質：請假、加班…；舊資料沒有表單性質時看 isLeave 或類別
const resolveApprovalKind = approval => {
  const semantic = String(approval?.form?.semanticType || '').trim().toLowerCase()
  if (semantic) return semantic
  if (approval?.isLeave) return 'leave'
  const category = String(approval?.form?.category || '').trim().toLowerCase()
  return category === 'leave' || category === 'overtime' ? category : ''
}

// 相關簽核清單的列：伺服器回傳範圍內員工的所有簽核單（請假、加班、補簽、支援…，任何狀態），名稱沿用 leaveApprovalRows
const leaveApprovalRows = computed(() => {
  const relatedSet = relatedEmployeeIds.value
  return approvalList.value
    .filter(approval => {
      const id = approvalApplicant(approval)?._id
      if (!id) return false
      return relatedSet.has(String(id))
    })
    .map(approval => {
      const rawStatus = String(approval?.status || 'pending').toLowerCase()
      const kind = resolveApprovalKind(approval)
      const formName = String(approval?.form?.name || '').trim()
      return {
        ...approval,
        sourceType: kind === 'leave' ? 'leave_approval' : 'approval',
        sourceTypeLabel: APPROVAL_KIND_LABELS[kind] || formName || '其他簽核',
        applicantName: approvalApplicant(approval)?.name || '-',
        approvalType: formName || formatApprovalCategory(approval?.form?.category),
        periodText: formatApprovalPeriod(approval),
        status: rawStatus,
        statusLabel: formatApprovalStatus(rawStatus),
        statusTagType: approvalStatusTagType(rawStatus),
        noteSummary:
          approval?.noteSummary ||
          approval?.remark ||
          approval?.comment ||
          approval?.note ||
          approval?.form_data?.reason ||
          ''
      }
    })
})

const relatedApprovalRows = computed(() => [...leaveApprovalRows.value])
const pendingApprovalCount = computed(() =>
  relatedApprovalRows.value.filter(row => row.status === 'pending').length
)
const disputedApprovalCount = computed(() =>
  relatedApprovalRows.value.filter(row => row.status === 'disputed').length
)

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

function jumpToApprovalSection() {
  // 相關簽核預設收合：先展開再捲過去
  approvalCollapsed.value = false
  nextTick(() => {
    approvalCardRef.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  })
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
// 日期欄寬：一般 96、全螢幕 92（以前一般模式是 140，1440 寬的螢幕一次只看得到四天）
const dayColumnWidth = computed(() => (isTableFullscreen.value ? 92 : 96))
const fullscreenPopperTarget = computed(() => {
  if (!isTableFullscreen.value) return undefined
  return fullscreenPopperHostRef.value || '.schedule-fullscreen-popper-host'
})
const toolbarPopperAppendTarget = computed(() => {
  if (!isTableFullscreen.value) return undefined
  return fullscreenPopperTarget.value || '.schedule-fullscreen-popper-host'
})
const isToolbarDropdownTeleported = computed(
  () => !isTableFullscreen.value || !!toolbarPopperAppendTarget.value
)
const toolbarPopperClassName = computed(() =>
  isTableFullscreen.value ? 'schedule-toolbar-popper schedule-toolbar-popper--fullscreen' : 'schedule-toolbar-popper'
)

const tableMaxHeight = computed(() => {
  if (isTableFullscreen.value) {
    const dynamicHeight = measuredLayoutHeight.value
    if (dynamicHeight > 0) {
      return Math.max(320, dynamicHeight)
    }
  }
  // 一般模式：表格上緣以下扣掉分頁列與頁面下方的留白，其餘都給表格（量不到位置時用預估值）
  const TABLE_BOTTOM_RESERVE = 84
  const reservedHeight = isTableFullscreen.value
    ? 230
    : tableTopOffset.value > 0
      ? tableTopOffset.value + TABLE_BOTTOM_RESERVE
      : 330
  return Math.max(320, viewportHeight.value - reservedHeight)
})

// 量表格上緣的位置（加上頁面已經捲動的距離，等於頁面捲到最上面時的位置）
const measureTableTopOffset = () => {
  if (isTableFullscreen.value) return
  const wrapper = scheduleTableWrapperRef.value
  if (!wrapper || typeof wrapper.getBoundingClientRect !== 'function') return
  // 前台版面的捲動容器是 .content-wrapper（後台是 .el-main）；找不到就用整個視窗的捲動距離
  const scroller = wrapper.closest?.('.content-wrapper, .el-main')
  const scrolled = scroller ? scroller.scrollTop : (typeof window !== 'undefined' ? window.scrollY || 0 : 0)
  const top = Math.round(wrapper.getBoundingClientRect().top + scrolled)
  if (Number.isFinite(top) && top > 0 && Math.abs(top - tableTopOffset.value) > 1) {
    tableTopOffset.value = top
  }
}

const updateViewportHeight = () => {
  if (typeof window === 'undefined') return
  viewportHeight.value = window.innerHeight
  viewportWidth.value = window.innerWidth
  measureTableTopOffset()
  updateFullscreenLayoutHeight()
  recalculateViewportRanges()
}

const createThrottle = (fn, wait = 120) => {
  let lastTime = 0
  let timer = null
  const throttled = (...args) => {
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
  // 離開頁面時取消還沒執行的那一次
  throttled.cancel = () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  return throttled
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
    if (stressScenarioEnabled.value) perfTick.value += 1
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
  partialLeaveHours.value = {}
  scheduleMap.value = nextMap
  markLeaveIndexDirty()
  recomputeEmployeeStatuses(employees.value.map(emp => emp._id))
  invalidateCellMetaCache()
  pageSize.value = 200
  currentPage.value = 1
  renderStrategyPreference.value = 'virtual'
  recalculateViewportRanges()
  nextTick(() => {
    perfTick.value += 1
  })
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
  isFullscreenToolbarCollapsed.value = false
  updateFullscreenLayoutHeight()
}

const toggleTableFullscreen = () => {
  if (typeof document === 'undefined') return
  const target = scheduleCardRef.value
  if (!target || typeof target.requestFullscreen !== 'function') {
    const nextIsFullscreen = !isTableFullscreen.value
    isTableFullscreen.value = nextIsFullscreen
    isFullscreenToolbarCollapsed.value = false
    updateViewportHeight()
    updateFullscreenLayoutHeight()
    return
  }

  // 瀏覽器不允許真正的全螢幕（例如被政策停用、嵌在不允許全螢幕的框架裡）時，用的是版面全螢幕（沒有 fullscreenElement）。
  // 這時再按一次要直接退出；以前會再要求一次全螢幕、又被拒絕，結果永遠退不出來，只能重新整理
  if (isTableFullscreen.value && document.fullscreenElement !== target) {
    isTableFullscreen.value = false
    isFullscreenToolbarCollapsed.value = false
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
    isFullscreenToolbarCollapsed.value = false
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
  managedResizeHandler.cancel?.()
  listenerMetrics.delegatedActive = Math.max(0, listenerMetrics.delegatedActive - 1)
}

const filteredSubDepartments = computed(() =>
  subDepartments.value.filter(s => s.department === selectedDepartment.value)
)

const router = useRouter()

authStore.loadUser()
loadScheduleNotifications()

// 只有主管帶自己的 id 當 supervisor 參數（主管範圍）；管理員看全部員工，不再只列直屬於管理員的人
const canUseSupervisorFilter = computed(() => authStore.role === 'supervisor')
// 部門來自不同機構時（例如排班人員被指定到兩個機構的小單位），部門名稱附上機構名稱，同名的部門（各機構的「護理部」）才分得出來
const organizationNames = ref({})
const departmentsSpanOrganizations = computed(() =>
  new Set(departments.value.map(dept => String(dept?.organization?._id ?? dept?.organization ?? '')).filter(Boolean)).size > 1
)
const departmentLabel = dept => {
  const name = dept?.name || ''
  if (!departmentsSpanOrganizations.value) return name
  const orgName = organizationNames.value[String(dept?.organization?._id ?? dept?.organization ?? '')]
  return orgName ? `${name}（${orgName}）` : name
}
async function loadOrganizationNames() {
  if (!departmentsSpanOrganizations.value) return
  try {
    const res = await apiFetch('/api/organizations')
    if (!res.ok) return
    const list = await res.json()
    organizationNames.value = Object.fromEntries(
      (Array.isArray(list) ? list : []).map(org => [String(org?._id ?? org?.id ?? ''), org?.name || ''])
    )
  } catch (err) {
    // 機構名稱只是顯示用：讀不到就只顯示部門名稱
    console.error(err)
  }
}
const selectedDepartmentName = computed(() => {
  const dept = departments.value.find(item => item._id === selectedDepartment.value)
  return dept ? departmentLabel(dept) || '全部部門' : '全部部門'
})
const selectedSubDepartmentName = computed(() =>
  subDepartments.value.find(sub => sub._id === selectedSubDepartment.value)?.name || '全部單位'
)
const fullscreenFilterHint = computed(() =>
  `${selectedDepartmentName.value} / ${selectedSubDepartmentName.value}`
)
const showIncludeSelfToggle = computed(() => authStore.role === 'supervisor')
// 注意：可篩選(主管視角)與可編輯(排班維護)是兩種不同權限，避免共用同一判定。
const canEditScheduleRoles = ['supervisor', 'admin', 'manager', 'scheduler']
// 有排班權限資料時以它為準（排班人員任何角色都能排；被切開的主管不能），否則依角色
const canEditSchedule = computed(() =>
  authStore.role === 'admin' ||
  (scheduleAccess.value
    ? scheduleAccess.value.canSchedule
    : canEditScheduleRoles.includes(authStore.role))
)
// 部門篩選原本固定在主管自己的部門；管理員（看全部）與被指定到不同部門小單位的排班人員要能切換部門
const canSwitchDepartment = computed(() =>
  (authStore.role === 'admin' || isSchedulerView.value) && departments.value.length > 1
)
const missingSupervisorScheduleNoticeKey = ref('')
const isAdminUser = computed(() => authStore.role === 'admin')
// 公司行事曆（年度行事曆、國定假日）在後台「排班表設定」維護，只有管理員進得去
const goToCalendarSettings = () => {
  router.push('/manager/shift-schedule-setting')
}
// 週六、週日的日期（標頭用淺色區分）
const weekendDays = computed(() => {
  const set = new Set()
  const monthStart = dayjs(`${currentMonth.value}-01`)
  if (!monthStart.isValid()) return set
  days.value.forEach(day => {
    const weekday = monthStart.date(day.date).day()
    if (weekday === 0 || weekday === 6) set.add(day.date)
  })
  return set
})

// ========= 發布狀態相關 =========

const publishSummary = computed(() => resolvePublishSummary(rawSchedules.value, publishSnapshot.value))

const publishStatusLabel = computed(() => getPublishStatusLabel(publishSummary.value.status))

const pendingCount = computed(() => getPendingCount(publishSummary.value))

const disputedCount = computed(() => getDisputedCount(publishSummary.value))

const publishStepIndex = computed(() => getPublishStepIndex(publishSummary.value))

const stepStatuses = computed(() => getStepStatuses(publishSummary.value))

const pendingStepDescription = computed(() => getPendingStepDescription(publishSummary.value))

const disputeStepDescription = computed(() => getDisputeStepDescription(publishSummary.value))

const finalStepDescription = computed(() => getFinalStepDescription(publishSummary.value))

const publishProgress = computed(() => getPublishProgress(publishSummary.value))

const finalHasSchedules = computed(() => publishSummary.value.hasSchedules)

const publishDisabled = computed(() => isPublishDisabled(publishSummary.value, isPublishing.value))

const finalizeDisabled = computed(() => isFinalizeDisabled(publishSummary.value, isFinalizing.value))

const publishDisabledReason = computed(() => getPublishDisabledReason(publishSummary.value, isPublishing.value))

const finalizeDisabledReason = computed(() => getFinalizeDisabledReason(publishSummary.value, isFinalizing.value))

// 已經發送過、還沒鎖定（待確認、有異議、可完成發布）：主要按鈕是「完成發布」，另外可以重新發送
const isPublishedRound = computed(() => ['pending', 'disputed', 'ready'].includes(publishSummary.value.status))
// 下一步的按鈕不能按時，在按鈕旁用一行字說明原因（送出中、已鎖定不用說明）
// 已發送或已完成發布之後又改過的格子：「有 N 筆異動尚未發送」，這時「重新發送」是主要的下一步
const unpublishedNotice = computed(() => getUnpublishedNotice(publishSummary.value))
const hasUnpublishedChanges = computed(() => Boolean(unpublishedNotice.value))

const publishActionHint = computed(() => {
  if (publishSummary.value.status === 'finalized') return ''
  if (isPublishedRound.value) {
    return finalizeDisabled.value && !isFinalizing.value ? finalizeDisabledReason.value : ''
  }
  return publishDisabled.value && !isPublishing.value ? publishDisabledReason.value : ''
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
  appendScheduleNotification('warning', '提醒', message)
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
  appendScheduleNotification('info', '通知', message)
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
  appendScheduleNotification('success', '完成', message)
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
  // 班表日期是該日的 UTC 午夜：直接取日期部分，不依瀏覽器時區換算
  const parts = parseScheduleDate(value)
  if (!parts) return ''
  return `${String(parts.month).padStart(2, '0')}/${String(parts.day).padStart(2, '0')}`
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

// 排班規範只提醒、不擋發布與完成發布（客戶：「可以顯示規範，可是不要阻止發布」；匯入照舊檢核）。
// 兩者的回應帶著伺服器當下的檢核結果（violations／pendingWeeks 只在有的時候才出現）：
//   - 有違規時在通知日誌留一筆提醒，明細存成已格式化的文字（換頁、換月後仍看得到員工代號與姓名）
//   - 排班檢核徽章與完整檢核結果跟著更新；送出後已切換月份或篩選時不覆蓋別的範圍
function recordScheduleReleaseFindings(payload, { queryKey, title, message }) {
  const violations = Array.isArray(payload?.violations) ? payload.violations : []
  const pendingWeeks = Array.isArray(payload?.pendingWeeks) ? payload.pendingWeeks : []
  const lines = violations.map(formatLaborRuleViolation)
  if (lines.length) appendScheduleNotification('warning', title(lines.length), message(lines.length), lines)
  if (queryKey !== scheduleRuleQueryParams().toString()) return
  scheduleRuleValidation.ok = violations.length === 0
  scheduleRuleValidation.count = violations.length
  scheduleRuleValidation.violations = violations
  scheduleRuleValidation.pending = pendingWeeks
  scheduleRuleValidation.pendingCount = pendingWeeks.length
  schedulePendingLines.value = pendingWeeks.map(formatLaborRuleViolation)
  scheduleIssues.title = '排班規範檢核未通過'
  scheduleIssues.lines = lines
  // 同一批問題已經記錄過，之後的自動檢核不再重複寫「排班草稿待修正」
  lastLoggedRuleSignature = lines.join('\n')
}

async function publishSchedulesForMonth() {
  if (isPublishing.value) return
  try {
    isPublishing.value = true
    const queryKey = scheduleRuleQueryParams().toString()
    const res = await apiFetch('/api/schedules/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPublishPayload())
    })
    if (!res.ok) {
      const data = await handleScheduleActionApiError(res, '發布失敗')
      // 沒有需要發送的（409 NOTHING_TO_PUBLISH）或沒有班表（404 NO_SCHEDULES）：畫面上的發布狀態已經過期，重新讀一次
      if (res.status === 409 || res.status === 404) {
        await refreshScheduleData({ reset: true, reason: data?.code === 'NOTHING_TO_PUBLISH' ? 'publish-nothing' : 'publish-not-found' })
      }
      return
    }
    const payload = await res.json().catch(() => null)
    const publishedMonth = payload?.publishedMonth || currentMonth.value
    if (publishedMonth && /^\d{4}-(0[1-9]|1[0-2])$/.test(publishedMonth)) {
      localStorage.setItem(PUBLISHED_MONTH_HINT_KEY, publishedMonth)
    }
    callSuccess(describePublishSuccess(payload))
    recordScheduleReleaseFindings(payload, {
      queryKey,
      title: count => `已發布，仍有 ${count} 項排班規範問題`,
      message: count => `班表已發送給員工確認；以下 ${count} 項排班規範問題不影響發布，建議儘快修正。`
    })
    invalidateFetchAllCache()
    // 班表狀態已在伺服器改變：重新載入（reset），否則員工都已載入時不會重抓，發布狀態會停在「尚未發布」直到重新整理
    await refreshScheduleData({ reset: true, reason: 'publish-success' })
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
    const queryKey = scheduleRuleQueryParams().toString()
    const res = await apiFetch('/api/schedules/publish/finalize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPublishPayload())
    })
    if (res.status === 409) {
      // 409 UNCONFIRMED_EMPLOYEES：還有人沒回覆或有異議（伺服器回中文 error；舊版是英文，換成中文）
      const data = await res.json().catch(() => null)
      callWarning(describePublishError(data, '仍有員工尚未確認或提出異議，無法完成發布'))
      await refreshScheduleData({ reset: true, reason: 'finalize-conflict' })
      return
    }
    if (!res.ok) {
      await handleScheduleActionApiError(res, '完成發布失敗')
      return
    }
    let payload = null
    try {
      payload = await res.json()
    } catch (err) {
      // 回應不是 JSON 也算完成發布，只是沒有檢核結果可以顯示
    }
    callSuccess('班表已完成發布')
    recordScheduleReleaseFindings(payload, {
      queryKey,
      title: count => `已完成發布，仍有 ${count} 項排班規範問題`,
      message: count => `班表已完成發布並鎖定；以下 ${count} 項排班規範問題不影響完成發布，僅供後續調整參考。`
    })
    invalidateFetchAllCache()
    await refreshScheduleData({ reset: true, reason: 'finalize-success' })
  } catch (err) {
    callWarning(err?.message || '完成發布失敗')
  } finally {
    isFinalizing.value = false
  }
}

/**
 * 發布、完成發布前的確認視窗（只有一個視窗）。排班規範只提醒、不擋：
 *   - 預檢沒有違規：維持原本的確認文字與按鈕（跨月週待判斷時另加一段說明）
 *   - 預檢有違規：逐項列出（與排班檢核同一種文字，視窗可捲動），按鈕是「仍要發布／仍要完成發布」與「取消」
 *   - 預檢本身失敗（網路、伺服器）：說明檢核沒有完成，仍可發布
 * 使用者按確認時 resolve，取消或關閉時 reject（與 ElMessageBox.confirm 相同）。
 */
function confirmScheduleRelease(validation, { title, question, confirmButtonText, type, forceButtonText, actionLabel }) {
  const violations = Array.isArray(validation?.violations) ? validation.violations : []
  const pendingNote = validation ? pendingWeekConfirmNote(validation.pendingWeeks) : ''
  if (validation && !violations.length) {
    return ElMessageBox.confirm(`${question}${pendingNote ? `\n\n${pendingNote}` : ''}`, title, {
      type,
      confirmButtonText,
      cancelButtonText: '取消'
    })
  }
  const options = {
    type: 'warning',
    confirmButtonText: forceButtonText,
    cancelButtonText: '取消',
    customClass: 'schedule-issue-dialog',
    modalClass: 'schedule-issue-overlay',
    zIndex: 4000,
    closeOnClickModal: false
  }
  const appendTo = issueDialogAppendTarget()
  if (appendTo) options.appendTo = appendTo
  if (!validation) {
    return ElMessageBox.confirm(
      `排班規範檢核暫時無法完成，無法列出目前的排班規範問題。排班規範不影響${actionLabel}，仍可繼續；${actionLabel}後請按「排班檢核」重新檢核。\n\n${question}`,
      '排班規範檢核未完成',
      options
    )
  }
  const lines = violations.map(formatLaborRuleViolation)
  const blocks = [
    question,
    [`以下 ${lines.length} 項排班規範問題不影響${actionLabel}，建議儘快修正：`, ...lines.map(line => `・${line}`)].join('\n')
  ]
  if (pendingNote) blocks.push(pendingNote)
  return ElMessageBox.confirm(blocks.join('\n\n'), `有 ${lines.length} 項排班規範提醒（不影響${actionLabel}）`, options)
}

async function confirmPublish() {
  if (publishDisabled.value) {
    callWarning('目前沒有可發布的班表')
    return
  }
  // 預檢只用來在確認視窗列出問題，不另外跳出「檢核未通過」或「預檢已通過」的提示
  const validation = await fetchScheduleRuleValidation({ showIssues: false, notify: true, announcePending: false })
  if (scheduleRuleCheckDisposed) return
  try {
    await confirmScheduleRelease(validation, {
      title: '批次發布',
      question: '確認要將本月班表發送給員工確認嗎？',
      confirmButtonText: '送出',
      type: 'warning',
      forceButtonText: '仍要發布',
      actionLabel: '發布'
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
  const validation = await fetchScheduleRuleValidation({ showIssues: false, notify: true, announcePending: false })
  if (scheduleRuleCheckDisposed) return
  try {
    await confirmScheduleRelease(validation, {
      title: '完成發布',
      question: hasUnpublishedChanges.value
        ? `全部員工已確認；另${unpublishedNotice.value}，完成發布不會包含這些異動（要先按「重新發送」）。是否完成發布並鎖定班表？`
        : '全部員工已確認，是否完成發布並鎖定班表？',
      confirmButtonText: '完成',
      type: 'success',
      forceButtonText: '仍要完成發布',
      actionLabel: '完成發布'
    })
  } catch (err) {
    return
  }
  await finalizeSchedulesForMonth()
}

const days = computed(() => buildMonthDays(currentMonth.value, holidayMap.value))

// ========= 假日管理 =========

async function fetchHolidays() {
  // 只採用最後一次請求的回應：連續切換月份時，上一個月較慢的回應不能蓋掉現在這個月的假日標示
  const seq = ++holidayRequestSeq
  try {
    // 本月的行事曆標頭：國定假日顯示假日名稱、指定應放假日加「指定放假」，公務機關補假等只顯示灰字資訊
    const res = await apiFetch(`/api/holiday-calendar/headers?month=${currentMonth.value}`)
    if (seq !== holidayRequestSeq) return
    if (res.ok) {
      const data = await res.json()
      if (seq !== holidayRequestSeq) return
      const entries = Array.isArray(data) ? data : (Array.isArray(data?.entries) ? data.entries : [])
      holidays.value = entries
      calendarStatus.value = data && !Array.isArray(data) && data.status ? data.status : null
      holidayMap.value = buildHolidayMap(entries)
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
      // 保留顯示所需欄位：自訂底色／文字色、班別性質、跨日與夜班、休息設定
      shifts.value = list.map(s => ({
        _id: s._id,
        code: s.code,
        name: s.name ?? '',
        startTime: s.startTime,
        endTime: s.endTime,
        remark: s.remark,
        semanticType: s.semanticType,
        crossDay: s.crossDay,
        isNightShift: s.isNightShift,
        bgColor: s.bgColor,
        color: s.color,
        breakDuration: s.breakDuration,
        breakMinutes: s.breakMinutes,
        breakTime: s.breakTime,
        breakWindows: s.breakWindows
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
    // 只採用最後一次請求的回應：連續切換部門時，上一個部門較慢的回應不能把單位清單換回去
    const seq = ++subDepartmentRequestSeq
    const res = await apiFetch(url)
    if (seq !== subDepartmentRequestSeq) return
    if (!res.ok) throw new Error('Failed to fetch sub departments')
    const subData = await res.json()
    if (seq !== subDepartmentRequestSeq) return

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
    if (!filtered.length && normalized.length && !isSchedulerView.value) {
      filtered = normalized
    }

    const supervisorUnitIds = usesSupervisorScope.value
      ? (supervisorAssignableSubDepartmentIds.value.length
        ? supervisorAssignableSubDepartmentIds.value
        : supervisorSubDepartmentId.value
          ? [supervisorSubDepartmentId.value]
          : [])
      : []
    if (isSchedulerView.value) {
      // 排班人員：被指定的小單位，加上主管範圍的小單位（主管同時是排班人員時）
      filtered = filterScopeSubDepartments(filtered, scheduleAccess.value, supervisorUnitIds)
    } else if (authStore.role === 'supervisor') {
      const allowedSet = new Set(supervisorUnitIds.map(id => String(id)))
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
    if (isSchedulerView.value) {
      // 排班人員：被指定小單位所屬的部門（排班管理者的整個部門），主管同時是排班人員時再加上自己的部門
      filtered = filterScopeDepartments(
        normalized,
        scheduleAccess.value,
        usesSupervisorScope.value && supervisorDepartmentId.value ? [supervisorDepartmentId.value] : []
      )
      departments.value = filtered
      void loadOrganizationNames()
      if (!departments.value.some(d => d._id === selectedDepartment.value)) {
        selectedDepartment.value = departments.value[0]?._id || ''
      }
      await fetchSubDepartments(selectedDepartment.value)
      return
    }
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
    void loadOrganizationNames()

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
  if (!usesSupervisorScope.value) {
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
  if (!usesSupervisorScope.value) {
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
    const params = new URLSearchParams({ supervisor: targetId, pageSize: '200' })
    const res = await apiFetch(`/api/employees/schedule?${params.toString()}`)
    if (!res.ok) throw new Error('Failed to fetch direct reports')
    const payload = await res.json()
    const list = Array.isArray(payload) ? payload : (payload.employees ?? [])
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
      // 班表日期是該日的 UTC 午夜：直接取日期部分，不依瀏覽器時區換算（否則 1 號可能變成上個月最後一天）
      const dateNum = scheduleDayOfMonth(s.date)
      if (!Number.isFinite(dateNum)) return
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

// 一天最多算幾小時的請假（與請假時數換算相同）
const LEAVE_HOURS_PER_DAY = 8

const buildLeaveIndexAndScheduleMap = ({
  leaves,
  targetSet,
  month,
  employeesList
}) => {
  const nextLeaveIndex = {}
  const monthStart = dayjs(`${month}-01`).startOf('day')
  const monthEnd = monthStart.endOf('month').startOf('day')

  const nextPartialLeaveHours = {}
  // 有時分的請假區間（每位員工）與只請幾小時的日子是哪一張假單，用來判斷請假有沒有涵蓋那天排的整個班別
  const timedLeaveIntervals = {}
  const partialLeaveSource = {}
  const markLeaveDay = (empId, dayNum, l, reason = true) => {
    if (!nextLeaveIndex[empId]) nextLeaveIndex[empId] = {}
    nextLeaveIndex[empId][dayNum] = reason

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
  }

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

    // 請假以小時計：有時分的請假在整天都在請假中的日子，或涵蓋了那天排的整個上班班別（下面判斷）時，才當作請假日（不能排班）；
    // 只請幾小時的日子仍可排班，格子上提示請假時數。整天的假（日期選擇器的午夜）維持原本每一天都是請假日
    const interval = parseLeaveInterval(l.startDate, l.endDate)
    // 判斷班次是否被涵蓋時要用這位員工所有的請假（含整天的假）：跨日班別的隔天部分可能落在隔天的整天假裡，和伺服器一致
    if (interval && !interval.reversed) {
      if (!timedLeaveIntervals[empId]) timedLeaveIntervals[empId] = []
      timedLeaveIntervals[empId].push(interval)
    }
    if (interval && !interval.reversed && !interval.allDay) {
      describeLeaveDays(interval).forEach(({ dateKey, hours, wholeDay }) => {
        if (!dateKey.startsWith(`${month}-`)) return
        const dayNum = Number(dateKey.slice(8))
        // 有時分的請假涵蓋整個日曆日：當天沒排班、排的是休息類或認不得的班別就直接是請假日；
        // 排了認得的上班班別（例如跨日夜班）則交給下面的班次涵蓋判斷，和伺服器一樣
        const rosteredShiftId = scheduleMap.value[empId]?.[dayNum]?.shiftId
        const rosteredShift = rosteredShiftId ? shiftInfoMap.value.get(String(rosteredShiftId)) || null : null
        if (wholeDay && !(rosteredShift && !isCoverageNonWorkShift(rosteredShift))) {
          markLeaveDay(empId, dayNum, l)
          return
        }
        if (!nextPartialLeaveHours[empId]) nextPartialLeaveHours[empId] = {}
        nextPartialLeaveHours[empId][dayNum] = Math.min(
          (nextPartialLeaveHours[empId][dayNum] || 0) + hours,
          LEAVE_HOURS_PER_DAY
        )
        if (!partialLeaveSource[empId]) partialLeaveSource[empId] = {}
        if (!partialLeaveSource[empId][dayNum]) partialLeaveSource[empId][dayNum] = l
      })
      return
    }

    const startDate = dayjs(l.startDate).startOf('day')
    const endDate = dayjs(l.endDate).startOf('day')
    if (!startDate.isValid() || !endDate.isValid()) return

    let pointer = startDate.isBefore(monthStart) ? monthStart : startDate
    const boundary = endDate.isAfter(monthEnd) ? monthEnd : endDate

    while (!pointer.isAfter(boundary)) {
      markLeaveDay(empId, pointer.date(), l)
      pointer = pointer.add(1, 'day')
    }
  })

  // 只請幾小時的日子排了上班班別、而當天（含跨日班別的隔天）的請假合起來涵蓋整個班次（休息時間可以不在請假內）：
  // 伺服器的完整性檢查、匯出、國定假日休假紀錄都把這天當請假（leaveCoverageService.buildLeaveDayCheck，前端同一規則），
  // 畫面也和以前、和整天請假一樣顯示成請假、不能排班。沒排班的日子仍可排班（存檔時伺服器用所選的班別判斷）；
  // 班別設定裡找不到的班別無法判斷班次時間，不當成被涵蓋（不猜），維持請假時數的提示
  Object.entries(nextPartialLeaveHours).forEach(([empId, hoursByDay]) => {
    Object.keys(hoursByDay).forEach(dayKey => {
      const dayNum = Number(dayKey)
      if (nextLeaveIndex[empId]?.[dayNum]) return
      const shiftId = scheduleMap.value[empId]?.[dayNum]?.shiftId
      if (!shiftId) return
      const shift = shiftInfoMap.value.get(String(shiftId)) || null
      const dateKey = `${month}-${String(dayNum).padStart(2, '0')}`
      if (!leaveCoversRosteredShift(timedLeaveIntervals[empId], dateKey, shift)) return
      markLeaveDay(empId, dayNum, partialLeaveSource[empId][dayNum], LEAVE_COVERS_SHIFT)
      delete hoursByDay[dayKey]
    })
  })

  return { nextLeaveIndex, nextPartialLeaveHours }
}

function resetScheduleCache() {
  activeScheduleRequest.key = ''
  activeScheduleRequest.promise = null
  scheduleMap.value = {}
  rawSchedules.value = []
  publishSnapshot.value = null
  loadedEmployeeIds.value = new Set()
  approvalList.value = []
  approvalTruncated.value = false
  leaveIndex.value = {}
  partialLeaveHours.value = {}
  markLeaveIndexDirty()
  employeeStatusMap.value = {}
  cellViewStore.clear()
  invalidateCellMetaCache()
  fetchAllCache.fulfilled.clear()
  fetchAllCache.inFlight.clear()
}

// 切換月份的當下就把畫面上的班表清掉：格子用「幾號」對應，新月份的資料回來之前不能讓上個月的班別顯示在新月份的日期下面
//（那時點格子會改到上個月的班表）。相關簽核清單留著，新資料回來才換
function clearGridForScopeChange() {
  activeScheduleRequest.key = ''
  activeScheduleRequest.promise = null
  // 讓還在路上的班表請求失效（回應回來時序號已經不同，整份丟掉）
  activeScheduleRequest.requestId += 1
  isFetchingSchedules.value = false
  scheduleMap.value = {}
  rawSchedules.value = []
  publishSnapshot.value = null
  loadedEmployeeIds.value = new Set()
  leaveIndex.value = {}
  partialLeaveHours.value = {}
  markLeaveIndexDirty()
  dayMemos.value = {}
  dayMemoRequestSeq += 1
  employeeStatusMap.value = {}
  cellViewStore.clear()
  invalidateCellMetaCache()
  fetchAllCache.fulfilled.clear()
  fetchAllCache.inFlight.clear()
}

/**
 * GET /api/schedules/monthly 的 publishSummary -> 畫面用的發布狀態（null：伺服器沒給，改用班表逐筆推算）。
 * unpublishedCount：還沒送給員工的新增／異動筆數（已發送或已完成發布之後再改的格子），舊版伺服器沒有這個欄位。
 */
function toPublishSnapshot(summaryData, schedules = []) {
  if (!summaryData || typeof summaryData !== 'object') return null
  const isNewFormat =
    typeof summaryData.hasSchedules === 'boolean' ||
    Array.isArray(summaryData.pendingEmployees)
  const unpublished = Number(summaryData.unpublishedCount)
  const unpublishedCount = Number.isFinite(unpublished) && unpublished > 0 ? unpublished : 0
  if (isNewFormat) {
    return {
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
        summaryData.allEmployeesConfirmed ?? false,
      unpublishedCount
    }
  }
  if (Array.isArray(summaryData.currentRoundPendingEmployees)) {
    return {
      status: summaryData.status || 'draft',
      pendingEmployees: summaryData.currentRoundPendingEmployees,
      disputedEmployees: [],
      publishedAt: summaryData.publishedAt || null,
      hasSchedules: schedules.length > 0,
      totalEmployees: summaryData.totalEmployees ?? 0,
      allEmployeesConfirmed:
        summaryData.allEmployeesConfirmed ?? false,
      unpublishedCount
    }
  }
  return null
}

// 改了格子之後重新讀發布狀態：已發送或已完成發布的月份改一格，那一格回到「尚未發送」，
// 狀態列要馬上顯示「有 N 筆異動尚未發送」，不必重新整理頁面。連續改很多格只讀一次（等 400ms）。
// 只讀這一頁的同一組員工（伺服器的發布狀態算整個範圍，不看頁次），也只更新發布狀態，不動表格。
let publishSummaryRefreshTimer = null
let publishSummaryRequestSeq = 0
function schedulePublishSummaryRefresh() {
  if (!canEditSchedule.value) return
  if (publishSummaryRefreshTimer) clearTimeout(publishSummaryRefreshTimer)
  publishSummaryRefreshTimer = setTimeout(() => {
    publishSummaryRefreshTimer = null
    refreshPublishSummary().catch(() => {})
  }, 400)
}

async function refreshPublishSummary() {
  const seq = ++publishSummaryRequestSeq
  const params = [`month=${currentMonth.value}`, 'page=1', `pageSize=${pageSize.value}`]
  const ids = visibleEmployeeIds.value.length
    ? visibleEmployeeIds.value
    : employees.value.slice(0, pageSize.value).map(e => String(e._id))
  if (ids.length) params.push(`employeeIds=${ids.join(',')}`)
  if (selectedDepartment.value) params.push(`department=${selectedDepartment.value}`)
  if (selectedSubDepartment.value) params.push(`subDepartment=${selectedSubDepartment.value}`)
  const supervisorId = getStoredSupervisorId()
  if (supervisorId) params.push(`supervisor=${supervisorId}`)
  if (includeSelf.value && showIncludeSelfToggle.value) params.push('includeSelf=true')
  const res = await apiFetch(`/api/schedules/monthly?${params.join('&')}`)
  // 等回應的期間換了月份、單位，或又改了格子（seq 變了）：這份是舊的，丟掉
  if (seq !== publishSummaryRequestSeq || !res?.ok) return
  const data = typeof res.json === 'function' ? await res.json().catch(() => null) : null
  if (seq !== publishSummaryRequestSeq || !data || Array.isArray(data)) return
  const snapshot = toPublishSnapshot(data.publishSummary, Array.isArray(data.schedules) ? data.schedules : [])
  if (snapshot) publishSnapshot.value = snapshot
}

async function fetchSchedules({ reset = false, fetchAll = false, reason = 'unknown' } = {}) {
  const previousApprovalList = approvalList.value
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
  if (jobTypeFilter.value) {
    params.push(`jobType=${encodeURIComponent(jobTypeFilter.value)}`)
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
  // 整份重新載入會帶回最新的發布狀態：還沒回來的單獨刷新作廢，免得較舊的回應蓋掉
  publishSummaryRequestSeq += 1
  activeScheduleRequest.key = requestKey
  scheduleRequestStats.started += 1
  debugScheduleRequest('start', { reason, requestId, requestKey })
  isFetchingSchedules.value = true

  const requestPromise = (async () => {
    const res = await apiFetch(`/api/schedules/monthly${query}`)
    // 等回應的期間已經有更新的請求（換了月份、部門、頁次或篩選）：這份回應是舊範圍的，整份丟掉。
    // 以前只在最後才檢查，舊月份的班表與發布狀態會先寫進畫面，新月份沒有班表的日子就留著上個月的班別
    if (activeScheduleRequest.requestId !== requestId) return
    if (!res.ok) throw new Error('Failed to fetch schedules')
    const data =
      typeof res.json === 'function' ? await res.json() : []
    if (activeScheduleRequest.requestId !== requestId) return
    const schedules = Array.isArray(data)
      ? data
      : Array.isArray(data?.schedules)
        ? data.schedules
        : []

    publishSnapshot.value = toPublishSnapshot(Array.isArray(data) ? null : data?.publishSummary, schedules)

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

    approvalFetchError.value = ''
    const res2 = await apiFetch(`/api/schedules/leave-approvals${leaveQuery}`)
    if (res2?.ok && typeof res2.json === 'function') {
      const extra = await res2.json()
      const approvals = Array.isArray(extra?.approvals)
        ? extra.approvals
        : []
      const leaves = Array.isArray(extra?.leaves) ? extra.leaves : []
      const { nextLeaveIndex, nextPartialLeaveHours } = buildLeaveIndexAndScheduleMap({
        leaves,
        targetSet,
        month: currentMonth.value,
        employeesList: employees.value
      })
      if (activeScheduleRequest.requestId !== requestId) return
      rawSchedules.value = schedules
      approvalList.value = approvals
      approvalTruncated.value = res2.headers?.get?.('X-Approvals-Truncated') === 'true'
      leaveIndex.value = nextLeaveIndex
      partialLeaveHours.value = nextPartialLeaveHours
      markLeaveIndexDirty()
      recomputeEmployeeStatuses(targetEmployees)
      targetEmployees.forEach(empId => invalidateCellMetaCache(empId))
      markScheduleMapDirty()
    } else {
      if (activeScheduleRequest.requestId !== requestId) return
      rawSchedules.value = schedules
      approvalList.value = previousApprovalList
      approvalFetchError.value = '簽核資料載入失敗，已保留上一筆資料，請稍後重試。'
      leaveIndex.value = {}
      partialLeaveHours.value = {}
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
    // 已經被更新的請求取代：不提示、也不動現在畫面上的資料
    if (activeScheduleRequest.requestId === requestId) {
      callError('取得排班資料失敗')
      rawSchedules.value = []
    }
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
    callError('載入排班資料失敗')
  } finally {
    loading.close()
  }
}

// 匯出按鈕：沒有選部門、或目前範圍沒有員工時不能按（伺服器會回錯誤或一份空的檔案）
const exportDisabledReason = computed(() => {
  if (!selectedDepartment.value) return '請先選擇部門'
  if (!serverPaginationTotal.value) return '目前範圍沒有員工可以匯出'
  return ''
})
const exportDisabled = computed(() => Boolean(exportDisabledReason.value) || Boolean(isExporting.value))

// 匯出失敗的原因：伺服器的中文訊息直接顯示，英文的技術訊息換成看得懂的說明
async function describeExportFailure(res) {
  let serverMessage = ''
  try {
    serverMessage = String((await res.json())?.error || '')
  } catch (err) {
    // 回應不是 JSON：只顯示匯出失敗
  }
  if (!selectedDepartment.value) return '匯出失敗：請先選擇部門'
  if (res?.status === 403) return '匯出失敗：目前的排班範圍沒有可以匯出的員工'
  return /[\u4e00-\u9fff]/.test(serverMessage) ? `匯出失敗：${serverMessage}` : '匯出失敗'
}

async function exportSchedules(format) {
  // 上一次匯出還沒完成：不重複送出
  if (isExporting.value) return
  isExporting.value = format
  try {
    const params = new URLSearchParams({
      month: currentMonth.value,
      format: format
    })
    if (selectedDepartment.value) {
      params.append('department', selectedDepartment.value)
    }
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
    if (!res.ok) throw new Error(await describeExportFailure(res))
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `schedules-${currentMonth.value}.${format === 'excel' ? 'xlsx' : 'pdf'
      }`
    a.click()
    URL.revokeObjectURL(url)
  } catch (err) {
    callError(err?.message || '匯出失敗')
  } finally {
    isExporting.value = ''
  }
}

// ========= 工具列的小工具 =========

// 選單裡的項目：先收起選單再執行
function runMenuAction(menu, action) {
  if (menu === 'export') exportMenuVisible.value = false
  if (menu === 'more') moreMenuVisible.value = false
  return typeof action === 'function' ? action() : undefined
}

// 上個月／下個月
function stepMonth(delta) {
  const base = dayjs(`${currentMonth.value}-01`)
  const target = (base.isValid() ? base : dayjs()).add(delta, 'month').format('YYYY-MM')
  currentMonth.value = target
  return onMonthChange(target)
}

const hasEmployeeFilters = computed(() =>
  Boolean(employeeSearch.value || jobTypeFilter.value || (statusFilter.value && statusFilter.value !== 'all'))
)
const gridBusyText = computed(() => (isFetchingEmployees.value || isFetchingSchedules.value ? '載入中…' : ''))
// 表格沒有資料時的說明：告訴使用者下一步
const gridEmptyText = computed(() => {
  if (gridBusyText.value) return gridBusyText.value
  if (hasEmployeeFilters.value) return '沒有符合條件的員工，請調整搜尋或狀態篩選'
  return '這個單位目前沒有員工，請切換部門或單位'
})

// ========= 單格變更的狀態文字與復原 =========

// 「王小明 12/3」
function describeCellTarget(empId, day) {
  const employee = employeeById.value[String(empId)] || {}
  const month = Number(String(currentMonth.value).slice(5, 7))
  return `${employee.name || '員工'} ${month}/${Number(day)}`
}

function noteCellSaving(empId, day) {
  setCellSaveState(empId, day, 'saving')
  lastChange.value = { status: 'saving', text: `儲存中：${describeCellTarget(empId, day)}` }
}

function noteCellSaved(empId, day, previousShiftId, nextShiftId) {
  setCellSaveState(empId, day, 'saved')
  const label = nextShiftId ? (formatShiftLabel(shiftInfo(nextShiftId)) || '已排班') : '已清空'
  lastChange.value = { status: 'saved', text: `已儲存：${describeCellTarget(empId, day)} ${label}` }
  lastCellChange.value = {
    empId: String(empId),
    day: Number(day),
    previousShiftId: previousShiftId || '',
    month: currentMonth.value
  }
}

// 伺服器拒絕或連線失敗：格子維持原本的班別，原因顯示在格子的提示文字與工具列
function noteCellFailed(empId, day, reason) {
  const message = String(reason || '').trim() || '儲存失敗'
  setCellSaveState(empId, day, 'failed', message)
  lastChange.value = { status: 'failed', text: `未儲存：${describeCellTarget(empId, day)}（${message}）` }
}

const canUndoLastChange = computed(() => {
  const change = lastCellChange.value
  if (!change || lastChange.value?.status !== 'saved' || !canEditSchedule.value) return false
  if (change.month !== currentMonth.value) return false
  return Boolean(scheduleMap.value[change.empId]?.[change.day])
})

// 復原上一次的單格變更：把那一格改回原本的班別（等於再做一次單格排班，伺服器照常檢查）
async function undoLastChange() {
  const change = lastCellChange.value
  if (!canUndoLastChange.value || !change) return
  lastCellChange.value = null
  await onSelect(change.empId, change.day, change.previousShiftId)
}

// 新增了班表：發布狀態跟著變成「有班表可以發送」。以前新增後發布狀態不更新，
// 空白的月份排完班「發送待確認」仍然不能按，要重新整理頁面才行
function noteSchedulesCreated(created) {
  const list = (Array.isArray(created) ? created : [created]).filter(item => item && item._id)
  if (!list.length) return
  if (publishSnapshot.value) {
    if (!publishSnapshot.value.hasSchedules) {
      publishSnapshot.value = { ...publishSnapshot.value, hasSchedules: true }
    }
    return
  }
  const known = new Set(rawSchedules.value.map(item => String(item?._id || '')))
  const added = list.filter(item => !known.has(String(item._id)))
  if (added.length) rawSchedules.value = [...rawSchedules.value, ...added]
}

// 清空之後這個範圍已經沒有任何班表：發布狀態回到「尚未發布、沒有班表」，不再顯示清空前的待回覆筆數。
// 只有全部員工都在這一頁時才能確定（還有其他頁時不猜，等重新載入）
function noteSchedulesRemoved() {
  if (Number(serverPaginationTotal.value || 0) > employees.value.length) return
  const anyLeft = employees.value.some(emp =>
    Object.values(scheduleMap.value[String(emp._id)] || {}).some(cell => cell?.id)
  )
  if (anyLeft) return
  if (publishSnapshot.value) {
    publishSnapshot.value = {
      ...publishSnapshot.value,
      status: 'draft',
      hasSchedules: false,
      pendingEmployees: [],
      disputedEmployees: [],
      publishedAt: null,
      allEmployeesConfirmed: false
    }
  }
  rawSchedules.value = []
}

// 鍵盤：Esc 取消選取；Ctrl+Z 復原上一次的單格變更（焦點在輸入框、下拉選單時交給它們自己處理）
function handlePageKeydown(event) {
  const target = event?.target
  const key = String(event?.key || '')
  const inField = Boolean(
    target?.closest?.('textarea, select, [contenteditable="true"], .el-select, .el-popper, .el-input, .el-date-editor') ||
    (target?.tagName === 'INPUT' && target.type !== 'checkbox')
  )
  if (key === 'Escape' || key === 'Esc') {
    if (inField || !hasSelectionContext.value) return
    clearSelection()
    return
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && key.toLowerCase() === 'z') {
    if (inField || !canUndoLastChange.value) return
    event.preventDefault?.()
    undoLastChange()
  }
}

// ========= 單格即時排班（非批次）=========

async function onSelect(empId, day, value) {
  const dateStr = `${currentMonth.value}-${String(day).padStart(2, '0')}`
  const existing = scheduleMap.value[empId][day]
  const employee = employeeById.value[String(empId)] || {}
  const department = normalizeOptionalReferenceId(
    existing?.department || employee.departmentId
  )
  const subDepartment = normalizeOptionalReferenceId(
    existing?.subDepartment || employee.subDepartmentId
  )

  // 該格只要被視為請假，就直接擋掉
  if (existing?.leave || isLeaveCell(empId, day)) {
    callInfo(
      leaveIndex.value[String(empId)]?.[Number(day)] === LEAVE_COVERS_SHIFT
        ? '該日的核准請假涵蓋整個班別，無法調整排班'
        : '該日已有核准的全天請假，無法調整排班'
    )
    return
  }

  const prev = existing?.shiftId ?? ''

  if (!value) {
    if (!existing?.id) return
    noteCellSaving(empId, day)
    try {
      const res = await apiFetch(`/api/schedules/${existing.id}`, { method: 'DELETE' })
      if (!res.ok) {
        await handleScheduleError(res, '清空排班失敗', empId, day, prev, '')
        return
      }
      scheduleMap.value[empId][day] = { ...existing, id: '', shiftId: '' }
      invalidateFetchAllCache()
      invalidateCellMetaCache(empId, day)
      recomputeEmployeeStatusFor(empId)
      markScheduleMapDirty()
      noteCellSaved(empId, day, prev, '')
      noteSchedulesRemoved()
      await fetchSummary()
      await refreshFrontMenu()
      callSuccess(`${employee.name || '員工'} ${dateStr} 排班已清空`)
      schedulePublishSummaryRefresh()
      scheduleDraftRuleValidation()
    } catch (err) {
      await handleScheduleError(null, '清空排班失敗', empId, day, prev, '')
    }
    return
  }

  noteCellSaving(empId, day)

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
          prev,
          value
        )
      } else {
        scheduleMap.value[empId][day] = { ...existing, shiftId: value }
        invalidateFetchAllCache()
        invalidateCellMetaCache(empId, day)
        recomputeEmployeeStatusFor(empId)
        markScheduleMapDirty()
        noteCellSaved(empId, day, prev, value)
        await fetchSummary()
        await refreshFrontMenu()
        schedulePublishSummaryRefresh()
        scheduleDraftRuleValidation()
      }
    } catch (err) {
      await handleScheduleError(
        null,
        '更新排班失敗',
        empId,
        day,
        prev,
        value
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
        noteCellSaved(empId, day, prev, saved.shiftId || value)
        noteSchedulesCreated(saved)
        await fetchSummary()
        await refreshFrontMenu()
        schedulePublishSummaryRefresh()
        scheduleDraftRuleValidation()
      } else {
        await handleScheduleError(
          res,
          '新增排班失敗',
          empId,
          day,
          prev,
          value
        )
      }
    } catch (err) {
      await handleScheduleError(
        null,
        '新增排班失敗',
        empId,
        day,
        prev,
        value
      )
    }
  }
}

// ========= 篩選切換 =========

async function onDepartmentChange() {
  // 換部門：先前勾的員工、日期與格子不帶到新的範圍（否則勾好的日期會套到另一個單位的人）
  clearSelection()
  resetChangeFeedback()
  selectedSubDepartment.value = ''
  await fetchSubDepartments(selectedDepartment.value)
  await fetchEmployees(selectedDepartment.value, '')
  currentPage.value = 1
  await refreshScheduleData({ reset: true, reason: 'department-change' })
}

async function onSubDepartmentChange() {
  clearSelection()
  resetChangeFeedback()
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
  prev,
  requestedShiftId = ''
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

  let data = null
  try {
    if (res) {
      data = await res.json()
    }
  } catch (e) { }

  const msg = data?.error || ''
  const code = data?.code || ''
  const violations = Array.isArray(data?.violations) ? data.violations : []
  if (violations.length) {
    noteCellFailed(empId, day, '排班規範檢核未通過')
    await openScheduleIssueDialog(
      '排班規範檢核未通過',
      violations.map(formatLaborRuleViolation),
      msg || defaultMsg
    )
    return
  }

  const conflict = data?.conflict || {}
  const employee = employeeIssueLabel(conflict.employee || empId)
  const fallbackDate = `${currentMonth.value}-${String(day).padStart(2, '0')}`
  const date = scheduleDateKey(conflict.date || fallbackDate) || fallbackDate
  const requestedShift = conflict.requestedShiftId || requestedShiftId
  const requestedLabel = formatShiftLabel(shiftInfo(requestedShift)) || String(requestedShift || '')

  if (res?.status === 403 || code === 'SCHEDULE_SCOPE_FORBIDDEN') {
    noteCellFailed(empId, day, '這位員工不在您的排班範圍內')
    await openScheduleIssueDialog(
      '排班權限不足',
      ['目前帳號只能調整排班範圍內員工的班表。請重新整理後確認員工是否仍在您的排班範圍；若人員已調動，請由管理員更新小單位的排班人員設定。'],
      defaultMsg
    )
  } else if (msg === 'employee conflict') {
    const existingShift = conflict.existingShiftId || ''
    const existingLabel = formatShiftLabel(shiftInfo(existingShift)) || String(existingShift || '')
    const existingText = existingLabel ? `已有排班「${existingLabel}」` : '已存在另一筆排班'
    const requestedText = requestedLabel ? `，無法再排「${requestedLabel}」` : '，無法重複新增'
    noteCellFailed(empId, day, `${existingText}，畫面資料可能已過期，請重新整理`)
    await openScheduleIssueDialog(
      '排班資料衝突',
      [`${employee}：${date} ${existingText}${requestedText}。畫面資料可能已過期，請重新整理後再調整。`],
      defaultMsg
    )
  } else if (msg === 'department overlap') {
    noteCellFailed(empId, day, '既有排班屬於不同部門或單位，無法覆蓋')
    await openScheduleIssueDialog(
      '部門或單位不一致',
      [`${employee}：${date} 的既有排班屬於不同部門或單位，無法覆蓋。請重新整理後再調整。`],
      defaultMsg
    )
  } else if (msg === 'leave conflict') {
    noteCellFailed(empId, day, '已有核准的全天請假，或請假時間涵蓋整個班別')
    await openScheduleIssueDialog(
      '核准請假衝突',
      [`${employee}：${date} 已有核准的全天請假，或請假時間涵蓋整個班別，無法安排班別${requestedLabel ? `「${requestedLabel}」` : ''}。`],
      defaultMsg
    )
  } else if (msg) {
    noteCellFailed(empId, day, msg)
    await openScheduleIssueDialog('排班操作失敗', [msg], defaultMsg)
  } else {
    noteCellFailed(empId, day, res ? defaultMsg : `${defaultMsg}，請確認網路連線後再試`)
    callError(defaultMsg)
  }
}

const callError = message => {
  appendScheduleNotification('error', '操作失敗', message)
  const moduleError = ElMessage?.error
  if (typeof moduleError === 'function') moduleError(message)
  const globalError = typeof window !== 'undefined' ? window.ElMessage?.error : undefined
  if (typeof globalError === 'function' && globalError !== moduleError) globalError(message)
}

// ========= 批次套用 =========

async function handleBatchApiError(res, defaultMsg = '批次套用失敗') {
  let msg = ''
  let violations = []
  try {
    if (res) {
      const data = await res.json()
      msg = data?.error || ''
      violations = Array.isArray(data?.violations) ? data.violations : []
    }
  } catch (err) { }
  if (violations.length) {
    await openScheduleIssueDialog(
      '排班規範檢核未通過',
      violations.map(formatLaborRuleViolation),
      msg || defaultMsg
    )
    return
  }
  if (msg === 'employee conflict') {
    callWarning('部分員工既有排班已更新，請重新整理檢查')
  } else if (msg === 'department overlap') {
    await openScheduleIssueDialog('部門或單位不一致', ['部門或單位與既有資料不一致，無法套用'], defaultMsg)
  } else if (msg === 'leave conflict') {
    await openScheduleIssueDialog('核准請假衝突', ['選取日期包含已核准的全天請假，或請假時間涵蓋整個班別的日子，無法套用'], defaultMsg)
  } else if (msg) {
    await openScheduleIssueDialog('批次套用失敗', [msg], defaultMsg)
  } else {
    await openScheduleIssueDialog('批次套用失敗', [], defaultMsg)
  }
}

async function clearSelectedSchedules() {
  const selected = selectedPersistedSchedules.value
  if (!selected.length) {
    callInfo('選取範圍內沒有可清空的排班')
    return
  }
  try {
    await ElMessageBox.confirm(
      `即將清空 ${selected.length} 筆已排班資料。此操作不會刪除員工、假單或日期備忘錄。`,
      '確認清空排班',
      { confirmButtonText: '清空排班', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (error) {
    return
  }

  isClearingBatch.value = true
  try {
    const res = await apiFetch('/api/schedules/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: selected.map(item => item.id) })
    })
    if (!res.ok) {
      await handleScheduleActionApiError(res, '清空排班失敗')
      return
    }
    const payload = await res.json()
    const deletedIds = new Set((payload.ids || []).map(String))
    const affectedEmployees = new Set()
    selected.forEach(item => {
      if (!deletedIds.has(item.id)) return
      const current = scheduleMap.value[item.empId]?.[item.day]
      if (!current) return
      scheduleMap.value[item.empId][item.day] = { ...current, id: '', shiftId: '' }
      invalidateCellMetaCache(item.empId, item.day)
      affectedEmployees.add(String(item.empId))
    })
    recomputeEmployeeStatuses(Array.from(affectedEmployees))
    markScheduleMapDirty()
    invalidateFetchAllCache()
    clearSelection()
    resetChangeFeedback()
    noteSchedulesRemoved()
    await fetchSummary()
    await refreshFrontMenu()
    callSuccess(`已清空 ${Number(payload.deleted || deletedIds.size)} 筆排班`)
    schedulePublishSummaryRefresh()
    scheduleDraftRuleValidation()
  } catch (err) {
    callError(err?.message || '清空排班失敗')
  } finally {
    isClearingBatch.value = false
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

    const department = effectiveBatchDepartment.value || info.department || ''
    let subDepartment = info.subDepartment || ''

    if (effectiveBatchDepartment.value) {
      subDepartment = effectiveBatchSubDepartment.value || ''
    } else if (effectiveBatchSubDepartment.value) {
      subDepartment = effectiveBatchSubDepartment.value
    }

    batchPayload.push({
      employee: empId,
      day,
      date: `${currentMonth.value}-${String(day).padStart(2, '0')}`,
      shiftId: batchShiftId.value,
      department: normalizeOptionalReferenceId(department),
      subDepartment: normalizeOptionalReferenceId(subDepartment)
    })
  })

  if (!batchPayload.length) {
    callInfo('選取的儲存格皆無需更新（或皆為全天請假、請假涵蓋整個班別的日子）')
    return
  }

  const payloadMap = new Map()
  batchPayload.forEach(item => {
    payloadMap.set(buildCellKey(item.employee, item.day), item)
  })

  isApplyingBatch.value = true

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
      isApplyingBatch.value = false
      await handleBatchApiError(null)
      return
    }

    if (!res.ok) {
      isApplyingBatch.value = false
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
      // 班表日期是該日的 UTC 午夜：直接取日期部分，不依瀏覽器時區換算
      const d = scheduleDayOfMonth(entry.date)
      if (!Number.isFinite(d)) return
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
    noteSchedulesCreated(result)
    // 批次套用不能用「復原」退回，上一次單格變更的復原也一併取消
    resetChangeFeedback()

    callSuccess('批次套用完成')
    invalidateFetchAllCache()
    await fetchSummary()
    clearSelection()
    await refreshFrontMenu()
    schedulePublishSummaryRefresh()
    scheduleDraftRuleValidation()
  } finally {
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

// 勾選整列的底色由樣式表判斷（列裡的核取方塊打勾，見 ScheduleWorkspace.scss），這裡不讀選取狀態：
// 列的 class 是表格主體渲染時算的，一讀選取狀態，每勾一位員工整張表格（上千格）就要重新渲染一次
function scheduleRowClassName({ row }) {
  const empId = String(row?._id || '')
  if (!empId) return ''
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
  if (jobTypeFilter.value) {
    params.push(`jobType=${encodeURIComponent(jobTypeFilter.value)}`)
  }
  params.push(`includeSelf=${includeSelf.value && showIncludeSelfToggle.value}`)
  const url = `/api/employees/schedule${params.length ? `?${params.join('&')}` : ''
    }`
  // 只採用最後一次請求的回應：搜尋框每打一個字就查一次，較早、較慢的回應不能蓋掉最新的名單
  const seq = ++employeeRequestSeq
  isFetchingEmployees.value = true
  try {
    const empRes = await apiFetch(url)
    if (seq !== employeeRequestSeq) return
    if (!empRes.ok) throw new Error('Failed to fetch employees')
    const payload =
      typeof empRes.json === 'function' ? await empRes.json() : []
    if (seq !== employeeRequestSeq) return
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
      
      // 特休以小時為單位：伺服器給 remainingHours（天數是 時數 / 8 的換算）；舊版回應只有 remainingDays 就乘 8
      const rawHours = e?.annualLeave?.remainingHours
      const remainingHours = rawHours !== undefined && rawHours !== null && Number.isFinite(Number(rawHours))
        ? Math.max(0, Number(rawHours))
        : Math.max(0, Number(e?.annualLeave?.remainingDays || 0)) * 8
      const annualLeave = {
        remainingDays: Math.round((remainingHours / 8) * 100) / 100,
        remainingHours
      }

      return {
        _id: normalizedId,
        employeeId: e.employeeId || '',
        name: e.name,
        title: e.title || '',
        practiceTitle: e.practiceTitle || '',
        photo: e.photo,
        hasPhoto: e.hasPhoto,
        departmentId: normalizedDept,
        subDepartmentId: normalizedSub,
        department: deptMap[normalizedDept] || '',
        subDepartment: subMap[normalizedSub] || '',
        annualLeave,
        // 兼職人員不套用排班規範檢核，名單上標示出來
        partTime: e?.partTime === true,
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
            // 頭像用：個人資料帶的照片路徑（沒有照片是空字串），排班表裡主管本人那一列才看得到自己的照片
            photo: supervisorProfile.value?.photo || '',
            partTime: supervisorProfile.value?.partTime === true,
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
    if (seq !== employeeRequestSeq) return
    console.error(err)
    callError('取得員工資料失敗')
  } finally {
    if (seq === employeeRequestSeq) isFetchingEmployees.value = false
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

    // 只採用最後一次請求的回應：切換月份、單位或連續改班時，較早、較慢的回應不能蓋掉最新的統計
    const seq = ++summaryRequestSeq
    const res = await apiFetch(
      `/api/schedules/summary?${params.join('&')}`
    )
    if (seq !== summaryRequestSeq) return
    if (!res.ok) return

    const data = await res.json()
    if (seq !== summaryRequestSeq) return
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

watch([currentMonth, selectedDepartment, selectedSubDepartment, includeSelf], () => {
  scheduleIssues.lines = []
  scheduleRuleValidation.ok = false
  scheduleRuleValidation.violations = []
  scheduleRuleValidation.count = 0
  scheduleRuleValidation.pending = []
  scheduleRuleValidation.pendingCount = 0
  schedulePendingLines.value = []
  lastLoggedRuleSignature = ''
})

async function onMonthChange(value) {
  const next = value ? dayjs(value) : dayjs()
  currentMonth.value = next.isValid()
    ? next.format('YYYY-MM')
    : dayjs().format('YYYY-MM')
  currentPage.value = 1
  // 上個月的班表、選取與變更狀態不帶到新月份（格子與選取都用「幾號」對應）
  clearGridForScopeChange()
  clearSelection()
  resetChangeFeedback()
  await fetchHolidays()
  // 「缺班」「待審核請假」的名單每個月不同：有狀態篩選時名單跟著月份重新查
  if (statusFilter.value && statusFilter.value !== 'all') {
    await fetchEmployees(selectedDepartment.value, selectedSubDepartment.value)
  }
  await refreshScheduleData({ reset: true, reason: 'month-change' })
  // 相鄰月份可能已經排定或修改過：換到這個月時，在背景重新檢核一次，跨月週的結果才會跟上（只更新徽章與提醒，不彈窗）
  if (canEditSchedule.value) {
    try {
      await fetchScheduleRuleValidation({ quiet: true })
    } catch (error) {
      // 背景檢核失敗不影響換月
    }
  }
}

// ========= 初始化 =========

onBeforeUnmount(() => {
  scheduleRuleCheckDisposed = true
  clearCellSaveStates()
  if (scheduleRuleValidationTimer) {
    clearTimeout(scheduleRuleValidationTimer)
    scheduleRuleValidationTimer = null
  }
  if (publishSummaryRefreshTimer) {
    clearTimeout(publishSummaryRefreshTimer)
    publishSummaryRefreshTimer = null
  }
  publishSummaryRequestSeq += 1
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
      measureTableTopOffset()
      updateFullscreenLayoutHeight()
    })
    ;[
      // 頁首與發布狀態列變高變矮時，表格的位置跟著變
      schedulePageRef.value?.firstElementChild,
      publishBarRef.value,
      scheduleCardRef.value,
      scheduleHeaderRef.value,
      batchToolbarRef.value,
      stressToolbarRef.value,
      paginationBarRef.value
    ]
      .filter(target => target && typeof target === 'object' && target.nodeType === 1)
      .forEach(target => layoutResizeObserver.observe(target))
  }
  measureTableTopOffset()
  updateFullscreenLayoutHeight()
  bindTableScrollListeners()
  listenerMetrics.elementLevelEstimated = (virtualVisibleEmployees.value.length * (virtualVisibleDays.value.length + 1)) + virtualVisibleDays.value.length
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

// 把 cellViewMap 的結果分送到每一格自己的 shallowRef：物件沒換（內容沒變）就不動，那一格不會重新渲染。
// flush: 'pre'：同一輪更新裡先同步完，表格才渲染
watch(
  cellViewMap,
  map => {
    map.forEach((view, key) => {
      const holder = cellViewRefs.get(key)
      if (!holder) cellViewRefs.set(key, shallowRef(view))
      else if (holder.value !== view) holder.value = view
    })
    if (cellViewRefs.size > map.size) {
      cellViewRefs.forEach((holder, key) => {
        if (!map.has(key)) cellViewRefs.delete(key)
      })
    }
  },
  { immediate: true, flush: 'pre' }
)

watch(tableMaxHeight, () => {
  bindTableScrollListeners()
})

watch([virtualVisibleEmployees, virtualVisibleDays], () => {
  listenerMetrics.elementLevelEstimated =
    (virtualVisibleEmployees.value.length * (virtualVisibleDays.value.length + 1)) +
    virtualVisibleDays.value.length
})

onUpdated(() => {
  updateFullscreenLayoutHeight()
})
</script>



<style scoped lang="scss" src="./ScheduleWorkspace.scss"></style>
<style scoped>
/* 公務機關補假、調整放假、公司休息日等：只是資訊，不是國定假日 */
.day-header-info {
  color: #98a2b3;
  font-size: 11px;
  font-weight: 400;
  line-height: 1.2;
  white-space: nowrap;
}
</style>
<style lang="scss" src="./ScheduleNotificationDrawer.scss"></style>
