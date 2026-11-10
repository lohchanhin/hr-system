<template>
  <div
    ref="cellRef"
    class="modern-schedule-cell"
    data-schedule-cell="1"
    :data-emp-id="String(row._id)"
    :data-day="String(day.date)"
    :class="{
      'has-leave': cellView.cellMeta.isLeave,
      'missing-shift': cellView.cellMeta.missingShift,
      'is-selected': cellView.isSelected,
      'has-shift': cellView.cellMeta.hasShift,
      'is-editable': isEditableCell,
      'is-saving': saveState === 'saving',
      'is-saved': saveState === 'saved',
      'is-failed': saveState === 'failed'
    }"
    :style="cellView.cellMeta.isLeave ? undefined : cellView.cellMeta.style"
    :title="cellTitle"
    :tabindex="isEditableCell ? 0 : -1"
    @keydown="handleKeydown"
    @click.stop="handleCellClick"
  >
    <!-- 原生核取方塊：每一格不再各建一個 el-checkbox 元件；點選由表格外層統一處理（見 Schedule.vue 的 handleTableDelegatedClick） -->
    <label v-if="canEdit && !cellView.cellMeta.isLeave" class="cell-selection" @click.stop>
      <input
        type="checkbox"
        class="cell-manual-checkbox"
        tabindex="-1"
        :checked="cellView.isManualSelected"
        :aria-label="`選取 ${row.name || ''} ${day.label || day.date}`"
      />
    </label>

    <template v-if="cellView.scheduleCell || cellView.cellMeta.isLeave">
      <!-- Esc：不論選單有沒有展開都取消編輯（在選單自己處理之前攔下來），焦點回到格子 -->
      <div v-if="isEditing" class="cell-editor-wrapper" @click.stop @mousedown.stop @keydown.esc.capture="stopEditing">
        <ScheduleCellEditor
          :schedule-cell="cellView.scheduleCell"
          :shifts="shifts"
          :format-shift-label="formatShiftLabel"
          :is-fullscreen="isFullscreen"
          :fullscreen-popper-target="fullscreenPopperTarget"
          :emp-id="String(row._id)"
          :day="day.date"
          @select-shift="handleSelectShift"
          @close="stopEditing"
        />
      </div>
      <div v-else class="cell-view-content">
        <!-- 可以排班的空格子不顯示「-」：平常留白，滑鼠移上去才出現「點擊排班」 -->
        <ScheduleCellDisplay
          v-if="!showEmptyHint"
          :cell-meta="cellView.cellMeta"
          :shift-info="cellView.shiftInfo"
          :format-shift-label="formatShiftLabel"
        />
        <div
          v-if="cellView.cellMeta.partialLeaveHours"
          class="partial-leave-note"
          data-test="partial-leave-note"
        >請假 {{ partialLeaveText }} 小時</div>
        <div v-if="saveState" class="cell-save-state" :data-state="saveState" data-test="cell-save-state">{{ saveStateLabel }}</div>
        <div v-else-if="showEmptyHint" class="empty-hint">點擊排班</div>
        <div v-else-if="cellView.cellMeta.missingShift" class="missing-label">未排班</div>
      </div>
    </template>

    <span v-else class="empty-cell">-</span>
  </div>

</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import ScheduleCellDisplay from './ScheduleCellDisplay.vue'
import ScheduleCellEditor from './ScheduleCellEditor.vue'

const props = defineProps({
  row: { type: Object, required: true },
  day: { type: Object, required: true },
  cellView: { type: Object, required: true },
  canEdit: { type: Boolean, default: false },
  shifts: { type: Array, default: () => [] },
  formatShiftLabel: { type: Function, required: true },
  isFullscreen: { type: Boolean, default: false },
  fullscreenPopperTarget: { type: [String, Object], default: null }
})

const emit = defineEmits(['select-shift', 'toggle-select'])
const isEditing = ref(false)
const cellRef = ref(null)

const SAVE_STATE_LABELS = { saving: '儲存中…', saved: '已儲存', failed: '未儲存' }

const isEditableCell = computed(() => props.canEdit && !props.cellView.cellMeta.isLeave)
const showEmptyHint = computed(() => isEditableCell.value && props.cellView.cellMeta.missingShift)
// 只請幾小時的假：這一天仍可排班，格子上只提示請假時數
const partialLeaveText = computed(() => String(Number(Number(props.cellView.cellMeta.partialLeaveHours || 0).toFixed(2))))
// 這一格最近一次變更的狀態：儲存中、已儲存（幾秒後消失）、未儲存（伺服器拒絕，格子維持原本的班別，原因在提示文字）
const saveState = computed(() => props.cellView.saveState || '')
const saveStateLabel = computed(() => SAVE_STATE_LABELS[saveState.value] || '')
const cellTitle = computed(() => {
  if (saveState.value === 'failed' && props.cellView.saveMessage) return `未儲存：${props.cellView.saveMessage}`
  return props.cellView.leaveTitle
})

const handleSelectShift = value => {
  emit('select-shift', props.row._id, props.day.date, value)
}

const handleCellClick = () => {
  startEditing()
}

const startEditing = () => {
  if (!isEditableCell.value) return
  if (!props.cellView.scheduleCell) return
  // 上一次變更還在儲存：先不開選單，避免同一格連續送出兩筆互相衝突的請求
  if (saveState.value === 'saving') return
  isEditing.value = true
}

const stopEditing = () => {
  const wasEditing = isEditing.value
  isEditing.value = false
  if (!wasEditing) return
  // 選完班別或按 Esc 關閉選單後把焦點放回這一格，鍵盤可以繼續移到下一格；
  // 使用者已經點到別的地方（另一格的選單、搜尋框）時不搶焦點
  nextTick(() => {
    const cell = cellRef.value
    if (!cell || typeof document === 'undefined') return
    const active = document.activeElement
    if (active && active !== document.body && !cell.contains(active)) return
    cell.focus?.({ preventScroll: true })
  })
}

// 方向鍵移到相鄰的格子：左右是同一位員工的前後一天，上下是同一天的上下一位員工
const focusNeighbour = (rowOffset, dayOffset) => {
  const cell = cellRef.value
  if (!cell) return false
  let target = null
  if (dayOffset) {
    const day = Number(props.day.date) + dayOffset
    const rowEl = cell.closest('tr') || cell.parentElement?.parentElement
    target = rowEl?.querySelector?.(`[data-schedule-cell][data-day="${day}"]`) || null
  } else if (rowOffset) {
    let rowEl = cell.closest('tr')
    rowEl = rowOffset > 0 ? rowEl?.nextElementSibling : rowEl?.previousElementSibling
    target = rowEl?.querySelector?.(`[data-schedule-cell][data-day="${props.day.date}"]`) || null
  }
  if (!target) return false
  target.focus?.()
  return true
}

const handleKeydown = event => {
  // 編輯中的按鍵交給班別選單；焦點在格子本身時才處理
  if (isEditing.value || event.target !== cellRef.value) return
  if (event.ctrlKey || event.metaKey || event.altKey) return
  switch (event.key) {
    case 'Enter':
    case 'F2':
      event.preventDefault()
      startEditing()
      break
    case ' ':
    case 'Spacebar':
      if (!isEditableCell.value) return
      event.preventDefault()
      emit('toggle-select', props.row._id, props.day.date)
      break
    case 'Delete':
    case 'Backspace':
      // 清空這一格的班別（與選單裡的「清空排班」相同）
      if (!isEditableCell.value || saveState.value === 'saving') return
      if (!props.cellView.scheduleCell?.shiftId) return
      event.preventDefault()
      handleSelectShift('')
      break
    case 'ArrowLeft':
      if (focusNeighbour(0, -1)) event.preventDefault()
      break
    case 'ArrowRight':
      if (focusNeighbour(0, 1)) event.preventDefault()
      break
    case 'ArrowUp':
      if (focusNeighbour(-1, 0)) event.preventDefault()
      break
    case 'ArrowDown':
      if (focusNeighbour(1, 0)) event.preventDefault()
      break
    default:
  }
}

watch(
  () => [props.row._id, props.day.date, props.cellView.scheduleCell?.shiftId, props.canEdit],
  () => {
    isEditing.value = false
  }
)
</script>

<style scoped>
.cell-editor-wrapper {
  width: 100%;
}

.cell-view-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  min-height: 20px;
}

.partial-leave-note {
  font-size: 11px;
  line-height: 1.3;
  color: #8a5a00;
  text-align: center;
}

.empty-hint {
  font-size: 11px;
  line-height: 1.35;
  color: #52606b;
  text-align: center;
  transition: opacity 140ms cubic-bezier(0.23, 1, 0.32, 1), color 140ms cubic-bezier(0.23, 1, 0.32, 1);
}

/* 空格子平常只留虛線框，滑鼠移上去或用鍵盤移到時才出現「點擊排班」，整張空白班表不會佈滿提示文字 */
@media (hover: hover) and (pointer: fine) {
  .empty-hint {
    opacity: 0;
  }

  .modern-schedule-cell:hover .empty-hint,
  .modern-schedule-cell:focus-visible .empty-hint {
    opacity: 1;
  }
}

/* 這一格的儲存狀態：儲存中（灰）、已儲存（綠）、未儲存（紅，原因在提示文字） */
.cell-save-state {
  font-size: 11px;
  line-height: 1.3;
  text-align: center;
  color: #52606b;
}

.cell-save-state[data-state='saved'] {
  color: #0a766e;
}

.cell-save-state[data-state='failed'] {
  color: #b42318;
  font-weight: 600;
}

/* 選取用的核取方塊固定在格子左上角，不佔內容的高度 */
.cell-selection {
  position: absolute;
  top: 2px;
  left: 2px;
  z-index: 1;
  display: flex;
  padding: 2px;
  border-radius: 3px;
  cursor: pointer;
}

.missing-label,
.empty-cell {
  color: #7a8791;
  font-size: 11px;
  line-height: 1.35;
  text-align: center;
}

.cell-manual-checkbox {
  display: block;
  width: 14px;
  height: 14px;
  margin: 0;
  cursor: pointer;
  accent-color: #0a766e;
}

@media (hover: hover) and (pointer: fine) {
  .modern-schedule-cell:hover .empty-hint {
    color: #0a766e;
  }
}
</style>
