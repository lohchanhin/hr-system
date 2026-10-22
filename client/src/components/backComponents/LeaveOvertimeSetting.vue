<!-- src/Components/backComponents/LeaveOvertimeSetting.vue -->

<template>
  <div class="leave-overtime-setting">
    <div class="header">
      <h2>請假與加班設定</h2>
      <el-button type="info" plain size="small" @click="showHelp = true">說明</el-button>
    </div>

    <div class="card">
      <h3>加班倍率設定</h3>
      <p class="hint">僅保留加班倍率設定；原假別/簽核/補休頁籤已移除。</p>
      <el-form :model="overtimeRules" label-width="200px" class="rule-form">
        <el-divider content-position="left">工作日加班 (1-8 小時)</el-divider>
        <el-form-item label="前兩小時倍率">
          <el-input-number v-model="overtimeRules.workday.first2" :min="1" :step="0.01" />
        </el-form-item>
        <el-form-item label="後兩小時倍率">
          <el-input-number v-model="overtimeRules.workday.next2" :min="1" :step="0.01" />
        </el-form-item>

        <el-divider content-position="left">休息日</el-divider>
        <el-form-item label="前兩小時倍率">
          <el-input-number v-model="overtimeRules.restDay.first2" :min="1" :step="0.01" />
        </el-form-item>
        <el-form-item label="3-8 小時倍率">
          <el-input-number v-model="overtimeRules.restDay.next6" :min="1" :step="0.01" />
        </el-form-item>
        <el-form-item label="9-12 小時倍率">
          <el-input-number v-model="overtimeRules.restDay.after8" :min="1" :step="0.01" />
        </el-form-item>

        <el-divider content-position="left">國定假日出勤</el-divider>
        <el-form-item label="全日工資/時薪倍率">
          <el-input-number v-model="overtimeRules.nationalHoliday.base" :min="1" :step="0.01" />
        </el-form-item>
        <el-form-item label="加班 9-10 小時倍率">
          <el-input-number v-model="overtimeRules.nationalHoliday.hour9to10" :min="1" :step="0.01" />
        </el-form-item>
        <el-form-item label="加班 11-12 小時倍率">
          <el-input-number v-model="overtimeRules.nationalHoliday.hour11to12" :min="1" :step="0.01" />
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="persistOvertimeRules">儲存倍率</el-button>
        </el-form-item>
      </el-form>
    </div>

    <!-- 假別額度與餘額規則：請假的單位是小時，員工與主管看到的各假別剩餘時數、超額時能不能送出都在這裡設定 -->
    <div class="card policy-card" data-test="leave-policy-card">
      <h3>假別額度與餘額規則</h3>
      <p class="hint">
        請假一律以小時為單位（1 天 = 8 小時）。額度預設是法定天數換成小時，特休依員工資料，調休依調休存摺（系統累計，不分年度）。
        超額時預設只警告（簽核人看得到），勾選「超額禁止送出」則直接擋下；特休、調休一律以剩餘時數檢查，超過就無法送出（開關固定為開啟，不能改成只警告）。
      </p>
      <el-alert v-if="policyError" type="error" :closable="false" show-icon class="policy-error" :title="policyError" />
      <div v-loading="policyLoading">
        <el-form v-if="policy" :model="policy" label-width="200px" class="rule-form">
          <el-form-item label="每日最多可請時數">
            <el-input-number v-model="policy.maxHoursPerDay" :min="1" :max="24" :step="0.5" data-test="policy-max-hours" />
            <span class="unit">小時</span>
            <span class="hint inline">請假單的時數不能超過所選期間（每天最多這麼多小時）；12 小時輪班的單位可以設 12</span>
          </el-form-item>
          <el-form-item label="最小請假單位">
            <el-select v-model="policy.minUnitHours" style="width: 140px">
              <el-option v-for="unit in minUnitChoices" :key="unit" :label="`${unit} 小時`" :value="unit" />
            </el-select>
          </el-form-item>
        </el-form>

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
              <el-button v-if="!row.builtin" link type="danger" size="small" @click="removeType($index)">刪除</el-button>
            </template>
          </el-table-column>
        </el-table>

        <div v-if="policy" class="policy-actions">
          <el-button size="small" @click="addCustomType">新增自訂假別</el-button>
          <el-button size="small" @click="restorePolicyDefaults">還原預設（尚未儲存）</el-button>
          <el-button type="primary" :loading="policySaving" data-test="policy-save" @click="savePolicy">儲存假別規則</el-button>
          <el-button v-if="policyError" size="small" @click="loadPolicy">重新載入</el-button>
        </div>
      </div>
    </div>
  </div>

  <el-dialog v-model="showHelp" title="加班與簽核說明" width="520px">
    <ul class="help-list">
      <li>工作日加班：1-8 小時；前 2 小時 1.34 倍，後 2 小時 1.67 倍。</li>
      <li>休息日：前 2 小時 1.34 倍，3-8 小時 1.67 倍，9-12 小時 2.67 倍。</li>
      <li>國定假日：出勤全日 2 倍；加班 9-10 小時 1.34 倍，11-12 小時 1.67 倍。</li>
      <li>套用簽核時請依表單類型套用相同倍率，計算時會套用此設定。</li>
    </ul>
    <template #footer>
      <el-button @click="showHelp = false">關閉</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../../api'
import { formatDaysAndHours } from '../../utils/leaveBalance'

const showHelp = ref(false)
const overtimeRules = ref({
  workday: { first2: 1.34, next2: 1.67 },
  restDay: { first2: 1.34, next6: 1.67, after8: 2.67 },
  nationalHoliday: { base: 2, hour9to10: 1.34, hour11to12: 1.67 }
})

async function loadOvertimeRules() {
  try {
    const saved = localStorage.getItem('overtime_rules_v2')
    if (saved) {
      const parsed = JSON.parse(saved)
      overtimeRules.value = { ...overtimeRules.value, ...parsed }
    }
  } catch (e) {
    console.warn('讀取加班倍率失敗，使用預設值')
  }
}

async function persistOvertimeRules() {
  try {
    localStorage.setItem('overtime_rules_v2', JSON.stringify(overtimeRules.value))
    ElMessage.success('已儲存加班倍率設定')
  } catch (e) {
    ElMessage.error(e.message || '儲存失敗')
  }
}

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

const clonePolicy = (value) => JSON.parse(JSON.stringify(value))

async function readError(res, fallback) {
  try {
    const body = await res.json()
    return body?.error || fallback
  } catch {
    return fallback
  }
}

async function loadPolicy() {
  policyLoading.value = true
  policyError.value = ''
  try {
    const res = await apiFetch('/api/other-control-settings/leave-policy')
    if (!res.ok) throw new Error(await readError(res, '無法讀取假別額度規則'))
    const body = await res.json()
    policy.value = clonePolicy(body.policy)
    // 特休、調休一律禁止超額送出：舊資料存成 warn / none 也顯示並儲存成 block，和實際行為一致
    for (const row of policy.value?.types || []) if (isAlwaysBlocking(row)) row.enforcement = 'block'
    policyDefaults.value = clonePolicy(body.defaults || body.policy)
  } catch (error) {
    policyError.value = error?.message || '無法讀取假別額度規則'
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

function restorePolicyDefaults() {
  if (!policyDefaults.value) return
  policy.value = clonePolicy(policyDefaults.value)
  ElMessage.info('已還原成預設值，按「儲存假別規則」才會生效')
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
    policy.value = clonePolicy(body.policy)
    ElMessage.success('已儲存假別額度規則')
  } catch (error) {
    const message = error?.message || '儲存失敗'
    policyError.value = message
    ElMessage.error(message)
  } finally {
    policySaving.value = false
  }
}

onMounted(() => {
  loadOvertimeRules()
  loadPolicy()
})
</script>

<style scoped>
.leave-overtime-setting {
  padding: 20px;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 16px;
}
.rule-form {
  margin-top: 12px;
  max-width: 520px;
}
.hint {
  color: #909399;
  font-size: 13px;
  margin-bottom: 8px;
}
.hint.inline {
  margin: 0 0 0 12px;
}
.card + .card {
  margin-top: 16px;
}
.policy-card .rule-form {
  max-width: none;
}
.policy-table {
  width: 100%;
  margin-top: 8px;
}
.policy-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.policy-error {
  margin-bottom: 12px;
}
.unit {
  margin-left: 8px;
  color: #606266;
}
.row-note {
  display: block;
  color: #909399;
  font-size: 12px;
  line-height: 1.5;
}
.counts-against {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.help-list {
  padding-left: 18px;
  line-height: 1.6;
}
</style>
