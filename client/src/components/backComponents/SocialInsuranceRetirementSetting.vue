<!-- src/Components/backComponents/SocialInsuranceRetirementSetting.vue -->

<template>
  <div class="social-insurance-retirement-setting">
    <div class="header">
      <h2>勞健保、勞退管理設定</h2>
      <el-button type="info" plain size="small" @click="showHelp = true">說明</el-button>
    </div>

    <el-tabs v-model="activeTab" type="card">
      <el-tab-pane label="勞保" name="laborInsurance">
        <div class="tab-content">
          <el-space>
            <el-button type="primary" @click="refreshLaborInsuranceRates('laborInsurance')">手動取得最新級距</el-button>
            <el-button @click="toggleRateTable">{{ showLaborRateTable ? '隱藏級距表' : '顯示級距表' }}</el-button>
          </el-space>
          <div class="form-help" v-if="laborRateStatus.laborInsurance.lastFetched">
            上次更新：{{ laborRateStatus.laborInsurance.lastFetched }} ｜ {{ laborRateStatus.laborInsurance.message }}
          </div>
          <div v-if="showLaborRateTable" style="margin-top: 15px;">
            <el-table :data="laborInsuranceRates.laborInsurance" border stripe max-height="400">
              <el-table-column prop="level" label="等級" width="80" align="center" />
              <el-table-column prop="insuredSalary" label="投保薪資" width="120" align="right">
                <template #default="{ row }">NT$ {{ row.insuredSalary.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column prop="workerFee" label="員工負擔" width="120" align="right">
                <template #default="{ row }">NT$ {{ row.workerFee.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column prop="employerFee" label="雇主負擔" width="120" align="right">
                <template #default="{ row }">NT$ {{ row.employerFee.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column prop="ordinaryRate" label="普通費率 (%)" width="120" align="center" />
              <el-table-column prop="employmentInsuranceRate" label="就保費率 (%)" width="140" align="center" />
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="健保" name="healthInsurance">
        <div class="tab-content">
          <el-space>
            <el-button type="primary" @click="refreshLaborInsuranceRates('healthInsurance')">手動取得最新健保級距</el-button>
            <el-button @click="toggleRateTable">{{ showLaborRateTable ? '隱藏級距表' : '顯示級距表' }}</el-button>
          </el-space>
          <div class="form-help" v-if="laborRateStatus.healthInsurance.lastFetched">
            上次更新：{{ laborRateStatus.healthInsurance.lastFetched }} ｜ {{ laborRateStatus.healthInsurance.message }}
          </div>
          <div v-if="showLaborRateTable" style="margin-top: 15px;">
            <el-table :data="laborInsuranceRates.healthInsurance" border stripe max-height="400">
              <el-table-column prop="level" label="等級" width="80" align="center" />
              <el-table-column prop="insuredSalary" label="投保薪資" width="120" align="right">
                <template #default="{ row }">NT$ {{ row.insuredSalary.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column prop="workerFee" label="員工負擔" width="120" align="right">
                <template #default="{ row }">NT$ {{ row.workerFee.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column prop="employerFee" label="雇主負擔" width="120" align="right">
                <template #default="{ row }">NT$ {{ row.employerFee.toLocaleString() }}</template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane label="勞退" name="retirement">
        <div class="tab-content">
          <el-space>
            <el-button type="primary" @click="refreshLaborInsuranceRates('retirement')">手動取得最新勞退級距</el-button>
            <el-button @click="toggleRateTable">{{ showLaborRateTable ? '隱藏級距表' : '顯示級距表' }}</el-button>
          </el-space>
          <div class="form-help" v-if="laborRateStatus.retirement.lastFetched">
            上次更新：{{ laborRateStatus.retirement.lastFetched }} ｜ {{ laborRateStatus.retirement.message }}
          </div>
          <div v-if="showLaborRateTable" style="margin-top: 15px;">
            <el-table :data="laborInsuranceRates.retirement" border stripe max-height="400">
              <el-table-column prop="level" label="等級" width="80" align="center" />
              <el-table-column prop="insuredSalary" label="月提繳級距" width="140" align="right">
                <template #default="{ row }">NT$ {{ row.insuredSalary.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column prop="workerFee" label="員工自提 (示意)" width="140" align="right">
                <template #default="{ row }">NT$ {{ row.workerFee.toLocaleString() }}</template>
              </el-table-column>
              <el-table-column prop="employerFee" label="雇主提撥 (示意)" width="160" align="right">
                <template #default="{ row }">NT$ {{ row.employerFee.toLocaleString() }}</template>
              </el-table-column>
            </el-table>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>

  <el-dialog v-model="showHelp" title="勞健保/勞退說明" width="500px">
    <ul class="help-list">
      <li>已移除自動加退保流程與自動更新開關，改為手動更新最新級距。</li>
      <li>健保、勞退頁面結構與勞保一致，僅供查閱與手動更新。</li>
      <li>更新後資料將套用於薪資計算中的保費/勞退自提計算。</li>
    </ul>
    <template #footer>
      <el-button @click="showHelp = false">關閉</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { apiFetch } from '@/api'

const activeTab = ref('laborInsurance')
const showHelp = ref(false)
const showLaborRateTable = ref(false)
const laborInsuranceRates = ref({
  laborInsurance: [],
  healthInsurance: [],
  retirement: []
})
const laborRateStatus = ref({
  laborInsurance: { lastFetched: '', message: '' },
  healthInsurance: { lastFetched: '', message: '' },
  retirement: { lastFetched: '', message: '' }
})

function toggleRateTable() {
  showLaborRateTable.value = !showLaborRateTable.value
}

function buildStatusPayload(type, message) {
  return {
    lastFetched: new Date().toLocaleString(),
    message: message || '已從官網取得最新級距'
  }
}

async function fetchLaborInsuranceRates(type = 'laborInsurance') {
  try {
    const res = await apiFetch(`/api/payroll/insurance/rates?type=${type}`)
    if (res.ok) {
      laborInsuranceRates.value[type] = await res.json()
    } else {
      laborInsuranceRates.value[type] = []
    }
  } catch (error) {
    console.error(`Error fetching ${type} insurance rates:`, error)
    laborInsuranceRates.value[type] = []
  }
}

async function refreshLaborInsuranceRates(type = activeTab.value) {
  try {
    const res = await apiFetch(`/api/payroll/insurance/refresh?type=${type}`, { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      laborRateStatus.value[type] = buildStatusPayload(type, data.message || (data.isUpToDate ? '級距已是最新' : '已同步最新級距'))
      if (Array.isArray(data.rates) && data.rates.length > 0) {
        laborInsuranceRates.value[type] = data.rates
      } else {
        await fetchLaborInsuranceRates(type)
      }
    }
  } catch (error) {
    console.error(`refreshLaborInsuranceRates error for ${type}`, error)
  }
}

onMounted(() => {
  ;['laborInsurance', 'healthInsurance', 'retirement'].forEach(fetchLaborInsuranceRates)
})

watch(activeTab, (tab) => {
  if (!laborInsuranceRates.value[tab]?.length) {
    fetchLaborInsuranceRates(tab)
  }
})
</script>

<style scoped>
.social-insurance-retirement-setting {
  padding: 20px;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.tab-content {
  margin-top: 20px;
}
.form-help {
  margin-top: 5px;
  font-size: 12px;
  color: #909399;
}
.hint {
  color: #909399;
  margin-bottom: 10px;
}
.help-list {
  padding-left: 18px;
  line-height: 1.6;
}
</style>
