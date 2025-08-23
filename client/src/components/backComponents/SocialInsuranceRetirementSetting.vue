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
  import { ref } from 'vue'
  
  const activeTab = ref('laborInsurance')
  
  // ==================== 勞保 ====================
  const laborForm = ref({
    enableRegisterFlow: true,
    autoUpdateRate: true,
    remindDays: 7,       // 7天前提醒
    monthlyCalcCheck: true,
    enableExport: true
  })
  function saveLaborSetting() {
    console.log('勞保設定:', laborForm.value)
    alert('已儲存「勞保設定」')
  }
  
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
  </style>
