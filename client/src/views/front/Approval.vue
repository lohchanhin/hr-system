<!-- src/views/front/Approval.vue：簽核頁（申請表單／待我簽核／我已簽核／我的申請）。員工多半用手機：
     表單放最上面、餘額收合在下面；清單在手機是卡片、桌機是表格；對話框在手機全螢幕（規範見 docs/ui-guidelines.md）。 -->
<template>
  <div class="approval-page" :class="{ 'is-mobile': isMobile }">
    <PageHeader title="簽核流程" subtitle="送出申請、簽核、查看進度">
      <template #stats>
        <button type="button" class="hr-stat approval-stat" data-test="stat-inbox" @click="goTab('inbox')">
          <span class="hr-stat__label">待我簽核</span>
          <strong class="hr-stat__value">{{ inboxCount }}</strong>
        </button>
        <button type="button" class="hr-stat approval-stat" data-test="stat-mine" @click="showMyInProgress">
          <span class="hr-stat__label">進行中的申請</span>
          <strong class="hr-stat__value">{{ myInProgressCount }}</strong>
        </button>
      </template>
    </PageHeader>

    <el-tabs v-model="activeTab" v-loading="initializing" class="approval-tabs" @tab-click="tabChosen = true">
      <!-- 1) 申請表單：先選表單、填寫、看流程、送出；餘額是參考資訊，收合在表單下面 -->
      <el-tab-pane name="apply" label="申請表單">
        <section class="hr-section apply-section">
          <el-form
            :label-width="isMobile ? 'auto' : '120px'"
            :label-position="isMobile ? 'top' : 'right'"
            :model="applyState"
            class="apply-form"
            @submit.prevent
          >
            <el-form-item label="申請表單" class="template-selector">
              <div class="selector-row">
                <el-select
                  v-model="applyState.formId"
                  placeholder="請選擇申請表單類型"
                  class="form-select"
                  no-data-text="目前沒有可申請的表單"
                  @change="onSelectForm"
                >
                  <el-option
                    v-for="f in formTemplates"
                    :key="f._id"
                    :label="f.name"
                    :value="f._id"
                  >
                    <span class="option-content">
                      <span class="option-label">{{ f.name }}</span>
                      <span v-if="f.category" class="option-category">{{ f.category }}</span>
                    </span>
                  </el-option>
                </el-select>
                <el-button
                  v-if="leaveFormId && applyState.formId !== leaveFormId"
                  class="quick-btn"
                  data-test="quick-leave"
                  @click="selectLeave"
                >
                  快速請假
                </el-button>
                <el-button link type="primary" class="help-btn" @click="showFormHelp">表單說明</el-button>
              </div>
              <!-- 部門的「使用簽核表單」：清單有依部門篩選時提示（伺服器回應標頭 X-Form-Visibility: department） -->
              <p v-if="formsRestricted" class="hr-hint form-visibility-hint" data-test="form-visibility-hint">
                目前只列出您所屬部門開放使用的表單；找不到需要的表單請洽管理員
              </p>
            </el-form-item>
            <div v-if="templatesError" class="error-message load-error" data-test="templates-error">
              <span>表單清單載入失敗：{{ templatesError }}</span>
              <el-button link type="primary" @click="loadFormTemplates()">重新載入</el-button>
            </div>
            <!-- 選好的表單不在可申請的清單了（管理員停用，或部門不再開放）：說明為什麼不見了 -->
            <el-alert
              v-if="formGoneNotice"
              type="warning"
              show-icon
              class="mb-3"
              :title="formGoneNotice"
              data-test="form-gone-notice"
              @close="formGoneNotice = ''"
            />

            <div v-if="applyState.formId && (fieldList.length || fieldsLoaded)" class="form-content">
              <!-- 動態欄位 -->
              <div class="form-fields">
                <ApprovalFormFields
                  v-model="applyState.formData"
                  v-model:files="fileBuffers"
                  :fields="fieldList"
                  :errors="applyFieldErrors"
                  :leave-hours="applyLeaveHoursConfig"
                  :user-options="userOptions"
                  :dept-options="deptOptions"
                  :org-options="orgOptions"
                >
                  <template #field-extra="{ field }">
                    <!-- 請假單：假別下方是這個假別還能請多少（還沒選時列特休與調休），完整的餘額表在表單下面 -->
                    <div
                      v-if="applyLeaveBrief.length && field._id === applyLeaveFieldIds.type"
                      class="balance-brief"
                      data-test="balance-brief"
                    >
                      <span v-for="text in applyLeaveBrief" :key="text" class="balance-brief__item">{{ text }}</span>
                      <el-button link type="primary" size="small" @click="showAllBalances">全部餘額</el-button>
                    </div>
                    <!-- 時數下方：這次申請會不會超額、核准後剩多少 -->
                    <LeaveRequestHint
                      v-if="applyLeaveContext && field._id === applyLeaveFieldIds.hours"
                      :items="ownBalanceItems"
                      :type-text="applyLeaveContext.typeText"
                      :hours="applyLeaveContext.hours"
                      :end-date="applyLeaveContext.endValue"
                    />
                  </template>
                </ApprovalFormFields>
              </div>

              <div v-if="workflowSteps.length || workflowWarning" class="workflow-preview">
                <h3 class="block-title">簽核流程</h3>
                <el-alert
                  v-if="workflowWarning"
                  type="warning"
                  :closable="false"
                  show-icon
                  class="mb-3"
                  :title="workflowWarning"
                />
                <ol class="workflow-steps">
                  <li
                    v-for="(s, idx) in workflowSteps"
                    :key="idx"
                    class="workflow-step"
                  >
                    <span class="step-number">{{ idx + 1 }}</span>
                    <div class="step-content">
                      <p class="step-title">{{ s.label }}</p>
                      <p class="step-approvers">{{ s.approvers }}</p>
                      <!-- 有請假長度條件的關卡（例如請假滿 56 小時才需要）、會被略過的重複簽核人 -->
                      <p v-if="s.condition" class="step-condition" data-test="workflow-step-condition">{{ s.condition }}</p>
                      <p v-if="s.repeat" class="step-repeat" data-test="workflow-step-repeat">{{ s.repeat }}</p>
                      <p v-if="s.fallback" class="step-fallback" data-test="workflow-step-fallback">{{ s.fallback }}</p>
                      <p v-if="s.warning" class="step-warning">{{ s.warning }}</p>
                    </div>
                  </li>
                </ol>
              </div>

              <div class="form-actions">
                <el-button
                  type="primary"
                  size="large"
                  :loading="submitting"
                  class="submit-btn"
                  data-test="submit-apply"
                  @click="submitApply"
                >
                  {{ submitting && uploadProgress ? uploadProgress : '送出申請' }}
                </el-button>
                <div v-if="applyError" class="error-message" data-test="apply-error">
                  <div>
                    <div>{{ applyError }}</div>
                    <ul v-if="applyErrorLines.length" class="error-lines">
                      <li v-for="(line, i) in applyErrorLines" :key="i">{{ line }}</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>

            <div v-else-if="applyState.formId && fieldsLoading" class="hr-empty" data-test="apply-loading">表單載入中…</div>
            <div v-else-if="applyState.formId && applyError" class="error-message load-error" data-test="apply-error">
              <span>{{ applyError }}</span>
              <el-button link type="primary" @click="onSelectForm">重新載入</el-button>
            </div>
            <div v-else-if="!templatesError" class="hr-empty apply-empty">
              選擇表單後開始填寫
            </div>
          </el-form>
        </section>

        <!-- 參考資訊：自己的假別餘額與調休存摺，預設收合，不擋住表單（每個人申請前都看得到；按「展開」看完整的表） -->
        <div ref="balanceSection" class="apply-reference">
          <LeaveBalancePanel
            ref="applyBalancePanel"
            title="我的假別餘額"
            collapsible
            @loaded="onOwnBalancesLoaded"
          />
          <!-- 我的調休（客戶稱為移休）：國定假日適逢休息日／例假存入的調休（來源、狀態、用在哪張單、人資備註）；要用時在上方選假別「調休」或「移休」發起簽核 -->
          <CompensatoryLeavePanel
            ref="applyCompPanel"
            title="我的調休（移休）"
            collapsible
          />
        </div>
      </el-tab-pane>

      <!-- 2) 待我簽核：等最久的排最前面 -->
      <el-tab-pane name="inbox">
        <template #label>
          <span>待我簽核</span><span v-if="inboxCount" class="tab-count" data-test="inbox-tab-count">{{ inboxCount }}</span>
        </template>

        <section class="list-section">
          <ApprovalListFilters
            v-model="inboxFilter"
            :form-options="inboxFormOptions"
            show-keyword
            :loading="inboxLoading"
            @refresh="fetchInbox()"
          />
          <el-alert
            v-if="inboxError"
            type="error"
            :closable="false"
            class="mb-3"
            :title="inboxError"
          />

          <!-- 手機：卡片清單，點卡片看明細，簽核按鈕直接在卡片上 -->
          <div v-if="isMobile" v-loading="inboxLoading" class="req-cards" data-test="inbox-cards">
            <article v-for="row in inboxRows" :key="row._id" class="req-card" data-test="inbox-card">
              <button type="button" class="req-card__main" @click="openDetail(row._id)">
                <span class="req-card__head">
                  <span class="req-card__title">{{ formNameOf(row) }}</span>
                  <span class="req-card__age">{{ formatAge(row.createdAt) }}</span>
                </span>
                <span class="req-card__person applicant-info">
                  <EmployeeAvatar :employee="personOf(row.applicant_employee)" :size="32" class="applicant-avatar" />
                  <span>{{ row.applicant_employee?.name || '-' }}</span>
                </span>
                <span v-if="rowSummary(row)" class="req-card__summary">{{ rowSummary(row) }}</span>
                <span class="req-card__meta">{{ [stepProgressText(row), `${fmt(row.createdAt)} 送出`].filter(Boolean).join('・') }}</span>
              </button>
              <div class="req-card__actions">
                <el-button v-if="canReturnRow(row)" @click="openAction(row, 'return')">退簽</el-button>
                <el-button type="danger" plain @click="openAction(row, 'reject')">否決</el-button>
                <el-button type="primary" @click="openAction(row, 'approve')">核可</el-button>
              </div>
            </article>
            <p v-if="!inboxRows.length && !inboxLoading" class="hr-empty">{{ inboxEmptyText }}</p>
          </div>

          <el-table
            v-else
            v-loading="inboxLoading"
            :data="inboxRows"
            class="approval-table"
            :empty-text="inboxEmptyText"
            :default-sort="{ prop: 'createdAt', order: 'ascending' }"
            @sort-change="onInboxSortChange"
          >
            <el-table-column label="表單" min-width="120">
              <template #default="{ row }">
                <span class="form-name">{{ formNameOf(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="申請人" min-width="140">
              <template #default="{ row }">
                <div class="applicant-info">
                  <EmployeeAvatar :employee="personOf(row.applicant_employee)" :size="32" class="applicant-avatar" />
                  <span>{{ row.applicant_employee?.name || '-' }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="內容" min-width="240">
              <template #default="{ row }">
                <span class="row-summary">{{ rowSummary(row) || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="關卡" width="110">
              <template #default="{ row }">{{ stepProgressText(row) || '-' }}</template>
            </el-table-column>
            <el-table-column prop="createdAt" label="送出時間" width="170" sortable="custom">
              <template #default="{ row }">
                <div>{{ fmt(row.createdAt) }}</div>
                <div class="row-sub">{{ formatAge(row.createdAt) }}</div>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="250" fixed="right">
              <template #default="{ row }">
                <div class="action-buttons">
                  <!-- 與手機卡片同一個順序：次要的在左、主要的「核可」在最右 -->
                  <el-button link type="primary" size="small" class="view-btn" @click="openDetail(row._id)">查看</el-button>
                  <el-button v-if="canReturnRow(row)" size="small" class="return-btn" @click="openAction(row, 'return')">退簽</el-button>
                  <el-button type="danger" plain size="small" class="reject-btn" @click="openAction(row, 'reject')">否決</el-button>
                  <el-button type="primary" size="small" class="approve-btn" @click="openAction(row, 'approve')">核可</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <el-pagination
            v-if="inboxTotal > PAGE_SIZE"
            :current-page="inboxPage.page"
            class="list-pagination"
            background
            :size="isMobile ? 'small' : 'default'"
            :pager-count="5"
            :layout="isMobile ? 'prev, pager, next' : 'total, prev, pager, next'"
            :page-size="PAGE_SIZE"
            :total="inboxTotal"
            @current-change="onInboxPageChange"
          />
        </section>
      </el-tab-pane>

      <!-- 3) 我已簽核（所有簽核人；伺服器只回傳自己簽過的單，管理員可看全部） -->
      <el-tab-pane name="history" label="我已簽核">
        <section class="list-section">
          <ApprovalListFilters
            v-model="historyFilter"
            :form-options="historyFormOptions"
            :status-options="REQUEST_STATUS_OPTIONS"
            show-keyword
            :loading="historyLoading"
            @refresh="fetchHistory()"
          />
          <el-alert
            v-if="historyError"
            type="error"
            :closable="false"
            class="mb-3"
            :title="historyError"
          />

          <div v-if="isMobile" v-loading="historyLoading" class="req-cards" data-test="history-cards">
            <article v-for="row in historyRows" :key="row._id" class="req-card" data-test="history-card">
              <button type="button" class="req-card__main" @click="openDetail(row._id)">
                <span class="req-card__head">
                  <span class="req-card__title">{{ formNameOf(row) }}</span>
                  <el-tag size="small" :type="historyTagType(row)">{{ historyDecisionText(row) }}</el-tag>
                </span>
                <span class="req-card__person applicant-info">
                  <EmployeeAvatar :employee="personOf(row.applicant_employee)" :size="32" class="applicant-avatar" />
                  <span>{{ row.applicant_employee?.name || '-' }}</span>
                </span>
                <span v-if="row.pending_approvers?.length" class="req-card__summary">等待：{{ row.pending_approvers.map(approverName).join('、') }}</span>
                <span v-if="historyComment(row)" class="req-card__summary">意見：{{ historyComment(row) }}</span>
                <span class="req-card__meta">{{ fmt(historyTimeOf(row)) }}</span>
              </button>
              <div v-if="canOverrideRow(row) || canCancelApprovedRow(row)" class="req-card__actions">
                <template v-if="canOverrideRow(row)">
                  <el-button plain @click="openAction(row, 'return', { override: true })">代為退簽</el-button>
                  <el-button type="danger" plain @click="openAction(row, 'reject', { override: true })">代為否決</el-button>
                  <el-button type="success" plain @click="openAction(row, 'approve', { override: true })">代為核可</el-button>
                </template>
                <el-button
                  v-if="canCancelApprovedRow(row)"
                  type="danger"
                  plain
                  :loading="myActionLoading[row._id]"
                  @click="cancelApprovedFromHistory(row)"
                >撤回</el-button>
              </div>
            </article>
            <p v-if="!historyRows.length && !historyLoading" class="hr-empty">{{ historyEmptyText }}</p>
          </div>

          <el-table
            v-else
            v-loading="historyLoading"
            :data="historyRows"
            class="approval-table"
            :empty-text="historyEmptyText"
          >
            <el-table-column label="表單" min-width="120">
              <template #default="{ row }">
                <span class="form-name">{{ formNameOf(row) }}</span>
              </template>
            </el-table-column>
            <el-table-column label="申請人" min-width="140">
              <template #default="{ row }">
                <div class="applicant-info">
                  <EmployeeAvatar :employee="personOf(row.applicant_employee)" :size="32" class="applicant-avatar" />
                  <span>{{ row.applicant_employee?.name || '-' }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column label="決策結果" min-width="170">
              <template #default="{ row }">
                <el-tag size="small" :type="historyTagType(row)">{{ historyDecisionText(row) }}</el-tag>
                <div v-if="row.pending_approvers?.length" class="history-waiting">
                  等待：{{ row.pending_approvers.map(approverName).join('、') }}
                </div>
              </template>
            </el-table-column>
            <el-table-column label="簽核時間" width="150">
              <template #default="{ row }">
                {{ fmt(historyTimeOf(row)) }}
              </template>
            </el-table-column>
            <el-table-column label="意見" min-width="160">
              <template #default="{ row }">
                <span>{{ historyComment(row) || '-' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" :width="authStore.role === 'admin' ? 330 : 90" fixed="right">
              <template #default="{ row }">
                <div class="action-buttons">
                  <el-button link type="primary" size="small" @click="openDetail(row._id)">查看</el-button>
                  <template v-if="canOverrideRow(row)">
                    <el-button size="small" plain @click="openAction(row, 'return', { override: true })">代為退簽</el-button>
                    <el-button size="small" type="danger" plain @click="openAction(row, 'reject', { override: true })">代為否決</el-button>
                    <el-button size="small" type="success" plain @click="openAction(row, 'approve', { override: true })">代為核可</el-button>
                  </template>
                  <el-button
                    v-if="canCancelApprovedRow(row)"
                    size="small"
                    type="danger"
                    plain
                    :loading="myActionLoading[row._id]"
                    @click="cancelApprovedFromHistory(row)"
                  >撤回</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <el-pagination
            v-if="historyTotal > PAGE_SIZE"
            :current-page="historyPage.page"
            class="list-pagination"
            background
            :size="isMobile ? 'small' : 'default'"
            :pager-count="5"
            :layout="isMobile ? 'prev, pager, next' : 'total, prev, pager, next'"
            :page-size="PAGE_SIZE"
            :total="historyTotal"
            @current-change="onHistoryPageChange"
          />
        </section>
      </el-tab-pane>

      <!-- 4) 我的申請 -->
      <el-tab-pane name="mine" label="我的申請">
        <section class="list-section">
          <ApprovalListFilters
            v-model="myFilter"
            :form-options="myFormOptions"
            :status-options="REQUEST_STATUS_OPTIONS"
            :loading="myLoading"
            @refresh="fetchMyList()"
          />
          <el-alert
            v-if="myError"
            type="error"
            :closable="false"
            class="mb-3"
            :title="myError"
          />

          <div v-if="isMobile" v-loading="myLoading" class="req-cards" data-test="mine-cards">
            <article v-for="row in myRows" :key="row._id" class="req-card" data-test="mine-card">
              <button type="button" class="req-card__main" @click="openDetail(row._id)">
                <span class="req-card__head">
                  <span class="req-card__title">{{ formNameOf(row) }}</span>
                  <el-tag size="small" :type="getStatusTagType(row.status)">{{ getStatusText(row.status) }}</el-tag>
                </span>
                <span v-if="rowSummary(row)" class="req-card__summary">{{ rowSummary(row) }}</span>
                <span v-if="myProgressText(row)" class="req-card__summary">{{ myProgressText(row) }}</span>
                <span class="req-card__meta">{{ fmt(row.createdAt) }} 送出</span>
              </button>
              <div v-if="row.status === 'returned' || canCancelMine(row)" class="req-card__actions req-card__actions--end">
                <el-button
                  v-if="canCancelMine(row)"
                  type="danger"
                  plain
                  :loading="myActionLoading[row._id]"
                  @click="cancelMyRequest(row)"
                >撤回</el-button>
                <el-button
                  v-if="row.status === 'returned'"
                  type="primary"
                  :loading="myActionLoading[row._id]"
                  @click="resubmitMyRequest(row)"
                >修改並重新送出</el-button>
              </div>
            </article>
            <div v-if="!myRows.length && !myLoading" class="hr-empty">
              <p>{{ myEmptyText }}</p>
              <el-button v-if="!myHasAny" type="primary" @click="goTab('apply')">填寫申請</el-button>
            </div>
          </div>

          <el-table
            v-else
            v-loading="myLoading"
            :data="myRows"
            class="approval-table"
            :empty-text="myEmptyText"
          >
            <el-table-column label="表單" min-width="120">
              <template #default="{ row }">{{ formNameOf(row) }}</template>
            </el-table-column>
            <el-table-column label="內容" min-width="240">
              <template #default="{ row }">
                <span class="row-summary">{{ rowSummary(row) || '—' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="狀態" width="100">
              <template #default="{ row }">
                <el-tag size="small" :type="getStatusTagType(row.status)">{{ getStatusText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="進度" min-width="170">
              <template #default="{ row }">{{ myProgressText(row) || '—' }}</template>
            </el-table-column>
            <el-table-column label="送出時間" width="150">
              <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="250" fixed="right">
              <template #default="{ row }">
                <div class="action-buttons">
                  <el-button link type="primary" size="small" @click="openDetail(row._id)">查看</el-button>
                  <el-button
                    v-if="row.status === 'returned'"
                    size="small"
                    type="primary"
                    :loading="myActionLoading[row._id]"
                    @click="resubmitMyRequest(row)"
                  >修改並重新送出</el-button>
                  <el-button
                    v-if="canCancelMine(row)"
                    size="small"
                    type="danger"
                    plain
                    :loading="myActionLoading[row._id]"
                    @click="cancelMyRequest(row)"
                  >撤回</el-button>
                </div>
              </template>
            </el-table-column>
          </el-table>

          <el-pagination
            v-if="myTotal > PAGE_SIZE"
            :current-page="myPage.page"
            class="list-pagination"
            background
            :size="isMobile ? 'small' : 'default'"
            :pager-count="5"
            :layout="isMobile ? 'prev, pager, next' : 'total, prev, pager, next'"
            :page-size="PAGE_SIZE"
            :total="myTotal"
            @current-change="onMyPageChange"
          />
        </section>
      </el-tab-pane>
    </el-tabs>

    <!-- 申請單明細：內容、流程（標出目前關卡）、下方直接簽核／撤回／重新送出 -->
    <el-dialog
      v-model="detail.visible"
      title="申請單明細"
      width="760px"
      :fullscreen="isMobile"
      class="approval-dialog"
    >
      <ApprovalDetailContent
        v-if="detail.doc"
        :doc="detail.doc"
        :person-resolver="personOf"
        :name-resolver="nameOfEmployee"
        :value-lookups="valueLookups"
        :download-handler="downloadApprovalAttachment"
      />
      <template #footer>
        <div class="dialog-actions">
          <el-button @click="detail.visible=false">關閉</el-button>
          <span class="hr-toolbar__spacer" />
          <!-- 申請人：被退簽的單修改後重新送出；進行中（或已核可的請假）可以撤回 -->
          <template v-if="detail.doc?.viewer?.is_applicant">
            <el-button
              v-if="canCancelMine(detail.doc)"
              type="danger"
              plain
              :loading="myActionLoading[detail.doc._id]"
              data-test="detail-cancel"
              @click="cancelFromDetail"
            >撤回</el-button>
            <el-button
              v-if="detail.doc.status === 'returned'"
              type="primary"
              data-test="detail-resubmit"
              @click="resubmitFromDetail"
            >修改並重新送出</el-button>
          </template>
          <!-- 這一關的簽核人：看完內容直接簽核 -->
          <template v-if="detail.doc?.viewer?.can_act">
            <el-button v-if="canReturnRow(detail.doc)" data-test="detail-return" @click="actFromDetail('return')">退簽</el-button>
            <el-button type="danger" plain data-test="detail-reject" @click="actFromDetail('reject')">否決</el-button>
            <el-button type="primary" data-test="detail-approve" @click="actFromDetail('approve')">核可</el-button>
          </template>
          <template v-else-if="detail.doc?.viewer?.can_override">
            <el-button type="success" plain @click="overrideFromDetail('approve')">代為核可</el-button>
            <el-button type="danger" plain @click="overrideFromDetail('reject')">代為否決</el-button>
            <el-button plain @click="overrideFromDetail('return')">代為退簽</el-button>
          </template>
        </div>
      </template>
    </el-dialog>

    <!-- 表單說明 Dialog -->
    <el-dialog v-model="helpDlg.visible" title="表單說明" width="600px" :fullscreen="isMobile" class="approval-dialog">
      <div v-if="helpDlg.forms.length" class="help-content">
        <p class="hr-hint help-lead">標示「連接薪資」的表單（請假、加班、獎金）核可後會影響假勤與薪資計算。</p>
        <div v-for="form in helpDlg.forms" :key="form._id" class="form-help-item">
          <div class="form-help-header">
            <h3 class="form-help-title">
              {{ form.name }}
              <el-tag v-if="isPayrollConnectedForm(form)" type="success" size="small" effect="plain">連接薪資</el-tag>
            </h3>
            <el-tag v-if="form.category" type="info" size="small" effect="plain">{{ form.category }}</el-tag>
          </div>
          <p class="form-help-description">
            {{ form.description || '暫無說明' }}
          </p>
        </div>
      </div>
      <el-empty v-else description="目前沒有可申請的表單" />
      <template #footer>
        <el-button @click="helpDlg.visible=false">關閉</el-button>
      </template>
    </el-dialog>

    <!-- 簽核動作：意見（退簽請寫原因），確認按鈕就是要做的動作 -->
    <el-dialog
      v-model="actionDlg.visible"
      :title="actionTitle"
      width="520px"
      :fullscreen="isMobile"
      class="approval-dialog"
      @closed="onActionClosed"
    >
      <p v-if="actionDlg.target" class="action-target" data-test="action-target">
        <b>{{ formNameOf(actionDlg.target) }}</b>
        <span v-if="actionDlg.target.applicant_employee?.name">・{{ actionDlg.target.applicant_employee.name }}</span>
        <span v-if="rowSummary(actionDlg.target)" class="action-target__summary">{{ rowSummary(actionDlg.target) }}</span>
      </p>
      <LeaveBalancePanel
        v-if="actionLeaveEmployeeId"
        :employee-id="actionLeaveEmployeeId"
        compact
        title="申請人假別餘額"
      />
      <el-alert
        v-if="actionDlg.override"
        type="warning"
        :closable="false"
        show-icon
        class="mb-3"
        title="您不是這一關的簽核人，系統會在單據上記錄為「管理員代為處理」"
      />
      <el-form label-position="top" @submit.prevent>
        <el-form-item label="意見／備註">
          <el-input
            v-model="actionDlg.comment"
            type="textarea"
            :rows="3"
            maxlength="1000"
            show-word-limit
            :placeholder="actionDlg.decision === 'return' ? '請說明退簽原因，申請人會看到這段說明' : '（可留空）'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <div class="dialog-actions">
          <el-button @click="actionDlg.visible=false">取消</el-button>
          <span class="hr-toolbar__spacer" />
          <el-button
            :type="actionDlg.decision === 'reject' ? 'danger' : 'primary'"
            :loading="actionDlg.loading"
            data-test="action-confirm"
            @click="doAction"
          >{{ actionTitle }}</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 被退簽的申請：修改內容後重新送出 -->
    <el-dialog
      v-model="editDlg.visible"
      title="修改並重新送出"
      width="760px"
      :fullscreen="isMobile"
      :close-on-click-modal="false"
      class="approval-dialog"
    >
      <div v-loading="editDlg.loading">
        <el-alert
          v-if="editDlg.returnInfo"
          type="warning"
          :closable="false"
          show-icon
          class="return-reason-alert mb-3"
        >
          <template #title>
            退簽原因：{{ editDlg.returnInfo.message || '簽核人未填寫原因' }}
          </template>
        </el-alert>
        <el-form
          v-if="editDlg.fields.length"
          :label-width="isMobile ? 'auto' : '120px'"
          :label-position="isMobile ? 'top' : 'right'"
          class="edit-form"
          @submit.prevent
        >
          <ApprovalFormFields
            v-model="editDlg.formData"
            v-model:files="editDlg.files"
            :fields="editDlg.fields"
            :errors="editDlg.fieldErrors"
            :leave-hours="editLeaveHoursConfig"
            :kept-attachments="editDlg.kept"
            :user-options="userOptions"
            :dept-options="deptOptions"
            :org-options="orgOptions"
          >
            <template #field-extra="{ field }">
              <LeaveRequestHint
                v-if="editLeaveContext && field._id === editLeaveFieldIds.hours"
                :items="ownBalanceItems"
                :type-text="editLeaveContext.typeText"
                :hours="editLeaveContext.hours"
                :end-date="editLeaveContext.endValue"
              />
            </template>
          </ApprovalFormFields>
        </el-form>
        <div v-if="editDlg.error" class="error-message">
          <div>
            <div>{{ editDlg.error }}</div>
            <ul v-if="editDlg.errorLines.length" class="error-lines">
              <li v-for="(line, i) in editDlg.errorLines" :key="i">{{ line }}</li>
            </ul>
          </div>
        </div>
      </div>
      <template #footer>
        <div class="dialog-actions">
          <el-button @click="closeEditDialog">取消</el-button>
          <span class="hr-toolbar__spacer" />
          <el-button
            type="primary"
            :loading="editDlg.saving"
            :disabled="editDlg.loading || !editDlg.fields.length"
            @click="submitResubmit"
          >重新送出</el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 伺服器檢核結果（一條一行） -->
    <el-dialog v-model="errorDlg.visible" :title="errorDlg.title" width="520px" class="approval-dialog">
      <p class="error-dialog-message">{{ errorDlg.message }}</p>
      <ul class="error-lines">
        <li v-for="(line, i) in errorDlg.lines" :key="i">{{ line }}</li>
      </ul>
      <template #footer>
        <el-button type="primary" @click="errorDlg.visible=false">知道了</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch, nextTick } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { apiFetch } from '../../api'
import { useAuthStore } from '../../stores/auth'
import PageHeader from '../../components/PageHeader.vue'
import ApprovalFormFields from '../../components/ApprovalFormFields.vue'
import ApprovalListFilters from '../../components/ApprovalListFilters.vue'
import LeaveBalancePanel from '../../components/LeaveBalancePanel.vue'
import LeaveRequestHint from '../../components/LeaveRequestHint.vue'
import CompensatoryLeavePanel from '../../components/CompensatoryLeavePanel.vue'
import EmployeeAvatar from '../../components/EmployeeAvatar.vue'
import ApprovalDetailContent from './ApprovalDetailContent.vue'
import { formatTaipeiDateTime, normalizeFieldOptions, personNameOrFallback } from '../../utils/approvalDisplay'
import { describeError, readApiError, ApprovalApiError, ANNUAL_LEAVE_INSUFFICIENT } from '../../utils/approvalErrors'
import { confirmAction, notifyFailure, notifySuccess } from '../../utils/approvalNotify'
import {
  attachmentItems,
  downloadApprovalAttachment as downloadAttachmentFile,
  findReturnInfo,
  getStatusText,
  getStatusTagType,
  describeChainPreview,
  describeStepConditionPreview,
  describeRepeatPreview,
} from '../../utils/approvalDetail'
import {
  isActiveField,
  isActiveForm,
  buildInitialFormData,
  prefillFormData,
  collectMissingRequiredFields,
  describeWorkflowApprovers,
  describeUnresolvedStep,
  describeFallbackStep,
  findLeaveFormId,
  isLeaveForm,
  isPayrollConnectedForm,
} from '../../utils/approvalForm'
import {
  PAGE_SIZE,
  listQueryString,
  readListPayload,
  pickDefaultTab,
  requestFormId,
  mergeFormOptions,
  hasActiveFilter,
  filterRequests,
  sortByTime,
  pageSlice,
  formatAge,
  stepProgressText,
  summarizeRequest,
  summaryText,
} from '../../utils/approvalList'
import { describeBalanceBrief, pickBriefItems } from '../../utils/leaveBalance'
import { pickLeaveFormFields } from '../../utils/leaveHours'
import { useLeaveHoursAutofill } from '../../utils/useLeaveHoursAutofill'
import { useIsMobile } from '../../utils/useIsMobile'

/* -------------------- Tabs -------------------- */
// 載入時先停在「待我簽核」，第一次的清單回來後依實際情況改選（有待簽的單 > 有被退簽的單 > 申請表單，見 pickDefaultTab）；
// 使用者在載入中已經自己點了分頁就不再改
const activeTab = ref('inbox')
const initializing = ref(true)
const tabChosen = ref(false)
const authStore = useAuthStore()
const isMobile = useIsMobile()
// 程式自己切換分頁（預設分頁）時，不必再重新載入那個分頁的資料
let skipNextTabLoad = false
function goTab(tab) {
  tabChosen.value = true
  activeTab.value = tab
}

/* -------------------- 共用小工具 -------------------- */
const fmt = (d) => formatTaipeiDateTime(d)

/* 人名快取（顯示審核人用） */
const employeeNameCache = reactive({})
// 員工 _id -> 照片路徑（員工選項 / 簽核人資料帶回來的），審核人只有編號時也能顯示頭像
const employeePhotoCache = reactive({})
const myActionLoading = reactive({})
const nameOfEmployee = (id) => employeeNameCache[id] || ''

// 明細裡的員工 / 部門 / 機構欄位存的是編號，顯示時換成名稱
const optionLabel = (options, id) => options.value.find(o => String(o.value) === String(id))?.label
const valueLookups = {
  user: (id) => employeeNameCache[id],
  department: (id) => optionLabel(deptOptions, id),
  org: (id) => optionLabel(orgOptions, id),
}

// 申請人 / 審核人可能是已展開的員工物件（含 _id、name、photo），也可能只是編號字串；頭像元件只接受物件
function personOf(value, fallbackName = '') {
  if (value && typeof value === 'object') {
    const id = String(value._id || value.id || '')
    // 伺服器沒帶照片欄位時，用員工選項快取補上
    if (value.photo === undefined && id && employeePhotoCache[id]) return { ...value, photo: employeePhotoCache[id] }
    return value
  }
  const id = value ? String(value) : ''
  return { _id: id, name: fallbackName || employeeNameCache[id] || '', photo: employeePhotoCache[id] }
}

function rememberEmployee(person) {
  const id = String(person?._id || person?.id || '')
  if (!id) return
  if (person.name) employeeNameCache[id] = person.name
  if (person.photo) employeePhotoCache[id] = person.photo
}

function approverName(emp) {
  if (emp && typeof emp === 'object') {
    const id = emp._id || emp.employeeId || ''
    return personNameOrFallback(emp.name || employeeNameCache[id], id)
  }
  return personNameOrFallback(employeeNameCache[emp], emp)
}

/* 伺服器的錯誤：有逐條檢核結果（violations）就開對話框一條一行列出，否則跳出簡短提示 */
const errorDlg = reactive({ visible: false, title: '', message: '', lines: [] })
function showFailure(title, info) {
  if (info.lines?.length) {
    errorDlg.title = title
    errorDlg.message = info.message
    errorDlg.lines = info.lines
    errorDlg.visible = true
    return
  }
  notifyFailure(title, info.message)
}
// 單子已被處理 / 已不存在：畫面上的資料已過期，需要重新整理
// （特休餘額不足的 409 不是過期：單據還在簽核中，只是現在不能核准）
const isStaleStatus = (info) => info.status === 404 || (info.status === 409 && info.code !== ANNUAL_LEAVE_INSUFFICIENT)

/* -------------------- 申請表單（動態產生） -------------------- */
const formTemplates = ref([])
const applyState = reactive({
  formId: '',
  formData: {},
})
const createSubmissionKey = () => (
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
)
let approvalSubmissionKey = createSubmissionKey()
// 快速請假：依固定代號 / 表單性質找請假單，表單改名後不會失效（名稱只是最後的備援）
const leaveFormId = computed(() => findLeaveFormId(formTemplates.value))
function selectLeave() {
  if (leaveFormId.value) {
    applyState.formId = leaveFormId.value
    onSelectForm(leaveFormId.value)
  }
}
const fieldList = ref([])

/* -------------------- 請假：自己的假別餘額、時數自動帶入與超額提示 -------------------- */
// 自己的餘額（申請頁的餘額表載入後放在這裡）：請假單填寫時用它即時提示「還剩多少、會不會超額」
const ownBalances = ref(null)
const applyBalancePanel = ref(null)
const applyCompPanel = ref(null)
const ownBalanceItems = computed(() => (Array.isArray(ownBalances.value?.items) ? ownBalances.value.items : []))
function onOwnBalancesLoaded(balances) {
  ownBalances.value = balances && typeof balances === 'object' ? balances : null
}
async function refreshOwnBalances() {
  try {
    // 調休存摺跟著重新整理：送出、撤回調休單後簽核中與可用時數會變
    await Promise.all([applyBalancePanel.value?.load?.(), applyCompPanel.value?.load?.()])
  } catch {
    // 餘額只是參考資訊，重新整理失敗不影響申請
  }
}

// 假別欄位的值轉成名稱（下拉選項存的可能是代號，要換成顯示名稱才對得到假別規則）
function leaveTypeText(typeField, value) {
  const raw = value && typeof value === 'object' ? (value.label ?? value.name ?? value.value) : value
  if (raw === undefined || raw === null || raw === '') return ''
  const option = normalizeFieldOptions(typeField).find(opt => String(opt.value) === String(raw))
  return String(option?.label ?? raw)
}
function leaveContextOf(fields, data) {
  const { typeField, hoursField, endField } = pickLeaveFormFields(fields)
  if (!typeField || !hoursField) return null
  return {
    typeText: leaveTypeText(typeField, data?.[typeField._id]),
    hours: data?.[hoursField._id],
    // 請假結束日：提醒請假期間的年度公司行事曆是否尚未核定
    endValue: endField ? data?.[endField._id] : null,
  }
}
const leaveHoursPolicy = () => ({
  maxHoursPerDay: Number(ownBalances.value?.maxHoursPerDay) > 0 ? Number(ownBalances.value.maxHoursPerDay) : 8,
  minUnitHours: Number(ownBalances.value?.minUnitHours) > 0 ? Number(ownBalances.value.minUnitHours) : 0.5,
})

// 向伺服器取依班表算出的請假時數（排 12 小時班的日子算 12 小時、休息日算 0）；取不到就維持本機依日曆日的估算
async function fetchLeaveHoursHint(startValue, endValue, { startType, endType } = {}) {
  const toText = (value) => (value instanceof Date ? value.toISOString() : String(value ?? ''))
  const query = new URLSearchParams({ start: toText(startValue), end: toText(endValue) })
  if (startType) query.set('startType', startType)
  if (endType) query.set('endType', endType)
  const res = await apiFetch(`/api/approvals/leave-hours-hint?${query.toString()}`)
  if (!res.ok) return null
  const body = await res.json()
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null
}

// 時數自動帶入、每日上限的說明、剩餘時數提示只用在「請假表單」（表單性質為請假）：
// 客戶自建的加班／補休表單即使有「時數」欄位，也維持一般的數字欄位（加班一天可以超過 8 小時，也不會被自動帶入蓋掉）
const applyIsLeaveForm = computed(() => isLeaveForm(formTemplates.value.find(t => t._id === applyState.formId)))
const applyLeaveFields = computed(() => (applyIsLeaveForm.value ? fieldList.value : []))
const applyAutofill = useLeaveHoursAutofill({
  fields: applyLeaveFields,
  getFormData: () => applyState.formData,
  setValue: (fieldId, value) => { applyState.formData = { ...applyState.formData, [fieldId]: value } },
  getPolicy: leaveHoursPolicy,
  fetchHint: fetchLeaveHoursHint,
})
const applyLeaveHoursConfig = computed(() => ({ enabled: applyIsLeaveForm.value, max: applyAutofill.maxHours.value, ...leaveHoursPolicy() }))
const applyLeaveContext = computed(() => (applyIsLeaveForm.value ? leaveContextOf(fieldList.value, applyState.formData) : null))

// 請假單的假別、時數欄位編號：餘額摘要放在假別下方、超額提示放在時數下方
function leaveFieldIdsOf(fields) {
  const { typeField, hoursField } = pickLeaveFormFields(fields)
  return { type: typeField?._id || '', hours: hoursField?._id || '' }
}
const applyLeaveFieldIds = computed(() => (applyIsLeaveForm.value ? leaveFieldIdsOf(fieldList.value) : { type: '', hours: '' }))
// 假別下方的一句話餘額：選了假別就是那個假別，還沒選時列特休與調休；完整的餘額表收合在表單下面
const applyLeaveBrief = computed(() => {
  if (!applyIsLeaveForm.value || !applyLeaveFieldIds.value.type) return []
  return pickBriefItems(ownBalanceItems.value, applyLeaveContext.value?.typeText || '')
    .map(describeBalanceBrief)
    .filter(Boolean)
})
const balanceSection = ref(null)
// 「全部餘額」：展開表單下面的餘額表並捲過去
async function showAllBalances() {
  applyBalancePanel.value?.expand?.()
  applyCompPanel.value?.expand?.()
  await nextTick()
  balanceSection.value?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
}

const workflowSteps = ref([])
const workflowWarning = ref('')
// 部門的「使用簽核表單」：表單清單有依部門篩選（伺服器回應標頭 X-Form-Visibility 是 department）
const formsRestricted = ref(false)
// 選好的表單不在清單裡了（管理員停用、部門不再開放）時的提示
const formGoneNotice = ref('')
const fileBuffers = ref({}) // { fieldId: [FileItem...] }
const submitting = ref(false)
// 送出時正在上傳附件的進度文字（顯示在送出按鈕上）
const uploadProgress = ref('')
const applyError = ref('')
const applyErrorLines = ref([])
// 欄位下方的錯誤（必填沒填）：{ [欄位編號]: 訊息 }
const applyFieldErrors = ref({})
const templatesError = ref('')
// 表單欄位載入中／已載入（沒有任何欄位的表單也能送出）
const fieldsLoading = ref(false)
const fieldsLoaded = ref(false)

/* options 資料 */
const userOptions = ref([])
const deptOptions = ref([])
const orgOptions = ref([])
const signRoleOptions = ref([])
const signLevelOptions = ref([])

async function fetchUsersLite() {
  try {
    const res = await apiFetch('/api/employees/options')
    if (res.ok) {
      const arr = await res.json()
      userOptions.value = arr.map(e => {
        const id = e.id || e._id
        return { value: id, label: `${e.name}${e.username ? ' ('+e.username+')' : ''}`, name: e.name, photo: e.photo || '' }
      })
      arr.forEach(rememberEmployee)
    }
  } catch {
    // 員工選項載入失敗不阻擋申請；選員工的欄位會是空的
  }
}
async function fetchDepts() {
  try {
    const res = await apiFetch('/api/departments')
    if (res.ok) {
      const arr = await res.json()
      deptOptions.value = arr.map(d => ({ value: d._id || d.code || d.name, label: d.name }))
    }
  } catch {
    // 部門選項載入失敗不阻擋申請
  }
}
async function fetchOrgs() {
  try {
    const res = await apiFetch('/api/organizations')
    if (res.ok) {
      const arr = await res.json()
      orgOptions.value = arr.map(o => ({ value: o._id || o.code || o.name, label: o.name }))
    }
  } catch {
    // 機構選項載入失敗不阻擋申請
  }
}

// 同時有好幾次載入（剛進頁面又馬上切分頁）時，只採用最後一次的結果，較慢回來的舊回應不會蓋掉新的清單
let templatesSeq = 0
async function loadFormTemplates({ goneReason = '' } = {}) {
  const seq = ++templatesSeq
  templatesError.value = ''
  try {
    // 停用的表單不提供申請（伺服器端也會過濾；這裡再擋一次以防舊資料）
    const res = await apiFetch('/api/approvals/forms?is_active=true')
    if (seq !== templatesSeq) return
    if (!res.ok) throw await readApiError(res)
    const list = await res.json()
    if (seq !== templatesSeq) return
    const previous = formTemplates.value.find(t => t._id === applyState.formId)
    formTemplates.value = (Array.isArray(list) ? list : []).filter(isActiveForm)
    formsRestricted.value = res.headers?.get?.('X-Form-Visibility') === 'department'
    // 原本選的表單不在清單裡了（管理員停用，或部門不再開放）：不管是切回申請頁、按重新載入還是送出被擋，
    // 都清掉選擇並說明原因，不留下一張送不出去的表單
    if (previous && !formTemplates.value.some(t => t._id === previous._id)) {
      resetApplyForm()
      noticeFormGone(previous, goneReason)
    }
  } catch (error) {
    if (seq !== templatesSeq) return
    templatesError.value = describeError(error).message
  }
}

// 重新載入清單後，原本選的表單已經不在了：清掉選擇並說明原因（reason 是伺服器的訊息，沒有就用通用說明）
function noticeFormGone(previous, reason = '') {
  const name = previous?.name ? `「${previous.name}」` : '您選的表單'
  formGoneNotice.value = reason || `${name}已不在可申請的表單中（可能已停用，或您所屬的部門未開放使用），請改選其他表單`
}

// 送出時伺服器回「部門未開放這張表單」（403 FORM_NOT_ALLOWED）：重新取清單，表單不見了就清掉選擇
async function handleFormNotAllowed(message) {
  const formId = applyState.formId
  await loadFormTemplates({ goneReason: message })
  // 清單裡本來就沒有這張表單：一樣清掉選擇並顯示伺服器的說明
  if (formId && applyState.formId === formId && !formTemplates.value.some(t => t._id === formId)) {
    resetApplyForm()
    noticeFormGone(undefined, message)
  }
}

async function ensureEmployeeCache(ids) {
  const arr = (Array.isArray(ids) ? ids : [ids]).filter(Boolean)
  const missing = arr.filter(id => !employeeNameCache[id])
  if (!missing.length) return
  try {
    const res = await apiFetch('/api/employees/options')
    if (res.ok) {
      const emps = await res.json()
      emps.forEach(rememberEmployee)
    }
  } catch {
    // 查不到名稱時預覽改顯示通用文字
  }
}

// 簽核角色 / 層級的中文名稱（只有流程用到角色或層級時才載入）
async function ensureSignOptions(steps) {
  const load = async (path, target) => {
    if (target.value.length) return
    try {
      const res = await apiFetch(path)
      if (res.ok) {
        const arr = await res.json()
        target.value = Array.isArray(arr) ? arr : []
      }
    } catch {
      // 載入失敗時預覽直接顯示代碼
    }
  }
  const isCode = (step, prefix) => [].concat(step.approver_value ?? []).some(v => new RegExp(`^${prefix}\\d+$`).test(String(v)))
  const jobs = []
  if (steps.some(s => s.approver_type === 'role' && isCode(s, 'R'))) jobs.push(load('/api/approvals/sign-roles', signRoleOptions))
  if (steps.some(s => s.approver_type === 'level' && isCode(s, 'U'))) jobs.push(load('/api/approvals/sign-levels', signLevelOptions))
  await Promise.all(jobs)
}

const previewLookups = {
  user: (id) => employeeNameCache[id],
  department: (id) => optionLabel(deptOptions, id),
  org: (id) => optionLabel(orgOptions, id),
  // 伺服器回的選項是 { value, label, description }；舊寫法的 id 也容許
  signRole: (code) => signRoleOptions.value.find(o => (o.value ?? o.id) === code)?.label,
  signLevel: (code) => {
    const hit = signLevelOptions.value.find(o => (o.value ?? o.id) === code)
    return hit ? `${hit.label}${hit.description ? `（${hit.description}）` : ''}` : ''
  },
}

// 上傳過的附件先記下來，送出失敗後重試不要重複上傳（避免伺服器留下孤兒檔案）
const uploadCache = new Map() // fieldId -> { signature, files }
const editUploadCache = new Map() // 修改並重新送出對話框用

// 送出按鈕旁的錯誤是不是「必填欄位沒填」（是的話，欄位補上後訊息跟著更新）
let applyErrorIsMissingField = false
function resetApplyMessages() {
  applyError.value = ''
  applyErrorLines.value = []
  applyFieldErrors.value = {}
  applyErrorIsMissingField = false
}

let selectSeq = 0
async function onSelectForm() {
  const seq = ++selectSeq
  fieldList.value = []
  applyState.formData = {}
  fileBuffers.value = {}
  workflowSteps.value = []
  workflowWarning.value = ''
  uploadCache.clear()
  resetApplyMessages()
  // 換表單等於另一次送出，不要沿用上一張的 Idempotency-Key
  approvalSubmissionKey = createSubmissionKey()
  fieldsLoaded.value = false
  fieldsLoading.value = false
  if (!applyState.formId) return
  formGoneNotice.value = ''
  const formId = applyState.formId

  fieldsLoading.value = true
  try {
    const res = await apiFetch(`/api/approvals/forms/${formId}/fields`)
    if (seq !== selectSeq) return
    if (!res.ok) throw await readApiError(res)
    const arr = await res.json()
    if (seq !== selectSeq) return
    // 停用的欄位不顯示也不檢核
    fieldList.value = (Array.isArray(arr) ? arr : [])
      .filter(isActiveField)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
    // 初始化表單資料（數字留空、單一勾選為 false，必填檢核才有意義）
    applyState.formData = buildInitialFormData(fieldList.value)
    fieldsLoaded.value = true
    // 清單上的內容摘要也用得到這張表單的欄位
    formFieldsCache[formId] = fieldList.value
  } catch (error) {
    if (seq !== selectSeq) return
    applyError.value = `載入表單欄位失敗：${describeError(error).message}`
  } finally {
    if (seq === selectSeq) fieldsLoading.value = false
  }

  try {
    const wfRes = await apiFetch(`/api/approvals/forms/${formId}/workflow`)
    if (seq !== selectSeq) return
    if (wfRes.ok) {
      const wf = await wfRes.json()
      const steps = Array.isArray(wf?.steps) ? wf.steps : []
      if (!steps.length) {
        workflowWarning.value = '此表單尚未設定簽核流程，暫時無法送出，請聯絡管理員'
      }
      const userIds = steps
        .filter(s => s.approver_type === 'user' || s.approver_type === 'manager')
        .flatMap(s => [].concat(s.approver_value ?? []))
        .filter(id => id && id !== 'APPLICANT_SUPERVISOR')
      await Promise.all([ensureEmployeeCache(userIds), ensureSignOptions(steps)])
      if (seq !== selectSeq) return
      // 伺服器替每一關帶 resolved_count / unresolved_reason：必簽的關卡找不到人，先提醒原因，不必等填完送出才知道
      workflowSteps.value = steps.map((s, idx) => {
        // 主管關卡找不到主管時改由最高層簽核人：送出前就讓申請人知道這關會送給誰
        const fallback = describeFallbackStep(s)
        // 主管鏈列出會簽的級數；有請假長度條件的關卡說明「請假滿 N 小時（或 N 日）才需要」；重複的簽核人會被略過
        const condition = describeStepConditionPreview(s)
        const repeat = describeRepeatPreview(s)
        return {
          label: s.name || `第 ${idx + 1} 關`,
          approvers: s.approver_type === 'manager_chain' ? describeChainPreview(s) : describeWorkflowApprovers(s, previewLookups),
          // 整關會因為簽核人都已在前面簽過而略過：不是「找不到人」
          warning: s.skipped_as_repeat ? '' : describeUnresolvedStep(s),
          ...(fallback ? { fallback } : {}),
          ...(condition ? { condition } : {}),
          ...(repeat ? { repeat } : {}),
        }
      })
    } else if (wfRes.status === 404) {
      workflowWarning.value = '此表單尚未設定簽核流程，暫時無法送出，請聯絡管理員'
    }
  } catch {
    // 流程預覽只是參考資訊，載入失敗不影響填寫
  }
}

// 目前填寫的內容是否和剛載入時不同（用來決定重新載入前要不要先確認）
function hasTypedInput() {
  if (hasUnsentFiles.value) return true
  const initial = buildInitialFormData(fieldList.value)
  return fieldList.value.some(f => (
    JSON.stringify(applyState.formData[f._id] ?? null) !== JSON.stringify(initial[f._id] ?? null)
  ))
}

async function reloadSelectedForm() {
  if (!applyState.formId) return
  if (hasTypedInput() && !(await confirmAction('重新載入會清除目前已填寫的內容，確定要重新載入嗎？', { confirmText: '重新載入' }))) return
  // 同時更新表單清單，管理員新增 / 停用的表單不必重新整理整頁；選的表單不見了，loadFormTemplates 會清掉選擇並說明原因
  await loadFormTemplates()
  await onSelectForm()
}

// 送出成功後把申請表單整個清空，避免再按一次送出就重複建立
function resetApplyForm() {
  selectSeq += 1
  applyState.formId = ''
  applyState.formData = {}
  fieldList.value = []
  fieldsLoaded.value = false
  fieldsLoading.value = false
  workflowSteps.value = []
  workflowWarning.value = ''
  fileBuffers.value = {}
  uploadCache.clear()
  resetApplyMessages()
  approvalSubmissionKey = createSubmissionKey()
}

const fileSignature = (rawFiles) => rawFiles
  .map(file => `${file.name}|${file.size}|${file.lastModified}`)
  .join('||')

/* 附件在送出時才上傳；同一批檔案上傳過就直接沿用結果 */
async function uploadFieldFiles(fieldId, files, cache = uploadCache) {
  const rawFiles = (files || [])
    .map(file => file?.raw || file)
    .filter(file => file instanceof File)
  if (!rawFiles.length) return []
  const signature = fileSignature(rawFiles)
  const cached = cache.get(fieldId)
  if (cached?.signature === signature) return cached.files

  const uploadBody = new FormData()
  rawFiles.forEach(file => uploadBody.append('files', file))
  const uploadRes = await apiFetch('/api/approvals/attachments', {
    method: 'POST',
    body: uploadBody
  })
  if (!uploadRes.ok) {
    const apiError = await readApiError(uploadRes)
    throw new ApprovalApiError({
      message: `附件上傳失敗：${apiError.message}`,
      lines: apiError.lines,
      code: apiError.code,
      status: apiError.status,
    })
  }
  const uploadResult = await uploadRes.json().catch(() => ({}))
  const uploaded = uploadResult.files || []
  cache.set(fieldId, { signature, files: uploaded })
  return uploaded
}

async function submitApply() {
  if (submitting.value) return
  if (!applyState.formId) {
    notifyFailure('', '請先選擇申請表單')
    return
  }
  submitting.value = true
  resetApplyMessages()
  let missingFieldFailure = false
  try {
    // 先在本機檢查必填（每個沒填的欄位下方都標出來，並捲到第一個），通過了才上傳附件
    const missing = collectMissingRequiredFields(fieldList.value, applyState.formData, fileBuffers.value)
    const firstMissing = fieldList.value.find(field => missing[field._id])
    if (firstMissing) {
      applyFieldErrors.value = missing
      missingFieldFailure = true
      scrollToFirstFieldError('.apply-form')
      throw new Error(`請填寫必填欄位：${firstMissing.label}`)
    }

    const payloadData = { ...applyState.formData }
    const fileFieldIds = Object.keys(fileBuffers.value).filter(fid => Array.isArray(fileBuffers.value[fid]) && fileBuffers.value[fid].length)
    for (const fid of Object.keys(fileBuffers.value)) {
      const files = fileBuffers.value[fid] || []
      if (Array.isArray(files) && files.length) {
        uploadProgress.value = fileFieldIds.length > 1
          ? `上傳附件中（${fileFieldIds.indexOf(fid) + 1}/${fileFieldIds.length}）…`
          : '上傳附件中…'
        payloadData[fid] = await uploadFieldFiles(fid, files)
      } else {
        payloadData[fid] = []
      }
    }
    uploadProgress.value = ''

    const res = await apiFetch('/api/approvals', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': approvalSubmissionKey,
      },
      body: JSON.stringify({
        form_id: applyState.formId,
        form_data: payloadData
      })
    })
    if (!res.ok) throw await readApiError(res)
    const result = await res.json().catch(() => ({}))

    resetApplyForm()
    // 事假、病假等超過額度但設定為「警告」時，單照常送出，伺服器會附上提醒
    notifySuccess('送出申請成功！', warningLines(result))
    refreshOwnBalances()
    // 回到「我的申請」看剛送出的單（切換分頁會重新載入清單；篩選留著可能看不到新的單，所以清掉）
    resetMyFilter()
    goTab('mine')
  } catch (error) {
    const info = describeError(error, '送出失敗，請稍後再試')
    applyError.value = info.message
    applyErrorLines.value = info.lines
    applyErrorIsMissingField = missingFieldFailure
    showFailure(info.code === ANNUAL_LEAVE_INSUFFICIENT ? '特休餘額不足' : '送出失敗', info)
    // 部門已不開放這張表單（例如管理員剛改了部門設定）：更新清單，表單不見了就說明原因
    if (info.code === 'FORM_NOT_ALLOWED') await handleFormNotAllowed(info.message)
  } finally {
    submitting.value = false
    uploadProgress.value = ''
  }
}

// 捲到第一個有錯誤的欄位（欄位旁的錯誤訊息在下一次畫面更新後才出現）
function scrollToFirstFieldError(scope) {
  nextTick(() => {
    if (typeof document === 'undefined') return
    document.querySelector(`.approval-page ${scope} .el-form-item.is-error`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  })
}

// 必填欄位補上之後，欄位下方的錯誤跟著消失（只重新檢查目前標著錯誤的欄位）
function stillMissing(errors, fields, data, files, kept = {}) {
  if (!Object.keys(errors).length) return errors
  const missing = collectMissingRequiredFields(fields, data, files, kept)
  const next = {}
  for (const id of Object.keys(errors)) if (missing[id]) next[id] = errors[id]
  return Object.keys(next).length === Object.keys(errors).length ? errors : next
}
watch([() => applyState.formData, fileBuffers], () => {
  const next = stillMissing(applyFieldErrors.value, fieldList.value, applyState.formData, fileBuffers.value)
  if (next === applyFieldErrors.value) return
  applyFieldErrors.value = next
  // 送出按鈕旁的「請填寫必填欄位：…」跟著更新：補上了就換成下一個還沒填的，都填了就消失
  if (applyErrorIsMissingField) {
    const first = fieldList.value.find(field => next[field._id])
    applyError.value = first ? `請填寫必填欄位：${first.label}` : ''
    applyErrorIsMissingField = Boolean(first)
  }
}, { deep: true })

/* 申請表單填到一半（有填內容，或選好卻還沒送出的附件）：離開頁面前提醒 */
const hasUnsentFiles = computed(() => (
  Object.values(fileBuffers.value || {}).some(list => Array.isArray(list) && list.length > 0)
))
const hasUnsentApplication = () => Boolean(applyState.formId) && hasTypedInput()
function onBeforeUnload(event) {
  if (!hasUnsentFiles.value && !hasUnsentApplication()) return undefined
  event.preventDefault()
  event.returnValue = ''
  return ''
}
// 路由守衛要馬上回答能不能離開，這裡用瀏覽器原生的確認框
onBeforeRouteLeave(() => {
  if (hasUnsentFiles.value) return window.confirm('您選擇的附件還沒有送出，離開後會被清除，確定要離開嗎？')
  if (hasUnsentApplication()) return window.confirm('申請表單填到一半還沒有送出，離開後內容不會保留，確定要離開嗎？')
  return true
})

/* -------------------- 三份清單共用：載入、篩選、分頁、內容摘要 -------------------- */
// 篩選（狀態、表單、送出日期、申請人）、排序、分頁都交給伺服器（docs/approval-list-api.md），一次只取畫面上的這一頁。
// 以前一次取回 200 筆在前端篩選，超過時要按「載入更多」，而且篩選只套用在已載入的部分。
// 伺服器回純陣列（舊版、沒有分頁）時才退回在前端篩選、排序、分頁。
// page：畫面上的頁碼；total：符合篩選的總筆數（伺服器算的）；paged：伺服器回的是分頁格式
const newPageState = () => reactive({ page: 1, total: 0, paged: false })
const newFilter = () => ({ formId: '', status: '', keyword: '', from: '', to: '' })
const REQUEST_STATUS_OPTIONS = ['pending', 'approved', 'rejected', 'returned', 'canceled']
  .map(value => ({ value, label: getStatusText(value) }))

/**
 * 取清單目前這一頁（帶上篩選與排序）。
 * 每份清單各有一個序號：同一份清單同時有好幾個請求（剛簽完重新整理、又切了分頁、又改了篩選）時只採用最後發出的那一個，
 * 較慢回來的舊回應不會把清單蓋回舊的內容。回傳 null 代表這次的結果已經過期。
 */
function createListLoader(path, { pageState, loading, filter, sort = () => '' }) {
  let seq = 0
  async function load() {
    const mine = ++seq
    loading.value = true
    try {
      const query = listQueryString({ page: pageState.page, limit: PAGE_SIZE, filter: filter.value, sort: sort() })
      const res = await apiFetch(`${path}?${query}`)
      if (mine !== seq) return null
      if (!res.ok) throw await readApiError(res)
      const parsed = readListPayload(await res.json(), pageState.page)
      if (mine !== seq) return null
      pageState.total = parsed.total
      pageState.paged = parsed.paged
      if (parsed.paged) {
        // 這一頁已經沒有資料（例如剛簽完最後一頁的最後一筆）：改取最後一頁，不停在空白的那一頁
        const lastPage = Math.max(1, Math.ceil(parsed.total / PAGE_SIZE))
        if (!parsed.items.length && pageState.page > lastPage) {
          pageState.page = lastPage
          return load()
        }
        pageState.page = parsed.page
      }
      return parsed.items
    } finally {
      if (mine === seq) loading.value = false
    }
  }
  return load
}

// 同一輪裡的多次呼叫（例如切到「我的申請」又同時清掉篩選）只送一個請求；回傳的 promise 在載入完成後才結束
function coalesce(fn) {
  let pending = null
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(() => {
        pending = null
        return fn()
      })
    }
    return pending
  }
}

// 只有一份清單的數量（例如待我簽核的總件數）：取 1 筆、讀總數；讀不到回傳 null
async function fetchListTotal(path, filter = {}) {
  try {
    const res = await apiFetch(`${path}?${listQueryString({ page: 1, limit: 1, filter })}`)
    if (!res.ok) return null
    const parsed = readListPayload(await res.json(), 1)
    return parsed.paged ? parsed.total : null
  } catch {
    return null
  }
}

// 篩選條件改了就回到第 1 頁重新查詢；只改關鍵字時等打完字（300ms）再查，不是每打一個字送一次
const KEYWORD_DEBOUNCE_MS = 300
const filterTimers = new Set()
function reloadOnFilterChange(filter, pageState, reload, { enabled = () => true } = {}) {
  let timer = null
  watch(filter, (next, prev) => {
    const changed = ['formId', 'status', 'keyword', 'from', 'to'].filter(key => (next?.[key] || '') !== (prev?.[key] || ''))
    if (!changed.length) return
    pageState.page = 1
    clearTimeout(timer)
    filterTimers.delete(timer)
    if (!enabled()) return
    if (changed.length === 1 && changed[0] === 'keyword') {
      timer = setTimeout(() => {
        filterTimers.delete(timer)
        reload()
      }, KEYWORD_DEBOUNCE_MS)
      filterTimers.add(timer)
    } else {
      reload()
    }
  })
}

// 舊版伺服器（回純陣列）：在前端篩選後，頁碼超出範圍就回到最後一頁
function clampPage(pageState, filtered) {
  watch(() => filtered.value.length, (length) => {
    if (pageState.paged) return
    const lastPage = Math.max(1, Math.ceil(length / PAGE_SIZE))
    if (pageState.page > lastPage) pageState.page = lastPage
  })
}

// 「表單」篩選的選項：可以申請的表單，加上清單裡出現過的表單（分頁後畫面上只有一頁，選項不能只看這一頁）
function rememberForms(seen, rows) {
  for (const row of rows || []) {
    const id = requestFormId(row)
    if (id && !seen[id]) seen[id] = formNameOf(row)
  }
}

// 清單上的內容摘要：伺服器在每一列附上 summary（用那張單自己的答案組好，跨部門的簽核人也看得到）。
// 舊版伺服器沒有 summary 時才退回自己取表單欄位來組（別的部門的表單會被擋下，就只顯示表單名稱）
const formFieldsCache = reactive({})
const OBJECT_ID_RE = /^[0-9a-f]{24}$/i
const hasServerSummary = (row) => Boolean(row && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, 'summary'))
async function ensureFormFields(rows) {
  const ids = [...new Set((rows || []).filter(row => !hasServerSummary(row)).map(requestFormId))]
    .filter(id => OBJECT_ID_RE.test(id) && formFieldsCache[id] === undefined)
  if (!ids.length) return
  // 先佔位，同一張表單不會重複取
  ids.forEach((id) => { formFieldsCache[id] = [] })
  await Promise.all(ids.map(async (id) => {
    try {
      const res = await apiFetch(`/api/approvals/forms/${id}/fields`)
      if (!res.ok) return
      const fields = await res.json()
      if (Array.isArray(fields)) formFieldsCache[id] = fields
    } catch {
      // 摘要只是輔助資訊，取不到欄位就只顯示表單名稱
    }
  }))
}
// 清單裡同一張單（從明細開的簽核視窗拿到的是明細，沒有 summary）
function listedRow(id) {
  const key = String(id ?? '')
  if (!key) return null
  return [inboxList.value, myList.value, historyList.value]
    .reduce((found, list) => found || list.find(item => String(item?._id) === key), null)
}
function rowSummary(row) {
  if (!row) return ''
  const source = hasServerSummary(row) ? row : listedRow(row._id)
  if (hasServerSummary(source)) return summaryText(source.summary)
  const fields = formFieldsCache[requestFormId(row)]
  return fields?.length ? summarizeRequest(row, fields, { isLeave: isLeaveForm(formOfRow(row)) }) : ''
}

/* -------------------- 待我簽核 -------------------- */
const inboxList = ref([])
const inboxError = ref('')
const inboxLoading = ref(false)
const inboxPage = newPageState()
const inboxFilter = ref(newFilter())
// 待我簽核的總件數（不受篩選影響）：分頁、頁首、預設分頁都用它
const inboxAllTotal = ref(0)
const inboxCount = computed(() => (inboxPage.paged ? inboxAllTotal.value : inboxList.value.length))
// 預設等最久的排最前面（sort=oldest）；桌機可以點「送出時間」改成最新的在前
const inboxSort = ref('asc')
const inboxSeenForms = reactive({})
const inboxFormOptions = computed(() => mergeFormOptions(formTemplates.value, inboxSeenForms))
const inboxFiltered = computed(() => (
  inboxPage.paged ? inboxList.value : sortByTime(filterRequests(inboxList.value, inboxFilter.value), inboxSort.value)
))
const inboxRows = computed(() => (inboxPage.paged ? inboxList.value : pageSlice(inboxFiltered.value, inboxPage.page)))
const inboxTotal = computed(() => (inboxPage.paged ? inboxPage.total : inboxFiltered.value.length))
const inboxEmptyText = computed(() => (hasActiveFilter(inboxFilter.value) && inboxCount.value ? '沒有符合篩選條件的申請' : '目前沒有待您簽核的申請'))
clampPage(inboxPage, inboxFiltered)
function onInboxSortChange({ order }) {
  const next = order === 'descending' ? 'desc' : 'asc'
  if (next === inboxSort.value) return
  inboxSort.value = next
  inboxPage.page = 1
  if (inboxPage.paged) fetchInbox()
}
function onInboxPageChange(page) {
  inboxPage.page = page
  if (inboxPage.paged) fetchInbox()
}

// 該關卡允許退簽才顯示退簽按鈕
const canReturnRow = (row) => !!row?.steps?.[row.current_step_index]?.can_return

const loadInboxList = createListLoader('/api/approvals/inbox', {
  pageState: inboxPage,
  loading: inboxLoading,
  filter: inboxFilter,
  sort: () => (inboxSort.value === 'desc' ? 'newest' : 'oldest'),
})
async function fetchInbox() {
  inboxError.value = ''
  try {
    const items = await loadInboxList()
    if (!items) return undefined
    // 伺服器已經依 sort 排好；舊版伺服器（純陣列）回的是最新的在前，等最久的排最前面
    inboxList.value = inboxPage.paged ? items : sortByTime(items, 'asc')
    // 快取審核者名字
    inboxList.value.forEach(doc => {
      (doc.steps?.[doc.current_step_index]?.approvers || []).forEach(a => {
        if (a.approver && a.approver.name) rememberEmployee(a.approver)
      })
    })
    rememberForms(inboxSeenForms, inboxList.value)
    ensureFormFields(inboxList.value)
    if (inboxPage.paged) {
      // 有篩選時 total 是篩選後的筆數，總件數另外問一次（只取 1 筆）
      const filtered = hasActiveFilter(inboxFilter.value)
      const all = filtered ? await fetchListTotal('/api/approvals/inbox') : inboxPage.total
      if (all !== null) inboxAllTotal.value = all
    }
  } catch (error) {
    inboxError.value = `載入待簽核清單失敗：${describeError(error).message}`
  }
  return undefined
}
// 篩選與切換分頁觸發的重新載入：同一輪裡的多次觸發只送一個請求
const queueInbox = coalesce(fetchInbox)
reloadOnFilterChange(inboxFilter, inboxPage, queueInbox)

/* 審核動作 Dialog */
const actionDlg = reactive({ visible: false, loading: false, decision: 'approve', comment: '', target: null, override: false, fromDetail: false })
// 簽核請假單時，動作視窗上方顯示申請人各假別的剩餘時數（精簡版）
const actionLeaveEmployeeId = computed(() => {
  const row = actionDlg.target
  if (!row || !isLeaveForm(formOfRow(row))) return ''
  const applicant = row.applicant_employee
  return String((applicant && typeof applicant === 'object' ? applicant._id : applicant) || '')
})
const actionTitle = computed(() => {
  const verb = actionDlg.decision === 'approve' ? '核可' : (actionDlg.decision === 'reject' ? '否決' : '退簽')
  return actionDlg.override ? `管理員代為${verb}` : verb
})

// 從明細開啟的動作視窗按了取消：回到明細（成功或單據已過期時不回去，見 doAction）
let reopenDetailAfterAction = false
function openAction(row, decision, { override = false, fromDetail = false } = {}) {
  actionDlg.visible = true
  actionDlg.decision = decision
  actionDlg.comment = ''
  actionDlg.target = row
  actionDlg.override = override
  actionDlg.fromDetail = fromDetail
  reopenDetailAfterAction = fromDetail
  ensureFormFields([row])
}
function onActionClosed() {
  if (!reopenDetailAfterAction) return
  reopenDetailAfterAction = false
  if (detail.doc && String(detail.doc._id) === String(actionDlg.target?._id)) detail.visible = true
}

// 管理員可代為處理任何進行中的單（伺服器會在單據上記錄 admin_override）
const canOverrideRow = (row) => row?.oversight === true && row?.status === 'pending'
function overrideFromDetail(decision) {
  const target = detail.doc
  if (!target) return
  detail.visible = false
  openAction(target, decision, { override: true, fromDetail: true })
}
// 這一關的簽核人看完明細直接簽核
function actFromDetail(decision) {
  const target = detail.doc
  if (!target) return
  detail.visible = false
  openAction(target, decision, { fromDetail: true })
}

// 歷史清單：自己簽過的單顯示自己的決定（主管鏈的關卡附上「第n級主管」）；管理員檢視他人的單則顯示單據目前狀態
const historyDecisionText = (row) => {
  if (row?.oversight) return getStatusText(row.status)
  const text = getStatusText(row?.__latest?.decision || row?.status)
  const stepName = typeof row?.__latest?.step_name === 'string' ? row.__latest.step_name.trim() : ''
  return stepName ? `${text}（${stepName}）` : text
}

// 伺服器附帶的提醒（例如特休扣減失敗）要讓使用者看到
const warningLines = (result) => (
  Array.isArray(result?.warnings)
    ? result.warnings.map(w => (typeof w === 'string' ? w : w?.message)).filter(Boolean)
    : []
)

async function refreshAfterAction() {
  await fetchInbox()
  // 看過歷史才需要同步更新；沒看過的等切到該分頁時再載入
  if (historyLoaded.value) await fetchHistory()
}

// 簽核成功：不等重新載入，先把這張單從待簽清單拿掉（伺服器回來的清單稍後會再對一次）
function dropFromInbox(id) {
  const before = inboxList.value.length
  inboxList.value = inboxList.value.filter(item => String(item._id) !== String(id))
  if (inboxList.value.length < before) {
    if (inboxPage.total > 0) inboxPage.total -= 1
    if (inboxAllTotal.value > 0) inboxAllTotal.value -= 1
  }
}

// 畫面上這張單目前停在第幾關。送出時一起帶給伺服器：別的分頁（或別的管理員）已經處理過這一關，
// 伺服器會回 409 CONFLICT，而不是把這個動作默默套用到下一關
function displayedStepOrder(row) {
  const index = row?.current_step_index
  if (!Number.isInteger(index) || index < 0) return undefined
  const order = Number(row?.steps?.[index]?.step_order)
  return Number.isInteger(order) && order >= 1 ? order : index + 1
}

async function doAction() {
  if (!actionDlg.target || actionDlg.loading) return
  // 先標成處理中再做其他事：確認視窗還開著的時候再按一次也不會送出第二次
  actionDlg.loading = true
  // 退簽沒寫原因，申請人就不知道要改什麼，送出前再確認一次
  if (
    actionDlg.decision === 'return' &&
    !String(actionDlg.comment || '').trim() &&
    !(await confirmAction('尚未填寫退簽原因，申請人將不知道要修改什麼，仍要退簽嗎？', { confirmText: '仍要退簽' }))
  ) {
    actionDlg.loading = false
    return
  }
  const target = actionDlg.target
  const fromDetail = actionDlg.fromDetail
  try {
    const body = { decision: actionDlg.decision, comment: actionDlg.comment }
    const stepOrder = displayedStepOrder(target)
    if (stepOrder !== undefined) body.step_order = stepOrder
    // 只有「管理員代為處理」的對話框才明確要求代簽；一般核可 / 否決 / 退簽不帶，
    // 伺服器才分得出重複送出（連按兩次、另一個分頁）和管理員刻意代簽
    if (actionDlg.override) body.override = true
    const res = await apiFetch(`/api/approvals/${target._id}/act`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    if (!res.ok) throw await readApiError(res)
    const result = await res.json().catch(() => ({}))
    reopenDetailAfterAction = false
    actionDlg.visible = false
    // 一般的簽核：這張單已經不在我的待簽清單（還停在我這裡的下一關，重新載入後會再出現）
    if (!actionDlg.override) dropFromInbox(target._id)
    await refreshAfterAction()
    notifySuccess('已送出！', warningLines(result))
  } catch (error) {
    const info = describeError(error)
    // 單子已被別人處理 / 不存在時關閉對話框，並重新整理清單
    if (isStaleStatus(info)) {
      reopenDetailAfterAction = false
      actionDlg.visible = false
    }
    // 特休餘額不足（409）：單據還在簽核中，關掉確認視窗（從明細開的會回到明細，可以改按退簽），說明原因與接下來怎麼做
    const annualShort = info.code === ANNUAL_LEAVE_INSUFFICIENT
    if (annualShort) actionDlg.visible = false
    await refreshAfterAction()
    if (annualShort) {
      showFailure('特休餘額不足，無法核准', info)
      return
    }
    // 從明細按「代為處理」遇到畫面過期（409）：重新打開明細，讓管理員看到單據現在的關卡再決定
    if (fromDetail && info.status === 409) await openDetail(target._id)
    showFailure('動作失敗', info)
  } finally {
    actionDlg.loading = false
  }
}

/* -------------------- 我的申請 -------------------- */
const myList = ref([])
const myError = ref('')
const myLoading = ref(false)
const myPage = newPageState()
const myFilter = ref(newFilter())
const resetMyFilter = () => { myFilter.value = newFilter() }
const mySeenForms = reactive({})
const myFormOptions = computed(() => mergeFormOptions(formTemplates.value, mySeenForms))
const myFiltered = computed(() => (myPage.paged ? myList.value : filterRequests(myList.value, myFilter.value)))
const myRows = computed(() => (myPage.paged ? myList.value : pageSlice(myFiltered.value, myPage.page)))
const myTotal = computed(() => (myPage.paged ? myPage.total : myFiltered.value.length))
// 有沒有任何申請（不論篩選）：沒有才在空白清單放「填寫申請」
const myHasAny = computed(() => (myPage.paged ? (myPage.total > 0 || hasActiveFilter(myFilter.value)) : myList.value.length > 0))
const myEmptyText = computed(() => (myHasAny.value ? '沒有符合篩選條件的申請' : '還沒有申請紀錄'))
clampPage(myPage, myFiltered)
function onMyPageChange(page) {
  myPage.page = page
  if (myPage.paged) fetchMyList()
}
// 頁首的「進行中的申請」：簽核中與被退簽（等自己修改）的單；按下去看這些單。
// 清單是完整的（舊版伺服器、或沒有篩選且只有一頁）就直接數；否則另外向伺服器問這兩種狀態的件數（各取 1 筆讀總數）
const myServerCounts = ref(null)
const countMine = (status) => (myServerCounts.value
  ? myServerCounts.value[status]
  : myList.value.filter(row => row?.status === status).length)
const myInProgressCount = computed(() => countMine('pending') + countMine('returned'))
const myReturnedCount = computed(() => countMine('returned'))
function showMyInProgress() {
  // 只有一種狀態就直接篩那一種；兩種都有就不篩（最新的在最上面）
  const pending = countMine('pending') > 0
  const returned = myReturnedCount.value > 0
  myFilter.value = { ...newFilter(), status: pending && !returned ? 'pending' : (returned && !pending ? 'returned' : '') }
  goTab('mine')
}
// 我的申請的進度：簽核中寫第幾關、等誰；被退簽提醒要修改
function myProgressText(row) {
  if (row?.status === 'returned') return '已被退簽，請修改後重新送出'
  if (row?.status !== 'pending') return ''
  const step = row.steps?.[row.current_step_index]
  const waiting = (Array.isArray(step?.approvers) ? step.approvers : [])
    .filter(item => item?.decision === 'pending')
    .map(item => approverName(item.approver))
    .filter(name => name && name !== '-')
  const names = waiting.length > 3 ? `${waiting.slice(0, 3).join('、')} 等 ${waiting.length} 位` : waiting.join('、')
  return [stepProgressText(row), names ? `等待 ${names}` : ''].filter(Boolean).join('・')
}

// 清單已含表單名稱；舊版伺服器只回編號時，從表單清單補名稱
function formNameOf(row) {
  if (row?.form?.name) return row.form.name
  const formId = typeof row?.form === 'object' ? row?.form?._id : row?.form
  return formTemplates.value.find(t => t._id === formId)?.name || '-'
}

/* -------------------- 我已簽核 -------------------- */
const historyList = ref([])
const historyLoading = ref(false)
const historyError = ref('')
const historyLoaded = ref(false)
const historyPage = newPageState()
const historyFilter = ref(newFilter())
// 自己簽過的單看自己簽核的時間；管理員檢視他人的單看單據最後更新的時間
const historyTimeOf = (row) => (row?.oversight ? row.updatedAt : (row?.__latest?.decided_at || row?.updatedAt))
const historyComment = (row) => (row?.oversight ? '' : String(row?.__latest?.comment || '').trim())
const historyTagType = (row) => getStatusTagType(row?.oversight ? row.status : (row?.__latest?.decision || row?.status))
const historySeenForms = reactive({})
const historyFormOptions = computed(() => mergeFormOptions(formTemplates.value, historySeenForms))
// 日期篩選與另外兩份清單相同，比對送出（建立）日期（伺服器的 from / to）
const historyFiltered = computed(() => (historyPage.paged ? historyList.value : filterRequests(historyList.value, historyFilter.value)))
const historyRows = computed(() => (historyPage.paged ? historyList.value : pageSlice(historyFiltered.value, historyPage.page)))
const historyTotal = computed(() => (historyPage.paged ? historyPage.total : historyFiltered.value.length))
const historyHasAny = computed(() => (historyPage.paged ? (historyPage.total > 0 || hasActiveFilter(historyFilter.value)) : historyList.value.length > 0))
const historyEmptyText = computed(() => (historyHasAny.value ? '沒有符合篩選條件的紀錄' : '尚未簽核過任何申請'))
clampPage(historyPage, historyFiltered)
function onHistoryPageChange(page) {
  historyPage.page = page
  if (historyPage.paged) fetchHistory()
}

function extractLatestApproval(row) {
  const approvals = Array.isArray(row?.my_approvals) ? row.my_approvals : []
  if (!approvals.length) return null
  return approvals.reduce((latest, current) => {
    const latestTime = latest?.time ?? Number.NEGATIVE_INFINITY
    const currentTime = new Date(current.decided_at || current.updatedAt || current.createdAt || 0).getTime()
    if (currentTime > latestTime) {
      return { time: currentTime, record: current }
    }
    return latest
  }, null)?.record || approvals[approvals.length - 1]
}

// 篩選、分頁在伺服器做（所有角色都一樣；管理員看的是全部單據）；伺服器依最後更新時間排序，新的在前
const loadHistoryList = createListLoader('/api/approvals/history', {
  pageState: historyPage,
  loading: historyLoading,
  filter: historyFilter,
})
async function fetchHistory() {
  historyError.value = ''
  try {
    const items = await loadHistoryList()
    if (!items) return undefined
    const withLatest = items.map(item => ({ ...item, __latest: extractLatestApproval(item) }))
    // 舊版伺服器（純陣列）：最近簽核（管理員檢視的單：最近更新）的在最上面
    historyList.value = historyPage.paged ? withLatest : sortByTime(withLatest, 'desc', historyTimeOf)
    rememberForms(historySeenForms, historyList.value)
    historyLoaded.value = true
  } catch (error) {
    const info = describeError(error)
    historyList.value = []
    historyError.value = info.status === 401 || info.status === 403
      ? '您沒有權限查看歷史簽核紀錄'
      : `載入歷史簽核失敗：${info.message}`
  }
  return undefined
}
// 篩選與切換分頁觸發的重新載入：同一輪裡的多次觸發只送一個請求
const queueHistory = coalesce(fetchHistory)
// 還沒看過「我已簽核」時不查，等切到那個分頁再載入
reloadOnFilterChange(historyFilter, historyPage, queueHistory, { enabled: () => historyLoaded.value })

const loadMyList = createListLoader('/api/approvals', { pageState: myPage, loading: myLoading, filter: myFilter })
async function fetchMyList() {
  myError.value = ''
  try {
    const items = await loadMyList()
    if (!items) return undefined
    myList.value = items
    rememberForms(mySeenForms, items)
    ensureFormFields(items)
    // 頁首「進行中的申請」的件數：清單不完整（有篩選或不只一頁）時另外問
    const complete = !myPage.paged || (!hasActiveFilter(myFilter.value) && myPage.page === 1 && myPage.total <= items.length)
    if (complete) {
      myServerCounts.value = null
    } else {
      const [pending, returned] = await Promise.all([
        fetchListTotal('/api/approvals', { status: 'pending' }),
        fetchListTotal('/api/approvals', { status: 'returned' }),
      ])
      if (pending !== null && returned !== null) myServerCounts.value = { pending, returned }
    }
  } catch (error) {
    myError.value = `載入申請記錄失敗：${describeError(error).message}`
  }
  return undefined
}
// 篩選與切換分頁觸發的重新載入：同一輪裡的多次觸發只送一個請求
const queueMyList = coalesce(fetchMyList)
// 我的申請：分頁沒有打開時不查（送出申請後會先清掉篩選再切過來，切過來時才載入）
reloadOnFilterChange(myFilter, myPage, queueMyList, { enabled: () => activeTab.value === 'mine' })

// 清單列的表單：清單只帶名稱 / 分類 / 表單性質，再補上表單清單裡的固定代號（default_key）
function formOfRow(row) {
  const form = row?.form && typeof row.form === 'object' ? row.form : { _id: row?.form }
  const template = formTemplates.value.find(t => t._id === form._id)
  return template ? { ...template, ...form } : form
}

// 處理中與被退簽的單都能撤回；已核可的請假單也顯示撤回，能不能撤回由伺服器決定
// （申請人要在假期開始前、管理員隨時，其他情況伺服器會回中文原因）
const canCancelMine = (row) => (
  row?.status === 'pending' ||
  row?.status === 'returned' ||
  (row?.status === 'approved' && isLeaveForm(formOfRow(row)))
)
// 管理員可在「我已簽核」撤回已核可的請假單（特休時數會返還）
const canCancelApprovedRow = (row) => (
  authStore.role === 'admin' && row?.status === 'approved' && isLeaveForm(formOfRow(row))
)

async function runMyRequestAction(row, action, refresh = () => fetchMyList()) {
  if (!row?._id || myActionLoading[row._id]) return undefined
  myActionLoading[row._id] = true
  try {
    const response = await apiFetch(`/api/approvals/${row._id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    if (!response.ok) throw await readApiError(response)
    const result = await response.json().catch(() => ({}))
    await refresh()
    return result
  } catch (error) {
    showFailure('操作失敗', describeError(error))
    // 失敗時清單可能已過期（例如已被簽核人處理），一併重新整理
    await refresh()
  } finally {
    myActionLoading[row._id] = false
  }
  return undefined
}

// 已核可的單撤回成功時，把伺服器記下的結果（例如返還幾小時特休）告訴使用者
function announceApprovedCancel(result) {
  const logs = Array.isArray(result?.logs) ? result.logs : []
  const message = String(logs[logs.length - 1]?.message || '').trim()
  notifySuccess(message || '已撤回')
}

const CANCEL_CONFIRM = { title: '撤回申請', confirmText: '撤回', cancelText: '不撤回', danger: true }
async function cancelMyRequest(row) {
  const wasApproved = row?.status === 'approved'
  const question = wasApproved
    ? '這筆請假已經核可，確定要撤回嗎？若是特休，已扣除的特休時數會一併返還。'
    : '確定撤回這筆申請？'
  if (!(await confirmAction(question, CANCEL_CONFIRM))) return undefined
  const result = await runMyRequestAction(row, 'cancel')
  if (!result) return undefined
  if (wasApproved) announceApprovedCancel(result)
  else notifySuccess('已撤回')
  // 撤回後簽核中的時數會釋放（已核可的請假會返還），餘額跟著更新
  refreshOwnBalances()
  return result
}

// 管理員從「我已簽核」撤回已核可的請假單：成功後歷史與我的申請都重新載入
async function cancelApprovedFromHistory(row) {
  if (!(await confirmAction('這筆請假已經核可，確定要撤回嗎？若是特休，已扣除的特休時數會一併返還。', CANCEL_CONFIRM))) return
  const result = await runMyRequestAction(row, 'cancel', () => Promise.all([fetchHistory(), fetchMyList()]))
  if (result) announceApprovedCancel(result)
}

// 申請人在明細裡直接撤回、修改並重新送出
async function cancelFromDetail() {
  const target = detail.doc
  if (!target) return
  const result = await cancelMyRequest(target)
  if (result) detail.visible = false
}
function resubmitFromDetail() {
  const target = detail.doc
  if (!target) return
  detail.visible = false
  resubmitMyRequest(target)
}

/* 被退簽的申請：帶入原本內容讓申請人修改後再重新送出 */
const editDlg = reactive({
  visible: false,
  loading: false,
  saving: false,
  requestId: '',
  leaveForm: false, // 這張單是不是請假表單（時數自動帶入與提示只用在請假表單）
  fields: [],
  formData: {},
  files: {},
  kept: {},
  returnInfo: null,
  error: '',
  errorLines: [],
  fieldErrors: {},
})
let editSeq = 0

// 修改並重新送出：同樣自動帶入時數與提示是否超額（同樣只限請假表單）
const editAutofill = useLeaveHoursAutofill({
  fields: computed(() => (editDlg.leaveForm ? editDlg.fields : [])),
  getFormData: () => editDlg.formData,
  setValue: (fieldId, value) => { editDlg.formData = { ...editDlg.formData, [fieldId]: value } },
  getPolicy: leaveHoursPolicy,
  fetchHint: fetchLeaveHoursHint,
})
const editLeaveHoursConfig = computed(() => ({ enabled: editDlg.leaveForm, max: editAutofill.maxHours.value, ...leaveHoursPolicy() }))
const editLeaveContext = computed(() => (editDlg.leaveForm ? leaveContextOf(editDlg.fields, editDlg.formData) : null))
const editLeaveFieldIds = computed(() => (editDlg.leaveForm ? leaveFieldIdsOf(editDlg.fields) : { type: '', hours: '' }))

function clearEditDialog() {
  editDlg.leaveForm = false
  editDlg.fields = []
  editDlg.formData = {}
  editDlg.files = {}
  editDlg.kept = {}
  editDlg.returnInfo = null
  editDlg.error = ''
  editDlg.errorLines = []
  editDlg.fieldErrors = {}
  editDlg.requestId = ''
}

function closeEditDialog() {
  editSeq += 1
  editDlg.visible = false
  // 沒送出的附件清單一併清掉
  editDlg.files = {}
}

async function resubmitMyRequest(row) {
  if (!row?._id) return
  const seq = ++editSeq
  clearEditDialog()
  editDlg.requestId = row._id
  editUploadCache.clear()
  editDlg.visible = true
  editDlg.loading = true
  try {
    const res = await apiFetch(`/api/approvals/${row._id}`)
    if (!res.ok) throw await readApiError(res)
    const doc = await res.json()
    if (seq !== editSeq) return
    const fields = (doc?.form?.fields || [])
      .filter(isActiveField)
      .sort((a, b) => (a.order || 0) - (b.order || 0))
    // 表單性質看單據帶回來的表單，固定代號（default_key）看表單清單裡的樣板
    editDlg.leaveForm = isLeaveForm({ ...formOfRow(row), ...(doc?.form && typeof doc.form === 'object' ? doc.form : {}) })
    editDlg.fields = fields
    editDlg.formData = prefillFormData(fields, doc.form_data)
    editDlg.kept = {}
    for (const field of fields) {
      if (field.type_1 === 'file') editDlg.kept[field._id] = attachmentItems(doc.form_data?.[field._id])
    }
    editDlg.returnInfo = findReturnInfo(doc, nameOfEmployee)
  } catch (error) {
    if (seq !== editSeq) return
    editDlg.visible = false
    showFailure('載入申請內容失敗', describeError(error))
    await fetchMyList()
  } finally {
    if (seq === editSeq) editDlg.loading = false
  }
}

async function submitResubmit() {
  if (!editDlg.requestId || editDlg.saving) return
  editDlg.saving = true
  editDlg.error = ''
  editDlg.errorLines = []
  editDlg.fieldErrors = {}
  try {
    const missing = collectMissingRequiredFields(editDlg.fields, editDlg.formData, editDlg.files, editKeptFlags())
    const firstMissing = editDlg.fields.find(field => missing[field._id])
    if (firstMissing) {
      editDlg.fieldErrors = missing
      scrollToFirstFieldError('.edit-form')
      throw new Error(`請填寫必填欄位：${firstMissing.label}`)
    }

    const payloadData = { ...editDlg.formData }
    for (const field of editDlg.fields) {
      if (field.type_1 !== 'file') continue
      const picked = editDlg.files[field._id] || []
      // 沒選新檔案就保留原本的附件
      payloadData[field._id] = picked.length
        ? await uploadFieldFiles(field._id, picked, editUploadCache)
        : (editDlg.kept[field._id] || [])
    }

    const res = await apiFetch(`/api/approvals/${editDlg.requestId}/resubmit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ form_data: payloadData }),
    })
    if (!res.ok) throw await readApiError(res)
    const result = await res.json().catch(() => ({}))

    closeEditDialog()
    notifySuccess('已重新送出！', warningLines(result))
    refreshOwnBalances()
    await fetchMyList()
  } catch (error) {
    const info = describeError(error, '重新送出失敗，請稍後再試')
    editDlg.error = info.message
    editDlg.errorLines = info.lines
    if (info.lines.length) showFailure('重新送出失敗', info)
    if (isStaleStatus(info)) {
      closeEditDialog()
      showFailure('重新送出失敗', info)
      await fetchMyList()
    }
  } finally {
    editDlg.saving = false
  }
}

watch(() => editDlg.visible, (visible) => {
  if (!visible) editDlg.files = {}
})

// 原本已上傳的附件算不算「有檔案」（必填的附件欄位沒選新檔案但保留舊檔案也算有填）
function editKeptFlags() {
  const flags = {}
  for (const [fid, list] of Object.entries(editDlg.kept)) flags[fid] = list.length > 0
  return flags
}
watch([() => editDlg.formData, () => editDlg.files], () => {
  editDlg.fieldErrors = stillMissing(editDlg.fieldErrors, editDlg.fields, editDlg.formData, editDlg.files, editKeptFlags())
}, { deep: true })

/* -------------------- 詳細 Dialog -------------------- */
const detail = reactive({ visible: false, doc: null })
let detailSeq = 0

async function openDetail(id) {
  const seq = ++detailSeq
  detail.visible = false
  detail.doc = null
  try {
    const res = await apiFetch(`/api/approvals/${id}`)
    if (!res.ok) throw await readApiError(res)
    const data = await res.json()
    if (seq !== detailSeq) return
    detail.doc = data
    detail.visible = true
    // 補快取人名
    const steps = Array.isArray(detail.doc.steps) ? detail.doc.steps : []
    steps.forEach(s => {
      const approvers = Array.isArray(s.approvers) ? s.approvers : []
      approvers.forEach(a => {
        if (a.approver?._id && a.approver?.name) rememberEmployee(a.approver)
      })
    })
  } catch (error) {
    if (seq !== detailSeq) return
    showFailure('載入明細失敗', describeError(error))
  }
}

async function downloadApprovalAttachment(attachment) {
  try {
    await downloadAttachmentFile(detail.doc?._id, attachment)
  } catch (error) {
    showFailure('附件下載失敗', describeError(error))
  }
}

/* -------------------- 表單說明 -------------------- */
const helpDlg = reactive({ visible: false, forms: [] })

function showFormHelp() {
  helpDlg.forms = formTemplates.value.map(f => ({
    _id: f._id,
    name: f.name,
    category: f.category,
    description: f.description || '',
    semanticType: f.semanticType,
    default_key: f.default_key,
  }))
  helpDlg.visible = true
}

/* -------------------- 初始化 -------------------- */
onMounted(async () => {
  authStore.loadUser()
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onBeforeUnload)
  try {
    await Promise.all([loadFormTemplates(), fetchUsersLite(), fetchDepts(), fetchOrgs()])
    await Promise.all([fetchInbox(), fetchMyList()])
    // 依實際情況選預設分頁：有等我簽核的單看「待我簽核」，有被退簽的單看「我的申請」，都沒有就直接填「申請表單」
    if (!tabChosen.value) {
      const tab = pickDefaultTab({ inboxCount: inboxCount.value, returnedCount: myReturnedCount.value })
      if (tab !== activeTab.value) {
        skipNextTabLoad = true
        activeTab.value = tab
      }
    }
  } finally {
    initializing.value = false
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload)
  filterTimers.forEach(timer => clearTimeout(timer))
  filterTimers.clear()
})

watch(activeTab, async (tab) => {
  // 預設分頁是程式選的，資料剛剛才載入過
  if (skipNextTabLoad) {
    skipNextTabLoad = false
    return
  }
  if (tab === 'apply') {
    // 管理員新增 / 停用表單後，回到申請頁就能看到最新的表單清單
    await loadFormTemplates()
    // 切回申請頁時餘額也重新取一次（別處剛核准的請假會影響剩餘時數）
    await refreshOwnBalances()
  } else if (tab === 'inbox') {
    await queueInbox()
  } else if (tab === 'mine') {
    // 從別的分頁帶著篩選切過來（頁首「進行中的申請」、送出申請後）時，篩選的重新載入與這裡合併成一個請求
    await queueMyList()
  } else if (tab === 'history') {
    await queueHistory()
  }
})
</script>

<style scoped>
.approval-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0;
}

/* 頁首的統計數字可以點（跳到對應的分頁） */
.approval-stat {
  cursor: pointer;
  font-family: inherit;
  line-height: inherit;
}

.approval-stat:hover,
.approval-stat:focus-visible {
  border-color: var(--hr-primary-light);
}

/* 分頁 */
.approval-tabs :deep(.el-tabs__header) {
  margin-bottom: var(--hr-space-md);
}

.tab-count {
  display: inline-block;
  min-width: 18px;
  margin-left: 6px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--hr-error);
  color: var(--hr-white);
  font-size: 12px;
  line-height: 18px;
  text-align: center;
}

/* 申請表單 */
.apply-form {
  max-width: 760px;
}

.template-selector .selector-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm);
  width: 100%;
}

.form-select {
  flex: 1 1 240px;
  max-width: 360px;
}

.selector-row .el-button + .el-button {
  margin-left: 0;
}

.option-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hr-space-sm);
  width: 100%;
}

.option-category {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--hr-gray-400);
}

/* 表單清單依部門篩選的提示 */
.form-visibility-hint {
  flex: 0 0 100%;
  margin: 4px 0 0;
}

.block-title {
  margin: var(--hr-space-md) 0 var(--hr-space-sm);
  font-size: var(--hr-font-size-sm);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-700);
}

/* 假別下方的一句話餘額 */
.balance-brief {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 12px;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--hr-gray-600);
}

/* 簽核流程預覽 */
.workflow-steps {
  display: flex;
  flex-direction: column;
  gap: var(--hr-space-sm);
  margin: 0;
  padding: 0;
  list-style: none;
}

.workflow-step {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--hr-gray-200);
  border-radius: var(--hr-radius-md);
  background: var(--hr-gray-50);
}

.step-number {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--hr-primary);
  color: var(--hr-white);
  font-size: 13px;
  font-weight: var(--hr-font-weight-semibold);
}

.step-content {
  flex: 1;
  min-width: 0;
}

.step-title {
  margin: 0;
  font-size: var(--hr-font-size-sm);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-800);
}

.step-approvers {
  margin: 2px 0 0;
  font-size: 13px;
  color: var(--hr-gray-600);
}

.step-warning {
  margin: 4px 0 0;
  font-size: 13px;
  color: #b45309;
}

/* 主管關卡改由最高層簽核人簽核的說明 */
.step-fallback {
  margin: 4px 0 0;
  font-size: 13px;
  color: #b88230;
}

/* 請假長度條件、略過重複簽核人的說明 */
.step-condition,
.step-repeat {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--hr-gray-600);
}

/* 送出 */
.form-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: var(--hr-space-md);
  margin-top: var(--hr-space-md);
  padding-top: var(--hr-space-md);
  border-top: 1px solid var(--hr-gray-200);
}

.submit-btn {
  min-width: 140px;
}

.error-message {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: #dc2626;
  font-size: var(--hr-font-size-sm);
  line-height: 1.6;
}

.load-error {
  align-items: center;
  flex-wrap: wrap;
  margin-bottom: var(--hr-space-sm);
}

.apply-reference {
  margin-top: var(--hr-space-md);
}

/* 清單 */
.approval-table {
  width: 100%;
}

.form-name {
  font-weight: var(--hr-font-weight-medium);
}

.applicant-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.applicant-avatar {
  flex-shrink: 0;
}

.row-summary {
  color: var(--hr-gray-700);
  word-break: break-word;
}

.row-sub,
.history-waiting {
  margin-top: 2px;
  font-size: 12px;
  color: var(--hr-gray-500);
}

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.action-buttons .el-button + .el-button {
  margin-left: 0;
}

.list-pagination {
  justify-content: flex-end;
  padding: var(--hr-space-md) 0 0;
}

/* 手機的卡片清單 */
.req-cards {
  display: flex;
  flex-direction: column;
  gap: var(--hr-space-sm);
  min-height: 80px;
}

.req-card {
  border: 1px solid var(--hr-gray-200);
  border-radius: var(--hr-radius-md);
  background: var(--hr-white);
}

.req-card__main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  padding: 12px;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.req-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hr-space-sm);
}

.req-card__title {
  font-size: var(--hr-font-size-base);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-900);
}

.req-card__age,
.req-card__meta {
  font-size: 12px;
  color: var(--hr-gray-500);
}

.req-card__summary {
  font-size: var(--hr-font-size-sm);
  line-height: 1.5;
  color: var(--hr-gray-700);
  word-break: break-word;
}

.req-card__actions {
  display: flex;
  gap: var(--hr-space-sm);
  padding: 0 12px 12px;
}

.req-card__actions .el-button {
  flex: 1 1 0;
  min-height: 44px;
  margin-left: 0;
}

/* 我的申請：撤回是次要（而且不可復原）的動作，不佔滿整列 */
.req-card__actions--end {
  justify-content: flex-end;
}

.req-card__actions--end .el-button {
  flex: 0 1 auto;
  min-width: 96px;
}

/* 對話框：內容太長時在對話框裡捲動，底部的按鈕（核可、否決、送出）一直看得到 */
.approval-page :deep(.approval-dialog:not(.is-fullscreen)) {
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 12vh);
  margin-top: 6vh;
  margin-bottom: 0;
}

.approval-page :deep(.approval-dialog:not(.is-fullscreen) .el-dialog__body) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.dialog-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm);
}

.dialog-actions .el-button + .el-button {
  margin-left: 0;
}

.action-target {
  margin: 0 0 var(--hr-space-sm);
  font-size: var(--hr-font-size-sm);
  line-height: 1.6;
  color: var(--hr-gray-700);
}

.action-target__summary {
  display: block;
  color: var(--hr-gray-500);
}

.help-content {
  max-height: 60vh;
  overflow-y: auto;
}

.help-lead {
  margin: 0 0 var(--hr-space-sm);
}

.form-help-item {
  padding: 10px 0;
  border-top: 1px solid var(--hr-gray-200);
}

.form-help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--hr-space-sm);
  margin-bottom: 4px;
}

.form-help-title {
  display: flex;
  align-items: center;
  gap: var(--hr-space-sm);
  margin: 0;
  font-size: var(--hr-font-size-sm);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-800);
}

.form-help-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--hr-gray-500);
}

.mb-3 {
  margin-bottom: var(--hr-space-md);
}

.error-lines {
  margin: 6px 0 0;
  padding-left: 20px;
  line-height: 1.7;
}

.error-dialog-message {
  margin: 0 0 var(--hr-space-sm);
  font-weight: var(--hr-font-weight-semibold);
  color: #dc2626;
}

/* 手機：分頁標籤擠得下四個、對話框全螢幕且底部按鈕固定、點擊區至少 44px */
@media (max-width: 767px) {
  .approval-tabs :deep(.el-tabs__item) {
    height: 44px;
    padding: 0 10px;
  }

  .approval-tabs :deep(.el-tabs__header) {
    margin-bottom: var(--hr-space-sm);
  }

  .form-select {
    flex: 1 1 100%;
    max-width: none;
  }

  .selector-row .el-button {
    min-height: 44px;
  }

  .form-actions {
    flex-direction: column;
    align-items: stretch;
  }

  .submit-btn {
    width: 100%;
    min-height: 48px;
  }

  .approval-page :deep(.el-dialog.is-fullscreen) {
    display: flex;
    flex-direction: column;
  }

  .approval-page :deep(.el-dialog.is-fullscreen .el-dialog__body) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .approval-page :deep(.el-dialog.is-fullscreen .el-dialog__footer) {
    flex-shrink: 0;
    padding-top: var(--hr-space-sm);
    border-top: 1px solid var(--hr-gray-200);
  }

  .dialog-actions .el-button {
    flex: 1 1 auto;
    min-height: 44px;
  }

  .dialog-actions .hr-toolbar__spacer {
    display: none;
  }

  .list-pagination {
    justify-content: center;
  }
}
</style>
