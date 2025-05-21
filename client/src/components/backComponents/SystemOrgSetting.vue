<!-- src/components/backComponents/SystemOrgSetting.vue -->
<template>
  <el-tab-pane label="系統基本資料" name="systemOrg">
    <div class="tab-content">
      <el-form :model="systemForm" label-width="140px">
        <el-form-item label="機構(公司)名稱">
          <el-input v-model="systemForm.companyName" placeholder="輸入公司名稱" />
        </el-form-item>
        <el-form-item label="機構代碼">
          <el-input v-model="systemForm.companyCode" placeholder="如：ABCD01" />
        </el-form-item>
        <el-form-item label="聯絡電話">
          <el-input v-model="systemForm.phone" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="systemForm.address" />
        </el-form-item>
        <el-form-item label="系統參數 (示範)">
          <el-switch v-model="systemForm.enableMultiLang" active-text="多語系" inactive-text="單語系" />
          <small>可在此加入更多參數(時區、民國年/西元年…)</small>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="saveSystemOrg">儲存系統/機構設定</el-button>
        </el-form-item>
      </el-form>
    </div>
  </el-tab-pane>
</template>

<script setup>
import { ref } from 'vue'

const systemForm = ref({
  companyName: '示範股份有限公司',
  companyCode: 'ABC123',
  phone: '02-1234-5678',
  address: '台北市某某路 100 號',
  enableMultiLang: false
})

function saveSystemOrg() {
  console.log('儲存系統/機構資料:', systemForm.value)
  alert('已儲存「系統/機構設定」')
}
</script>
