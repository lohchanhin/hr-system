import { describe, expect, it } from '@jest/globals';
import ExcelJS from 'exceljs';
import { parseScheduleWorkbook } from '../src/services/scheduleWorkbookService.js';

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
});
