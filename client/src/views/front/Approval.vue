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
                        :class="{ 'payroll-connected-option': PAYROLL_CONNECTED_FORMS.includes(f.name) }"
                      >
                        <span class="option-content">
                          <span class="option-label">{{ f.name }}（{{ f.category }}）</span>
                          <el-tag 
                            v-if="PAYROLL_CONNECTED_FORMS.includes(f.name)" 
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
                    <template v-for="fld in fieldList" :key="fld._id">
                      <el-form-item 
                        :label="fld.label" 
                        :required="!!fld.required"
                        class="form-field"
                      >
                        <!-- text -->
                        <el-input 
                          v-if="fld.type_1==='text'" 
                          v-model="applyState.formData[fld._id]" 
                          :placeholder="fld.placeholder || ''" 
                          class="field-input"
                        />

                        <!-- textarea -->
                        <el-input
                          v-else-if="fld.type_1==='textarea'"
                          type="textarea"
                          :rows="4"
                          v-model="applyState.formData[fld._id]"
                          :placeholder="fld.placeholder || ''"
                          class="field-textarea"
                        />

                        <!-- number -->
                        <el-input-number v-else-if="fld.type_1==='number'" v-model="applyState.formData[fld._id]" :min="0" :step="1" />

                        <!-- select -->
                        <el-select
                          v-else-if="fld.type_1==='select'"
                          v-model="applyState.formData[fld._id]"
                          filterable
                          :placeholder="fld.placeholder || '請選擇'"
                          style="width: 320px"
                        >
                          <el-option
                            v-for="opt in getOptions(fld)"
                            :key="opt.value"
                            :label="opt.label"
                            :value="opt.value"
                          />
                        </el-select>

                        <!-- checkbox -->
                        <el-checkbox-group v-else-if="fld.type_1==='checkbox'" v-model="applyState.formData[fld._id]">
                          <el-checkbox v-for="opt in getOptions(fld)" :key="opt.value" :label="opt.value">{{ opt.label }}</el-checkbox>
                        </el-checkbox-group>

                        <!-- date / time / datetime -->
                        <el-date-picker
                          v-else-if="fld.type_1==='date'"
                          v-model="applyState.formData[fld._id]"
                          type="date"
                          style="width: 220px"
                        />
                        <el-time-picker
                          v-else-if="fld.type_1==='time'"
                          v-model="applyState.formData[fld._id]"
                          style="width: 220px"
                        />
                        <el-date-picker
                          v-else-if="fld.type_1==='datetime'"
                          v-model="applyState.formData[fld._id]"
                          type="datetime"
                          style="width: 260px"
                        />

                        <el-upload
                          v-else-if="fld.type_1==='file'"
                          :auto-upload="false"
                          v-model:file-list="fileBuffers[fld._id]"
                          list-type="text"
                          multiple
                          :limit="5"
                          accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp"
                        >
                          <el-button>選擇檔案</el-button>
                        </el-upload>

                        <!-- user / department / org -->
                        <el-select
                          v-else-if="fld.type_1==='user'"
                          v-model="applyState.formData[fld._id]"
                          filterable
                          style="width: 320px"
                          placeholder="選擇員工"
                        >
                          <el-option v-for="u in userOptions" :key="u.value" :label="u.label" :value="u.value" />
                        </el-select>

                        <el-select
                          v-else-if="fld.type_1==='department'"
                          v-model="applyState.formData[fld._id]"
                          filterable
                          style="width: 320px"
                          placeholder="選擇部門"
                        >
                          <el-option v-for="d in deptOptions" :key="d.value" :label="d.label" :value="d.value" />
                        </el-select>

                        <el-select
                          v-else-if="fld.type_1==='org'"
                          v-model="applyState.formData[fld._id]"
                          filterable
                          style="width: 320px"
                          placeholder="選擇機構"
                        >
                          <el-option v-for="o in orgOptions" :key="o.value" :label="o.label" :value="o.value" />
                        </el-select>

                        <!-- fallback -->
                        <el-input v-else v-model="applyState.formData[fld._id]" :placeholder="fld.placeholder || ''" />
                      </el-form-item>
                    </template>
                  </div>

                  <div v-if="workflowSteps.length" class="workflow-preview">
                    <el-divider content-position="left">
                      <span class="divider-text">簽核流程預覽</span>
                    </el-divider>
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
                      {{ applyError }}
                    </div>
                  </div>
                </div>

                <div v-else class="empty-state">
                  <i class="el-icon-document"></i>
                  <p>請先選擇一個表單樣板開始申請</p>
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
            <el-badge v-if="inboxList.length" :value="inboxList.length" class="tab-badge" />
          </div>
        </template>
        
        <div class="tab-content">
          <div class="table-section">
            <h2 class="section-title">待處理申請</h2>
            <div class="table-container">
              <el-table 
                :data="inboxList" 
                class="approval-table"
                :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
                :row-style="{ height: '64px' }"
              >
                <el-table-column label="#" width="60" type="index" />
                <el-table-column label="表單名稱" width="220">
                  <template #default="{ row }">
                    <div class="form-name">
                      <i class="el-icon-document"></i>
                      {{ row.form?.name || '-' }}
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
                      <el-button size="small" @click="openAction(row, 'return')" class="return-btn">
                        <i class="el-icon-back"></i>
                        退簽
                      </el-button>
                    </div>
                  </template>
                </el-table-column>
              </el-table>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 3) 我已簽核（主管／管理員） -->
      <el-tab-pane v-if="canViewHistory" name="history">
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
                      {{ row.form?.name || '-' }}
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
                <el-table-column label="決策結果" width="150">
                  <template #default="{ row }">
                    <span>{{ getStatusText(row.__latest?.decision) }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="簽核時間" width="200">
                  <template #default="{ row }">
                    {{ fmt(row.__latest?.decided_at) }}
                  </template>
                </el-table-column>
                <el-table-column prop="comment" label="備註" min-width="220">
                  <template #default="{ row }">
                    <span>{{ row.__latest?.comment || '-' }}</span>
                  </template>
                </el-table-column>
                <el-table-column label="操作" width="120">
                  <template #default="{ row }">
                    <el-button size="small" @click="openDetail(row._id)">查看</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <el-empty
                v-else
                description="尚未簽核過任何申請"
                class="history-empty"
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
              <el-table 
                :data="myList" 
                class="approval-table"
                :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
                :row-style="{ height: '64px' }"
              >
                <el-table-column type="index" label="#" width="60" />
                <el-table-column label="表單名稱" width="240">
                  <template #default="{ row }">{{ row.form?.name || formNameCache[row._id] || '-' }}</template>
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
                <el-table-column label="操作" width="260">
                  <template #default="{ row }">
                    <el-button size="small" @click="openDetail(row._id)">查看</el-button>
                    <el-button
                      v-if="row.status === 'returned'"
                      size="small"
                      type="primary"
                      :loading="myActionLoading[row._id]"
                      @click="resubmitMyRequest(row)"
                    >重新送出</el-button>
                    <el-button
                      v-if="row.status === 'pending' || row.status === 'returned'"
                      size="small"
                      type="danger"
                      plain
                      :loading="myActionLoading[row._id]"
                      @click="cancelMyRequest(row)"
                    >撤回</el-button>
                  </template>
                </el-table-column>
              </el-table>
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
      </div>
      <template #footer>
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
              <el-tag v-if="PAYROLL_CONNECTED_FORMS.includes(form.name)" type="success" size="small">連接薪資</el-tag>
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
      <el-form label-width="100px">
        <el-form-item label="意見／備註">
          <el-input v-model="actionDlg.comment" type="textarea" :rows="3" placeholder="（可留空）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="actionDlg.visible=false">取消</el-button>
        <el-button type="primary" :loading="actionDlg.loading" @click="doAction">送出</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { apiFetch } from '../../api'
import { useAuthStore } from '../../stores/auth'

/* -------------------- Constants -------------------- */
// Forms that automatically connect to payroll system
const PAYROLL_CONNECTED_FORMS = ['請假', '加班申請', '獎金申請']

/* -------------------- Tabs -------------------- */
const activeTab = ref('inbox')
const authStore = useAuthStore()
const canViewHistory = computed(() => ['manager', 'admin'].includes(authStore.role))

/* -------------------- 共用小工具 -------------------- */
const fmt = (d) => (d ? new Date(d).toLocaleString() : '-')
const renderValue = (v) => Array.isArray(v) ? v.join(', ') : (v ?? '-')

/* 人名快取（顯示審核人用） */
const employeeNameCache = reactive({})
const myActionLoading = reactive({})
function approverName(emp) {
  if (emp && typeof emp === 'object') {
    const id = emp._id || emp.employeeId || ''
    return emp.name || employeeNameCache[id] || id
  }
  return employeeNameCache[emp] || emp
}

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
const leaveFormId = computed(() => {
  const f = formTemplates.value.find(t => t.name === '請假')
  return f?._id || ''
})
function selectLeave() {
  if (leaveFormId.value) {
    applyState.formId = leaveFormId.value
    onSelectForm(leaveFormId.value)
  }
}
const fieldList = ref([])
const workflowSteps = ref([])
const fileBuffers = ref({}) // { fieldId: [FileItem...] }
const submitting = ref(false)
const applyError = ref('')

/* options 資料 */
const userOptions = ref([])
const deptOptions = ref([])
const orgOptions = ref([])

async function fetchUsersLite() {
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
}
async function fetchDepts() {
  const res = await apiFetch('/api/departments')
  if (res.ok) {
    const arr = await res.json()
    deptOptions.value = arr.map(d => ({ value: d._id || d.code || d.name, label: d.name }))
  }
}
async function fetchOrgs() {
  const res = await apiFetch('/api/organizations')
  if (res.ok) {
    const arr = await res.json()
    orgOptions.value = arr.map(o => ({ value: o._id || o.code || o.name, label: o.name }))
  }
}

async function loadFormTemplates() {
  const res = await apiFetch('/api/approvals/forms')
  if (res.ok) formTemplates.value = await res.json()
}

async function ensureEmployeeCache(ids) {
  const arr = Array.isArray(ids) ? ids : [ids]
  const missing = arr.filter(id => !employeeNameCache[id])
  if (!missing.length) return
  const res = await apiFetch('/api/employees/options')
  if (res.ok) {
    const emps = await res.json()
    emps.forEach(e => {
      const id = e.id || e._id
      if (id) employeeNameCache[id] = e.name
    })
  }
}

async function onSelectForm() {
  fieldList.value = []
  applyState.formData = {}
  fileBuffers.value = {}
  workflowSteps.value = []
  if (!applyState.formId) return
  const res = await apiFetch(`/api/approvals/forms/${applyState.formId}/fields`)
  if (res.ok) {
    const arr = await res.json()
    fieldList.value = (arr || []).sort((a,b)=> (a.order||0)-(b.order||0))
    // 初始化表單資料
    fieldList.value.forEach(f => {
      if (f.type_1 === 'checkbox') applyState.formData[f._id] = []
      else applyState.formData[f._id] = ''
    })
  }
  const wfRes = await apiFetch(`/api/approvals/forms/${applyState.formId}/workflow`)
  if (wfRes.ok) {
    const wf = await wfRes.json()
    workflowSteps.value = await Promise.all(
      (wf.steps || []).map(async (s, idx) => {
        let approvers = ''
        if (s.approver_type === 'user') {
          await ensureEmployeeCache(s.approver_value)
          const ids = Array.isArray(s.approver_value) ? s.approver_value : [s.approver_value]
          approvers = ids.map(id => employeeNameCache[id] || id).join(', ')
        } else {
          const val = Array.isArray(s.approver_value) ? s.approver_value.join(', ') : s.approver_value
          approvers = `${s.approver_type}${val ? '：' + val : ''}`
        }
        return { label: s.name || `第 ${idx + 1} 關`, approvers }
      })
    )
  }
}
function reloadSelectedForm() {
  if (applyState.formId) onSelectForm()
}

function getOptions(field) {
  // options 可為陣列或物件；這裡統一轉成 [{label, value}]
  const opt = field.options
  if (!opt) return []
  if (Array.isArray(opt)) {
    return opt.map(v => (typeof v === 'string' ? { label: v, value: v } : { label: v.label ?? v.value, value: v.value ?? v.label }))
  }
  return Object.entries(opt).map(([k, v]) => ({ label: String(v), value: String(k) }))
}

async function submitApply() {
  if (!applyState.formId) {
    alert('請先選擇表單樣板')
    return
  }
  submitting.value = true
  try {
    applyError.value = ''
    for (const field of fieldList.value) {
      if (!field.required || field.type_1 === 'checkbox') continue
      const value = field.type_1 === 'file'
        ? fileBuffers.value[field._id]
        : applyState.formData[field._id]
      const empty = value == null
        || (typeof value === 'string' && value.trim() === '')
        || (Array.isArray(value) && value.length === 0)
      if (empty) throw new Error(`請填寫必填欄位：${field.label}`)
    }

    const payloadData = { ...applyState.formData }
    for (const fid of Object.keys(fileBuffers.value)) {
      const files = fileBuffers.value[fid] || []
      if (!Array.isArray(files) || !files.length) {
        payloadData[fid] = []
        continue
      }
      const uploadBody = new FormData()
      files.forEach(file => {
        const rawFile = file?.raw || file
        if (rawFile instanceof File) uploadBody.append('files', rawFile)
      })
      const uploadRes = await apiFetch('/api/approvals/attachments', {
        method: 'POST',
        body: uploadBody
      })
      const uploadResult = await uploadRes.json().catch(() => ({}))
      if (!uploadRes.ok) throw new Error(uploadResult.error || '附件上傳失敗')
      payloadData[fid] = uploadResult.files || []
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
    if (res.ok) {
      approvalSubmissionKey = createSubmissionKey()
      alert('送出申請成功！')
      activeTab.value = 'mine'
      await fetchMyList()
    } else {
      const e = await res.json().catch(()=> ({}))
      throw new Error(e.error || `HTTP ${res.status}`)
    }
  } catch (error) {
    applyError.value = error?.message || '送出失敗'
    alert(`送出失敗：${applyError.value}`)
  } finally {
    submitting.value = false
  }
}

/* -------------------- 待我簽核 -------------------- */
const inboxList = ref([])

async function fetchInbox() {
  const res = await apiFetch('/api/approvals/inbox')
  if (res.ok) {
    const arr = await res.json()
    const toTime = (val) => {
      const time = new Date(val ?? 0).getTime()
      return Number.isFinite(time) ? time : 0
    }
    const sortedList = Array.isArray(arr)
      ? [...arr].sort((a, b) => toTime(b?.createdAt) - toTime(a?.createdAt))
      : []
    inboxList.value = sortedList
    // 快取審核者名字
    sortedList.forEach(doc => {
      (doc.steps?.[doc.current_step_index]?.approvers || []).forEach(a => {
        if (a.approver && a.approver.name) employeeNameCache[a.approver._id] = a.approver.name
      })
    })
  }
}

/* 審核動作 Dialog */
const actionDlg = reactive({ visible: false, loading: false, decision: 'approve', comment: '', target: null })
const actionTitle = computed(() => actionDlg.decision === 'approve' ? '核可' : (actionDlg.decision === 'reject' ? '否決' : '退簽'))

function openAction(row, decision) {
  actionDlg.visible = true
  actionDlg.decision = decision
  actionDlg.comment = ''
  actionDlg.target = row
}

async function doAction() {
  if (!actionDlg.target) return
  actionDlg.loading = true
  try {
    const res = await apiFetch(`/api/approvals/${actionDlg.target._id}/act`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: actionDlg.decision, comment: actionDlg.comment })
    })
    if (res.ok) {
      actionDlg.visible = false
      await fetchInbox()
      if (canViewHistory.value) await fetchHistory()
      alert('已送出！')
    } else {
      const e = await res.json().catch(()=> ({}))
      alert(`動作失敗：${e.error || res.status}`)
    }
  } finally {
    actionDlg.loading = false
  }
}

/* -------------------- 我的申請 -------------------- */
const myList = ref([])
const formNameCache = reactive({})

/* -------------------- 我已簽核 -------------------- */
const historyList = ref([])
const historyLoading = ref(false)
const historyError = ref('')

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

async function fetchHistory() {
  if (!canViewHistory.value) {
    historyList.value = []
    historyError.value = ''
    return
  }
  historyLoading.value = true
  historyError.value = ''
  try {
    const res = await apiFetch('/api/approvals/history')
    if (res.ok) {
      const arr = await res.json()
      const sorted = Array.isArray(arr)
        ? [...arr].sort((a, b) => {
            const latestA = extractLatestApproval(a)
            const latestB = extractLatestApproval(b)
            const timeA = new Date(latestA?.decided_at || 0).getTime()
            const timeB = new Date(latestB?.decided_at || 0).getTime()
            return timeB - timeA
          })
        : []
      historyList.value = sorted.map(item => ({
        ...item,
        __latest: extractLatestApproval(item)
      }))
    } else if (res.status === 401 || res.status === 403) {
      historyList.value = []
      historyError.value = '您沒有權限查看歷史簽核紀錄'
      alert(historyError.value)
    } else {
      historyError.value = `載入歷史簽核失敗（HTTP ${res.status}）`
    }
  } catch (err) {
    historyError.value = err?.message || '載入歷史簽核失敗'
  } finally {
    historyLoading.value = false
  }
}

async function fetchMyList() {
  const res = await apiFetch('/api/approvals')
  if (res.ok) {
    myList.value = await res.json()
    // 取每筆的 form 名稱（明細才有 populate）
    await Promise.all(
      myList.value.map(async (row) => {
        if (!row.form || !row.form.name) {
          const r = await apiFetch(`/api/approvals/${row._id}`)
          if (r.ok) {
            const full = await r.json()
            formNameCache[row._id] = full?.form?.name || ''
          }
        }
      })
    )
  }
}

async function runMyRequestAction(row, action) {
  if (!row?._id || myActionLoading[row._id]) return
  myActionLoading[row._id] = true
  try {
    const response = await apiFetch(`/api/approvals/${row._id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
    await fetchMyList()
  } catch (error) {
    alert(error?.message || '操作失敗')
  } finally {
    myActionLoading[row._id] = false
  }
}

function resubmitMyRequest(row) {
  return runMyRequestAction(row, 'resubmit')
}

function cancelMyRequest(row) {
  if (typeof window !== 'undefined' && !window.confirm('確定撤回這筆申請？')) return
  return runMyRequestAction(row, 'cancel')
}

/* -------------------- 詳細 Dialog -------------------- */
const detail = reactive({ visible: false, doc: null })

async function openDetail(id) {
  detail.visible = false
  detail.doc = null
  const res = await apiFetch(`/api/approvals/${id}`)
  if (res.ok) {
    const data = await res.json()
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
  }
}

/* -------------------- 表單說明 -------------------- */
const helpDlg = reactive({ visible: false, forms: [] })

function showFormHelp() {
  helpDlg.forms = formTemplates.value.map(f => ({
    _id: f._id,
    name: f.name,
    category: f.category,
    description: f.description || ''
  }))
  helpDlg.visible = true
}

/* -------------------- 自動檢查並生成請假表單 -------------------- */
async function ensureLeaveFormExists() {
  try {
    const res = await apiFetch('/api/approvals/ensure-leave-form', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    if (res.ok) {
      const result = await res.json()
      if (result.generated) {
        console.log('Leave form was auto-generated')
        // Reload form templates to include the new leave form
        await loadFormTemplates()
      }
    }
  } catch (err) {
    console.warn('Failed to ensure leave form exists:', err)
  }
}

/* -------------------- 初始化 -------------------- */
onMounted(async () => {
  authStore.loadUser()
  await ensureLeaveFormExists() // Auto-check and generate leave form if needed
  await Promise.all([loadFormTemplates(), fetchUsersLite(), fetchDepts(), fetchOrgs()])
  // 預設進待我簽核
  await Promise.all([fetchInbox(), fetchMyList()])
  if (canViewHistory.value) await fetchHistory()
})

watch(activeTab, async (tab) => {
  if (tab === 'inbox') {
    await fetchInbox()
  } else if (tab === 'mine') {
    await fetchMyList()
  } else if (tab === 'history' && canViewHistory.value) {
    await fetchHistory()
  }
})

watch(canViewHistory, async (val) => {
  if (!val) {
    historyList.value = []
  } else if (activeTab.value === 'history') {
    await fetchHistory()
  }
})

function getStatusTagType(status) {
  const typeMap = {
    'pending': 'warning',
    'approved': 'success', 
    'rejected': 'danger',
    'returned': 'info',
    'canceled': 'info'
  }
  return typeMap[status] || 'default'
}

function getStatusText(status) {
  const textMap = {
    'pending': '待簽核',
    'approved': '已核可',
    'rejected': '已否決', 
    'returned': '已退簽',
    'canceled': '已撤回'
  }
  return textMap[status] || status
}
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

.form-field {
  margin-bottom: 20px;
}

.field-input, .field-textarea {
  border-radius: 8px;
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
  align-items: center;
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
