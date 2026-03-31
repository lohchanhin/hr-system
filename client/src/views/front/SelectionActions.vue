<template>
  <div class="selection-actions" :class="{ 'selection-actions--compact': compact }">
    <el-button
      type="primary"
      class="action-btn primary"
      :disabled="!hasAnySelection"
      :data-test="compact ? 'fullscreen-clear-selection-button' : 'clear-selection-button'"
      @click="$emit('clear-selection')"
    >
      <i class="el-icon-close"></i>
      清除選取
    </el-button>
    <el-button
      type="primary"
      class="action-btn primary"
      plain
      :loading="isSelectingAllEmployeesAcrossPages"
      :disabled="!serverPaginationTotal || isSelectingAllEmployeesAcrossPages"
      :data-test="compact ? 'fullscreen-select-all-button' : 'select-all-employees-across-pages-button'"
      @click="$emit('select-all-employees-across-pages')"
    >
      <i class="el-icon-user-solid"></i>
      全部人員全選
    </el-button>

    <template v-if="!compact">
      <el-button
        type="primary"
        class="action-btn primary"
        plain
        :disabled="!employeesLength"
        data-test="select-all-employees-on-page-button"
        @click="$emit('select-all-employees-on-page')"
      >
        <i class="el-icon-user"></i>
        本頁全選
      </el-button>
      <el-button
        type="primary"
        class="action-btn primary"
        plain
        :disabled="!daysLength"
        data-test="select-all-days-button"
        @click="$emit('select-all-days')"
      >
        <i class="el-icon-date"></i>
        全選日期
      </el-button>
    </template>

    <el-dropdown
      v-else
      trigger="click"
      data-test="fullscreen-selection-more-dropdown"
      @command="handleCompactCommand"
    >
      <el-button class="action-btn secondary selection-actions__more-btn" data-test="fullscreen-selection-more-button">
        更多選取操作
      </el-button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="page" :disabled="!employeesLength" data-test="fullscreen-select-page-command">
            本頁全選
          </el-dropdown-item>
          <el-dropdown-item command="days" :disabled="!daysLength" data-test="fullscreen-select-days-command">
            全選日期
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>
  </div>
</template>

<script setup>
defineProps({
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

const emit = defineEmits([
  'clear-selection',
  'select-all-employees-on-page',
  'select-all-employees-across-pages',
  'select-all-days'
])

const handleCompactCommand = command => {
  if (command === 'page') emit('select-all-employees-on-page')
  if (command === 'days') emit('select-all-days')
}
</script>

<style scoped lang="scss">
.selection-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;

  &--compact {
    align-items: center;
  }

  &__more-btn {
    border-style: dashed;
  }
}
</style>
