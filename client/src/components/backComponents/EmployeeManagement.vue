<!-- src/components/backComponents/EmployeeManagement.vue -->
<template>
        <el-tab-pane label="員工管理" name="employeeMgmt">
          <div class="tab-content">
            <el-button type="primary" @click="openEmployeeDialog()">新增員工</el-button>
            <el-table :data="employeeList" style="margin-top: 20px;">
              <el-table-column prop="name" label="員工姓名" width="120" />
              <el-table-column label="部門" width="100">
                <template #default="{ row }">
                  {{ departmentLabel(row.department) }}
                </template>
              </el-table-column>
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
                      <el-select v-model="employeeForm.institution">
                        <el-option
                          v-for="org in orgList"
                          :key="org._id"
                          :label="org.name"
                          :value="org._id"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="部門">
                      <el-select v-model="employeeForm.department">
                        <el-option
                          v-for="dept in filteredDepartments"
                          :key="dept._id"
                          :label="dept.name"
                          :value="dept._id"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item label="子單位">
                      <el-input v-model="employeeForm.subunit" />
                    </el-form-item>
                    <el-form-item label="主管">
                      <el-select v-model="employeeForm.supervisor" placeholder="選擇主管">
                        <el-option
                          v-for="sup in supervisorList"
                          :key="sup._id"
                          :label="sup.name"
                          :value="sup._id"
                        />
                      </el-select>
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
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { apiFetch } from '../../api'

const employeeDialogTab = ref('account')
const employeeList = ref([])
const departmentList = ref([])
const orgList = ref([])
const employeeDialogVisible = ref(false)
let editEmployeeIndex = null
let editEmployeeId = ''
const token = localStorage.getItem('token') || ''

function departmentLabel(id) {
  const dept = departmentList.value.find(d => d._id === id)
  return dept ? `${dept.name}(${dept.code})` : id
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
  async function fetchOrganizations() {
    const token = localStorage.getItem('token') || ''
    const res = await apiFetch('/api/organizations', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      orgList.value = await res.json()
    }
  }
  async function fetchEmployees() {
    const res = await apiFetch('/api/employees', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.ok) {
      employeeList.value = await res.json()
    }
  }



  onMounted(() => {
    fetchDepartments()
    fetchEmployees()
    fetchOrganizations()
  })

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
    supervisor: '',
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

  const filteredDepartments = computed(() =>
    employeeForm.value.institution
      ? departmentList.value.filter(
          d => d.organization === employeeForm.value.institution
        )
      : []
  )

  const supervisorList = computed(() =>
    employeeList.value.filter(e => e.role === 'supervisor')
  )
  
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
    fetchDepartments()
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
</script>
