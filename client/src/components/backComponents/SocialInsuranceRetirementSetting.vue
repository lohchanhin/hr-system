<!-- src/Components/backComponents/SocialInsuranceRetirementSetting.vue -->

<template>
    <div class="social-insurance-retirement-setting">
      <h2>勞健保、勞退管理設定</h2>
  
      <el-tabs v-model="activeTab" type="card">
        <!-- 1) 勞保設定 -->
        <el-tab-pane label="勞保設定" name="laborInsurance">
          <div class="tab-content">
            <el-form :model="laborForm" label-width="180px">
              <el-form-item label="勞保加退保流程 (新進/離職)">
                <el-switch v-model="laborForm.enableRegisterFlow" />
              </el-form-item>
            <el-form-item label="每年勞保費率/投保級距">
              <el-switch v-model="laborForm.autoUpdateRate" />
              <small>若啟用，系統可自動跟隨勞保局公告更新</small>
            </el-form-item>
            <el-form-item label="取得官方最新級距">
              <el-button type="primary" @click="refreshLaborInsuranceRates">取得最新</el-button>
              <div class="form-help">定期與勞保局公告比對並更新級距</div>
              <div v-if="laborRateStatus.lastFetched" class="form-help">
                上次確認：{{ laborRateStatus.lastFetched }} ｜ {{ laborRateStatus.message }}
              </div>
            </el-form-item>
            <el-form-item label="目前勞保級距表">
              <el-button type="info" @click="showLaborRateTable = !showLaborRateTable">
                {{ showLaborRateTable ? '隱藏級距表' : '顯示級距表' }}
              </el-button>
              <div v-if="showLaborRateTable" style="margin-top: 15px;">
                <el-table :data="laborInsuranceRates" border stripe max-height="400">
                  <el-table-column prop="level" label="等級" width="80" align="center" />
                  <el-table-column prop="insuredSalary" label="投保薪資" width="120" align="right">
                    <template #default="{ row }">
                      NT$ {{ row.insuredSalary.toLocaleString() }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="workerFee" label="員工負擔" width="120" align="right">
                    <template #default="{ row }">
                      NT$ {{ row.workerFee.toLocaleString() }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="employerFee" label="雇主負擔" width="120" align="right">
                    <template #default="{ row }">
                      NT$ {{ row.employerFee.toLocaleString() }}
                    </template>
                  </el-table-column>
                  <el-table-column prop="ordinaryRate" label="普通費率 (%)" width="120" align="center" />
                  <el-table-column prop="employmentInsuranceRate" label="就保費率 (%)" width="120" align="center" />
                </el-table>
                <div class="form-help" style="margin-top: 10px;">
                  共 {{ laborInsuranceRates.length }} 個級距
                </div>
              </div>
            </el-form-item>
            <el-form-item label="投保級距異動提醒(天)">
              <el-input-number v-model="laborForm.remindDays" :min="1" />
              <small>異動前幾天通知 HR ？</small>
            </el-form-item>
              <el-form-item label="每月勞保費計算與檢核">
                <el-switch v-model="laborForm.monthlyCalcCheck" />
              </el-form-item>
              <el-form-item label="申報格式匯出">
                <el-switch v-model="laborForm.enableExport" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveLaborSetting">儲存勞保設定</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
  
        <!-- 2) 健保設定 -->
        <el-tab-pane label="健保設定" name="healthInsurance">
          <div class="tab-content">
            <el-form :model="healthForm" label-width="180px">
              <el-form-item label="健保加退保流程 (新進/離職)">
                <el-switch v-model="healthForm.enableRegisterFlow" />
              </el-form-item>
              <el-form-item label="員工眷屬加退保管理">
                <el-switch v-model="healthForm.dependentManagement" />
              </el-form-item>
              <el-form-item label="每年健保費率/投保級距">
                <el-switch v-model="healthForm.autoUpdateRate" />
              </el-form-item>
              <el-form-item label="每月健保費計算(含眷屬)">
                <el-switch v-model="healthForm.monthlyCalcCheck" />
              </el-form-item>
              <el-form-item label="健保申報格式匯出">
                <el-switch v-model="healthForm.enableExport" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveHealthSetting">儲存健保設定</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
  
        <!-- 3) 勞退設定 (新制退休金) -->
        <el-tab-pane label="勞退設定" name="retirement">
          <div class="tab-content">
            <el-form :model="retireForm" label-width="180px">
              <el-form-item label="勞退(新制)加退保流程">
                <el-switch v-model="retireForm.enableRetirementFlow" />
              </el-form-item>
              <el-form-item label="提撥級距自動更新">
                <el-switch v-model="retireForm.autoUpdateRate" />
                <small>每年若勞保局公告變動，系統自動更新</small>
              </el-form-item>
              <el-form-item label="月提撥計算(員工自提/雇主提撥)">
                <el-switch v-model="retireForm.monthlyCalcCheck" />
              </el-form-item>
              <el-form-item label="提撥紀錄異動提醒(天)">
                <el-input-number v-model="retireForm.remindDays" :min="1" />
              </el-form-item>
              <el-form-item label="申報格式匯出">
                <el-switch v-model="retireForm.enableExport" />
              </el-form-item>
              <el-form-item>
                <el-button type="primary" @click="saveRetireSetting">儲存勞退設定</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </template>
  
<script setup>
import { ref, onMounted } from 'vue'
import { apiFetch } from '@/api'
  
  const activeTab = ref('laborInsurance')
  
  // ==================== 勞保 ====================
const laborForm = ref({
  enableRegisterFlow: true,
  autoUpdateRate: true,
  remindDays: 7,       // 7天前提醒
  monthlyCalcCheck: true,
  enableExport: true
})
const laborRateStatus = ref({
  lastFetched: '',
  message: ''
})
const showLaborRateTable = ref(false)
const laborInsuranceRates = ref([])

function saveLaborSetting() {
  console.log('勞保設定:', laborForm.value)
  alert('已儲存「勞保設定」')
}

async function fetchLaborInsuranceRates() {
  try {
    const res = await apiFetch('/api/payroll/insurance/rates')
    if (res.ok) {
      laborInsuranceRates.value = await res.json()
    } else {
      console.error('Failed to fetch labor insurance rates')
      laborInsuranceRates.value = []
    }
  } catch (error) {
    console.error('Error fetching labor insurance rates:', error)
    laborInsuranceRates.value = []
  }
}

async function refreshLaborInsuranceRates() {
  try {
    const res = await apiFetch('/api/payroll/insurance/refresh', { method: 'POST' })
    if (res.ok) {
      const data = await res.json()
      laborRateStatus.value = {
        lastFetched: new Date().toLocaleString(),
        message: data.message || (data.isUpToDate ? '勞保級距已是最新' : '已同步最新勞保級距')
      }
      alert(laborRateStatus.value.message)
      // Refresh the rate table after update
      await fetchLaborInsuranceRates()
    } else {
      alert('取得最新勞保級距失敗')
    }
  } catch (error) {
    console.error('refreshLaborInsuranceRates error', error)
    alert('取得最新勞保級距失敗')
  }
}

onMounted(() => {
  fetchLaborInsuranceRates()
})
  
  // ==================== 健保 ====================
  const healthForm = ref({
    enableRegisterFlow: true,
    dependentManagement: true,
    autoUpdateRate: true,
    monthlyCalcCheck: true,
    enableExport: true
  })
  function saveHealthSetting() {
    console.log('健保設定:', healthForm.value)
    alert('已儲存「健保設定」')
  }
  
  // ==================== 勞退 ====================
  const retireForm = ref({
    enableRetirementFlow: true,
    autoUpdateRate: true,
    monthlyCalcCheck: true,
    remindDays: 7,
    enableExport: true
  })
  function saveRetireSetting() {
    console.log('勞退設定:', retireForm.value)
    alert('已儲存「勞退設定」')
  }
  </script>
  
  <style scoped>
  .social-insurance-retirement-setting {
    padding: 20px;
  }
  
  .tab-content {
    margin-top: 20px;
  }

  .form-help {
    margin-top: 5px;
    font-size: 12px;
    color: #909399;
  }
  </style>
