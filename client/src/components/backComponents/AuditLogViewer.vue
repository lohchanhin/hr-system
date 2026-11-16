<template>
  <div class="audit-log-viewer">
    <div class="toolbar">
      <el-input
        v-model="filters.action"
        placeholder="篩選動作代碼（例如 AUTH_LOGIN_SUCCESS）"
        clearable
        style="width: 280px"
      />
      <el-button type="primary" :loading="loading" @click="fetchEvents(1)">查詢</el-button>
    </div>

    <el-table :data="items" v-loading="loading" border stripe style="width: 100%">
      <el-table-column label="時間" width="185">
        <template #default="{ row }">{{ formatDate(row.timestamp) }}</template>
      </el-table-column>
      <el-table-column label="操作者" width="160">
        <template #default="{ row }">
          <span>{{ row.actor?.username || row.actor?.id || '-' }}</span>
          <el-tag v-if="row.actor?.role" size="small" class="ml-1">{{ row.actor.role }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="action" label="動作" min-width="200" />
      <el-table-column prop="resourceType" label="資源類型" width="140" />
      <el-table-column prop="status" label="狀態" width="100">
        <template #default="{ row }">
          <el-tag :type="row.status === 'success' ? 'success' : 'danger'" size="small">
            {{ row.status }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="ip" label="來源 IP" width="140" />
      <el-table-column prop="requestId" label="Request ID" min-width="180" />
    </el-table>

    <div class="pagination-bar">
      <el-pagination
        layout="total, prev, pager, next"
        :total="total"
        :page-size="limit"
        :current-page="page"
        @current-change="fetchEvents"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { apiFetch } from '@/api'

const loading = ref(false)
const items = ref([])
const total = ref(0)
const page = ref(1)
const limit = ref(25)
const filters = reactive({
  action: '',
})

function formatDate(val) {
  if (!val) return '-'
  const d = new Date(val)
  return Number.isNaN(d.getTime()) ? String(val) : d.toLocaleString('zh-TW')
}

async function fetchEvents(targetPage = 1) {
  page.value = targetPage
  loading.value = true
  try {
    const params = new URLSearchParams({
      page: String(page.value),
      limit: String(limit.value),
    })
    if (filters.action.trim()) {
      params.set('action', filters.action.trim())
    }
    const res = await apiFetch(`/api/audit-events?${params.toString()}`)
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      ElMessage.error(data?.error || '無法載入稽核日誌')
      return
    }
    items.value = Array.isArray(data?.items) ? data.items : []
    total.value = Number(data?.total || 0)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchEvents(1)
})
</script>

<style scoped>
.audit-log-viewer {
  padding: 16px;
}
.toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.pagination-bar {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.ml-1 {
  margin-left: 6px;
}
</style>
