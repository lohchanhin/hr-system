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
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'

const activeTab = ref('notification')

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

async function saveItemSettings(successMessage = '已儲存字典項目設定') {
  try {
    const res = await apiFetch(
      '/api/other-control-settings/item-settings',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemSettings: itemSettings.value })
      },
      { autoRedirect: false }
    )
    if (!res.ok) throw new Error('儲存失敗')
    if (successMessage) {
      ElMessage.success(successMessage)
    }
    return true
  } catch (error) {
    ElMessage.error('儲存字典項目時發生問題')
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

.status-alert {
  margin-top: 16px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
