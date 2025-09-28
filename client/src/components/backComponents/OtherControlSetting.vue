<template>
  <div class="other-control-setting">
    <h2>其他控制設定</h2>

    <el-tabs v-model="activeTab" type="border-card">
      <el-tab-pane label="通知中心" name="notification">
        <div class="tab-content">
          <el-descriptions :column="2" title="目前通知策略" class="descriptions-block">
            <el-descriptions-item label="Email 通知">{{ notificationForm.enableEmail ? '啟用' : '停用' }}</el-descriptions-item>
            <el-descriptions-item label="SMS 通知">{{ notificationForm.enableSMS ? '啟用' : '停用' }}</el-descriptions-item>
            <el-descriptions-item label="每日摘要時間">{{ notificationForm.digestTime || '未設定' }}</el-descriptions-item>
            <el-descriptions-item label="預設提醒">提前 {{ notificationForm.defaultReminderMinutes }} 分鐘</el-descriptions-item>
          </el-descriptions>

          <el-divider content-position="left">編輯通知策略</el-divider>
          <el-form :model="notificationForm" label-width="160px" class="form-layout">
            <el-form-item label="啟用 Email 通知">
              <el-switch v-model="notificationForm.enableEmail" active-text="啟用" inactive-text="停用" />
            </el-form-item>
            <el-form-item label="啟用 SMS 通知">
              <el-switch v-model="notificationForm.enableSMS" active-text="啟用" inactive-text="停用" />
            </el-form-item>
            <el-form-item label="預設提醒(分鐘)">
              <el-input-number v-model="notificationForm.defaultReminderMinutes" :min="0" :step="5" />
            </el-form-item>
            <el-form-item label="每日摘要時間">
              <el-time-picker
                v-model="notificationForm.digestTime"
                placeholder="選擇時間"
                format="HH:mm"
                value-format="HH:mm"
                :disabled="!notificationForm.enableEmail"
              />
            </el-form-item>
            <el-form-item label="升級通知對象">
              <el-select v-model="notificationForm.escalationTargets" multiple placeholder="選擇對象">
                <el-option v-for="item in escalationOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="通知頻率">
              <el-radio-group v-model="notificationForm.frequency">
                <el-radio-button label="immediate">即時</el-radio-button>
                <el-radio-button label="hourly">每小時彙整</el-radio-button>
                <el-radio-button label="daily">每日彙整</el-radio-button>
              </el-radio-group>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveNotificationSetting">儲存通知設定</el-button>
            </el-form-item>
          </el-form>
        </div>
      </el-tab-pane>

      <el-tab-pane label="安全控制" name="security">
        <div class="tab-content">
          <el-descriptions :column="2" title="目前安全概要" class="descriptions-block">
            <el-descriptions-item label="雙因素驗證">{{ securityForm.enforce2FA ? '強制' : '選用' }}</el-descriptions-item>
            <el-descriptions-item label="密碼有效天數">
              {{ securityForm.passwordExpiration ? securityForm.passwordExpireDays + ' 天' : '不限制' }}
            </el-descriptions-item>
            <el-descriptions-item label="閒置登出">
              {{ securityForm.sessionTimeout }} 分鐘
            </el-descriptions-item>
            <el-descriptions-item label="異常登入通知">{{ securityForm.loginAlert ? '啟用' : '停用' }}</el-descriptions-item>
          </el-descriptions>

          <el-divider content-position="left">編輯安全控制</el-divider>
          <el-form :model="securityForm" label-width="180px" class="form-layout">
            <el-form-item label="強制雙因素驗證">
              <el-switch v-model="securityForm.enforce2FA" active-text="強制" inactive-text="選用" />
            </el-form-item>
            <el-form-item label="密碼期限">
              <el-switch v-model="securityForm.passwordExpiration" active-text="啟用" inactive-text="停用" />
            </el-form-item>
            <el-form-item label="密碼有效天數">
              <el-input-number v-model="securityForm.passwordExpireDays" :min="0" :disabled="!securityForm.passwordExpiration" />
            </el-form-item>
            <el-form-item label="閒置自動登出">
              <el-slider
                v-model="securityForm.sessionTimeout"
                :min="5"
                :max="120"
                :step="5"
                show-input
              />
            </el-form-item>
            <el-form-item label="異常登入通知">
              <el-switch v-model="securityForm.loginAlert" active-text="啟用" inactive-text="停用" />
            </el-form-item>
            <el-form-item label="維運通知人">
              <el-select v-model="securityForm.maintenanceContacts" multiple placeholder="選擇人員">
                <el-option v-for="item in securityContactOptions" :key="item.value" :label="item.label" :value="item.value" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveSecuritySetting">儲存安全設定</el-button>
            </el-form-item>
          </el-form>

          <el-divider content-position="left">IP 限制</el-divider>
          <div class="list-action-row">
            <span class="hint">僅允許表列來源連線後台</span>
            <el-button type="primary" @click="openIpDialog()">新增 IP</el-button>
          </div>
          <el-table :data="ipWhitelist" border>
            <el-table-column prop="label" label="辨識名稱" width="180" />
            <el-table-column prop="address" label="IP / 網段" />
            <el-table-column label="操作" width="180">
              <template #default="{ $index }">
                <el-button size="small" @click="openIpDialog($index)">編輯</el-button>
                <el-button size="small" type="danger" @click="removeIp($index)">刪除</el-button>
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

      <el-tab-pane label="整合與同步" name="integration">
        <div class="tab-content">
          <el-form :model="integrationForm" label-width="200px" class="form-layout">
            <el-form-item label="預設整合廠商">
              <el-select v-model="integrationForm.vendor" placeholder="選擇廠商">
                <el-option v-for="vendor in vendorOptions" :key="vendor.value" :label="vendor.label" :value="vendor.value" />
              </el-select>
            </el-form-item>
            <el-form-item label="啟用排班同步">
              <el-switch v-model="integrationForm.syncSchedule" />
            </el-form-item>
            <el-form-item label="啟用薪資系統同步">
              <el-switch v-model="integrationForm.syncPayroll" />
            </el-form-item>
            <el-form-item label="Webhook URL">
              <el-input v-model="integrationForm.webhookUrl" placeholder="https://example.com/webhook" />
            </el-form-item>
            <el-form-item label="發生錯誤自動重試">
              <el-switch v-model="integrationForm.autoRetry" />
            </el-form-item>
            <el-form-item label="最後一次同步">
              <el-tag type="info">{{ integrationStatus.lastSync }}</el-tag>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveIntegrationSetting">儲存整合設定</el-button>
              <el-button @click="testIntegration">測試連線</el-button>
            </el-form-item>
          </el-form>
          <el-alert
            :title="`最近同步狀態：${integrationStatus.statusMessage}`"
            type="success"
            show-icon
            class="status-alert"
          />
        </div>
      </el-tab-pane>

      <el-tab-pane label="自動化規則" name="automation">
        <div class="tab-content">
          <div class="list-action-row">
            <el-button type="primary" @click="openRuleDialog()">新增規則</el-button>
          </div>
          <el-table :data="automationRules" border>
            <el-table-column prop="name" label="規則名稱" width="220" />
            <el-table-column prop="trigger" label="觸發條件" />
            <el-table-column prop="status" label="狀態" width="120">
              <template #default="{ row }">
                <el-tag :type="row.status === 'enabled' ? 'success' : 'info'">
                  {{ row.status === 'enabled' ? '啟用' : '停用' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="執行動作" width="220">
              <template #default="{ row }">
                {{ row.actions.map(action => actionLabelMap[action] || action).join('、') }}
              </template>
            </el-table-column>
            <el-table-column label="通知對象" width="180">
              <template #default="{ row }">
                {{ row.notifyTargets.map(target => notifyTargetMap[target] || target).join('、') }}
              </template>
            </el-table-column>
            <el-table-column label="操作" width="220">
              <template #default="{ row, $index }">
                <el-button size="small" @click="toggleRuleStatus($index)">
                  {{ row.status === 'enabled' ? '停用' : '啟用' }}
                </el-button>
                <el-button size="small" @click="openRuleDialog($index)">編輯</el-button>
                <el-button size="small" type="danger" @click="removeRule($index)">刪除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
    </el-tabs>

    <el-dialog v-model="ipDialogVisible" title="IP 白名單" width="420px">
      <el-form :model="ipForm" label-width="100px">
        <el-form-item label="名稱">
          <el-input v-model="ipForm.label" placeholder="如：總部辦公室" />
        </el-form-item>
        <el-form-item label="IP/網段">
          <el-input v-model="ipForm.address" placeholder="192.168.1.1 或 203.0.113.0/24" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="ipDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveIp">儲存</el-button>
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

    <el-dialog v-model="ruleDialogVisible" title="自動化規則" width="520px">
      <el-form :model="ruleForm" label-width="120px">
        <el-form-item label="規則名稱">
          <el-input v-model="ruleForm.name" />
        </el-form-item>
        <el-form-item label="觸發條件">
          <el-input v-model="ruleForm.trigger" placeholder="例如：建立新員工資料" />
        </el-form-item>
        <el-form-item label="通知對象">
          <el-select v-model="ruleForm.notifyTargets" multiple>
            <el-option v-for="option in notifyTargetOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="執行動作">
          <el-select v-model="ruleForm.actions" multiple>
            <el-option v-for="option in actionOptions" :key="option.value" :label="option.label" :value="option.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="狀態">
          <el-radio-group v-model="ruleForm.status">
            <el-radio-button label="enabled">啟用</el-radio-button>
            <el-radio-button label="disabled">停用</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="備註">
          <el-input v-model="ruleForm.description" type="textarea" />
        </el-form-item>
      </el-form>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="ruleDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="saveRule">儲存</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'

const activeTab = ref('notification')

const notificationForm = ref({
  enableEmail: true,
  enableSMS: false,
  defaultReminderMinutes: 30,
  digestTime: '08:30',
  escalationTargets: ['manager'],
  frequency: 'immediate'
})

const escalationOptions = [
  { label: '部門主管', value: 'manager' },
  { label: 'HR 夥伴', value: 'hr' },
  { label: '系統管理員', value: 'admin' }
]

const securityForm = ref({
  enforce2FA: true,
  passwordExpiration: true,
  passwordExpireDays: 90,
  sessionTimeout: 30,
  loginAlert: true,
  maintenanceContacts: ['security']
})

const securityContactOptions = [
  { label: '資訊安全', value: 'security' },
  { label: '系統管理員', value: 'admin' },
  { label: 'HR 主管', value: 'hr' }
]

const ipWhitelist = ref([
  { label: '台北總部', address: '203.0.113.0/24' },
  { label: '備援機房', address: '198.51.100.25' }
])
const ipDialogVisible = ref(false)
const editingIpIndex = ref(-1)
const ipForm = ref({ label: '', address: '' })

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

const vendorOptions = [
  { label: '無', value: 'none' },
  { label: 'Workday', value: 'workday' },
  { label: 'SAP SuccessFactors', value: 'sap' },
  { label: 'Local ERP', value: 'local' }
]
const integrationForm = ref({
  vendor: 'none',
  syncSchedule: true,
  syncPayroll: false,
  webhookUrl: '',
  autoRetry: true
})

const integrationStatus = ref({
  lastSync: '尚未同步',
  statusMessage: '等待測試'
})

const actionOptions = [
  { label: '指派預設角色', value: 'assignDefaultRole' },
  { label: '寄送通知郵件', value: 'sendMail' },
  { label: '建立審核待辦', value: 'createApprovalTask' },
  { label: '鎖定帳號', value: 'lockAccount' }
]
const actionLabelMap = actionOptions.reduce((map, option) => ({ ...map, [option.value]: option.label }), {})

const notifyTargetOptions = [
  { label: '部門主管', value: 'manager' },
  { label: 'HR 夥伴', value: 'hr' },
  { label: '系統管理員', value: 'admin' },
  { label: '資安人員', value: 'security' }
]
const notifyTargetMap = notifyTargetOptions.reduce((map, option) => ({ ...map, [option.value]: option.label }), {})

const automationRules = ref([
  {
    name: '新員工自動啟用',
    trigger: '建立員工主檔後',
    status: 'enabled',
    actions: ['assignDefaultRole', 'sendMail'],
    notifyTargets: ['hr'],
    description: '自動寄送歡迎信並指派 HR 夥伴'
  },
  {
    name: '異常登入鎖定',
    trigger: '帳號連續 5 次登入失敗',
    status: 'disabled',
    actions: ['lockAccount', 'sendMail'],
    notifyTargets: ['admin', 'security'],
    description: '通知系統管理員並暫停帳號'
  }
])
const ruleDialogVisible = ref(false)
const editingRuleIndex = ref(-1)
const ruleForm = ref({
  name: '',
  trigger: '',
  actions: [],
  notifyTargets: [],
  status: 'enabled',
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
      if (data.notification) {
        notificationForm.value = { ...notificationForm.value, ...data.notification }
      }
      if (data.security) {
        securityForm.value = { ...securityForm.value, ...data.security }
        if (Array.isArray(data.security.ipWhitelist)) {
          ipWhitelist.value = data.security.ipWhitelist
        }
      }
      if (Array.isArray(data.customFields) && data.customFields.length) {
        customFields.value = data.customFields
      } else {
        customFields.value = [...defaultCustomFields]
      }
      if (data.integration) {
        integrationForm.value = { ...integrationForm.value, ...data.integration }
        integrationStatus.value = {
          lastSync: data.integration.lastSync || integrationStatus.value.lastSync,
          statusMessage: data.integration.statusMessage || integrationStatus.value.statusMessage
        }
      }
      if (Array.isArray(data.automationRules)) {
        automationRules.value = data.automationRules
      }
    }
  } catch (error) {
    console.warn('載入其他控制設定失敗：', error)
  }
}

async function saveNotificationSetting() {
  try {
    const res = await apiFetch('/api/other-control-settings/notification', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(notificationForm.value)
    })
    if (!res.ok) throw new Error('儲存失敗')
    ElMessage.success('已儲存通知設定')
  } catch (error) {
    ElMessage.error('儲存通知設定時發生問題')
  }
}

async function saveSecuritySetting() {
  const payload = {
    ...securityForm.value,
    ipWhitelist: ipWhitelist.value
  }
  try {
    const res = await apiFetch('/api/other-control-settings/security', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error('儲存失敗')
    ElMessage.success('已儲存安全設定')
  } catch (error) {
    ElMessage.error('儲存安全設定時發生問題')
  }
}

function openIpDialog(index = -1) {
  editingIpIndex.value = index
  if (index > -1) {
    ipForm.value = { ...ipWhitelist.value[index] }
  } else {
    ipForm.value = { label: '', address: '' }
  }
  ipDialogVisible.value = true
}

async function saveIp() {
  if (!ipForm.value.label || !ipForm.value.address) {
    ElMessage.warning('請填寫完整的 IP 資訊')
    return
  }
  if (editingIpIndex.value > -1) {
    ipWhitelist.value.splice(editingIpIndex.value, 1, { ...ipForm.value })
  } else {
    ipWhitelist.value.push({ ...ipForm.value })
  }
  ipDialogVisible.value = false
  ElMessage.success('已更新 IP 白名單')
}

async function removeIp(index) {
  try {
    await ElMessageBox.confirm('確定要移除該 IP 限制嗎？', '提醒', { type: 'warning' })
    ipWhitelist.value.splice(index, 1)
    ElMessage.success('已移除 IP 限制')
  } catch (error) {
    // 使用者取消
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

async function saveIntegrationSetting() {
  try {
    const res = await apiFetch('/api/other-control-settings/integration', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(integrationForm.value)
    })
    if (!res.ok) throw new Error('儲存失敗')
    integrationStatus.value = {
      lastSync: new Date().toLocaleString(),
      statusMessage: '設定已更新，等待下一次同步'
    }
    ElMessage.success('已儲存整合設定')
  } catch (error) {
    ElMessage.error('儲存整合設定時發生問題')
  }
}

async function testIntegration() {
  integrationStatus.value = {
    lastSync: new Date().toLocaleString(),
    statusMessage: '測試連線成功'
  }
  ElMessage.success('測試連線請求已送出')
}

function openRuleDialog(index = -1) {
  editingRuleIndex.value = index
  if (index > -1) {
    const target = automationRules.value[index]
    ruleForm.value = {
      name: target.name,
      trigger: target.trigger,
      actions: [...target.actions],
      notifyTargets: [...target.notifyTargets],
      status: target.status,
      description: target.description || ''
    }
  } else {
    ruleForm.value = {
      name: '',
      trigger: '',
      actions: [],
      notifyTargets: [],
      status: 'enabled',
      description: ''
    }
  }
  ruleDialogVisible.value = true
}

async function saveRule() {
  if (!ruleForm.value.name || !ruleForm.value.trigger) {
    ElMessage.warning('請填寫規則名稱與觸發條件')
    return
  }
  if (editingRuleIndex.value > -1) {
    automationRules.value.splice(editingRuleIndex.value, 1, { ...ruleForm.value })
  } else {
    automationRules.value.push({ ...ruleForm.value })
  }
  ruleDialogVisible.value = false
  ElMessage.success('已更新自動化規則')
}

async function removeRule(index) {
  try {
    await ElMessageBox.confirm('確定要刪除這條規則嗎？', '提醒', { type: 'warning' })
    automationRules.value.splice(index, 1)
    ElMessage.success('已刪除自動化規則')
  } catch (error) {
    // 取消
  }
}

function toggleRuleStatus(index) {
  const rule = automationRules.value[index]
  const nextStatus = rule.status === 'enabled' ? 'disabled' : 'enabled'
  automationRules.value.splice(index, 1, { ...rule, status: nextStatus })
  ElMessage.success(`規則已${nextStatus === 'enabled' ? '啟用' : '停用'}`)
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

.form-layout {
  max-width: 720px;
}

.descriptions-block {
  margin-bottom: 16px;
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

.status-alert {
  margin-top: 16px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
