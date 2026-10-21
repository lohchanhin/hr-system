import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from '@jest/globals';
import { decodeCalendarCsv, parseCalendarCsv, parseRuyutJson } from '../src/services/publicCalendarSource.js';
import { classifyPublicCalendarYear } from '../src/services/publicCalendarClassifier.js';

// 真實的政府辦公日曆表（data.gov.tw dataset 14718）與 ruyut 鏡像；只看解析後的結果，不依賴檔案位元組
const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function classifyDgpa(file, year) {
  const { text } = decodeCalendarCsv(readFileSync(path.join(fixtures, 'dgpa', file)));
  return classifyPublicCalendarYear(year, parseCalendarCsv(text, year));
}

function datesOf(result, kind) {
  return result.entries.filter((entry) => entry.kind === kind).map((entry) => entry.date.slice(5));
}

function linksOf(result) {
  return Object.fromEntries(result.entries
    .filter((entry) => entry.kind === 'gov_makeup_off')
    .map((entry) => [entry.date.slice(5), entry.compensatesDate]));
}

describe('classifyPublicCalendarYear on the real government files', () => {
  it('2026 (115): 16 statutory days and 6 civil-service make-up days, each linked to the day it compensates', () => {
    const result = classifyDgpa('roc115.csv', 2026);

    expect(datesOf(result, 'statutory')).toEqual([
      '01-01', '02-15', '02-16', '02-17', '02-18', '02-19', '02-28', '04-04', '04-05',
      '05-01', '06-19', '09-25', '09-28', '10-10', '10-25', '12-25',
    ]);
    expect(linksOf(result)).toEqual({
      '02-20': '2026-02-15',
      '02-27': '2026-02-28',
      '04-03': '2026-04-04',
      '04-06': '2026-04-05',
      '10-09': '2026-10-10',
      '10-26': '2026-10-25',
    });
    expect(result.entries.filter((entry) => entry.kind === 'gov_makeup_off').every((entry) => entry.linkMethod === 'rule')).toBe(true);
    expect(result.counts).toEqual({ statutory: 16, gov_makeup_off: 6, gov_bridge_off: 0, gov_makeup_workday: 0 });
    expect(result.warnings).toEqual([]);
    expect(result.entries.find((entry) => entry.date === '2026-02-27')).toMatchObject({ compensatesName: '和平紀念日' });
  });

  it('2027 (116): links across months (03-01 -> 02-28) and across years (12-31 -> 2028-01-01)', () => {
    const result = classifyDgpa('roc116.csv', 2027);

    expect(datesOf(result, 'statutory')).toEqual([
      '01-01', '02-04', '02-05', '02-06', '02-07', '02-08', '02-28', '04-04', '04-05',
      '05-01', '06-09', '09-15', '09-28', '10-10', '10-25', '12-25',
    ]);
    expect(linksOf(result)).toEqual({
      '02-09': '2027-02-06',
      '02-10': '2027-02-07',
      '03-01': '2027-02-28',
      '04-06': '2027-04-04',
      '04-30': '2027-05-01',
      '10-11': '2027-10-10',
      '12-24': '2027-12-25',
      '12-31': '2028-01-01',
    });
    expect(result.entries.find((entry) => entry.date === '2027-12-31')).toMatchObject({ compensatesName: '開國紀念日', linkMethod: 'rule' });
    expect(result.counts).toEqual({ statutory: 16, gov_makeup_off: 8, gov_bridge_off: 0, gov_makeup_workday: 0 });
    expect(result.warnings).toEqual([]);
  });

  it('2023 (112): bridge days (incl. 小年夜 before the statute) and make-up Saturdays, 勞動節 added by rule', () => {
    const result = classifyDgpa('roc112.csv', 2023);

    expect(datesOf(result, 'statutory')).toEqual([
      '01-01', '01-21', '01-22', '01-23', '01-24', '02-28', '04-04', '04-05', '05-01', '06-22', '09-29', '10-10',
    ]);
    expect(result.entries.find((entry) => entry.date === '2023-05-01')).toMatchObject({ synthetic: true, statutoryKey: 'labor' });
    expect(linksOf(result)).toEqual({ '01-02': '2023-01-01', '01-25': '2023-01-21', '01-26': '2023-01-22' });
    expect(datesOf(result, 'gov_bridge_off')).toEqual(['01-20', '01-27', '02-27', '04-03', '06-23', '10-09']);
    expect(result.entries.find((entry) => entry.date === '2023-01-20')).toMatchObject({ name: '小年夜', needsReview: false });
    expect(datesOf(result, 'gov_makeup_workday')).toEqual(['01-07', '02-04', '02-18', '03-25', '06-17', '09-23']);
    expect(result.warnings).toEqual([]);
  });

  it('2025 revised (114, 1141020 更新, Big5): 15 statutory days with 兒童節 derived on 04-03', () => {
    const result = classifyDgpa('roc114-1141020.csv', 2025);

    expect(datesOf(result, 'statutory')).toEqual([
      '01-01', '01-28', '01-29', '01-30', '01-31', '02-28', '04-03', '04-04', '05-01',
      '05-31', '09-28', '10-06', '10-10', '10-25', '12-25',
    ]);
    expect(result.entries.find((entry) => entry.date === '2025-04-03')).toMatchObject({
      name: '兒童節', statutoryKey: 'children', derived: 'children_tomb_rule', remark: '補假',
    });
    expect(result.entries.find((entry) => entry.date === '2025-04-04')).toMatchObject({ name: '民族掃墓節', statutoryKey: 'tomb_sweeping' });
    expect(linksOf(result)).toEqual({ '05-30': '2025-05-31', '09-29': '2025-09-28', '10-24': '2025-10-25' });
    expect(datesOf(result, 'gov_bridge_off')).toEqual(['01-27']);
    expect(datesOf(result, 'gov_makeup_workday')).toEqual(['02-08']);
    expect(result.warnings).toEqual([]);
  });

  it('2025 original (114): the revised list without 09-28, 10-25 and 12-25', () => {
    const result = classifyDgpa('roc114.csv', 2025);

    expect(result.counts).toEqual({ statutory: 12, gov_makeup_off: 1, gov_bridge_off: 1, gov_makeup_workday: 1 });
    expect(datesOf(result, 'statutory')).not.toEqual(expect.arrayContaining(['09-28']));
    expect(linksOf(result)).toEqual({ '05-30': '2025-05-31' });
    expect(result.warnings).toEqual([]);
  });

  it('2021 (110): 兒童節 derived on an empty-remark Saturday and a 補假 that compensates next year', () => {
    const result = classifyDgpa('roc110.csv', 2021);

    expect(result.counts).toEqual({ statutory: 12, gov_makeup_off: 7, gov_bridge_off: 2, gov_makeup_workday: 2 });
    expect(result.entries.find((entry) => entry.date === '2021-04-03')).toMatchObject({ kind: 'statutory', name: '兒童節', derived: 'children_tomb_rule' });
    expect(result.entries.find((entry) => entry.date === '2021-05-01')).toMatchObject({ kind: 'statutory', synthetic: true });
    expect(linksOf(result)).toMatchObject({ '04-02': '2021-04-03', '04-05': '2021-04-04', '12-31': '2022-01-01' });
    expect(datesOf(result, 'gov_bridge_off')).toEqual(['02-10', '09-20']);
    expect(result.warnings).toEqual([]);
  });

  it('gives identical entries for the pinned ruyut 2026 file and the official 115 CSV (remarks aside)', () => {
    const ruyut = classifyPublicCalendarYear(2026, parseRuyutJson(readFileSync(path.join(fixtures, 'ruyut', '2026.json'), 'utf8'), 2026));
    const dgpa = classifyDgpa('roc115.csv', 2026);
    const strip = (entries) => entries.map(({ remark: _remark, ...entry }) => entry);

    expect(strip(ruyut.entries)).toEqual(strip(dgpa.entries));
  });
});

describe('classifyPublicCalendarYear on synthetic years', () => {
  function plainYear(year, overrides = {}) {
    const rows = [];
    for (let time = Date.UTC(year, 0, 1); time < Date.UTC(year + 1, 0, 1); time += 86400000) {
      const date = new Date(time).toISOString().slice(0, 10);
      const weekday = new Date(time).getUTCDay();
      rows.push({ date, weekday, isOff: weekday === 0 || weekday === 6, remark: '', ...(overrides[date] || {}) });
    }
    return rows;
  }

  it('turns an unknown weekday remark into a bridge day that needs review', () => {
    const result = classifyPublicCalendarYear(2030, plainYear(2030, { '2030-07-10': { isOff: true, remark: '颱風假' } }));
    const entry = result.entries.find((item) => item.date === '2030-07-10');

    expect(entry).toMatchObject({ kind: 'gov_bridge_off', name: '颱風假', needsReview: true });
    expect(result.warnings.some((text) => text.includes('2030-07-10'))).toBe(true);
  });

  it('keeps a 補假 without any weekend holiday nearby unlinked and flagged', () => {
    const result = classifyPublicCalendarYear(2030, plainYear(2030, { '2030-07-10': { isOff: true, remark: '補假' } }));
    const entry = result.entries.find((item) => item.date === '2030-07-10');

    expect(entry).toMatchObject({ kind: 'gov_makeup_off', compensatesDate: null, linkMethod: 'none', needsReview: true });
    expect(result.warnings).toContain('補假 2030-07-10 找不到對應的國定假日');
  });

  it('warns about 勞動節 missing from a year that should contain it and ignores unused weekend remarks', () => {
    const result = classifyPublicCalendarYear(2030, plainYear(2030, { '2030-03-09': { isOff: true, remark: '植樹節' } }));

    expect(result.entries.find((item) => item.date === '2030-05-01')).toMatchObject({ kind: 'statutory', synthetic: true });
    expect(result.warnings).toContain('政府資料缺少勞動節，已依勞基法補上');
    expect(result.warnings).toContain('週末備註未使用：2030-03-09 植樹節');
  });
});
