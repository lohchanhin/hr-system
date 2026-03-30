<template>
  <el-select
    ref="selectRef"
    v-model="scheduleCell.shiftId"
    placeholder="選擇班別"
    class="cell-select shift-select"
    size="small"
    :teleported="!isFullscreen"
    @blur="handleBlur"
    @visible-change="handleVisibleChange"
    @change="handleSelectShiftChange"
  >
    <el-option
      v-for="opt in shifts"
      :key="opt._id"
      :label="formatShiftLabel(opt)"
      :value="opt._id"
    />
  </el-select>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

defineProps({
  scheduleCell: { type: Object, required: true },
  shifts: { type: Array, default: () => [] },
  formatShiftLabel: { type: Function, required: true },
  isFullscreen: { type: Boolean, default: false }
})

const emit = defineEmits(['select-shift', 'close'])
const selectRef = ref(null)
const dropdownVisible = ref(false)
let closeTimer = null

const scheduleClose = () => {
  if (closeTimer) {
    clearTimeout(closeTimer)
  }
  closeTimer = setTimeout(() => {
    emit('close')
    closeTimer = null
  }, 0)
}

const handleSelectShiftChange = value => {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
  emit('select-shift', value)
  emit('close')
}

const handleBlur = () => {
  if (dropdownVisible.value) return
  scheduleClose()
}

const handleVisibleChange = visible => {
  dropdownVisible.value = visible
  if (!visible) {
    scheduleClose()
  }
}

onMounted(() => {
  nextTick(() => {
    selectRef.value?.focus?.()
  })
})

onBeforeUnmount(() => {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
})
</script>
