import ExcelJS from 'exceljs';

const MAX_ROWS = 5_000;
const MAX_COLUMNS = 40;

function cellText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    if (value.result !== undefined) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('').trim();
    if (value.text !== undefined) return String(value.text).trim();
  }
  return String(value).trim();
}

function parseDay(cell, month) {
  const value = cell?.value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getUTCDate();
  const text = cellText(cell);
  const number = Number(text);
  if (Number.isInteger(number) && number >= 1 && number <= 31) return number;
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.getUTCDate();
  const match = text.match(/(?:^|\D)([12]?\d|3[01])(?:日|$)/);
  return match ? Number(match[1]) : null;
}

function daysInMonth(month) {
  const [year, monthNumber] = month.split('-').map(Number);
  return new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
}

export async function parseScheduleWorkbook(buffer, { month } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) {
    throw new Error('month must use YYYY-MM format');
  }
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error('workbook has no worksheet');
  if (worksheet.actualRowCount > MAX_ROWS || worksheet.actualColumnCount > MAX_COLUMNS) {
    throw new Error('schedule workbook exceeds 5000 rows or 40 columns');
  }

  let employeeHeaderRow = null;
  for (let rowNumber = 1; rowNumber <= Math.min(12, worksheet.rowCount); rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const first = cellText(row.getCell(1));
    const second = cellText(row.getCell(2));
    if (/員工(?:代號|編號|工號)/.test(first) && /姓名/.test(second)) {
      employeeHeaderRow = rowNumber;
      break;
    }
  }
  if (!employeeHeaderRow) throw new Error('找不到「員工代號／姓名」標題列');

  const dateRowNumber = employeeHeaderRow - 1;
  const dateRow = worksheet.getRow(dateRowNumber);
  const maxDay = daysInMonth(month);
  const columns = [];
  const seenDays = new Set();
  for (let column = 4; column <= Math.min(worksheet.columnCount, MAX_COLUMNS); column += 1) {
    const day = parseDay(dateRow.getCell(column), month);
    if (!day || day > maxDay) continue;
    if (seenDays.has(day)) throw new Error(`日期欄位重複：${day}`);
    seenDays.add(day);
    columns.push({ column, day });
  }
  if (!columns.length) throw new Error('找不到有效日期欄位');

  const rows = [];
  const seenEmployeeIds = new Set();
  for (let rowNumber = employeeHeaderRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const employeeId = cellText(row.getCell(1));
    const employeeName = cellText(row.getCell(2));
    if (!employeeId && !employeeName) continue;
    if (/^(早班|中班|晚班|夜班|日班|統計|合計)/.test(employeeId) && !employeeName) continue;
    if (!employeeId || !employeeName) continue;
    if (seenEmployeeIds.has(employeeId)) throw new Error(`員工代號重複：${employeeId}`);
    seenEmployeeIds.add(employeeId);
    const entries = columns
      .map(({ column, day }) => ({ day, code: cellText(row.getCell(column)) }))
      .filter((entry) => entry.code && entry.code !== '未排班');
    rows.push({
      rowNumber,
      employeeId,
      employeeName,
      title: cellText(row.getCell(3)),
      entries,
    });
  }
  if (!rows.length) throw new Error('班表没有可辨识的员工资料');
  return { worksheetName: worksheet.name, employeeHeaderRow, dateRowNumber, columns, rows };
}

export const __testUtils = { cellText, parseDay, daysInMonth };
