<!-- src/views/front/Attendance.vue -->
<template>
  <div class="attendance-page">
    <!-- 添加現代化的頁面標題和描述區域 -->
    <div class="page-header">
      <div class="header-content">
        <h1 class="page-title">出勤打卡</h1>
        <p class="page-description">快速進行上下班打卡、外出登記和補卡操作</p>
      </div>
      <div class="current-time">
        <div class="time-display">{{ currentTime }}</div>
        <div class="date-display">{{ currentDate }}</div>
      </div>
    </div>

    <!-- 重新設計打卡按鈕區域，使用卡片式布局和圖標 -->
    <div class="punch-section">
      <h2 class="section-title">快速打卡</h2>
      <div class="punch-grid">
        <div class="punch-card" @click="onClockIn">
          <div class="punch-icon clock-in">
            <i class="el-icon-sunrise"></i>
          </div>
          <h3 class="punch-title">上班簽到</h3>
          <p class="punch-desc">開始新的一天</p>
        </div>
        
        <div class="punch-card" @click="onClockOut">
          <div class="punch-icon clock-out">
            <i class="el-icon-sunset"></i>
          </div>
          <h3 class="punch-title">下班簽退</h3>
          <p class="punch-desc">結束工作時間</p>
        </div>
        
        <div class="punch-card" @click="onOuting">
          <div class="punch-icon outing">
            <i class="el-icon-position"></i>
          </div>
          <h3 class="punch-title">外出登記</h3>
          <p class="punch-desc">臨時外出記錄</p>
        </div>
        
        <div class="punch-card" @click="onBreakIn">
          <div class="punch-icon break-time">
            <i class="el-icon-coffee-cup"></i>
          </div>
          <h3 class="punch-title">休息時間</h3>
          <p class="punch-desc">中午休息登記</p>
        </div>
      </div>
    </div>

    <!-- 美化打卡記錄表格，添加更好的視覺層次 -->
    <div class="records-section">
      <h2 class="section-title">今日打卡記錄</h2>
      <div class="table-container">
        <el-table
          :data="records"
          class="records-table"
          :header-cell-style="{ background: '#f8fafc', color: '#475569', fontWeight: '600' }"
          :row-style="{ height: '56px' }"
        >
          <el-table-column prop="action" label="打卡類型" width="140">
            <template #default="{ row }">
              <el-tag 
                :type="getActionTagType(row.action)" 
                class="action-tag"
              >
                {{ row.action }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="time" label="打卡時間" width="200">
            <template #default="{ row }">
              <div class="time-cell">
                <i class="el-icon-time time-icon"></i>
                {{ row.time }}
              </div>
            </template>
          </el-table-column>
          <el-table-column prop="remark" label="備註說明">
            <template #default="{ row }">
              <span class="remark-text">{{ row.remark || '無備註' }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </div>

    <el-dialog v-model="remarkDialogVisible" title="新增備註" width="400px">
      <el-input v-model="remarkText" placeholder="請輸入備註（可留空）" />
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="remarkDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="confirmRemark">確認</el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import dayjs from 'dayjs'
import { ElMessage } from 'element-plus'
import { apiFetch } from '../../api'
import { getToken } from '../../utils/tokenService'

// 將中文動作與後端定義的值互轉
const actionMap = {
  '上班簽到': 'clockIn',
  '下班簽退': 'clockOut',
  '外出登記': 'outing',
  '中午休息': 'breakIn'
}
const reverseActionMap = Object.fromEntries(
  Object.entries(actionMap).map(([k, v]) => [v, k])
)

const records = ref([])
const currentTime = ref('')
const currentDate = ref('')
let timeInterval = null

const remarkDialogVisible = ref(false)
const remarkText = ref('')
const pendingAction = ref('')

async function fetchRecords() {
  const res = await apiFetch('/api/attendance')
  if (res.ok) {
    const data = await res.json()
    records.value = data.map(r => {
      const timestamp = r.timestamp
      return {
        action: reverseActionMap[r.action] || r.action,
        time: timestamp ? dayjs(timestamp).format('YYYY/MM/DD HH:mm:ss') : '',
        remark: r.remark || '',
        timestamp
      }
    })
  }
}

function onClockIn() {
  openRemarkDialog('上班簽到')
}
function onClockOut() {
  openRemarkDialog('下班簽退')
}
function onOuting() {
  openRemarkDialog('外出登記')
}
function onBreakIn() {
  openRemarkDialog('中午休息')
}

function openRemarkDialog(action) {
  pendingAction.value = action
  remarkText.value = ''
  remarkDialogVisible.value = true
}

async function confirmRemark() {
  remarkDialogVisible.value = false
  await addRecord(pendingAction.value, remarkText.value)
}

function getEmployeeId() {
  let id = localStorage.getItem('employeeId')
  if (!id) {
    const token = getToken()
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]))
        id = payload.employeeId || payload.id
      } catch (e) {
        id = null
      }
    }
  }
  return id
}

async function addRecord(action, remark = '') {
  const employeeId = getEmployeeId()
  if (!employeeId) {
    ElMessage.warning('請重新登入')
    return
  }
  const payload = {
    action: actionMap[action] || action,
    timestamp: new Date(),
    remark,
    employee: employeeId
  }
  const res = await apiFetch('/api/attendance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  if (res.ok) {
    const saved = await res.json()
    const timestamp = saved.timestamp || payload.timestamp
    const savedRecord = {
      action: reverseActionMap[saved.action] || saved.action,
      time: timestamp ? dayjs(timestamp).format('YYYY/MM/DD HH:mm:ss') : '',
      remark: saved.remark || '',
      timestamp
    }
    records.value.unshift(savedRecord)
  }
}

function updateTime() {
  const now = dayjs()
  currentTime.value = now.format('HH:mm:ss')
  currentDate.value = now.format('YYYY/MM/DD')
}

function getActionTagType(action) {
  const typeMap = {
    '上班簽到': 'success',
    '下班簽退': 'warning', 
    '外出登記': 'info',
    '中午休息': 'primary'
  }
  return typeMap[action] || 'default'
}

onMounted(() => {
  fetchRecords()
  updateTime()
  timeInterval = setInterval(updateTime, 1000)
})

onUnmounted(() => {
  if (timeInterval) {
    clearInterval(timeInterval)
  }
})
</script>

<style scoped>
.attendance-page {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0;
}

/* 頁面標題區域 */
.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(135deg, #164e63 0%, #0891b2 100%);
  color: white;
  padding: 32px;
  border-radius: 16px;
  margin-bottom: 32px;
  box-shadow: 0 4px 20px rgba(22, 78, 99, 0.3);
}

.header-content h1.page-title {
  font-size: 28px;
  font-weight: 700;
  margin: 0 0 8px 0;
  letter-spacing: 0.5px;
}

.page-description {
  font-size: 16px;
  opacity: 0.9;
  margin: 0;
}

.current-time {
  text-align: right;
}

.time-display {
  font-size: 32px;
  font-weight: 700;
  font-family: 'Courier New', monospace;
  margin-bottom: 4px;
}

.date-display {
  font-size: 14px;
  opacity: 0.8;
}

/* 打卡區域 */
.punch-section {
  margin-bottom: 40px;
}

.section-title {
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 24px 0;
  padding-left: 16px;
  border-left: 4px solid #10b981;
}

.punch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 20px;
}

.punch-card {
  background: white;
  border-radius: 16px;
  padding: 32px 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 2px solid #e2e8f0;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.punch-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 25px rgba(0, 0, 0, 0.15);
  border-color: #10b981;
}

.punch-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  font-size: 28px;
  color: white;
}

.punch-icon.clock-in {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

.punch-icon.clock-out {
  background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
}

.punch-icon.outing {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
}

.punch-icon.break-time {
  background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%);
}

.punch-title {
  font-size: 18px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 8px 0;
}

.punch-desc {
  font-size: 14px;
  color: #64748b;
  margin: 0;
}

/* 記錄區域 */
.records-section {
  margin-bottom: 32px;
}

.table-container {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.records-table {
  width: 100%;
}

.action-tag {
  font-weight: 500;
  padding: 6px 12px;
  border-radius: 6px;
}

.time-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Courier New', monospace;
  font-weight: 500;
}

.time-icon {
  color: #64748b;
}

.remark-text {
  color: #64748b;
  font-style: italic;
}

/* 響應式設計 */
@media (max-width: 768px) {
  .page-header {
    flex-direction: column;
    text-align: center;
    gap: 20px;
  }
  
  .punch-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 16px;
  }
  
  .punch-card {
    padding: 24px 16px;
  }
  
  .punch-icon {
    width: 48px;
    height: 48px;
    font-size: 20px;
  }
}

@media (max-width: 480px) {
  .punch-grid {
    grid-template-columns: 1fr;
  }
  
  .time-display {
    font-size: 24px;
  }
}
</style>
