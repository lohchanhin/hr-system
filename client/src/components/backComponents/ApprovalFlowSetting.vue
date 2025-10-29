<!-- src/Components/backComponents/ApprovalFlowSetting.vue -->
<template>
  <div class="approval-flow-setting">
    <h2>簽核流程設定</h2>

    <el-tabs v-model="activeTab" type="card">
      <!-- 1) 通用流程規則（針對選定的表單樣板） -->
      <el-tab-pane label="通用流程規則" name="commonRule">
        <div class="flex items-center gap-2 mb-2">
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
          <el-button type="danger" :disabled="!selectedFormId" @click="removeForm">刪除樣板</el-button>
        </div>

        <el-form :model="policyForm" label-width="160px" class="rule-form" v-if="selectedFormId">
          <el-form-item label="最大簽核關卡數">
            <el-input-number v-model="policyForm.maxApprovalLevel" :min="1" />
          </el-form-item>
          <el-form-item label="是否允許代理簽核">
            <el-switch v-model="policyForm.allowDelegate" />
          </el-form-item>
          <el-form-item label="逾時提醒(天)">
            <el-input-number v-model="policyForm.overdueDays" :min="1" />
          </el-form-item>
          <el-form-item label="逾時處理方式">
            <el-select v-model="policyForm.overdueAction" placeholder="選擇逾時行為">
              <el-option label="不處理" value="none" />
              <el-option label="自動通過" value="autoPass" />
              <el-option label="自動退回" value="autoReject" />
            </el-select>
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="savePolicy">儲存通用規則</el-button>
          </el-form-item>
        </el-form>
        <div v-else class="text-gray-500">請先從上方下拉選擇一個表單樣板。</div>
      </el-tab-pane>

      <!-- 2) 申請類型（表單樣板）與流程關卡設定 -->
      <el-tab-pane label="申請類型 / 關卡" name="approvalLevels">
        <div class="tab-content">
          <el-button type="primary" @click="openFormDialog()">新增表單樣板</el-button>
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
              <el-form-item label="表單名稱"><el-input v-model="formDialog.name" /></el-form-item>
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
              <el-form-item label="啟用"><el-switch v-model="formDialog.is_active" /></el-form-item>
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
            width="800px"
            :append-to-body="false"
            :teleported="false"
          >
            <div class="mb-2">
              <el-button size="small" @click="addStep">新增關卡</el-button>
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
              <el-table-column label="簽核對象" width="200">
                <template #default="{ row }">
                  <el-select
                    v-if="row.approver_type==='user'"
                    v-model="row.approver_value"
                    placeholder="選擇員工"
                    multiple
                    filterable
                  >
                    <el-option v-for="e in userApproverOptions" :key="e.value" :label="e.label" :value="e.value" />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='manager'"
                    v-model="row.approver_value"
                    placeholder="選擇主管"
                    filterable
                    clearable
                  >
                    <el-option v-for="m in managerApproverOptions" :key="m.value" :label="m.label" :value="m.value" />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='tag'"
                    v-model="row.approver_value"
                    placeholder="選擇標籤"
                    filterable
                    clearable
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
                    <el-option v-for="r in signRoleOptions" :key="r.value" :label="r.label" :value="r.value" />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='level'"
                    v-model="row.approver_value"
                    placeholder="選擇層級"
                    clearable
                  >
                    <el-option v-for="lvl in signLevelOptions" :key="lvl.value" :label="lvl.label" :value="lvl.value" />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='department'"
                    v-model="row.approver_value"
                    placeholder="選擇部門"
                    filterable
                    clearable
                  >
                    <el-option v-for="dept in departmentOptions" :key="dept.value" :label="dept.label" :value="dept.value" />
                  </el-select>
                  <el-select
                    v-else-if="row.approver_type==='org'"
                    v-model="row.approver_value"
                    placeholder="選擇機構"
                    filterable
                    clearable
                  >
                    <el-option v-for="org in organizationOptions" :key="org.value" :label="org.label" :value="org.value" />
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
                    <el-option v-for="group in groupOptions" :key="group.value" :label="group.label" :value="group.value" />
                  </el-select>
                  <el-input v-else v-model="row.approver_value" placeholder="請輸入簽核對象" />
                </template>
              </el-table-column>
              <el-table-column label="範圍" width="120">
                <template #default="{ row }">
                  <el-select v-model="row.scope_type" style="width:110px" placeholder="選擇範圍">
                    <el-option v-for="opt in SCOPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="必簽" width="90">
                <template #default="{ row }"><el-switch v-model="row.is_required" /></template>
              </el-table-column>
              <el-table-column label="需全員同意" width="120">
                <template #default="{ row }"><el-switch v-model="row.all_must_approve" /></template>
              </el-table-column>
              <el-table-column label="允許退簽" width="110">
                <template #default="{ row }"><el-switch v-model="row.can_return" /></template>
              </el-table-column>
              <el-table-column label="操作" width="120">
                <template #default="{ $index }">
                  <el-button size="small" type="danger" @click="removeStep($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>

            <template #footer>
              <el-button @click="workflowDialogVisible=false">取消</el-button>
              <el-button type="primary" @click="saveWorkflow">儲存</el-button>
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

          <el-table v-if="selectedFormId" :data="fields" border>
            <el-table-column type="index" label="#" width="50" />
            <el-table-column prop="label" label="欄位名稱" />
            <el-table-column prop="type_1" label="型別1" width="120" />
            <el-table-column prop="type_2" label="型別2" width="120" />
            <el-table-column label="必填" width="80">
              <template #default="{ row }">
                <el-switch v-model="row.required" @change="updateField(row)" />
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
            <el-form-item label="型別1">
              <el-select v-model="fieldDialog.type_1" placeholder="選擇型別">
                <el-option v-for="t in FIELD_TYPES" :key="t" :label="t" :value="t" />
              </el-select>
            </el-form-item>
            <el-form-item label="型別2"><el-input v-model="fieldDialog.type_2" /></el-form-item>
            <el-form-item label="必填"><el-switch v-model="fieldDialog.required" /></el-form-item>
            <el-form-item label="選項">
              <el-input v-model="fieldDialog.optionsStr" type="textarea" :rows="2" placeholder="JSON 或以逗號分隔" />
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
import { ref, onMounted, watch, computed } from 'vue'
import { apiFetch } from '../../api'  // 你專案現有封裝
import {
  normalizeCustomFieldOptions,
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
  signRoles: '/api/approvals/sign-roles',
  signLevels: '/api/approvals/sign-levels',
  otherControlSettings: '/api/other-control-settings',
  subDepartments: '/api/sub-departments',
  formCategories: '/api/other-control-settings/form-categories'
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
const SCOPE_OPTIONS = [
  { value: 'none', label: '不限' },
  { value: 'dept', label: '部門' },
  { value: 'org', label: '機構' },
  { value: 'group', label: '群組' },
]

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

/* 通用規則 policy */
const policyForm = ref({
  maxApprovalLevel: 5,
  allowDelegate: false,
  overdueDays: 3,
  overdueAction: 'none',
})

/* 樣板 Dialog */
const formDialogVisible = ref(false)
const formDialogMode = ref('create') // 'create'|'edit'
const formDialog = ref({ _id: '', name: '', category: firstCategoryValue.value || '', is_active: true, description: '' })

/* 流程 Dialog */
const workflowDialogVisible = ref(false)
const workflowSteps = ref([])
const employeeOptions = ref([])
const organizationNameMap = ref({})
const signRoleOptions = ref([])
const signLevelOptions = ref([])
const groupOptions = ref([])

const userApproverOptions = computed(() =>
  employeeOptions.value.map((emp) => ({
    value: emp.id,
    label: emp.displayName || emp.name,
  }))
)

const APPLICANT_SUPERVISOR_VALUE = 'APPLICANT_SUPERVISOR'
const APPLICANT_SUPERVISOR_OPTION = Object.freeze({
  value: APPLICANT_SUPERVISOR_VALUE,
  label: '申請者的主管',
})

const managerApproverOptions = computed(() => {
  const seen = new Set([APPLICANT_SUPERVISOR_OPTION.value])
  const supervisors = employeeOptions.value
    .filter((emp) => emp.role === 'supervisor')
    .map((emp) => ({ value: emp.id, label: emp.displayName || emp.name }))
    .filter((opt) => {
      if (!opt.value || seen.has(opt.value)) return false
      seen.add(opt.value)
      return true
    })
  return [APPLICANT_SUPERVISOR_OPTION, ...supervisors]
})

const tagOptions = computed(() => {
  const set = new Set()
  employeeOptions.value.forEach((emp) => {
    const tags = Array.isArray(emp.signTags) ? emp.signTags : []
    tags.forEach((tag) => {
      if (tag) set.add(tag)
    })
  })
  return Array.from(set)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    .map((tag) => ({ value: tag, label: tag }))
})

const departmentOptions = computed(() => {
  const map = new Map()
  employeeOptions.value.forEach((emp) => {
    const dept = emp.department
    if (dept?.id) {
      const label = dept.name || dept.id
      map.set(dept.id, { value: dept.id, label })
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
const fieldDialog = ref({ _id: '', field_key: '', label: '', type_1: 'text', type_2: '', required: false, optionsStr: '', placeholder: '', order: 0 })
const FIELD_TYPES = ['text','textarea','number','select','checkbox','date','time','datetime','file','user','department','org']

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
  const res = await apiFetch(API.fields(selectedFormId.value), undefined)
  if (res.ok) {
    const arr = await res.json()
    fields.value = Array.isArray(arr) ? arr.sort((a,b)=> (a.order??0)-(b.order??0)) : []
  }
}

async function loadCategories() {
  const res = await apiFetch(API.formCategories)
  if (!res.ok) {
    categoryOptions.value = []
    return
  }
  const list = await res.json()
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

function openFieldDialog(mode='create', row=null) {
  fieldDialogMode.value = mode
  if (mode === 'edit' && row) {
    fieldDialog.value = {
      ...row,
      optionsStr: stringifyCustomFieldOptions(row.options),
      field_key: row.field_key || ''
    }
    selectedCustomFieldKey.value = row.field_key || ''
  } else {
    fieldDialog.value = { _id: '', field_key: '', label: '', type_1: 'text', type_2: '', required: false, optionsStr: '', placeholder: '', order: fields.value.length }
    selectedCustomFieldKey.value = ''
  }
  fieldDialogVisible.value = true
}

async function saveField() {
  if (!selectedFormId.value) return
  const payload = {
    label: fieldDialog.value.label,
    type_1: fieldDialog.value.type_1,
    type_2: fieldDialog.value.type_2,
    required: fieldDialog.value.required,
    options: parseCustomFieldOptionsInput(fieldDialog.value.optionsStr),
    placeholder: fieldDialog.value.placeholder,
    order: fieldDialog.value.order ?? fields.value.length,
  }
  if (fieldDialog.value.field_key) payload.field_key = fieldDialog.value.field_key
  let res
  if (fieldDialogMode.value === 'edit' && fieldDialog.value._id) {
    res = await apiFetch(API.field(selectedFormId.value, fieldDialog.value._id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } else {
    res = await apiFetch(API.fields(selectedFormId.value), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  }
  if (res.ok) {
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
}

async function updateField(row) {
  const payload = { label: row.label, type_1: row.type_1, type_2: row.type_2, required: row.required, options: row.options, placeholder: row.placeholder, order: row.order }
  if (row.field_key) payload.field_key = row.field_key
  await apiFetch(API.field(selectedFormId.value, row._id), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
}

async function removeField(row) {
  await apiFetch(API.field(selectedFormId.value, row._id), { method: 'DELETE' })
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
    await apiFetch(API.field(selectedFormId.value, arr[i]._id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order: i })
    })
  }
}

/* 讀取樣板列表 */
async function loadForms() {
  const res = await apiFetch(API.forms)
  if (res.ok) forms.value = await res.json()
}

async function loadEmployeeOptions() {
  const res = await apiFetch(API.employees)
  if (!res.ok) {
    employeeOptions.value = []
    return
  }
  const list = await res.json()
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
            displayName: e.displayName || (e.username ? `${e.name}（${e.username}）` : e.name),
          }
        })
    : []
}

async function loadOrganizationOptions() {
  const res = await apiFetch(API.organizations)
  if (!res.ok) {
    organizationNameMap.value = {}
    return
  }
  const list = await res.json()
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

async function loadSignRoleOptions() {
  const res = await apiFetch(API.signRoles)
  signRoleOptions.value = res.ok ? (await res.json()) ?? [] : []
}

async function loadSignLevelOptions() {
  const res = await apiFetch(API.signLevels)
  signLevelOptions.value = res.ok ? (await res.json()) ?? [] : []
}

async function loadGroupOptions() {
  const res = await apiFetch(API.subDepartments)
  if (!res.ok) {
    groupOptions.value = []
    return
  }
  const list = await res.json()
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

function pickFirstValidValue(values, validSet, allowFallback = true) {
  const allowAny = allowFallback && (!validSet || validSet.size === 0)
  for (const raw of values) {
    const str = toValueString(raw)
    if (!str) continue
    if (allowAny || (validSet && validSet.has(str))) return str
  }
  return allowAny && values.length ? toValueString(values[0]) : ''
}

function normalizeStep(step) {
  const normalized = { ...step }
  normalized.approver_type = step.approver_type || 'user'
  normalized.scope_type = step.scope_type || 'none'
  normalized.is_required = step.is_required ?? true
  normalized.all_must_approve = step.all_must_approve ?? true
  normalized.can_return = step.can_return ?? true

  const values = Array.isArray(step.approver_value)
    ? step.approver_value
    : step.approver_value != null
      ? [step.approver_value]
      : []
  const originalStrings = values.map((val) => toValueString(val)).filter((val) => Boolean(val))
  const meta = {
    requiresApprover: false,
    hasApprover: true,
    filteredOutValues: [],
    usedFallback: false,
  }

  switch (normalized.approver_type) {
    case 'user': {
      const validIds = new Set(employeeOptions.value.map((emp) => emp.id))
      const allowAny = employeeOptions.value.length === 0
      const normalizedValues = originalStrings.filter((val) => allowAny || validIds.has(val))
      meta.requiresApprover = true
      meta.hasApprover = normalizedValues.length > 0
      meta.filteredOutValues = originalStrings.filter((val) => !normalizedValues.includes(val))
      normalized.approver_value = normalizedValues
      break
    }
    case 'manager': {
      const validIds = new Set(managerApproverOptions.value.map((opt) => opt.value))
      const allowAny = employeeOptions.value.length === 0
      const resolved = pickFirstValidValue(values, validIds, allowAny)
      let finalValue = ''
      if (resolved) {
        finalValue = resolved
      } else if (validIds.has(APPLICANT_SUPERVISOR_VALUE)) {
        finalValue = APPLICANT_SUPERVISOR_VALUE
        meta.usedFallback = true
      }
      meta.requiresApprover = true
      meta.hasApprover = Boolean(finalValue)
      if (finalValue && !originalStrings.includes(finalValue)) meta.usedFallback = true
      meta.filteredOutValues = finalValue
        ? originalStrings.filter((val) => val !== finalValue && !validIds.has(val))
        : originalStrings
      normalized.approver_value = finalValue
      break
    }
    case 'tag': {
      const validTags = new Set(tagOptions.value.map((opt) => opt.value))
      const allowAny = employeeOptions.value.length === 0
      const picked = pickFirstValidValue(values, validTags, allowAny)
      meta.requiresApprover = true
      meta.hasApprover = Boolean(picked)
      meta.filteredOutValues = picked
        ? originalStrings.filter((val) => val !== picked && !validTags.has(val))
        : originalStrings
      normalized.approver_value = picked
      break
    }
    case 'role': {
      const validRoles = new Set(signRoleOptions.value.map((opt) => opt.value))
      const allowAny = signRoleOptions.value.length === 0
      const picked = pickFirstValidValue(values, validRoles, allowAny)
      meta.requiresApprover = true
      meta.hasApprover = Boolean(picked)
      meta.filteredOutValues = picked
        ? originalStrings.filter((val) => val !== picked && !validRoles.has(val))
        : originalStrings
      normalized.approver_value = picked
      break
    }
    case 'level': {
      const validLevels = new Set(signLevelOptions.value.map((opt) => opt.value))
      const allowAny = signLevelOptions.value.length === 0
      const picked = pickFirstValidValue(values, validLevels, allowAny)
      meta.requiresApprover = true
      meta.hasApprover = Boolean(picked)
      meta.filteredOutValues = picked
        ? originalStrings.filter((val) => val !== picked && !validLevels.has(val))
        : originalStrings
      normalized.approver_value = picked
      break
    }
    case 'department': {
      const validDepts = new Set(departmentOptions.value.map((opt) => opt.value))
      const allowAny = employeeOptions.value.length === 0
      const picked = pickFirstValidValue(values, validDepts, allowAny)
      meta.requiresApprover = true
      meta.hasApprover = Boolean(picked)
      meta.filteredOutValues = picked
        ? originalStrings.filter((val) => val !== picked && !validDepts.has(val))
        : originalStrings
      normalized.approver_value = picked
      break
    }
    case 'org': {
      const validOrgs = new Set(organizationOptions.value.map((opt) => opt.value))
      const allowAny = employeeOptions.value.length === 0
      const picked = pickFirstValidValue(values, validOrgs, allowAny)
      meta.requiresApprover = true
      meta.hasApprover = Boolean(picked)
      meta.filteredOutValues = picked
        ? originalStrings.filter((val) => val !== picked && !validOrgs.has(val))
        : originalStrings
      normalized.approver_value = picked
      break
    }
    case 'group': {
      const validGroups = new Set(groupOptions.value.map((opt) => opt.value))
      const allowAny = groupOptions.value.length === 0
      const filtered = originalStrings.filter((val) => allowAny || validGroups.has(val))
      const normalizedValues = filtered.filter((val, idx) => filtered.indexOf(val) === idx)
      meta.requiresApprover = true
      meta.hasApprover = normalizedValues.length > 0
      meta.filteredOutValues = normalizedValues.length === originalStrings.length
        ? []
        : originalStrings.filter((val) => !filtered.includes(val))
      normalized.approver_value = normalizedValues
      break
    }
    default: {
      const first = values.length ? values[0] : ''
      normalized.approver_value = toValueString(first)
    }
  }

  normalized.__meta = meta
  return normalized
}

function normalizeWorkflowSteps(steps = []) {
  return steps.map((step, idx) => {
    const normalized = normalizeStep(step)
    normalized.step_order = step.step_order ?? idx + 1
    if (normalized.__meta) normalized.__meta.stepOrder = normalized.step_order
    return normalized
  })
}

function handleApproverTypeChange(step) {
  const normalized = normalizeStep(step)
  if (normalized.approver_type === 'manager') {
    const validIds = new Set(managerApproverOptions.value.map((opt) => opt.value))
    if (!normalized.approver_value || !validIds.has(normalized.approver_value)) {
      if (validIds.has(APPLICANT_SUPERVISOR_VALUE)) {
        normalized.approver_value = APPLICANT_SUPERVISOR_VALUE
      }
    }
  } else if (normalized.approver_type === 'group') {
    if (!Array.isArray(normalized.approver_value)) normalized.approver_value = []
  }
  Object.assign(step, normalized)
}

watch([employeeOptions, signRoleOptions, signLevelOptions, groupOptions], () => {
  workflowSteps.value = normalizeWorkflowSteps(workflowSteps.value)
})

async function loadCustomFieldOptions() {
  const res = await apiFetch(API.otherControlSettings)
  if (!res.ok) {
    customFieldOptions.value = []
    return
  }
  const data = await res.json()
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
    fieldDialog.value = { ...fieldDialog.value, field_key: '' }
    return
  }
  const option = customFieldOptions.value.find(opt => opt.value === fieldKey)
  if (!option) return
  const { field } = option
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
  }
}

/* 切換樣板時，同步讀 workflow.policy */
async function loadWorkflow() {
  if (!selectedFormId.value) return
  const res = await apiFetch(API.workflow(selectedFormId.value))
  if (res.ok) {
    const wf = await res.json()
    policyForm.value = { ...policyForm.value, ...(wf?.policy || {}) }
  }
}

async function savePolicy() {
  if (!selectedFormId.value) return
  await apiFetch(API.workflow(selectedFormId.value), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ policy: policyForm.value })
  })
  ElMessage.success('已儲存通用規則')
}

/* 新增/編輯樣板 */
function openFormDialog(mode='create', row=null) {
  formDialogMode.value = mode
  if (mode === 'edit' && row) {
    formDialog.value = {
      _id: row._id,
      name: row.name,
      category: row.category || firstCategoryValue.value || '',
      is_active: row.is_active,
      description: row.description || ''
    }
  } else {
    formDialog.value = {
      _id: '',
      name: '',
      category: firstCategoryValue.value || '',
      is_active: true,
      description: ''
    }
  }
  formDialogVisible.value = true
}

async function saveFormTemplate() {
  const payload = { ...formDialog.value }
  if (!payload.category && firstCategoryValue.value) {
    payload.category = firstCategoryValue.value
  }
  let res
  if (formDialogMode.value === 'edit') {
    res = await apiFetch(`${API.forms}/${payload._id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } else {
    res = await apiFetch(API.forms, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  }
  if (res.ok) {
    formDialogVisible.value = false
    await loadForms()
    if (!selectedFormId.value) selectedFormId.value = forms.value[0]?._id || ''
    await loadWorkflow()
  }
}

async function removeForm(row = null) {
  const id = row?._id || selectedFormId.value
  if (!id) return
  await apiFetch(`${API.forms}/${id}`, { method: 'DELETE' })
  if (selectedFormId.value === id) selectedFormId.value = ''
  await loadForms()
}

/* 流程步驟 Dialog */
async function openWorkflowDialog(row) {
  selectedFormId.value = row._id
  workflowDialogVisible.value = true
  workflowSteps.value = []
  await loadWorkflow()
  const res = await apiFetch(API.workflow(selectedFormId.value))
  const wf = res.ok ? await res.json() : {}
  workflowSteps.value = normalizeWorkflowSteps(wf?.steps || [])
}
function addStep() {
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
async function saveWorkflow() {
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
    const message = `${stepLabel}${typeLabel ? `（${typeLabel}）` : ''}缺少有效簽核人`
    if (typeof ElMessage?.error === 'function') {
      ElMessage.error(message)
    } else if (typeof ElMessage === 'function') {
      ElMessage(message)
    }
    return
  }
  const payload = {
    steps: normalizedSteps.map((s, idx) => {
      const { __meta, ...cleanStep } = s
      return { ...cleanStep, step_order: idx + 1 }
    }),
    policy: policyForm.value,
  }
  await apiFetch(API.workflow(selectedFormId.value), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  workflowDialogVisible.value = false
  ElMessage.success('流程已儲存')
}

onMounted(async () => {
  await Promise.all([loadCategories(), loadCustomFieldOptions()])
  await loadForms()
  selectedFormId.value = forms.value[0]?._id || ''
  if (selectedFormId.value) await loadWorkflow()
  await loadGroupOptions()
  await loadOrganizationOptions()
  await loadEmployeeOptions()
  await Promise.all([loadSignRoleOptions(), loadSignLevelOptions()])
})
</script>

<style scoped>
.approval-flow-setting { padding: 20px; }
.rule-form { max-width: 520px; margin-top: 20px; }
</style>
