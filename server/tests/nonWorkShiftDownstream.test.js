import { describe, it, expect } from '@jest/globals';
import { __testUtils as reportUtils } from '../src/services/reportMetricsService.js';
import { calculateLateEarlyCount } from '../src/services/attendanceDeductionService.js';
import { calculateNightShiftAllowance } from '../src/services/nightShiftAllowanceService.js';
import {
  buildCountedHolidayDays,
  isCountedHoliday,
  isEmptyWeekendHoliday,
  isPayableNationalHoliday,
} from '../src/services/countedHolidayService.js';

const {
  buildAttendanceSummary,
  buildTardinessSummary,
  buildEarlyLeaveSummary,
  buildWorkHoursSummary,
  computeShiftTimes,
} = reportUtils;

// 客戶班別表的樣子：休假類班別都是 00:00-00:00、休息 0 分鐘
function zeroTimeShift(id, code, name, semanticType) {
  return { _id: id, code, name, startTime: '00:00', endTime: '00:00', breakDuration: 0, semanticType };
}

const DAY = {
  _id: 'day', code: '日', name: '日班', startTime: '08:00', endTime: '17:00', breakDuration: 60, semanticType: 'work',
};
const HOLIDAY = zeroTimeShift('holiday', '國', '國定假日', 'holiday');
const REGULAR_REST = zeroTimeShift('regular', '例', '例假', 'regular_rest');
const REST_DAY = zeroTimeShift('rest', '休', '休假', 'rest_day');
const ANNUAL_LEAVE = zeroTimeShift('leave', '特', '特休', 'leave');
const INJURY_LEAVE = zeroTimeShift('injury', '公傷', '公傷假', 'leave');

const SAMPLE_SHIFTS = [DAY, HOLIDAY, REGULAR_REST, REST_DAY, ANNUAL_LEAVE, INJURY_LEAVE];
// 日、國、例、休、特、公傷、日
const SAMPLE_WEEK = ['day', 'holiday', 'regular', 'rest', 'leave', 'injury', 'day'].map((shiftId, index) => ({
  employee: 'emp1',
  date: `2026-06-0${index + 1}T00:00:00.000Z`,
  shiftId,
}));

const EMPLOYEES = [{ _id: 'emp1', name: '測試員工' }];

function shiftMapOf(shifts) {
  return new Map(shifts.map((shift) => [shift._id, shift]));
}

describe('報表：不用上班的班別不算應出勤、缺勤、遲到、早退', () => {
  it('樣本月(日、國、例、休、特、公傷、日)只有兩個上班日，缺勤只算 2 天', () => {
    const result = buildAttendanceSummary({
      employees: EMPLOYEES,
      schedules: SAMPLE_WEEK,
      recordMap: new Map(),
      shiftMap: shiftMapOf(SAMPLE_SHIFTS),
    });

    expect(result.summary).toEqual({ scheduled: 2, attended: 0, absent: 2 });
    expect(result.records).toEqual([
      { employee: 'emp1', name: '測試員工', scheduled: 2, attended: 0, absent: 2 },
    ]);
  });

  it('只排國定假日/請假/休息的員工不會出現在出勤統計', () => {
    const result = buildAttendanceSummary({
      employees: EMPLOYEES,
      schedules: SAMPLE_WEEK.filter((row) => row.shiftId !== 'day'),
      recordMap: new Map(),
      shiftMap: shiftMapOf(SAMPLE_SHIFTS),
    });

    expect(result).toEqual({ records: [], summary: { scheduled: 0, attended: 0, absent: 0 } });
  });

  it('工時統計：排定工時 16 小時（不是 88 小時），不產生休假日的明細', () => {
    const result = buildWorkHoursSummary({
      employees: EMPLOYEES,
      schedules: SAMPLE_WEEK,
      recordMap: new Map(),
      shiftMap: shiftMapOf(SAMPLE_SHIFTS),
    });

    expect(result.summary.totalScheduledHours).toBe(16);
    expect(result.records.map((row) => row.date)).toEqual(['2026-06-01', '2026-06-07']);
    expect(result.records.map((row) => row.scheduledHours)).toEqual([8, 8]);
  });

  it('沒有工作時間、班別性質卻誤設成 work 的班別也不算 24 小時', () => {
    const legacy = { _id: 'legacy', code: 'XX', name: '未分類', startTime: '00:00', endTime: '00:00', semanticType: 'work' };
    const result = buildWorkHoursSummary({
      employees: EMPLOYEES,
      schedules: [{ employee: 'emp1', date: '2026-06-01T00:00:00.000Z', shiftId: 'legacy' }],
      recordMap: new Map(),
      shiftMap: shiftMapOf([legacy]),
    });

    expect(result.records).toEqual([]);
    expect(result.summary.totalScheduledHours).toBe(0);
  });

  it('國定假日那天就算有打卡紀錄，也不會被算成遲到或早退', () => {
    const schedules = [{ employee: 'emp1', date: '2026-06-02T00:00:00.000Z', shiftId: 'holiday' }];
    const recordMap = new Map([
      ['emp1::2026-06-02', {
        clockIns: [new Date('2026-06-02T06:00:00.000Z')],
        clockOuts: [new Date('2026-06-02T07:00:00.000Z')],
      }],
    ]);
    const shiftMap = shiftMapOf(SAMPLE_SHIFTS);

    const late = buildTardinessSummary({ schedules, recordMap, shiftMap, employees: EMPLOYEES, lateGrace: 0 });
    const early = buildEarlyLeaveSummary({ schedules, recordMap, shiftMap, employees: EMPLOYEES, earlyGrace: 0 });

    expect(late.records).toEqual([]);
    expect(late.summary.totalLateCount).toBe(0);
    expect(early.records).toEqual([]);
    expect(early.summary.totalEarlyLeaveCount).toBe(0);
  });

  it('真正的上班日仍然會算遲到', () => {
    const schedules = [{ employee: 'emp1', date: '2026-06-01T00:00:00.000Z', shiftId: 'day' }];
    const recordMap = new Map([
      ['emp1::2026-06-01', { clockIns: [new Date('2026-06-01T08:20:00.000Z')], clockOuts: [] }],
    ]);

    const late = buildTardinessSummary({
      schedules, recordMap, shiftMap: shiftMapOf(SAMPLE_SHIFTS), employees: EMPLOYEES, lateGrace: 0,
    });

    expect(late.summary.totalLateCount).toBe(1);
    expect(late.records[0].minutesLate).toBe(20);
  });

  it('夜班 00:00-08:00 勾了跨日仍是 8 小時，不會變成 32 小時', () => {
    const night = { _id: 'n', code: 'N', name: '夜班', startTime: '00:00', endTime: '08:00', crossDay: true, breakDuration: 0 };
    const result = buildWorkHoursSummary({
      employees: EMPLOYEES,
      schedules: [{ employee: 'emp1', date: '2026-06-01T00:00:00.000Z', shiftId: 'n' }],
      recordMap: new Map(),
      shiftMap: shiftMapOf([night]),
    });

    expect(result.summary.totalScheduledHours).toBe(8);
  });

  it('computeShiftTimes：開始等於結束只有勾跨日才是 24 小時', () => {
    const date = '2026-06-01T00:00:00.000Z';
    const hours = (shift) => {
      const { start, end } = computeShiftTimes(date, shift);
      return (end.getTime() - start.getTime()) / 3600000;
    };

    expect(hours({ startTime: '00:00', endTime: '00:00' })).toBe(0);
    expect(hours({ startTime: '00:00', endTime: '00:00', crossDay: true })).toBe(24);
    expect(hours({ startTime: '00:00', endTime: '08:00', crossDay: true })).toBe(8);
    expect(hours({ startTime: '16:00', endTime: '00:00', crossDay: true })).toBe(8);
    expect(hours({ startTime: '22:00', endTime: '06:00' })).toBe(8);
  });
});

describe('遲到早退扣款：不用上班的班別沒有遲到早退', () => {
  function context(shift, records) {
    return {
      attendanceSetting: {
        shifts: [shift],
        abnormalRules: {
          lateGrace: 0,
          earlyLeaveGrace: 0,
          lateDeductionEnabled: true,
          lateDeductionAmount: 100,
          earlyLeaveDeductionEnabled: true,
          earlyLeaveDeductionAmount: 200,
        },
      },
      schedules: [{ _id: 'sched1', shiftId: shift._id, date: new Date('2026-06-02T00:00:00.000Z') }],
      attendanceRecords: records,
    };
  }

  // 台北時間 2026-06-02 11:00 上班、12:00 下班
  const punches = [
    { action: 'clockIn', timestamp: new Date('2026-06-02T03:00:00.000Z') },
    { action: 'clockOut', timestamp: new Date('2026-06-02T04:00:00.000Z') },
  ];

  it.each([
    ['國定假日', HOLIDAY],
    ['特休', ANNUAL_LEAVE],
    ['公傷假', INJURY_LEAVE],
    ['休息日', REST_DAY],
    ['例假', REGULAR_REST],
    ['班別性質被誤設成 work 的 00:00-00:00 班別', { ...HOLIDAY, _id: 'legacy', semanticType: 'work' }],
  ])('%s：遲到、早退都是 0', async (_label, shift) => {
    const result = await calculateLateEarlyCount('emp1', '2026-06', context(shift, punches));

    expect(result.lateCount).toBe(0);
    expect(result.earlyLeaveCount).toBe(0);
  });

  it('真正的日班照樣算遲到早退', async () => {
    const result = await calculateLateEarlyCount('emp1', '2026-06', context(DAY, [
      { action: 'clockIn', timestamp: new Date('2026-06-02T00:30:00.000Z') },
      { action: 'clockOut', timestamp: new Date('2026-06-02T08:00:00.000Z') },
    ]));

    expect(result.lateCount).toBe(1);
    expect(result.lateDetails[0].minutesLate).toBe(30);
    expect(result.earlyLeaveCount).toBe(1);
    expect(result.earlyLeaveDetails[0].minutesEarly).toBe(60);
  });
});

describe('遲到早退扣款：真正的夜班、小夜班(勾跨日)照原本方式計算', () => {
  function context(shift, records) {
    return {
      attendanceSetting: {
        shifts: [shift],
        abnormalRules: { lateGrace: 0, earlyLeaveGrace: 0 },
      },
      schedules: [{ _id: 'sched1', shiftId: shift._id, date: new Date('2026-06-02T00:00:00.000Z') }],
      attendanceRecords: records,
    };
  }

  it('夜班 00:00-08:00 勾跨日：8 小時的班，不是 32 小時', async () => {
    const night = { _id: 'n', code: 'N', name: '夜班', startTime: '00:00', endTime: '08:00', crossDay: true, semanticType: 'work' };
    // 台北時間 06-02 00:10 上班、07:50 下班
    const result = await calculateLateEarlyCount('emp1', '2026-06', context(night, [
      { action: 'clockIn', timestamp: new Date('2026-06-01T16:10:00.000Z') },
      { action: 'clockOut', timestamp: new Date('2026-06-01T23:50:00.000Z') },
    ]));

    expect(result.lateDetails.map((item) => item.minutesLate)).toEqual([10]);
    expect(result.earlyLeaveDetails.map((item) => item.minutesEarly)).toEqual([10]);
  });

  it('小夜班 16:00-00:00 勾跨日：到午夜為止', async () => {
    const evening = { _id: 'e', code: 'E', name: '小夜', startTime: '16:00', endTime: '00:00', crossDay: true, semanticType: 'work' };
    // 台北時間 06-02 16:05 上班、23:40 下班
    const result = await calculateLateEarlyCount('emp1', '2026-06', context(evening, [
      { action: 'clockIn', timestamp: new Date('2026-06-02T08:05:00.000Z') },
      { action: 'clockOut', timestamp: new Date('2026-06-02T15:40:00.000Z') },
    ]));

    expect(result.lateDetails.map((item) => item.minutesLate)).toEqual([5]);
    expect(result.earlyLeaveDetails.map((item) => item.minutesEarly)).toEqual([20]);
  });
});

describe('夜班津貼：不用上班的班別不發津貼', () => {
  const night = {
    _id: 'n', code: 'N', name: '夜班', startTime: '00:00', endTime: '08:00', crossDay: true,
    isNightShift: true, hasAllowance: true, fixedAllowanceAmount: 500, semanticType: 'work',
  };
  const evening = {
    _id: 'e', code: 'E', name: '小夜', startTime: '16:00', endTime: '00:00', crossDay: true,
    isNightShift: true, hasAllowance: true, fixedAllowanceAmount: 300, semanticType: 'work',
  };

  function schedulesFor(...ids) {
    return ids.map((id) => ({ shiftId: { toString: () => id } }));
  }

  it('國定假日/請假/休息班別就算誤勾了夜班津貼也不發', async () => {
    const flagged = (shift) => ({ ...shift, isNightShift: true, hasAllowance: true, fixedAllowanceAmount: 500 });
    const shifts = [flagged(HOLIDAY), flagged(ANNUAL_LEAVE), flagged(REST_DAY), flagged(REGULAR_REST)];
    const result = await calculateNightShiftAllowance('emp1', '2026-06-01', {}, {
      attendanceSetting: { shifts: shifts.map((shift) => ({ ...shift, _id: { toString: () => shift._id } })) },
      schedules: schedulesFor('holiday', 'leave', 'rest', 'regular'),
    });

    expect(result.nightShiftDays).toBe(0);
    expect(result.allowanceAmount).toBe(0);
    expect(result.shiftBreakdown).toEqual([]);
    expect(result.calculationMethod).toBe('not_calculated');
  });

  it('沒有工作時間(00:00-00:00)的班別也不發', async () => {
    const zero = {
      ...HOLIDAY, _id: { toString: () => 'zero' }, semanticType: 'work',
      isNightShift: true, hasAllowance: true, fixedAllowanceAmount: 500,
    };
    const result = await calculateNightShiftAllowance('emp1', '2026-06-01', {}, {
      attendanceSetting: { shifts: [zero] },
      schedules: schedulesFor('zero'),
    });

    expect(result.nightShiftDays).toBe(0);
    expect(result.allowanceAmount).toBe(0);
  });

  it('真正的夜班(00:00-08:00 勾跨日、16:00-00:00 勾跨日)照樣發津貼，各 8 小時', async () => {
    const result = await calculateNightShiftAllowance('emp1', '2026-06-01', {}, {
      attendanceSetting: {
        shifts: [night, evening].map((shift) => ({ ...shift, _id: { toString: () => shift._id } })),
      },
      schedules: schedulesFor('n', 'e', 'holiday'),
    });

    expect(result.nightShiftDays).toBe(2);
    expect(result.nightShiftHours).toBe(16);
    expect(result.allowanceAmount).toBe(800);
  });
});

describe('countedHolidayService：國定假日判斷', () => {
  const doc = (date, extra = {}) => ({ date: new Date(`${date}T00:00:00.000Z`), ...extra });

  it('跟排班規則一樣：補班日、工作日不算假日，國定/假日才算', () => {
    expect(isCountedHoliday({ type: '國定假日', name: '中秋節' })).toBe(true);
    expect(isCountedHoliday({ type: '假日', name: '調整放假' })).toBe(true);
    expect(isCountedHoliday({ type: 'holiday' })).toBe(true);
    expect(isCountedHoliday({ type: '工作日', name: '補班日' })).toBe(false);
    expect(isCountedHoliday({ type: '國定假日', description: '補班' })).toBe(false);
    expect(isCountedHoliday({ type: 'makeup work' })).toBe(false);
    expect(isCountedHoliday({ type: '', name: '公司旅遊' })).toBe(false);
  });

  it('說明為空的週末(舊版匯入把每個週末都寫成國定假日)不算', () => {
    // 2026-09-12 週六、2026-09-13 週日、2026-09-10 週四
    const legacy = { type: '國定假日', name: '假日', source: 'roc-calendar' };
    expect(isEmptyWeekendHoliday(doc('2026-09-12', { ...legacy, desc: '', description: '' }))).toBe(true);
    expect(isEmptyWeekendHoliday(doc('2026-09-13', legacy))).toBe(true);
    expect(isEmptyWeekendHoliday(doc('2026-09-10', { ...legacy, desc: '' }))).toBe(false);
    // 人工新增、或沒有來源標記的週末假日一律當成真的假日，不能誤判成雜訊
    expect(isEmptyWeekendHoliday(doc('2026-09-12', { type: '國定假日', name: '公司指定假日', source: 'manual' }))).toBe(false);
    expect(isEmptyWeekendHoliday(doc('2026-09-12', { type: '國定假日', name: '假日' }))).toBe(false);
    expect(isEmptyWeekendHoliday(doc('2026-10-10', { type: '國定假日', name: '國慶日', description: '國慶日' }))).toBe(false);

    expect(isPayableNationalHoliday(doc('2026-09-12', { ...legacy, description: '' }))).toBe(false);
    expect(isPayableNationalHoliday(doc('2026-09-12', { type: '國定假日', name: '公司指定假日', source: 'manual' }))).toBe(true);
    // 行事曆裡「例假日」「公司休息日」是公司自訂的休息紀錄，不是國定假日
    expect(isPayableNationalHoliday(doc('2026-09-10', { type: '例假日', name: '例假日' }))).toBe(false);
    expect(isPayableNationalHoliday(doc('2026-09-10', { type: '公司休息日', name: '公司休息日' }))).toBe(false);
    // 週末剛好是真的國定假日（國慶日 2026-10-10 是週六）
    expect(isPayableNationalHoliday(doc('2026-10-10', { type: '國定假日', name: '國慶日', description: '國慶日' }))).toBe(true);
    expect(isPayableNationalHoliday(doc('2026-09-25', { type: '國定假日', name: '中秋節', description: '中秋節' }))).toBe(true);
    // 平日說明為空的假日資料不受影響
    expect(isPayableNationalHoliday(doc('2026-09-10', { type: '國定假日', name: '假日' }))).toBe(true);
  });

  it('buildCountedHolidayDays：只留算數的假日，並套用同月份的國定假日移置', () => {
    const start = new Date('2026-09-01T00:00:00.000Z');
    const end = new Date('2026-10-01T00:00:00.000Z');
    const holidays = [
      doc('2026-09-25', { type: '國定假日', description: '中秋節' }),
      doc('2026-09-12', { type: '國定假日', name: '假日', description: '', source: 'roc-calendar' }),
      doc('2026-09-19', { type: '工作日', name: '補班日', description: '補班' }),
    ];

    expect([...buildCountedHolidayDays({ holidays, moves: [], start, end })]).toEqual(['2026-09-25']);

    const moved = buildCountedHolidayDays({
      holidays,
      moves: [{ sourceDate: new Date('2026-09-25T00:00:00.000Z'), targetDate: new Date('2026-09-28T00:00:00.000Z') }],
      start,
      end,
    });
    expect([...moved]).toEqual(['2026-09-28']);

    // 目標日不在這個月份範圍內就不加入
    const outside = buildCountedHolidayDays({
      holidays,
      moves: [{ sourceDate: new Date('2026-09-25T00:00:00.000Z'), targetDate: new Date('2026-10-02T00:00:00.000Z') }],
      start,
      end,
    });
    expect([...outside]).toEqual([]);
  });
});
