<!-- src/Components/backComponents/HRManagementSystemSetting.vue -->

<template>
    <div class="hr-management-system-setting">
      <h2>人事管理與系統設定</h2>
  
      <el-tabs v-model="activeTab" type="card">
        <!-- 1) 帳號與權限設定 -->
        <el-tab-pane label="帳號與權限" name="accountRole">
          <div class="tab-content">
            <el-button type="primary" @click="openUserDialog()">新增帳號</el-button>
            <el-table :data="userList" style="margin-top: 20px;">
              <el-table-column prop="username" label="帳號" width="150" />
              <el-table-column prop="role" label="角色" width="120" />
              <el-table-column prop="department" label="所屬部門" width="120" />
              <el-table-column label="操作" width="180">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openUserDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteUser($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯使用者帳號 Dialog -->
            <el-dialog :visible.sync="userDialogVisible" title="帳號管理" width="500px">
              <el-form :model="userForm" label-width="100px">
                <el-form-item label="帳號">
                  <el-input v-model="userForm.username" placeholder="輸入帳號" />
                </el-form-item>
                <el-form-item label="密碼">
                  <el-input v-model="userForm.password" type="password" placeholder="重設或新增密碼" />
                </el-form-item>
                <el-form-item label="角色">
                  <el-select v-model="userForm.role" placeholder="選擇角色">
                    <el-option label="管理員" value="admin" />
                    <el-option label="HR" value="hr" />
                    <el-option label="主管" value="supervisor" />
                    <el-option label="員工" value="employee" />
                  </el-select>
                </el-form-item>
                <el-form-item label="部門">
                  <el-select v-model="userForm.department" placeholder="選擇部門">
                    <el-option
                      v-for="dept in departmentList"
                      :key="dept.value"
                      :label="dept.label"
                      :value="dept.value"
                    />
                  </el-select>
                </el-form-item>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="userDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveUser">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
  
        <!-- 2) 系統與機構基本資料 -->
        <el-tab-pane label="系統基本資料" name="systemOrg">
          <div class="tab-content">
            <el-form :model="systemForm" label-width="140px">
              <el-form-item label="機構(公司)名稱">
                <el-input v-model="systemForm.companyName" placeholder="輸入公司名稱" />
              </el-form-item>
              <el-form-item label="機構代碼">
                <el-input v-model="systemForm.companyCode" placeholder="如：ABCD01" />
              </el-form-item>
              <el-form-item label="聯絡電話">
                <el-input v-model="systemForm.phone" />
              </el-form-item>
              <el-form-item label="地址">
                <el-input v-model="systemForm.address" />
              </el-form-item>
              <el-form-item label="系統參數 (示範)">
                <el-switch v-model="systemForm.enableMultiLang" active-text="多語系" inactive-text="單語系" />
                <small>可在此加入更多參數(時區、民國年/西元年…)</small>
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveSystemOrg">儲存系統/機構設定</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
  
        <!-- 3) 員工資料與異動管理 (新進/離職/部門職務異動) -->
        <el-tab-pane label="員工管理" name="employeeMgmt">
          <div class="tab-content">
            <el-button type="primary" @click="openEmployeeDialog()">新增員工</el-button>
            <el-table :data="employeeList" style="margin-top: 20px;">
              <el-table-column prop="name" label="員工姓名" width="120" />
              <el-table-column prop="department" label="部門" width="100" />
              <el-table-column prop="title" label="職稱" width="100" />
              <el-table-column prop="status" label="在職狀態" width="100" />
              <el-table-column label="操作" width="200">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openEmployeeDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteEmployee($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯員工 Dialog -->
            <el-dialog :visible.sync="employeeDialogVisible" title="員工資料" width="500px">
              <el-form :model="employeeForm" label-width="100px">
                <el-form-item label="姓名">
                  <el-input v-model="employeeForm.name" />
                </el-form-item>
                <el-form-item label="部門">
                  <el-select v-model="employeeForm.department">
                    <el-option
                      v-for="dept in departmentList"
                      :key="dept.value"
                      :label="dept.label"
                      :value="dept.value"
                    />
                  </el-select>
                </el-form-item>
                <el-form-item label="職稱">
                  <el-input v-model="employeeForm.title" />
                </el-form-item>
                <el-form-item label="在職狀態">
                  <el-select v-model="employeeForm.status">
                    <el-option label="在職" value="在職" />
                    <el-option label="離職" value="離職" />
                    <el-option label="休假中" value="休假中" />
                  </el-select>
                </el-form-item>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="employeeDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveEmployee">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
  
        <!-- 4) 組織單位/部門管理 -->
        <el-tab-pane label="部門組織管理" name="deptOrg">
          <div class="tab-content">
            <el-button type="primary" @click="openDeptDialog()">新增部門/單位</el-button>
            <el-table :data="departmentList" style="margin-top: 20px;">
              <el-table-column prop="label" label="部門名稱" width="150" />
              <el-table-column prop="value" label="代碼" width="100" />
              <el-table-column label="操作" width="180">
                <template #default="{ row, $index }">
                  <el-button type="primary" @click="openDeptDialog($index)">編輯</el-button>
                  <el-button type="danger" @click="deleteDept($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
  
            <!-- 新增/編輯 部門/單位 Dialog -->
            <el-dialog :visible.sync="deptDialogVisible" title="部門管理" width="400px">
              <el-form :model="deptForm" label-width="100px">
                <el-form-item label="名稱">
                  <el-input v-model="deptForm.label" />
                </el-form-item>
                <el-form-item label="代碼">
                  <el-input v-model="deptForm.value" />
                </el-form-item>
              </el-form>
              <span slot="footer" class="dialog-footer">
                <el-button @click="deptDialogVisible = false">取消</el-button>
                <el-button type="primary" @click="saveDept">儲存</el-button>
              </span>
            </el-dialog>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </template>
  
  <script setup>
  import { ref, onMounted } from 'vue'

  import { apiFetch } from '../../api'

const activeTab = ref('accountRole')

// ============== (1) 帳號與權限 ==============
const userList = ref([])
  
  const userDialogVisible = ref(false)
  let editUserIndex = null
  
  const userForm = ref({
    username: '',
    password: '',
    role: '',
    department: ''
  })
  
const departmentList = ref([])

async function fetchUsers() {
  const token = localStorage.getItem('token') || ''
  const res = await apiFetch('/api/users', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    userList.value = await res.json()
  }
}

async function fetchDepartments() {
  const token = localStorage.getItem('token') || ''
  const res = await apiFetch('/api/departments', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.ok) {
    departmentList.value = await res.json()
  }
}
  
  function openUserDialog(index = null) {
    if (index !== null) {
      editUserIndex = index
      userForm.value = { ...userList.value[index], password: '' } // 只顯示空密碼(重設)
    } else {
      editUserIndex = null
      userForm.value = { username: '', password: '', role: '', department: '' }
    }
    userDialogVisible.value = true
  }
  
  async function saveUser() {
    const payload = { ...userForm.value }
    const token = localStorage.getItem('token') || ''
    let res
    if (editUserIndex === null) {
      res = await apiFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      })
    } else {
      const id = userList.value[editUserIndex]._id
      res = await apiFetch(`/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      })
    }
    if (res && res.ok) {
      await fetchUsers()
      userDialogVisible.value = false
    }
  }

  function deleteUser(index) {
    const token = localStorage.getItem('token') || ''
    const id = userList.value[index]._id
    apiFetch(`/api/users/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => {
      if (res.ok) {
        userList.value.splice(index, 1)
      }
    })
  }
  
  // ============== (2) 系統與機構基本資料 ==============
  const systemForm = ref({
    companyName: '示範股份有限公司',
    companyCode: 'ABC123',
    phone: '02-1234-5678',
    address: '台北市某某路 100 號',
    enableMultiLang: false
  })
  
  function saveSystemOrg() {
    console.log('儲存系統/機構資料:', systemForm.value)
    alert('已儲存「系統/機構設定」')
  }
  
  // ============== (3) 員工資料與異動管理 ==============
  const employeeList = ref([])

  const token = localStorage.getItem('token') || ''

  async function fetchEmployees() {
    const res = await apiFetch('/api/employees', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      employeeList.value = await res.json()
    }
  }

  async function loadEmployees() {
    const res = await fetch('/api/employees')

    if (res.ok) {
      employeeList.value = await res.json()
    }
  }


  onMounted(() => {
    fetchUsers()
    fetchDepartments()
    fetchEmployees()
  })

  const employeeDialogVisible = ref(false)
  let editEmployeeIndex = null
  let editEmployeeId = ''
  
  const employeeForm = ref({
    name: '',
    department: '',
    title: '',
    status: '在職'
  })
  
  function openEmployeeDialog(index = null) {
    if (index !== null) {
      editEmployeeIndex = index
      const emp = employeeList.value[index]
      editEmployeeId = emp._id || ''
      employeeForm.value = { ...emp }
    } else {
      editEmployeeIndex = null
      editEmployeeId = ''
      employeeForm.value = { name: '', department: '', title: '', status: '在職' }
    }
    employeeDialogVisible.value = true
  }

  async function saveEmployee() {
    const payload = { ...employeeForm.value }

    let res
    if (editEmployeeIndex === null) {
      res = await apiFetch('/api/employees', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })
    } else {
      res = await apiFetch(`/api/employees/${editEmployeeId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      })
    }
    if (res && res.ok) {
      await fetchEmployees()
      employeeDialogVisible.value = false
    }
  }

  async function deleteEmployee(index) {
    const emp = employeeList.value[index]
    const res = await apiFetch(`/api/employees/${emp._id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      employeeList.value.splice(index, 1)
    }

  }
  
  // ============== (4) 組織單位/部門管理 ==============
  const deptDialogVisible = ref(false)
  let editDeptIndex = null
  
  const deptForm = ref({
    label: '',
    value: ''
  })
  
  function openDeptDialog(index = null) {
    if (index !== null) {
      editDeptIndex = index
      deptForm.value = { ...departmentList.value[index] }
    } else {
      editDeptIndex = null
      deptForm.value = { label: '', value: '' }
    }
    deptDialogVisible.value = true
  }
  
  async function saveDept() {
    const token = localStorage.getItem('token') || ''
    let res
    if (editDeptIndex === null) {
      res = await apiFetch('/api/departments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(deptForm.value)
      })
    } else {
      const id = departmentList.value[editDeptIndex]._id
      res = await apiFetch(`/api/departments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(deptForm.value)
      })
    }
    if (res && res.ok) {
      await fetchDepartments()
      deptDialogVisible.value = false
    }
  }

  function deleteDept(index) {
    const token = localStorage.getItem('token') || ''
    const id = departmentList.value[index]._id
    apiFetch(`/api/departments/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    }).then(res => {
      if (res.ok) {
        departmentList.value.splice(index, 1)
      }
    })
  }
  </script>
  
  <style scoped>
  .hr-management-system-setting {
    padding: 20px;
  }
  
  .tab-content {
    margin-top: 20px;
  }
  </style>
  