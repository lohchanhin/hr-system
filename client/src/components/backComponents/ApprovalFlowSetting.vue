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
          <el-dialog v-model="formDialogVisible" :title="formDialogMode==='edit' ? '編輯表單樣板' : '新增表單樣板'" width="520px">
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
          <el-dialog v-model="workflowDialogVisible" title="流程關卡設定" width="800px">
            <div class="mb-2">
              <el-button size="small" @click="addStep">新增關卡</el-button>
            </div>
            <el-table :data="workflowSteps" border>
              <el-table-column label="#" width="60">
                <template #default="{ $index }">{{ $index + 1 }}</template>
              </el-table-column>
              <el-table-column label="Approver Type" width="150">
                <template #default="{ row }">
                  <el-select v-model="row.approver_type" placeholder="選擇類型" style="width:140px">
                    <el-option v-for="t in APPROVER_TYPES" :key="t" :label="t" :value="t" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="Approver Value" width="200">
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
              <el-table-column label="Scope" width="120">
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
    </el-tabs>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { apiFetch } from '../../api'  // 你專案現有封裝

const API = {
  forms: '/api/approvals/forms',
  workflow: (formId) => `/api/approvals/forms/${formId}/workflow`,
  employees: '/api/employees/options',
  roles: '/api/roles',
}

const CATEGORIES = ['人事類','總務類','請假類','其他']
const APPROVER_TYPES = ['manager','tag','user','role','department','org','group']

/* Tabs / 基本狀態 */
const activeTab = ref('commonRule')
const forms = ref([])
const selectedFormId = ref('')

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
function openWorkflowDialog(row) {
  selectedFormId.value = row._id
  loadWorkflow().then(async () => {
    const res = await apiFetch(API.workflow(selectedFormId.value))
    const wf = res.ok ? await res.json() : {}
    workflowSteps.value = (wf?.steps || []).map(s => ({ ...s })) // 深拷貝
    workflowDialogVisible.value = true
  })
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
