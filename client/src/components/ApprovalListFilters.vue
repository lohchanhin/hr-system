<!-- src/components/ApprovalListFilters.vue：簽核清單（待我簽核／我已簽核／我的申請）共用的工具列。
     篩選在左（表單、狀態、申請人、日期範圍）、動作在右（重新載入）；手機把篩選收在「篩選」按鈕裡，清單留在第一屏。
     只負責收集條件；篩選由伺服器做（頁面把條件換成清單 API 的 status、form、from、to、q 參數，見 docs/approval-list-api.md）。 -->
<template>
  <div class="list-filters" data-test="list-filters">
    <div class="hr-toolbar list-filters__bar">
      <el-button
        v-if="isMobile"
        class="list-filters__toggle"
        data-test="filters-toggle"
        :aria-expanded="open"
        @click="open = !open"
      >
        篩選{{ activeCount ? `（${activeCount}）` : '' }}
      </el-button>
      <template v-if="!isMobile || open">
        <el-select
          :model-value="modelValue.formId"
          placeholder="全部表單"
          clearable
          class="list-filters__control"
          data-test="filter-form"
          @update:model-value="patch({ formId: $event || '' })"
        >
          <el-option v-for="option in formOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
        <el-select
          v-if="statusOptions.length"
          :model-value="modelValue.status"
          placeholder="全部狀態"
          clearable
          class="list-filters__control list-filters__control--narrow"
          data-test="filter-status"
          @update:model-value="patch({ status: $event || '' })"
        >
          <el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
        <el-input
          v-if="showKeyword"
          :model-value="modelValue.keyword"
          placeholder="申請人姓名或員工編號"
          :maxlength="KEYWORD_MAX_LENGTH"
          clearable
          class="list-filters__control"
          data-test="filter-keyword"
          @update:model-value="patch({ keyword: $event || '' })"
        />
        <!-- 手機用兩個單日選擇器（雙月曆在手機放不下） -->
        <template v-if="isMobile">
          <el-date-picker
            :model-value="modelValue.from"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY/MM/DD"
            :placeholder="`${dateLabel}（起）`"
            :editable="false"
            class="list-filters__control"
            @update:model-value="patch({ from: $event || '' })"
          />
          <el-date-picker
            :model-value="modelValue.to"
            type="date"
            value-format="YYYY-MM-DD"
            format="YYYY/MM/DD"
            :placeholder="`${dateLabel}（迄）`"
            :editable="false"
            class="list-filters__control"
            @update:model-value="patch({ to: $event || '' })"
          />
        </template>
        <el-date-picker
          v-else
          :model-value="rangeValue"
          type="daterange"
          value-format="YYYY-MM-DD"
          format="YYYY/MM/DD"
          range-separator="–"
          :start-placeholder="`${dateLabel}（起）`"
          :end-placeholder="`${dateLabel}（迄）`"
          unlink-panels
          class="list-filters__range"
          data-test="filter-range"
          @update:model-value="onRange"
        />
        <el-button v-if="activeCount" link type="primary" data-test="filters-clear" @click="clear">清除篩選</el-button>
      </template>
      <span class="hr-toolbar__spacer" />
      <el-button :loading="loading" data-test="list-refresh" @click="$emit('refresh')">重新載入</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useIsMobile } from '../utils/useIsMobile'
import { KEYWORD_MAX_LENGTH } from '../utils/approvalList'

const props = defineProps({
  // { formId, status, keyword, from, to }；from / to 是台灣日期 'YYYY-MM-DD'
  modelValue: { type: Object, required: true },
  formOptions: { type: Array, default: () => [] },
  // 沒有狀態可篩選的清單（待我簽核都是待簽核）傳空陣列，就不顯示狀態
  statusOptions: { type: Array, default: () => [] },
  showKeyword: { type: Boolean, default: false },
  // 日期範圍比對的是哪個時間（三份清單都比對送出日期，與伺服器的 from / to 相同）
  dateLabel: { type: String, default: '送出日期' },
  loading: { type: Boolean, default: false },
})
const emit = defineEmits(['update:modelValue', 'refresh'])

const isMobile = useIsMobile()
const open = ref(false)

const rangeValue = computed(() => (props.modelValue.from && props.modelValue.to ? [props.modelValue.from, props.modelValue.to] : null))
const activeCount = computed(() => {
  const value = props.modelValue
  return [value.formId, value.status, String(value.keyword || '').trim(), value.from || value.to].filter(Boolean).length
})

function patch(change) {
  emit('update:modelValue', { ...props.modelValue, ...change })
}
function onRange(range) {
  const [from, to] = Array.isArray(range) ? range : []
  patch({ from: from || '', to: to || '' })
}
function clear() {
  emit('update:modelValue', { formId: '', status: '', keyword: '', from: '', to: '' })
}
</script>

<style scoped>
.list-filters__bar {
  margin-bottom: var(--hr-space-sm);
}
.list-filters__control {
  width: 180px;
}
.list-filters__control--narrow {
  width: 130px;
}
.list-filters__range {
  flex: 0 1 260px;
  max-width: 260px;
}

@media (max-width: 767px) {
  .list-filters__bar :deep(.el-button) {
    min-height: 44px;
  }
  .list-filters__control,
  .list-filters__control--narrow {
    width: 100%;
    order: 2;
  }
  .list-filters__bar :deep(.el-date-editor.list-filters__control) {
    width: 100%;
  }
  .list-filters__bar :deep(.el-input__wrapper),
  .list-filters__bar :deep(.el-select__wrapper) {
    min-height: 44px;
  }
  /* 「篩選」與「重新載入」留在同一列，展開的條件排在下面 */
  .list-filters__bar > .el-button.is-link {
    order: 3;
  }
}
</style>
