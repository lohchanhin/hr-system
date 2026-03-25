<template>
  <el-select
    v-model="scheduleCell.shiftId"
    placeholder="選擇班別"
    class="cell-select shift-select"
    size="small"
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
defineProps({
  scheduleCell: { type: Object, required: true },
  shifts: { type: Array, default: () => [] },
  formatShiftLabel: { type: Function, required: true }
})

const emit = defineEmits(['select-shift'])

const handleSelectShiftChange = value => {
  emit('select-shift', value)
}
</script>
