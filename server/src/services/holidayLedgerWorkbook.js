/**
 * 國定假日休假紀錄的 Excel 工作表。
 * 班表匯出（第二個工作表）與「國定假日休假」視窗的匯出共用同一份版面。
 * 班表匯出的第一個工作表維持匯入格式，這張表一律當第二張，匯入只讀第一張，所以來回匯出匯入不受影響。
 */
import { LEDGER_RESOLUTION_LABELS, describeLedgerItem } from './holidayRestLedgerService.js';

export const HOLIDAY_LEDGER_SHEET_NAME = '國定假日休假紀錄';

const FIXED_HEADERS = ['員工代號', '姓名', '單位', '職稱'];
const SUMMARY_HEADERS = ['應休', '當日休', '移休', '補假', '未休', '待處理', '多排的國', '處理方式'];

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F1' } };
const OPEN_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4CCCC' } };
const MOVED_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };
const INFO_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };

const LEGEND = '說明：當日休＝國定假日當天排「國」；移休＝同月其他日期排「國」（依日期先後配對，總數正確）；'
  + '補假＝國定假日落在員工自己的休息日／例假，另排的補假日（註明「公務機關補假日」的是行政人員依政府補假日放假）；'
  + '待排補假＝落在休息日／例假、還沒排補假；未休＝本月沒有對應的「國」；多排的國＝超過國定假日天數的「國」；紅底＝待處理；'
  + '「—」＝該員工沒有這個項目（例如個人調移到其他日期）；'
  + '註明「已登記處理，請確認」＝先登記了未休的處理方式、班表之後又排了「國」，請確認是否重複補償。';

function formatMonthDay(dateKey) {
  return String(dateKey || '').slice(5).replace('-', '/');
}

function holidayHeader(holiday) {
  const base = `${holiday.name} ${formatMonthDay(holiday.date)}`;
  if (holiday.personal) return `${base}（個人調移）`;
  return holiday.movedFrom ? `${base}（原 ${formatMonthDay(holiday.movedFrom)}）` : base;
}

function describeResolution(item) {
  const resolution = item.resolution;
  if (!resolution) return '';
  const label = LEDGER_RESOLUTION_LABELS[resolution.kind] || '已處理';
  const detail = resolution.kind === 'compensatory_leave' && resolution.compensatoryHours != null
    ? `${label} ${resolution.compensatoryHours} 小時`
    : (resolution.kind === 'rested_later' && resolution.restedDate ? `${label} ${resolution.restedDate}` : label);
  const note = resolution.note ? `（${resolution.note}）` : '';
  return `${item.holidayName}：${detail}${note}`;
}

/**
 * 在活頁簿加入「國定假日休假紀錄」工作表。ledger 是 buildHolidayRestLedger 的結果（單一月份）。
 * filterText：匯出時套用了篩選或搜尋的說明（例如「僅列出待處理」），會寫在標題，讓人知道這不是完整名單。
 * 回傳新增的工作表。
 */
export function appendHolidayLedgerSheet(workbook, ledger, { departmentName = '', filterText = '' } = {}) {
  const holidays = ledger?.holidays || [];
  const employees = ledger?.employees || [];
  const [yearText, monthText] = String(ledger?.month || '').split('-');
  const sheet = workbook.addWorksheet(HOLIDAY_LEDGER_SHEET_NAME, {
    views: [{ state: 'frozen', xSplit: FIXED_HEADERS.length, ySplit: 3 }],
  });

  const headers = [...FIXED_HEADERS, ...holidays.map(holidayHeader), ...SUMMARY_HEADERS];
  const title = `${departmentName ? `${departmentName}　` : ''}${yearText}年${monthText}月 國定假日休假紀錄${filterText ? `（${filterText}）` : ''}`;
  sheet.addRow([title]);
  sheet.addRow([LEGEND]);
  sheet.addRow(headers);
  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.mergeCells(2, 1, 2, headers.length);

  if (!holidays.length) {
    sheet.addRow(['本月沒有國定假日。']);
    sheet.mergeCells(4, 1, 4, headers.length);
  }

  employees.forEach((employee) => {
    const itemTexts = holidays.map((holiday) => {
      const item = (employee.items || []).find((entry) => entry.holidayId === holiday.id);
      return item ? describeLedgerItem(item) : '—';
    });
    const resolutionTexts = (employee.items || []).map(describeResolution).filter(Boolean);
    const extraText = (employee.extraGuoDates || []).map(formatMonthDay).join('、');
    const row = sheet.addRow([
      employee.employeeNo,
      employee.name,
      employee.subDepartmentName,
      employee.title,
      ...itemTexts,
      employee.entitled,
      employee.rested,
      employee.moved,
      employee.compensated || 0,
      employee.notTaken,
      employee.open,
      extraText,
      resolutionTexts.join('；'),
    ]);
    holidays.forEach((holiday, index) => {
      const item = (employee.items || []).find((entry) => entry.holidayId === holiday.id);
      const cell = row.getCell(FIXED_HEADERS.length + index + 1);
      if (item?.needsAction || item?.resolutionConflict || item?.compensation?.conflict) cell.fill = OPEN_FILL;
      else if (item?.status === 'moved' || item?.status === 'compensated') cell.fill = MOVED_FILL;
      else if (item?.status === 'na' || (item?.status === 'not_taken' && !item?.resolution)) cell.fill = INFO_FILL;
    });
  });

  sheet.columns = [
    { width: 13 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    ...holidays.map(() => ({ width: 22 })),
    ...SUMMARY_HEADERS.map((header) => ({ width: header === '處理方式' ? 40 : (header === '多排的國' ? 16 : 9) })),
  ];

  [1, 2, 3].forEach((rowNumber) => {
    sheet.getRow(rowNumber).eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.font = { bold: rowNumber !== 2, size: rowNumber === 1 ? 14 : undefined };
      cell.alignment = {
        vertical: 'middle',
        horizontal: rowNumber === 3 ? 'center' : 'left',
        wrapText: rowNumber === 2,
      };
    });
  });
  sheet.getRow(1).height = 24;
  sheet.getRow(2).height = 32;
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber <= 3) return;
    row.eachCell((cell, colNumber) => {
      cell.alignment = {
        vertical: 'middle',
        horizontal: colNumber <= FIXED_HEADERS.length ? 'left' : 'center',
        wrapText: colNumber === headers.length,
      };
    });
  });
  return sheet;
}
