<!-- src/components/backComponents/OrgDepartmentSetting.vue -->
<template>
  <div class="org-dept-setting">
    <PageHeader title="機構與部門設定" subtitle="機構 › 部門 › 小單位；排班人員與使用班別設定在小單位，排班管理者與使用簽核表單設定在部門">
      <template #stats>
        <span class="hr-stat"><span class="hr-stat__label">機構</span><strong class="hr-stat__value" data-test="stat-org">{{ orgList.length }}</strong></span>
        <span class="hr-stat"><span class="hr-stat__label">部門</span><strong class="hr-stat__value" data-test="stat-dept">{{ deptList.length }}</strong></span>
        <span class="hr-stat"><span class="hr-stat__label">小單位</span><strong class="hr-stat__value" data-test="stat-sub">{{ subList.length }}</strong></span>
      </template>
      <template #actions>
        <el-button type="primary" data-test="add-org" @click="openDialog('org')">新增機構</el-button>
      </template>
    </PageHeader>

    <div class="hr-toolbar">
      <el-select
        v-model="selectedOrg"
        placeholder="全部機構"
        clearable
        filterable
        class="filter-select"
        data-test="org-filter"
      >
        <el-option
          v-for="org in orgList"
          :key="org._id"
          :label="org.name"
          :value="org._id"
        />
      </el-select>
      <el-input v-model="keyword" placeholder="搜尋名稱或代碼" clearable class="filter-keyword" data-test="org-keyword" />
    </div>

    <!-- 機構 › 部門 › 小單位：一張階層表，每一列帶出它自己的設定摘要 -->
    <el-table
      :data="treeRows"
      row-key="rowKey"
      default-expand-all
      :tree-props="{ children: 'children' }"
      class="org-tree"
      data-test="org-tree"
    >
      <el-table-column label="名稱" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">
          <el-tag size="small" :type="TYPE_TAGS[row.type]" class="node-type">{{ TYPE_LABELS[row.type] }}</el-tag>
          <span :class="['node-name', { 'node-name--missing': row.missing }]" data-test="node-name">{{ row.name }}</span>
          <span v-if="row.unitName" class="node-unit">（{{ row.unitName }}）</span>
        </template>
      </el-table-column>
      <el-table-column label="代碼" width="110" show-overflow-tooltip>
        <template #default="{ row }">{{ row.code || '—' }}</template>
      </el-table-column>
      <el-table-column label="排班" min-width="150" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.type === 'dept' && !row.missing" :class="{ 'node-muted': !row.item.deptManager }" data-test="dept-manager-name">{{ deptManagerText(row.item) }}</span>
          <span v-else-if="row.type === 'sub'" :class="['scheduler-names', { 'node-muted': !(row.item.schedulers || []).length }]" data-test="sub-scheduler-names">{{ schedulerText(row.item) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="可使用" width="165" show-overflow-tooltip>
        <template #default="{ row }">
          <span v-if="row.type === 'dept' && !row.missing" data-test="dept-form-scope">簽核表單：{{ formScopeText(row.item) }}</span>
          <span v-else-if="row.type === 'sub'">班別：<span data-test="sub-shift-scope">{{ shiftScopeText(row.item) }}</span></span>
        </template>
      </el-table-column>
      <el-table-column label="包含" width="150" show-overflow-tooltip>
        <template #default="{ row }">
          <span class="node-counts" data-test="node-counts">{{ countsText(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" :fixed="isMobile ? false : 'right'">
        <template #default="{ row }">
          <template v-if="!row.missing">
            <el-button v-if="row.type === 'org'" link type="primary" data-test="add-child" @click="openDialog('dept', null, row.id)">新增部門</el-button>
            <el-button v-else-if="row.type === 'dept'" link type="primary" data-test="add-child" @click="openDialog('sub', null, row.id)">新增小單位</el-button>
            <el-button link type="primary" data-test="edit-node" @click="editNode(row)">編輯</el-button>
            <el-button link type="danger" data-test="delete-node" @click="removeNode(row)">刪除</el-button>
          </template>
        </template>
      </el-table-column>
      <template #empty>
        <span class="hr-empty" data-test="org-tree-empty">{{ emptyText }}</span>
      </template>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogTitle"
      width="600px"
      class="form-dialog"
    >
      <el-form :model="form" label-width="120px" class="dialog-form" @submit.prevent>
        <template v-if="currentType === 'org'">
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
          <!-- 統一編號、勞保編號、健保編號、稅籍編號、位置、連絡電話、負責人沒有任何功能讀取（薪資、勞健保、報表、匯出都不用），
               不再顯示也不送出，伺服器上原本的資料保留 -->
        </template>

        <template v-else-if="currentType === 'dept'">
          <el-form-item label="所屬機構" required>
            <el-select v-model="form.organization" placeholder="選擇機構" filterable style="width: 100%">
              <el-option v-for="org in orgSelectOptions" :key="org.value" :label="org.label" :value="org.value" />
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
          <!-- 位置、連絡電話、部門主管（文字）、負責人、機構代碼、統一編號、勞保證號、健保編號、稅籍編號、預設週休二日、
               允許臨時調班沒有任何功能讀取（簽核找員工資料的直屬主管；排班、薪資、勞健保、報表、匯出都不用），
               不再顯示也不送出，伺服器上原本的資料保留 -->
          <el-form-item label="排班管理者">
            <el-select
              v-model="form.deptManager"
              placeholder="輸入姓名或員工代號搜尋（任何角色都可以）"
              style="width: 100%"
              clearable
              filterable
              data-test="dept-manager-select"
              :filter-method="(text) => setEmployeeQuery('deptManager', text)"
              @visible-change="(open) => handleEmployeeSelectVisible('deptManager', open)"
            >
              <el-option
                v-for="mgr in deptManagerVisibleOptions"
                :key="mgr.value"
                :label="mgr.label"
                :value="mgr.value"
                :disabled="mgr.disabled"
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
        </template>

        <template v-else>
          <el-form-item label="所屬部門" required>
            <el-select v-model="form.department" placeholder="選擇部門" filterable style="width: 100%">
              <el-option v-for="dept in deptSelectOptions" :key="dept.value" :label="dept.label" :value="dept.value" />
            </el-select>
          </el-form-item>
          <el-form-item label="小單位名稱" required>
            <el-input v-model="form.name" placeholder="請輸入小單位名稱" />
          </el-form-item>
          <el-form-item label="代碼">
            <el-input v-model="form.code" placeholder="請輸入代碼" data-test="sub-code" />
            <div class="form-hint">員工批次匯入時，可以用代碼或名稱對應小單位</div>
          </el-form-item>
          <el-form-item label="排班人員">
            <el-select
              v-model="form.schedulers"
              multiple
              filterable
              clearable
              placeholder="輸入姓名或員工代號搜尋（任何角色都可以）"
              style="width: 100%"
              data-test="sub-schedulers"
              :filter-method="(text) => setEmployeeQuery('schedulers', text)"
              @visible-change="(open) => handleEmployeeSelectVisible('schedulers', open)"
            >
              <el-option
                v-for="opt in schedulerVisibleOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
                :disabled="opt.disabled"
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
              <el-option-group :label="`上班的班別（${workShiftOptions.length} 種，可選）`">
                <el-option
                  v-for="shift in workShiftOptions"
                  :key="shift._id"
                  :label="shiftLabel(shift)"
                  :value="String(shift._id)"
                />
              </el-option-group>
              <!-- 不用上班的班別也列出來（不能選）：只列上班的班別時，看起來像是有班別不見了 -->
              <el-option-group
                v-if="nonWorkShiftOptions.length"
                :label="`不用上班的班別（${nonWorkShiftOptions.length} 種，一律可以用，不必選）`"
                data-test="sub-shift-nonwork-group"
              >
                <el-option
                  v-for="shift in nonWorkShiftOptions"
                  :key="shift._id"
                  :label="`${shiftLabel(shift)}　一律可用`"
                  :value="`nonwork:${shift._id}`"
                  disabled
                />
              </el-option-group>
            </el-select>
            <div class="form-hint">排班頁看這個小單位時，班別選單與圖例只列出所選的班別；未選擇代表全部班別</div>
            <div class="form-hint" data-test="sub-shift-rest-hint">
              共 {{ shiftOptions.length }} 種班別：上班的班別 {{ workShiftOptions.length }} 種可選；休息日、例假、國定假日、請假等不用上班的班別 {{ nonWorkShiftOptions.length }} 種一律可以使用，不必選擇
            </div>
            <div v-if="noWorkShiftSelected" class="form-hint form-hint--warning" data-test="sub-shift-no-work-warning">
              目前的設定沒有任何上班的班別（原本選的班別已刪除，或都是不用上班的班別），排班時只能排休；請重新選擇要使用的班別
            </div>
          </el-form-item>
        </template>
      </el-form>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="saving" data-test="save-node" @click="saveItem">儲存</el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'
import PageHeader from '../PageHeader.vue'
import { NETWORK_ERROR_MESSAGE, translateServerMessage } from '../../utils/approvalErrors'
import { isNonWorkShift } from '../../utils/scheduleScope'
import { windowOptions } from '../../utils/optionWindow'
import { useIsMobile } from '../../utils/useIsMobile'

// 手機寬度時操作欄不固定在右側（固定欄會蓋掉大半張表）
const isMobile = useIsMobile()

const orgList = ref([])
const deptList = ref([])
const subList = ref([])
// 清單讀回來了沒有（空狀態的文字用）
const listsLoaded = ref(false)
// 篩選：只看某一個機構、依名稱或代碼搜尋（都在畫面上篩選，清單永遠是完整的，上方的數字才不會跟著篩選變）
const selectedOrg = ref('')
const keyword = ref('')
const shiftOptions = ref([])
const shiftsLoaded = ref(false)
const saving = ref(false)

const dialogVisible = ref(false)
const form = ref(defaultForm('org'))
const currentType = ref('org')
const editIndex = ref(null)
// 正在編輯的那一筆的 _id（開啟對話框時記下；存檔時用它，不靠清單裡的位置）
const editId = ref('')
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

// 員工很多時選單只畫出一部分（已選的一定在），輸入姓名或員工代號搜尋全部
const employeeQuery = ref({ key: '', text: '' })
function setEmployeeQuery(key, text) {
  employeeQuery.value = { key, text: typeof text === 'string' ? text : '' }
}
function handleEmployeeSelectVisible(key, open) {
  if (!open && employeeQuery.value.key === key) employeeQuery.value = { key: '', text: '' }
}
const employeeMoreLabel = hidden => `還有 ${hidden} 位沒有列出，請輸入姓名或員工代號搜尋`
const schedulerVisibleOptions = computed(() => windowOptions(schedulerSelectOptions.value, {
  query: employeeQuery.value.key === 'schedulers' ? employeeQuery.value.text : '',
  selected: form.value.schedulers,
  moreLabel: employeeMoreLabel
}))
const deptManagerVisibleOptions = computed(() => windowOptions(deptManagerOptions.value, {
  query: employeeQuery.value.key === 'deptManager' ? employeeQuery.value.text : '',
  selected: form.value.deptManager,
  moreLabel: employeeMoreLabel
}))

// 所屬機構／所屬部門的選單：原本選的機構或部門已經被刪除時仍列出來（標明已刪除），不然選單會顯示一串編號
const orgSelectOptions = computed(() => {
  const options = orgList.value.map(org => ({ value: org._id, label: org.name || '未命名機構' }))
  const current = toIdText(form.value.organization)
  if (current && !options.some(option => option.value === current)) options.push({ value: current, label: '已刪除的機構' })
  return options
})
const orgNameOf = id => orgList.value.find(org => org._id === id)?.name || ''
const deptSelectOptions = computed(() => {
  // 不同機構可能有同名的部門，後面附上機構名稱才分得出來
  const options = deptList.value.map(dept => {
    const orgName = orgNameOf(toIdText(dept.organization))
    return { value: dept._id, label: orgName ? `${dept.name}（${orgName}）` : (dept.name || '未命名部門') }
  })
  const current = toIdText(form.value.department)
  if (current && !options.some(option => option.value === current)) options.push({ value: current, label: '已刪除的部門' })
  return options
})

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
const nonWorkShiftOptions = computed(() => shiftOptions.value.filter(shift => isNonWorkShift(shift)))
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

// 階層表上的摘要文字
function schedulerText(sub) {
  const names = schedulerNames(sub)
  return names === '未指定' ? '未指定排班人員' : `排班人員：${names}`
}

function deptManagerText(dept) {
  const id = dept?.deptManager ? toIdText(dept.deptManager) : ''
  if (!id) return '未指定排班管理者'
  const manager = managerList.value.find(mgr => toIdText(mgr.value) === id)
  return `排班管理者：${manager ? manager.label : '已刪除的員工'}`
}

const TYPE_LABELS = { org: '機構', dept: '部門', sub: '小單位' }
const TYPE_TAGS = { org: 'primary', dept: 'success', sub: 'info' }

// 每個部門、小單位有幾位員工（/api/dept-managers 回的每位員工帶有 department 與 subDepartment）
const employeeCounts = computed(() => {
  const byDept = new Map()
  const bySub = new Map()
  managerList.value.forEach(emp => {
    const dept = toIdText(emp?.department)
    const sub = toIdText(emp?.subDepartment)
    if (dept) byDept.set(dept, (byDept.get(dept) || 0) + 1)
    if (sub) bySub.set(sub, (bySub.get(sub) || 0) + 1)
  })
  return { byDept, bySub }
})

// 機構 › 部門 › 小單位的階層。上層已經被刪除（或沒有設定）的部門、小單位歸在「找不到…」底下，看得到也改得回來
const fullTree = computed(() => {
  const subNode = sub => ({
    rowKey: `sub-${sub._id}`,
    type: 'sub',
    id: sub._id,
    item: sub,
    name: sub.name || '未命名小單位',
    code: sub.code || '',
    employees: employeeCounts.value.bySub.get(toIdText(sub._id)) || 0
  })
  const deptNode = dept => {
    const children = subList.value.filter(sub => toIdText(sub.department) === dept._id).map(subNode)
    return {
      rowKey: `dept-${dept._id}`,
      type: 'dept',
      id: dept._id,
      item: dept,
      name: dept.name || '未命名部門',
      unitName: dept.unitName && dept.unitName !== dept.name ? dept.unitName : '',
      code: dept.code || '',
      subCount: children.length,
      employees: employeeCounts.value.byDept.get(toIdText(dept._id)) || 0,
      children
    }
  }
  const orgNode = org => {
    const children = deptList.value.filter(dept => toIdText(dept.organization) === org._id).map(deptNode)
    return {
      rowKey: `org-${org._id}`,
      type: 'org',
      id: org._id,
      item: org,
      name: org.name || '未命名機構',
      unitName: org.unitName && org.unitName !== org.name ? org.unitName : '',
      code: org.systemCode || '',
      deptCount: children.length,
      subCount: children.reduce((sum, dept) => sum + dept.subCount, 0),
      employees: children.reduce((sum, dept) => sum + dept.employees, 0),
      children
    }
  }
  const nodes = orgList.value.map(orgNode)
  const orgIds = new Set(orgList.value.map(org => org._id))
  const deptIds = new Set(deptList.value.map(dept => dept._id))
  const orphanDepts = deptList.value.filter(dept => !orgIds.has(toIdText(dept.organization))).map(deptNode)
  const orphanSubs = subList.value.filter(sub => !deptIds.has(toIdText(sub.department))).map(subNode)
  if (orphanSubs.length) {
    orphanDepts.push({
      rowKey: 'dept-missing',
      type: 'dept',
      missing: true,
      id: '',
      item: {},
      name: '找不到所屬部門（請編輯小單位重新選擇）',
      code: '',
      subCount: orphanSubs.length,
      employees: orphanSubs.reduce((sum, sub) => sum + sub.employees, 0),
      children: orphanSubs
    })
  }
  if (orphanDepts.length) {
    nodes.push({
      rowKey: 'org-missing',
      type: 'org',
      missing: true,
      id: '',
      item: {},
      name: '找不到所屬機構（請編輯部門重新選擇）',
      code: '',
      deptCount: orphanDepts.filter(dept => !dept.missing).length,
      subCount: orphanDepts.reduce((sum, dept) => sum + dept.subCount, 0),
      employees: orphanDepts.reduce((sum, dept) => sum + dept.employees, 0),
      children: orphanDepts
    })
  }
  return nodes
})

// 套用篩選：名稱或代碼符合的那一列留下（連同它底下的全部），底下有符合的也留下
const treeRows = computed(() => {
  const text = keyword.value.trim().toLowerCase()
  const matches = node => !text || [node.name, node.code, node.unitName].some(value => String(value || '').toLowerCase().includes(text))
  const prune = node => {
    if (matches(node)) return node
    const children = (node.children || []).map(prune).filter(Boolean)
    return children.length ? { ...node, children } : null
  }
  return fullTree.value
    .filter(node => !selectedOrg.value || node.id === selectedOrg.value)
    .map(prune)
    .filter(Boolean)
})

const emptyText = computed(() => {
  if (!listsLoaded.value) return '載入中…'
  if (!orgList.value.length && !deptList.value.length && !subList.value.length) return '尚未建立機構，請按右上角「新增機構」'
  return '找不到符合的機構、部門或小單位'
})

function countsText(node) {
  const parts = []
  if (node.type === 'org') parts.push(`${node.deptCount} 部門`)
  if (node.type !== 'sub') parts.push(`${node.subCount} 小單位`)
  parts.push(`${node.employees} 人`)
  return parts.join('・')
}

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
    fetchList('dept'),
    fetchList('sub')
  ])
  listsLoaded.value = true
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

// index：要編輯的那一筆在清單裡的位置（null＝新增）；parentId：從上層那一列按「新增部門／新增小單位」時帶入上層
async function openDialog(type, index = null, parentId = '') {
  currentType.value = type
  shiftSelectionTouched.value = false
  employeeQuery.value = { key: '', text: '' }
  if (type === 'sub') await fetchShifts(true)
  if (index !== null) {
    editIndex.value = index
    const item =
      type === 'org'
        ? orgList.value[index]
        : type === 'dept'
          ? deptList.value[index]
          : subList.value[index]
    editId.value = item?._id ? String(item._id) : ''
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
    editId.value = ''
    form.value = defaultForm(type)
    // 從上層那一列新增：帶入上層；從篩選中的機構新增部門：帶入那個機構
    if (type === 'dept') form.value.organization = parentId || selectedOrg.value
    if (type === 'sub') form.value.department = parentId || ''
  }
  dialogVisible.value = true
}

function listOf(type) {
  return type === 'org' ? orgList : type === 'dept' ? deptList : subList
}

// 階層表的「編輯」：依 _id 找到它在清單裡的位置
function editNode(node) {
  const index = listOf(node.type).value.findIndex(item => item._id === node.id)
  if (index < 0) {
    ElMessage.error('找不到這筆資料，可能已被刪除，請重新整理')
    return
  }
  openDialog(node.type, index)
}

async function saveItem() {
  // 上一次還在儲存時不再送一次（連按兩下會建立兩筆）
  if (saving.value) return
  const type = currentType.value
  const url = urlOf(type)
  const list = listOf(type)
  const isNew = editIndex.value === null
  const payload = payloadOf(type, isNew)
  saving.value = true
  try {
    let res
    try {
      if (isNew) {
        res = await apiFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      } else {
        // 用開啟對話框時記下的 _id；清單在這段時間重新讀過、順序變了也不會存到別筆
        const id = editId.value || list.value[editIndex.value]?._id
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
      ElMessage.success(`已${isNew ? '新增' : '儲存'}${TYPE_LABELS[type]}`)
    } else if (res) {
      // 存檔失敗：對話框保持開啟，顯示伺服器的原因
      ElMessage.error(await saveErrorMessage(res))
    }
  } finally {
    saving.value = false
  }
}

// 刪除前的說明：底下還有東西時不刪（不然它們會留著一個不存在的上層），沒有的話說明刪除的後果
function deleteBlockedReason(node) {
  const parts = []
  if (node.type === 'org' && node.deptCount) parts.push(`${node.deptCount} 個部門`)
  if (node.type !== 'sub' && node.subCount) parts.push(`${node.subCount} 個小單位`)
  if (node.employees) parts.push(`${node.employees} 位員工`)
  if (!parts.length) return ''
  const target = TYPE_LABELS[node.type]
  return `「${node.name}」還有 ${parts.join('、')}，請先把它們移到其他${target}或刪除後，再刪除這個${target}`
}

const DELETE_CONSEQUENCE = {
  org: '刪除後無法復原。',
  dept: '這個部門的排班管理者與使用簽核表單設定會一併刪除，無法復原。',
  sub: '這個小單位的排班人員與使用班別設定會一併刪除，被指定的排班人員不能再排這個小單位，無法復原。'
}

const deleting = ref(false)
async function removeNode(node) {
  if (!node?.id || deleting.value) return
  const blocked = deleteBlockedReason(node)
  if (blocked) {
    ElMessageBox.alert(blocked, `不能刪除這個${TYPE_LABELS[node.type]}`, { type: 'warning', confirmButtonText: '知道了' }).catch(() => {})
    return
  }
  try {
    await ElMessageBox.confirm(
      `確定要刪除${TYPE_LABELS[node.type]}「${node.name}」嗎？${DELETE_CONSEQUENCE[node.type]}`,
      `刪除${TYPE_LABELS[node.type]}`,
      { type: 'warning', confirmButtonText: '刪除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  deleting.value = true
  try {
    let res
    try {
      res = await apiFetch(`${urlOf(node.type)}/${node.id}`, { method: 'DELETE' })
    } catch (err) {
      ElMessage.error(NETWORK_ERROR_MESSAGE)
      return
    }
    if (res && res.ok) {
      ElMessage.success(`已刪除${TYPE_LABELS[node.type]}`)
    } else if (res) {
      // 伺服器拒絕（例如還有員工、或簽核流程的群組關卡指定了這個小單位）：顯示它的原因
      ElMessage.error(await saveErrorMessage(res))
    }
    // 不論成功與否都重新讀清單，畫面和資料庫一致
    await fetchAll()
    await fetchManagers()
  } finally {
    deleting.value = false
  }
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
</script>

<style scoped>
.org-dept-setting {
  padding: 0;
}

.filter-select {
  width: 220px;
  max-width: 100%;
}

.filter-keyword {
  width: 240px;
  max-width: 100%;
}

.node-type {
  margin-right: 8px;
}

.node-name {
  font-weight: var(--hr-font-weight-medium);
  color: var(--hr-gray-900);
}

.node-name--missing {
  color: #b45309;
}

.node-unit,
.node-muted {
  color: var(--hr-gray-500);
}

.node-unit {
  font-size: 12px;
}

.node-counts,
.scheduler-names {
  font-size: 13px;
  color: var(--hr-gray-700);
}

.scheduler-names.node-muted {
  color: var(--hr-gray-500);
}

.dialog-form {
  max-height: 60vh;
  overflow-y: auto;
}

/* 欄位下方的說明文字（排班人員、使用班別、使用簽核表單） */
.form-hint {
  width: 100%;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--hr-gray-500);
}

.form-hint--warning {
  color: #b45309;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 767px) {
  .filter-select,
  .filter-keyword {
    width: 100%;
  }
}
</style>
