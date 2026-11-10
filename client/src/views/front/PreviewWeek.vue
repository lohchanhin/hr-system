<template>
  <div class="preview-page">
    <PageHeader title="週表預覽" :subtitle="summary">
      <template #actions>
        <button type="button" class="back-button" @click="handleBack">← 返回排班</button>
      </template>
    </PageHeader>
    <p v-if="!hasData" class="hr-empty" data-test="preview-empty">
      沒有可預覽的排班資料，請回到排班頁重新開啟預覽
    </p>
    <template v-else>
      <section v-for="(week, index) in weeks" :key="index" class="hr-section week">
        <h2 class="hr-section__title">第{{ index + 1 }}週</h2>
        <!-- 表格比螢幕寬時只在這個區塊內左右捲動，員工姓名欄固定在左側 -->
        <div class="preview-scroll">
          <table>
            <thead>
              <tr>
                <th>員工</th>
                <th v-for="d in week" :key="d.date" :class="{ 'is-holiday': Boolean(d.holiday) }">{{ d.label }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="emp in employees" :key="emp._id">
                <td>{{ emp.name }}</td>
                <td v-for="d in week" :key="d.date">{{ shiftCode(emp._id, d.date) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </div>
</template>

<script setup>
import { onBeforeRouteLeave, useRouter } from 'vue-router'
import PageHeader from '../../components/PageHeader.vue'

// 排班頁把目前的班表放進 sessionStorage 再開這一頁；內容損壞時當成沒有資料
function readPreviewData() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem('schedulePreview') || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    return {}
  }
}

const data = readPreviewData()
const scheduleMap = data.scheduleMap || {}
const employees = Array.isArray(data.employees) ? data.employees : []
const days = Array.isArray(data.days) ? data.days : []
const shifts = Array.isArray(data.shifts) ? data.shifts : []
const shiftCodeById = new Map(shifts.map(s => [s._id, s.code || '']))
const hasData = employees.length > 0 && days.length > 0
const summary = hasData ? `${employees.length} 位員工` : ''

const router = useRouter()

const clearPreviewCache = () => {
  sessionStorage.removeItem('schedulePreview')
}

const handleBack = () => {
  clearPreviewCache()

  if (typeof window !== 'undefined') {
    const { history } = window
    if (history) {
      if (history.length > 1) {
        router.back()
        return
      }

      const state = history.state
      if (state && state.back != null) {
        router.back()
        return
      }
    }
  }

  router.push({ name: 'Schedule' })
}

onBeforeRouteLeave(() => {
  clearPreviewCache()
})

function shiftCode(empId, day) {
  const id = scheduleMap[empId]?.[day]?.shiftId
  return shiftCodeById.get(id) || ''
}

const weeks = []
for (let i = 0; i < days.length; i += 7) {
  weeks.push(days.slice(i, i + 7))
}
</script>

<style scoped>
.back-button {
  min-height: 36px;
  padding: 0 14px;
  border: 1px solid var(--hr-gray-300);
  border-radius: var(--hr-radius-sm);
  background: var(--hr-white);
  color: var(--hr-gray-800);
  font: inherit;
  font-size: var(--hr-font-size-sm);
  cursor: pointer;
}

.back-button:hover {
  border-color: var(--hr-primary-light);
  color: var(--hr-primary);
}

.back-button:focus-visible {
  outline: 2px solid var(--hr-primary-light);
  outline-offset: 2px;
}

.preview-scroll {
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

table {
  border-spacing: 0;
  border-top: 1px solid var(--hr-gray-200);
  border-left: 1px solid var(--hr-gray-200);
  font-size: 13px;
  white-space: nowrap;
}

th,
td {
  padding: 6px 10px;
  border-right: 1px solid var(--hr-gray-200);
  border-bottom: 1px solid var(--hr-gray-200);
  text-align: center;
}

th {
  background: var(--hr-gray-50);
  font-weight: var(--hr-font-weight-semibold);
  color: var(--hr-gray-700);
}

/* 國定假日、指定應放假日的標頭（與排班表同色；以前用表情符號標示） */
th.is-holiday {
  color: #9f2d24;
}

th:first-child,
td:first-child {
  position: sticky;
  left: 0;
  z-index: 1;
  text-align: left;
}

/* 固定欄左邊多蓋 2px：寬度不是整數像素時，捲過去的內容不會從縫隙露出來 */
th:first-child {
  box-shadow: -2px 0 0 var(--hr-gray-50);
}

td:first-child {
  background: var(--hr-white);
  box-shadow: -2px 0 0 var(--hr-white);
  font-weight: var(--hr-font-weight-medium);
}

@media (max-width: 767px) {
  .back-button {
    min-height: 44px;
  }
}
</style>
