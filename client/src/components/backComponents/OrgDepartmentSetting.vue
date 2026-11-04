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
              <!-- 機構只顯示有功能的欄位；連絡電話、負責人等舊欄位沒有任何功能讀取，不再顯示（資料保留） -->
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
              <!-- 部門只顯示有功能的欄位；機構代碼、統一編號、位置、負責人、部門主管（文字）等舊欄位沒有任何功能讀取，不再顯示（資料保留） -->
              <el-table-column label="使用簽核表單" width="140">
                <template #default="{ row }">
                  <el-tag :type="row.allowedFormIds?.length ? 'warning' : 'info'" class="code-tag" data-test="dept-form-scope">
                    {{ formScopeText(row) }}
                  </el-tag>
                </template>
              </el-table-column>
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
              <el-tag
                type="info"
                class="dept-context-tag"
              >
                {{ selectedDeptContext || '請選擇部門' }}
              </el-tag>
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
                    </div>
                  </div>
                </template>
              </el-table-column>
              <!-- 小單位只顯示有功能的欄位；單位名稱、位置、電話、主管、證號、人力需求等舊欄位沒有任何功能讀取，不再顯示（資料保留） -->
              <el-table-column prop="code" label="代碼" width="120">
                <template #default="{ row }">
                  <el-tag type="info" class="code-tag">{{ row.code || '-' }}</el-tag>
                </template>
              </el-table-column>
              <el-table-column label="排班人員" min-width="160">
                <template #default="{ row }">
                  <span class="scheduler-names" data-test="sub-scheduler-names">{{ schedulerNames(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="使用班別" width="140">
                <template #default="{ row }">
                  <el-tag :type="row.allowedShiftIds?.length ? 'warning' : 'info'" class="code-tag" data-test="sub-shift-scope">
                    {{ shiftScopeText(row) }}
                  </el-tag>
                </template>
              </el-table-column>
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
              <div class="form-hint" data-test="org-import-hint">員工批次匯入時，可以用機構名稱、單位名稱、系統代碼或機構代碼對應機構</div>
            </el-form-item>
          </div>
          <!-- 統一編號、勞保編號、健保編號、稅籍編號、位置、連絡電話、負責人沒有任何功能讀取（薪資、勞健保、報表、匯出都不用），
               不再顯示也不送出，伺服器上原本的資料保留 -->
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
              <div class="form-hint" data-test="dept-code-hint">員工批次匯入時，可以用部門代碼或名稱對應部門</div>
            </el-form-item>
            <el-form-item label="單位名稱">
              <el-input v-model="form.unitName" placeholder="請輸入單位名稱" />
              <div class="form-hint" data-test="dept-unit-name-hint">匯出排班表、國定假日休假紀錄時，標題使用單位名稱；沒有填寫時使用部門名稱</div>
            </el-form-item>
          </div>
          <!-- 位置、連絡電話、部門主管（文字）、負責人、機構代碼、統一編號、勞保證號、健保編號、稅籍編號、預設週休二日、
               允許臨時調班沒有任何功能讀取（簽核找員工資料的直屬主管；排班、薪資、勞健保、報表、匯出都不用），
               不再顯示也不送出，伺服器上原本的資料保留 -->

          <div class="form-section">
            <h3 class="form-section-title">排班設定</h3>
            <el-form-item label="排班管理者">
              <el-select
                v-model="form.deptManager"
                placeholder="搜尋並選擇員工（任何角色都可以）"
                style="width: 100%"
                clearable
                filterable
                data-test="dept-manager-select"
              >
                <el-option
                  v-for="mgr in deptManagerOptions"
                  :key="mgr.value"
                  :label="mgr.label"
                  :value="mgr.value"
                />
              </el-select>
              <div class="form-hint" data-test="dept-manager-hint">被指定的員工不論是不是主管，登入後都看得到排班頁，可以排整個部門的班：這個部門所有小單位的員工，以及沒有小單位的員工；只排個別小單位請到小單位設定「排班人員」。簽核找的是每位員工資料設定的直屬主管，不受排班管理者影響</div>
            </el-form-item>
            <el-form-item label="排班備註">
              <el-input
                v-model="form.scheduleNotes"
                type="textarea"
                :rows="3"
                maxlength="1000"
                placeholder="例如調班紀錄、換班注意事項"
              />
            </el-form-item>
          </div>

          <div class="form-section">
            <h3 class="form-section-title">簽核表單</h3>
            <el-form-item label="使用簽核表單">
              <el-select
                v-model="form.allowedFormIds"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="未選擇代表全部表單"
                style="width: 100%"
                data-test="dept-allowed-forms"
              >
                <el-option
                  v-for="opt in formSelectOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
              <div class="form-hint">這個部門的員工登入後，只看得到、只能送出所選的簽核表單；未選擇代表全部表單</div>
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
              <el-input v-model="form.code" placeholder="請輸入代碼" data-test="sub-code" />
              <div class="form-hint">員工批次匯入時，可以用代碼或名稱對應小單位</div>
            </el-form-item>
          </div>

          <div class="form-section">
            <h3 class="form-section-title">排班設定</h3>
            <el-form-item label="排班人員">
              <el-select
                v-model="form.schedulers"
                multiple
                filterable
                clearable
                placeholder="搜尋並選擇員工（任何角色都可以）"
                style="width: 100%"
                data-test="sub-schedulers"
              >
                <el-option
                  v-for="opt in schedulerSelectOptions"
                  :key="opt.value"
                  :label="opt.label"
                  :value="opt.value"
                />
              </el-select>
              <div class="form-hint" data-test="sub-schedulers-hint">被指定的員工登入後才看得到排班頁，可以排這個小單位所有員工的班；簽核找的是員工資料設定的直屬主管，不受排班人員影響</div>
            </el-form-item>
            <el-form-item label="使用班別">
              <el-select
                v-model="selectedWorkShiftIds"
                multiple
                filterable
                clearable
                collapse-tags
                collapse-tags-tooltip
                placeholder="未選擇代表全部班別"
                style="width: 100%"
                data-test="sub-allowed-shifts"
              >
                <el-option
                  v-for="shift in workShiftOptions"
                  :key="shift._id"
                  :label="shiftLabel(shift)"
                  :value="String(shift._id)"
                />
              </el-select>
              <div class="form-hint">排班頁看這個小單位時，班別選單與圖例只列出所選的班別；未選擇代表全部班別</div>
              <div class="form-hint" data-test="sub-shift-rest-hint">休息日、例假、國定假日、請假等不用上班的班別一律可以使用，不必選擇</div>
              <div v-if="noWorkShiftSelected" class="form-hint form-hint--warning" data-test="sub-shift-no-work-warning">
                目前的設定沒有任何上班的班別（原本選的班別已刪除，或都是不用上班的班別），排班時只能排休；請重新選擇要使用的班別
              </div>
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
import { ElMessage } from 'element-plus'
import { apiFetch } from '../../api'
import { NETWORK_ERROR_MESSAGE, translateServerMessage } from '../../utils/approvalErrors'
import { isNonWorkShift } from '../../utils/scheduleScope'

const activeTab = ref('org')
const orgList = ref([])
const deptList = ref([])
const subList = ref([])
const selectedOrg = ref('')
const selectedDept = ref('')
const shiftOptions = ref([])
const shiftsLoaded = ref(false)

const dialogVisible = ref(false)
const form = ref(defaultForm('org'))
const currentType = ref('org')
const editIndex = ref(null)
// 這次開啟對話框後有沒有改過「使用班別」：修改小單位時沒改就不送這個欄位，伺服器上的設定原封不動
const shiftSelectionTouched = ref(false)

// 小單位對話框顯示（也只送出）的欄位。其他舊欄位（單位名稱、位置、連絡電話、部門主管、負責人、機構代碼、
// 統一編號、勞保證號、健保編號、稅籍編號、人力需求數、班表拉選）沒有任何功能讀取，不再顯示也不送出，
// 伺服器上原本的資料保留不動（API 仍接受這些欄位）
const SUB_FORM_FIELDS = ['department', 'name', 'code', 'schedulers', 'allowedShiftIds']
// 機構對話框顯示（也只送出）的欄位：名稱、系統代碼、單位名稱、機構代碼（員工批次匯入用這幾個對應機構）。
// 統一編號、勞保編號、健保編號、稅籍編號、位置、連絡電話、負責人沒有任何功能讀取，不顯示也不送出，伺服器上的資料保留
const ORG_FORM_FIELDS = ['name', 'systemCode', 'unitName', 'orgCode']
// 部門對話框顯示（也只送出）的欄位。位置、連絡電話、部門主管（文字）、負責人、機構代碼、統一編號、勞保證號、
// 健保編號、稅籍編號、預設週休二日、允許臨時調班沒有任何功能讀取，不顯示也不送出（伺服器只更新有送的欄位，資料保留；
// 新增時用資料庫的預設值，與以前對話框的預設相同）
const DEPT_FORM_FIELDS = ['organization', 'name', 'code', 'unitName', 'deptManager', 'scheduleNotes', 'allowedFormIds']

// 部門排班規則與中場休息設定
// 排班管理者／排班人員的選單：任何角色的員工（/api/dept-managers，active: false 為離職、留職停薪或停用帳號）
const managerList = ref([])
// 使用簽核表單的選單（管理員看得到全部表單，含停用的）
const formOptions = ref([])

const toIdText = value => (value && typeof value === 'object' ? String(value._id ?? value.id ?? '') : String(value ?? ''))

function employeeOptionLabel(mgr) {
  const name = mgr?.label || '未命名員工'
  const code = mgr?.employeeId ? `（${mgr.employeeId}）` : ''
  return `${name}${code}${mgr?.active === false ? '（已停用）' : ''}`
}

// 選單只列在職的員工；已指定的人就算後來離職或被刪除，也要看得到是誰（才能移除）
function buildEmployeeOptions(selectedIds) {
  const selected = new Set((selectedIds || []).map(toIdText).filter(Boolean))
  const known = new Set()
  const options = []
  managerList.value.forEach(mgr => {
    const value = toIdText(mgr.value)
    known.add(value)
    if (mgr.active === false && !selected.has(value)) return
    options.push({ value, label: employeeOptionLabel(mgr) })
  })
  selected.forEach(value => {
    if (!known.has(value)) options.push({ value, label: '已刪除的員工' })
  })
  return options
}

const schedulerSelectOptions = computed(() => buildEmployeeOptions(form.value.schedulers))
const deptManagerOptions = computed(() => buildEmployeeOptions(form.value.deptManager ? [form.value.deptManager] : []))

const formSelectOptions = computed(() => {
  const selected = new Set((form.value.allowedFormIds || []).map(toIdText).filter(Boolean))
  const known = new Set()
  const options = []
  formOptions.value.forEach(item => {
    const value = toIdText(item._id)
    known.add(value)
    const inactive = item.is_active === false
    if (inactive && !selected.has(value)) return
    options.push({ value, label: `${item.name || '未命名表單'}${inactive ? '（已停用）' : ''}` })
  })
  selected.forEach(value => {
    if (!known.has(value)) options.push({ value, label: '已刪除的表單' })
  })
  return options
})

// 使用班別的選單只列上班的班別：不用上班的班別（休息日、例假、國定假日、請假）每個小單位一律可以用，不必選
const workShiftOptions = computed(() => shiftOptions.value.filter(shift => !isNonWorkShift(shift)))
const workShiftIds = computed(() => new Set(workShiftOptions.value.map(shift => String(shift._id))))

// 選單綁 form.allowedShiftIds 裡的上班班別。舊設定選過的不用上班的班別照樣保留（伺服器一律允許，留著不影響）；
// 全部取消就是全部班別（存成空陣列）；已刪除的班別在重新選擇時去掉（伺服器不接受不存在的班別）
const selectedWorkShiftIds = computed({
  get: () => (form.value.allowedShiftIds || []).map(String).filter(id => workShiftIds.value.has(id)),
  set: ids => {
    const work = (Array.isArray(ids) ? ids : []).map(String)
    const nonWorkIds = new Set(shiftOptions.value.filter(isNonWorkShift).map(shift => String(shift._id)))
    const kept = (form.value.allowedShiftIds || []).map(String).filter(id => nonWorkIds.has(id))
    form.value.allowedShiftIds = work.length ? Array.from(new Set([...work, ...kept])) : []
    shiftSelectionTouched.value = true
  }
})

// 有設定使用班別、卻沒有任何上班的班別（例如選的班別後來被刪除）：排班時只能排休，提醒重新選擇
const noWorkShiftSelected = computed(() => {
  const ids = (form.value.allowedShiftIds || []).map(String)
  if (!ids.length || !shiftOptions.value.length) return false
  return !ids.some(id => workShiftIds.value.has(id))
})

function formScopeText(dept) {
  const count = Array.isArray(dept?.allowedFormIds) ? dept.allowedFormIds.length : 0
  return count ? `${count} 張表單` : '全部表單'
}

function schedulerNames(sub) {
  const ids = Array.isArray(sub?.schedulers) ? sub.schedulers.map(toIdText) : []
  if (!ids.length) return '未指定'
  const names = new Map(managerList.value.map(mgr => [toIdText(mgr.value), mgr.label]))
  return ids.map(id => names.get(id) || '已刪除的員工').join('、')
}

// 列表的「使用班別」只摘要上班的班別（不用上班的班別一律可以用，與對話框相同）
function shiftScopeText(sub) {
  const ids = Array.isArray(sub?.allowedShiftIds) ? sub.allowedShiftIds.map(String) : []
  if (!ids.length) return '全部班別'
  if (!shiftOptions.value.length) return `${ids.length} 種班別`
  const labels = new Map(workShiftOptions.value.map(shift => [String(shift._id), shift.code || shift.name]))
  const names = Array.from(new Set(ids)).map(id => labels.get(id)).filter(Boolean)
  if (!names.length) return '沒有上班班別'
  return names.length <= 3 ? names.join('、') : `${names.length} 種班別`
}

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

const selectedDeptContext = computed(() => {
  if (!selectedDept.value) return ''
  const dept = deptList.value.find(d => d._id === selectedDept.value)
  if (!dept) return ''
  const orgId = dept.organization
  const orgName = orgList.value.find(org => org._id === orgId)?.name
  const deptName = dept.name
  if (!orgName || !deptName) return ''
  return `${orgName}-${deptName}`
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
    else if (type === 'dept') {
      deptList.value = data.map(item => {
        const orgField = item.organization
        let orgId = ''
        if (typeof orgField === 'string') orgId = orgField
        else if (orgField && typeof orgField === 'object') {
          orgId = orgField._id || orgField.id || ''
        } else if ('organizationId' in item) {
          orgId = item.organizationId
        }
        if (!orgId && parentId) orgId = parentId
        return { ...item, organization: orgId }
      })
    } else {
      subList.value = Array.isArray(data) ? data : []
    }
  }
}

async function fetchAll() {
  await Promise.all([
    fetchList('org'),
    fetchList('dept', selectedOrg.value),
    fetchList('sub', selectedDept.value)
  ])
  await fetchShifts()
}

function defaultForm(type) {
  if (type === 'org') {
    // 只有 ORG_FORM_FIELDS 這幾個欄位
    return {
      name: '',
      systemCode: '',
      unitName: '',
      orgCode: ''
    }
  } else if (type === 'dept') {
    // 只有 DEPT_FORM_FIELDS 這幾個欄位
    return {
      organization: '',
      name: '',
      code: '',
      unitName: '',
      deptManager: '',
      scheduleNotes: '',
      allowedFormIds: []
    }
  } else {
    // 只有 SUB_FORM_FIELDS 這幾個欄位
    return {
      name: '',
      code: '',
      department: '',
      schedulers: [],
      allowedShiftIds: []
    }
  }
}

// 小單位對話框要送出的資料：只送畫面上的欄位；修改時沒改「使用班別」就不送，伺服器上的設定不動
function subPayload(isNew) {
  const payload = Object.fromEntries(SUB_FORM_FIELDS.map(key => [key, form.value[key]]))
  if (!isNew && !shiftSelectionTouched.value) delete payload.allowedShiftIds
  return payload
}

// 機構、部門對話框要送出的資料：只送畫面上的欄位，不顯示的舊欄位不送，伺服器上的資料不動
function pickFields(fields) {
  return Object.fromEntries(fields.map(key => [key, form.value[key]]))
}

function deptPayload() {
  const payload = pickFields(DEPT_FORM_FIELDS)
  // 清除「排班管理者」時選單給的是 undefined（JSON 會整個拿掉，伺服器就保留原本的人）：送空字串才會真的清除
  payload.deptManager = payload.deptManager ? toIdText(payload.deptManager) : ''
  payload.allowedFormIds = Array.isArray(payload.allowedFormIds) ? payload.allowedFormIds : []
  return payload
}

function payloadOf(type, isNew) {
  if (type === 'org') return pickFields(ORG_FORM_FIELDS)
  if (type === 'dept') return deptPayload()
  return subPayload(isNew)
}

// 儲存失敗時顯示伺服器的中文訊息（例如「使用班別包含不存在的班別，請重新選擇」「統一編號需為 8 碼數字」）：
// Mongoose 的驗證訊息去掉英文前綴（「… validation failed: 欄位: 」），英文訊息換成中文說明
async function saveErrorMessage(res) {
  const body = await res.json().catch(() => ({}))
  const raw = String(body?.error || body?.message || '').trim()
  if (/path `[^`]+` is required/i.test(raw)) return '請填寫必填欄位（標示 * 的欄位）'
  const validation = /validation failed:\s*([\s\S]+)$/i.exec(raw)
  const text = validation
    ? validation[1]
      .split(/,\s*(?=[\w.]+:\s)/)
      .map(part => part.replace(/^[\w.]+:\s*/, '').trim())
      .filter(Boolean)
      .join('；')
    : raw
  return translateServerMessage(text, { status: res.status })
}

async function openDialog(type, index = null) {
  currentType.value = type
  shiftSelectionTouched.value = false
  if (type === 'sub') await fetchShifts(true)
  if (index !== null) {
    editIndex.value = index
    const item =
      type === 'org'
        ? orgList.value[index]
        : type === 'dept'
          ? deptList.value[index]
          : subList.value[index]
    // 只帶入畫面上的欄位；不顯示的舊欄位不放進表單，存檔時也不送（伺服器上的資料不動）
    const fields = type === 'org' ? ORG_FORM_FIELDS : type === 'dept' ? DEPT_FORM_FIELDS : SUB_FORM_FIELDS
    const defaults = defaultForm(type)
    form.value = Object.fromEntries(fields.map(key => [key, item?.[key] ?? defaults[key]]))
    if (type === 'sub') {
      form.value.department = toIdText(item?.department)
      // 多選欄位複製一份（不要直接改到列表上的資料），舊資料沒有這兩個欄位時是空陣列
      form.value.schedulers = (Array.isArray(item?.schedulers) ? item.schedulers : []).map(toIdText).filter(Boolean)
      form.value.allowedShiftIds = (Array.isArray(item?.allowedShiftIds) ? item.allowedShiftIds : []).map(String)
    }
    if (type === 'dept') {
      form.value.organization = toIdText(item?.organization)
      form.value.allowedFormIds = (Array.isArray(item?.allowedFormIds) ? item.allowedFormIds : []).map(toIdText).filter(Boolean)
      form.value.deptManager = item?.deptManager ? toIdText(item.deptManager) : ''
    }
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
  const isNew = editIndex.value === null
  const payload = payloadOf(currentType.value, isNew)
  let res
  try {
    if (isNew) {
      res = await apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    } else {
      const id = list.value[editIndex.value]._id
      res = await apiFetch(`${url}/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
    }
  } catch (err) {
    console.error(err)
    ElMessage.error(NETWORK_ERROR_MESSAGE)
    return
  }
  if (res && res.ok) {
    await fetchAll()
    dialogVisible.value = false
  } else if (res) {
    // 存檔失敗：對話框保持開啟，顯示伺服器的原因
    ElMessage.error(await saveErrorMessage(res))
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
    const data = await res.json()
    managerList.value = Array.isArray(data) ? data : []
  }
}

async function fetchForms() {
  try {
    const res = await apiFetch('/api/approvals/forms')
    if (res.ok) {
      const data = await res.json()
      formOptions.value = Array.isArray(data) ? data : []
    }
  } catch (err) {
    console.error(err)
  }
}

function shiftLabel(shift) {
  if (!shift) return ''
  const name = shift.name || ''
  const code = shift.code || ''
  if (name && code) return `${name} (${code})`
  return name || code || '未命名班別'
}

async function fetchShifts(force = false) {
  if (shiftsLoaded.value && !force) return
  try {
    const res = await apiFetch('/api/shifts')
    if (res.ok) {
      const data = await res.json()
      shiftOptions.value = Array.isArray(data?.shifts)
        ? data.shifts
        : Array.isArray(data)
          ? data
          : []
      shiftsLoaded.value = true
    }
  } catch (err) {
    console.error(err)
  }
}

onMounted(() => {
  fetchAll()
  fetchManagers()
  fetchForms()
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

.dept-context-tag {
  background: #eef2ff;
  color: #4338ca;
  border-color: transparent;
  font-weight: 500;
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

/* 欄位下方的說明文字（排班人員、使用班別、使用簽核表單） */
.form-hint {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: #64748b;
}

.form-hint--warning {
  color: #b45309;
}

.scheduler-names {
  color: #334155;
  font-size: 13px;
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
