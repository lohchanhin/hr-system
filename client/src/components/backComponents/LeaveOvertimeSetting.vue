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

onMounted(loadOvertimeRules)
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
.help-list {
  padding-left: 18px;
  line-height: 1.6;
}
</style>
