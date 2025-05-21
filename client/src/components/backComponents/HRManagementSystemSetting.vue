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
            <el-dialog v-model="userDialogVisible" title="帳號管理" width="500px">
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
            <el-dialog v-model="employeeDialogVisible" title="員工資料" width="600px">
              <el-tabs v-model="employeeDialogTab" type="border-card">
                <el-tab-pane label="帳號/權限" name="account">
                  <el-form :model="employeeForm" label-width="100px">
                    <el-form-item label="帳號">
                      <el-input v-model="employeeForm.username" />
                    </el-form-item>
                    <el-form-item label="密碼">
                      <el-input v-model="employeeForm.password" type="password" />
                    </el-form-item>
                    <el-form-item label="權限">
                      <el-checkbox-group v-model="employeeForm.permissions">
                        <el-checkbox label="admin">管理員</el-checkbox>
                        <el-checkbox label="hr">HR</el-checkbox>
                        <el-checkbox label="supervisor">主管</el-checkbox>
                        <el-checkbox label="employee">員工</el-checkbox>
                      </el-checkbox-group>
                    </el-form-item>
                  </el-form>
                </el-tab-pane>
                <el-tab-pane label="個人資訊" name="personal">
                  <el-form :model="employeeForm" label-width="100px">
                    <el-form-item label="姓名">
                      <el-input v-model="employeeForm.name" />
                    </el-form-item>
                    <el-form-item label="性別">
                      <el-select v-model="employeeForm.gender" placeholder="選擇性別">
                        <el-option label="男" value="M" />
                        <el-option label="女" value="F" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="生日">
                      <el-date-picker v-model="employeeForm.birthday" type="date" />
                    </el-form-item>
                    <el-form-item label="Email">
                      <el-input v-model="employeeForm.email" />
                    </el-form-item>
                    <el-form-item label="電話">
                      <el-input v-model="employeeForm.phone" />
                    </el-form-item>
                    <el-form-item label="照片">
                      <el-upload
                        class="avatar-uploader"
                        action=""
                        :auto-upload="false"
                        list-type="picture"
                        v-model:file-list="employeeForm.photoList"
                      >
                        <el-button type="primary">選擇檔案</el-button>
                      </el-upload>
                    </el-form-item>
                  </el-form>
                </el-tab-pane>
                <el-tab-pane label="任職資訊" name="employment">
                  <el-form :model="employeeForm" label-width="100px">
                    <el-form-item label="機構">
                      <el-input v-model="employeeForm.institution" />
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
                    <el-form-item label="子單位">
                      <el-input v-model="employeeForm.subunit" />
                    </el-form-item>
                    <el-form-item label="權限/職等">
                      <el-input v-model="employeeForm.permissionGrade" readonly />
                    </el-form-item>
                    <el-form-item label="職稱">
                      <el-input v-model="employeeForm.title" />
                    </el-form-item>
                    <el-form-item label="執業職稱">
                      <el-input v-model="employeeForm.practiceTitle" />
                    </el-form-item>
                    <el-form-item label="兼職">
                      <el-switch v-model="employeeForm.isPartTime" />
                    </el-form-item>
                    <el-form-item label="打卡">
                      <el-switch v-model="employeeForm.isClocking" />
                    </el-form-item>
                    <el-form-item label="入職日">
                      <el-date-picker v-model="employeeForm.hireDate" type="date" />
                    </el-form-item>
                    <el-form-item label="起聘日">
                      <el-date-picker v-model="employeeForm.appointDate" type="date" />
                    </el-form-item>
                    <el-form-item label="離職日">
                      <el-date-picker v-model="employeeForm.resignDate" type="date" />
                    </el-form-item>
                    <el-form-item label="解聘日">
                      <el-date-picker v-model="employeeForm.dismissDate" type="date" />
                    </el-form-item>
                    <el-form-item label="在職狀態">
                      <el-select v-model="employeeForm.employmentStatus">
                        <el-option label="在職" value="在職" />
                        <el-option label="離職" value="離職" />
                        <el-option label="休假中" value="休假中" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="試用期天數">
                      <el-select v-model="employeeForm.probationDays">
                        <el-option label="無" value="" />
                        <el-option label="30" value="30" />
                        <el-option label="60" value="60" />
                        <el-option label="90" value="90" />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="再任起聘">
                      <el-date-picker v-model="employeeForm.reAppointDate" type="date" />
                    </el-form-item>
                    <el-form-item label="再任解聘">
                      <el-date-picker v-model="employeeForm.reDismissDate" type="date" />
                    </el-form-item>
                    <el-form-item label="備註">
                      <el-input v-model="employeeForm.employmentNote" />
                    </el-form-item>
                  </el-form>
                </el-tab-pane>
                <el-tab-pane label="更多資訊" name="more">
                  <el-form :model="employeeForm" label-width="110px">
                    <el-divider content-position="left">身體檢查</el-divider>
                    <el-form-item label="身高">
                      <el-input v-model="employeeForm.height" />
                    </el-form-item>
                    <el-form-item label="體重">
                      <el-input v-model="employeeForm.weight" />
                    </el-form-item>
                    <el-form-item label="血型">
                      <el-input v-model="employeeForm.medicalBloodType" />
                    </el-form-item>

                    <el-divider content-position="left">學歷</el-divider>
                    <el-form-item label="教育程度">
                      <el-input v-model="employeeForm.educationLevel" />
                    </el-form-item>
                    <el-form-item label="學校">
                      <el-input v-model="employeeForm.schoolName" />
                    </el-form-item>
                    <el-form-item label="科系">
                      <el-input v-model="employeeForm.major" />
                    </el-form-item>
                    <el-form-item label="畢/肄業">
                      <el-input v-model="employeeForm.graduationStatus" />
                    </el-form-item>
                    <el-form-item label="畢業年度">
                      <el-input v-model="employeeForm.graduationYear" />
                    </el-form-item>

                    <el-divider content-position="left">緊急聯絡人1</el-divider>
                    <el-form-item label="姓名">
                      <el-input v-model="employeeForm.emergency1.name" />
                    </el-form-item>
                    <el-form-item label="稱謂">
                      <el-input v-model="employeeForm.emergency1.relation" />
                    </el-form-item>
                    <el-form-item label="電話一">
                      <el-input v-model="employeeForm.emergency1.phone1" />
                    </el-form-item>
                    <el-form-item label="電話二">
                      <el-input v-model="employeeForm.emergency1.phone2" />
                    </el-form-item>

                    <el-divider content-position="left">緊急聯絡人2</el-divider>
                    <el-form-item label="姓名">
                      <el-input v-model="employeeForm.emergency2.name" />
                    </el-form-item>
                    <el-form-item label="稱謂">
                      <el-input v-model="employeeForm.emergency2.relation" />
                    </el-form-item>
                    <el-form-item label="電話一">
                      <el-input v-model="employeeForm.emergency2.phone1" />
                    </el-form-item>
                    <el-form-item label="電話二">
                      <el-input v-model="employeeForm.emergency2.phone2" />
                    </el-form-item>

                    <el-divider content-position="left">經歷</el-divider>
                    <div v-for="(exp, i) in employeeForm.experiences" :key="i" style="border:1px solid #ccc;margin-bottom:10px;padding:10px;">
                      <el-form-item label="單位名稱">
                        <el-input v-model="exp.unit" />
                      </el-form-item>
                      <el-form-item label="職稱">
                        <el-input v-model="exp.title" />
                      </el-form-item>
                      <el-form-item label="到職年月">
                        <el-date-picker v-model="exp.start" type="month" />
                      </el-form-item>
                      <el-form-item label="離職年月">
                        <el-date-picker v-model="exp.end" type="month" />
                      </el-form-item>
                      <el-button type="danger" @click="removeExperience(i)">刪除</el-button>
                    </div>
                    <el-button type="primary" @click="addExperience">新增經歷</el-button>

                    <el-divider content-position="left">證照</el-divider>
                    <div v-for="(lic, i) in employeeForm.licenses" :key="'l'+i" style="border:1px solid #ccc;margin-bottom:10px;padding:10px;">
                      <el-form-item label="證照名稱">
                        <el-input v-model="lic.name" />
                      </el-form-item>
                      <el-form-item label="證照字號">
                        <el-input v-model="lic.number" />
                      </el-form-item>
                      <el-form-item label="起始日期">
                        <el-date-picker v-model="lic.startDate" type="date" />
                      </el-form-item>
                      <el-form-item label="截止日期">
                        <el-date-picker v-model="lic.endDate" type="date" />
                      </el-form-item>
                      <el-form-item label="證書">
                        <el-upload :auto-upload="false" v-model:file-list="lic.fileList" />
                      </el-form-item>
                      <el-button type="danger" @click="removeLicense(i)">刪除</el-button>
                    </div>
                    <el-button type="primary" @click="addLicense">新增證照</el-button>

                    <el-divider content-position="left">教育訓練</el-divider>
                    <div v-for="(tr, i) in employeeForm.trainings" :key="'t'+i" style="border:1px solid #ccc;margin-bottom:10px;padding:10px;">
                      <el-form-item label="課程名稱">
                        <el-input v-model="tr.course" />
                      </el-form-item>
                      <el-form-item label="課程字號">
                        <el-input v-model="tr.courseNo" />
                      </el-form-item>
                      <el-form-item label="日期">
                        <el-date-picker v-model="tr.date" type="date" />
                      </el-form-item>
                      <el-form-item label="證書">
                        <el-upload :auto-upload="false" v-model:file-list="tr.fileList" />
                      </el-form-item>
                      <el-form-item label="積分類別">
                        <el-input v-model="tr.category" />
                      </el-form-item>
                      <el-form-item label="分數">
                        <el-input v-model="tr.score" />
                      </el-form-item>
                      <el-button type="danger" @click="removeTraining(i)">刪除</el-button>
                    </div>
                    <el-button type="primary" @click="addTraining">新增訓練</el-button>
                  </el-form>
                </el-tab-pane>
              </el-tabs>
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
            <el-dialog v-model="deptDialogVisible" title="部門管理" width="400px">
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
const employeeDialogTab = ref('account')

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



  onMounted(() => {
    fetchUsers()
    fetchDepartments()
    fetchEmployees()
  })

  const employeeDialogVisible = ref(false)
  let editEmployeeIndex = null
  let editEmployeeId = ''
  
  const emptyEmployee = {
    username: '',
    password: '',
    permissions: [],
    // 基本資料
    employeeNo: '',
    name: '',
    gender: '',
    birthday: '',
    idNumber: '',
    birthplace: '',
    bloodType: '',
    languages: [],
    disabilityLevel: '',
    identityCategory: '',
    maritalStatus: '',
    dependents: 0,
    email: '',
    phone: '',
    landline: '',
    householdAddress: '',
    contactAddress: '',
    lineId: '',
    photoList: [],
    // 部門相關
    institution: '',
    department: '',
    subunit: '',
    permissionGrade: '',
    // 職業別
    title: '',
    practiceTitle: '',
    isPartTime: false,
    isClocking: false,
    // 人員狀態
    employmentStatus: '',
    probationDays: '',
    // 體檢
    height: '',
    weight: '',
    medicalBloodType: '',
    // 學歷
    educationLevel: '',
    schoolName: '',
    major: '',
    graduationStatus: '',
    graduationYear: '',
    // 役別
    serviceType: '',
    militaryBranch: '',
    militaryRank: '',
    dischargeYear: '',
    // 緊急聯絡人
    emergency1: { name: '', relation: '', phone1: '', phone2: '' },
    emergency2: { name: '', relation: '', phone1: '', phone2: '' },
    // 關鍵字
    keywords: '',
    // 經歷/證照/訓練
    experiences: [],
    licenses: [],
    trainings: [],
    // 聘任日期
    hireDate: '',
    appointDate: '',
    resignDate: '',
    dismissDate: '',
    reAppointDate: '',
    reDismissDate: '',
    employmentNote: ''
  }

  const employeeForm = ref({ ...emptyEmployee })
  
  function openEmployeeDialog(index = null) {
    if (index !== null) {
      editEmployeeIndex = index
      const emp = employeeList.value[index]
      editEmployeeId = emp._id || ''
      employeeForm.value = { ...emptyEmployee, ...emp, password: '', photoList: [] }
    } else {
      editEmployeeIndex = null
      editEmployeeId = ''
      employeeDialogTab.value = 'account'
      employeeForm.value = { ...emptyEmployee }
    }
    employeeDialogVisible.value = true
  }

  async function saveEmployee() {
    if (!employeeForm.value.name || !employeeForm.value.username) {
      alert('請填寫姓名與帳號')
      return
    }
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

  function addExperience() {
    employeeForm.value.experiences.push({ unit: '', title: '', start: '', end: '' })
  }

  function removeExperience(i) {
    employeeForm.value.experiences.splice(i, 1)
  }

  function addLicense() {
    employeeForm.value.licenses.push({ name: '', number: '', startDate: '', endDate: '', fileList: [] })
  }

  function removeLicense(i) {
    employeeForm.value.licenses.splice(i, 1)
  }

  function addTraining() {
    employeeForm.value.trainings.push({ course: '', courseNo: '', date: '', fileList: [], category: '', score: '' })
  }

  function removeTraining(i) {
    employeeForm.value.trainings.splice(i, 1)
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
  