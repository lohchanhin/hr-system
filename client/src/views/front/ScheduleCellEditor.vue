<template>
  <el-select
    ref="selectRef"
    v-model="scheduleCell.shiftId"
    placeholder="選擇班別"
    class="cell-select shift-select"
    size="small"
    :teleported="isDropdownTeleported"
    :append-to="appendTarget"
    :popper-class="popperClassName"
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  scheduleCell: { type: Object, required: true },
  shifts: { type: Array, default: () => [] },
  formatShiftLabel: { type: Function, required: true },
  isFullscreen: { type: Boolean, default: false },
  fullscreenPopperTarget: { type: [String, Object], default: null }
})

const emit = defineEmits(['select-shift', 'close'])
const selectRef = ref(null)
const dropdownVisible = ref(false)
let closeTimer = null

const appendTarget = computed(() => {
  if (!props.isFullscreen) return undefined
  return props.fullscreenPopperTarget || '.schedule-fullscreen-popper-host'
})

const isDropdownTeleported = computed(() => !props.isFullscreen || !!appendTarget.value)
const popperClassName = computed(() =>
  props.isFullscreen ? 'schedule-cell-editor-popper schedule-cell-editor-popper--fullscreen' : 'schedule-cell-editor-popper'
)

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
