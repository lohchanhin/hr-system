<!-- src/views/front/Approval.vue -->
<template>
  <div class="approval-page">
    <!-- 添加現代化的頁面標題 -->
    <div class="page-header">
      <h1 class="page-title">簽核流程管理</h1>
      <p class="page-description">申請表單、審核流程、狀態追蹤一站式管理</p>
    </div>

    <!-- 美化標籤頁設計 -->
    <el-tabs v-model="activeTab" type="card" class="approval-tabs">
      <!-- 1) 申請表單 -->
      <el-tab-pane name="apply">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-edit-outline"></i>
            <span>申請表單</span>
          </div>
        </template>

        <div class="tab-content">
          <div class="form-section">
            <h2 class="section-title">建立新申請</h2>

            <el-card class="form-card">
              <el-form label-width="140px" :model="applyState" class="apply-form">
                <el-form-item label="選擇表單樣板" class="template-selector">
                  <div class="selector-row">
                    <el-select
                      v-model="applyState.formId"
                      placeholder="請選擇申請表單類型"
                      class="form-select"
                      @change="onSelectForm"
                    >
                      <el-option
                        v-for="f in formTemplates"
                        :key="f._id"
                        :label="`${f.name}（${f.category}）`"
                        :value="f._id"
                        :class="{ 'payroll-connected-option': isPayrollConnectedForm(f) }"
                      >
                        <span class="option-content">
                          <span class="option-label">{{ f.name }}（{{ f.category }}）</span>
                          <el-tag
                            v-if="isPayrollConnectedForm(f)"
                            type="success"
                            size="small"
                            class="payroll-tag"
                          >
                            💰 連接薪資
                          </el-tag>
                        </span>
                      </el-option>
                    </el-select>
                    <el-button
                      type="info"
                      icon="el-icon-question"
                      @click="showFormHelp"
                      class="help-btn"
                      title="查看表單說明"
                    >
                      說明
                    </el-button>
                    <el-button
                      type="primary"
                      :disabled="!applyState.formId"
                      @click="reloadSelectedForm"
                      class="reload-btn"
                    >
                      <i class="el-icon-refresh"></i>
                      重新載入
                    </el-button>
                    <el-button
                      v-if="leaveFormId"
                      type="success"
                      @click="selectLeave"
                      class="quick-btn"
                    >
                      <i class="el-icon-time"></i>
                      快速請假
                    </el-button>
                  </div>
                </el-form-item>

                <div v-if="fieldList.length" class="form-content">
                  <el-divider content-position="left">
                    <span class="divider-text">表單內容</span>
                  </el-divider>

                  <!-- 動態欄位渲染 -->
                  <div class="form-fields">
                    <ApprovalFormFields
                      v-model="applyState.formData"
                      v-model:files="fileBuffers"
                      :fields="fieldList"
                      :user-options="userOptions"
                      :dept-options="deptOptions"
                      :org-options="orgOptions"
                    />
                  </div>

                  <div v-if="workflowSteps.length || workflowWarning" class="workflow-preview">
                    <el-divider content-position="left">
                      <span class="divider-text">簽核流程預覽</span>
                    </el-divider>
                    <el-alert
                      v-if="workflowWarning"
                      type="warning"
                      :closable="false"
                      show-icon
                      class="mb-3"
                      :title="workflowWarning"
                    />
                    <div class="workflow-steps">
                      <div
                        v-for="(s, idx) in workflowSteps"
                        :key="idx"
                        class="workflow-step"
                      >
                        <div class="step-number">{{ idx + 1 }}</div>
                        <div class="step-content">
                          <h4 class="step-title">{{ s.label }}</h4>
                          <p class="step-approvers">{{ s.approvers }}</p>
                          <p v-if="s.warning" class="step-warning">{{ s.warning }}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div class="form-actions">
                    <el-button
                      type="primary"
                      size="large"
                      :loading="submitting"
                      @click="submitApply"
                      class="submit-btn"
                    >
                      <i class="el-icon-check"></i>
                      送出申請
                    </el-button>
                    <div v-if="applyError" class="error-message">
                      <i class="el-icon-warning"></i>
                      <div>
                        <div>{{ applyError }}</div>
                        <ul v-if="applyErrorLines.length" class="error-lines">
                          <li v-for="(line, i) in applyErrorLines" :key="i">{{ line }}</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>

                <div v-else class="empty-state">
                  <i class="el-icon-document"></i>
                  <p>請先選擇一個表單樣板開始申請</p>
                  <p v-if="templatesError" class="error-message">{{ templatesError }}</p>
                </div>
              </el-form>
            </el-card>
          </div>
        </div>
      </el-tab-pane>

      <!-- 2) 待我簽核 -->
      <el-tab-pane name="inbox">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-message"></i>
            <span>待我簽核</span>
            <el-badge v-if="inboxCount" :value="inboxCount" class="tab-badge" />
          </div>
        </template>

        <div class="tab-content">
          <div class="table-section">
            <h2 class="section-title">待處理申請</h2>
            <div class="table-container">
              <el-alert
                v-if="inboxError"
                type="error"
                :closable="false"
                class="mb-3"
                :title="inboxError"
              />
              <el-table
                :data="inboxList"
                class="approval-table"
                :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
                :row-style="{ height: '64px' }"
                empty-text="目前沒有待您簽核的申請"
              >
                <el-table-column label="#" width="60" type="index" />
                <el-table-column label="表單名稱" width="220">
                  <template #default="{ row }">
                    <div class="form-name">
                      <i class="el-icon-document"></i>
                      {{ formNameOf(row) }}
                    </div>
                  </template>
                </el-table-column>
                <el-table-column prop="applicant_employee.name" label="申請人" width="140">
                  <template #default="{ row }">
                    <div class="applicant-info">
                      <el-avatar :size="32" class="applicant-avatar">
                        {{ (row.applicant_employee?.name || '-').charAt(0) }}
                      </el-avatar>
                      <span>{{ row.applicant_employee?.name || '-' }}</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="狀態" width="120">
                  <template #default="{ row }">
                    <el-tag
                      :type="getStatusTagType(row.status)"
                      class="status-tag"
                    >
                      {{ getStatusText(row.status) }}
                    </el-tag>
                  </template>
                </el-table-column>
                <el-table-column label="目前關卡" width="120">
                  <template #default="{ row }">
                    <div class="progress-info">
                      <span class="progress-text">{{ row.current_step_index + 1 }}/{{ row.steps?.length || 0 }}</span>
                      <el-progress
                        :percentage="((row.current_step_index + 1) / (row.steps?.length || 1)) * 100"
                        :show-text="false"
                        :stroke-width="4"
                        class="progress-bar"
                      />
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="建立時間" width="180">
                  <template #default="{ row }">
                    <div class="time-info">
                      <i class="el-icon-time"></i>
                      {{ fmt(row.createdAt) }}
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="320">
                  <template #default="{ row }">
                    <div class="action-buttons">
                      <el-button size="small" @click="openDetail(row._id)" class="view-btn">
                        <i class="el-icon-view"></i>
                        查看
                      </el-button>
                      <el-button type="success" size="small" @click="openAction(row, 'approve')" class="approve-btn">
                        <i class="el-icon-check"></i>
                        核可
                      </el-button>
                      <el-button type="danger" size="small" @click="openAction(row, 'reject')" class="reject-btn">
                        <i class="el-icon-close"></i>
                        否決
                      </el-button>
                      <el-button v-if="canReturnRow(row)" size="small" @click="openAction(row, 'return')" class="return-btn">
                        <i class="el-icon-back"></i>
                        退簽
                      </el-button>
                    </div>
                  </template>
                </el-table-column>
              </el-table>
              <el-pagination
                v-if="inboxPage.paged && inboxPage.total > PAGE_SIZE"
                class="list-pagination"
                background
                layout="total, prev, pager, next"
                :page-size="PAGE_SIZE"
                :total="inboxPage.total"
                :current-page="inboxPage.page"
                @current-change="fetchInbox"
              />
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 3) 我已簽核（所有簽核人；伺服器只回傳自己簽過的單，管理員可看全部） -->
      <el-tab-pane name="history">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-finished"></i>
            <span>我已簽核</span>
          </div>
        </template>

        <div class="tab-content">
          <div class="table-section">
            <h2 class="section-title">歷史簽核紀錄</h2>
            <div class="table-container" v-loading="historyLoading">
              <el-alert
                v-if="historyError"
                type="error"
                :closable="false"
                class="mb-3"
                :title="historyError"
              />
              <el-table
                v-if="historyList.length"
                :data="historyList"
                class="approval-table"
                :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
                :row-style="{ height: '64px' }"
              >
                <el-table-column type="index" label="#" width="60" />
                <el-table-column label="表單名稱" width="240">
                  <template #default="{ row }">
                    <div class="form-name">
                      <i class="el-icon-document"></i>
                      {{ formNameOf(row) }}
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="申請人" width="200">
                  <template #default="{ row }">
                    <div class="applicant-info">
                      <el-avatar :size="32" class="applicant-avatar">
                        {{ (row.applicant_employee?.name || '-').charAt(0) }}
                      </el-avatar>
                      <span>{{ row.applicant_employee?.name || '-' }}</span>
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="決策結果" width="170">
                  <template #default="{ row }">
                    <span>{{ historyDecisionText(row) }}</span>
                    <div v-if="row.pending_approvers?.length" class="history-waiting">
                      等待：{{ row.pending_approvers.map(approverName).join('、') }}
                    </div>
                  </template>
                </el-table-column>
                <el-table-column label="簽核時間" width="200">
                  <template #default="{ row }">
                    {{ fmt(row.oversight ? row.updatedAt : (row.__latest?.decided_at || row.updatedAt)) }}
                  </template>
                </el-table-column>
                <el-table-column prop="comment" label="備註" min-width="220">
                  <template #default="{ row }">
                    <span>{{ row.oversight ? '-' : (row.__latest?.comment || '-') }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" :width="280">
                  <template #default="{ row }">
                    <el-button size="small" @click="openDetail(row._id)">查看</el-button>
                    <template v-if="canOverrideRow(row)">
                      <el-button size="small" type="success" plain @click="openAction(row, 'approve', { override: true })">代為核可</el-button>
                      <el-button size="small" type="danger" plain @click="openAction(row, 'reject', { override: true })">代為否決</el-button>
                      <el-button size="small" plain @click="openAction(row, 'return', { override: true })">代為退簽</el-button>
                    </template>
                    <el-button
                      v-if="canCancelApprovedRow(row)"
                      size="small"
                      type="danger"
                      plain
                      :loading="myActionLoading[row._id]"
                      @click="cancelApprovedFromHistory(row)"
                    >撤回</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <el-empty
                v-else
                description="尚未簽核過任何申請"
                class="history-empty"
              />
              <el-pagination
                v-if="historyPage.paged && historyPage.total > PAGE_SIZE"
                class="list-pagination"
                background
                layout="total, prev, pager, next"
                :page-size="PAGE_SIZE"
                :total="historyPage.total"
                :current-page="historyPage.page"
                @current-change="fetchHistory"
              />
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 4) 我的申請 -->
      <el-tab-pane name="mine">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-user"></i>
            <span>我的申請</span>
          </div>
        </template>

        <div class="tab-content">
          <div class="table-section">
            <h2 class="section-title">申請記錄</h2>
            <div class="table-container">
              <el-alert
                v-if="myError"
                type="error"
                :closable="false"
                class="mb-3"
                :title="myError"
              />
              <el-table
                :data="myList"
                class="approval-table"
                :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
                :row-style="{ height: '64px' }"
                empty-text="目前沒有申請紀錄"
              >
                <el-table-column type="index" label="#" width="60" />
                <el-table-column label="表單名稱" width="240">
                  <template #default="{ row }">{{ formNameOf(row) }}</template>
                </el-table-column>
                <el-table-column label="狀態" width="120">
                  <template #default="{ row }">
                    <el-tag type="warning" v-if="row.status==='pending'">處理中</el-tag>
                    <el-tag type="success" v-else-if="row.status==='approved'">已核可</el-tag>
                    <el-tag type="danger" v-else-if="row.status==='rejected'">已否決</el-tag>
                    <el-tag v-else-if="row.status==='returned'">已退簽</el-tag>
                    <el-tag type="info" v-else-if="row.status==='canceled'">已撤回</el-tag>
                    <span v-else>{{ row.status }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="目前關卡" width="120">
                  <template #default="{ row }">{{ row.current_step_index + 1 }}/{{ row.steps?.length || 0 }}</template>
                </el-table-column>
                <el-table-column label="建立時間" width="180">
                  <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
                </el-table-column>
                <el-table-column label="操作" width="360">
                  <template #default="{ row }">
                    <el-button size="small" @click="openDetail(row._id)">查看</el-button>
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
                  </template>
                </el-table-column>
              </el-table>
              <el-pagination
                v-if="myPage.paged && myPage.total > PAGE_SIZE"
                class="list-pagination"
                background
                layout="total, prev, pager, next"
                :page-size="PAGE_SIZE"
                :total="myPage.total"
                :current-page="myPage.page"
                @current-change="fetchMyList"
              />
            </div>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 詳細 Dialog -->
    <el-dialog v-model="detail.visible" title="申請單明細" width="760px">
      <div v-if="detail.doc">
        <p class="mb-2"><b>表單：</b>{{ detail.doc.form?.name }}（{{ detail.doc.form?.category }}）</p>
        <p class="mb-2"><b>申請人：</b>{{ detail.doc.applicant_employee?.name || '-' }}</p>
        <p class="mb-2"><b>狀態：</b>{{ getStatusText(detail.doc.status) }}</p>
        <el-alert
          v-if="detailReturnInfo"
          type="warning"
          :closable="false"
          show-icon
          class="return-reason-alert mb-2"
        >
          <template #title>
            被退簽{{ detailReturnInfo.by ? `（${detailReturnInfo.by}）` : '' }}：{{ detailReturnInfo.message || '簽核人未填寫原因' }}
          </template>
        </el-alert>
        <el-alert
          v-if="detail.doc.form?.semanticType === 'leave' && detail.doc.leave_balance"
          type="info"
          :closable="false"
          class="leave-balance-alert mb-2"
        >
          <template #title>
            特休餘額：已使用 {{ detail.doc.leave_balance.usedDays }} 天／剩餘 {{ detail.doc.leave_balance.remainingDays }} 天（年度總天數 {{ detail.doc.leave_balance.totalDays }} 天）
          </template>
        </el-alert>
        <el-divider content-position="left">填寫內容</el-divider>
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item
            v-for="fld in detailFieldList"
            :key="fld._id"
            :label="fld.label"
          >
            <template v-if="attachmentItems(detail.doc.form_data?.[fld._id]).length">
              <el-button
                v-for="attachment in attachmentItems(detail.doc.form_data?.[fld._id])"
                :key="attachment.url || attachment.path || attachment.name"
                link
                type="primary"
                size="small"
                @click="downloadApprovalAttachment(attachment)"
              >
                下載 {{ attachmentDisplayName(attachment) }}
              </el-button>
            </template>
            <span v-else>{{ renderValue(detail.doc.form_data?.[fld._id], fld) }}</span>
          </el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">流程</el-divider>
        <el-timeline>
          <el-timeline-item
            v-for="(s, idx) in detail.doc.steps"
            :key="idx"
            :timestamp="`第 ${idx+1} 關`"
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

        <template v-if="detailLogRows.length">
          <el-divider content-position="left">簽核紀錄</el-divider>
          <el-table :data="detailLogRows" size="small" border class="detail-logs">
            <el-table-column prop="time" label="時間" width="160" />
            <el-table-column prop="actor" label="處理人" width="120" />
            <el-table-column prop="action" label="動作" width="130" />
            <el-table-column prop="message" label="說明" />
          </el-table>
        </template>
      </div>
      <template #footer>
        <template v-if="detail.doc?.viewer?.can_override">
          <el-button type="success" plain @click="overrideFromDetail('approve')">代為核可</el-button>
          <el-button type="danger" plain @click="overrideFromDetail('reject')">代為否決</el-button>
          <el-button plain @click="overrideFromDetail('return')">代為退簽</el-button>
        </template>
        <el-button @click="detail.visible=false">關閉</el-button>
      </template>
    </el-dialog>

    <!-- 表單說明 Dialog -->
    <el-dialog v-model="helpDlg.visible" title="表單說明" width="600px">
      <div v-if="helpDlg.forms.length" class="help-content">
        <el-alert
          type="info"
          :closable="false"
          class="mb-3"
        >
          <template #title>
            <div style="font-weight: 600;">💡 如何選擇正確的表單？</div>
          </template>
          <div style="margin-top: 8px; line-height: 1.8;">
            <p style="margin: 0 0 8px 0;">• <strong>請假表單</strong>會自動連接薪資系統，影響您的假勤和薪資計算</p>
            <p style="margin: 0 0 8px 0;">• <strong>加班申請</strong>和<strong>獎金申請</strong>同樣會連接薪資系統</p>
            <p style="margin: 0;">• 其他表單用於特定用途，請依需求選擇</p>
          </div>
        </el-alert>

        <div v-for="form in helpDlg.forms" :key="form._id" class="form-help-item">
          <div class="form-help-header">
            <h3 class="form-help-title">
              <i class="el-icon-document"></i>
              {{ form.name }}
              <el-tag v-if="isPayrollConnectedForm(form)" type="success" size="small">連接薪資</el-tag>
            </h3>
            <el-tag type="info" size="small">{{ form.category }}</el-tag>
          </div>
          <p class="form-help-description">
            {{ form.description || '暫無說明' }}
          </p>
        </div>
      </div>
      <el-empty v-else description="暫無表單說明" />
      <template #footer>
        <el-button @click="helpDlg.visible=false">關閉</el-button>
      </template>
    </el-dialog>

    <!-- 審核動作 Dialog -->
    <el-dialog v-model="actionDlg.visible" :title="actionTitle" width="520px">
      <el-alert
        v-if="actionDlg.override"
        type="warning"
        :closable="false"
        show-icon
        class="mb-3"
        title="您不是這一關的簽核人，系統會在單據上記錄為「管理員代為處理」"
      />
      <el-form label-width="100px">
        <el-form-item label="意見／備註">
          <el-input
            v-model="actionDlg.comment"
            type="textarea"
            :rows="3"
            :placeholder="actionDlg.decision === 'return' ? '請說明退簽原因，申請人會看到這段說明' : '（可留空）'"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="actionDlg.visible=false">取消</el-button>
        <el-button type="primary" :loading="actionDlg.loading" @click="doAction">送出</el-button>
      </template>
    </el-dialog>

    <!-- 被退簽的申請：修改內容後重新送出 -->
    <el-dialog
      v-model="editDlg.visible"
      title="修改並重新送出"
      width="760px"
      :close-on-click-modal="false"
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
        <el-form v-if="editDlg.fields.length" label-width="140px">
          <ApprovalFormFields
            v-model="editDlg.formData"
            v-model:files="editDlg.files"
            :fields="editDlg.fields"
            :kept-attachments="editDlg.kept"
            :user-options="userOptions"
            :dept-options="deptOptions"
            :org-options="orgOptions"
          />
        </el-form>
        <div v-if="editDlg.error" class="error-message">
          <i class="el-icon-warning"></i>
          <div>
            <div>{{ editDlg.error }}</div>
            <ul v-if="editDlg.errorLines.length" class="error-lines">
              <li v-for="(line, i) in editDlg.errorLines" :key="i">{{ line }}</li>
            </ul>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="closeEditDialog">取消</el-button>
        <el-button
          type="primary"
          :loading="editDlg.saving"
          :disabled="editDlg.loading || !editDlg.fields.length"
          @click="submitResubmit"
        >重新送出</el-button>
      </template>
    </el-dialog>

    <!-- 伺服器檢核結果（一條一行） -->
    <el-dialog v-model="errorDlg.visible" :title="errorDlg.title" width="520px">
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
import { ref, reactive, onMounted, onBeforeUnmount, computed, watch } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { apiFetch } from '../../api'
import { useAuthStore } from '../../stores/auth'
import ApprovalFormFields from '../../components/ApprovalFormFields.vue'
import { formatTaipeiDateTime, formatFormValue, normalizeFieldOptions, personNameOrFallback } from '../../utils/approvalDisplay'
import { describeError, readApiError, ApprovalApiError } from '../../utils/approvalErrors'
import {
  attachmentItems,
  attachmentDisplayName,
  downloadApprovalAttachment as downloadAttachmentFile,
  detailFields,
  buildLogRows,
  findReturnInfo,
  getStatusText,
  getStatusTagType,
} from '../../utils/approvalDetail'
import {
  isActiveField,
  isActiveForm,
  buildInitialFormData,
  prefillFormData,
  findMissingRequiredField,
  describeWorkflowApprovers,
  describeUnresolvedStep,
  findLeaveFormId,
  isLeaveForm,
  isPayrollConnectedForm,
} from '../../utils/approvalForm'
import { PAGE_SIZE, pagedListUrl, readListPayload } from '../../utils/approvalList'

/* -------------------- Tabs -------------------- */
const activeTab = ref('inbox')
const authStore = useAuthStore()

/* -------------------- 共用小工具 -------------------- */
const fmt = (d) => formatTaipeiDateTime(d)

/* 人名快取（顯示審核人用） */
const employeeNameCache = reactive({})
const myActionLoading = reactive({})
const nameOfEmployee = (id) => employeeNameCache[id] || ''

// 明細裡的員工 / 部門 / 機構欄位存的是編號，顯示時換成名稱
const optionLabel = (options, id) => options.value.find(o => String(o.value) === String(id))?.label
const valueLookups = {
  user: (id) => employeeNameCache[id],
  department: (id) => optionLabel(deptOptions, id),
  org: (id) => optionLabel(orgOptions, id),
}
const renderValue = (value, field) => formatFormValue(field, value, { lookups: valueLookups })

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
  alert(`${title}：${info.message}`)
}
// 單子已被處理 / 已不存在：畫面上的資料已過期，需要重新整理
const isStaleStatus = (info) => info.status === 404 || info.status === 409

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
const workflowSteps = ref([])
const workflowWarning = ref('')
const fileBuffers = ref({}) // { fieldId: [FileItem...] }
const submitting = ref(false)
const applyError = ref('')
const applyErrorLines = ref([])
const templatesError = ref('')

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
        return { value: id, label: `${e.name}${e.username ? ' ('+e.username+')' : ''}` }
      })
      arr.forEach(e => {
        const id = e.id || e._id
        if (id) employeeNameCache[id] = e.name
      })
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

async function loadFormTemplates() {
  templatesError.value = ''
  try {
    // 停用的表單不提供申請（伺服器端也會過濾；這裡再擋一次以防舊資料）
    const res = await apiFetch('/api/approvals/forms?is_active=true')
    if (!res.ok) throw await readApiError(res)
    const list = await res.json()
    formTemplates.value = (Array.isArray(list) ? list : []).filter(isActiveForm)
  } catch (error) {
    templatesError.value = describeError(error).message
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
      emps.forEach(e => {
        const id = e.id || e._id
        if (id) employeeNameCache[id] = e.name
      })
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

function resetApplyMessages() {
  applyError.value = ''
  applyErrorLines.value = []
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
  if (!applyState.formId) return
  const formId = applyState.formId

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
  } catch (error) {
    if (seq !== selectSeq) return
    applyError.value = `載入表單欄位失敗：${describeError(error).message}`
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
      workflowSteps.value = steps.map((s, idx) => ({
        label: s.name || `第 ${idx + 1} 關`,
        approvers: describeWorkflowApprovers(s, previewLookups),
        warning: describeUnresolvedStep(s),
      }))
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
  if (hasTypedInput() && typeof window !== 'undefined' && !window.confirm('重新載入會清除目前已填寫的內容，確定要重新載入嗎？')) return
  // 同時更新表單清單，管理員新增 / 停用的表單不必重新整理整頁
  await loadFormTemplates()
  if (!formTemplates.value.some(t => t._id === applyState.formId)) {
    applyState.formId = ''
  }
  await onSelectForm()
}

// 送出成功後把申請表單整個清空，避免再按一次送出就重複建立
function resetApplyForm() {
  selectSeq += 1
  applyState.formId = ''
  applyState.formData = {}
  fieldList.value = []
  workflowSteps.value = []
  workflowWarning.value = ''
  fileBuffers.value = {}
  uploadCache.clear()
  resetApplyMessages()
  approvalSubmissionKey = createSubmissionKey()
}

// options 可為陣列或物件；統一轉成 [{label, value}]（欄位元件也用同一個函式）
const getOptions = (field) => normalizeFieldOptions(field)

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
    alert('請先選擇表單樣板')
    return
  }
  submitting.value = true
  resetApplyMessages()
  try {
    // 先在本機檢查必填，通過了才上傳附件
    const missing = findMissingRequiredField(fieldList.value, applyState.formData, fileBuffers.value)
    if (missing) throw new Error(`請填寫必填欄位：${missing.label}`)

    const payloadData = { ...applyState.formData }
    for (const fid of Object.keys(fileBuffers.value)) {
      const files = fileBuffers.value[fid] || []
      payloadData[fid] = Array.isArray(files) && files.length
        ? await uploadFieldFiles(fid, files)
        : []
    }

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

    resetApplyForm()
    alert('送出申請成功！')
    activeTab.value = 'mine'
  } catch (error) {
    const info = describeError(error, '送出失敗，請稍後再試')
    applyError.value = info.message
    applyErrorLines.value = info.lines
    showFailure('送出失敗', info)
  } finally {
    submitting.value = false
  }
}

/* 有選好卻還沒送出的附件：離開頁面前提醒 */
const hasUnsentFiles = computed(() => (
  Object.values(fileBuffers.value || {}).some(list => Array.isArray(list) && list.length > 0)
))
function onBeforeUnload(event) {
  if (!hasUnsentFiles.value) return undefined
  event.preventDefault()
  event.returnValue = ''
  return ''
}
onBeforeRouteLeave(() => {
  if (!hasUnsentFiles.value) return true
  return window.confirm('您選擇的附件還沒有送出，離開後會被清除，確定要離開嗎？')
})

/* -------------------- 待我簽核 -------------------- */
const inboxList = ref([])
const inboxError = ref('')
const inboxPage = reactive({ page: 1, total: 0, paged: false })
const inboxCount = computed(() => (inboxPage.paged ? inboxPage.total : inboxList.value.length))

// 該關卡允許退簽才顯示退簽按鈕
const canReturnRow = (row) => !!row?.steps?.[row.current_step_index]?.can_return

async function fetchPagedList(path, pageState, page) {
  const res = await apiFetch(pagedListUrl(path, page))
  if (!res.ok) throw await readApiError(res)
  const parsed = readListPayload(await res.json(), page)
  pageState.page = parsed.page
  pageState.total = parsed.total
  pageState.paged = parsed.paged
  return parsed
}

async function fetchInbox(page = inboxPage.page) {
  inboxError.value = ''
  try {
    const parsed = await fetchPagedList('/api/approvals/inbox', inboxPage, page)
    // 該頁已經沒資料（最後一筆剛處理掉）就退回上一頁
    if (!parsed.items.length && parsed.paged && parsed.page > 1) return await fetchInbox(parsed.page - 1)
    const toTime = (val) => {
      const time = new Date(val ?? 0).getTime()
      return Number.isFinite(time) ? time : 0
    }
    const sortedList = [...parsed.items].sort((a, b) => toTime(b?.createdAt) - toTime(a?.createdAt))
    inboxList.value = sortedList
    // 快取審核者名字
    sortedList.forEach(doc => {
      (doc.steps?.[doc.current_step_index]?.approvers || []).forEach(a => {
        if (a.approver && a.approver.name) employeeNameCache[a.approver._id] = a.approver.name
      })
    })
  } catch (error) {
    inboxError.value = `載入待簽核清單失敗：${describeError(error).message}`
  }
  return undefined
}

/* 審核動作 Dialog */
const actionDlg = reactive({ visible: false, loading: false, decision: 'approve', comment: '', target: null, override: false, fromDetail: false })
const actionTitle = computed(() => {
  const verb = actionDlg.decision === 'approve' ? '核可' : (actionDlg.decision === 'reject' ? '否決' : '退簽')
  return actionDlg.override ? `管理員代為${verb}` : verb
})

function openAction(row, decision, { override = false, fromDetail = false } = {}) {
  actionDlg.visible = true
  actionDlg.decision = decision
  actionDlg.comment = ''
  actionDlg.target = row
  actionDlg.override = override
  actionDlg.fromDetail = fromDetail
}

// 管理員可代為處理任何進行中的單（伺服器會在單據上記錄 admin_override）
const canOverrideRow = (row) => row?.oversight === true && row?.status === 'pending'
function overrideFromDetail(decision) {
  const target = detail.doc
  if (!target) return
  detail.visible = false
  openAction(target, decision, { override: true, fromDetail: true })
}

// 歷史清單：自己簽過的單顯示自己的決定；管理員檢視他人的單則顯示單據目前狀態
const historyDecisionText = (row) => (
  row?.oversight ? getStatusText(row.status) : getStatusText(row?.__latest?.decision || row?.status)
)

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
  // 退簽沒寫原因，申請人就不知道要改什麼，送出前再確認一次
  if (
    actionDlg.decision === 'return' &&
    !String(actionDlg.comment || '').trim() &&
    typeof window !== 'undefined' &&
    !window.confirm('尚未填寫退簽原因，申請人將不知道要修改什麼，仍要退簽嗎？')
  ) return
  const target = actionDlg.target
  const fromDetail = actionDlg.fromDetail
  actionDlg.loading = true
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
    actionDlg.visible = false
    await refreshAfterAction()
    alert(['已送出！', ...warningLines(result)].join('\n'))
  } catch (error) {
    const info = describeError(error)
    // 單子已被別人處理 / 不存在時關閉對話框，並重新整理清單
    if (isStaleStatus(info)) actionDlg.visible = false
    await refreshAfterAction()
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
const myPage = reactive({ page: 1, total: 0, paged: false })

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
const historyPage = reactive({ page: 1, total: 0, paged: false })

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

async function fetchHistory(page = historyPage.page) {
  historyLoading.value = true
  historyError.value = ''
  try {
    const parsed = await fetchPagedList('/api/approvals/history', historyPage, page)
    if (!parsed.items.length && parsed.paged && parsed.page > 1) return await fetchHistory(parsed.page - 1)
    const sorted = [...parsed.items].sort((a, b) => {
      const latestA = extractLatestApproval(a)
      const latestB = extractLatestApproval(b)
      const timeA = new Date(latestA?.decided_at || 0).getTime()
      const timeB = new Date(latestB?.decided_at || 0).getTime()
      return timeB - timeA
    })
    historyList.value = sorted.map(item => ({
      ...item,
      __latest: extractLatestApproval(item)
    }))
    historyLoaded.value = true
  } catch (error) {
    const info = describeError(error)
    historyList.value = []
    historyError.value = info.status === 401 || info.status === 403
      ? '您沒有權限查看歷史簽核紀錄'
      : `載入歷史簽核失敗：${info.message}`
  } finally {
    historyLoading.value = false
  }
  return undefined
}

async function fetchMyList(page = myPage.page) {
  myError.value = ''
  try {
    const parsed = await fetchPagedList('/api/approvals', myPage, page)
    if (!parsed.items.length && parsed.paged && parsed.page > 1) return await fetchMyList(parsed.page - 1)
    myList.value = parsed.items
  } catch (error) {
    myError.value = `載入申請記錄失敗：${describeError(error).message}`
  }
  return undefined
}

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
// 管理員可在「我已簽核」撤回已核可的請假單（特休天數會返還）
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

// 已核可的單撤回成功時，把伺服器記下的結果（例如返還幾天特休）告訴使用者
function announceApprovedCancel(result) {
  const logs = Array.isArray(result?.logs) ? result.logs : []
  const message = String(logs[logs.length - 1]?.message || '').trim()
  alert(message || '已撤回')
}

async function cancelMyRequest(row) {
  const wasApproved = row?.status === 'approved'
  const question = wasApproved
    ? '這筆請假已經核可，確定要撤回嗎？若是特休，已扣除的天數會一併返還。'
    : '確定撤回這筆申請？'
  if (typeof window !== 'undefined' && !window.confirm(question)) return
  const result = await runMyRequestAction(row, 'cancel')
  if (wasApproved && result) announceApprovedCancel(result)
}

// 管理員從「我已簽核」撤回已核可的請假單：成功後歷史與我的申請都重新載入
async function cancelApprovedFromHistory(row) {
  if (typeof window !== 'undefined' && !window.confirm('這筆請假已經核可，確定要撤回嗎？若是特休，已扣除的天數會一併返還。')) return
  const result = await runMyRequestAction(row, 'cancel', () => Promise.all([fetchHistory(), fetchMyList()]))
  if (result) announceApprovedCancel(result)
}

/* 被退簽的申請：帶入原本內容讓申請人修改後再重新送出 */
const editDlg = reactive({
  visible: false,
  loading: false,
  saving: false,
  requestId: '',
  fields: [],
  formData: {},
  files: {},
  kept: {},
  returnInfo: null,
  error: '',
  errorLines: [],
})
let editSeq = 0

function clearEditDialog() {
  editDlg.fields = []
  editDlg.formData = {}
  editDlg.files = {}
  editDlg.kept = {}
  editDlg.returnInfo = null
  editDlg.error = ''
  editDlg.errorLines = []
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
  try {
    const keptFlags = {}
    for (const [fid, list] of Object.entries(editDlg.kept)) keptFlags[fid] = list.length > 0
    const missing = findMissingRequiredField(editDlg.fields, editDlg.formData, editDlg.files, keptFlags)
    if (missing) throw new Error(`請填寫必填欄位：${missing.label}`)

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
    alert(['已重新送出！', ...warningLines(result)].join('\n'))
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

/* -------------------- 詳細 Dialog -------------------- */
const detail = reactive({ visible: false, doc: null })
let detailSeq = 0

const detailFieldList = computed(() => (detail.doc ? detailFields(detail.doc) : []))
const detailLogRows = computed(() => (detail.doc ? buildLogRows(detail.doc, nameOfEmployee) : []))
const detailReturnInfo = computed(() => (detail.doc ? findReturnInfo(detail.doc, nameOfEmployee) : null))

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
        if (a.approver?._id && a.approver?.name) employeeNameCache[a.approver._id] = a.approver.name
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
  await Promise.all([loadFormTemplates(), fetchUsersLite(), fetchDepts(), fetchOrgs()])
  // 預設進待我簽核
  await Promise.all([fetchInbox(), fetchMyList()])
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onBeforeUnload)
})

watch(activeTab, async (tab) => {
  if (tab === 'apply') {
    // 管理員新增 / 停用表單後，回到申請頁就能看到最新的表單清單
    await loadFormTemplates()
  } else if (tab === 'inbox') {
    await fetchInbox()
  } else if (tab === 'mine') {
    await fetchMyList()
  } else if (tab === 'history') {
    await fetchHistory()
  }
})
</script>

<style scoped>
.approval-page {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0;
}

/* 頁面標題 */
.page-header {
  background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
  color: white;
  padding: 32px;
  border-radius: 16px;
  margin-bottom: 32px;
  text-align: center;
  box-shadow: 0 4px 20px rgba(22, 78, 99, 0.3);
}

.page-title {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px 0;
  letter-spacing: 0.5px;
}

.page-description {
  font-size: 16px;
  opacity: 0.9;
  margin: 0;
}

/* 標籤頁樣式 */
.approval-tabs {
  background: white;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  overflow: hidden;
}

.tab-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.tab-badge {
  margin-left: 4px;
}

.tab-content {
  padding: 32px;
}

/* 區段標題 */
.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 24px 0;
  padding-left: 16px;
  border-left: 4px solid #10b981;
}

/* 表單區域 */
.form-card {
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.template-selector .selector-row {
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
}

.form-select {
  min-width: 300px;
  flex: 1;
}

.reload-btn, .quick-btn {
  display: flex;
  align-items: center;
  gap: 6px;
}

.divider-text {
  font-weight: 600;
  color: #475569;
}

.form-fields {
  background: #f8fafc;
  padding: 24px;
  border-radius: 8px;
  margin-bottom: 24px;
}

/* 工作流程預覽 */
.workflow-steps {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.workflow-step {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background: #f1f5f9;
  border-radius: 8px;
}

.step-number {
  width: 32px;
  height: 32px;
  background: #10b981;
  color: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  flex-shrink: 0;
}

.step-content {
  flex: 1;
}

.step-title {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 4px 0;
}

.step-approvers {
  font-size: 14px;
  color: #64748b;
  margin: 0;
}

/* 表單操作 */
.form-actions {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-top: 24px;
  border-top: 1px solid #e2e8f0;
}

.submit-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 32px;
  border-radius: 8px;
  font-weight: 600;
}

.error-message {
  color: #dc2626;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 14px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #64748b;
}

.empty-state i {
  font-size: 48px;
  margin-bottom: 16px;
  display: block;
}

/* 表格區域 */
.table-container {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.approval-table {
  width: 100%;
}

.form-name {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.applicant-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.applicant-avatar {
  background: #10b981;
  color: white;
  font-weight: 600;
}

.status-tag {
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
}

.progress-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.progress-text {
  font-size: 12px;
  color: #64748b;
  text-align: center;
}

.progress-bar {
  width: 80px;
}

.time-info {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #64748b;
}

.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-buttons .el-button {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  font-size: 12px;
}

/* 表單說明樣式 */
.help-content {
  max-height: 500px;
  overflow-y: auto;
}

.form-help-item {
  padding: 16px;
  margin-bottom: 12px;
  background: #f8fafc;
  border-radius: 8px;
  border-left: 4px solid #10b981;
}

.form-help-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.form-help-title {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.form-help-description {
  font-size: 14px;
  color: #64748b;
  line-height: 1.6;
  margin: 0;
}

.help-btn {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mb-3 {
  margin-bottom: 16px;
}

/* 下拉式選單中的薪資連接標記 */
.option-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  gap: 8px;
}

.option-label {
  flex: 1;
}

.payroll-tag {
  flex-shrink: 0;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.payroll-connected-option {
  background-color: #f0fdf4 !important;
  border-left: 3px solid #10b981 !important;
}

.payroll-connected-option:hover {
  background-color: #dcfce7 !important;
}

.history-waiting {
  font-size: 12px;
  color: #64748b;
  margin-top: 2px;
}

.step-warning {
  font-size: 13px;
  color: #d97706;
  margin: 4px 0 0 0;
}

.error-lines {
  margin: 6px 0 0 0;
  padding-left: 20px;
  line-height: 1.7;
}

.error-dialog-message {
  margin: 0 0 8px 0;
  font-weight: 600;
  color: #dc2626;
}

.list-pagination {
  justify-content: flex-end;
  padding: 16px;
}

/* 響應式設計 */
@media (max-width: 768px) {
  .tab-content {
    padding: 16px;
  }
  
  .selector-row {
    flex-direction: column;
    align-items: stretch;
  }
  
  .form-select {
    min-width: auto;
  }
  
  .workflow-steps {
    gap: 12px;
  }
  
  .workflow-step {
    padding: 12px;
  }
  
  .action-buttons {
    flex-direction: column;
    gap: 4px;
  }
}
</style>
