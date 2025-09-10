<!-- src/components/backComponents/OrgDepartmentSetting.vue -->
<template>
  <div class="org-dept-setting">
    <!-- 添加現代化的頁面標題和描述區域 -->
    <div class="page-header">
      <div class="header-content">
        <h1 class="page-title">機構與部門設定</h1>
        <p class="page-description">管理組織架構、部門層級和小單位配置</p>
      </div>
      <div class="header-stats">
        <div class="stat-item">
          <div class="stat-number">{{ orgList.length }}</div>
          <div class="stat-label">機構</div>
        </div>
        <div class="stat-item">
          <div class="stat-number">{{ deptList.length }}</div>
          <div class="stat-label">部門</div>
        </div>
        <div class="stat-item">
          <div class="stat-number">{{ subList.length }}</div>
          <div class="stat-label">小單位</div>
        </div>
      </div>
    </div>

    <!-- 美化標籤頁設計，添加圖標和現代化樣式 -->
    <el-tabs v-model="activeTab" type="card" class="org-tabs">
      <!-- 機構 -->
      <el-tab-pane name="org">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-office-building"></i>
            <span>機構管理</span>
          </div>
        </template>
        
        <div class="tab-content">
          <div class="content-header">
            <h2 class="section-title">機構列表</h2>
            <el-button type="primary" @click="openDialog('org')" class="add-btn">
              <i class="el-icon-plus"></i>
              新增機構
            </el-button>
          </div>
          
          <div class="table-container">
            <el-table 
              :data="orgList" 
              class="data-table"
              :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
              :row-style="{ height: '56px' }"
            >
              <el-table-column prop="name" label="機構名稱" min-width="200">
                <template #default="{ row }">
                  <div class="org-info">
                    <div class="org-icon">
                      <i class="el-icon-office-building"></i>
                    </div>
                    <div class="org-details">
                      <div class="org-name">{{ row.name }}</div>
                      <div class="org-unit">{{ row.unitName || '未設定' }}</div>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="systemCode" label="系統代碼" width="140">
                <template #default="{ row }">
                  <el-tag class="code-tag">{{ row.systemCode || '-' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="phone" label="聯絡電話" width="150" />
              <el-table-column prop="principal" label="負責人" width="120" />
              <el-table-column label="操作" width="200" fixed="right">
                <template #default="{ $index }">
                  <div class="action-buttons">
                    <el-button type="primary" size="small" @click="openDialog('org', $index)" class="edit-btn">
                      <i class="el-icon-edit"></i>
                      編輯
                    </el-button>
                    <el-button type="danger" size="small" @click="deleteItem('org', $index)" class="delete-btn">
                      <i class="el-icon-delete"></i>
                      刪除
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <!-- 部門 -->
      <el-tab-pane name="dept">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-s-grid"></i>
            <span>部門管理</span>
          </div>
        </template>
        
        <div class="tab-content">
          <div class="content-header">
            <h2 class="section-title">部門列表</h2>
            <div class="header-actions">
              <el-select 
                v-model="selectedOrg" 
                placeholder="篩選機構" 
                class="filter-select"
                @change="fetchList('dept', selectedOrg)"
                clearable
              >
                <el-option
                  v-for="org in orgList"
                  :key="org._id"
                  :label="org.name"
                  :value="org._id"
                />
              </el-select>
              <el-button type="primary" @click="openDialog('dept')" class="add-btn">
                <i class="el-icon-plus"></i>
                新增部門
              </el-button>
            </div>
          </div>
          
          <div class="table-container">
            <el-table
              :data="filteredDeptList"
              class="data-table"
              :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
              :row-style="{ height: '56px' }"
            >
              <el-table-column prop="name" label="部門名稱" min-width="200">
                <template #default="{ row }">
                  <div class="dept-info">
                    <div class="dept-icon">
                      <i class="el-icon-s-grid"></i>
                    </div>
                    <div class="dept-details">
                      <div class="dept-name">{{ row.name }}</div>
                      <div class="dept-unit">{{ row.unitName || '未設定' }}</div>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="code" label="部門代碼" width="140">
                <template #default="{ row }">
                  <el-tag type="success" class="code-tag">{{ row.code || '-' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="location" label="位置" width="150" />
              <el-table-column prop="manager" label="部門主管" width="120" />
              <el-table-column label="操作" width="200" fixed="right">
                <template #default="{ $index }">
                  <div class="action-buttons">
                    <el-button type="primary" size="small" @click="openDialog('dept', $index)" class="edit-btn">
                      <i class="el-icon-edit"></i>
                      編輯
                    </el-button>
                    <el-button type="danger" size="small" @click="deleteItem('dept', $index)" class="delete-btn">
                      <i class="el-icon-delete"></i>
                      刪除
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>

          <!-- 部門排班規則與中場休息設定 -->
          <div class="settings-block">
            <div class="settings-card">
              <h3 class="section-title">部門排班規則</h3>
              <el-form :model="deptScheduleForm" label-width="200px" class="settings-form">
                <el-form-item label="預設週休二日">
                  <el-switch
                    v-model="deptScheduleForm.defaultTwoDayOff"
                    active-text="啟用"
                    inactive-text="停用"
                    active-color="#10b981"
                  />
                </el-form-item>
                <el-form-item label="可否臨時調班">
                  <el-switch
                    v-model="deptScheduleForm.tempChangeAllowed"
                    active-text="允許"
                    inactive-text="禁止"
                    active-color="#10b981"
                  />
                </el-form-item>
                <el-form-item label="部門排班管理者">
                  <el-select
                    v-model="deptScheduleForm.deptManager"
                    placeholder="選擇管理者"
                    style="width: 300px"
                  >
                    <el-option
                      v-for="mgr in managerList"
                      :key="mgr.value"
                      :label="mgr.label"
                      :value="mgr.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" @click="saveDeptSchedule" class="save-settings-btn">
                    <i class="el-icon-check"></i>
                    儲存部門排班規則
                  </el-button>
                </el-form-item>
              </el-form>
            </div>

            <div class="settings-card">
              <h3 class="section-title">中場休息設定</h3>
              <el-form :model="breakSettingForm" label-width="220px" class="settings-form">
                <el-form-item label="是否啟用全局中場休息設定">
                  <el-switch
                    v-model="breakSettingForm.enableGlobalBreak"
                    active-text="啟用"
                    inactive-text="停用"
                    active-color="#10b981"
                  />
                </el-form-item>
                <el-form-item label="全局休息時間 (分鐘)">
                  <el-input-number
                    v-model="breakSettingForm.breakMinutes"
                    :min="0"
                    :max="240"
                    :disabled="!breakSettingForm.enableGlobalBreak"
                    style="width: 200px"
                  />
                </el-form-item>
                <el-form-item label="是否允許多段休息">
                  <el-switch
                    v-model="breakSettingForm.allowMultiBreak"
                    :disabled="!breakSettingForm.enableGlobalBreak"
                    active-text="允許"
                    inactive-text="不允許"
                    active-color="#10b981"
                  />
                </el-form-item>
                <el-form-item>
                  <el-button type="primary" @click="saveBreakSetting" class="save-settings-btn">
                    <i class="el-icon-check"></i>
                    儲存休息設定
                  </el-button>
                </el-form-item>
              </el-form>
            </div>
          </div>
        </div>
      </el-tab-pane>

      <!-- 小單位 -->
      <el-tab-pane name="sub">
        <template #label>
          <div class="tab-label">
            <i class="el-icon-menu"></i>
            <span>小單位管理</span>
          </div>
        </template>
        
        <div class="tab-content">
          <div class="content-header">
            <h2 class="section-title">小單位列表</h2>
            <div class="header-actions">
              <el-select
                v-model="selectedDept"
                placeholder="篩選部門"
                class="filter-select"
                @change="fetchList('sub', selectedDept)"
                clearable
              >
                <el-option
                  v-for="dept in deptList"
                  :key="dept._id"
                  :label="dept.name"
                  :value="dept._id"
                />
              </el-select>
              <el-button type="primary" @click="openDialog('sub')" class="add-btn">
                <i class="el-icon-plus"></i>
                新增小單位
              </el-button>
            </div>
          </div>

          <div v-if="selectedDeptName" class="current-dept">目前部門：{{ selectedDeptName }}</div>

          <div class="table-container">
            <el-table
              :data="filteredSubList"
              class="data-table"
              :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
              :row-style="{ height: '56px' }"
            >
              <el-table-column prop="name" label="小單位名稱" min-width="200">
                <template #default="{ row }">
                  <div class="sub-info">
                    <div class="sub-icon">
                      <i class="el-icon-menu"></i>
                    </div>
                    <div class="sub-details">
                      <div class="sub-name">{{ row.name }}</div>
                      <div class="sub-unit">{{ row.unitName || '未設定' }}</div>
                    </div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="code" label="代碼" width="120">
                <template #default="{ row }">
                  <el-tag type="info" class="code-tag">{{ row.code || '-' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column prop="headcount" label="人力需求" width="100">
                <template #default="{ row }">
                  <div class="headcount-info">
                    <i class="el-icon-user"></i>
                    {{ row.headcount || 0 }}
                  </div>
                </template>
              </el-table-column>
              <el-table-column prop="manager" label="主管" width="120" />
              <el-table-column label="操作" width="200" fixed="right">
                <template #default="{ $index }">
                  <div class="action-buttons">
                    <el-button type="primary" size="small" @click="openDialog('sub', $index)" class="edit-btn">
                      <i class="el-icon-edit"></i>
                      編輯
                    </el-button>
                    <el-button type="danger" size="small" @click="deleteItem('sub', $index)" class="delete-btn">
                      <i class="el-icon-delete"></i>
                      刪除
                    </el-button>
                  </div>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 美化對話框設計，添加更好的表單布局 -->
    <el-dialog 
      v-model="dialogVisible" 
      :title="dialogTitle" 
      width="600px"
      class="form-dialog"
    >
      <el-form :model="form" label-width="120px" class="dialog-form">
        <template v-if="currentType === 'org'">
          <div class="form-section">
            <h3 class="form-section-title">基本資訊</h3>
            <el-form-item label="機構名稱" required>
              <el-input v-model="form.name" placeholder="請輸入機構名稱" />
            </el-form-item>
            <el-form-item label="系統代碼">
              <el-input v-model="form.systemCode" placeholder="請輸入系統代碼" />
            </el-form-item>
            <el-form-item label="單位名稱">
              <el-input v-model="form.unitName" placeholder="請輸入單位名稱" />
            </el-form-item>
            <el-form-item label="機構代碼">
              <el-input v-model="form.orgCode" placeholder="請輸入機構代碼" />
            </el-form-item>
          </div>
          
          <div class="form-section">
            <h3 class="form-section-title">證照資訊</h3>
            <el-form-item label="統一編號">
              <el-input v-model="form.taxIdNumber" placeholder="請輸入統一編號" />
            </el-form-item>
            <el-form-item label="勞保編號">
              <el-input v-model="form.laborInsuranceNo" placeholder="請輸入勞保編號" />
            </el-form-item>
            <el-form-item label="健保編號">
              <el-input v-model="form.healthInsuranceNo" placeholder="請輸入健保編號" />
            </el-form-item>
            <el-form-item label="稅籍編號">
              <el-input v-model="form.taxCode" placeholder="請輸入稅籍編號" />
            </el-form-item>
          </div>
          
          <div class="form-section">
            <h3 class="form-section-title">聯絡資訊</h3>
            <el-form-item label="位置">
              <el-input v-model="form.address" placeholder="請輸入地址" />
            </el-form-item>
            <el-form-item label="連絡電話">
              <el-input v-model="form.phone" placeholder="請輸入連絡電話" />
            </el-form-item>
            <el-form-item label="負責人">
              <el-input v-model="form.principal" placeholder="請輸入負責人姓名" />
            </el-form-item>
          </div>
        </template>
        
        <template v-else-if="currentType === 'dept'">
          <div class="form-section">
            <h3 class="form-section-title">部門資訊</h3>
            <el-form-item label="所屬機構" required>
              <el-select v-model="form.organization" placeholder="選擇機構" style="width: 100%">
                <el-option v-for="org in orgList" :key="org._id" :label="org.name" :value="org._id" />
              </el-select>
            </el-form-item>
            <el-form-item label="部門名稱" required>
              <el-input v-model="form.name" placeholder="請輸入部門名稱" />
            </el-form-item>
            <el-form-item label="部門代碼">
              <el-input v-model="form.code" placeholder="請輸入部門代碼" />
            </el-form-item>
            <el-form-item label="單位名稱">
              <el-input v-model="form.unitName" placeholder="請輸入單位名稱" />
            </el-form-item>
            <el-form-item label="位置">
              <el-input v-model="form.location" placeholder="請輸入部門位置" />
            </el-form-item>
            <el-form-item label="連絡電話">
              <el-input v-model="form.phone" placeholder="請輸入連絡電話" />
            </el-form-item>
            <el-form-item label="部門主管">
              <el-input v-model="form.manager" placeholder="請輸入部門主管姓名" />
            </el-form-item>
          </div>
        </template>
        
        <template v-else>
          <div class="form-section">
            <h3 class="form-section-title">小單位資訊</h3>
            <el-form-item label="所屬部門" required>
              <el-select v-model="form.department" placeholder="選擇部門" style="width: 100%">
                <el-option v-for="dept in deptList" :key="dept._id" :label="dept.name" :value="dept._id" />
              </el-select>
            </el-form-item>
            <el-form-item label="小單位名稱" required>
              <el-input v-model="form.name" placeholder="請輸入小單位名稱" />
            </el-form-item>
            <el-form-item label="代碼">
              <el-input v-model="form.code" placeholder="請輸入代碼" />
            </el-form-item>
            <el-form-item label="單位名稱">
              <el-input v-model="form.unitName" placeholder="請輸入單位名稱" />
            </el-form-item>
            <el-form-item label="位置">
              <el-input v-model="form.location" placeholder="請輸入位置" />
            </el-form-item>
            <el-form-item label="連絡電話">
              <el-input v-model="form.phone" placeholder="請輸入連絡電話" />
            </el-form-item>
            <el-form-item label="部門主管">
              <el-input v-model="form.manager" placeholder="請輸入主管姓名" />
            </el-form-item>
            <el-form-item label="人力需求數">
              <el-input-number v-model="form.headcount" :min="0" placeholder="請輸入人力需求數" />
            </el-form-item>
            <el-form-item label="班表拉選">
              <el-input v-model="form.scheduleSetting" placeholder="請輸入班表設定" />
            </el-form-item>
          </div>
        </template>
      </el-form>
      
      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false" class="cancel-btn">取消</el-button>
          <el-button type="primary" @click="saveItem" class="save-btn">
            <i class="el-icon-check"></i>
            儲存
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import { apiFetch } from '../../api'

const activeTab = ref('org')
const orgList = ref([])
const deptList = ref([])
const subList = ref([])
const selectedOrg = ref('')
const selectedDept = ref('')

const dialogVisible = ref(false)
const form = ref(defaultForm('org'))
const currentType = ref('org')
const editIndex = ref(null)

// 部門排班規則與中場休息設定
const deptScheduleForm = ref({
  defaultTwoDayOff: true,
  tempChangeAllowed: false,
  deptManager: ''
})
const breakSettingForm = ref({
  enableGlobalBreak: false,
  breakMinutes: 60,
  allowMultiBreak: false
})
const managerList = ref([])

const filteredDeptList = computed(() =>
  selectedOrg.value
    ? deptList.value.filter(d => d.organization === selectedOrg.value)
    : deptList.value
)

const filteredSubList = computed(() =>
  selectedDept.value
    ? subList.value.filter(s => s.department === selectedDept.value)
    : subList.value
)

const selectedDeptName = computed(() => {
  const dept = deptList.value.find(d => d._id === selectedDept.value)
  return dept ? dept.name : ''
})

const dialogTitle = computed(() => {
  const typeLabel = currentType.value === 'org'
    ? '機構'
    : currentType.value === 'dept'
      ? '部門'
      : '小單位'
  return `${editIndex.value === null ? '新增' : '編輯'}${typeLabel}`
})

function urlOf(type) {
  return type === 'org'
    ? '/api/organizations'
    : type === 'dept'
      ? '/api/departments'
      : '/api/sub-departments'
}

async function fetchList(type, parentId) {
  let url = urlOf(type)
  if (parentId) {
    const key = type === 'dept' ? 'organization' : 'department'
    url += `?${key}=${parentId}`
  }
  const res = await apiFetch(url)
  if (res.ok) {
    const data = await res.json()
    if (type === 'org') orgList.value = data
    else if (type === 'dept') deptList.value = data
    else subList.value = data
  }
}

async function fetchAll() {
  await Promise.all([
    fetchList('org'),
    fetchList('dept', selectedOrg.value),
    fetchList('sub', selectedDept.value)
  ])
}

function defaultForm(type) {
  if (type === 'org') {
    return {
      name: '',
      systemCode: '',
      unitName: '',
      orgCode: '',
      taxIdNumber: '',
      laborInsuranceNo: '',
      healthInsuranceNo: '',
      taxCode: '',
      address: '',
      phone: '',
      principal: ''
    }
  } else if (type === 'dept') {
    return {
      name: '',
      code: '',
      unitName: '',
      location: '',
      phone: '',
      manager: '',
      organization: ''
    }
  } else {
    return {
      name: '',
      code: '',
      unitName: '',
      location: '',
      phone: '',
      manager: '',
      headcount: 0,
      scheduleSetting: '',
      department: ''
    }
  }
}

function openDialog(type, index = null) {
  currentType.value = type
  if (index !== null) {
    editIndex.value = index
    const item =
      type === 'org'
        ? orgList.value[index]
        : type === 'dept'
          ? deptList.value[index]
          : subList.value[index]
    form.value = { ...item }
  } else {
    editIndex.value = null
    form.value = defaultForm(type)
    if (type === 'dept') form.value.organization = selectedOrg.value
    if (type === 'sub') form.value.department = selectedDept.value
  }
  dialogVisible.value = true
}

async function saveItem() {
  const url = urlOf(currentType.value)
  const list =
    currentType.value === 'org'
      ? orgList
      : currentType.value === 'dept'
        ? deptList
        : subList
  let res
  if (editIndex.value === null) {
    res = await apiFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value)
    })
  } else {
    const id = list.value[editIndex.value]._id
    res = await apiFetch(`${url}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form.value)
    })
  }
  if (res && res.ok) {
    await fetchAll()
    dialogVisible.value = false
  }
}

function deleteItem(type, index) {
  const list = type === 'org' ? orgList : type === 'dept' ? deptList : subList
  const id = list.value[index]._id
  apiFetch(`${urlOf(type)}/${id}`, {
    method: 'DELETE'
  }).then(res => {
    if (res.ok) {
      list.value.splice(index, 1)
    }
  })
}

async function fetchManagers() {
  const res = await apiFetch('/api/dept-managers')
  if (res.ok) {
    managerList.value = await res.json()
  }
}

async function saveDeptSchedule() {
  const method = deptScheduleForm.value._id ? 'PUT' : 'POST'
  let url = '/api/dept-schedules'
  if (method === 'PUT') url += `/${deptScheduleForm.value._id}`
  const res = await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(deptScheduleForm.value)
  })
  if (res.ok) alert('已儲存「部門排班規則」設定')
}

async function saveBreakSetting() {
  const method = breakSettingForm.value._id ? 'PUT' : 'POST'
  let url = '/api/break-settings'
  if (method === 'PUT') url += `/${breakSettingForm.value._id}`
  const res = await apiFetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(breakSettingForm.value)
  })
  if (res.ok) alert('已儲存「中場休息」設定')
}

onMounted(() => {
  fetchAll()
  fetchManagers()
})

watch(selectedOrg, val => {
  fetchList('dept', val)
})

watch(selectedDept, val => {
  fetchList('sub', val)
})
</script>

<style scoped>
.org-dept-setting {
  max-width: 1400px;
  margin: 0 auto;
  padding: 0;
}

/* 頁面標題區域 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
  color: white;
  padding: 32px;
  border-radius: 16px;
  margin-bottom: 32px;
  box-shadow: 0 4px 20px rgba(22, 78, 99, 0.3);
}

.header-content h1.page-title {
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

.header-stats {
  display: flex;
  gap: 32px;
}

.stat-item {
  text-align: center;
}

.stat-number {
  font-size: 32px;
  font-weight: 700;
  margin-bottom: 4px;
}

.stat-label {
  font-size: 14px;
  opacity: 0.8;
}

/* 標籤頁樣式 */
.org-tabs {
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

.tab-content {
  padding: 32px;
}

/* 內容標題 */
.content-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0;
  padding-left: 16px;
  border-left: 4px solid #10b981;
}

.header-actions {
  display: flex;
  gap: 16px;
  align-items: center;
}

.filter-select {
  min-width: 200px;
}

.current-dept {
  margin: 0 0 16px 0;
  color: #334155;
}

.add-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
}

/* 表格樣式 */
.table-container {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.data-table {
  width: 100%;
}

/* 組織信息顯示 */
.org-info, .dept-info, .sub-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.org-icon, .dept-icon, .sub-icon {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: white;
}

.org-icon {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
}

.dept-icon {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.sub-icon {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
}

.org-details, .dept-details, .sub-details {
  flex: 1;
}

.org-name, .dept-name, .sub-name {
  font-weight: 600;
  color: #1e293b;
  margin-bottom: 2px;
}

.org-unit, .dept-unit, .sub-unit {
  font-size: 12px;
  color: #64748b;
}

.code-tag {
  font-weight: 500;
  padding: 4px 8px;
  border-radius: 4px;
}

.headcount-info {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  font-weight: 500;
}

/* 操作按鈕 */
.action-buttons {
  display: flex;
  gap: 8px;
}

.edit-btn, .delete-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  font-size: 12px;
}

/* 對話框樣式 */
.form-dialog .el-dialog__body {
  padding: 24px 32px;
}

.dialog-form {
  max-height: 60vh;
  overflow-y: auto;
}

.form-section {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid #e2e8f0;
}

.form-section:last-child {
  border-bottom: none;
  margin-bottom: 0;
}

.form-section-title {
  font-size: 16px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 20px 0;
  padding-left: 12px;
  border-left: 3px solid #10b981;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid #e2e8f0;
}

.cancel-btn {
  padding: 10px 20px;
  border-radius: 8px;
}

.save-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: 8px;
  font-weight: 500;
}

/* 響應式設計 */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    text-align: center;
    gap: 20px;
  }
  
  .header-stats {
    gap: 20px;
  }
  
  .content-header {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }
  
  .header-actions {
    justify-content: space-between;
  }
  
  .tab-content {
    padding: 16px;
  }
}

@media (max-width: 480px) {
  .action-buttons {
    flex-direction: column;
    gap: 4px;
  }
  
  .stat-number {
    font-size: 24px;
  }
}
</style>
