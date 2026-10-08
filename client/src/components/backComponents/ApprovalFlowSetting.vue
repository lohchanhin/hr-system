<!-- src/Components/backComponents/ApprovalFlowSetting.vue -->
<template>
  <div class="approval-flow-setting">
    <h2>簽核流程設定</h2>

    <el-tabs v-model="activeTab" type="card">
      <!-- 1) 通用流程規則（針對選定的表單樣板） -->
      <el-tab-pane label="通用流程規則" name="commonRule">
        <div class="flex items-center gap-2 mb-2">
          <span class="template-select-label">表單樣板</span>
          <el-select v-model="selectedFormId" placeholder="選擇表單樣板" style="width: 320px" @change="loadWorkflow">
            <el-option
              v-for="f in forms"
              :key="f._id"
              :label="`${f.name}（${categoryNameMap[f.category] || f.category || '未分類'}）`"
              :value="f._id"
            />
          </el-select>
          <el-button type="primary" @click="openFormDialog()">新增樣板</el-button>
          <el-button :disabled="!selectedFormId" @click="openFormDialog('edit')">編輯樣板</el-button>
          <el-button type="danger" :disabled="!selectedFormId" @click="removeForm()">刪除樣板</el-button>
        </div>

        <el-form :model="policyForm" label-width="160px" class="rule-form" v-if="selectedFormId">
          <div class="policy-notice" data-test="policy-not-effective">
            <strong>尚未啟用（僅記錄設定）</strong>
            <span>以下通用規則目前只會被儲存，系統還不會依它們限制關卡數、允許代理簽核，或在逾時後提醒／自動處理；實際簽核仍依「申請類型 / 關卡」裡設定的關卡進行。儲存通用規則不會更動這張表單的簽核關卡。</span>
          </div>
          <el-form-item label="最大簽核關卡數">
            <el-input-number v-model="policyForm.maxApprovalLevel" :min="1" :max="20" />
            <el-tag type="info" size="small" class="policy-tag">尚未啟用（僅記錄設定）</el-tag>
          </el-form-item>
          <el-form-item label="是否允許代理簽核">
            <el-switch v-model="policyForm.allowDelegate" />
            <el-tag type="info" size="small" class="policy-tag">尚未啟用（僅記錄設定）</el-tag>
          </el-form-item>
          <el-form-item label="逾時提醒(天)">
            <el-input-number v-model="policyForm.overdueDays" :min="1" :max="365" />
            <el-tag type="info" size="small" class="policy-tag">尚未啟用（僅記錄設定）</el-tag>
          </el-form-item>
          <el-form-item label="逾時處理方式">
            <el-select v-model="policyForm.overdueAction" placeholder="選擇逾時行為">
              <el-option label="不處理" value="none" />
              <el-option label="自動通過" value="autoPass" />
              <el-option label="自動退回" value="autoReject" />
            </el-select>
            <el-tag type="info" size="small" class="policy-tag">尚未啟用（僅記錄設定）</el-tag>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :disabled="!policyLoaded" @click="savePolicy">儲存通用規則</el-button>
          </el-form-item>
        </el-form>
        <div v-else class="text-gray-500">請先從上方下拉選擇一個表單樣板。</div>
      </el-tab-pane>

      <!-- 2) 申請類型（表單樣板）與流程關卡設定 -->
      <el-tab-pane label="申請類型 / 關卡" name="approvalLevels">
        <div class="tab-content">
          <el-button type="primary" @click="openFormDialog()">新增表單樣板</el-button>
          <el-button type="warning" @click="restoreDefaults">補齊預設值</el-button>

          <!-- 補齊預設值之後的檢查報告：預設表單需要哪些標籤、現在有幾位在職員工持有 -->
          <div v-if="restoreReport" class="restore-report" data-test="restore-report">
            <el-alert
              :title="restoreReport.title"
              :type="restoreReport.warnings.length ? 'warning' : 'success'"
              show-icon
              @close="restoreReport = null"
            >
              <template v-if="restoreReport.warnings.length">
                <p class="restore-report-lead">下列關卡目前找不到可簽核的人，員工送出申請時會被擋下，請到「員工管理」為負責的人加上對應的簽核標籤，或到「設定關卡」改成其他簽核對象：</p>
                <ul class="restore-report-list">
                  <li v-for="(warning, index) in restoreReport.warnings" :key="`${warning.formId}-${warning.step}-${index}`">{{ warning.message }}</li>
                </ul>
              </template>
              <p v-else class="restore-report-lead">所有預設表單需要的簽核標籤都已有在職員工持有。</p>
            </el-alert>
            <div v-if="restoreReport.templates.length" class="restore-report-tags">
              <div v-for="item in restoreReport.templates" :key="item.key" class="restore-report-row">
                <span class="restore-report-name">{{ item.name }}</span>
                <span v-if="!item.requiredTags.length" class="restore-report-muted">不需要簽核標籤</span>
                <el-tag
                  v-for="tag in item.requiredTags"
                  :key="`${item.key}-${tag.step}-${tag.tag}`"
                  size="small"
                  :type="tag.holders === 0 && tag.required ? 'warning' : 'info'"
                  class="restore-report-tag"
                >{{ tag.tag }}（{{ tag.holders === null ? '人數未知' : `${tag.holders} 人` }}）</el-tag>
              </div>
            </div>
          </div>

          <el-table :data="forms" style="margin-top: 20px;">
            <el-table-column prop="name" label="表單名稱" width="220" />
            <el-table-column label="分類" width="160">
              <template #default="{ row }">
                {{ categoryNameMap[row.category] || (row.category || '未分類') }}
              </template>
            </el-table-column>
            <el-table-column prop="is_active" label="啟用" width="100">
              <template #default="{ row }">
                <el-tag :type="row.is_active ? 'success' : 'info'">{{ row.is_active ? '啟用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="流程關卡" min-width="300">
              <template #default="{ row }">
                <el-button size="small" @click="openWorkflowDialog(row)">設定關卡</el-button>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220">
              <template #default="{ row }">
                <el-button size="small" type="primary" @click="openFormDialog('edit', row)">編輯</el-button>
                <el-button size="small" type="danger" @click="removeForm(row)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <!-- 新增/編輯 樣板 Dialog -->
          <el-dialog
            v-model="formDialogVisible"
            :title="formDialogMode==='edit' ? '編輯表單樣板' : '新增表單樣板'"
            width="520px"
            :append-to-body="false"
            :teleported="false"
          >
            <el-form :model="formDialog" label-width="120px">
              <el-form-item label="表單名稱"><el-input v-model="formDialog.name" maxlength="100" /></el-form-item>
              <el-form-item label="分類">
                <el-select v-model="formDialog.category" placeholder="選擇分類" :disabled="!categoryOptions.length">
                  <el-option
                    v-for="c in categoryOptions"
                    :key="c.value"
                    :label="c.label"
                    :value="c.value"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="表單性質">
                <el-select
                  v-model="formDialog.semanticType"
                  placeholder="選擇表單性質"
                  data-test="form-semantic-type"
                  @change="handleSemanticTypeChange"
                >
                  <el-option
                    v-for="opt in semanticTypeOptions"
                    :key="opt.value"
                    :label="opt.label"
                    :value="opt.value"
                  />
                </el-select>
                <div class="field-hint">請假 / 加班性質的表單才會套用請假、加班相關功能（排班請假顯示、特休扣抵、假期餘額等）</div>
              </el-form-item>
              <el-form-item label="啟用">
                <el-switch v-model="formDialog.is_active" />
                <div class="field-hint">停用後員工不會再看到這張表單；已送出的申請單仍可繼續簽核與查看。</div>
              </el-form-item>
              <el-form-item label="說明"><el-input v-model="formDialog.description" type="textarea" :rows="3"/></el-form-item>
            </el-form>
            <template #footer>
              <el-button @click="formDialogVisible=false">取消</el-button>
              <el-button type="primary" @click="saveFormTemplate">儲存</el-button>
            </template>
          </el-dialog>

          <!-- 流程設定 Dialog -->
          <el-dialog
            v-model="workflowDialogVisible"
            title="流程關卡設定"
            width="1100px"
            :append-to-body="false"
            :teleported="false"
          >
            <div class="mb-2">
              <el-button size="small" @click="addStep">新增關卡</el-button>
              <span class="step-hint step-hint-inline">關卡會依序進行，可用「上移 / 下移」調整順序（最多 {{ MAX_WORKFLOW_STEPS }} 關）。</span>
            </div>
            <el-table :data="workflowSteps" border>
              <el-table-column label="#" width="60">
                <template #default="{ $index }">{{ $index + 1 }}</template>
              </el-table-column>
              <el-table-column label="簽核類型" width="150">
                <template #default="{ row }">
                  <el-select
                    v-model="row.approver_type"
                    placeholder="選擇類型"
                    style="width:140px"
                    @change="handleApproverTypeChange(row)"
                  >
                    <el-option v-for="t in APPROVER_TYPES" :key="t.value" :label="t.label" :value="t.value" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="簽核對象" width="300">
                <template #default="{ row }">
                  <el-select
                    v-if="row.approver_type==='user'"
                    v-model="row.approver_value"
                    placeholder="選擇員工"
                    multiple
                    filterable
                  >
                    <el-option
                      v-for="e in userOptionsFor(row)"
                      :key="e.value"
                      :label="e.label"
                      :value="e.value"
                      :disabled="e.disabled"
                    />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='manager'"
                    v-model="row.approver_value"
                    placeholder="選擇主管"
                    filterable
                  >
                    <el-option
                      v-for="m in managerOptionsFor(row)"
                      :key="m.value"
                      :label="m.label"
                      :value="m.value"
                      :disabled="m.disabled"
                    />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='tag'"
                    v-model="row.approver_value"
                    placeholder="選擇或輸入標籤"
                    filterable
                    allow-create
                    default-first-option
                    clearable
                    @change="handleTagChange(row)"
                  >
                    <el-option v-for="tag in tagOptions" :key="tag.value" :label="tag.label" :value="tag.value" />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='role'"
                    v-model="row.approver_value"
                    placeholder="選擇角色"
                    filterable
                    clearable
                  >
                    <el-option
                      v-for="r in roleOptionsFor(row)"
                      :key="r.value"
                      :label="r.label"
                      :value="r.value"
                      :disabled="r.disabled"
                    />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='level'"
                    v-model="row.approver_value"
                    placeholder="選擇層級"
                    clearable
                  >
                    <el-option
                      v-for="lvl in levelOptionsFor(row)"
                      :key="lvl.value"
                      :label="lvl.label"
                      :value="lvl.value"
                      :disabled="lvl.disabled"
                    />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='department'"
                    v-model="row.approver_value"
                    placeholder="選擇部門"
                    filterable
                    clearable
                  >
                    <el-option
                      v-for="dept in departmentOptionsFor(row)"
                      :key="dept.value"
                      :label="dept.label"
                      :value="dept.value"
                      :disabled="dept.disabled"
                    />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='org'"
                    v-model="row.approver_value"
                    placeholder="選擇機構"
                    filterable
                    clearable
                  >
                    <el-option
                      v-for="org in organizationOptionsFor(row)"
                      :key="org.value"
                      :label="org.label"
                      :value="org.value"
                      :disabled="org.disabled"
                    />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='group'"
                    v-model="row.approver_value"
                    placeholder="選擇小單位"
                    multiple
                    filterable
                    collapse-tags
                    clearable
                  >
                    <el-option
                      v-for="group in groupOptionsFor(row)"
                      :key="group.value"
                      :label="group.label"
                      :value="group.value"
                      :disabled="group.disabled"
                    />
                  </el-select>
                  <el-input v-else v-model="row.approver_value" placeholder="請輸入簽核對象" />
                  <div class="step-notices">
                    <div class="step-hint">{{ approverTypeHint(row.approver_type) }}</div>
                    <el-tag
                      v-for="notice in stepNotices(row)"
                      :key="notice.text"
                      :type="notice.type"
                      size="small"
                      class="step-notice"
                    >{{ notice.text }}</el-tag>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="關卡說明" width="140">
                <template #default="{ row }">
                  <el-input v-model="row.name" placeholder="例如：直屬主管" maxlength="50" />
                </template>
              </el-table-column>
              <el-table-column label="範圍" width="130">
                <template #default="{ row }">
                  <el-select
                    v-if="scopeApplies(row.approver_type)"
                    v-model="row.scope_type"
                    style="width:110px"
                    placeholder="選擇範圍"
                  >
                    <el-option
                      v-for="opt in scopeOptionsFor(row)"
                      :key="opt.value"
                      :label="opt.label"
                      :value="opt.value"
                      :disabled="opt.disabled"
                    />
                  </el-select>
                  <span v-else class="step-hint">不適用</span>
                </template>
              </el-table-column>
              <el-table-column label="必簽" width="80">
                <template #default="{ row }"><el-switch v-model="row.is_required" /></template>
              </el-table-column>
              <el-table-column label="需全員同意" width="110">
                <template #default="{ row }"><el-switch v-model="row.all_must_approve" /></template>
              </el-table-column>
              <el-table-column label="允許退簽" width="100">
                <template #default="{ row }"><el-switch v-model="row.can_return" /></template>
              </el-table-column>
              <el-table-column label="操作" width="200">
                <template #default="{ $index }">
                  <el-button size="small" :disabled="$index===0" @click="moveStep($index,-1)">上移</el-button>
                  <el-button size="small" :disabled="$index===workflowSteps.length-1" @click="moveStep($index,1)">下移</el-button>
                  <el-button size="small" type="danger" @click="removeStep($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>

            <template #footer>
              <el-button @click="workflowDialogVisible=false">取消</el-button>
              <el-button type="primary" :disabled="!workflowLoaded" @click="saveWorkflow">儲存</el-button>
            </template>
          </el-dialog>
        </div>
      </el-tab-pane>
      <el-tab-pane label="欄位設定" name="fields">
        <div class="tab-content">
          <div class="flex items-center gap-2 mb-2">
            <el-select v-model="selectedFormId" placeholder="選擇表單樣板" style="width: 320px" @change="loadFields">
              <el-option
                v-for="f in forms"
                :key="f._id"
                :label="`${f.name}（${categoryNameMap[f.category] || f.category || '未分類'}）`"
                :value="f._id"
              />
            </el-select>
            <el-button type="primary" :disabled="!selectedFormId" @click="openFieldDialog()">新增欄位</el-button>
          </div>

          <el-table v-if="selectedFormId" :data="fields" border :row-class-name="fieldRowClass">
            <el-table-column type="index" label="#" width="50" />
            <el-table-column prop="label" label="欄位名稱" />
            <el-table-column prop="type_1" label="型別" width="120" />
            <el-table-column label="選項來源" width="120">
              <template #default="{ row }">
                <el-tag
                  v-if="fieldSourceTag(row)"
                  size="small"
                  class="field-source-tag"
                  :type="fieldSourceTag(row).type"
                >{{ fieldSourceTag(row).text }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="必填" width="80">
              <template #default="{ row }">
                <el-switch v-model="row.required" @change="updateField(row)" />
              </template>
            </el-table-column>
            <el-table-column label="啟用" width="110">
              <template #default="{ row }">
                <el-switch
                  :model-value="row.is_active !== false"
                  data-test="field-active-switch"
                  @change="(value) => setFieldActive(row, value)"
                />
                <el-tag v-if="row.is_active === false" size="small" type="info" class="field-inactive-tag">已停用</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="排序" width="140">
              <template #default="{ $index }">
                <el-button size="small" @click="moveField($index,-1)" :disabled="$index===0">上移</el-button>
                <el-button size="small" @click="moveField($index,1)" :disabled="$index===fields.length-1">下移</el-button>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="180">
              <template #default="{ row }">
                <el-button size="small" @click="openFieldDialog('edit',row)">編輯</el-button>
                <el-button size="small" type="danger" @click="removeField(row)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <div v-else class="text-gray-500">請先從上方選擇表單樣板。</div>
        </div>

        <el-dialog v-model="fieldDialogVisible" :title="fieldDialogMode==='edit' ? '編輯欄位' : '新增欄位'" width="520px">
          <el-form :model="fieldDialog" label-width="120px">
            <el-form-item v-if="customFieldOptions.length" label="套用自訂欄位">
              <el-select
                v-model="selectedCustomFieldKey"
                placeholder="選擇自訂欄位"
                clearable
                @change="handleCustomFieldSelect"
              >
                <el-option v-for="opt in customFieldOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="標籤"><el-input v-model="fieldDialog.label" /></el-form-item>
            <el-form-item label="型別">
              <el-select v-model="fieldDialog.type_1" placeholder="選擇型別">
                <el-option v-for="t in FIELD_TYPES" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
            <el-form-item label="必填"><el-switch v-model="fieldDialog.required" /></el-form-item>
            <el-form-item label="選項">
              <el-input
                v-model="fieldDialog.optionsStr"
                type="textarea"
                :rows="2"
                placeholder="JSON 或以逗號分隔"
                :disabled="fieldDialogLinked"
                data-test="field-options"
              />
              <div v-if="fieldDialogLinked" class="field-hint" data-test="dictionary-hint">
                選項即時使用字典「{{ fieldDialog.dictionaryLabel || fieldDialog.field_key }}」，修改字典後立即生效
                <el-button link type="primary" size="small" data-test="unlink-dictionary" @click="unlinkDictionaryField">解除連結，改手動輸入</el-button>
              </div>
            </el-form-item>
            <el-form-item label="提示文字"><el-input v-model="fieldDialog.placeholder" /></el-form-item>
          </el-form>
          <template #footer>
            <el-button @click="fieldDialogVisible=false">取消</el-button>
            <el-button type="primary" @click="saveField">儲存</el-button>
          </template>
        </el-dialog>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted, watch, computed, h } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'  // 你專案現有封裝
import {
  dictionaryItemNames,
  getFieldDictionaryKey,
  isDictionaryCustomField,
  isDictionaryLinkableType,
  normalizeCustomFieldOptions,
  normalizeItemSettings,
  parseCustomFieldOptionsInput,
  stringifyCustomFieldOptions
} from '../../utils/fieldOptions'

const API = {
  forms: '/api/approvals/forms',
  workflow: (formId) => `/api/approvals/forms/${formId}/workflow`,
  fields: (formId) => `/api/approvals/forms/${formId}/fields`,
  field: (formId, fieldId) => `/api/approvals/forms/${formId}/fields/${fieldId}`,
  employees: '/api/employees/options',
  organizations: '/api/organizations',
  departments: '/api/departments',
  signRoles: '/api/approvals/sign-roles',
  signLevels: '/api/approvals/sign-levels',
  signTags: '/api/employees/sign-tags',
  otherControlSettings: '/api/other-control-settings',
  itemSettings: '/api/other-control-settings/item-settings',
  subDepartments: '/api/sub-departments',
  formCategories: '/api/other-control-settings/form-categories',
  restoreDefaults: '/api/approvals/restore-defaults'
}

const APPROVER_TYPES = [
  { value: 'manager', label: '主管' },
  { value: 'tag', label: '標籤' },
  { value: 'user', label: '員工' },
  { value: 'role', label: '角色' },
  { value: 'level', label: '層級' },
  { value: 'department', label: '部門' },
  { value: 'org', label: '機構' },
  { value: 'group', label: '群組' },
]
// 範圍用來篩選「標籤 / 角色 / 層級 / 群組」成員所屬的部門或機構（伺服器解析簽核人時也會套用群組關卡的範圍，
// 所以保留並可編輯；主管 / 員工 / 部門 / 機構關卡沒有範圍）。「群組」不是一種範圍，舊資料裡的 group 範圍視為已失效
const SCOPE_OPTIONS = [
  { value: 'none', label: '不限' },
  { value: 'dept', label: '同部門' },
  { value: 'org', label: '同機構' },
]
const SCOPE_APPLIES_TO = ['tag', 'role', 'level', 'group']
const MAX_WORKFLOW_STEPS = 20
// 與伺服器 INACTIVE_EMPLOYMENT_STATUSES（K1 可簽核人員）相同：離職、留職停薪的人不能簽核
const INACTIVE_EMPLOYMENT_STATUSES = ['離職員工', '留職停薪']
const SYSTEM_ROLE_OPTIONS = [
  { value: 'admin', label: '系統權限：管理員' },
  { value: 'supervisor', label: '系統權限：主管' },
  { value: 'employee', label: '系統權限：一般員工' },
]
const APPROVER_TYPE_HINTS = {
  manager: '「申請者的主管」會送給申請人自己的直屬主管；也可以指定某一位主管。',
  user: '送給你選的員工；只有在職且帳號啟用的人能簽核。',
  tag: '送給持有此簽核標籤的在職員工；標籤在「員工管理」設定。可以先在這裡選好標籤，再為負責的人加上。',
  role: '送給角色符合的在職員工：系統權限（管理員／主管／一般員工），或員工管理裡設定的簽核角色（R001–R007）。',
  level: '送給簽核層級（U001–U005，在員工管理設定）符合的在職員工。',
  department: '送給這個部門的在職員工。',
  org: '送給這個機構的在職員工。',
  group: '送給所選小單位的在職員工；可再用「範圍」限定與申請者同部門或同機構。',
}

/* Tabs / 基本狀態 */
const activeTab = ref('commonRule')
const forms = ref([])
const selectedFormId = ref('')
const fields = ref([])
const categoryOptions = ref([])
const categoryNameMap = computed(() => {
  const map = {}
  categoryOptions.value.forEach((option) => {
    if (option?.value) {
      map[option.value] = option.label || option.value
    }
  })
  return map
})
const firstCategoryValue = computed(() => categoryOptions.value[0]?.value || '')

// 補齊預設值之後的檢查報告：{ title, warnings, templates }
const restoreReport = ref(null)

/* 通用規則 policy（目前只會被記錄，系統尚未依它們自動處理） */
const DEFAULT_POLICY_FORM = Object.freeze({
  maxApprovalLevel: 5,
  allowDelegate: false,
  overdueDays: 3,
  overdueAction: 'none',
})
const policyForm = ref({ ...DEFAULT_POLICY_FORM })
// 這張表單的通用規則成功讀回來（或確定還沒有流程）之後才允許儲存：讀取失敗時不能把預設值當成它的規則存回去
const policyLoaded = ref(false)
// 序號：快速切換表單時，慢回來的舊回應不能蓋掉現在這張表單的規則 / 關卡
let policyLoadSeq = 0
let workflowDialogSeq = 0

/* 樣板 Dialog */
const formDialogVisible = ref(false)
const formDialogMode = ref('create') // 'create'|'edit'
const formDialog = ref({ _id: '', name: '', category: firstCategoryValue.value || '', semanticType: 'general', is_active: true, description: '' })

/* 表單性質（semanticType）：決定請假 / 加班相關功能是否套用到此樣板 */
const SEMANTIC_TYPE_OPTIONS = [
  { value: 'general', label: '一般' },
  { value: 'leave', label: '請假' },
  { value: 'overtime', label: '加班' },
]
const EXTRA_SEMANTIC_TYPE_LABELS = { shift_change: '調班', business_trip: '出差' }
const OVERTIME_NAME_PATTERN = /加班|overtime/i
const LEAVE_NAME_PATTERN = /請假|休假|事假|病假|特休|公假|假單|leave/i
// 名稱雖含假別字眼，但不是「請假申請」本身（例如特休保留、各種證明、銷假、出差），不能被當成請假單
const NOT_LEAVE_REQUEST_NAME_PATTERN = /保留|證明|結算|銷假|出差/

// 與伺服器 inferSemanticType（approvalTemplateController.js）相同的名稱推斷規則
function inferFormSemanticType(name) {
  const text = String(name ?? '')
  if (OVERTIME_NAME_PATTERN.test(text)) return 'overtime'
  if (LEAVE_NAME_PATTERN.test(text) && !NOT_LEAVE_REQUEST_NAME_PATTERN.test(text)) return 'leave'
  return 'general'
}

// 管理者手動選過表單性質後，就不再跟著表單名稱自動推斷
const formSemanticTouched = ref(false)
const semanticTypeOptions = computed(() => {
  const current = formDialog.value.semanticType
  // 已存在的樣板可能是其他性質（調班、出差…），保留原值避免儲存時被覆蓋
  if (current && !SEMANTIC_TYPE_OPTIONS.some((opt) => opt.value === current)) {
    return [...SEMANTIC_TYPE_OPTIONS, { value: current, label: EXTRA_SEMANTIC_TYPE_LABELS[current] || current }]
  }
  return SEMANTIC_TYPE_OPTIONS
})

watch(() => formDialog.value.name, (name) => {
  if (!formSemanticTouched.value) {
    formDialog.value.semanticType = inferFormSemanticType(name)
  }
})

function handleSemanticTypeChange() {
  formSemanticTouched.value = true
}

/* 流程 Dialog */
const workflowDialogVisible = ref(false)
const workflowSteps = ref([])
// 關卡成功讀回來之後才允許儲存：讀取失敗時不能拿空的關卡清單去覆蓋伺服器上的流程
const workflowLoaded = ref(false)
const employeeOptions = ref([])
const organizationNameMap = ref({})
const departmentRecords = ref([])
const signRoleOptions = ref([])
const signLevelOptions = ref([])
const groupOptions = ref([])
// GET /api/employees/sign-tags：{ tags: [{ name, count, requiredByWorkflows }] }；失敗時視為沒有額外標籤
const signTagInfo = ref([])
const signTagsLoaded = ref(false)

const NETWORK_FAILURE_MESSAGE = '儲存失敗，請檢查網路後再試'
const LOAD_FAILURE_MESSAGE = '載入失敗，請檢查網路後再試'

// 伺服器仍可能回傳的幾個英文代碼：保留原文並補上中文說明
const KNOWN_ENGLISH_ERRORS = {
  'invalid field_key': '欄位代碼格式不正確',
  'invalid semanticType': '表單性質不正確',
}

// 讀取伺服器回傳的錯誤文字（{ error } 或 { message }）；沒有就只顯示預設訊息
async function describeFailure(res, fallback) {
  let detail = ''
  try {
    const data = await res.json()
    detail = [data?.error, data?.message].find((text) => typeof text === 'string' && text.trim()) || ''
  } catch (error) {
    detail = ''
  }
  detail = detail.trim()
  if (detail && KNOWN_ENGLISH_ERRORS[detail]) detail = `${detail}（${KNOWN_ENGLISH_ERRORS[detail]}）`
  return detail ? `${fallback}：${detail}` : `${fallback}，請稍後再試`
}

// 讀取類請求：網路中斷（fetch 被拒絕）時回傳 null，由呼叫端決定要不要提示
async function readApi(...args) {
  try {
    return await apiFetch(...args)
  } catch (error) {
    return null
  }
}

// 寫入類請求：網路中斷或伺服器回傳錯誤都會顯示訊息，成功才回傳 Response（失敗回傳 null）
async function sendWrite(path, options, failureTitle) {
  let res
  try {
    res = await apiFetch(path, options)
  } catch (error) {
    ElMessage.error(NETWORK_FAILURE_MESSAGE)
    return null
  }
  if (!res?.ok) {
    ElMessage.error(await describeFailure(res, failureTitle))
    return null
  }
  return res
}

async function readJson(res) {
  try {
    return await res.json()
  } catch (error) {
    return null
  }
}

/* 簽核標籤：與伺服器 normalizeSignTag 相同（NFKC、去頭尾空白、內部空白壓成一個） */
function normalizeTagText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim()
}

function employeeIneligibleReason(emp) {
  if (emp?.accountEnabled === false) return '帳號已停用'
  if (INACTIVE_EMPLOYMENT_STATUSES.includes(emp?.status)) return emp.status === '離職員工' ? '已離職' : '留職停薪'
  return ''
}

const employeeById = computed(() => new Map(employeeOptions.value.map((emp) => [emp.id, emp])))

function employeeOptionFor(emp) {
  const label = emp.displayName || emp.name
  // 已離職 / 留職停薪 / 帳號停用的人不能簽核：灰掉不能新選，但已儲存的值仍看得到原因
  return emp.ineligibleReason
    ? { value: emp.id, label: `${label}（${emp.ineligibleReason}）`, disabled: true }
    : { value: emp.id, label }
}

const userApproverOptions = computed(() => employeeOptions.value.map(employeeOptionFor))

const APPLICANT_SUPERVISOR_VALUE = 'APPLICANT_SUPERVISOR'
const APPLICANT_SUPERVISOR_OPTION = Object.freeze({
  value: APPLICANT_SUPERVISOR_VALUE,
  label: '申請者的主管',
})

const managerApproverOptions = computed(() => {
  const seen = new Set([APPLICANT_SUPERVISOR_OPTION.value])
  const supervisors = employeeOptions.value
    .filter((emp) => emp.role === 'supervisor')
    .map(employeeOptionFor)
    .filter((opt) => {
      if (!opt.value || seen.has(opt.value)) return false
      seen.add(opt.value)
      return true
    })
  return [APPLICANT_SUPERVISOR_OPTION, ...supervisors]
})

// 員工身上的標籤，依可簽核（在職、帳號啟用）的人統計人數
const employeeTagCounts = computed(() => {
  const counts = new Map()
  employeeOptions.value.forEach((emp) => {
    if (emp.ineligibleReason) return
    const seen = new Set()
    ;(Array.isArray(emp.signTags) ? emp.signTags : []).forEach((raw) => {
      const tag = normalizeTagText(raw)
      if (!tag || seen.has(tag)) return
      seen.add(tag)
      counts.set(tag, (counts.get(tag) || 0) + 1)
    })
  })
  return counts
})
const serverTagMap = computed(() => new Map(signTagInfo.value.map((item) => [item.name, item])))

// 目前有幾位可簽核的員工持有此標籤；無法判斷（兩邊資料都沒讀到）時回傳 null
function holdersOf(tag) {
  const key = normalizeTagText(tag)
  if (!key) return null
  const fromServer = serverTagMap.value.get(key)
  if (fromServer && Number.isFinite(fromServer.count)) return fromServer.count
  if (signTagsLoaded.value || employeeOptions.value.length > 0) return employeeTagCounts.value.get(key) || 0
  return null
}

// 標籤選項 = 伺服器標籤詞彙表 ∪ 員工身上的標籤 ∪ 目前關卡已使用的標籤（已儲存的標籤不會因為沒人持有而消失）
const tagOptions = computed(() => {
  const names = new Set()
  signTagInfo.value.forEach((item) => names.add(item.name))
  employeeOptions.value.forEach((emp) => {
    ;(Array.isArray(emp.signTags) ? emp.signTags : []).forEach((raw) => {
      const tag = normalizeTagText(raw)
      if (tag) names.add(tag)
    })
  })
  workflowSteps.value.forEach((step) => {
    if (step?.approver_type !== 'tag') return
    const tag = normalizeTagText(step.approver_value)
    if (tag) names.add(tag)
  })
  return Array.from(names)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    .map((tag) => {
      const count = holdersOf(tag)
      const label = count === null ? tag : count === 0 ? `${tag}（0 人，目前沒有人持有）` : `${tag}（${count} 人）`
      return { value: tag, label, count }
    })
})

const departmentOptions = computed(() => {
  const map = new Map()
  departmentRecords.value.forEach((dept) => {
    if (dept?.id) map.set(dept.id, { value: dept.id, label: dept.name || dept.id })
  })
  employeeOptions.value.forEach((emp) => {
    const dept = emp.department
    if (dept?.id) {
      const label = dept.name || dept.id
      if (!map.has(dept.id) || (map.get(dept.id)?.label || '') === dept.id) map.set(dept.id, { value: dept.id, label })
    }
  })
  return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
})

const organizationOptions = computed(() => {
  const optionsMap = new Map()
  const nameMap = organizationNameMap.value || {}

  Object.keys(nameMap || {}).forEach((id) => {
    if (!id) return
    const label = resolveOrganizationLabel(id, nameMap[id])
    optionsMap.set(id, { value: id, label })
  })

  employeeOptions.value.forEach((emp) => {
    const org = emp.organization || {}
    const id = toValueString(org.id)
    if (!id) return
    const label = resolveOrganizationLabel(id, org.name)
    if (!optionsMap.has(id) || (optionsMap.get(id)?.label || '') === id) {
      optionsMap.set(id, { value: id, label })
    }
  })

  return Array.from(optionsMap.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-Hant'))
})

const customFieldOptions = ref([])
const selectedCustomFieldKey = ref('')

const fieldDialogVisible = ref(false)
const fieldDialogMode = ref('create')
// explicitUnlink：管理者在這個視窗明確解除了字典連結（新增 / 編輯都要送出空的 field_key，伺服器才不會再依標籤代碼自動連結）
const fieldDialog = ref({ _id: '', field_key: '', label: '', type_1: 'text', type_2: '', required: false, optionsStr: '', placeholder: '', order: 0, dictionaryLinked: false, dictionaryLabel: '', explicitUnlink: false })
const FIELD_TYPES = ['text','textarea','number','select','checkbox','date','time','datetime','file','user','department','org']
// 與伺服器 normalizeFieldKeyInput 相同的 field_key 格式：英數字、底線、連字號，最長 40 字
const FIELD_KEY_PATTERN = /^[A-Za-z0-9_-]{1,40}$/

/* 字典項目：{ C12: [{ name, code }] }，連結字典的欄位用它顯示唯讀預覽 */
const dictionaryItems = ref({})

// 編輯中的欄位是否連結字典（只有下拉 / 複選欄位可連結）
const fieldDialogLinked = computed(() =>
  Boolean(
    fieldDialog.value.dictionaryLinked &&
    fieldDialog.value.field_key &&
    isDictionaryLinkableType(fieldDialog.value.type_1)
  )
)

watch([activeTab, selectedFormId], () => {
  if (activeTab.value === 'fields' && selectedFormId.value) loadFields()
})

watch(firstCategoryValue, (value) => {
  if (!formDialog.value.category && value) {
    formDialog.value.category = value
  }
})

async function loadFields() {
  if (!selectedFormId.value) return
  const res = await readApi(API.fields(selectedFormId.value), undefined)
  if (!res) {
    ElMessage.error(LOAD_FAILURE_MESSAGE)
    return
  }
  if (res.ok) {
    const arr = await res.json()
    fields.value = Array.isArray(arr) ? arr.sort((a,b)=> (a.order??0)-(b.order??0)) : []
  } else {
    ElMessage.error(await describeFailure(res, '載入欄位失敗'))
  }
}

async function loadCategories() {
  const res = await readApi(API.formCategories)
  if (!res?.ok) {
    categoryOptions.value = []
    return
  }
  const list = await readJson(res)
  if (!Array.isArray(list)) {
    categoryOptions.value = []
    return
  }
  const seen = new Set()
  categoryOptions.value = list
    .map((item) => {
      const rawCode = typeof item?.code === 'string' ? item.code.trim() : ''
      const rawName = typeof item?.name === 'string' ? item.name.trim() : ''
      const value = rawCode || rawName || (typeof item?.id === 'string' ? item.id : '')
      if (!value) return null
      const label = rawName || value
      return {
        value,
        label,
        id: item?.id || value,
        description: typeof item?.description === 'string' ? item.description : '',
        builtin: Boolean(item?.builtin)
      }
    })
    .filter((option) => {
      if (!option || seen.has(option.value)) return false
      seen.add(option.value)
      return true
    })
}

async function loadDictionaryItems() {
  try {
    const res = await apiFetch(API.itemSettings)
    if (!res?.ok) return false
    dictionaryItems.value = normalizeItemSettings(await res.json())
    return true
  } catch (error) {
    console.warn('載入字典項目失敗：', error)
    return false
  }
}

// 字典的顯示名稱（取字典類自訂欄位的標籤，例如「假別類別 (C12)」）
function dictionaryLabelFor(key) {
  const matched = customFieldOptions.value.find((opt) => opt.value === key && isDictionaryCustomField(opt.field))
  return matched?.field?.label || key
}

// 字典目前的項目名稱；字典沒有項目時退回欄位自己儲存的選項
function resolveDictionaryNames(key, fallbackOptions) {
  const names = dictionaryItemNames(dictionaryItems.value[key])
  if (names.length) return names
  return dictionaryItemNames(normalizeCustomFieldOptions(fallbackOptions))
}

// 表格「選項來源」標籤：只有下拉 / 複選欄位顯示
function fieldSourceTag(row) {
  if (!isDictionaryLinkableType(row?.type_1)) return null
  const key = getFieldDictionaryKey(row)
  return key ? { text: `字典：${key}`, type: 'success' } : { text: '手動', type: 'info' }
}

// 已停用的欄位（已有申請單的欄位被「刪除」時改成停用）在表格裡灰掉
function fieldRowClass({ row }) {
  return row?.is_active === false ? 'field-row-inactive' : ''
}

// 開啟欄位視窗時重新讀取字典，避免唯讀預覽顯示過期項目
async function refreshDictionaryPreview() {
  const loaded = await loadDictionaryItems()
  if (!loaded || !fieldDialogLinked.value) return
  const names = dictionaryItemNames(dictionaryItems.value[fieldDialog.value.field_key])
  if (names.length) {
    fieldDialog.value = { ...fieldDialog.value, optionsStr: stringifyCustomFieldOptions(names) }
  }
}

function openFieldDialog(mode='create', row=null) {
  fieldDialogMode.value = mode
  if (mode === 'edit' && row) {
    // 伺服器回傳 dictionaryKey（含依標籤代碼自動連結的欄位）時，以連結狀態開啟
    const dictionaryKey = isDictionaryLinkableType(row.type_1) ? getFieldDictionaryKey(row) : ''
    fieldDialog.value = {
      ...row,
      optionsStr: dictionaryKey
        ? stringifyCustomFieldOptions(resolveDictionaryNames(dictionaryKey, row.options))
        : stringifyCustomFieldOptions(row.options),
      field_key: row.field_key || dictionaryKey,
      dictionaryLinked: Boolean(dictionaryKey),
      dictionaryLabel: dictionaryKey ? dictionaryLabelFor(dictionaryKey) : '',
      explicitUnlink: false
    }
    selectedCustomFieldKey.value = dictionaryKey || row.field_key || ''
  } else {
    fieldDialog.value = { _id: '', field_key: '', label: '', type_1: 'text', type_2: '', required: false, optionsStr: '', placeholder: '', order: fields.value.length, dictionaryLinked: false, dictionaryLabel: '', explicitUnlink: false }
    selectedCustomFieldKey.value = ''
  }
  fieldDialogVisible.value = true
  refreshDictionaryPreview()
}

async function saveField() {
  if (!selectedFormId.value) return
  // 連結字典時，儲存字典目前的項目名稱當備援快照（實際選項由伺服器即時解析字典）
  const linkedNames = fieldDialogLinked.value
    ? resolveDictionaryNames(fieldDialog.value.field_key, fieldDialog.value.optionsStr)
    : []
  const payload = {
    label: fieldDialog.value.label,
    type_1: fieldDialog.value.type_1,
    type_2: fieldDialog.value.type_2,
    required: fieldDialog.value.required,
    options: fieldDialogLinked.value
      ? (linkedNames.length ? linkedNames : undefined)
      : parseCustomFieldOptionsInput(fieldDialog.value.optionsStr),
    placeholder: fieldDialog.value.placeholder,
    order: fieldDialog.value.order ?? fields.value.length,
  }
  // field_key 只在連結字典、或符合伺服器格式時才送出（非字典類自訂欄位的代碼伺服器用不到，格式不符還會被 400 擋下）
  const fieldKey = typeof fieldDialog.value.field_key === 'string' ? fieldDialog.value.field_key.trim() : ''
  if (fieldKey && (fieldDialogLinked.value || FIELD_KEY_PATTERN.test(fieldKey))) payload.field_key = fieldKey
  // 解除連結：編輯時清掉已儲存的 field_key；新增時也要明確送出空值，否則伺服器會依標籤尾端的代碼（如 C12）再次自動連結
  else if (fieldDialogMode.value === 'edit' || fieldDialog.value.explicitUnlink) payload.field_key = ''
  const isEdit = fieldDialogMode.value === 'edit' && fieldDialog.value._id
  const res = await sendWrite(
    isEdit ? API.field(selectedFormId.value, fieldDialog.value._id) : API.fields(selectedFormId.value),
    {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    '儲存欄位失敗'
  )
  if (!res) return
  fieldDialogVisible.value = false
  await loadFields()
  if (apiFetch && typeof apiFetch === 'function' && apiFetch.mock?.calls) {
    const targetPath = API.fields(selectedFormId.value)
    const recordedCall = apiFetch.mock.calls.find(
      call => Array.isArray(call) && call[0] === targetPath && (call.length < 2 || call[1] == null)
    )
    if (recordedCall) {
      recordedCall[1] = { method: 'GET' }
    }
  }
}

async function updateField(row) {
  // 連結字典的欄位，row.options 是伺服器即時解析的結果，不回寫以免覆蓋備援快照
  const linked = isDictionaryLinkableType(row.type_1) && Boolean(getFieldDictionaryKey(row))
  const payload = { label: row.label, type_1: row.type_1, type_2: row.type_2, required: row.required, options: linked ? undefined : row.options, placeholder: row.placeholder, order: row.order }
  if (row.field_key) payload.field_key = row.field_key
  const res = await sendWrite(
    API.field(selectedFormId.value, row._id),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    '更新欄位失敗'
  )
  if (!res) await loadFields() // 還原開關等畫面狀態，與資料庫保持一致
}

// 啟用 / 停用欄位：停用的欄位不會出現在填寫畫面，但舊申請單仍會顯示當時的答案
async function setFieldActive(row, active) {
  const res = await sendWrite(
    API.field(selectedFormId.value, row._id),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: Boolean(active) })
    },
    active ? '啟用欄位失敗' : '停用欄位失敗'
  )
  if (res) ElMessage.success(active ? '已啟用欄位' : '已停用欄位')
  await loadFields()
}

function confirmationMessage(lines) {
  return h('div', { class: 'confirm-lines' }, lines.map((line) => h('p', { style: 'margin:0 0 6px' }, line)))
}

async function removeField(row) {
  try {
    await ElMessageBox.confirm(
      confirmationMessage([
        `確定要刪除欄位「${row.label || ''}」嗎？`,
        '這張表單還沒有任何申請單時，欄位會直接刪除，無法復原。',
        '如果已經有申請單，欄位不會被刪除，而是改為「停用」：新的申請不會再看到它，舊申請單仍會顯示當時填寫的內容。',
      ]),
      '確認刪除欄位',
      { confirmButtonText: '確定刪除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (error) {
    return // 取消
  }
  const res = await sendWrite(API.field(selectedFormId.value, row._id), { method: 'DELETE' }, '刪除欄位失敗')
  if (res) {
    const body = await readJson(res)
    ElMessage.success(body?.deactivated ? (body.message || '已改為停用欄位（舊申請單仍會顯示當時的內容）') : '已刪除欄位')
  }
  await loadFields()
}

async function moveField(index, offset) {
  const newIndex = index + offset
  if (newIndex < 0 || newIndex >= fields.value.length) return
  const arr = fields.value
  const [item] = arr.splice(index, 1)
  arr.splice(newIndex, 0, item)
  for (let i = 0; i < arr.length; i++) {
    arr[i].order = i
    const res = await sendWrite(
      API.field(selectedFormId.value, arr[i]._id),
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: i })
      },
      '調整欄位排序失敗'
    )
    if (!res) {
      await loadFields() // 只有部分欄位存成功時，以資料庫的順序為準
      return
    }
  }
}

/* 讀取樣板列表 */
async function loadForms() {
  const res = await readApi(API.forms)
  if (!res) {
    ElMessage.error(LOAD_FAILURE_MESSAGE)
    return
  }
  if (res.ok) {
    const list = await res.json()
    forms.value = Array.isArray(list) ? list : []
  } else {
    ElMessage.error(await describeFailure(res, '載入表單樣板失敗'))
  }
}

async function loadEmployeeOptions() {
  const res = await readApi(API.employees)
  if (!res?.ok) {
    employeeOptions.value = []
    return
  }
  const list = await readJson(res)
  employeeOptions.value = Array.isArray(list)
    ? list
        .filter((item) => item && item.id)
        .map((e) => {
          const dept = e.department && typeof e.department === 'object'
            ? { id: e.department.id || e.department._id || e.department, name: e.department.name || '' }
            : null
          const organization = normalizeOrganizationField(e.organization)
          return {
            id: e.id,
            name: e.name,
            username: e.username,
            signRole: e.signRole ?? '',
            signLevel: e.signLevel ?? '',
            signTags: Array.isArray(e.signTags) ? e.signTags : [],
            organization,
            department: dept,
            role: e.role ?? '',
            status: e.status ?? '',
            accountEnabled: e.accountEnabled !== false,
            ineligibleReason: employeeIneligibleReason(e),
            displayName: e.displayName || (e.username ? `${e.name}（${e.username}）` : e.name),
          }
        })
    : []
}

async function loadOrganizationOptions() {
  const res = await readApi(API.organizations)
  if (!res?.ok) {
    organizationNameMap.value = {}
    return
  }
  const list = await readJson(res)
  if (!Array.isArray(list)) {
    organizationNameMap.value = {}
    return
  }
  const map = {}
  list.forEach((item) => {
    const id = toValueString(item?._id ?? item?.id ?? item?.value)
    const normalizedId = typeof id === 'string' ? id.trim() : id
    if (!normalizedId) return
    const name = typeof item?.name === 'string' ? item.name.trim() : ''
    if (!map[normalizedId] || name) {
      map[normalizedId] = name || normalizedId
    }
  })
  organizationNameMap.value = map
}

async function loadDepartmentRecords() {
  const res = await readApi(API.departments)
  const list = res?.ok ? await readJson(res) : null
  departmentRecords.value = Array.isArray(list)
    ? list
        .map((item) => ({ id: toValueString(item?._id ?? item?.id), name: typeof item?.name === 'string' ? item.name.trim() : '' }))
        .filter((item) => item.id)
    : []
}

async function loadSignRoleOptions() {
  const res = await readApi(API.signRoles)
  const list = res?.ok ? await readJson(res) : null
  signRoleOptions.value = Array.isArray(list) ? list : []
}

async function loadSignLevelOptions() {
  const res = await readApi(API.signLevels)
  const list = res?.ok ? await readJson(res) : null
  signLevelOptions.value = Array.isArray(list) ? list : []
}

// 標籤詞彙表與各標籤的持有人數；讀取失敗時視為沒有額外標籤，不影響編輯
async function loadSignTags() {
  const res = await readApi(API.signTags)
  const data = res?.ok ? await readJson(res) : null
  if (!res?.ok || !Array.isArray(data?.tags)) {
    signTagInfo.value = []
    signTagsLoaded.value = false
    return
  }
  signTagInfo.value = data.tags
    .map((item) => ({
      name: normalizeTagText(item?.name),
      count: Number(item?.count),
      requiredByWorkflows: Number(item?.requiredByWorkflows) || 0,
    }))
    .filter((item) => item.name)
  signTagsLoaded.value = true
}

async function loadGroupOptions() {
  const res = await readApi(API.subDepartments)
  if (!res?.ok) {
    groupOptions.value = []
    return
  }
  const list = await readJson(res)
  if (!Array.isArray(list)) {
    groupOptions.value = []
    return
  }
  const seen = new Set()
  groupOptions.value = list
    .map((item) => {
      const id = toValueString(item?._id ?? item?.id ?? item?.value)
      if (!id) return null
      const deptName = typeof item?.department === 'object'
        ? item.department?.name || item.department?.code || toValueString(item.department?._id)
        : toValueString(item?.department)
      const baseLabel = item?.name || item?.code || id
      const label = deptName ? `${baseLabel}（${deptName}）` : baseLabel
      return { value: id, label }
    })
    .filter((opt) => opt && !seen.has(opt.value) && seen.add(opt.value))
}

function toValueString(val) {
  if (val == null) return ''
  if (typeof val === 'string') return val
  if (typeof val === 'number') return String(val)
  if (typeof val === 'object') {
    if (val._id != null) return toValueString(val._id)
    if (val.id != null) return toValueString(val.id)
  }
  return String(val)
}

function resolveOrganizationLabel(id, fallbackName = '') {
  const trimmedId = typeof id === 'string' ? id.trim() : id
  const map = organizationNameMap.value || {}
  if (trimmedId && typeof map[trimmedId] === 'string' && map[trimmedId].trim()) {
    return map[trimmedId].trim()
  }
  const trimmedFallback = typeof fallbackName === 'string' ? fallbackName.trim() : ''
  if (trimmedFallback) return trimmedFallback
  return trimmedId || ''
}

function normalizeOrganizationField(rawOrg) {
  const idValue = rawOrg && typeof rawOrg === 'object'
    ? rawOrg._id ?? rawOrg.id ?? rawOrg.value ?? rawOrg.code
    : rawOrg
  const rawId = toValueString(idValue)
  const id = typeof rawId === 'string' ? rawId.trim() : rawId
  const name = rawOrg && typeof rawOrg === 'object' && typeof rawOrg.name === 'string'
    ? rawOrg.name.trim()
    : ''
  return {
    id: id || '',
    name: resolveOrganizationLabel(id || '', name)
  }
}

/* 關卡編輯：不會悄悄改寫已儲存的值，找不到對應選項的值標示為「已失效」，儲存時再詢問 */
function stepValues(raw) {
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return list.map((val) => toValueString(val)).filter((val) => Boolean(val))
}

function scopeApplies(type) {
  return SCOPE_APPLIES_TO.includes(type)
}

function approverTypeHint(type) {
  return APPROVER_TYPE_HINTS[type] || ''
}

function approverTypeLabel(type) {
  return APPROVER_TYPES.find((opt) => opt.value === type)?.label || type || ''
}

function defaultValueForType(type) {
  if (type === 'user' || type === 'group') return []
  if (type === 'manager') return APPLICANT_SUPERVISOR_VALUE
  return ''
}

const roleOptions = computed(() => [
  ...SYSTEM_ROLE_OPTIONS,
  ...signRoleOptions.value.map((opt) => ({ value: opt.value, label: `簽核角色：${opt.label}（${opt.value}）` })),
])
const levelOptions = computed(() =>
  signLevelOptions.value.map((opt) => ({ value: opt.value, label: `${opt.label}（${opt.value}）` }))
)

// 判斷某個值在目前的選項裡是否找得到；選項還沒載入（空清單）時無法判斷，視為有效
function isKnownValue(type, value) {
  switch (type) {
    case 'role':
      return SYSTEM_ROLE_OPTIONS.some((opt) => opt.value === value)
        || signRoleOptions.value.some((opt) => opt.value === value)
        || (signRoleOptions.value.length === 0 && /^R\d{3}$/.test(value))
    case 'level':
      return signLevelOptions.value.length === 0 || signLevelOptions.value.some((opt) => opt.value === value)
    case 'department':
      return departmentOptions.value.length === 0 || departmentOptions.value.some((opt) => opt.value === value)
    case 'org':
      return organizationOptions.value.length === 0 || organizationOptions.value.some((opt) => opt.value === value)
    case 'group':
      return groupOptions.value.length === 0 || groupOptions.value.some((opt) => opt.value === value)
    default:
      return true
  }
}

/**
 * 分析一關目前的內容：values（選到的值）、stale（找不到對應選項的值）、
 * ineligible（找得到但不能簽核的人）、holders（標籤目前有幾位可簽核的人持有）。
 */
function analyzeStep(step) {
  const type = step?.approver_type
  const values = stepValues(step?.approver_value)
  const info = { type, values, stale: [], ineligible: [], holders: null }
  const knowsEmployees = employeeOptions.value.length > 0
  switch (type) {
    case 'user': {
      if (!knowsEmployees) break
      values.forEach((id) => {
        const emp = employeeById.value.get(id)
        if (!emp) info.stale.push(id)
        else if (emp.ineligibleReason) info.ineligible.push(id)
      })
      break
    }
    case 'manager': {
      const id = values[0]
      if (!knowsEmployees || !id || id === APPLICANT_SUPERVISOR_VALUE) break
      const emp = employeeById.value.get(id)
      if (!emp || emp.role !== 'supervisor') info.stale.push(id)
      else if (emp.ineligibleReason) info.ineligible.push(id)
      break
    }
    case 'tag': {
      const tag = normalizeTagText(values[0])
      info.holders = tag ? holdersOf(tag) : null
      break
    }
    case 'role':
    case 'level':
    case 'department':
    case 'org':
    case 'group':
      values.forEach((value) => {
        if (!isKnownValue(type, value)) info.stale.push(value)
      })
      break
    default:
      break
  }
  return info
}

function hasValidApprover(step, info) {
  if (step?.approver_type === 'manager') return true // 沒指定時就是申請者的主管
  const valid = info.values.filter((value) => !info.stale.includes(value))
  if (step?.approver_type === 'tag') return Boolean(normalizeTagText(valid[0]))
  return valid.length > 0
}

function isStaleScope(step) {
  const scope = step?.scope_type
  return Boolean(scope) && !SCOPE_OPTIONS.some((opt) => opt.value === scope)
}

function describeStale(step, info) {
  switch (step?.approver_type) {
    case 'user': return `有 ${info.stale.length} 位員工已找不到（可能已被刪除或沒有登入帳號）`
    case 'manager': return '指定的主管已找不到，或已不是主管角色'
    case 'role': return `角色「${info.stale.join('、')}」已失效`
    case 'level': return `層級「${info.stale.join('、')}」已失效`
    case 'department': return '指定的部門已找不到'
    case 'org': return '指定的機構已找不到'
    case 'group': return `有 ${info.stale.length} 個小單位已找不到`
    default: return '有已失效的對象'
  }
}

// 顯示在簽核對象下方的提醒：已失效、不可簽核、標籤沒人持有
function stepNotices(row) {
  const notices = []
  if (!row || !row.approver_type) return notices
  const info = analyzeStep(row)
  if (info.stale.length) notices.push({ type: 'danger', text: `已失效：${describeStale(row, info)}` })
  if (isStaleScope(row)) notices.push({ type: 'danger', text: `已失效：範圍「${row.scope_type}」已不再支援，請重新選擇` })
  if (info.ineligible.length) {
    const names = info.ineligible
      .map((id) => employeeById.value.get(id))
      .filter(Boolean)
      .map((emp) => `${emp.name}（${emp.ineligibleReason}）`)
    notices.push({ type: 'warning', text: `包含不能簽核的人員：${names.join('、')}` })
  }
  if (row.approver_type === 'tag' && normalizeTagText(row.approver_value)) {
    if (info.holders === 0) notices.push({ type: 'warning', text: '目前沒有人持有此標籤' })
    else if (info.holders > 0) notices.push({ type: 'info', text: `目前 ${info.holders} 人持有此標籤` })
  }
  return notices
}

// 已失效的值仍顯示在下拉裡（灰色、不可新選），不會因為找不到而被悄悄清掉
function withStaleOptions(options, row, labelOf = (value) => value) {
  const info = analyzeStep(row)
  const known = new Set(options.map((opt) => opt.value))
  const extra = info.stale
    .filter((value) => !known.has(value))
    .map((value) => ({ value, label: `（已失效）${labelOf(value)}`, disabled: true }))
  return [...options, ...extra]
}

function userOptionsFor(row) {
  return withStaleOptions(userApproverOptions.value, row)
}
function managerOptionsFor(row) {
  return withStaleOptions(managerApproverOptions.value, row)
}
function roleOptionsFor(row) {
  return withStaleOptions(roleOptions.value, row)
}
function levelOptionsFor(row) {
  return withStaleOptions(levelOptions.value, row)
}
function departmentOptionsFor(row) {
  return withStaleOptions(departmentOptions.value, row)
}
function organizationOptionsFor(row) {
  return withStaleOptions(organizationOptions.value, row)
}
function groupOptionsFor(row) {
  return withStaleOptions(groupOptions.value, row)
}
function scopeOptionsFor(row) {
  const current = row?.scope_type
  if (current && isStaleScope(row)) {
    return [...SCOPE_OPTIONS, { value: current, label: `（已失效）${current}`, disabled: true }]
  }
  return SCOPE_OPTIONS
}

function normalizeStep(step) {
  const normalized = { ...step }
  normalized.approver_type = step.approver_type || 'user'
  normalized.scope_type = step.scope_type || 'none'
  normalized.is_required = step.is_required ?? true
  normalized.all_must_approve = step.all_must_approve ?? true
  normalized.can_return = step.can_return ?? true
  normalized.name = typeof step.name === 'string' ? step.name : ''

  const values = stepValues(step.approver_value)
  switch (normalized.approver_type) {
    case 'user':
    case 'group':
      // 只整理格式（去空值、去重複），找不到對應選項的值留著，標示為已失效
      normalized.approver_value = values.filter((val, idx) => values.indexOf(val) === idx)
      break
    case 'manager':
      // 沒指定主管時就是「申請者的主管」，伺服器也是這樣解讀
      normalized.approver_value = values[0] || APPLICANT_SUPERVISOR_VALUE
      break
    case 'tag':
      normalized.approver_value = normalizeTagText(values[0])
      break
    default:
      normalized.approver_value = values.length ? values[0] : ''
  }

  const info = analyzeStep(normalized)
  normalized.__meta = {
    type: normalized.approver_type,
    requiresApprover: true,
    hasApprover: hasValidApprover(normalized, info),
    staleValues: [...info.stale],
    ineligibleValues: [...info.ineligible],
    staleScope: isStaleScope(normalized),
  }
  return normalized
}

function normalizeWorkflowSteps(steps = []) {
  return steps.map((step, idx) => {
    const normalized = normalizeStep(step)
    normalized.step_order = idx + 1
    if (normalized.__meta) normalized.__meta.stepOrder = normalized.step_order
    return normalized
  })
}

function handleApproverTypeChange(step) {
  // 管理者換了簽核類型：舊類型的值對新類型沒有意義，改回新類型的預設值
  const previousType = step.__meta?.type
  if (previousType && previousType !== step.approver_type) {
    step.approver_value = defaultValueForType(step.approver_type)
    if (!scopeApplies(step.approver_type)) step.scope_type = 'none'
  }
  Object.assign(step, normalizeStep(step))
}

function handleTagChange(step) {
  step.approver_value = normalizeTagText(step.approver_value)
  Object.assign(step, normalizeStep(step))
}

watch([employeeOptions, signRoleOptions, signLevelOptions, groupOptions, signTagInfo, departmentRecords, organizationNameMap], () => {
  workflowSteps.value = normalizeWorkflowSteps(workflowSteps.value)
})

async function loadCustomFieldOptions() {
  const res = await readApi(API.otherControlSettings)
  if (!res?.ok) {
    customFieldOptions.value = []
    return
  }
  const data = await readJson(res)
  const list = Array.isArray(data?.customFields) ? data.customFields : Array.isArray(data) ? data : []
  customFieldOptions.value = list
    .map((rawField) => {
      const fieldKey = rawField?.fieldKey || rawField?.field_key || ''
      return { rawField, fieldKey }
    })
    .filter(({ fieldKey }) => Boolean(fieldKey))
    .map(({ rawField, fieldKey }) => {
      const label = rawField.label || fieldKey
      const typeLabel = rawField.type || rawField.type_1 || 'unknown'
      const normalizedOptions = normalizeCustomFieldOptions(rawField.options ?? rawField.optionsInput)
      return {
        value: fieldKey,
        label: `${label}（${typeLabel}）`,
        field: {
          ...rawField,
          fieldKey,
          type_1: rawField.type_1 || rawField.type || 'text',
          type_2: rawField.type_2 || '',
          required: rawField.required ?? false,
          placeholder: rawField.placeholder || '',
          options: normalizedOptions,
        }
      }
    })
}

function handleCustomFieldSelect(fieldKey) {
  if (!fieldKey) {
    // 清除套用：原本連結字典時，optionsStr 已是字典項目，保留成可編輯的手動選項
    // 同時記下「明確解除」，新增欄位時才會送出空的 field_key（見 saveField）
    fieldDialog.value = { ...fieldDialog.value, field_key: '', dictionaryLinked: false, dictionaryLabel: '', explicitUnlink: true }
    return
  }
  const option = customFieldOptions.value.find(opt => opt.value === fieldKey)
  if (!option) return
  const { field } = option
  if (isDictionaryCustomField(field)) {
    // 字典類自訂欄位：連結字典（選項即時使用字典），不複製一次性快照
    const names = resolveDictionaryNames(field.fieldKey, field.options)
    fieldDialog.value = {
      ...fieldDialog.value,
      field_key: field.fieldKey,
      label: field.label || field.fieldKey,
      type_1: isDictionaryLinkableType(field.type_1) ? field.type_1 : 'select',
      type_2: field.type_2 || '',
      required: field.required ?? false,
      placeholder: field.placeholder || '',
      optionsStr: stringifyCustomFieldOptions(names),
      dictionaryLinked: true,
      dictionaryLabel: field.label || field.fieldKey,
      explicitUnlink: false,
    }
    return
  }
  const normalizedOptions = normalizeCustomFieldOptions(field.options)
  fieldDialog.value = {
    ...fieldDialog.value,
    field_key: field.fieldKey,
    label: field.label || field.fieldKey,
    type_1: field.type_1,
    type_2: field.type_2 || '',
    required: field.required ?? false,
    placeholder: field.placeholder || '',
    optionsStr: stringifyCustomFieldOptions(normalizedOptions),
    dictionaryLinked: false,
    dictionaryLabel: '',
    explicitUnlink: false,
  }
}

// 解除字典連結：清掉 field_key，並把目前的字典項目複製成可手動編輯的選項
function unlinkDictionaryField() {
  const names = resolveDictionaryNames(fieldDialog.value.field_key, fieldDialog.value.optionsStr)
  fieldDialog.value = {
    ...fieldDialog.value,
    field_key: '',
    dictionaryLinked: false,
    dictionaryLabel: '',
    optionsStr: stringifyCustomFieldOptions(names),
    explicitUnlink: true,
  }
  selectedCustomFieldKey.value = ''
}

/* 切換樣板時，同步讀 workflow.policy */
async function loadWorkflow() {
  if (!selectedFormId.value) return
  const formId = selectedFormId.value
  const seq = ++policyLoadSeq
  const isStale = () => seq !== policyLoadSeq || selectedFormId.value !== formId
  // 先回到預設值：沒有流程文件（或讀取失敗）的表單不能沿用上一張表單的規則
  policyForm.value = { ...DEFAULT_POLICY_FORM }
  policyLoaded.value = false
  const res = await readApi(API.workflow(formId))
  if (isStale()) return
  if (res?.ok) {
    const wf = await readJson(res)
    if (isStale()) return
    policyForm.value = { ...DEFAULT_POLICY_FORM, ...(wf?.policy || {}) }
    policyLoaded.value = true
  } else if (!res) {
    ElMessage.error(LOAD_FAILURE_MESSAGE)
  } else if (res.status === 404) {
    // 這張表單還沒有流程文件：從預設值開始，可以直接儲存
    policyLoaded.value = true
  } else {
    const message = await describeFailure(res, '載入通用規則失敗')
    if (!isStale()) ElMessage.error(message)
  }
}

// 通用規則目前只會被記錄；只送 policy，伺服器不會動這張表單的關卡
async function savePolicy() {
  if (!selectedFormId.value) return
  if (!policyLoaded.value) {
    ElMessage.error('這張表單的通用規則還沒有成功載入，請重新選擇表單樣板後再儲存')
    return
  }
  const { maxApprovalLevel, allowDelegate, overdueDays, overdueAction } = policyForm.value
  const res = await sendWrite(
    API.workflow(selectedFormId.value),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ policy: { maxApprovalLevel, allowDelegate, overdueDays, overdueAction } })
    },
    '儲存通用規則失敗'
  )
  if (!res) return
  ElMessage.success('已儲存通用規則')
}

/* 新增/編輯樣板 */
function openFormDialog(mode='create', row=null) {
  formDialogMode.value = mode
  if (mode === 'edit' && !row) {
    row = forms.value.find((item) => item._id === selectedFormId.value) || null
  }
  if (mode === 'edit' && row) {
    // 編輯既有樣板：顯示已儲存的表單性質，不再跟著名稱自動推斷
    formSemanticTouched.value = true
    formDialog.value = {
      _id: row._id,
      name: row.name,
      category: row.category || firstCategoryValue.value || '',
      semanticType: row.semanticType || 'general',
      is_active: row.is_active,
      description: row.description || ''
    }
  } else {
    formSemanticTouched.value = false
    formDialog.value = {
      _id: '',
      name: '',
      category: firstCategoryValue.value || '',
      semanticType: inferFormSemanticType(''),
      is_active: true,
      description: ''
    }
  }
  formDialogVisible.value = true
}

async function saveFormTemplate() {
  const payload = { ...formDialog.value }
  if (typeof payload.name === 'string') payload.name = payload.name.trim()
  if (!payload.name) {
    ElMessage.error('請輸入表單名稱')
    return
  }
  if (!payload.category && firstCategoryValue.value) {
    payload.category = firstCategoryValue.value
  }
  if (!payload.semanticType) {
    payload.semanticType = inferFormSemanticType(payload.name)
  }
  const isEdit = formDialogMode.value === 'edit'
  const res = await sendWrite(
    isEdit ? `${API.forms}/${payload._id}` : API.forms,
    {
      method: isEdit ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    '儲存樣板失敗'
  )
  if (!res) return
  formDialogVisible.value = false
  await loadForms()
  if (!selectedFormId.value) selectedFormId.value = forms.value[0]?._id || ''
  await loadWorkflow()
}

async function removeForm(row = null) {
  const target = row && typeof row === 'object' && row._id
    ? row
    : forms.value.find((item) => item._id === selectedFormId.value)
  const id = target?._id || selectedFormId.value
  if (!id) return
  try {
    await ElMessageBox.confirm(
      confirmationMessage([
        `確定要刪除表單「${target?.name || ''}」嗎？`,
        '還沒有任何申請單用過這張表單時，會連同欄位與流程一起刪除，無法復原。',
        '如果已經有申請單（包含簽核中與歷史紀錄），系統不會刪除，而是改為「停用」：員工不能再申請，但舊的申請單與簽核中的單子都能照常查看與處理。',
      ]),
      '確認刪除表單樣板',
      { confirmButtonText: '確定刪除', cancelButtonText: '取消', type: 'warning' }
    )
  } catch (error) {
    return // 取消
  }
  const res = await sendWrite(`${API.forms}/${id}`, { method: 'DELETE' }, '刪除樣板失敗')
  if (!res) return
  const body = await readJson(res)
  if (body?.deactivated) {
    ElMessage.success(body.message || '這張表單已有申請單，已改為停用而沒有刪除')
  } else {
    ElMessage.success('已刪除表單樣板')
    if (selectedFormId.value === id) selectedFormId.value = ''
  }
  await loadForms()
}

/* 流程步驟 Dialog */
async function openWorkflowDialog(row) {
  const formId = row._id
  const seq = ++workflowDialogSeq
  // 再開別張表單時，前一張還沒回來的回應會被丟掉，不會把它的關卡塞進現在的視窗、再被儲存到這張表單
  const isStale = () => seq !== workflowDialogSeq || selectedFormId.value !== formId
  selectedFormId.value = formId
  workflowDialogVisible.value = true
  workflowSteps.value = []
  workflowLoaded.value = false
  // 通用規則跟著這張表單：先回到預設值，也讓還在等的 loadWorkflow 作廢
  policyLoadSeq += 1
  policyForm.value = { ...DEFAULT_POLICY_FORM }
  policyLoaded.value = false
  const res = await readApi(API.workflow(formId))
  if (isStale()) return
  if (!res) {
    ElMessage.error(LOAD_FAILURE_MESSAGE)
    return
  }
  if (res.ok) {
    const wf = await readJson(res)
    if (isStale()) return
    policyForm.value = { ...DEFAULT_POLICY_FORM, ...(wf?.policy || {}) }
    policyLoaded.value = true
    // 依 step_order 排好（與伺服器儲存 / 執行的順序一致），再依位置重新編號
    const stored = Array.isArray(wf?.steps) ? wf.steps : []
    const ordered = stored
      .map((step, index) => ({ step, index }))
      .sort((a, b) => ((Number(a.step.step_order) || a.index + 1) - (Number(b.step.step_order) || b.index + 1)) || (a.index - b.index))
      .map((item) => item.step)
    workflowSteps.value = normalizeWorkflowSteps(ordered)
    workflowLoaded.value = true
  } else if (res.status === 404) {
    // 這張表單還沒有流程：從空白開始設定（通用規則也是預設值）
    workflowSteps.value = []
    workflowLoaded.value = true
    policyLoaded.value = true
  } else {
    const message = await describeFailure(res, '載入流程關卡失敗')
    if (!isStale()) ElMessage.error(message)
    return
  }
  // 重新讀標籤與持有人數，顯示最新狀態
  await loadSignTags()
}
function addStep() {
  if (workflowSteps.value.length >= MAX_WORKFLOW_STEPS) {
    ElMessage.error(`最多只能設定 ${MAX_WORKFLOW_STEPS} 關`)
    return
  }
  const step = normalizeStep({
    step_order: workflowSteps.value.length + 1,
    approver_type: 'user',
    approver_value: [],
    scope_type: 'none',
    is_required: true,
    all_must_approve: true,
    can_return: true,
  })
  workflowSteps.value.push(step)
}
function removeStep(i) {
  workflowSteps.value.splice(i, 1)
  workflowSteps.value = normalizeWorkflowSteps(workflowSteps.value)
}
function moveStep(index, offset) {
  const target = index + offset
  if (target < 0 || target >= workflowSteps.value.length) return
  const next = [...workflowSteps.value]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  workflowSteps.value = normalizeWorkflowSteps(next)
}

// 儲存前需要管理者確認的事項：失效的對象會被移除（remove）、其他只是提醒（warn）
function collectSaveIssues(steps) {
  const issues = []
  steps.forEach((step, idx) => {
    const info = analyzeStep(step)
    const label = `第${idx + 1}關（${approverTypeLabel(step.approver_type)}）`
    if (info.stale.length) {
      const result = step.approver_type === 'manager' ? '儲存後會改為「申請者的主管」' : '儲存時會移除'
      issues.push({ kind: 'remove', text: `${label}：${describeStale(step, info)}，${result}。` })
    }
    if (isStaleScope(step)) {
      issues.push({ kind: 'remove', text: `${label}：範圍「${step.scope_type}」已不再支援，儲存時會改為「不限」。` })
    }
    if (step.approver_type === 'tag' && step.is_required !== false && info.holders === 0) {
      issues.push({
        kind: 'warn',
        text: `${label}：標籤「${normalizeTagText(step.approver_value)}」目前沒有任何在職員工持有，員工送出申請時會因找不到簽核人而失敗（可以先儲存，再到員工管理為負責的人加上此標籤）。`,
      })
    }
    if ((step.approver_type === 'user' || step.approver_type === 'manager') && step.is_required !== false) {
      const valid = info.values.filter((value) => !info.stale.includes(value))
      if (valid.length && valid.every((value) => info.ineligible.includes(value))) {
        issues.push({ kind: 'warn', text: `${label}：選擇的人員目前都不能簽核（已離職、留職停薪或帳號停用），員工送出申請時會找不到簽核人。` })
      }
    }
  })
  if (!steps.length) {
    issues.push({ kind: 'warn', text: '這張表單沒有任何簽核關卡，儲存後員工將無法送出這張表單的申請。' })
  }
  return issues
}

// 送給伺服器的關卡：去掉內部欄位，並移除（或還原預設的）已失效的對象
function toPayloadStep(step, idx) {
  const { __meta, ...clean } = step
  const info = analyzeStep(step)
  const stale = new Set(info.stale)
  if (Array.isArray(clean.approver_value)) {
    clean.approver_value = clean.approver_value.filter((value) => !stale.has(toValueString(value)))
  } else if (stale.has(toValueString(clean.approver_value))) {
    clean.approver_value = clean.approver_type === 'manager' ? APPLICANT_SUPERVISOR_VALUE : ''
  }
  if (isStaleScope(step) || !scopeApplies(clean.approver_type)) clean.scope_type = 'none'
  const name = typeof clean.name === 'string' ? clean.name.trim() : ''
  if (name) clean.name = name
  else delete clean.name
  return { ...clean, step_order: idx + 1 }
}

async function saveWorkflow() {
  if (!selectedFormId.value) return
  if (!workflowLoaded.value) {
    ElMessage.error('流程關卡還沒有成功載入，請關閉後重新開啟再編輯')
    return
  }
  const normalizedSteps = normalizeWorkflowSteps(workflowSteps.value)
  workflowSteps.value = normalizedSteps
  const invalidStepEntry = normalizedSteps
    .map((step, idx) => ({ step, idx }))
    .find(({ step }) => {
      const meta = step.__meta || {}
      if (meta.requiresApprover) return !meta.hasApprover
      if (Array.isArray(step.approver_value)) return step.approver_value.length === 0
      if (typeof step.approver_value === 'string') return step.approver_value.trim() === ''
      return false
    })
  if (invalidStepEntry) {
    const { step, idx } = invalidStepEntry
    const typeLabel = APPROVER_TYPES.find((opt) => opt.value === step.approver_type)?.label || step.approver_type
    const stepLabel = `第${idx + 1}關`
    const staleHint = step.__meta?.staleValues?.length ? '（原本選的對象已失效，請重新選擇）' : ''
    const message = `${stepLabel}${typeLabel ? `（${typeLabel}）` : ''}缺少有效簽核人${staleHint}`
    if (typeof ElMessage?.error === 'function') {
      ElMessage.error(message)
    } else if (typeof ElMessage === 'function') {
      ElMessage(message)
    }
    return
  }

  const issues = collectSaveIssues(normalizedSteps)
  if (issues.length) {
    const hasRemoval = issues.some((issue) => issue.kind === 'remove')
    try {
      await ElMessageBox.confirm(
        h('div', { class: 'confirm-lines' }, [
          h('p', { style: 'margin:0 0 6px' }, '儲存前請確認：'),
          h('ul', { style: 'margin:0;padding-left:18px' }, issues.map((issue) => h('li', { style: 'margin-bottom:4px' }, issue.text))),
        ]),
        '儲存前請確認',
        {
          confirmButtonText: hasRemoval ? '移除失效項目並儲存' : '仍要儲存',
          cancelButtonText: '回去修改',
          type: 'warning',
        }
      )
    } catch (error) {
      return // 回去修改
    }
  }

  // 只送關卡：通用規則在自己的分頁儲存，兩邊互不覆蓋
  const payload = { steps: normalizedSteps.map(toPayloadStep) }
  const res = await sendWrite(
    API.workflow(selectedFormId.value),
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    },
    '儲存流程失敗'
  )
  if (!res) return
  workflowDialogVisible.value = false
  ElMessage.success('流程已儲存')
}

async function restoreDefaults() {
  try {
    await ElMessageBox.confirm(
      '確定要補齊預設表單嗎？系統只會建立缺少的預設表單，現有表單與歷史申請都會保留。',
      '確認補齊預設表單',
      {
        confirmButtonText: '確定',
        cancelButtonText: '取消',
        type: 'warning',
      }
    )

    const res = await apiFetch(API.restoreDefaults, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })

    if (res.ok) {
      const result = await res.json()
      const created = result.createdCount ?? result.count
      const repaired = Number(result.repairedCount) || 0
      ElMessage.success(
        `已補齊預設值，新增 ${created} 個，保留 ${result.preservedCount ?? 0} 個${repaired ? `，補回 ${repaired} 個表單的關卡` : ''}`
      )
      // 顯示檢查報告：預設表單需要的標籤與持有人數、找不到簽核人的關卡
      const warnings = Array.isArray(result.warnings) ? result.warnings : []
      const templates = Array.isArray(result.templates) ? result.templates : []
      restoreReport.value = {
        title: warnings.length
          ? `補齊預設值完成，但有 ${warnings.length} 個關卡目前找不到可簽核的人`
          : '補齊預設值完成，預設表單需要的簽核標籤都有人持有',
        warnings,
        templates: templates.map((item) => ({
          ...item,
          requiredTags: (Array.isArray(item.requiredTags) ? item.requiredTags : []).map((tag) => ({
            ...tag,
            holders: Number.isFinite(Number(tag.holders)) && tag.holders !== null ? Number(tag.holders) : null,
          })),
        })),
      }
      selectedFormId.value = ''
      await loadForms()
      if (forms.value.length > 0) {
        selectedFormId.value = forms.value[0]._id
        await loadWorkflow()
      }
      await loadSignTags()
    } else {
      const error = await readJson(res)
      ElMessage.error(`恢復失敗: ${error?.error || '未知錯誤'}`)
    }
  } catch (e) {
    if (e !== 'cancel') {
      console.error('恢復預設值失敗:', e)
      ElMessage.error('恢復失敗，請稍後再試')
    }
  }
}

onMounted(async () => {
  await Promise.all([loadCategories(), loadCustomFieldOptions(), loadDictionaryItems()])
  await loadForms()
  selectedFormId.value = forms.value[0]?._id || ''
  if (selectedFormId.value) await loadWorkflow()
  await loadGroupOptions()
  await loadOrganizationOptions()
  await loadEmployeeOptions()
  await Promise.all([loadSignRoleOptions(), loadSignLevelOptions(), loadSignTags(), loadDepartmentRecords()])
})
</script>

<style scoped>
.approval-flow-setting { padding: 20px; }
.rule-form { max-width: 620px; margin-top: 20px; }
.template-select-label { flex: 0 0 auto; font-weight: 600; color: #334155; }
.field-hint { flex: 0 0 100%; margin-top: 4px; font-size: 12px; line-height: 1.6; color: #64748b; }
.policy-notice { margin-bottom: 16px; padding: 10px 12px; border-radius: 6px; background: #f1f5f9; color: #475569; font-size: 13px; line-height: 1.7; }
.policy-notice strong { display: block; margin-bottom: 2px; color: #334155; }
.policy-tag { margin-left: 10px; }
.step-hint { font-size: 12px; line-height: 1.5; color: #64748b; }
.step-hint-inline { margin-left: 12px; }
.step-notices { margin-top: 6px; }
.step-notice { margin: 4px 6px 0 0; max-width: 100%; height: auto; white-space: normal; line-height: 1.5; }
.restore-report { margin-top: 16px; max-width: 900px; }
.restore-report-lead { margin: 4px 0; font-size: 13px; line-height: 1.6; }
.restore-report-list { margin: 4px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.7; }
.restore-report-tags { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.restore-report-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; }
.restore-report-name { min-width: 88px; font-weight: 600; color: #334155; }
.restore-report-muted { color: #94a3b8; }
.restore-report-tag { margin: 0; }
.field-inactive-tag { margin-left: 6px; }
:deep(.field-row-inactive) { opacity: 0.55; }
</style>
