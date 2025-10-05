<!-- src/Components/backComponents/ReportManagementSetting.vue -->

<template>
  <div class="report-management-setting">
    <h2>報表管理設定</h2>

    <el-tabs v-model="activeTab" type="card">
      <!-- 1) 報表模板管理 -->
      <el-tab-pane label="報表模板管理" name="template">
        <div class="tab-content">
          <el-button type="primary" @click="openTemplateDialog()">新增報表模板</el-button>
          <el-table
            :data="reportTemplates"
            style="margin-top: 20px;"
            v-loading="isLoading"
            highlight-current-row
            row-key="id"
            :current-row-key="selectedTemplateId"
            empty-text="尚無報表模板"
            @current-change="handleTemplateChange"
          >
            <el-table-column prop="name" label="報表名稱" width="180" />
            <el-table-column prop="type" label="類型" width="120" />
            <el-table-column prop="fields" label="欄位數">
              <template #default="{ row }">
                {{ row.fields.length }} 項
              </template>
            </el-table-column>
            <el-table-column label="操作" width="200">
              <template #default="{ row }">
                <el-button type="primary" @click="openTemplateDialog(row)">編輯</el-button>
                <el-button type="danger" @click="deleteTemplate(row)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>

          <el-alert
            v-if="currentTemplate"
            type="info"
            :closable="false"
            style="margin-top: 16px;"
            :title="`目前選擇模板：${currentTemplate.name}`"
          />
          <el-alert
            v-else
            type="info"
            :closable="false"
            style="margin-top: 16px;"
            title="請先新增報表模板"
          />

          <el-dialog v-model="templateDialogVisible" title="報表模板設定" width="600px">
            <el-form :model="templateForm" label-width="120px">
              <el-form-item label="報表名稱">
                <el-input v-model="templateForm.name" placeholder="如：出勤統計報表 / 請假統計 / 薪資明細..."></el-input>
              </el-form-item>
              <el-form-item label="類型">
                <el-select v-model="templateForm.type" placeholder="選擇報表類型">
                  <el-option label="出勤" value="出勤" />
                  <el-option label="請假" value="請假" />
                  <el-option label="加班/補休" value="加班補休" />
                  <el-option label="薪資" value="薪資" />
                  <el-option label="其他" value="其他" />
                </el-select>
              </el-form-item>
              <el-form-item label="欄位列表">
                <div class="field-list">
                  <el-tag
                    v-for="(field, idx) in templateForm.fields"
                    :key="idx"
                    closable
                    @close="removeField(idx)"
                    style="margin: 4px;"
                  >
                    {{ field }}
                  </el-tag>
                  <el-input
                    v-model="newField"
                    placeholder="輸入欄位名稱後按 Enter"
                    @keyup.enter="addField"
                    style="width: 100%; margin-top: 4px;"
                  />
                </div>
              </el-form-item>
            </el-form>
            <template #footer>
              <span class="dialog-footer">
                <el-button @click="templateDialogVisible = false">取消</el-button>
                <el-button type="primary" :loading="savingTemplate" @click="saveTemplate">儲存</el-button>
              </span>
            </template>
          </el-dialog>
        </div>
      </el-tab-pane>

      <!-- 2) 匯出格式與樣式 -->
      <el-tab-pane label="匯出格式與樣式" name="export">
        <div class="tab-content">
          <template v-if="reportTemplates.length">
            <el-form :model="exportForm" label-width="160px">
              <el-form-item label="選擇模板">
                <el-select v-model="selectedTemplateId" placeholder="選擇報表模板">
                  <el-option
                    v-for="template in reportTemplates"
                    :key="template.id"
                    :label="template.name"
                    :value="template.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="支援匯出格式">
                <el-checkbox-group v-model="exportForm.formats">
                  <el-checkbox label="PDF" />
                  <el-checkbox label="Excel" />
                  <el-checkbox label="CSV" />
                </el-checkbox-group>
              </el-form-item>
              <el-form-item label="是否包含公司 Logo">
                <el-switch v-model="exportForm.includeLogo" />
              </el-form-item>
              <el-form-item label="頁尾備註">
                <el-input v-model="exportForm.footerNote" placeholder="如：機密文件/僅供內部參考"></el-input>
              </el-form-item>
              <el-form-item>
                <el-button
                  type="primary"
                  :disabled="!currentTemplate"
                  :loading="exportSaving"
                  @click="saveExportSetting"
                >儲存匯出設定</el-button>
              </el-form-item>
            </el-form>
          </template>
          <el-alert
            v-else
            type="info"
            :closable="false"
            title="請先新增報表模板"
          />
        </div>
      </el-tab-pane>

      <!-- 3) 權限與範圍設定 -->
      <el-tab-pane label="權限與範圍" name="permission">
        <div class="tab-content">
          <template v-if="reportTemplates.length">
            <el-form :model="permissionForm" label-width="180px">
              <el-form-item label="選擇模板">
                <el-select v-model="selectedTemplateId" placeholder="選擇報表模板">
                  <el-option
                    v-for="template in reportTemplates"
                    :key="template.id"
                    :label="template.name"
                    :value="template.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="主管可查部門彙總報表">
                <el-switch v-model="permissionForm.supervisorDept" />
              </el-form-item>
              <el-form-item label="HR 可查所有部門報表">
                <el-switch v-model="permissionForm.hrAllDept" />
              </el-form-item>
              <el-form-item label="員工是否可下載個人報表">
                <el-switch v-model="permissionForm.employeeDownload" />
              </el-form-item>
              <el-form-item label="報表歷史可查詢 (月)">
                <el-input-number v-model="permissionForm.historyMonths" :min="0" />
                <small>可查詢往前幾個月報表？</small>
              </el-form-item>
              <el-form-item>
                <el-button
                  type="primary"
                  :disabled="!currentTemplate"
                  :loading="permissionSaving"
                  @click="savePermission"
                >儲存權限設定</el-button>
              </el-form-item>
            </el-form>
          </template>
          <el-alert
            v-else
            type="info"
            :closable="false"
            title="請先新增報表模板"
          />
        </div>
      </el-tab-pane>

      <!-- 4) 報表通知與寄送 (選擇性) -->
      <el-tab-pane label="通知與寄送" name="notification">
        <div class="tab-content">
          <template v-if="reportTemplates.length">
            <el-form :model="notifyForm" label-width="160px">
              <el-form-item label="選擇模板">
                <el-select v-model="selectedTemplateId" placeholder="選擇報表模板">
                  <el-option
                    v-for="template in reportTemplates"
                    :key="template.id"
                    :label="template.name"
                    :value="template.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="自動寄送報表">
                <el-switch v-model="notifyForm.autoSend" />
                <small>若啟用，可設定排程定期寄送</small>
              </el-form-item>
              <el-form-item label="寄送頻率">
                <el-select v-model="notifyForm.sendFrequency" :disabled="!notifyForm.autoSend">
                  <el-option label="每日" value="daily" />
                  <el-option label="每週" value="weekly" />
                  <el-option label="每月" value="monthly" />
                </el-select>
              </el-form-item>
              <el-form-item label="寄送對象 (多選)">
                <el-checkbox-group v-model="notifyForm.recipients" :disabled="!notifyForm.autoSend">
                  <el-checkbox label="主管" />
                  <el-checkbox label="HR" />
                  <el-checkbox label="員工本人" />
                  <el-checkbox label="財務" />
                </el-checkbox-group>
              </el-form-item>
              <el-form-item>
                <el-button
                  type="primary"
                  :disabled="!currentTemplate"
                  :loading="notifySaving"
                  @click="saveNotifySetting"
                >儲存通知設定</el-button>
              </el-form-item>
            </el-form>
          </template>
          <el-alert
            v-else
            type="info"
            :closable="false"
            title="請先新增報表模板"
          />
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api.js'

const activeTab = ref('template')
const isLoading = ref(false)
const savingTemplate = ref(false)
const exportSaving = ref(false)
const permissionSaving = ref(false)
const notifySaving = ref(false)

const reportTemplates = ref([])
const selectedTemplateId = ref(null)

const templateDialogVisible = ref(false)
let templateEditId = null

const templateForm = ref(createTemplateForm())
const newField = ref('')

const exportForm = ref(createDefaultExportSettings())
const permissionForm = ref(createDefaultPermissionSettings())
const notifyForm = ref(createDefaultNotificationSettings())

const currentTemplate = computed(() =>
  reportTemplates.value.find((template) => template.id === selectedTemplateId.value) ?? null
)

watch(
  currentTemplate,
  (template) => {
    if (template) {
      exportForm.value = cloneWithDefaults(template.exportSettings, createDefaultExportSettings)
      permissionForm.value = cloneWithDefaults(
        template.permissionSettings,
        createDefaultPermissionSettings
      )
      notifyForm.value = cloneWithDefaults(
        template.notificationSettings,
        createDefaultNotificationSettings
      )
    } else {
      exportForm.value = createDefaultExportSettings()
      permissionForm.value = createDefaultPermissionSettings()
      notifyForm.value = createDefaultNotificationSettings()
    }
  },
  { immediate: true }
)

watch(
  () => notifyForm.value.autoSend,
  (autoSend) => {
    if (!autoSend) {
      notifyForm.value.sendFrequency = ''
      notifyForm.value.recipients = []
    }
  }
)

function createDefaultExportSettings() {
  return { formats: [], includeLogo: false, footerNote: '' }
}

function createDefaultPermissionSettings() {
  return { supervisorDept: false, hrAllDept: false, employeeDownload: false, historyMonths: 6 }
}

function createDefaultNotificationSettings() {
  return { autoSend: false, sendFrequency: '', recipients: [] }
}

function cloneWithDefaults(value, defaultsFactory) {
  const merged = { ...defaultsFactory(), ...(value || {}) }
  return JSON.parse(JSON.stringify(merged))
}

function normalizeFieldsList(list) {
  if (!Array.isArray(list)) return []
  return list
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function createTemplateForm(template) {
  return {
    name: template?.name ?? '',
    type: template?.type ?? '',
    fields: Array.isArray(template?.fields) ? [...template.fields] : [],
    exportSettings: cloneWithDefaults(template?.exportSettings, createDefaultExportSettings),
    permissionSettings: cloneWithDefaults(
      template?.permissionSettings,
      createDefaultPermissionSettings
    ),
    notificationSettings: cloneWithDefaults(
      template?.notificationSettings,
      createDefaultNotificationSettings
    ),
  }
}

function normalizeTemplateFromApi(template) {
  if (!template) return null
  const { id, _id, exportSettings, permissionSettings, notificationSettings, fields, ...rest } = template
  return {
    ...rest,
    id: id ?? _id ?? '',
    fields: normalizeFieldsList(fields),
    exportSettings: cloneWithDefaults(exportSettings, createDefaultExportSettings),
    permissionSettings: cloneWithDefaults(permissionSettings, createDefaultPermissionSettings),
    notificationSettings: cloneWithDefaults(
      notificationSettings,
      createDefaultNotificationSettings
    ),
  }
}

function buildTemplatePayload(formValue) {
  return {
    name: formValue.name ?? '',
    type: formValue.type ?? '',
    fields: normalizeFieldsList(formValue.fields),
    exportSettings: cloneWithDefaults(formValue.exportSettings, createDefaultExportSettings),
    permissionSettings: cloneWithDefaults(
      formValue.permissionSettings,
      createDefaultPermissionSettings
    ),
    notificationSettings: cloneWithDefaults(
      formValue.notificationSettings,
      createDefaultNotificationSettings
    ),
  }
}

function syncSelectedTemplate(preferredId) {
  const targetId = preferredId ?? selectedTemplateId.value
  const match = targetId ? reportTemplates.value.find((template) => template.id === targetId) : null
  if (match) {
    selectedTemplateId.value = match.id
  } else {
    selectedTemplateId.value = reportTemplates.value[0]?.id ?? null
  }
}

async function parseJson(response, fallbackMessage) {
  let payload = null
  try {
    payload = await response.json()
  } catch (error) {
    if (response.ok) {
      return null
    }
  }
  if (!response.ok) {
    const message = payload?.error || fallbackMessage
    throw new Error(message)
  }
  return payload
}

async function loadReports() {
  isLoading.value = true
  const previousId = selectedTemplateId.value
  try {
    const res = await apiFetch('/api/reports')
    const data = await parseJson(res, '載入報表模板失敗')
    if (Array.isArray(data)) {
      reportTemplates.value = data
        .map((item) => normalizeTemplateFromApi(item))
        .filter((item) => item)
      syncSelectedTemplate(previousId)
    } else {
      reportTemplates.value = []
      selectedTemplateId.value = null
    }
  } catch (error) {
    ElMessage.error(error.message || '載入報表模板失敗')
  } finally {
    isLoading.value = false
  }
}

function handleTemplateChange(row) {
  if (row && row.id) {
    selectedTemplateId.value = row.id
  }
}

function openTemplateDialog(template) {
  if (template && template.id) {
    templateEditId = template.id
    templateForm.value = createTemplateForm(template)
    selectedTemplateId.value = template.id
  } else {
    templateEditId = null
    templateForm.value = createTemplateForm()
  }
  newField.value = ''
  templateDialogVisible.value = true
}

function addField() {
  const value = newField.value.trim()
  if (value) {
    templateForm.value.fields.push(value)
    newField.value = ''
  }
}

function removeField(idx) {
  templateForm.value.fields.splice(idx, 1)
}

function upsertTemplate(updated) {
  const normalized = normalizeTemplateFromApi(updated)
  if (!normalized || !normalized.id) return
  const index = reportTemplates.value.findIndex((template) => template.id === normalized.id)
  if (index === -1) {
    reportTemplates.value.push(normalized)
  } else {
    reportTemplates.value.splice(index, 1, normalized)
  }
  syncSelectedTemplate(normalized.id)
}

async function saveTemplate() {
  if (!templateForm.value.name.trim()) {
    ElMessage.error('請輸入報表名稱')
    return
  }

  savingTemplate.value = true
  try {
    const payload = buildTemplatePayload(templateForm.value)
    const url = templateEditId ? `/api/reports/${templateEditId}` : '/api/reports'
    const method = templateEditId ? 'PUT' : 'POST'
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const data = await parseJson(
      res,
      templateEditId ? '更新報表模板失敗' : '新增報表模板失敗'
    )
    if (data) {
      upsertTemplate(data)
    }
    ElMessage.success(templateEditId ? '報表模板已更新' : '報表模板已新增')
    templateDialogVisible.value = false
  } catch (error) {
    ElMessage.error(error.message || '儲存報表模板失敗')
  } finally {
    savingTemplate.value = false
  }
}

async function deleteTemplate(template) {
  if (!template || !template.id) return
  try {
    await ElMessageBox.confirm(`確定要刪除「${template.name}」？`, '刪除確認', {
      type: 'warning'
    })
  } catch (error) {
    return
  }

  try {
    const res = await apiFetch(`/api/reports/${template.id}`, { method: 'DELETE' })
    await parseJson(res, '刪除報表模板失敗')
    const index = reportTemplates.value.findIndex((item) => item.id === template.id)
    if (index !== -1) {
      reportTemplates.value.splice(index, 1)
    }
    syncSelectedTemplate()
    ElMessage.success('報表模板已刪除')
  } catch (error) {
    ElMessage.error(error.message || '刪除報表模板失敗')
  }
}

async function saveExportSetting() {
  if (!currentTemplate.value) {
    ElMessage.warning('請先選擇報表模板')
    return
  }
  exportSaving.value = true
  try {
    const res = await apiFetch(`/api/reports/${currentTemplate.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exportSettings: cloneWithDefaults(exportForm.value, createDefaultExportSettings) })
    })
    const data = await parseJson(res, '儲存匯出設定失敗')
    if (data) {
      upsertTemplate(data)
    }
    ElMessage.success('匯出設定已更新')
  } catch (error) {
    ElMessage.error(error.message || '儲存匯出設定失敗')
  } finally {
    exportSaving.value = false
  }
}

async function savePermission() {
  if (!currentTemplate.value) {
    ElMessage.warning('請先選擇報表模板')
    return
  }
  permissionSaving.value = true
  try {
    const res = await apiFetch(`/api/reports/${currentTemplate.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        permissionSettings: cloneWithDefaults(permissionForm.value, createDefaultPermissionSettings)
      })
    })
    const data = await parseJson(res, '儲存權限設定失敗')
    if (data) {
      upsertTemplate(data)
    }
    ElMessage.success('權限設定已更新')
  } catch (error) {
    ElMessage.error(error.message || '儲存權限設定失敗')
  } finally {
    permissionSaving.value = false
  }
}

async function saveNotifySetting() {
  if (!currentTemplate.value) {
    ElMessage.warning('請先選擇報表模板')
    return
  }
  notifySaving.value = true
  try {
    const res = await apiFetch(`/api/reports/${currentTemplate.value.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationSettings: cloneWithDefaults(
          notifyForm.value,
          createDefaultNotificationSettings
        )
      })
    })
    const data = await parseJson(res, '儲存通知設定失敗')
    if (data) {
      upsertTemplate(data)
    }
    ElMessage.success('通知設定已更新')
  } catch (error) {
    ElMessage.error(error.message || '儲存通知設定失敗')
  } finally {
    notifySaving.value = false
  }
}

onMounted(() => {
  loadReports()
})
</script>

<style scoped>
.report-management-setting {
  padding: 20px;
}

.tab-content {
  margin-top: 20px;
}

.field-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
</style>
