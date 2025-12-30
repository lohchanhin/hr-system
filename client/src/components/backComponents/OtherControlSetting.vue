<template>
  <div class="other-control-setting">
    <h2>其他控制設定</h2>

    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane label="字典項目" name="item-setting">
        <div class="tab-content">
          <el-alert
            title="維護人資字典選項，確保報到與流程表單可即時使用最新的項目"
            type="info"
            show-icon
            class="info-alert"
          />
          <div class="dictionary-action-row">
            <div class="dictionary-header">
              <h3>{{ activeDictionaryLabel }}</h3>
              <span class="hint">字典代碼：{{ activeDictionaryKey }}</span>
            </div>
            <div class="dictionary-controls">
              <el-select v-model="activeDictionaryKey" size="small" class="dictionary-select">
                <el-option
                  v-for="dict in dictionaryDefinitions"
                  :key="dict.key"
                  :label="`${dict.key} ${dict.label}`"
                  :value="dict.key"
                />
              </el-select>
              <el-button type="primary" size="small" @click="openOptionDialog()">新增選項</el-button>
            </div>
          </div>
          <el-table :data="itemSettings[activeDictionaryKey] || []" border>
            <el-table-column type="index" width="60" label="#" />
            <el-table-column prop="name" label="選項名稱" />
            <el-table-column prop="code" label="代碼" width="160" />
            <el-table-column label="操作" width="200">
              <template #default="{ $index }">
                <el-button size="small" @click="openOptionDialog(activeDictionaryKey, $index)">編輯</el-button>
                <el-button
                  size="small"
                  type="danger"
                  @click="removeOption(activeDictionaryKey, $index)"
                >刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="表單分類" name="form-category">
        <div class="tab-content">
          <el-alert
            title="維護簽核表單分類，提供前台建立與過濾流程樣板時使用"
            type="info"
            show-icon
            class="info-alert"
          />
          <div class="list-action-row">
            <el-button type="primary" @click="openCategoryDialog()">新增分類</el-button>
          </div>
          <el-table :data="formCategories" border>
            <el-table-column type="index" width="60" label="#" />
            <el-table-column prop="name" label="分類名稱" width="200" />
            <el-table-column prop="code" label="識別碼" width="180" />
            <el-table-column label="說明">
              <template #default="{ row }">
                {{ row.description || '—' }}
              </template>
            </el-table-column>
            <el-table-column label="狀態" width="120">
              <template #default="{ row }">
                <el-tag v-if="row.builtin" size="small" type="info">內建</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220">
              <template #default="{ row }">
                <el-button size="small" @click="openCategoryDialog('edit', row)">編輯</el-button>
                <el-button
                  size="small"
                  type="danger"
                  :disabled="row.builtin"
                  @click="removeCategory(row)"
                >刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <el-tab-pane label="自訂欄位" name="custom-field">
        <div class="tab-content">
          <el-alert
            title="可用於員工資料或流程表單的額外欄位"
            type="info"
            show-icon
            class="info-alert"
          />
          <div class="list-action-row">
            <el-button type="primary" @click="openFieldDialog()">新增欄位</el-button>
          </div>
          <el-table :data="customFields" border>
            <el-table-column prop="label" label="欄位名稱" width="180" />
            <el-table-column prop="fieldKey" label="識別代碼" width="200" />
            <el-table-column prop="type" label="欄位型別" width="120">
              <template #default="{ row }">
                {{ fieldTypeMap[row.type] || row.type }}
              </template>
            </el-table-column>
            <el-table-column prop="required" label="必填" width="100">
              <template #default="{ row }">{{ row.required ? '是' : '否' }}</template>
            </el-table-column>
            <el-table-column prop="description" label="使用說明" />
            <el-table-column label="操作" width="180">
              <template #default="{ $index }">
                <el-button size="small" @click="openFieldDialog($index)">編輯</el-button>
                <el-button size="small" type="danger" @click="removeField($index)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="optionDialogVisible" :title="optionDialogTitle" width="420px">
      <el-form :model="optionForm" label-width="100px">
        <el-form-item label="所屬字典">
          <el-select v-model="optionForm.dictionaryKey" :disabled="editingOptionIndex > -1">
            <el-option
              v-for="dict in dictionaryDefinitions"
              :key="dict.key"
              :label="`${dict.key} ${dict.label}`"
              :value="dict.key"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="選項名稱">
          <el-input v-model="optionForm.name" placeholder="顯示於下拉選單的名稱" />
        </el-form-item>
        <el-form-item label="選項代碼">
          <el-input v-model="optionForm.code" placeholder="系統對應的代碼" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="optionDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveOption">儲存</el-button>
        </span>
      </template>
    </el-dialog>

    <el-dialog v-model="categoryDialogVisible" :title="categoryDialogTitle" width="420px">
      <el-form :model="categoryForm" label-width="100px">
        <el-form-item label="分類名稱">
          <el-input v-model="categoryForm.name" placeholder="顯示名稱" />
        </el-form-item>
        <el-form-item label="識別碼">
          <el-input v-model="categoryForm.code" placeholder="資料庫儲存用代碼" />
        </el-form-item>
        <el-form-item label="說明">
          <el-input v-model="categoryForm.description" type="textarea" :rows="3" placeholder="可補充分類用途或適用範圍" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="categoryDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveCategory">儲存</el-button>
        </span>
      </template>
    </el-dialog>

    <el-dialog v-model="fieldDialogVisible" title="自訂欄位" width="480px">
      <el-form :model="fieldForm" label-width="100px">
        <el-form-item label="欄位名稱">
          <el-input v-model="fieldForm.label" placeholder="顯示名稱" />
        </el-form-item>
        <el-form-item label="識別代碼">
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
                <el-col :span="10">
                  <el-input
                    v-model="option.name"
                    placeholder="顯示文字"
                    data-test="option-name"
                  />
                </el-col>
                <el-col :span="10">
                  <el-input
                    v-model="option.code"
                    placeholder="代碼"
                    data-test="option-code"
                  />
                </el-col>
                <el-col :span="4" class="options-editor__actions">
                  <el-button
                    link
                    type="primary"
                    :disabled="index === 0"
                    @click="moveOptionRow(index, -1)"
                    data-test="move-up"
                  >
                    上
                  </el-button>
                  <el-button
                    link
                    type="primary"
                    :disabled="index === fieldForm.optionsList.length - 1"
                    @click="moveOptionRow(index, 1)"
                    data-test="move-down"
                  >
                    下
                  </el-button>
                  <el-button
                    link
                    type="danger"
                    @click="removeOptionRow(index)"
                    data-test="remove-option"
                  >
                    刪
                  </el-button>
                </el-col>
              </el-row>
            </div>
            <el-button
              type="primary"
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
          <el-button type="primary" @click="saveField">儲存</el-button>
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

const activeTab = ref('item-setting')
const formCategories = ref([])
const categoryDialogVisible = ref(false)
const categoryDialogMode = ref('create')
const categoryForm = ref({ id: '', name: '', code: '', description: '', builtin: false })
const categoryDialogTitle = computed(() => (categoryDialogMode.value === 'edit' ? '編輯分類' : '新增分類'))

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
const optionForm = ref({ dictionaryKey: activeDictionaryKey.value, name: '', code: '' })

const activeDictionaryLabel = computed(() => {
  return dictionaryDefinitions.value.find(dict => dict.key === activeDictionaryKey.value)?.label || ''
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
const fieldDialogVisible = ref(false)
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
})

async function loadSettings() {
  try {
    const res = await apiFetch('/api/other-control-settings', { method: 'GET' }, { autoRedirect: false })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data.customFields) && data.customFields.length) {
        customFields.value = data.customFields
      } else {
        customFields.value = [...defaultCustomFields]
      }
      if (data.itemSettings && typeof data.itemSettings === 'object') {
        Object.keys(data.itemSettings).forEach(key => {
          if (!dictionaryDefinitions.value.some(dict => dict.key === key)) {
            dictionaryDefinitions.value.push({ key, label: key })
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
    }
  } catch (error) {
    console.warn('載入其他控制設定失敗：', error)
  }
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
      const message = responseData?.error || responseData?.message || responseText || '儲存分類失敗，請稍後再試'
      throw new Error(message)
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
  }
}

async function removeCategory(category) {
  if (!category?.id) return
  if (category.builtin) {
    ElMessage.warning('內建分類不可刪除')
    return
  }
  try {
    await ElMessageBox.confirm('確定要刪除此分類嗎？', '提醒', { type: 'warning' })
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
          const data = JSON.parse(responseText)
          message = data?.error || data?.message || message
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

async function saveItemSettings(successMessage = '已儲存字典項目設定') {
  const payload = itemSettings.value
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
      const errorMessage = responseData?.message || fallbackMessage
      if (responseText && !responseData?.message) {
        console.error('儲存字典項目失敗回應：', responseText)
      }
      throw new Error(errorMessage)
    }

    if (successMessage) {
      ElMessage.success(successMessage)
    }

    return responseData ?? true
  } catch (error) {
    console.error('儲存字典項目時發生例外：', error)
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

async function saveOption() {
  if (!optionForm.value.name || !optionForm.value.code || !optionForm.value.dictionaryKey) {
    ElMessage.warning('請完整填寫字典與選項資訊')
    return
  }
  const previousState = JSON.parse(JSON.stringify(itemSettings.value))
  const dictionaryKey = optionForm.value.dictionaryKey
  const options = [...(previousState[dictionaryKey] || [])]
  if (editingOptionIndex.value > -1) {
    options.splice(editingOptionIndex.value, 1, {
      name: optionForm.value.name,
      code: optionForm.value.code
    })
  } else {
    options.push({ name: optionForm.value.name, code: optionForm.value.code })
  }
  itemSettings.value = { ...previousState, [dictionaryKey]: options }
  const message = editingOptionIndex.value > -1 ? '已更新字典選項' : '已新增字典選項'
  const saved = await saveItemSettings(message)
  if (saved) {
    optionDialogVisible.value = false
  } else {
    itemSettings.value = previousState
  }
}

async function removeOption(dictionaryKey, index) {
  if (!dictionaryKey || index < 0) return
  try {
    await ElMessageBox.confirm('確定要刪除此選項嗎？', '提醒', { type: 'warning' })
  } catch (error) {
    return
  }
  const previousState = JSON.parse(JSON.stringify(itemSettings.value))
  const options = [...(previousState[dictionaryKey] || [])]
  options.splice(index, 1)
  itemSettings.value = { ...previousState, [dictionaryKey]: options }
  const saved = await saveItemSettings('已刪除字典選項')
  if (!saved) {
    itemSettings.value = previousState
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
  if (!fieldForm.value.label || !fieldForm.value.fieldKey) {
    ElMessage.warning('欄位名稱與識別代碼為必填')
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
  try {
    const res = await apiFetch(
      '/api/other-control-settings/custom-fields',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customFields: customFields.value })
      },
      { autoRedirect: false }
    )

    if (!res.ok) {
      let responseText = ''
      try {
        responseText = await res.text()
      } catch (readError) {
        console.warn('讀取儲存自訂欄位回應失敗：', readError)
      }

      let errorMessage = '儲存自訂欄位失敗，請稍後再試'
      if (responseText) {
        try {
          const data = JSON.parse(responseText)
          if (data?.message) {
            errorMessage = data.message
          }
        } catch (parseError) {
          errorMessage = responseText
        }
      }

      throw new Error(errorMessage)
    }

    fieldDialogVisible.value = false
    editingFieldIndex.value = -1
    ElMessage.success('已更新自訂欄位')
  } catch (error) {
    customFields.value = previousFields
    const message = error?.message || '儲存自訂欄位失敗，請稍後再試'
    ElMessage.error(message)
  }
}

async function removeField(index) {
  try {
    await ElMessageBox.confirm('確定要刪除此欄位嗎？', '提醒', { type: 'warning' })
  } catch (error) {
    // 取消
    return
  }
  const previousFields = JSON.parse(JSON.stringify(customFields.value))
  customFields.value.splice(index, 1)
  try {
    const res = await apiFetch(
      '/api/other-control-settings/custom-fields',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customFields: customFields.value })
      },
      { autoRedirect: false }
    )

    if (!res.ok) {
      let responseText = ''
      try {
        responseText = await res.text()
      } catch (readError) {
        console.warn('讀取刪除自訂欄位回應失敗：', readError)
      }

      let errorMessage = '刪除自訂欄位失敗，請稍後再試'
      if (responseText) {
        try {
          const data = JSON.parse(responseText)
          if (data?.message) {
            errorMessage = data.message
          }
        } catch (parseError) {
          errorMessage = responseText
        }
      }

      throw new Error(errorMessage)
    }

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
  padding: 24px;
}

.other-control-setting h2 {
  margin-bottom: 16px;
  color: #0f172a;
}

.tab-content {
  padding: 16px 8px;
}

.list-action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.hint {
  color: #475569;
}

.info-alert {
  margin-bottom: 12px;
}

.dictionary-action-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  gap: 12px;
}

.dictionary-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.dictionary-header h3 {
  margin: 0;
  font-size: 18px;
  color: #1e293b;
}

.dictionary-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.dictionary-select {
  width: 200px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
