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
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'

const activeTab = ref('item-setting')

const dictionaryDefinitions = ref([
  { key: 'C03', label: '職稱' },
  { key: 'C04', label: '執業職稱' },
  { key: 'C05', label: '語言能力' },
  { key: 'C06', label: '身障等級' },
  { key: 'C07', label: '身分類別' }
])

function createDefaultItemSettings() {
  const defaults = {
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
    ]
  }
  dictionaryDefinitions.value.forEach(dict => {
    if (!defaults[dict.key]) {
      defaults[dict.key] = []
    }
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
    label: '班別名稱 (C11)',
    fieldKey: 'C11_name',
    type: 'text',
    category: 'dictionary',
    group: '班別設定',
    required: true,
    description: '顯示於班別選單的名稱'
  },
  {
    label: '班別說明 (C11)',
    fieldKey: 'C11_content',
    type: 'textarea',
    category: 'dictionary',
    group: '班別設定',
    required: false,
    description: '補充班別內容或注意事項'
  },
  {
    label: '班別時段 (C11)',
    fieldKey: 'C11_timeRange',
    type: 'timeRange',
    category: 'dictionary',
    group: '班別設定',
    required: true,
    description: '設定班別的起訖時間'
  },
  {
    label: '休息是否計薪 (C11)',
    fieldKey: 'C11_paidBreak',
    type: 'boolean',
    category: 'dictionary',
    group: '班別設定',
    required: false,
    description: '決定休息時間是否計薪'
  },
  {
    label: '允許彈性時間 (C11)',
    fieldKey: 'C11_allowFlexTime',
    type: 'boolean',
    category: 'dictionary',
    group: '班別設定',
    required: false,
    description: '是否允許彈性前後時間'
  },
  {
    label: '彈性區間分鐘數 (C11)',
    fieldKey: 'C11_flexWindow',
    type: 'number',
    category: 'dictionary',
    group: '班別設定',
    required: false,
    description: '可彈性調整的分鐘數'
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
    label: '加班原因 (C13)',
    fieldKey: 'C13',
    type: 'select',
    category: 'dictionary',
    group: '加班設定',
    required: false,
    description: '設定常用的加班原因'
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
  description: ''
})

onMounted(() => {
  loadSettings()
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
            merged[dict.key] = data.itemSettings[dict.key].map(option => ({
              name: option.name ?? '',
              code: option.code ?? ''
            }))
          }
        })
        itemSettings.value = merged
        if (!dictionaryDefinitions.value.some(dict => dict.key === activeDictionaryKey.value)) {
          activeDictionaryKey.value = dictionaryDefinitions.value[0]?.key ?? ''
        }
      } else {
        itemSettings.value = createDefaultItemSettings()
      }
    }
  } catch (error) {
    console.warn('載入其他控制設定失敗：', error)
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
    fieldForm.value = { ...customFields.value[index] }
  } else {
    fieldForm.value = {
      label: '',
      fieldKey: '',
      type: 'text',
      category: '',
      group: '',
      required: false,
      description: ''
    }
  }
  fieldDialogVisible.value = true
}

async function saveField() {
  if (!fieldForm.value.label || !fieldForm.value.fieldKey) {
    ElMessage.warning('欄位名稱與識別代碼為必填')
    return
  }
  if (editingFieldIndex.value > -1) {
    customFields.value.splice(editingFieldIndex.value, 1, { ...fieldForm.value })
  } else {
    customFields.value.push({ ...fieldForm.value })
  }
  fieldDialogVisible.value = false
  ElMessage.success('已更新自訂欄位')
}

async function removeField(index) {
  try {
    await ElMessageBox.confirm('確定要刪除此欄位嗎？', '提醒', { type: 'warning' })
    customFields.value.splice(index, 1)
    ElMessage.success('已刪除自訂欄位')
  } catch (error) {
    // 取消
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
