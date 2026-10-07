import ExcelJS from 'exceljs';
import { normalizeEmployeeIdentifier } from './employeeIdentityService.js';

const MAX_ROWS = 5_000;
const MAX_COLUMNS = 40;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

/**
 * Excel 會把「11-20」「08-12」這類班別代碼自動轉成日期儲存格。
 * 日期儲存格沒有時區，ExcelJS 以 UTC 午夜回傳，所以一律用 UTC 的月、日還原成「MM-DD」，
 * 另外保留「M-D」（不補零）當備用寫法，供比對班別代碼時一併嘗試。
 */
function dateCellCodes(date) {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const padded = `${pad2(month)}-${pad2(day)}`;
  const short = `${month}-${day}`;
  return { text: padded, alternatives: padded === short ? [] : [short] };
}

function cellDateValue(cell) {
  const value = cell?.value;
  if (isValidDate(value)) return value;
  if (value && typeof value === 'object' && isValidDate(value.result)) return value.result;
  return null;
}

function cellText(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return '';
  const dateValue = cellDateValue(cell);
  if (dateValue) return dateCellCodes(dateValue).text;
  if (typeof value === 'object') {
    if (value.result !== undefined) return String(value.result).trim();
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || '').join('').trim();
    if (value.text !== undefined) return String(value.text).trim();
  }
  return String(value).trim();
}

/** 班表儲存格內容；日期儲存格會多帶 fromDateCell 與備用寫法 alternatives。 */
function scheduleEntry(cell, day) {
  const entry = { day, code: cellText(cell) };
  const dateValue = cellDateValue(cell);
  if (dateValue) {
    const { alternatives } = dateCellCodes(dateValue);
    entry.fromDateCell = true;
    if (alternatives.length) entry.alternatives = alternatives;
  }
  return entry;
}

function employeeIdentifierText(cell) {
  const value = cell?.value;
  const numericValue = typeof value === 'number'
    ? value
    : typeof value?.result === 'number'
      ? value.result
      : null;
  const primaryNumberFormat = String(cell?.numFmt || '').split(';')[0].trim();

  if (
    Number.isSafeInteger(numericValue)
    && numericValue >= 0
    && /^0+$/.test(primaryNumberFormat)
  ) {
    return String(numericValue).padStart(primaryNumberFormat.length, '0');
  }

  return cellText(cell);
}

export class ScheduleWorkbookValidationError extends Error {
  constructor(message, { code = 'SCHEDULE_WORKBOOK_INVALID', errors = [], conflicts = [] } = {}) {
    super(message);
    this.name = 'ScheduleWorkbookValidationError';
    this.code = code;
    this.errors = errors;
    this.conflicts = conflicts;
  }
}

function parseDay(cell, month) {
  const dateValue = cellDateValue(cell);
  if (dateValue) return dateValue.getUTCDate();
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
  const employeeRowsById = new Map();
  const validationErrors = [];
  for (let rowNumber = employeeHeaderRow + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const employeeId = employeeIdentifierText(row.getCell(1));
    const employeeName = cellText(row.getCell(2));
    if (!employeeId && !employeeName) continue;
    if (/^(早班|中班|晚班|夜班|日班|統計|合計)/.test(employeeId) && !employeeName) continue;
    if (!employeeId) {
      validationErrors.push({
        row: rowNumber,
        day: null,
        code: '',
        message: '員工代號必填',
      });
      continue;
    }
    const normalizedEmployeeId = normalizeEmployeeIdentifier(employeeId);
    if (!employeeRowsById.has(normalizedEmployeeId)) {
      employeeRowsById.set(normalizedEmployeeId, { employeeId, rows: [] });
    }
    employeeRowsById.get(normalizedEmployeeId).rows.push(rowNumber);
    const entries = columns
      .map(({ column, day }) => scheduleEntry(row.getCell(column), day))
      .filter((entry) => entry.code && entry.code !== '未排班');
    rows.push({
      rowNumber,
      employeeId,
      employeeName,
      title: cellText(row.getCell(3)),
      entries,
    });
  }

  const conflicts = [...employeeRowsById.values()]
    .filter((item) => item.rows.length > 1)
    .map((item) => ({ employeeId: item.employeeId, rows: item.rows }));
  for (const conflict of conflicts) {
    const rowList = conflict.rows.join('、');
    for (const rowNumber of conflict.rows) {
      validationErrors.push({
        row: rowNumber,
        day: null,
        code: conflict.employeeId,
        message: `員工代號重複（第 ${rowList} 列）`,
      });
    }
  }
  if (validationErrors.length) {
    throw new ScheduleWorkbookValidationError('班表員工代號資料有誤', {
      code: conflicts.length ? 'WORKBOOK_EMPLOYEE_ID_CONFLICT' : 'EMPLOYEE_ID_REQUIRED',
      errors: validationErrors,
      conflicts,
    });
  }
  if (!rows.length) throw new Error('班表没有可辨识的员工资料');
  return { worksheetName: worksheet.name, employeeHeaderRow, dateRowNumber, columns, rows };
}

export const __testUtils = { cellText, employeeIdentifierText, parseDay, daysInMonth, dateCellCodes };
