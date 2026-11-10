<!-- src/Components/backComponents/LeaveOvertimeSetting.vue -->

<template>
  <div class="leave-overtime-setting">
    <PageHeader title="請假加班設定" />

    <el-tabs v-model="activeTab" class="setting-tabs" data-test="setting-tabs">
      <el-tab-pane label="假別規則" name="leave">
        <!-- 假別額度與餘額規則：請假的單位是小時，員工與主管看到的各假別剩餘時數、超額時能不能送出都在這裡設定 -->
        <section class="hr-section policy-card" data-test="leave-policy-card">
          <h2 class="hr-section__title">假別額度與餘額規則</h2>
          <el-alert v-if="policyError" type="error" :closable="false" show-icon class="policy-error" :title="policyError" />
          <div v-loading="policyLoading">
            <!-- 假別很多、表格很長：工具列固定在上方（共用的 hr-sticky-bar），捲到下面改設定時「儲存」仍然看得到 -->
            <div v-if="policy" class="hr-toolbar hr-sticky-bar">
              <label class="inline-field">
                <span>每日最多可請</span>
                <el-input-number v-model="policy.maxHoursPerDay" :min="1" :max="24" :step="0.5" controls-position="right" data-test="policy-max-hours" />
                <span>小時</span>
              </label>
              <label class="inline-field">
                <span>最小請假單位</span>
                <el-select v-model="policy.minUnitHours" style="width: 110px">
                  <el-option v-for="unit in minUnitChoices" :key="unit" :label="`${unit} 小時`" :value="unit" />
                </el-select>
              </label>
              <div class="toolbar-actions">
                <span v-if="policyDirty" class="hr-hint hr-hint--warning unsaved-note" data-test="policy-dirty">有未儲存的變更</span>
                <el-button @click="addCustomType">新增自訂假別</el-button>
                <el-button @click="restorePolicyDefaults">還原預設</el-button>
                <el-button type="primary" :loading="policySaving" data-test="policy-save" @click="savePolicy">儲存</el-button>
              </div>
            </div>
            <el-button v-if="policyError && !policy" @click="loadPolicy">重新載入</el-button>

            <p v-if="policy" class="hr-hint policy-hint">
              請假一律以小時為單位（1 天 = 8 小時）。每日最多可請時數是請假單每天的上限，12 小時輪班的單位可以設 12。
            </p>
            <el-collapse v-if="policy" class="policy-rules">
              <el-collapse-item title="規則說明" name="rules">
                <ul class="rule-list">
                  <li>額度預設是法定天數換成小時，特休依員工資料，調休依調休存摺（系統累計，不分年度）。</li>
                  <li>超額時預設只警告（簽核人看得到），勾選「超額禁止送出」則直接擋下。</li>
                  <li>特休、調休一律以剩餘時數檢查，超過就無法送出（開關固定為開啟，不能改成只警告）。</li>
                  <li>員工在申請單填的假別要和名稱或別名相符才會算進額度。</li>
                </ul>
              </el-collapse-item>
            </el-collapse>

            <el-table v-if="policy" :data="policy.types" size="small" border class="policy-table" data-test="policy-table">
              <el-table-column label="假別" min-width="150">
                <template #default="{ row }">
                  <el-input v-model="row.name" :disabled="isFixedType(row)" size="small" maxlength="30" />
                  <span v-if="row.note" class="row-note">{{ row.note }}</span>
                </template>
              </el-table-column>
              <el-table-column label="額度（小時）" min-width="170">
                <template #default="{ row }">
                  <template v-if="row.source === 'policy'">
                    <el-input-number v-model="row.quotaHours" :min="0" :max="10000" :step="0.5" size="small" controls-position="right" placeholder="不設上限" />
                    <div class="row-note">{{ quotaDaysText(row) }}</div>
                  </template>
                  <span v-else class="row-note">{{ quotaSourceText(row) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="計算期間" width="140">
                <template #default="{ row }">
                  <el-select v-if="row.source === 'policy'" v-model="row.period" size="small">
                    <el-option v-for="item in periodChoices" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                  <span v-else class="row-note">{{ row.source === 'comp_bank' ? '不分年度' : '每年' }}</span>
                </template>
              </el-table-column>
              <el-table-column label="超額禁止送出" width="110" align="center">
                <template #default="{ row }">
                  <el-switch
                    :model-value="isBlocking(row)"
                    :disabled="isAlwaysBlocking(row) || (row.source === 'policy' && (row.quotaHours === null || row.quotaHours === undefined))"
                    @update:model-value="setBlocking(row, $event)"
                  />
                  <div v-if="row.source === 'employee_annual'" class="row-note" data-test="annual-block-note">特休超過剩餘時數一律無法送出</div>
                  <div v-else-if="row.source === 'comp_bank'" class="row-note" data-test="comp-block-note">調休超過存摺可用時數一律無法送出</div>
                </template>
              </el-table-column>
              <el-table-column label="顯示" width="150">
                <template #default="{ row }">
                  <el-select v-model="row.display" size="small">
                    <el-option v-for="item in displayChoices" :key="item.value" :label="item.label" :value="item.value" />
                  </el-select>
                </template>
              </el-table-column>
              <el-table-column label="併入其他假別" min-width="190">
                <template #default="{ row }">
                  <div class="counts-against">
                    <el-select :model-value="row.countsAgainst?.key || ''" size="small" clearable placeholder="不併入" @update:model-value="setCountsAgainst(row, $event)">
                      <el-option v-for="other in otherTypes(row)" :key="other.key" :label="other.name" :value="other.key" />
                    </el-select>
                    <el-input-number
                      v-if="row.countsAgainst"
                      v-model="row.countsAgainst.exemptHours"
                      :min="0"
                      :step="0.5"
                      size="small"
                      controls-position="right"
                    />
                    <div v-if="row.countsAgainst" class="row-note">前 {{ row.countsAgainst.exemptHours }} 小時不併入</div>
                  </div>
                </template>
              </el-table-column>
              <el-table-column label="別名" min-width="180">
                <template #default="{ row }">
                  <el-select
                    v-if="row.key !== 'annual'"
                    v-model="row.aliases"
                    multiple
                    filterable
                    allow-create
                    default-first-option
                    size="small"
                    placeholder="員工填的假別名稱"
                  />
                  <span v-else class="row-note">{{ (row.aliases || []).join('、') }}</span>
                </template>
              </el-table-column>
              <el-table-column label="啟用" width="70" align="center">
                <template #default="{ row }">
                  <el-switch v-model="row.enabled" :disabled="isFixedType(row)" />
                </template>
              </el-table-column>
              <el-table-column label="" width="70" align="center">
                <template #default="{ row, $index }">
                  <el-button v-if="!row.builtin" link type="danger" size="small" @click="confirmRemoveType($index)">刪除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </section>
      </el-tab-pane>

      <!-- 加班費倍率、月中到職／離職的月薪比例、新進員工是否自動計算加班費（薪資計算實際讀的設定，見 docs/payroll-policy.md）。
           第一次點開才載入；以前這裡是寫死的唯讀倍率表 -->
      <el-tab-pane label="加班與計薪" name="payroll" lazy>
        <PayrollPolicySetting />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { apiFetch } from '../../api'
import { formatDaysAndHours } from '../../utils/leaveBalance'
import PageHeader from '../PageHeader.vue'
import PayrollPolicySetting from './PayrollPolicySetting.vue'

// 兩個頁籤：假別規則、加班與計薪（網址帶 ?tab=payroll 時直接開「加班與計薪」，薪資管理的「計薪設定」連到這裡）
const TABS = ['leave', 'payroll']
const routeTab = getCurrentInstance()?.appContext.config.globalProperties.$route?.query?.tab
const activeTab = ref(TABS.includes(routeTab) ? routeTab : 'leave')

/* -------------------- 假別額度與餘額規則 -------------------- */
const minUnitChoices = [0.25, 0.5, 1]
const periodChoices = [
  { value: 'year', label: '每年' },
  { value: 'event', label: '每次事件上限' },
  { value: 'none', label: '不設上限' }
]
const displayChoices = [
  { value: 'always', label: '一律顯示' },
  { value: 'when_used', label: '有使用才顯示' },
  { value: 'hidden', label: '不顯示' }
]

const policy = ref(null)
const policyDefaults = ref(null)
const policyLoading = ref(false)
const policySaving = ref(false)
const policyError = ref('')
// 最後一次讀取或儲存成功時的內容，用來判斷有沒有未儲存的變更
const savedPolicySnapshot = ref('')

const clonePolicy = (value) => JSON.parse(JSON.stringify(value))

const policyDirty = computed(() => Boolean(policy.value) && JSON.stringify(policy.value) !== savedPolicySnapshot.value)

// 只顯示中文訊息：網路中斷時瀏覽器丟出的是英文（Failed to fetch），換成看得懂的說法
const messageOf = (error, fallback) => (/[一-鿿]/.test(error?.message || '') ? error.message : fallback)

async function readError(res, fallback) {
  try {
    const body = await res.json()
    return body?.error || fallback
  } catch {
    return fallback
  }
}

// 特休、調休一律禁止超額送出：舊資料存成 warn / none 也顯示並儲存成 block，和實際行為一致
function applyLoadedPolicy(value) {
  const next = clonePolicy(value)
  for (const row of next?.types || []) if (isAlwaysBlocking(row)) row.enforcement = 'block'
  policy.value = next
  savedPolicySnapshot.value = JSON.stringify(next)
}

async function loadPolicy() {
  policyLoading.value = true
  policyError.value = ''
  try {
    const res = await apiFetch('/api/other-control-settings/leave-policy')
    if (!res.ok) throw new Error(await readError(res, '無法讀取假別額度規則'))
    const body = await res.json()
    applyLoadedPolicy(body.policy)
    policyDefaults.value = clonePolicy(body.defaults || body.policy)
  } catch (error) {
    policyError.value = messageOf(error, '無法讀取假別額度規則，請確認網路連線後再試')
  } finally {
    policyLoading.value = false
  }
}

function quotaDaysText(row) {
  if (row.quotaHours === null || row.quotaHours === undefined || row.quotaHours === '') return '不設上限'
  return `約 ${formatDaysAndHours(row.quotaHours)}${row.period === 'event' ? '（每次）' : ''}`
}

// 名稱固定、不能停用的內建假別：特休（扣特休時數）、調休（扣調休存摺）；伺服器也不接受改名、停用
const isFixedType = (row) => row.key === 'annual' || row.key === 'comp'

// 額度不是在這裡設定的假別：特休依員工資料，調休依調休存摺（國定假日適逢休息日／例假自動存入，不分年度）
function quotaSourceText(row) {
  if (row.source === 'employee_annual') return '依員工的年度特休時數'
  if (row.source === 'comp_bank') return '依調休存摺（不分年度）'
  return ''
}

// 特休超過剩餘時數、調休超過存摺可用時數一律無法送出（伺服器不看這個設定），所以它們的開關固定顯示為開啟
const isAlwaysBlocking = (row) => row.source === 'employee_annual' || row.source === 'comp_bank'
const isBlocking = (row) => isAlwaysBlocking(row) || row.enforcement === 'block'

// 超額時「禁止送出」或「只警告」；沒有額度的假別沒有可以超過的東西；特休、調休固定是禁止
function setBlocking(row, blocking) {
  if (isAlwaysBlocking(row)) {
    row.enforcement = 'block'
    return
  }
  row.enforcement = blocking ? 'block' : (row.source === 'policy' && (row.quotaHours === null || row.quotaHours === undefined) ? 'none' : 'warn')
}

const otherTypes = (row) => (policy.value?.types || []).filter(item => item.key !== row.key)

function setCountsAgainst(row, key) {
  row.countsAgainst = key ? { key, exemptHours: row.countsAgainst?.exemptHours ?? 0 } : null
}

function addCustomType() {
  const list = policy.value.types
  let index = list.filter(item => !item.builtin).length + 1
  while (list.some(item => item.key === `custom_${index}`)) index += 1
  list.push({
    key: `custom_${index}`,
    name: `自訂假別${index}`,
    aliases: [],
    quotaHours: null,
    period: 'year',
    source: 'policy',
    enforcement: 'none',
    display: 'when_used',
    countsAgainst: null,
    builtin: false,
    enabled: true,
    note: ''
  })
}

function removeType(index) {
  const removed = policy.value.types[index]
  policy.value.types.splice(index, 1)
  // 被刪掉的假別不能再被別的假別併入
  policy.value.types.forEach(item => {
    if (item.countsAgainst?.key === removed?.key) item.countsAgainst = null
  })
}

// 畫面上的「刪除」：先確認再從清單拿掉（按「儲存」才會真的刪除）
async function confirmRemoveType(index) {
  const target = policy.value?.types?.[index]
  if (!target) return
  try {
    await ElMessageBox.confirm(
      `要刪除自訂假別「${target.name}」嗎？按「儲存」後生效，已經用這個假別請的假不會再計入額度。`,
      '刪除假別',
      { type: 'warning', confirmButtonText: '刪除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  // 確認期間清單可能變了，用 key 重新找位置
  const currentIndex = policy.value.types.findIndex(item => item.key === target.key)
  if (currentIndex >= 0) removeType(currentIndex)
}

function restorePolicyDefaults() {
  if (!policyDefaults.value) return
  policy.value = clonePolicy(policyDefaults.value)
  ElMessage.info('已還原成預設值，按「儲存」才會生效')
}

async function savePolicy() {
  if (!policy.value || policySaving.value) return
  policySaving.value = true
  policyError.value = ''
  try {
    const res = await apiFetch('/api/other-control-settings/leave-policy', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(policy.value)
    })
    if (!res.ok) throw new Error(await readError(res, '儲存失敗'))
    const body = await res.json()
    applyLoadedPolicy(body.policy)
    ElMessage.success('已儲存假別額度規則')
  } catch (error) {
    const message = messageOf(error, '儲存失敗，請確認網路連線後再試')
    policyError.value = message
    ElMessage.error(message)
  } finally {
    policySaving.value = false
  }
}

/* -------------------- 離開前提醒未儲存的變更 -------------------- */
function handleBeforeUnload(event) {
  if (!policyDirty.value) return
  event.preventDefault()
  event.returnValue = ''
}

// 沒有安裝路由的環境（個別元件測試）不註冊路由守衛
if (getCurrentInstance()?.appContext.config.globalProperties.$router) {
  onBeforeRouteLeave(async () => {
    if (!policyDirty.value) return true
    try {
      await ElMessageBox.confirm('假別規則有未儲存的變更，確定要離開嗎？', '尚未儲存', {
        type: 'warning',
        confirmButtonText: '離開',
        cancelButtonText: '留在此頁'
      })
      return true
    } catch {
      return false
    }
  })
}

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
  loadPolicy()
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<style scoped>
.inline-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--hr-font-size-sm);
  color: var(--hr-gray-700);
}
.inline-field :deep(.el-input-number) {
  width: 110px;
}
/* 工具列右側的動作：寬度不夠換行時仍然靠右 */
.toolbar-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--hr-space-sm);
  margin-left: auto;
}

.toolbar-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
.unsaved-note {
  margin-top: 0;
}

.policy-hint {
  margin: 0 0 4px;
}
.policy-rules {
  border-top: none;
  border-bottom: none;
}
.policy-rules :deep(.el-collapse-item__header) {
  height: 32px;
  border-bottom: none;
  font-size: 13px;
  color: var(--hr-gray-600);
}
.policy-rules :deep(.el-collapse-item__wrap) {
  border-bottom: none;
}
.policy-rules :deep(.el-collapse-item__content) {
  padding-bottom: 8px;
}
.rule-list {
  margin: 0;
  padding-left: 18px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--hr-gray-600);
}
.policy-table {
  width: 100%;
  margin-top: 8px;
}
.policy-error {
  margin-bottom: 12px;
}
.row-note {
  display: block;
  color: var(--hr-gray-500);
  font-size: 12px;
  line-height: 1.5;
}
.counts-against {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
