<template>
  <el-select
    v-model="scheduleCell.shiftId"
    placeholder="選擇班別"
    class="cell-select shift-select"
    size="small"
    @change="val => $emit('select-shift', val)"
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

defineEmits(['select-shift'])
</script>
