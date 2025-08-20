<!-- src/components/backComponents/EmployeeManagement.vue -->
<template>
  <el-tab-pane label="員工管理" name="employeeMgmt">
    <div class="tab-content">
      <el-button type="primary" @click="openEmployeeDialog()">新增員工</el-button>

      <el-table :data="employeeList" style="margin-top: 20px;">
        <el-table-column prop="name" label="員工姓名" width="140" />
        <el-table-column label="部門" width="160">
          <template #default="{ row }">
            {{ departmentLabel(row.department) }}
          </template>
        </el-table-column>
        <el-table-column prop="title" label="職稱(C03)" width="140" />
        <el-table-column prop="employmentStatus" label="在職狀態" width="120" />
        <el-table-column label="操作" width="220">
          <template #default="{ row, $index }">
            <el-button type="primary" @click="openEmployeeDialog($index)">編輯</el-button>
            <el-button type="danger" @click="deleteEmployee($index)">刪除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <!-- 新增/編輯員工 Dialog -->
      <el-dialog v-model="employeeDialogVisible" title="員工資料" width="980px">
        <el-tabs v-model="employeeDialogTab" type="border-card">
          <!-- 帳號/權限 -->
          <el-tab-pane label="帳號/權限" name="account">
            <el-form :model="employeeForm" label-width="120px">
              <el-form-item label="帳號">
                <el-input v-model="employeeForm.username" />
              </el-form-item>
              <el-form-item label="密碼">
                <el-input v-model="employeeForm.password" type="password" />
              </el-form-item>
              <el-form-item label="系統權限">
                <el-radio-group v-model="employeeForm.role">
                  <el-radio v-for="r in ROLE_OPTIONS" :key="r.value" :label="r.value">
                    {{ r.label }}
                  </el-radio>
                </el-radio-group>
              </el-form-item>
              <el-form-item label="權限/職等(不可控)">
                <el-select v-model="employeeForm.permissionGrade" placeholder="選擇職等">
                  <el-option v-for="g in PERMISSION_GRADE_OPTIONS" :key="g" :label="g" :value="g" />
                </el-select>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <!-- 簽核/標籤 -->
          <el-tab-pane label="簽核/標籤" name="approval">
            <el-form :model="employeeForm" label-width="120px">
              <el-form-item label="簽核角色">
                <el-select v-model="employeeForm.signRole" placeholder="選擇簽核角色">
                  <el-option v-for="o in SIGN_ROLES" :key="o" :label="o" :value="o" />
                </el-select>
              </el-form-item>
              <el-form-item label="標籤 (tag)">
                <el-select
                  v-model="employeeForm.signTags"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="可輸入新增自訂標籤"
                >
                  <el-option v-for="t in DEFAULT_TAGS" :key="t" :label="t" :value="t" />
                </el-select>
              </el-form-item>
              <el-form-item label="簽核層級">
                <el-select v-model="employeeForm.signLevel" placeholder="選擇層級">
                  <el-option v-for="l in SIGN_LEVELS" :key="l" :label="l" :value="l" />
                </el-select>
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <!-- 個人資訊 -->
          <el-tab-pane label="個人資訊" name="personal">
            <el-form :model="employeeForm" label-width="120px">
              <el-divider content-position="left">基本資料</el-divider>
              <el-form-item label="員工編號">
                <el-input v-model="employeeForm.employeeNo" />
              </el-form-item>
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
              <el-form-item label="出生地">
                <el-input v-model="employeeForm.birthplace" />
              </el-form-item>
              <el-form-item label="身分證/外籍證號">
                <el-input v-model="employeeForm.idNumber" />
              </el-form-item>
              <el-form-item label="血型(ABO/AB/HR)">
                <el-select v-model="employeeForm.bloodType" placeholder="選擇血型">
                  <el-option v-for="b in ABO_TYPES" :key="b" :value="b" :label="b" />
                </el-select>
              </el-form-item>
              <el-form-item label="語言(C05)">
                <el-select v-model="employeeForm.languages" multiple filterable placeholder="選擇語言">
                  <el-option v-for="lan in LANGUAGE_OPTIONS" :key="lan" :label="lan" :value="lan" />
                </el-select>
              </el-form-item>
              <el-form-item label="身障手冊(C06)">
                <el-select v-model="employeeForm.disabilityLevel" placeholder="選擇等級">
                  <el-option v-for="d in DISABILITY_LEVELS" :key="d" :label="d" :value="d" />
                </el-select>
              </el-form-item>
              <el-form-item label="註記身分別(C07)">
                <el-select v-model="employeeForm.identityCategory" multiple placeholder="選擇身分別">
                  <el-option v-for="i in IDENTITY_FLAGS" :key="i" :label="i" :value="i" />
                </el-select>
              </el-form-item>
              <el-form-item label="婚姻">
                <el-select v-model="employeeForm.maritalStatus" placeholder="選擇婚姻狀態">
                  <el-option v-for="m in MARITAL_OPTIONS" :key="m" :label="m" :value="m" />
                </el-select>
              </el-form-item>
              <el-form-item label="扶養人數(扣繳)">
                <el-input-number v-model="employeeForm.dependents" :min="0" />
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

              <el-divider content-position="left">聯絡資訊</el-divider>
              <el-form-item label="Email">
                <el-input v-model="employeeForm.email" />
              </el-form-item>
              <el-form-item label="行動電話">
                <el-input v-model="employeeForm.phone" />
              </el-form-item>
              <el-form-item label="連絡電話(市話)">
                <el-input v-model="employeeForm.landline" />
              </el-form-item>
              <el-form-item label="LINE ID">
                <el-input v-model="employeeForm.lineId" />
              </el-form-item>
              <el-form-item label="戶籍地址">
                <el-input v-model="employeeForm.householdAddress" />
              </el-form-item>
              <el-form-item label="聯絡地址">
                <el-input v-model="employeeForm.contactAddress" />
              </el-form-item>
            </el-form>
          </el-tab-pane>

          <!-- 任職資訊 -->
          <el-tab-pane label="任職資訊" name="employment">
            <el-form :model="employeeForm" label-width="120px">
              <el-form-item label="機構(C01)">
                <el-select v-model="employeeForm.organization" placeholder="選擇機構">
                  <el-option v-for="org in orgList" :key="org._id" :label="org.name" :value="org._id" />
                </el-select>
              </el-form-item>
              <el-form-item label="部門(C02)">
                <el-select v-model="employeeForm.department" placeholder="選擇部門">
                  <el-option
                    v-for="dept in filteredDepartments"
                    :key="dept._id"
                    :label="dept.name"
                    :value="dept._id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="小單位/區域(C02-1)">
                <el-input v-model="employeeForm.subDepartment" />
              </el-form-item>

              <el-form-item label="直屬主管">
                <el-select v-model="employeeForm.supervisor" placeholder="選擇主管">
                  <el-option
                    v-for="sup in supervisorList"
                    :key="sup._id"
                    :label="sup.name"
                    :value="sup._id"
                  />
                </el-select>
              </el-form-item>

              <el-form-item label="職稱(C03)">
                <el-select v-model="employeeForm.title" placeholder="選擇職稱">
                  <el-option v-for="t in TITLE_OPTIONS" :key="t" :label="t" :value="t" />
                </el-select>
              </el-form-item>
              <el-form-item label="執業職稱(C04)">
                <el-select v-model="employeeForm.practiceTitle" placeholder="選擇執業職稱">
                  <el-option v-for="t in PRACTICE_TITLE_OPTIONS" :key="t" :label="t" :value="t" />
                </el-select>
              </el-form-item>

              <el-form-item label="兼職">
                <el-switch v-model="employeeForm.isPartTime" />
              </el-form-item>
              <el-form-item label="打卡">
                <el-switch v-model="employeeForm.isClocking" />
              </el-form-item>

              <el-form-item label="在職狀態">
                <el-select v-model="employeeForm.employmentStatus">
                  <el-option label="正職員工" value="正職員工" />
                  <el-option label="試用期員工" value="試用期員工" />
                  <el-option label="離職員工" value="離職員工" />
                  <el-option label="留職停薪" value="留職停薪" />
                </el-select>
              </el-form-item>
              <el-form-item label="試用期">
                <el-select v-model="employeeForm.probationDays" placeholder="選擇天數">
                  <el-option label="無" value="" />
                  <el-option label="30天" value="30" />
                  <el-option label="60天" value="60" />
                  <el-option label="90天" value="90" />
                </el-select>
              </el-form-item>

              <el-form-item label="到職日期">
                <el-date-picker v-model="employeeForm.hireDate" type="date" />
              </el-form-item>
              <el-form-item label="起聘日期">
                <el-date-picker v-model="employeeForm.appointDate" type="date" />
              </el-form-item>
              <el-form-item label="離職日期">
                <el-date-picker v-model="employeeForm.resignDate" type="date" />
              </el-form-item>
              <el-form-item label="解聘日期">
                <el-date-picker v-model="employeeForm.dismissDate" type="date" />
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

          <!-- 更多資訊 -->
          <el-tab-pane label="更多資訊" name="more">
            <el-form :model="employeeForm" label-width="120px">
              <el-divider content-position="left">身體檢查</el-divider>
              <el-form-item label="身高(cm)">
                <el-input v-model="employeeForm.height" />
              </el-form-item>
              <el-form-item label="體重(kg)">
                <el-input v-model="employeeForm.weight" />
              </el-form-item>
              <el-form-item label="血型(體檢)">
                <el-input v-model="employeeForm.medicalBloodType" />
              </el-form-item>

              <el-divider content-position="left">學歷(C08)</el-divider>
              <el-form-item label="教育程度">
                <el-select v-model="employeeForm.educationLevel" placeholder="選擇教育程度">
                  <el-option v-for="e in EDUCATION_LEVELS" :key="e" :label="e" :value="e" />
                </el-select>
              </el-form-item>
              <el-form-item label="學校">
                <el-input v-model="employeeForm.schoolName" />
              </el-form-item>
              <el-form-item label="科系">
                <el-input v-model="employeeForm.major" />
              </el-form-item>
              <el-form-item label="畢/肄業">
                <el-select v-model="employeeForm.graduationStatus" placeholder="選擇狀態">
                  <el-option label="畢業" value="畢業" />
                  <el-option label="肄業" value="肄業" />
                </el-select>
              </el-form-item>
              <el-form-item label="畢業年度">
                <el-input v-model="employeeForm.graduationYear" />
              </el-form-item>

              <el-divider content-position="left">役別</el-divider>
              <el-form-item label="類別">
                <el-select v-model="employeeForm.serviceType" placeholder="志願役/義務役">
                  <el-option label="志願役" value="志願役" />
                  <el-option label="義務役" value="義務役" />
                </el-select>
              </el-form-item>
              <el-form-item label="軍種">
                <el-input v-model="employeeForm.militaryBranch" />
              </el-form-item>
              <el-form-item label="軍階">
                <el-input v-model="employeeForm.militaryRank" />
              </el-form-item>
              <el-form-item label="退伍年">
                <el-input v-model="employeeForm.dischargeYear" />
              </el-form-item>

              <el-divider content-position="left">緊急聯絡人1</el-divider>
              <el-form-item label="姓名">
                <el-input v-model="employeeForm.emergency1.name" />
              </el-form-item>
              <el-form-item label="稱謂(C09)">
                <el-select v-model="employeeForm.emergency1.relation" placeholder="選擇稱謂">
                  <el-option v-for="r in RELATION_OPTIONS" :key="'r1-'+r" :label="r" :value="r" />
                </el-select>
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
              <el-form-item label="稱謂(C09)">
                <el-select v-model="employeeForm.emergency2.relation" placeholder="選擇稱謂">
                  <el-option v-for="r in RELATION_OPTIONS" :key="'r2-'+r" :label="r" :value="r" />
                </el-select>
              </el-form-item>
              <el-form-item label="電話一">
                <el-input v-model="employeeForm.emergency2.phone1" />
              </el-form-item>
              <el-form-item label="電話二">
                <el-input v-model="employeeForm.emergency2.phone2" />
              </el-form-item>

              <el-divider content-position="left">關鍵字</el-divider>
              <el-form-item label="關鍵字/多種選項/執業職稱">
                <el-input v-model="employeeForm.keywords" />
              </el-form-item>

              <el-divider content-position="left">經歷</el-divider>
              <div
                v-for="(exp, i) in employeeForm.experiences"
                :key="i"
                style="border:1px solid #ccc;margin-bottom:10px;padding:10px;"
              >
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
              <div
                v-for="(lic, i) in employeeForm.licenses"
                :key="'l'+i"
                style="border:1px solid #ccc;margin-bottom:10px;padding:10px;"
              >
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
              <div
                v-for="(tr, i) in employeeForm.trainings"
                :key="'t'+i"
                style="border:1px solid #ccc;margin-bottom:10px;padding:10px;"
              >
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
                <el-form-item label="積分類別(C10)">
                  <el-select v-model="tr.category" placeholder="選擇積分類別">
                    <el-option v-for="c in CREDIT_CATEGORIES" :key="c" :label="c" :value="c" />
                  </el-select>
                </el-form-item>
                <el-form-item label="分數">
                  <el-input v-model="tr.score" />
                </el-form-item>
                <el-button type="danger" @click="removeTraining(i)">刪除</el-button>
              </div>
              <el-button type="primary" @click="addTraining">新增訓練</el-button>
            </el-form>
          </el-tab-pane>

          <!-- 薪資 -->
          <el-tab-pane label="薪資" name="salary">
            <el-form :model="employeeForm" label-width="140px">
              <el-form-item label="薪資類別">
                <el-select v-model="employeeForm.salaryType" placeholder="選擇類別">
                  <el-option v-for="s in SALARY_TYPES" :key="s" :label="s" :value="s" />
                </el-select>
              </el-form-item>
              <el-form-item label="薪資(元)">
                <el-input-number v-model="employeeForm.salaryAmount" :min="0" :step="100" />
              </el-form-item>
              <el-form-item label="勞工退休金自提金額">
                <el-input-number v-model="employeeForm.laborPensionSelf" :min="0" :step="100" />
              </el-form-item>
              <el-form-item label="員工借支">
                <el-input-number v-model="employeeForm.employeeAdvance" :min="0" :step="100" />
              </el-form-item>

              <el-divider content-position="left">薪資帳戶 A</el-divider>
              <el-form-item label="銀行代碼/名稱">
                <el-input v-model="employeeForm.salaryAccountA.bank" />
              </el-form-item>
              <el-form-item label="帳號">
                <el-input v-model="employeeForm.salaryAccountA.acct" />
              </el-form-item>

              <el-divider content-position="left">薪資帳戶 B</el-divider>
              <el-form-item label="銀行代碼/名稱">
                <el-input v-model="employeeForm.salaryAccountB.bank" />
              </el-form-item>
              <el-form-item label="帳號">
                <el-input v-model="employeeForm.salaryAccountB.acct" />
              </el-form-item>

              <el-form-item label="對應-薪資名稱">
                <el-select v-model="employeeForm.salaryItems" multiple filterable placeholder="選擇薪資項目">
                  <el-option v-for="i in SALARY_ITEM_OPTIONS" :key="i" :label="i" :value="i" />
                </el-select>
              </el-form-item>
            </el-form>
          </el-tab-pane>
        </el-tabs>

        <template #footer>
          <el-button @click="employeeDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveEmployee">儲存</el-button>
        </template>
      </el-dialog>
    </div>
  </el-tab-pane>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { apiFetch } from '../../api'

/* 下拉選單選項：可改由後端「後臺控制 C0x」提供 ------------------------------ */
const ROLE_OPTIONS = [
  { label: '管理員', value: 'admin' },
  { label: '主管', value: 'supervisor' },
  { label: '員工', value: 'employee' },
]
const PERMISSION_GRADE_OPTIONS = ['一級', '二級', '三級']          // 權限/職等(不可控僅示意)
const TITLE_OPTIONS = ['護理師', '照顧服務員', '社工師', '物理治療師', '職能治療師', '行政人員'] // C03
const PRACTICE_TITLE_OPTIONS = ['護理師', '社工師', '物理治療師', '職能治療師', '醫師']        // C04
const LANGUAGE_OPTIONS = ['中文', '台語', '客語', '英語', '馬來語']                               // C05
const DISABILITY_LEVELS = ['極重度', '重度身心障礙', '中度身心障礙', '輕度身心障礙']             // C06
const IDENTITY_FLAGS = ['原住民', '新住民', '榮民']                                               // C07
const EDUCATION_LEVELS = ['博士', '碩士', '大學', '專科', '高中職', '國中以下']                   // C08
const RELATION_OPTIONS = ['父', '母', '配偶', '子', '女', '兄', '姊', '弟', '妹', '其他']         // C09
const CREDIT_CATEGORIES = ['院內', '院外', '線上', '研討會', '自學']                               // C10
const SALARY_TYPES = ['月薪', '日薪', '時薪']
const SALARY_ITEM_OPTIONS = ['本薪', '全勤', '加班費', '交通津貼', '伙食津貼', '績效獎金']
const SIGN_ROLES = ['填報', '覆核', '審核', '核定']                                              // 簽核角色
const SIGN_LEVELS = ['L1', 'L2', 'L3', 'L4']                                                     // 簽核層級
const DEFAULT_TAGS = ['資深', '新人', '外聘', '志工']
const ABO_TYPES = ['A', 'B', 'O', 'AB', 'HR']                                                   // 依你的表格式

/* 狀態 --------------------------------------------------------------------- */
const employeeDialogTab = ref('account')
const employeeList = ref([])
const departmentList = ref([])
const orgList = ref([])
const employeeDialogVisible = ref(false)
let editEmployeeIndex = null
let editEmployeeId = ''

function departmentLabel(id) {
  const dept = departmentList.value.find(d => d._id === id)
  return dept ? `${dept.name}(${dept.code})` : id
}

/* 取資料 ------------------------------------------------------------------- */
async function fetchDepartments() {
  const res = await apiFetch('/api/departments')
  if (res.ok) departmentList.value = await res.json()
}
async function fetchOrganizations() {
  const res = await apiFetch('/api/organizations')
  if (res.ok) orgList.value = await res.json()
}
async function fetchEmployees() {
  const res = await apiFetch('/api/employees')
  if (res.ok) employeeList.value = await res.json()
}
onMounted(() => {
  fetchDepartments()
  fetchEmployees()
  fetchOrganizations()
})

/* 表單模型（完整補齊） ------------------------------------------------------ */
const emptyEmployee = {
  username: '',
  password: '',
  role: 'employee',

  // 帳號/權限
  permissionGrade: '',

  // 簽核設定
  signRole: '',
  signTags: [],
  signLevel: '',

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
  identityCategory: [],   // 改為多選陣列
  maritalStatus: '',
  dependents: 0,
  email: '',
  phone: '',
  landline: '',
  householdAddress: '',
  contactAddress: '',
  lineId: '',
  photoList: [],

  // 部門/機構
  organization: '',
  department: '',
  supervisor: null,
  subDepartment: '',

  // 職業別
  title: '',
  practiceTitle: '',      // C04
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
  employmentNote: '',

  // 薪資
  salaryType: '',
  salaryAmount: 0,
  laborPensionSelf: 0,
  employeeAdvance: 0,
  salaryAccountA: { bank: '', acct: '' },
  salaryAccountB: { bank: '', acct: '' },
  salaryItems: []
}
const employeeForm = ref({ ...emptyEmployee })

/* 派生 --------------------------------------------------------------------- */
const filteredDepartments = computed(() =>
  employeeForm.value.organization
    ? departmentList.value.filter(d => d.organization === employeeForm.value.organization)
    : []
)
const supervisorList = computed(() =>
  employeeForm.value.organization && employeeForm.value.department
    ? employeeList.value.filter(
        e =>
          e.role === 'supervisor' &&
          e.organization === employeeForm.value.organization &&
          e.department === employeeForm.value.department
      )
    : []
)

/* 事件 --------------------------------------------------------------------- */
function openEmployeeDialog(index = null) {
  if (index !== null) {
    editEmployeeIndex = index
    const emp = employeeList.value[index]
    editEmployeeId = emp._id || ''
    // 以 emptyEmployee 為基底，可避免漏欄位
    employeeForm.value = { ...structuredClone(emptyEmployee), ...emp, password: '', photoList: [] }
  } else {
    editEmployeeIndex = null
    editEmployeeId = ''
    employeeDialogTab.value = 'account'
    employeeForm.value = { ...structuredClone(emptyEmployee) }
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
  if (payload.supervisor === '' || payload.supervisor === null) delete payload.supervisor

  let res
  if (editEmployeeIndex === null) {
    res = await apiFetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
  } else {
    res = await apiFetch(`/api/employees/${editEmployeeId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
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
    method: 'DELETE'
  })
  if (res.ok) employeeList.value.splice(index, 1)
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
