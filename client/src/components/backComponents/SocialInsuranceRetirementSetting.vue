<!-- src/Components/backComponents/SocialInsuranceRetirementSetting.vue -->
<!--
  勞健保設定：勞保、健保、勞退的級距表。
  - 勞保級距存在資料庫，薪資的勞保費依本薪對照這張表的員工負擔；「手動取得最新級距」會把系統內建（或設定的資料來源）的級距寫回資料庫。
  - 健保、勞退級距只供查閱：健保費、勞退自提以每位員工在員工管理設定的金額計算。
-->

<template>
  <div class="social-insurance-retirement-setting">
    <PageHeader title="勞健保設定" />

    <el-tabs v-model="activeTab">
      <el-tab-pane v-for="tab in RATE_TABS" :key="tab.name" :label="tab.label" :name="tab.name">
        <div class="hr-toolbar">
          <span class="hr-hint tab-hint">{{ tab.hint }}</span>
          <span class="hr-toolbar__spacer" />
          <span v-if="laborRateStatus[tab.name].lastFetched" class="hr-hint tab-hint" :data-test="`status-${tab.name}`">
            上次更新：{{ laborRateStatus[tab.name].lastFetched }} ｜ {{ laborRateStatus[tab.name].message }}
          </span>
          <el-button
            type="primary"
            :loading="refreshing[tab.name]"
            :data-test="`refresh-${tab.name}`"
            @click="refreshLaborInsuranceRates(tab.name)"
          >
            {{ tab.refreshLabel }}
          </el-button>
        </div>
        <el-alert
          v-if="loadErrors[tab.name]"
          type="error"
          :closable="false"
          show-icon
          class="load-error"
          :title="loadErrors[tab.name]"
          :data-test="`error-${tab.name}`"
        />
        <el-table
          v-loading="loading[tab.name]"
          :data="laborInsuranceRates[tab.name]"
          border
          stripe
          max-height="max(320px, calc(100vh - 260px))"
          :empty-text="loading[tab.name] ? '載入中…' : `尚未取得${tab.label}級距，請按「${tab.refreshLabel}」`"
        >
          <el-table-column prop="level" label="等級" width="80" align="center" />
          <el-table-column prop="insuredSalary" :label="tab.salaryLabel" min-width="130" align="right">
            <template #default="{ row }">{{ formatCurrency(row.insuredSalary) }}</template>
          </el-table-column>
          <el-table-column prop="workerFee" :label="tab.workerLabel" min-width="130" align="right">
            <template #default="{ row }">{{ formatCurrency(row.workerFee) }}</template>
          </el-table-column>
          <el-table-column prop="employerFee" :label="tab.employerLabel" min-width="130" align="right">
            <template #default="{ row }">{{ formatCurrency(row.employerFee) }}</template>
          </el-table-column>
          <template v-if="tab.name === 'laborInsurance'">
            <el-table-column prop="ordinaryRate" label="普通費率 (%)" width="120" align="center" />
            <el-table-column prop="employmentInsuranceRate" label="就保費率 (%)" width="120" align="center" />
          </template>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
// vLoading：這個元件的測試不掛整套 Element Plus，v-loading 要自己引入
import { ElMessage, vLoading } from 'element-plus'
import { apiFetch } from '@/api'
import { formatTaiwanDateTime } from '@/utils/dateFormatter'
import PageHeader from '@/components/PageHeader.vue'

const RATE_TABS = [
  {
    name: 'laborInsurance',
    label: '勞保',
    refreshLabel: '手動取得最新級距',
    hint: '薪資的勞保費依本薪對照這張表的「員工負擔」計算。',
    salaryLabel: '投保薪資',
    workerLabel: '員工負擔',
    employerLabel: '雇主負擔',
  },
  {
    name: 'healthInsurance',
    label: '健保',
    refreshLabel: '手動取得最新健保級距',
    hint: '僅供查閱：健保費以每位員工在「員工管理」設定的自付額計算。',
    salaryLabel: '投保薪資',
    workerLabel: '員工負擔',
    employerLabel: '雇主負擔',
  },
  {
    name: 'retirement',
    label: '勞退',
    refreshLabel: '手動取得最新勞退級距',
    hint: '僅供查閱：勞退自提以每位員工在「員工管理」設定的金額計算。',
    salaryLabel: '月提繳級距',
    workerLabel: '員工自提 (示意)',
    employerLabel: '雇主提撥 (示意)',
  },
]
const RATE_TYPES = RATE_TABS.map((tab) => tab.name)
const byType = (value) => Object.fromEntries(RATE_TYPES.map((type) => [type, typeof value === 'function' ? value() : value]))

const activeTab = ref('laborInsurance')
const laborInsuranceRates = ref(byType(() => []))
const laborRateStatus = ref(byType(() => ({ lastFetched: '', message: '' })))
const loading = reactive(byType(false))
const refreshing = reactive(byType(false))
const loadErrors = reactive(byType(''))
const rateTypeLabel = Object.fromEntries(RATE_TABS.map((tab) => [tab.name, tab.label]))

let unmounted = false

function formatCurrency(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? `NT$ ${Math.round(amount).toLocaleString('en-US')}` : '-'
}

// 只顯示中文訊息：網路中斷時瀏覽器丟出的是英文（Failed to fetch），換成看得懂的說法
const messageOf = (error, fallback) => (/[一-鿿]/.test(error?.message || '') ? error.message : fallback)

async function readError(res, fallback) {
  try {
    const body = await res.json()
    const message = body?.error || body?.message
    // 伺服器的錯誤訊息是英文時改用這裡的說法
    return typeof message === 'string' && /[一-鿿]/.test(message) ? message : fallback
  } catch {
    return fallback
  }
}

function buildStatusPayload(type, message) {
  return {
    lastFetched: formatTaiwanDateTime(new Date()),
    message: message || `${rateTypeLabel[type] || '級距'}資料已載入`
  }
}

async function fetchLaborInsuranceRates(type = 'laborInsurance') {
  loading[type] = true
  loadErrors[type] = ''
  try {
    const res = await apiFetch(`/api/payroll/insurance/rates?type=${type}`)
    if (!res.ok) throw new Error(await readError(res, `${rateTypeLabel[type]}級距載入失敗，請稍後再試`))
    const data = await res.json()
    if (unmounted) return
    laborInsuranceRates.value[type] = Array.isArray(data) ? data : []
  } catch (error) {
    if (unmounted) return
    // 讀取失敗要說出來，不能只留一張空表
    laborInsuranceRates.value[type] = []
    loadErrors[type] = messageOf(error, `${rateTypeLabel[type]}級距載入失敗，請確認網路連線後再試`)
  } finally {
    loading[type] = false
  }
}

async function refreshLaborInsuranceRates(type = activeTab.value) {
  // 更新中再按一次不重複送出
  if (refreshing[type]) return
  refreshing[type] = true
  try {
    const res = await apiFetch(`/api/payroll/insurance/refresh?type=${type}`, { method: 'POST' })
    if (!res.ok) throw new Error(await readError(res, `${rateTypeLabel[type]}級距更新失敗，請稍後再試`))
    const data = await res.json()
    if (unmounted) return
    laborRateStatus.value[type] = buildStatusPayload(type, data.message)
    loadErrors[type] = ''
    if (Array.isArray(data.rates) && data.rates.length > 0) {
      laborInsuranceRates.value[type] = data.rates
    } else {
      await fetchLaborInsuranceRates(type)
    }
    ElMessage.success(`${rateTypeLabel[type]}級距已更新`)
  } catch (error) {
    if (unmounted) return
    ElMessage.error(messageOf(error, `${rateTypeLabel[type]}級距更新失敗，請確認網路連線後再試`))
  } finally {
    refreshing[type] = false
  }
}

onMounted(async () => {
  await Promise.all(RATE_TYPES.map((type) => fetchLaborInsuranceRates(type)))
})

onBeforeUnmount(() => {
  unmounted = true
})
</script>

<style scoped>
.tab-hint {
  margin-top: 0;
}
.load-error {
  margin-bottom: var(--hr-space-sm);
}
</style>
