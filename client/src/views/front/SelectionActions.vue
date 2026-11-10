<template>
  <!-- 「選取」選單的內容：整批選取的入口（勾選單一員工、日期或格子直接在表格上操作） -->
  <div class="selection-actions" :class="{ 'selection-actions--compact': compact }" role="menu" aria-label="選取範圍">
    <el-button
      class="action-btn secondary"
      :disabled="!employeesLength"
      data-test="select-all-employees-on-page-button"
      @click="$emit('select-all-employees-on-page')"
    >
      <el-icon><User /></el-icon>
      本頁全選
    </el-button>
    <el-button
      type="primary"
      class="action-btn primary"
      plain
      :loading="isSelectingAllEmployeesAcrossPages"
      :disabled="!serverPaginationTotal || isSelectingAllEmployeesAcrossPages"
      data-test="select-all-employees-across-pages-button"
      @click="$emit('select-all-employees-across-pages')"
    >
      <el-icon><UserFilled /></el-icon>
      全部人員全選
    </el-button>
    <el-button
      class="action-btn secondary"
      :disabled="!daysLength"
      data-test="select-all-days-button"
      @click="$emit('select-all-days')"
    >
      <el-icon><Calendar /></el-icon>
      全選日期
    </el-button>
    <el-button
      class="action-btn secondary"
      :disabled="!hasAnySelection"
      data-test="clear-selection-button"
      @click="$emit('clear-selection')"
    >
      <el-icon><Close /></el-icon>
      取消選取
    </el-button>
  </div>
</template>

<script setup>
import { Calendar, Close, User, UserFilled } from '@element-plus/icons-vue'

defineProps({
  // 保留給全螢幕使用（目前兩種模式的內容相同，只影響間距）
  compact: {
    type: Boolean,
    default: false
  },
  hasAnySelection: {
    type: Boolean,
    required: true
  },
  employeesLength: {
    type: Number,
    required: true
  },
  serverPaginationTotal: {
    type: Number,
    required: true
  },
  isSelectingAllEmployeesAcrossPages: {
    type: Boolean,
    required: true
  },
  daysLength: {
    type: Number,
    required: true
  }
})

defineEmits([
  'clear-selection',
  'select-all-employees-on-page',
  'select-all-employees-across-pages',
  'select-all-days'
])
</script>

<style scoped lang="scss">
.selection-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  :deep(.el-button) {
    justify-content: flex-start;
    margin-left: 0;
  }

  // 與排班頁其他按鈕同一組顏色（選單的內容不在排班頁的樣式範圍內，顏色直接寫在這裡）
  :deep(.el-button.action-btn.primary) {
    border-color: #b9ddd8;
    background: #edf8f6;
    color: #08635c;
  }

  &--compact {
    gap: 6px;
  }
}
</style>
