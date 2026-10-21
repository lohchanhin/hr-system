import { describe, expect, it } from '@jest/globals';
import {
  HOLIDAY_KINDS,
  HOLIDAY_KIND_LABELS,
  displayKindOf,
  effectiveHolidayKind,
  fixedStatutoryDaysForYear,
  holidayTypeLabelOf,
  isWeekendKey,
  legacyKindOf,
  lookupStatutoryName,
  parseHolidayRegime,
  resolveHolidayRegime,
  weekdayOfKey,
} from '../src/services/holidayCalendarRules.js';

const saturday = new Date(Date.UTC(2026, 1, 28));

describe('holidayCalendarRules: statutory names', () => {
  it('treats 小年夜 as statutory only from the 2025-05-28 statute onwards', () => {
    expect(lookupStatutoryName('小年夜', '2025-01-27')).toEqual({ key: 'lunar_eve_eve', name: '小年夜', notYetStatutory: true });
    expect(lookupStatutoryName('小年夜', '2026-02-15')).toEqual({ key: 'lunar_eve_eve', name: '小年夜' });
  });

  it('recognises the name variants the government file uses', () => {
    expect(lookupStatutoryName('孔子誕辰紀念日', '2025-09-28')).toMatchObject({ key: 'teachers' });
    expect(lookupStatutoryName('孔子誕辰紀念日/教師節', '2026-09-28')).toMatchObject({ key: 'teachers' });
    expect(lookupStatutoryName('中華民國開國紀念日', '2024-01-01')).toMatchObject({ key: 'new_year' });
    expect(lookupStatutoryName(' 春　節 ', '2026-02-17')).toMatchObject({ key: 'spring_festival' });
    expect(lookupStatutoryName('清明節', '2026-04-05')).toMatchObject({ key: 'tomb_sweeping' });
    expect(lookupStatutoryName('兒童節及民族掃墓節', '2025-04-04')).toMatchObject({ key: 'children_tomb_combined' });
    expect(lookupStatutoryName('補假', '2026-02-20')).toBeNull();
    expect(lookupStatutoryName('調整放假', '2023-01-27')).toBeNull();
  });

  it('lists the fixed-date statutory days that are effective in a year', () => {
    expect(fixedStatutoryDaysForYear(2024)).toHaveLength(4);
    expect(fixedStatutoryDaysForYear(2025)).toHaveLength(7);
    expect(fixedStatutoryDaysForYear(2026)).toHaveLength(7);
    expect(fixedStatutoryDaysForYear(2026).map((day) => day.date)).toEqual([
      '2026-01-01', '2026-02-28', '2026-05-01', '2026-09-28', '2026-10-10', '2026-10-25', '2026-12-25',
    ]);
  });
});

describe('holidayCalendarRules: legacy rows', () => {
  it('classifies legacy rows without year context', () => {
    expect(legacyKindOf({ type: '國定假日', name: '補假' })).toBe('gov_makeup_off');
    expect(legacyKindOf({ type: '假日', name: '調整放假' })).toBe('gov_bridge_off');
    expect(legacyKindOf({ type: '補班日', name: '補行上班', date: saturday, source: 'roc-calendar' })).toBe('gov_makeup_workday');
    expect(legacyKindOf({ type: '工作日', name: '公司活動', date: saturday, source: 'manual' })).toBe('company_workday');
    expect(legacyKindOf({ type: '公司休息日' })).toBe('company_off');
    expect(legacyKindOf({ type: '例假日', name: '週休' })).toBe('company_off');
    expect(legacyKindOf({ type: '國定假日', name: '中秋節' })).toBe('statutory');
    expect(legacyKindOf({ type: '國定假日', name: '公司創立紀念日', source: 'manual' })).toBe('statutory');
  });

  it('treats a 小年夜 before the statute as a bridge day and keeps a valid stored kind', () => {
    expect(legacyKindOf({ type: '國定假日', name: '小年夜', date: new Date(Date.UTC(2024, 1, 8)) })).toBe('gov_bridge_off');
    expect(legacyKindOf({ type: '國定假日', name: '小年夜', date: new Date(Date.UTC(2026, 1, 15)) })).toBe('statutory');
    expect(legacyKindOf({ kind: 'designated', type: '國定假日', name: '補假' })).toBe('designated');
    expect(effectiveHolidayKind({ kind: 'company_off', name: '中秋節' })).toBe('company_off');
    expect(effectiveHolidayKind({ kind: 'nonsense', type: '國定假日', name: '補假' })).toBe('gov_makeup_off');
  });
});

describe('holidayCalendarRules: labels, regimes and dates', () => {
  it('maps every kind to a legacy type, a label and a display kind', () => {
    expect(HOLIDAY_KINDS).toHaveLength(7);
    for (const kind of HOLIDAY_KINDS) {
      expect(holidayTypeLabelOf(kind)).not.toBe('');
      expect(HOLIDAY_KIND_LABELS[kind]).not.toBeUndefined();
      expect(displayKindOf(kind)).not.toBeNull();
    }
    expect(holidayTypeLabelOf('gov_makeup_workday')).toBe('補班日');
    expect(displayKindOf('gov_makeup_off')).toBe('gov_info');
    expect(displayKindOf('statutory')).toBe('holiday');
  });

  it('resolves the effective holiday regime', () => {
    expect(resolveHolidayRegime({ requiresScheduling: false })).toBe('office');
    expect(resolveHolidayRegime({})).toBe('roster');
    expect(resolveHolidayRegime({ holidayRegime: 'office', requiresScheduling: true })).toBe('office');
    expect(resolveHolidayRegime({ holidayRegime: 'roster', requiresScheduling: false })).toBe('roster');
    expect(resolveHolidayRegime(null)).toBe('roster');
  });

  it('parses the regime text used by forms and bulk import', () => {
    expect(parseHolidayRegime('輪班')).toBe('roster');
    expect(parseHolidayRegime('行政人員')).toBe('office');
    expect(parseHolidayRegime(' 行 政 ')).toBe('office');
    expect(parseHolidayRegime('Office')).toBe('office');
    expect(parseHolidayRegime('')).toBeNull();
    expect(parseHolidayRegime(null)).toBeNull();
    expect(parseHolidayRegime('x')).toBeUndefined();
  });

  it('computes weekdays on the date key in UTC', () => {
    expect(weekdayOfKey('2026-02-28')).toBe(6);
    expect(weekdayOfKey('2026-03-01')).toBe(0);
    expect(isWeekendKey('2026-02-27')).toBe(false);
    expect(isWeekendKey('2026-02-28')).toBe(true);
    expect(weekdayOfKey('2026-13-01')).toBeNull();
  });
});
