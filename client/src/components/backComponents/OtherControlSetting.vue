<template>
  <div class="other-control-setting">
    <PageHeader title="其他控制設定" subtitle="下拉選單的選項（字典）、表單分類、表單欄位範本與排班權限" />

    <el-alert
      v-if="settingsLoadFailed"
      title="無法取得已儲存的其他控制設定"
      type="warning"
      show-icon
      :closable="false"
      class="load-alert"
      data-test="settings-load-alert"
    >
      <div class="load-alert__body">
        <span>其他控制設定載入失敗，目前畫面顯示的是預設內容，並非已儲存的資料。為避免覆蓋已儲存的設定，載入成功前無法新增、編輯、儲存或刪除。</span>
        <el-button
          link
          type="primary"
          :loading="settingsLoading"
          data-test="reload-settings"
          @click="reloadSettings"
        >重新載入</el-button>
      </div>
    </el-alert>

    <el-tabs v-model="activeTab">
      <el-tab-pane label="字典項目" name="item-setting">
        <div class="dictionary-layout">
          <!-- 先選字典：左邊一排名稱，右邊是它的選項 -->
          <ul class="dictionary-list" data-test="dictionary-list">
            <li v-for="dict in dictionaryDefinitions" :key="dict.key">
              <button
                type="button"
                :class="['dictionary-item', { 'is-active': dict.key === activeDictionaryKey }]"
                :aria-pressed="dict.key === activeDictionaryKey"
                :data-test="`dictionary-item-${dict.key}`"
                @click="activeDictionaryKey = dict.key"
              >
                <span class="dictionary-item__name">{{ dict.label }}</span>
                <span class="dictionary-item__count">{{ (itemSettings[dict.key] || []).length }}</span>
              </button>
            </li>
          </ul>

          <div class="dictionary-detail">
            <div class="hr-toolbar">
              <div class="dictionary-header">
                <h3 class="dictionary-title" data-test="dictionary-title">{{ activeDictionaryLabel }}</h3>
                <span class="hr-hint" data-test="dictionary-usage">{{ activeDictionaryUsage }}</span>
              </div>
              <span class="hr-toolbar__spacer" />
              <el-button type="primary" :disabled="!settingsLoaded" data-test="add-dictionary-option" @click="openOptionDialog()">新增選項</el-button>
            </div>
            <el-table :data="itemSettings[activeDictionaryKey] || []" border data-test="dictionary-table">
              <el-table-column type="index" width="60" label="#" />
              <el-table-column prop="name" label="選項名稱" min-width="160" />
              <el-table-column prop="code" label="代碼" width="160" />
              <el-table-column label="排序" width="140">
                <template #default="{ $index }">
                  <el-button
                    link
                    type="primary"
                    :disabled="!settingsLoaded || optionSaving || $index === 0"
                    @click="moveOption(activeDictionaryKey, $index, -1)"
                  >上移</el-button>
                  <el-button
                    link
                    type="primary"
                    :disabled="!settingsLoaded || optionSaving || $index === (itemSettings[activeDictionaryKey] || []).length - 1"
                    @click="moveOption(activeDictionaryKey, $index, 1)"
                  >下移</el-button>
                </template>
              </el-table-column>
              <el-table-column label="操作" width="160">
                <template #default="{ $index }">
                  <el-button
                    link
                    type="primary"
                    :disabled="!settingsLoaded"
                    @click="openOptionDialog(activeDictionaryKey, $index)"
                  >編輯</el-button>
                  <el-button
                    link
                    type="danger"
                    :disabled="!settingsLoaded"
                    @click="removeOption(activeDictionaryKey, $index)"
                  >刪除</el-button>
                </template>
              </el-table-column>
              <template #empty>
                <span class="hr-empty">這個字典還沒有選項，請按右上角「新增選項」</span>
              </template>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="表單分類" name="form-category">
        <div class="hr-toolbar">
          <span class="hr-hint">簽核表單的分類，在「簽核流程設定」新增或編輯表單時選用。</span>
          <span class="hr-toolbar__spacer" />
          <el-button type="primary" :disabled="!settingsLoaded" @click="openCategoryDialog()">新增分類</el-button>
        </div>
        <el-table :data="formCategories" border>
          <el-table-column type="index" width="60" label="#" />
          <el-table-column prop="name" label="分類名稱" width="200" />
          <el-table-column prop="code" label="識別碼" width="180" />
          <el-table-column label="說明" min-width="160">
            <template #default="{ row }">
              {{ row.description || '—' }}
            </template>
          </el-table-column>
          <el-table-column label="使用中的表單" width="130">
            <template #default="{ row }">
              <span data-test="category-usage">{{ categoryUsageText(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="200">
            <template #default="{ row }">
              <el-button link type="primary" :disabled="!settingsLoaded" @click="openCategoryDialog('edit', row)">編輯</el-button>
              <el-button
                v-if="!row.builtin"
                link
                type="danger"
                :disabled="!settingsLoaded"
                @click="removeCategory(row)"
              >刪除</el-button>
              <el-tag v-else size="small" type="info" class="builtin-tag">內建，不能刪除</el-tag>
            </template>
          </el-table-column>
          <template #empty>
            <span class="hr-empty">尚未建立表單分類，請按右上角「新增分類」</span>
          </template>
        </el-table>
      </el-tab-pane>

      <el-tab-pane label="自訂欄位" name="custom-field">
        <div class="hr-toolbar">
          <span class="hr-hint">表單欄位的範本：在「簽核流程設定」新增表單欄位時，可以從「套用自訂欄位」直接帶入。</span>
          <span class="hr-toolbar__spacer" />
          <el-button type="primary" :disabled="!settingsLoaded" @click="openFieldDialog()">新增欄位</el-button>
        </div>
        <el-table :data="customFields" border>
          <el-table-column prop="label" label="欄位名稱" width="200" />
          <el-table-column prop="fieldKey" label="識別代碼" width="180" />
          <el-table-column prop="type" label="欄位型別" width="120">
            <template #default="{ row }">
              {{ fieldTypeMap[row.type] || row.type }}
            </template>
          </el-table-column>
          <el-table-column prop="required" label="必填" width="80">
            <template #default="{ row }">{{ row.required ? '是' : '否' }}</template>
          </el-table-column>
          <el-table-column prop="description" label="使用說明" min-width="160" />
          <el-table-column label="操作" width="160">
            <template #default="{ $index }">
              <el-button link type="primary" :disabled="!settingsLoaded" @click="openFieldDialog($index)">編輯</el-button>
              <el-button link type="danger" :disabled="!settingsLoaded" @click="removeField($index)">刪除</el-button>
            </template>
          </el-table-column>
          <template #empty>
            <span class="hr-empty">尚未建立自訂欄位，請按右上角「新增欄位」</span>
          </template>
        </el-table>
      </el-tab-pane>

      <!-- 排班權限（scheduleAccessMode）：主管是否因為是主管就能排班；排班人員在小單位設定 -->
      <el-tab-pane label="排班權限" name="schedule-access" lazy>
        <ScheduleAccessSetting />
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="optionDialogVisible" :title="optionDialogTitle" width="420px">
      <el-form :model="optionForm" label-width="100px" @submit.prevent>
        <el-form-item label="所屬字典">
          <el-select v-model="optionForm.dictionaryKey" :disabled="editingOptionIndex > -1">
            <el-option
              v-for="dict in dictionaryDefinitions"
              :key="dict.key"
              :label="dict.label"
              :value="dict.key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="選項名稱" required>
          <el-input v-model="optionForm.name" placeholder="顯示於下拉選單的名稱" />
        </el-form-item>
        <el-form-item label="選項代碼">
          <el-input v-model="optionForm.code" placeholder="不填則與名稱相同" />
          <div v-if="editingOptionIndex > -1" class="hr-hint" data-test="option-rename-hint">修改名稱或代碼不會更新已經填好的資料：選過這個選項的員工資料與申請單仍保留原本的文字。</div>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="optionDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="optionSaving" :disabled="!settingsLoaded" @click="saveOption">儲存</el-button>
        </span>
      </template>
    </el-dialog>

    <el-dialog v-model="categoryDialogVisible" :title="categoryDialogTitle" width="420px">
      <el-form :model="categoryForm" label-width="100px" @submit.prevent>
        <el-form-item label="分類名稱" required>
          <el-input v-model="categoryForm.name" placeholder="顯示名稱" />
        </el-form-item>
        <el-form-item label="識別碼">
          <el-input v-model="categoryForm.code" placeholder="不填則與名稱相同" :disabled="categoryCodeLocked" />
          <div v-if="categoryCodeLocked" class="hr-hint" data-test="category-code-locked">有 {{ categoryFormUsage }} 張表單使用這個分類；表單是用識別碼對應分類，所以識別碼不能修改。</div>
        </el-form-item>
        <el-form-item label="說明">
          <el-input v-model="categoryForm.description" type="textarea" :rows="3" placeholder="可補充分類用途或適用範圍" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="categoryDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="categorySaving" :disabled="!settingsLoaded" @click="saveCategory">儲存</el-button>
        </span>
      </template>
    </el-dialog>

    <el-dialog v-model="fieldDialogVisible" :title="editingFieldIndex > -1 ? '編輯自訂欄位' : '新增自訂欄位'" width="480px">
      <el-form :model="fieldForm" label-width="100px" @submit.prevent>
        <el-form-item label="欄位名稱" required>
          <el-input v-model="fieldForm.label" placeholder="顯示名稱" />
        </el-form-item>
        <el-form-item label="識別代碼" required>
          <el-input v-model="fieldForm.fieldKey" placeholder="英數字代碼" />
        </el-form-item>
        <el-form-item label="欄位型別">
          <el-select v-model="fieldForm.type">
            <el-option v-for="option in fieldTypeOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="是否必填">
          <el-switch v-model="fieldForm.required" />
        </el-form-item>
        <el-form-item label="使用說明">
          <el-input v-model="fieldForm.description" type="textarea" />
        </el-form-item>
        <el-form-item v-if="shouldShowOptionEditor" label="選項設定">
          <div class="options-editor">
            <div
              v-for="(option, index) in fieldForm.optionsList"
              :key="option.id"
              class="options-editor__row"
              data-test="option-row"
            >
              <el-row :gutter="8" align="middle">
                <el-col :span="9">
                  <el-input
                    v-model="option.name"
                    placeholder="顯示文字"
                    data-test="option-name"
                  />
                </el-col>
                <el-col :span="7">
                  <el-input
                    v-model="option.code"
                    placeholder="代碼"
                    data-test="option-code"
                  />
                </el-col>
                <el-col :span="8" class="options-editor__actions">
                  <el-button
                    link
                    type="primary"
                    :disabled="index === 0"
                    @click="moveOptionRow(index, -1)"
                    data-test="move-up"
                  >
                    上移
                  </el-button>
                  <el-button
                    link
                    type="primary"
                    :disabled="index === fieldForm.optionsList.length - 1"
                    @click="moveOptionRow(index, 1)"
                    data-test="move-down"
                  >
                    下移
                  </el-button>
                  <el-button
                    link
                    type="danger"
                    @click="removeOptionRow(index)"
                    data-test="remove-option"
                  >
                    刪除
                  </el-button>
                </el-col>
              </el-row>
            </div>
            <el-button
              plain
              size="small"
              @click="addOptionRow()"
              data-test="add-option"
            >
              新增選項
            </el-button>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="fieldDialogVisible = false">取消</el-button>
          <el-button type="primary" :loading="fieldSaving" :disabled="!settingsLoaded" @click="saveField">儲存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'
import { editableListToOptions, optionsToEditableList } from '../../utils/fieldOptions'
import PageHeader from '../PageHeader.vue'
import ScheduleAccessSetting from './ScheduleAccessSetting.vue'

const activeTab = ref('item-setting')
// 其他控制設定是否已從伺服器成功載入。載入失敗時畫面上是預設值，不能把它當成已儲存的資料存回去
const settingsLoaded = ref(false)
const settingsLoading = ref(false)
const settingsLoadFailed = ref(false)
const SETTINGS_NOT_LOADED_MESSAGE = '其他控制設定尚未成功載入，為避免覆蓋已儲存的資料，目前無法儲存或刪除，請先按「重新載入」'

function ensureSettingsLoaded() {
  if (settingsLoaded.value) return true
  ElMessage.error(SETTINGS_NOT_LOADED_MESSAGE)
  return false
}

// 伺服器回的錯誤文字（{ error } 或 { message }）；幾個只有英文欄位名稱的訊息換成畫面上的說法
const SERVER_MESSAGE_TEXT = {
  'code 已存在': '識別碼已經被其他分類使用，請換一個',
  'name 為必填欄位': '請輸入分類名稱',
  'code 為必填欄位': '請輸入識別碼',
}
function serverMessage(data, fallback) {
  const text = [data?.error, data?.message].find((value) => typeof value === 'string' && value.trim())
  if (!text) return fallback
  return SERVER_MESSAGE_TEXT[text.trim()] || text.trim()
}

const formCategories = ref([])
const categoryDialogVisible = ref(false)
const categoryDialogMode = ref('create')
const categorySaving = ref(false)
const categoryForm = ref({ id: '', name: '', code: '', description: '', builtin: false })
const categoryDialogTitle = computed(() => (categoryDialogMode.value === 'edit' ? '編輯分類' : '新增分類'))

// 每個分類有幾張簽核表單在用（表單的 category 存的是分類的識別碼）：{ [識別碼]: 張數 }；讀不到表單清單時是 null
const categoryUsage = ref(null)
async function loadCategoryUsage() {
  try {
    const res = await apiFetch('/api/approvals/forms', { method: 'GET' }, { autoRedirect: false })
    if (!res.ok) return
    const list = await res.json()
    if (!Array.isArray(list)) return
    const counts = {}
    list.forEach((form) => {
      const code = typeof form?.category === 'string' ? form.category.trim() : ''
      if (code) counts[code] = (counts[code] || 0) + 1
    })
    categoryUsage.value = counts
  } catch (error) {
    // 讀不到只是不顯示使用中的表單數
  }
}
function categoryUsageCount(category) {
  if (!categoryUsage.value || !category?.code) return null
  return categoryUsage.value[category.code] || 0
}
function categoryUsageText(category) {
  const count = categoryUsageCount(category)
  if (count === null) return '—'
  return count ? `${count} 張` : '沒有表單使用'
}
// 正在編輯的分類原本的識別碼有表單在用：識別碼不能改（改了之後那些表單就對不到分類）
const categoryFormUsage = computed(() => {
  if (categoryDialogMode.value !== 'edit' || !categoryForm.value.id) return 0
  const original = formCategories.value.find((item) => item.id === categoryForm.value.id)
  return categoryUsageCount(original) || 0
})
const categoryCodeLocked = computed(() => categoryFormUsage.value > 0)

const dictionaryDefinitions = ref([
  { key: 'C03', label: '職稱' },
  { key: 'C04', label: '執業職稱' },
  { key: 'C05', label: '語言能力' },
  { key: 'C06', label: '身障等級' },
  { key: 'C07', label: '身分類別' },
  { key: 'C08', label: '教育程度' },
  { key: 'C09', label: '緊急聯絡人稱謂' },
  { key: 'C10', label: '教育訓練積分類別' },
  { key: 'C12', label: '假別類別' },
  { key: 'C14', label: '津貼項目' }
])

// 每個字典用在哪裡（員工管理的欄位讀同一個代碼的字典；C12 是簽核表單裡連結字典的下拉欄位）
const DICTIONARY_USAGE = {
  C03: '員工管理的「職稱」',
  C04: '員工管理的「執業職稱」',
  C05: '員工管理的「語言能力」',
  C06: '員工管理的「身心障礙等級」',
  C07: '員工管理的「身分類別」',
  C08: '員工管理的「教育程度」',
  'C08-1': '員工管理的「畢業狀態」',
  C09: '員工管理的「緊急聯絡人稱謂」',
  C10: '員工管理的教育訓練「積分類別」',
  C12: '簽核表單裡連結這個字典的下拉欄位（例如請假單的假別）',
  C14: '員工管理的薪資「津貼項目」',
}
const DICTIONARY_EXTRA_LABELS = { 'C08-1': '畢業狀態' }

function pickFirstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.length) {
      return value
    }
  }
  return ''
}

function normalizeDictionaryOption(option) {
  if (typeof option === 'string') {
    return { name: option, code: option }
  }

  if (option && typeof option === 'object') {
    const name =
      typeof option.name === 'string'
        ? option.name
        : pickFirstString(option.label, option.text, option.display, option.value, option.code)
    const code =
      typeof option.code === 'string'
        ? option.code
        : pickFirstString(option.value, option.key, option.name, option.label)

    const finalName = name || code || ''
    const finalCode = code || name || ''
    return { ...option, name: finalName, code: finalCode }
  }

  return { name: '', code: '' }
}

function normalizeCategory(category) {
  if (!category || typeof category !== 'object') {
    return null
  }
  const nameSources = [category.name, category.label]
  const codeSources = [category.code, category.value]
  let name = ''
  for (const candidate of nameSources) {
    if (typeof candidate === 'string' && candidate.trim()) {
      name = candidate.trim()
      break
    }
  }
  let code = ''
  for (const candidate of codeSources) {
    if (typeof candidate === 'string' && candidate.trim()) {
      code = candidate.trim()
      break
    }
  }
  if (!code) code = name
  const id =
    typeof category.id === 'string' && category.id.trim()
      ? category.id.trim()
      : typeof category._id === 'string' && category._id.trim()
        ? category._id.trim()
        : code || name
  if (!id) {
    return null
  }
  return {
    id,
    name: name || code || id,
    code: code || name || id,
    description: typeof category.description === 'string' ? category.description : '',
    builtin: Boolean(category.builtin)
  }
}

const optionFieldTypes = ['select', 'checkbox', 'composite']
let optionRowSeed = 0

function createOptionRow(option = {}) {
  return {
    id: optionRowSeed++,
    name: typeof option.name === 'string' ? option.name : '',
    code: typeof option.code === 'string' ? option.code : ''
  }
}

function createOptionRowsFromOptions(options) {
  const list = optionsToEditableList(options)
  if (!list.length) {
    return []
  }
  return list.map(item => createOptionRow(item))
}

const defaultDictionaryOptions = {
  C03: [
    { name: '人資專員', code: 'HR-S' },
    { name: '工程師', code: 'ENG' }
  ],
  C04: [
    { name: '護理師', code: 'NURSE' },
    { name: '會計師', code: 'CPA' }
  ],
  C05: [
    { name: '英文 — 流利', code: 'EN_FL' },
    { name: '日文 — 進階', code: 'JP_ADV' }
  ],
  C06: [
    { name: '第一類中度', code: 'DISA_MID' },
    { name: '第二類輕度', code: 'DISA_LIGHT' }
  ],
  C07: [
    { name: '正式員工', code: 'FULLTIME' },
    { name: '約聘人員', code: 'CONTRACT' }
  ],
  C08: [
    { name: '博士', code: 'PHD' },
    { name: '大學', code: 'BACHELOR' }
  ],
  C09: [
    { name: '先生', code: 'MR' },
    { name: '女士', code: 'MS' }
  ],
  C10: [
    { name: '專業課程', code: 'PROFESSIONAL' },
    { name: '基礎課程', code: 'BASIC' }
  ],
  C12: [
    { name: '特休假', code: 'ANNUAL' },
    { name: '病假', code: 'SICK' }
  ],
  C14: [
    { name: '交通津貼', code: 'TRAFFIC' },
    { name: '餐費補助', code: 'MEAL' }
  ]
}

function createDefaultItemSettings() {
  const defaults = {}
  dictionaryDefinitions.value.forEach(dict => {
    const baseOptions = defaultDictionaryOptions[dict.key] || []
    defaults[dict.key] = baseOptions.map(option => normalizeDictionaryOption(option))
  })
  return defaults
}

const itemSettings = ref(createDefaultItemSettings())
const activeDictionaryKey = ref(dictionaryDefinitions.value[0]?.key ?? '')
const optionDialogVisible = ref(false)
const editingOptionIndex = ref(-1)
const optionSaving = ref(false)
const optionForm = ref({ dictionaryKey: activeDictionaryKey.value, name: '', code: '' })

const dictionaryLabelOf = (key) => dictionaryDefinitions.value.find(dict => dict.key === key)?.label || key || ''

const activeDictionaryLabel = computed(() => {
  return dictionaryDefinitions.value.find(dict => dict.key === activeDictionaryKey.value)?.label || ''
})

// 右邊標題下方的一行說明：用在哪裡，以及代碼（表單欄位名稱結尾寫「(代碼)」就會連結這個字典）
const activeDictionaryUsage = computed(() => {
  const key = activeDictionaryKey.value
  if (!key) return ''
  const usage = DICTIONARY_USAGE[key]
  return usage ? `用在：${usage}；代碼 ${key}` : `代碼 ${key}`
})

const optionDialogTitle = computed(() =>
  editingOptionIndex.value > -1 ? '編輯字典選項' : '新增字典選項'
)

const fieldTypeOptions = [
  { label: '文字輸入', value: 'text' },
  { label: '多行文字', value: 'textarea' },
  { label: '數字輸入', value: 'number' },
  { label: '單選選項', value: 'select' },
  { label: '複選', value: 'checkbox' },
  { label: '複合加選', value: 'composite' },
  { label: '日期', value: 'date' },
  { label: '時間區間', value: 'timeRange' },
  { label: '布林選項', value: 'boolean' }
]
const fieldTypeMap = fieldTypeOptions.reduce((map, option) => ({ ...map, [option.value]: option.label }), {})

const defaultCustomFields = [
  {
    label: '員工證字號',
    fieldKey: 'nationalId',
    type: 'text',
    category: 'employee',
    group: '基本資料',
    required: true,
    description: '供報稅與投保使用'
  },
  {
    label: '制服尺寸',
    fieldKey: 'uniformSize',
    type: 'select',
    category: 'employee',
    group: '報到資訊',
    required: false,
    description: '入職前通知行政備貨'
  },
  {
    label: '職稱選單 (C03)',
    fieldKey: 'C03',
    type: 'select',
    category: 'dictionary',
    group: '職務設定',
    required: true,
    description: '維護員工職稱清單'
  },
  {
    label: '執業職稱選單 (C04)',
    fieldKey: 'C04',
    type: 'select',
    category: 'dictionary',
    group: '職務設定',
    required: false,
    description: '提供專業人員執業職稱選項'
  },
  {
    label: '語言能力庫 (C05)',
    fieldKey: 'C05',
    type: 'composite',
    category: 'dictionary',
    group: '基本資料',
    required: false,
    description: '設定可勾選的語言能力與層級'
  },
  {
    label: '身障等級 (C06)',
    fieldKey: 'C06',
    type: 'select',
    category: 'dictionary',
    group: '基本資料',
    required: false,
    description: '維護身心障礙手冊等級'
  },
  {
    label: '身分類別 (C07)',
    fieldKey: 'C07',
    type: 'select',
    category: 'dictionary',
    group: '基本資料',
    required: false,
    description: '設定身份註記分類'
  },
  {
    label: '教育程度 (C08)',
    fieldKey: 'C08',
    type: 'select',
    category: 'dictionary',
    group: '學歷資料',
    required: false,
    description: '維護教育程度選單'
  },
  {
    label: '緊急聯絡人稱謂 (C09)',
    fieldKey: 'C09',
    type: 'select',
    category: 'dictionary',
    group: '聯絡資訊',
    required: false,
    description: '提供緊急聯絡人稱謂選項'
  },
  {
    label: '教育訓練積分類別 (C10)',
    fieldKey: 'C10',
    type: 'select',
    category: 'dictionary',
    group: '教育訓練',
    required: false,
    description: '維護教育訓練積分類別'
  },
  {
    label: '假別類別 (C12)',
    fieldKey: 'C12',
    type: 'select',
    category: 'dictionary',
    group: '假別設定',
    required: true,
    description: '維護假別類別與對應設定'
  },
  {
    label: '津貼項目 (C14)',
    fieldKey: 'C14',
    type: 'select',
    category: 'dictionary',
    group: '薪資設定',
    required: false,
    description: '維護津貼或補貼項目'
  }
]

const customFields = ref([...defaultCustomFields])
// 自訂欄位的版本（GET /api/other-control-settings 的 X-Custom-Fields-Version 標頭）：儲存時帶回去，
// 別人在這之間存過時伺服器回 409 CUSTOM_FIELDS_CONFLICT，不會蓋掉別人的修改。舊版伺服器沒有這個標頭時是 null（不帶）
const customFieldsVersion = ref(null)
const CUSTOM_FIELDS_CONFLICT_MESSAGE = '自訂欄位剛被其他人修改，已重新載入最新內容，請確認後再修改一次'

function readCustomFieldsVersion(res) {
  const value = res?.headers?.get?.('X-Custom-Fields-Version')
  return typeof value === 'string' && value ? value : null
}

// 整份自訂欄位送出（PUT 是整份取代），帶上版本；成功時記下新版本。
// 回傳 { ok, conflict, message }：conflict 時已重新載入設定，畫面上是別人存好的最新內容
async function putCustomFields(fallbackMessage) {
  const body = { customFields: customFields.value }
  if (customFieldsVersion.value) body.version = customFieldsVersion.value
  const res = await apiFetch(
    '/api/other-control-settings/custom-fields',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    },
    { autoRedirect: false }
  )
  if (res.ok) {
    customFieldsVersion.value = readCustomFieldsVersion(res) || customFieldsVersion.value
    return { ok: true }
  }
  let responseText = ''
  try {
    responseText = await res.text()
  } catch (readError) {
    console.warn('讀取自訂欄位回應失敗：', readError)
  }
  let data = null
  try {
    data = responseText ? JSON.parse(responseText) : null
  } catch (parseError) {
    // 不是 JSON：直接顯示文字
  }
  if (res.status === 409 && data?.code === 'CUSTOM_FIELDS_CONFLICT') {
    return { ok: false, conflict: true, message: CUSTOM_FIELDS_CONFLICT_MESSAGE }
  }
  return { ok: false, message: data ? serverMessage(data, fallbackMessage) : (responseText || fallbackMessage) }
}
const fieldDialogVisible = ref(false)
const fieldSaving = ref(false)
const editingFieldIndex = ref(-1)
const fieldForm = ref({
  label: '',
  fieldKey: '',
  type: 'text',
  category: '',
  group: '',
  required: false,
  description: '',
  options: undefined,
  optionsList: []
})

const shouldShowOptionEditor = computed(() => optionFieldTypes.includes(fieldForm.value.type))

function ensureOptionRows() {
  if (!Array.isArray(fieldForm.value.optionsList)) {
    fieldForm.value.optionsList = []
  }
  if (!shouldShowOptionEditor.value) {
    return
  }
  if (!fieldForm.value.optionsList.length) {
    fieldForm.value.optionsList.push(createOptionRow())
  }
}

watch(
  () => fieldForm.value.type,
  type => {
    if (optionFieldTypes.includes(type)) {
      ensureOptionRows()
    }
  }
)

function addOptionRow() {
  if (!Array.isArray(fieldForm.value.optionsList)) {
    fieldForm.value.optionsList = []
  }
  fieldForm.value.optionsList.push(createOptionRow())
}

function removeOptionRow(index) {
  if (!Array.isArray(fieldForm.value.optionsList) || index < 0) {
    return
  }
  fieldForm.value.optionsList.splice(index, 1)
  if (shouldShowOptionEditor.value && fieldForm.value.optionsList.length === 0) {
    addOptionRow()
  }
}

function moveOptionRow(index, offset) {
  if (!Array.isArray(fieldForm.value.optionsList)) {
    return
  }
  const newIndex = index + offset
  if (newIndex < 0 || newIndex >= fieldForm.value.optionsList.length) {
    return
  }
  const list = fieldForm.value.optionsList
  const [item] = list.splice(index, 1)
  list.splice(newIndex, 0, item)
}

onMounted(() => {
  loadSettings()
  loadFormCategories()
  loadCategoryUsage()
})

async function loadSettings() {
  settingsLoading.value = true
  try {
    const res = await apiFetch('/api/other-control-settings', { method: 'GET' }, { autoRedirect: false })
    if (!res.ok) {
      throw new Error(`伺服器回應 ${res.status}`)
    }
    const data = await res.json()
    customFieldsVersion.value = readCustomFieldsVersion(res)
    if (Array.isArray(data.customFields) && data.customFields.length) {
      customFields.value = data.customFields
    } else {
      customFields.value = [...defaultCustomFields]
    }
    if (data.itemSettings && typeof data.itemSettings === 'object') {
      Object.keys(data.itemSettings).forEach(key => {
        if (!dictionaryDefinitions.value.some(dict => dict.key === key)) {
          dictionaryDefinitions.value.push({ key, label: DICTIONARY_EXTRA_LABELS[key] || key })
        }
      })
      const merged = createDefaultItemSettings()
      dictionaryDefinitions.value.forEach(dict => {
        if (Array.isArray(data.itemSettings[dict.key])) {
          merged[dict.key] = data.itemSettings[dict.key].map(option => normalizeDictionaryOption(option))
        }
      })
      itemSettings.value = merged
      if (!dictionaryDefinitions.value.some(dict => dict.key === activeDictionaryKey.value)) {
        activeDictionaryKey.value = dictionaryDefinitions.value[0]?.key ?? ''
      }
    } else {
      itemSettings.value = createDefaultItemSettings()
    }
    if (Array.isArray(data.formCategories)) {
      const normalized = data.formCategories.map(normalizeCategory).filter(Boolean)
      if (normalized.length) {
        formCategories.value = normalized
      }
    }
    settingsLoaded.value = true
    settingsLoadFailed.value = false
  } catch (error) {
    // 載入失敗時畫面上仍是預設內容：不開放儲存 / 刪除，並顯示警告與重新載入按鈕
    settingsLoaded.value = false
    settingsLoadFailed.value = true
    console.warn('載入其他控制設定失敗：', error)
  } finally {
    settingsLoading.value = false
  }
}

// 載入失敗警告上的「重新載入」：設定與表單分類一起重讀，成功後警告消失、儲存功能恢復
async function reloadSettings() {
  if (settingsLoading.value) return
  await Promise.all([loadSettings(), loadFormCategories()])
}

async function loadFormCategories() {
  try {
    const res = await apiFetch('/api/other-control-settings/form-categories', { method: 'GET' }, { autoRedirect: false })
    if (!res.ok) {
      return
    }
    const list = await res.json()
    if (!Array.isArray(list)) {
      return
    }
    const normalized = list.map(normalizeCategory).filter(Boolean)
    formCategories.value = normalized
  } catch (error) {
    console.warn('載入表單分類失敗：', error)
  }
}

function openCategoryDialog(mode = 'create', category = null) {
  categoryDialogMode.value = mode
  if (mode === 'edit' && category) {
    categoryForm.value = {
      id: category.id,
      name: category.name,
      code: category.code,
      description: category.description || '',
      builtin: !!category.builtin
    }
  } else {
    categoryForm.value = { id: '', name: '', code: '', description: '', builtin: false }
  }
  categoryDialogVisible.value = true
}

async function saveCategory() {
  if (!ensureSettingsLoaded()) return
  if (categorySaving.value) return
  const name = (categoryForm.value.name || '').trim()
  const code = (categoryForm.value.code || '').trim() || name
  if (!name || !code) {
    ElMessage.warning('分類名稱與識別碼為必填')
    return
  }

  const payload = {
    name,
    code,
    description: (categoryForm.value.description || '').trim()
  }

  const isEdit = categoryDialogMode.value === 'edit' && categoryForm.value.id
  const url = isEdit
    ? `/api/other-control-settings/form-categories/${categoryForm.value.id}`
    : '/api/other-control-settings/form-categories'

  categorySaving.value = true
  try {
    const res = await apiFetch(
      url,
      {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      { autoRedirect: false }
    )

    const responseText = await res.text().catch(() => '')
    let responseData = null
    if (responseText) {
      try {
        responseData = JSON.parse(responseText)
      } catch (error) {
        // ignore parse error
      }
    }

    if (!res.ok) {
      throw new Error(serverMessage(responseData, responseText || '儲存分類失敗，請稍後再試'))
    }

    const normalized = normalizeCategory(responseData)
    if (normalized) {
      if (isEdit) {
        const index = formCategories.value.findIndex(item => item.id === normalized.id)
        if (index > -1) {
          formCategories.value.splice(index, 1, normalized)
        }
      } else {
        formCategories.value.push(normalized)
      }
    } else {
      await loadFormCategories()
    }

    categoryDialogVisible.value = false
    const message = isEdit ? '已更新分類' : '已新增分類'
    ElMessage.success(message)
  } catch (error) {
    const message = error?.message || '儲存分類失敗，請稍後再試'
    ElMessage.error(message)
  } finally {
    categorySaving.value = false
  }
}

async function removeCategory(category) {
  if (!ensureSettingsLoaded()) return
  if (!category?.id) return
  if (category.builtin) {
    ElMessage.warning('內建分類不可刪除')
    return
  }
  const usage = categoryUsageCount(category)
  const consequence = usage
    ? `目前有 ${usage} 張表單使用這個分類；刪除後這些表單不會被刪除，但分類會顯示成識別碼「${category.code}」，需要到「簽核流程設定」改選其他分類。`
    : '刪除後新增或編輯表單時就不能再選這個分類。'
  try {
    await ElMessageBox.confirm(
      `確定要刪除分類「${category.name || ''}」嗎？${consequence}`,
      '刪除分類',
      { type: 'warning', confirmButtonText: '刪除', cancelButtonText: '取消' }
    )
  } catch (error) {
    return
  }

  try {
    const res = await apiFetch(
      `/api/other-control-settings/form-categories/${category.id}`,
      { method: 'DELETE' },
      { autoRedirect: false }
    )

    const responseText = await res.text().catch(() => '')
    if (!res.ok) {
      let message = '刪除分類失敗，請稍後再試'
      if (responseText) {
        try {
          message = serverMessage(JSON.parse(responseText), message)
        } catch (error) {
          message = responseText
        }
      }
      throw new Error(message)
    }

    formCategories.value = formCategories.value.filter(item => item.id !== category.id)
    ElMessage.success('已刪除分類')
  } catch (error) {
    const message = error?.message || '刪除分類失敗，請稍後再試'
    ElMessage.error(message)
  }
}

// payload：要送出的字典（{ 代碼: 選項陣列 }）。伺服器只取代有送來的字典，其餘不動，
// 所以新增、編輯、刪除、排序一個選項時只送那一個字典：別人剛改過的其他字典、畫面上還沒存過的預設內容都不會被寫回去
async function saveItemSettings(successMessage = '已儲存字典項目設定', payload = itemSettings.value) {
  if (!ensureSettingsLoaded()) return false
  const fallbackMessage = '儲存字典項目時發生問題，請稍後再試'
  try {
    const res = await apiFetch(
      '/api/other-control-settings/item-settings',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      },
      { autoRedirect: false }
    )

    const responseText = await res.text().catch(() => '')
    let responseData = null
    if (responseText) {
      try {
        responseData = JSON.parse(responseText)
      } catch (parseError) {
        console.warn('解析儲存字典項目回應時發生錯誤：', parseError)
      }
    }

    if (!res.ok) {
      throw new Error(serverMessage(responseData, fallbackMessage))
    }

    if (successMessage) {
      ElMessage.success(successMessage)
    }

    return responseData ?? true
  } catch (error) {
    ElMessage.error(error?.message || fallbackMessage)
    return false
  }
}

function openOptionDialog(dictionaryKey = activeDictionaryKey.value, index = -1) {
  if (dictionaryKey) {
    activeDictionaryKey.value = dictionaryKey
  }
  editingOptionIndex.value = index
  if (index > -1) {
    const target = itemSettings.value[dictionaryKey]?.[index]
    if (target) {
      optionForm.value = {
        dictionaryKey,
        name: target.name,
        code: target.code
      }
    }
  } else {
    optionForm.value = {
      dictionaryKey: dictionaryKey || dictionaryDefinitions.value[0]?.key || '',
      name: '',
      code: ''
    }
  }
  optionDialogVisible.value = true
}

// 把某個字典換成新的選項陣列並只儲存這個字典；失敗時畫面回到原本的內容
async function saveDictionary(dictionaryKey, options, successMessage) {
  const previousState = JSON.parse(JSON.stringify(itemSettings.value))
  itemSettings.value = { ...previousState, [dictionaryKey]: options }
  // 只有名稱（代碼與名稱相同、沒有其他屬性）的選項照原本的格式存成文字，不把整個字典改寫成物件
  const stored = options.map((option) => {
    const plain = option && typeof option === 'object'
      && Object.keys(option).every((key) => key === 'name' || key === 'code')
      && option.name === option.code
    return plain ? option.name : option
  })
  const saved = await saveItemSettings(successMessage, { [dictionaryKey]: stored })
  if (!saved) itemSettings.value = previousState
  return saved
}

async function saveOption() {
  if (!ensureSettingsLoaded()) return
  if (optionSaving.value) return
  const name = String(optionForm.value.name ?? '').trim()
  // 代碼沒填就和名稱相同
  const code = String(optionForm.value.code ?? '').trim() || name
  const dictionaryKey = optionForm.value.dictionaryKey
  if (!name || !dictionaryKey) {
    ElMessage.warning('請完整填寫字典與選項資訊')
    return
  }
  const current = JSON.parse(JSON.stringify(itemSettings.value[dictionaryKey] || []))
  const editing = editingOptionIndex.value > -1
  // 同一個字典裡名稱或代碼重複時，選單上分不出是哪一個，存進員工資料後也對不回來
  const duplicated = current.find((option, index) => (
    !(editing && index === editingOptionIndex.value) && (option?.name === name || option?.code === code)
  ))
  if (duplicated) {
    ElMessage.warning(`「${dictionaryLabelOf(dictionaryKey)}」已經有名稱或代碼相同的選項「${duplicated.name}」`)
    return
  }
  const options = [...current]
  if (editing) {
    // 保留這個選項原本的其他屬性（例如語言能力的等級清單），只換名稱與代碼
    const existing = options[editingOptionIndex.value] && typeof options[editingOptionIndex.value] === 'object'
      ? options[editingOptionIndex.value]
      : {}
    const next = { ...existing, name, code }
    if ('label' in existing) next.label = name
    if ('value' in existing) next.value = code
    options.splice(editingOptionIndex.value, 1, next)
  } else {
    options.push({ name, code })
  }
  optionSaving.value = true
  try {
    const saved = await saveDictionary(dictionaryKey, options, editing ? '已更新字典選項' : '已新增字典選項')
    if (saved) optionDialogVisible.value = false
  } finally {
    optionSaving.value = false
  }
}

async function removeOption(dictionaryKey, index) {
  if (!ensureSettingsLoaded()) return
  if (!dictionaryKey || index < 0) return
  const target = itemSettings.value[dictionaryKey]?.[index]
  try {
    await ElMessageBox.confirm(
      `確定要刪除「${dictionaryLabelOf(dictionaryKey)}」的選項「${target?.name || ''}」嗎？刪除後選單不再出現這個選項；已經選用它的員工資料或申請單不會被修改，仍保留原本的文字。`,
      '刪除選項',
      { type: 'warning', confirmButtonText: '刪除', cancelButtonText: '取消' }
    )
  } catch (error) {
    return
  }
  const options = JSON.parse(JSON.stringify(itemSettings.value[dictionaryKey] || []))
  options.splice(index, 1)
  await saveDictionary(dictionaryKey, options, '已刪除字典選項')
}

// 調整選項順序（下拉選單照這個順序顯示）
async function moveOption(dictionaryKey, index, offset) {
  if (!ensureSettingsLoaded()) return
  if (optionSaving.value) return
  const options = JSON.parse(JSON.stringify(itemSettings.value[dictionaryKey] || []))
  const target = index + offset
  if (index < 0 || index >= options.length || target < 0 || target >= options.length) return
  const [item] = options.splice(index, 1)
  options.splice(target, 0, item)
  optionSaving.value = true
  try {
    await saveDictionary(dictionaryKey, options, '已調整順序')
  } finally {
    optionSaving.value = false
  }
}

function openFieldDialog(index = -1) {
  editingFieldIndex.value = index
  if (index > -1) {
    const targetField = customFields.value[index] || {}
    fieldForm.value = {
      ...targetField,
      options: targetField.options,
      optionsList: createOptionRowsFromOptions(targetField.options)
    }
  } else {
    fieldForm.value = {
      label: '',
      fieldKey: '',
      type: 'text',
      category: '',
      group: '',
      required: false,
      description: '',
      options: undefined,
      optionsList: []
    }
  }
  ensureOptionRows()
  fieldDialogVisible.value = true
}

async function saveField() {
  if (!ensureSettingsLoaded()) return
  if (fieldSaving.value) return
  if (!fieldForm.value.label || !fieldForm.value.fieldKey) {
    ElMessage.warning('欄位名稱與識別代碼為必填')
    return
  }
  // 識別代碼重複時，「套用自訂欄位」的選單分不出是哪一個
  const fieldKey = String(fieldForm.value.fieldKey).trim()
  const duplicated = customFields.value.find((field, index) => (
    index !== editingFieldIndex.value && String(field?.fieldKey ?? '').trim() === fieldKey
  ))
  if (duplicated) {
    ElMessage.warning(`識別代碼「${fieldKey}」已經被「${duplicated.label || fieldKey}」使用，請換一個`)
    return
  }
  const previousFields = JSON.parse(JSON.stringify(customFields.value))
  const shouldIncludeOptions = optionFieldTypes.includes(fieldForm.value.type)
  let parsedOptions
  if (shouldIncludeOptions) {
    parsedOptions = editableListToOptions(fieldForm.value.optionsList)
  }

  const sanitizedField = { ...fieldForm.value }
  if (shouldIncludeOptions && parsedOptions !== undefined) {
    sanitizedField.options = parsedOptions
  } else {
    delete sanitizedField.options
  }
  delete sanitizedField.optionsList

  const updatedField = JSON.parse(JSON.stringify(sanitizedField))

  if (editingFieldIndex.value > -1) {
    customFields.value.splice(editingFieldIndex.value, 1, updatedField)
  } else {
    customFields.value.push(updatedField)
  }
  fieldSaving.value = true
  try {
    const result = await putCustomFields('儲存自訂欄位失敗，請稍後再試')
    if (result.conflict) {
      // 別人剛存過：重新載入最新內容（這次的修改沒有存），對話框留著讓使用者重新決定
      customFields.value = previousFields
      ElMessage.error(result.message)
      await loadSettings()
      return
    }
    if (!result.ok) throw new Error(result.message)

    fieldDialogVisible.value = false
    editingFieldIndex.value = -1
    ElMessage.success('已更新自訂欄位')
  } catch (error) {
    customFields.value = previousFields
    const message = error?.message || '儲存自訂欄位失敗，請稍後再試'
    ElMessage.error(message)
  } finally {
    fieldSaving.value = false
  }
}

async function removeField(index) {
  if (!ensureSettingsLoaded()) return
  try {
    await ElMessageBox.confirm(
      `確定要刪除自訂欄位「${customFields.value[index]?.label || ''}」嗎？刪除後新增表單欄位時不能再套用它；已經套用到表單的欄位不受影響。`,
      '刪除自訂欄位',
      { type: 'warning', confirmButtonText: '刪除', cancelButtonText: '取消' }
    )
  } catch (error) {
    // 取消
    return
  }
  const previousFields = JSON.parse(JSON.stringify(customFields.value))
  customFields.value.splice(index, 1)
  try {
    const result = await putCustomFields('刪除自訂欄位失敗，請稍後再試')
    if (result.conflict) {
      customFields.value = previousFields
      ElMessage.error(result.message)
      await loadSettings()
      return
    }
    if (!result.ok) throw new Error(result.message)

    ElMessage.success('已刪除自訂欄位')
  } catch (error) {
    customFields.value = previousFields
    const message = error?.message || '刪除自訂欄位失敗，請稍後再試'
    ElMessage.error(message)
  }
}
</script>

<style scoped>
.other-control-setting {
  padding: 0;
}

.load-alert {
  margin-bottom: 12px;
}

.load-alert__body {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
}

/* 字典項目：左邊選字典，右邊是它的選項 */
.dictionary-layout {
  display: flex;
  align-items: flex-start;
  gap: var(--hr-space-md);
}

.dictionary-list {
  flex: 0 0 220px;
  margin: 0;
  padding: 4px;
  list-style: none;
  border: 1px solid var(--hr-gray-200);
  border-radius: var(--hr-radius-md);
  background: var(--hr-white);
}

.dictionary-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  min-height: 40px;
  padding: 8px 12px;
  border: 0;
  border-radius: var(--hr-radius-sm);
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: var(--hr-gray-700);
  text-align: left;
  cursor: pointer;
}

.dictionary-item:hover {
  background: var(--hr-gray-50);
}

.dictionary-item.is-active {
  background: var(--hr-gray-100);
  color: var(--hr-primary);
  font-weight: var(--hr-font-weight-semibold);
}

.dictionary-item__count {
  flex: 0 0 auto;
  font-size: 12px;
  font-weight: var(--hr-font-weight-normal);
  color: var(--hr-gray-500);
}

.dictionary-detail {
  flex: 1 1 auto;
  min-width: 0;
}

.dictionary-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dictionary-title {
  margin: 0;
  font-size: var(--hr-font-size-base);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-900);
}

.builtin-tag {
  margin-left: 12px;
}

.options-editor {
  width: 100%;
}

.options-editor__row {
  margin-bottom: 8px;
}

.options-editor__actions {
  white-space: nowrap;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 767px) {
  .dictionary-layout {
    flex-direction: column;
    align-items: stretch;
  }

  /* 手機：字典名稱排成可以左右滑動的一列 */
  .dictionary-list {
    flex: 0 0 auto;
    display: flex;
    overflow-x: auto;
  }

  .dictionary-item {
    width: auto;
    min-height: 44px;
    white-space: nowrap;
  }
}
</style>
