import { describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';
import { __testUtils, parseScheduleWorkbook } from '../src/services/scheduleWorkbookService.js';

describe('schedule workbook parser', () => {
  it('parses the public four-row schedule layout with numeric dates', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('工作表1');
    sheet.addRow(['迦南健康體系班表']);
    sheet.addRow(['', '', '行事曆']);
    sheet.addRow(['', '', '日期', 1, 2, 3]);
    sheet.addRow(['員工代號', '姓名', '星期', '三', '四', '五']);
    sheet.addRow(['A001', '測試員工', '護理師', 'D', '特', '國']);

    const parsed = await parseScheduleWorkbook(await workbook.xlsx.writeBuffer(), { month: '2026-07' });

    expect(parsed.employeeHeaderRow).toBe(4);
    expect(parsed.rows).toEqual([expect.objectContaining({
      employeeId: 'A001',
      employeeName: '測試員工',
      entries: [{ day: 1, code: 'D' }, { day: 2, code: '特' }, { day: 3, code: '國' }],
    })]);
  });

  it('uses the day number from Excel dates while honoring the requested month', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('工作表1');
    sheet.addRow(['班表']);
    sheet.addRow(['', '', '行事曆']);
    sheet.addRow(['', '', '日期', new Date('2025-01-01T00:00:00.000Z')]);
    sheet.addRow(['員工代號', '姓名', '星期', '四']);
    sheet.addRow(['A001', '測試員工', '護理師', 'D']);

    const parsed = await parseScheduleWorkbook(await workbook.xlsx.writeBuffer(), { month: '2026-01' });
    expect(parsed.columns).toEqual([{ column: 4, day: 1 }]);
  });

  it('accepts an employee row when the name cell is blank', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('工作表1');
    sheet.addRow(['班表']);
    sheet.addRow(['', '', '行事曆']);
    sheet.addRow(['', '', '日期', 1]);
    sheet.addRow(['員工代號', '姓名', '星期', '三']);
    sheet.addRow(['A001', '', '護理師', 'D']);

    const parsed = await parseScheduleWorkbook(await workbook.xlsx.writeBuffer(), { month: '2026-07' });

    expect(parsed.rows).toEqual([expect.objectContaining({
      employeeId: 'A001',
      employeeName: '',
      entries: [{ day: 1, code: 'D' }],
    })]);
  });

  it('preserves leading zeroes expressed by the Excel number format', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('工作表1');
    sheet.addRow(['班表']);
    sheet.addRow(['', '', '行事曆']);
    sheet.addRow(['', '', '日期', 1]);
    sheet.addRow(['員工代號', '姓名', '星期', '三']);
    const employeeRow = sheet.addRow([123, '', '護理師', 'D']);
    employeeRow.getCell(1).numFmt = '00000';

    const parsed = await parseScheduleWorkbook(await workbook.xlsx.writeBuffer(), { month: '2026-07' });

    expect(parsed.rows[0].employeeId).toBe('00123');
  });

  it('rejects employee ids duplicated after whitespace, width, and case normalization', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('工作表1');
    sheet.addRow(['班表']);
    sheet.addRow(['', '', '行事曆']);
    sheet.addRow(['', '', '日期', 1]);
    sheet.addRow(['員工代號', '姓名', '星期', '三']);
    sheet.addRow(['A001', '員工一', '護理師', 'D']);
    sheet.addRow([' ａ００１ ', '員工二', '護理師', 'D']);

    await expect(parseScheduleWorkbook(
      await workbook.xlsx.writeBuffer(),
      { month: '2026-07' },
    )).rejects.toMatchObject({
      name: 'ScheduleWorkbookValidationError',
      code: 'WORKBOOK_EMPLOYEE_ID_CONFLICT',
      conflicts: [{ employeeId: 'A001', rows: [5, 6] }],
      errors: expect.arrayContaining([
        expect.objectContaining({ row: 5, code: 'A001' }),
        expect.objectContaining({ row: 6, code: 'A001' }),
      ]),
    });
  });

  it('rejects a named employee row that has no employee id', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('工作表1');
    sheet.addRow(['班表']);
    sheet.addRow(['', '', '行事曆']);
    sheet.addRow(['', '', '日期', 1]);
    sheet.addRow(['員工代號', '姓名', '星期', '三']);
    sheet.addRow(['', '缺少代號員工', '護理師', 'D']);

    await expect(parseScheduleWorkbook(
      await workbook.xlsx.writeBuffer(),
      { month: '2026-07' },
    )).rejects.toMatchObject({
      name: 'ScheduleWorkbookValidationError',
      code: 'EMPLOYEE_ID_REQUIRED',
      errors: [expect.objectContaining({ row: 5, message: '員工代號必填' })],
    });
  });

  it('turns Excel date cells back into readable MM-DD text with the M-D spelling as an alternative', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('工作表1');
    sheet.addRow(['班表']);
    sheet.addRow(['', '', '行事曆']);
    sheet.addRow(['', '', '日期', 1, 2, 3]);
    sheet.addRow(['員工代號', '姓名', '星期', '一', '二', '三']);
    // Excel 把輸入的「11-20」「08-12」轉成日期儲存格（UTC 午夜），其餘文字儲存格不受影響
    sheet.addRow([
      'A001', '測試員工', '護理師',
      new Date('2026-11-20T00:00:00.000Z'),
      new Date('2026-08-12T00:00:00.000Z'),
      'D',
    ]);

    const parsed = await parseScheduleWorkbook(await workbook.xlsx.writeBuffer(), { month: '2026-06' });

    expect(parsed.rows[0].entries).toEqual([
      { day: 1, code: '11-20', fromDateCell: true },
      { day: 2, code: '08-12', fromDateCell: true, alternatives: ['8-12'] },
      { day: 3, code: 'D' },
    ]);
    expect(JSON.stringify(parsed.rows[0].entries)).not.toMatch(/GMT/);
  });

  it('reads date cells with UTC parts so the day never shifts with the server time zone', () => {
    const { cellText, dateCellCodes } = __testUtils;

    expect(cellText({ value: new Date('2026-01-01T00:00:00.000Z') })).toBe('01-01');
    expect(cellText({ value: new Date('2026-12-31T23:30:00.000Z') })).toBe('12-31');
    expect(cellText({ value: { formula: 'DATE(2026,3,5)', result: new Date('2026-03-05T00:00:00.000Z') } })).toBe('03-05');
    expect(dateCellCodes(new Date('2026-03-05T00:00:00.000Z'))).toEqual({ text: '03-05', alternatives: ['3-5'] });
    expect(dateCellCodes(new Date('2026-11-20T00:00:00.000Z'))).toEqual({ text: '11-20', alternatives: [] });
    // 日期欄位的公式結果也走同一條路，不會被當成本地時間
    expect(__testUtils.parseDay({ value: { formula: 'x', result: new Date('2026-06-05T00:00:00.000Z') } }, '2026-06')).toBe(5);
  });
});
