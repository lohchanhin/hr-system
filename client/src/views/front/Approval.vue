<!-- src/views/front/Approval.vue -->
<template>
  <div class="approval-page">
    <h2>簽核流程</h2>

    <el-tabs v-model="activeTab" type="card">
      <!-- 1) 申請表單 -->
      <el-tab-pane label="申請表單" name="apply">
        <div class="apply-box">
          <el-form label-width="120px" :model="applyState">
            <el-form-item label="選擇表單樣板">
              <el-select v-model="applyState.formId" placeholder="請選擇樣板" style="max-width: 420px" @change="onSelectForm">
                <el-option v-for="f in formTemplates" :key="f._id" :label="`${f.name}（${f.category}）`" :value="f._id" />
              </el-select>
              <el-button class="ml-2" :disabled="!applyState.formId" @click="reloadSelectedForm">重新載入</el-button>
            </el-form-item>

            <div v-if="fieldList.length">
              <el-divider content-position="left">表單內容</el-divider>

              <!-- 動態欄位渲染 -->
              <template v-for="fld in fieldList" :key="fld._id">
                <el-form-item :label="fld.label" :required="!!fld.required">
                  <!-- text -->
                  <el-input v-if="fld.type_1==='text'" v-model="applyState.formData[fld._id]" :placeholder="fld.placeholder || ''" />

                  <!-- textarea -->
                  <el-input
                    v-else-if="fld.type_1==='textarea'"
                    type="textarea"
                    :rows="3"
                    v-model="applyState.formData[fld._id]"
                    :placeholder="fld.placeholder || ''"
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

                  <!-- file（僅存檔名，實際上傳可改為你的檔案上傳 API） -->
                  <el-upload
                    v-else-if="fld.type_1==='file'"
                    :auto-upload="false"
                    v-model:file-list="fileBuffers[fld._id]"
                    list-type="text"
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

              <div v-if="workflowSteps.length">
                <el-divider content-position="left">簽核流程</el-divider>
                <ol class="wf-list">
                  <li v-for="(s, idx) in workflowSteps" :key="idx">
                    {{ s.label }}：{{ s.approvers }}
                  </li>
                </ol>
              </div>

              <div class="mt-3">
                <el-button type="primary" :loading="submitting" @click="submitApply">送出申請</el-button>
              </div>
            </div>

            <div v-else class="text-gray-500">請先選擇一個樣板。</div>
          </el-form>
        </div>
      </el-tab-pane>

      <!-- 2) 待我簽核 -->
      <el-tab-pane label="待我簽核" name="inbox">
        <el-table :data="inboxList" style="margin-top: 12px;">
          <el-table-column label="#" width="60" type="index" />
          <el-table-column label="表單名稱" width="220">
            <template #default="{ row }">{{ row.form?.name || '-' }}</template>
          </el-table-column>
          <el-table-column prop="applicant_employee.name" label="申請人" width="140">
            <template #default="{ row }">{{ row.applicant_employee?.name || '-' }}</template>
          </el-table-column>
          <el-table-column label="狀態" width="120">
            <template #default="{ row }">
              <el-tag type="warning" v-if="row.status==='pending'">待簽</el-tag>
              <el-tag type="success" v-else-if="row.status==='approved'">已核可</el-tag>
              <el-tag type="danger" v-else-if="row.status==='rejected'">已否決</el-tag>
              <el-tag v-else-if="row.status==='returned'">已退簽</el-tag>
              <span v-else>{{ row.status }}</span>
            </template>
          </el-table-column>
          <el-table-column label="目前關卡" width="120">
            <template #default="{ row }">{{ row.current_step_index + 1 }}/{{ row.steps?.length || 0 }}</template>
          </el-table-column>
          <el-table-column label="建立時間" width="180">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="300">
            <template #default="{ row }">
              <el-button size="small" @click="openDetail(row._id)">查看</el-button>
              <el-button type="primary" size="small" @click="openAction(row, 'approve')">核可</el-button>
              <el-button type="danger" size="small" @click="openAction(row, 'reject')">否決</el-button>
              <el-button size="small" @click="openAction(row, 'return')">退簽</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 3) 我的申請 -->
      <el-tab-pane label="我的申請" name="mine">
        <el-table :data="myList" style="margin-top: 12px;">
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
              <span v-else>{{ row.status }}</span>
            </template>
          </el-table-column>
          <el-table-column label="目前關卡" width="120">
            <template #default="{ row }">{{ row.current_step_index + 1 }}/{{ row.steps?.length || 0 }}</template>
          </el-table-column>
          <el-table-column label="建立時間" width="180">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="140">
            <template #default="{ row }">
              <el-button size="small" @click="openDetail(row._id)">查看</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 詳細 Dialog -->
    <el-dialog v-model="detail.visible" title="申請單明細" width="760px">
      <div v-if="detail.doc">
        <p class="mb-2"><b>表單：</b>{{ detail.doc.form?.name }}（{{ detail.doc.form?.category }}）</p>
        <p class="mb-2"><b>申請人：</b>{{ detail.doc.applicant_employee?.name || '-' }}</p>
        <p class="mb-2"><b>狀態：</b>{{ detail.doc.status }}</p>
        <el-divider content-position="left">填寫內容</el-divider>
        <el-descriptions :column="1" size="small" border>
          <el-descriptions-item v-for="(val, key) in detail.doc.form_data" :key="key" :label="labelFromFieldId(key)">
            <span>{{ renderValue(val) }}</span>
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
              <el-table-column prop="decision" label="決議" width="120" />
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
import { ref, reactive, onMounted, computed } from 'vue'
import { apiFetch } from '../../api'

/* -------------------- Tabs -------------------- */
const activeTab = ref('inbox')

/* -------------------- 共用小工具 -------------------- */
const fmt = (d) => (d ? new Date(d).toLocaleString() : '-')
const renderValue = (v) => Array.isArray(v) ? v.join(', ') : (v ?? '-')

/* 人名快取（顯示審核人用） */
const employeeNameCache = reactive({})
function approverName(empId) {
  return employeeNameCache[empId] || empId
}

/* 供描述卡顯示欄名用 */
function labelFromFieldId(fid) {
  const f = fieldList.value.find(x => x._id === fid)
  return f ? f.label : fid
}

/* -------------------- 申請表單（動態產生） -------------------- */
const formTemplates = ref([])
const applyState = reactive({
  formId: '',
  formData: {},
})
const fieldList = ref([])
const workflowSteps = ref([])
const fileBuffers = reactive({}) // { fieldId: [FileItem...] }
const submitting = ref(false)

/* options 資料 */
const userOptions = ref([])
const deptOptions = ref([])
const orgOptions = ref([])

async function fetchUsersLite() {
  const res = await apiFetch('/api/employees')
  if (res.ok) {
    const arr = await res.json()
    userOptions.value = arr.map(e => ({ value: e._id, label: `${e.name}${e.employeeId ? ' ('+e.employeeId+')' : ''}` }))
    arr.forEach(e => { employeeNameCache[e._id] = e.name })
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
  const res = await apiFetch('/api/employees')
  if (res.ok) {
    const emps = await res.json()
    emps.forEach(e => { employeeNameCache[e._id] = e.name })
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
    // 先把 fileBuffers 轉成檔名陣列（或在這裡改為實際上傳並回寫檔案 URL）
    const payloadData = { ...applyState.formData }
    Object.keys(fileBuffers).forEach(fid => {
      const files = fileBuffers[fid] || []
      payloadData[fid] = files.map(f => f.name)
    })

    const res = await apiFetch('/api/approvals/approvals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        form_id: applyState.formId,
        form_data: payloadData
      })
    })
    if (res.ok) {
      alert('送出申請成功！')
      activeTab.value = 'mine'
      await fetchMyList()
    } else {
      const e = await res.json().catch(()=> ({}))
      alert(`送出失敗：${e.error || res.status}`)
    }
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
    inboxList.value = arr
    // 快取審核者名字
    arr.forEach(doc => {
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
    const res = await apiFetch(`/api/approvals/approvals/${actionDlg.target._id}/act`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision: actionDlg.decision, comment: actionDlg.comment })
    })
    if (res.ok) {
      actionDlg.visible = false
      await fetchInbox()
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

async function fetchMyList() {
  const res = await apiFetch('/api/approvals/approvals')
  if (res.ok) {
    myList.value = await res.json()
    // 取每筆的 form 名稱（明細才有 populate）
    await Promise.all(
      myList.value.map(async (row) => {
        if (!row.form || !row.form.name) {
          const r = await apiFetch(`/api/approvals/approvals/${row._id}`)
          if (r.ok) {
            const full = await r.json()
            formNameCache[row._id] = full?.form?.name || ''
          }
        }
      })
    )
  }
}

/* -------------------- 詳細 Dialog -------------------- */
const detail = reactive({ visible: false, doc: null })

async function openDetail(id) {
  const res = await apiFetch(`/api/approvals/approvals/${id}`)
  if (res.ok) {
    detail.doc = await res.json()
    detail.visible = true
    // 補快取人名
    (detail.doc.steps || []).forEach(s => s.approvers.forEach(a => {
      if (a.approver?._id && a.approver?.name) employeeNameCache[a.approver._id] = a.approver.name
    }))
  }
}

/* -------------------- 初始化 -------------------- */
onMounted(async () => {
  await Promise.all([loadFormTemplates(), fetchUsersLite(), fetchDepts(), fetchOrgs()])
  // 預設進待我簽核
  await Promise.all([fetchInbox(), fetchMyList()])
})
</script>

<style scoped>
.approval-page { padding: 20px; }
.apply-box { max-width: 820px; margin-top: 12px; }
.ml-2 { margin-left: 8px; }
.mt-3 { margin-top: 12px; }
.text-gray-500 { color: #6b7280; }
.mb-2 { margin-bottom: 8px; }
.mr-2 { margin-right: 8px; }
.wf-list { padding-left: 20px; }
.wf-list li { margin-bottom: 4px; }
</style>
