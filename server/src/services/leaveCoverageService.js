/**
 * 核准請假有沒有涵蓋班次（純函式，不碰資料庫）。
 *
 * 請假改以小時計之後，只請幾小時的假不能讓整天都變成「請假」。國定假日休假紀錄（holidayRestLedgerService）
 * 與排班（匯入、單格新增／修改、批次套用、完整性檢查）共用這裡的同一個判斷，兩邊就不會對同一天給出不同的答案。
 */
import { dateKeyToUtcMidnight } from '../utils/taipeiTime.js';
import { taipeiMidnightMs } from '../utils/leaveDuration.js';
import { computeShiftSpan } from '../utils/timeWindow.js';
import { isNonWorkShift } from './shiftSemanticService.js';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function shiftBreakMs(shift) {
  for (const value of [shift?.breakDuration, shift?.breakMinutes]) {
    const minutes = Number(value);
    if (Number.isFinite(minutes) && minutes > 0) return minutes * MINUTE_MS;
  }
  return 0;
}

// 班次時間內沒有被請假涵蓋到的毫秒數（多張假單先合併重疊的部分）
function uncoveredShiftMs(intervals, span) {
  const start = span.start.getTime();
  const end = span.end.getTime();
  const clipped = intervals
    .map((interval) => [Math.max(interval.startMs, start), Math.min(interval.endMs, end)])
    .filter(([from, to]) => to > from)
    .sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let cursor = start;
  for (const [from, to] of clipped) {
    if (to <= cursor) continue;
    covered += to - Math.max(from, cursor);
    cursor = to;
  }
  return end - start - covered;
}

function usableLeaves(intervals) {
  return (intervals || []).filter((leave) => (
    Number.isFinite(leave?.startMs) && Number.isFinite(leave?.endMs) && leave.endMs > leave.startMs
  ));
}

/**
 * 某天算不算請假：回傳 (日期 YYYY-MM-DD) => boolean。
 *  - 整天的假（allDay）一律算請假：假單核准的日子，班表上就算還排著班也是請假。
 *  - 有時分的假：當天沒有排班就算請假；排了工作班，要整個班次都在請假中才算（班別的休息時間可以不在請假內）。
 *  - 排的是休息日、例假、國定假日、請假，或只請了班次的一部分，都維持班表自己的狀態。
 * intervals：loadApprovedLeaveIntervals 回傳的這位員工的請假區間；scheduleOf(日期)：該日的 { kind, shift }，沒排班回傳 null。
 */
export function buildLeaveDayCheck(intervals = [], scheduleOf = () => null) {
  const leaves = usableLeaves(intervals);
  if (!leaves.length) return () => false;
  return (dateKey) => {
    const dayStart = taipeiMidnightMs(dateKey);
    if (dayStart === null) return false;
    const dayEnd = dayStart + DAY_MS;
    const onDay = leaves.filter((leave) => leave.startMs < dayEnd && leave.endMs > dayStart);
    if (!onDay.length) return false;
    if (onDay.some((leave) => leave.allDay)) return true;

    const scheduled = scheduleOf(dateKey);
    if (!scheduled) return true;
    if (scheduled.kind !== 'work') return false;
    const span = scheduled.shift ? computeShiftSpan(dateKeyToUtcMidnight(dateKey), scheduled.shift) : null;
    const spanMs = span ? span.end.getTime() - span.start.getTime() : 0;
    if (spanMs <= 0) return false;
    return uncoveredShiftMs(leaves, span) <= Math.min(shiftBreakMs(scheduled.shift), spanMs - 1);
  };
}

// 排班被請假擋住的原因
export const ROSTER_LEAVE_BLOCK = Object.freeze({
  // 當天有核准的整天請假（含多天的假）
  ALL_DAY: 'all_day',
  // 有時分的請假涵蓋了整個班次（休息時間可以不在請假內）
  COVERS_SHIFT: 'covers_shift',
  // 不知道要排哪個班別（班別設定裡找不到），維持原本「當天有任何核准請假都不能排」
  ANY_LEAVE: 'any_leave',
});

/**
 * 排班用：這位員工的核准請假會不會擋住某天的某個班別。
 * 回傳 { reason(日期, 班別, 選項), blocks(日期, 班別, 選項), hasLeaveOn(日期) }：reason 沒擋時是 ''，擋住時是 ROSTER_LEAVE_BLOCK 其中一個原因；
 * hasLeaveOn 是當天有沒有任何核准請假（不論幾小時，也不論會不會擋班別）。
 *  - 上班班別：核准的整天請假擋；有時分的請假要涵蓋整個班次才擋（規則同 buildLeaveDayCheck），只請幾小時不擋。
 *  - 不用上班的班別（休息日／例假／國定假日／請假）：預設一律不擋（匯入）。
 *    選項 strictNonWork（手動新增、修改、批次套用）：整天都在請假中的日子仍然擋（原本的行為），只請幾小時的日子不擋。
 *  - 沒給班別（班別設定裡找不到）：當天有任何核准請假就擋，與原本的整天判斷相同。
 * intervals：loadApprovedLeaveIntervals 回傳的這位員工的請假區間。
 */
export function buildRosterLeaveCheck(intervals = []) {
  const leaves = usableLeaves(intervals);
  if (!leaves.length) {
    return { reason: () => '', blocks: () => false, hasLeaveOn: () => false };
  }
  let rostered = null;
  const covers = buildLeaveDayCheck(leaves, () => rostered);
  const leavesOn = (dateKey) => {
    const dayStart = taipeiMidnightMs(dateKey);
    if (dayStart === null) return [];
    const dayEnd = dayStart + DAY_MS;
    return leaves.filter((leave) => leave.startMs < dayEnd && leave.endMs > dayStart);
  };
  // 整天都在請假中：核准的整天請假，或有時分的請假剛好涵蓋當天 00:00 到隔天 00:00（跨多日的假中間那幾天）
  const wholeDayOnLeave = (dateKey, onDay) => {
    const dayStart = taipeiMidnightMs(dateKey);
    return onDay.some((leave) => leave.allDay || (leave.startMs <= dayStart && leave.endMs >= dayStart + DAY_MS));
  };
  const reason = (dateKey, shift = null, { strictNonWork = false } = {}) => {
    const onDay = leavesOn(dateKey);
    if (!onDay.length) return '';
    if (shift && isNonWorkShift(shift)) {
      return strictNonWork && wholeDayOnLeave(dateKey, onDay) ? ROSTER_LEAVE_BLOCK.ALL_DAY : '';
    }
    if (onDay.some((leave) => leave.allDay)) return ROSTER_LEAVE_BLOCK.ALL_DAY;
    if (!shift) return ROSTER_LEAVE_BLOCK.ANY_LEAVE;
    rostered = { kind: 'work', shift };
    return covers(dateKey) ? ROSTER_LEAVE_BLOCK.COVERS_SHIFT : '';
  };
  return {
    reason,
    blocks: (dateKey, shift = null, options) => reason(dateKey, shift, options) !== '',
    hasLeaveOn: (dateKey) => leavesOn(dateKey).length > 0,
  };
}
