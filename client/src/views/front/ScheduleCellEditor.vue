<template>
  <el-select
    ref="selectRef"
    v-model="scheduleCell.shiftId"
    placeholder="選擇班別"
    class="cell-select shift-select"
    size="small"
    :teleported="true"
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
import { nextTick, onMounted, ref } from 'vue'

defineProps({
  scheduleCell: { type: Object, required: true },
  shifts: { type: Array, default: () => [] },
  formatShiftLabel: { type: Function, required: true }
})

const emit = defineEmits(['select-shift', 'close'])
const selectRef = ref(null)

const handleSelectShiftChange = value => {
  emit('select-shift', value)
  emit('close')
}

const handleBlur = () => {
  emit('close')
}

const handleVisibleChange = visible => {
  if (!visible) {
    emit('close')
  }
}

onMounted(() => {
  nextTick(() => {
    selectRef.value?.focus?.()
  })
})
</script>
