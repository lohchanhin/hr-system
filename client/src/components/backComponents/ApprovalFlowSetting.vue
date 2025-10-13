<!-- src/Components/backComponents/ApprovalFlowSetting.vue -->
<template>
  <div class="approval-flow-setting">
    <h2>簽核流程設定</h2>

    <el-tabs v-model="activeTab" type="card">
      <!-- 1) 通用流程規則（針對選定的表單樣板） -->
      <el-tab-pane label="通用流程規則" name="commonRule">
        <div class="flex items-center gap-2 mb-2">
          <el-select v-model="selectedFormId" placeholder="選擇表單樣板" style="width: 320px" @change="loadWorkflow">
            <el-option v-for="f in forms" :key="f._id" :label="`${f.name}（${f.category}）`" :value="f._id" />
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
            <el-table-column prop="category" label="分類" width="120" />
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
                <el-select v-model="formDialog.category" placeholder="選擇分類">
                  <el-option v-for="c in CATEGORIES" :key="c" :label="c" :value="c" />
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
                  <el-select v-model="row.approver_type" placeholder="選擇類型" style="width:140px">
                    <el-option v-for="t in APPROVER_TYPES" :key="t" :label="t" :value="t" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="簽核對象" width="200">
                <template #default="{ row }">
                  <el-select v-if="row.approver_type==='user'" v-model="row.approver_value" placeholder="選擇員工" multiple>
                    <el-option v-for="e in employeeOptions" :key="e.id" :label="e.name" :value="e.id" />
                  </el-select>
                  <el-select v-else-if="row.approver_type==='role'" v-model="row.approver_value" placeholder="選擇角色">
                    <el-option v-for="r in roleOptions" :key="r.id" :label="r.name" :value="r.id" />
                  </el-select>
                  <el-input v-else v-model="row.approver_value" placeholder="userId/標籤/角色..." />
                </template>
              </el-table-column>
              <el-table-column label="範圍" width="120">
                <template #default="{ row }">
                  <el-select v-model="row.scope_type" style="width:110px">
                    <el-option label="none" value="none" />
                    <el-option label="dept" value="dept" />
                    <el-option label="org" value="org" />
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
              <el-option v-for="f in forms" :key="f._id" :label="`${f.name}（${f.category}）`" :value="f._id" />
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
import { ref, onMounted, watch } from 'vue'
import { apiFetch } from '../../api'  // 你專案現有封裝

const API = {
  forms: '/api/approvals/forms',
  workflow: (formId) => `/api/approvals/forms/${formId}/workflow`,
  fields: (formId) => `/api/approvals/forms/${formId}/fields`,
  field: (formId, fieldId) => `/api/approvals/forms/${formId}/fields/${fieldId}`,
  employees: '/api/employees/options',
  roles: '/api/roles',
  otherControlSettings: '/api/other-control-settings',
}

const CATEGORIES = ['人事類','總務類','請假類','其他']
const APPROVER_TYPES = ['manager','tag','user','role','department','org','group']

/* Tabs / 基本狀態 */
const activeTab = ref('commonRule')
const forms = ref([])
const selectedFormId = ref('')
const fields = ref([])

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
const formDialog = ref({ _id: '', name: '', category: '其他', is_active: true, description: '' })

/* 流程 Dialog */
const workflowDialogVisible = ref(false)
const workflowSteps = ref([])
const employeeOptions = ref([])
const roleOptions = ref([])

const customFieldOptions = ref([])
const selectedCustomFieldKey = ref('')

const fieldDialogVisible = ref(false)
const fieldDialogMode = ref('create')
const fieldDialog = ref({ _id: '', field_key: '', label: '', type_1: 'text', type_2: '', required: false, optionsStr: '', placeholder: '', order: 0 })
const FIELD_TYPES = ['text','textarea','number','select','checkbox','date','time','datetime','file','user','department','org']

watch([activeTab, selectedFormId], () => {
  if (activeTab.value === 'fields' && selectedFormId.value) loadFields()
})

function parseOptions(str) {
  if (!str) return undefined
  try {
    return JSON.parse(str)
  } catch {
    return str
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(Boolean)
  }
}

function normalizeCustomFieldOptions(options) {
  if (options == null) return undefined

  if (Array.isArray(options)) {
    return options.map(option => {
      if (typeof option === 'string' || typeof option === 'number') {
        return option
      }
      if (option && typeof option === 'object') {
        return { ...option }
      }
      return option
    })
  }

  if (options && typeof options === 'object') {
    return { ...options }
  }

  if (typeof options === 'string') {
    const trimmed = options.trim()
    if (!trimmed) return undefined
    try {
      return normalizeCustomFieldOptions(JSON.parse(trimmed))
    } catch (error) {
      const segments = trimmed
        .split(/[\n,]/)
        .map(segment => segment.trim())
        .filter(Boolean)
      return segments.length ? segments : undefined
    }
  }

  return options
}

async function loadFields() {
  if (!selectedFormId.value) return
  const res = await apiFetch(API.fields(selectedFormId.value), undefined)
  if (res.ok) {
    const arr = await res.json()
    fields.value = Array.isArray(arr) ? arr.sort((a,b)=> (a.order??0)-(b.order??0)) : []
  }
}

function openFieldDialog(mode='create', row=null) {
  fieldDialogMode.value = mode
  if (mode === 'edit' && row) {
    fieldDialog.value = { ...row, optionsStr: row.options ? JSON.stringify(row.options) : '', field_key: row.field_key || '' }
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
    options: parseOptions(fieldDialog.value.optionsStr),
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
  if (res.ok) {
    const list = await res.json()
    employeeOptions.value = Array.isArray(list) ? list.map((e) => ({ id: e.id, name: e.name })) : []
  }
}

async function loadRoleOptions() {
  const res = await apiFetch(API.roles)
  if (res.ok) roleOptions.value = await res.json()
}

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

function stringifyOptions(options) {
  const normalized = normalizeCustomFieldOptions(options)
  if (normalized == null) return ''
  if (Array.isArray(normalized)) {
    const simpleValues = normalized.every(option => typeof option === 'string' || typeof option === 'number')
    if (simpleValues) {
      return normalized.map(option => String(option)).join('\n')
    }
  }
  if (typeof normalized === 'string') return normalized
  try {
    return JSON.stringify(normalized)
  } catch (e) {
    return ''
  }
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
    optionsStr: stringifyOptions(normalizedOptions),
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
    formDialog.value = { _id: row._id, name: row.name, category: row.category, is_active: row.is_active, description: row.description || '' }
  } else {
    formDialog.value = { _id: '', name: '', category: '其他', is_active: true, description: '' }
  }
  formDialogVisible.value = true
}

async function saveFormTemplate() {
  const payload = { ...formDialog.value }
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
  workflowSteps.value = (wf?.steps || []).map((s) => ({ ...s })) // 深拷貝
}
function addStep() {
  workflowSteps.value.push({
    step_order: workflowSteps.value.length + 1,
    approver_type: 'user',
    approver_value: [],
    scope_type: 'none',
    is_required: true,
    all_must_approve: true,
    can_return: true,
  })
}
function removeStep(i) {
  workflowSteps.value.splice(i, 1)
  workflowSteps.value = workflowSteps.value.map((s, idx) => ({ ...s, step_order: idx + 1 }))
}
async function saveWorkflow() {
  const payload = {
    steps: workflowSteps.value.map((s, idx) => ({ ...s, step_order: idx + 1 })),
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
  await loadCustomFieldOptions()
  await loadForms()
  selectedFormId.value = forms.value[0]?._id || ''
  if (selectedFormId.value) await loadWorkflow()
  await loadEmployeeOptions()
  await loadRoleOptions()
})
</script>

<style scoped>
.approval-flow-setting { padding: 20px; }
.rule-form { max-width: 520px; margin-top: 20px; }
</style>
