import ShiftSchedule from '../../models/ShiftSchedule.js';
import Employee from '../../models/Employee.js';
import AttendanceSetting from '../../models/AttendanceSetting.js';
import Department from '../../models/Department.js';
import Holiday from '../../models/Holiday.js';
import ScheduleDayMemo from '../../models/ScheduleDayMemo.js';
import dayjs from 'dayjs';
import { leaveDaysFromCalendar, loadApprovedLeaveCalendar } from '../../services/approvedLeaveCalendarService.js';
import { buildLiteralSearchRegex } from '../../utils/safeSearch.js';
import { registerTraditionalChinesePdfFont } from '../../services/pdfFontService.js';
import {
  SCHEDULE_EMPLOYEE_SELECT,
  toEntityId,
  getAllowedScheduleEmployeeIds,
  attachShiftInfo,
  buildScheduleOverview,
  IMPORT_HOLIDAY_CODES,
  IMPORT_LEAVE_CODES,
  normalizeWorkbookCode,
  resolveImportShiftKind,
} from './scheduleShared.js';

export async function exportScheduleOverview(req, res) {
  try {
    const { month, organization: organizationId, department: departmentId, subDepartment: subDepartmentId, format: formatParam } = req.query;
    const format = String(formatParam || '').toLowerCase();
    if (!['pdf', 'excel'].includes(format)) {
      return res.status(400).json({ error: 'format must be pdf or excel' });
    }

    let overview;
    try {
      overview = await buildScheduleOverview({ month, organizationId, departmentId, subDepartmentId });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const rows = [];
    overview.organizations.forEach((org) => {
      org.departments.forEach((dept) => {
        dept.subDepartments.forEach((sub) => {
          sub.employees.forEach((emp) => {
            emp.schedules.forEach((schedule) => {
              rows.push({
                organization: org.name,
                department: dept.name,
                subDepartment: sub.name,
                employee: emp.name,
                title: emp.title,
                date: schedule.date,
                shift: schedule.shiftName,
              });
            });
          });
        });
      });
    });

    const sanitizeSegment = (value) => {
      const cleaned = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '');
      return cleaned || 'all';
    };

    const filenameParts = [
      'schedule-overview',
      (month || '').replace(/\D/g, '') || 'all',
    ];
    if (organizationId) filenameParts.push(sanitizeSegment(organizationId));
    if (departmentId) filenameParts.push(sanitizeSegment(departmentId));
    if (subDepartmentId) filenameParts.push(sanitizeSegment(subDepartmentId));

    if (format === 'excel') {
      let ExcelJS;
      try {
        ExcelJS = (await import('exceljs')).default;
      } catch (err) {
        return res.status(500).json({ error: 'exceljs module not installed' });
      }
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Overview');
      ws.columns = [
        { header: '組織', key: 'organization' },
        { header: '部門', key: 'department' },
        { header: '單位', key: 'subDepartment' },
        { header: '員工', key: 'employee' },
        { header: '職稱', key: 'title' },
        { header: '日期', key: 'date' },
        { header: '班別', key: 'shift' },
      ];
      rows.forEach((row) => ws.addRow(row));
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filenameParts.join('-')}.xlsx"`);
      const buffer = await workbook.xlsx.writeBuffer();
      return res.send(buffer);
    }

    let PDFDocument;
    try {
      PDFDocument = (await import('pdfkit')).default;
    } catch (err) {
      return res.status(500).json({ error: 'pdfkit module not installed' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filenameParts.join('-')}.pdf"`);
    const doc = new PDFDocument();
    doc.fontSize(16).text('排班概覽', { align: 'center' });
    doc.moveDown();
    rows.forEach((row) => {
      doc.fontSize(12).text(
        `${row.organization}\t${row.department}\t${row.subDepartment}\t${row.employee}\t${row.title}\t${row.date}\t${row.shift}`
      );
    });
    doc.pipe(res);
    doc.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function exportSchedules(req, res) {
  try {
    const {
      month,
      department,
      subDepartment,
      format: formatParam,
      status: statusRaw,
      search: searchRaw,
      title: titleRaw,
      practiceTitle: practiceTitleRaw,
    } = req.query;
    if (!month || !department) {
      return res.status(400).json({ error: 'month and department required' });
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ error: 'invalid month format' });
    }
    const actorId = toEntityId(req.user?.id);
    if (!actorId) return res.status(401).json({ error: 'Invalid user' });
    const allowedEmployeeIds = await getAllowedScheduleEmployeeIds(req);
    if (allowedEmployeeIds !== null && allowedEmployeeIds.length === 0) {
      return res.status(403).json({ error: 'forbidden' });
    }
    let departmentName = '';
    try {
      const departmentDoc = await Department.findById(department).select('name unitName').lean();
      departmentName = departmentDoc?.unitName || departmentDoc?.name || '';
    } catch (err) {
      departmentName = '';
    }

    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);

    const query = { date: { $gte: start, $lt: end }, department };
    if (subDepartment) {
      query.subDepartment = subDepartment;
    }
    const status = String(statusRaw || 'all').trim();
    const search = String(searchRaw || '').trim();
    const title = String(titleRaw || '').trim();
    const practiceTitle = String(practiceTitleRaw || '').trim();

    const employeeQuery = { department };
    if (allowedEmployeeIds !== null) employeeQuery._id = { $in: allowedEmployeeIds };
    if (subDepartment) employeeQuery.subDepartment = subDepartment;
    if (search) {
      const rx = buildLiteralSearchRegex(search);
      employeeQuery.$or = [{ name: rx }, { employeeId: rx }];
    }
    if (title) {
      employeeQuery.title = title;
    }
    if (practiceTitle) {
      employeeQuery.practiceTitle = practiceTitle;
    }
    const employeeList = await Employee.find(employeeQuery)
      .select('_id employeeId name title practiceTitle subDepartment')
      .populate({ path: 'subDepartment', select: 'name' })
      .lean();
    const employeeIds = employeeList.map((item) => item._id.toString());
    query.employee = { $in: employeeIds };

    const raw = await ShiftSchedule.find(query)
      .populate({ path: 'employee', select: SCHEDULE_EMPLOYEE_SELECT })
      .lean();
    let schedules = await attachShiftInfo(raw);
    const daysInMonth = dayjs(`${month}-01`).daysInMonth();
    const leaveCalendar = await loadApprovedLeaveCalendar({ employeeIds, start, end });
    const leaveDaysMap = new Map(employeeIds.map((employeeId) => [
      employeeId,
      leaveDaysFromCalendar(leaveCalendar, employeeId, '/'),
    ]));
    const grouped = new Map();
    schedules.forEach((item) => {
      const empId = item?.employee?._id?.toString?.() || '';
      if (!empId) return;
      if (!grouped.has(empId)) grouped.set(empId, []);
      grouped.get(empId).push(item);
    });

    const statusByEmployee = new Map();
    employeeIds.forEach((empId) => {
      const list = grouped.get(empId) || [];
      const hasLeave = (leaveDaysMap.get(empId)?.size || 0) > 0;
      const filledDays = new Set([
        ...list.filter((row) => !!row.shiftId).map((row) => row.date),
        ...(leaveDaysMap.get(empId) || []),
      ]).size;
      const currentStatus = hasLeave ? 'onLeave' : (filledDays < daysInMonth ? 'unscheduled' : 'scheduled');
      statusByEmployee.set(empId, currentStatus);
    });

    let filteredEmployees = employeeList;
    if (status !== 'all') {
      filteredEmployees = employeeList.filter((employee) => (
        statusByEmployee.get(employee._id.toString()) === status
      ));
      const filteredIds = new Set(filteredEmployees.map((item) => item._id.toString()));
      schedules = schedules.filter((item) => filteredIds.has(item?.employee?._id?.toString?.() || ''));
    }

    const format = formatParam === 'excel' ? 'excel' : 'pdf';
    const [memoRows, holidayRows] = await Promise.all([
      ScheduleDayMemo.find({
        date: { $gte: start, $lt: end },
        department,
        subDepartment: subDepartment || null,
      }).sort({ date: 1 }).lean(),
      Holiday.find({ date: { $gte: start, $lt: end } }).lean(),
    ]);
    const memoByDay = new Map((memoRows || []).map((memo) => [
      new Date(memo.date).getUTCDate(),
      String(memo.content || '').trim(),
    ]));
    const holidayByDay = new Map((holidayRows || []).map((holiday) => [
      new Date(holiday.date).getUTCDate(),
      String(holiday.name || '國定假日').trim(),
    ]));
    const monthDays = Array.from({ length: daysInMonth }, (_, idx) => idx + 1);
    const [yearNumber, monthNumber] = month.split('-').map(Number);
    const weekLabels = ['日', '一', '二', '三', '四', '五', '六'];
    const scheduleMap = new Map();
    schedules.forEach((item) => {
      const empId = item?.employee?._id?.toString?.() || '';
      if (!empId) return;
      if (!scheduleMap.has(empId)) scheduleMap.set(empId, new Map());
      const dateKey = dayjs(item.date, 'YYYY/MM/DD').date();
      scheduleMap.get(empId).set(dateKey, item.shiftCode || item.shiftName || '');
    });
    const exportSettingQuery = AttendanceSetting.findOne();
    const exportSetting = exportSettingQuery && typeof exportSettingQuery.lean === 'function'
      ? await exportSettingQuery.lean()
      : await exportSettingQuery;
    // 班別設定裡每個代碼／名稱屬於哪一類（請假、國定假日…），請假核准要換成班表代碼、儲存格底色都靠它
    const shiftKindByText = new Map();
    const leaveShiftCodeByText = new Map();
    (exportSetting?.shifts || []).forEach((shift) => {
      const kind = resolveImportShiftKind(shift);
      const shiftCode = String(shift.code || shift.name || '').trim();
      [shift.code, shift.name].forEach((text) => {
        const key = normalizeWorkbookCode(text);
        if (!key) return;
        if (!shiftKindByText.has(key)) shiftKindByText.set(key, kind);
        if (kind === 'leave' && shiftCode && !leaveShiftCodeByText.has(key)) leaveShiftCodeByText.set(key, shiftCode);
      });
    });
    // 核准的請假類型優先對應班別設定裡的請假班別（例如「公傷假」→「公傷」），找不到才用舊的簡稱規則
    const leaveCode = (leaveType) => (
      leaveShiftCodeByText.get(normalizeWorkbookCode(leaveType))
      || (
        leaveType.includes('特') ? '特'
          : leaveType.includes('病') ? '病'
            : leaveType.includes('事') ? '事'
              : leaveType.includes('喪') ? '喪'
                : leaveType.includes('公傷') ? '公傷'
                  : leaveType.includes('公') ? '公'
                    : leaveType.includes('原') ? '原'
                      : leaveType.includes('補') ? '補' : leaveType
      )
    );
    const exportRows = filteredEmployees.map((employee) => {
      const empId = employee._id.toString();
      const employeeLeaveCalendar = leaveCalendar.get(empId) || new Map();
      const employeeScheduleMap = scheduleMap.get(empId) || new Map();
      return {
        employeeId: employee.employeeId || '',
        name: employee.name || '',
        unit: employee.subDepartment?.name || '',
        title: employee.practiceTitle || employee.title || '',
        days: monthDays.map((day) => {
          const dateKey = `${month}-${String(day).padStart(2, '0')}`;
          const approvedLeave = employeeLeaveCalendar.get(dateKey);
          return approvedLeave ? leaveCode(approvedLeave) : (employeeScheduleMap.get(day) || '');
        }),
      };
    });

    const sanitizeSegment = (value) => {
      const cleaned = String(value)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '');
      return cleaned || 'all';
    };

    const sanitizedMonth = month.replace(/\D/g, '') || 'all';
    const filenameParts = ['schedules', sanitizedMonth, sanitizeSegment(department)];
    if (subDepartment) {
      filenameParts.push(sanitizeSegment(subDepartment));
    }
    const extension = format === 'excel' ? 'xlsx' : 'pdf';
    const filename = `${filenameParts.join('-')}.${extension}`;

    if (format === 'excel') {
      let ExcelJS;
      try {
        ExcelJS = (await import('exceljs')).default;
      } catch (err) {
        return res.status(500).json({ error: 'exceljs module not installed' });
      }
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'HR System';
      workbook.created = new Date();
      const ws = workbook.addWorksheet('工作表1', { views: [{ state: 'frozen', xSplit: 4, ySplit: 5 }] });

      const titleText = departmentName
        ? `${departmentName}　${yearNumber}年${String(monthNumber).padStart(2, '0')}月班表`
        : `${yearNumber}年${String(monthNumber).padStart(2, '0')}月班表`;
      ws.addRow([titleText]);
      ws.addRow(['備忘錄', '', '', '', ...monthDays.map((day) => memoByDay.get(day) || '')]);
      ws.addRow(['行事曆', '', '', '', ...monthDays.map((day) => holidayByDay.get(day) || '')]);
      ws.addRow(['日期', '', '', '', ...monthDays.map((day) => new Date(Date.UTC(yearNumber, monthNumber - 1, day)))]);
      ws.addRow(['員工代號', '姓名', '單位', '職稱／職位', ...monthDays.map((day) => (
        weekLabels[new Date(Date.UTC(yearNumber, monthNumber - 1, day)).getUTCDay()]
      ))]);
      ws.mergeCells(1, 1, 1, monthDays.length + 4);
      ws.mergeCells(2, 1, 2, 4);
      ws.mergeCells(3, 1, 3, 4);
      ws.mergeCells(4, 1, 4, 4);

      ws.columns = [
        { width: 13 },
        { width: 16 },
        { width: 16 },
        { width: 18 },
        ...monthDays.map(() => ({ width: 8 })),
      ];
      monthDays.forEach((day, index) => {
        ws.getCell(4, index + 5).numFmt = 'd';
      });

      const weekendCols = new Set();
      monthDays.forEach((day, dayIndex) => {
        const dateObj = dayjs(`${month}-${String(day).padStart(2, '0')}`);
        const dayOfWeek = dateObj.day();
        if (dayOfWeek === 0 || dayOfWeek === 6) {
          weekendCols.add(dayIndex + 5);
        }
      });

      exportRows.forEach((row) => ws.addRow([
        row.employeeId,
        row.name,
        row.unit,
        row.title,
        ...row.days,
      ]));

      const statisticsStartRow = ws.rowCount + 2;
      const firstEmployeeRow = 6;
      const lastEmployeeRow = 5 + exportRows.length;
      const shiftCodes = Array.from(new Set((exportSetting?.shifts || [])
        .map((shift) => String(shift.code || shift.name || '').trim())
        .filter(Boolean)));
      shiftCodes.forEach((shiftCode, index) => {
        const rowNumber = statisticsStartRow + index;
        ws.getCell(rowNumber, 1).value = shiftCode;
        ws.getCell(rowNumber, 2).value = '每日人數';
        monthDays.forEach((_day, dayIndex) => {
          const columnNumber = dayIndex + 5;
          const columnLetter = ws.getColumn(columnNumber).letter;
          ws.getCell(rowNumber, columnNumber).value = exportRows.length
            ? {
              formula: `COUNTIF(${columnLetter}${firstEmployeeRow}:${columnLetter}${lastEmployeeRow},${JSON.stringify(shiftCode)})`,
            }
            : 0;
        });
      });

      const headerStyle = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDCE6F1' },
      };
      const weekendStyle = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF5F5F5' },
      };
      const unscheduledStyle = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE599' },
      };
      const leaveStyle = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8CBAD' },
      };
      const holidayStyle = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF4CCCC' },
      };
      // 有值的格子（含國定假日、請假班別）都是已排班，只有空白格才是未排班的黃底
      const fillForCode = (value) => {
        const key = normalizeWorkbookCode(value);
        const kind = shiftKindByText.get(key);
        if (kind === 'leave') return leaveStyle;
        if (kind === 'holiday') return holidayStyle;
        if (kind) return null;
        if (IMPORT_LEAVE_CODES.has(key)) return leaveStyle;
        if (IMPORT_HOLIDAY_CODES.has(key)) return holidayStyle;
        return null;
      };

      [1, 2, 3, 4, 5].forEach((rowNumber) => ws.getRow(rowNumber).eachCell((cell) => {
        cell.fill = headerStyle;
        cell.font = { bold: rowNumber === 1 || rowNumber === 5, size: rowNumber === 1 ? 14 : undefined };
        cell.alignment = {
          vertical: 'middle',
          horizontal: rowNumber === 1 ? 'left' : 'center',
          wrapText: rowNumber === 2,
        };
      }));
      ws.getRow(1).height = 24;
      ws.getRow(2).height = 42;

      ws.eachRow((row, rowNumber) => {
        if (rowNumber <= 5 || rowNumber >= statisticsStartRow) return;
        row.eachCell((cell, colNumber) => {
          if (colNumber >= 5 && weekendCols.has(colNumber)) {
            cell.fill = weekendStyle;
          }
          if (!cell.value && colNumber >= 5) {
            cell.fill = unscheduledStyle;
          } else if (colNumber >= 5) {
            const codeFill = fillForCode(cell.value);
            if (codeFill) cell.fill = codeFill;
          }
          cell.alignment = { vertical: 'middle', horizontal: colNumber <= 4 ? 'left' : 'center' };
        });
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      const buffer = await workbook.xlsx.writeBuffer();
      return res.send(buffer);
    } else {
      let PDFDocument;
      try {
        PDFDocument = (await import('pdfkit')).default;
      } catch (err) {
        return res.status(500).json({ error: 'pdfkit module not installed' });
      }
      const doc = new PDFDocument({ margin: 42 });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      
      // Register Chinese font for Traditional Chinese support
      try {
        registerTraditionalChinesePdfFont(doc, 'NotoSansCJK');
      } catch (error) {
        return res.status(503).json({ error: error.message });
      }
      doc.pipe(res);
      
      doc.fontSize(16).text(departmentName ? `${departmentName} 排班表` : '排班表', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).text(`月份：${month}`, { align: 'center' });
      doc.moveDown(1.5);

      const memoEntries = Array.from(memoByDay.entries()).filter(([, content]) => content);
      if (memoEntries.length) {
        doc.fontSize(11).text('備忘錄');
        memoEntries.forEach(([day, content]) => {
          doc.fontSize(9).text(`${month}-${String(day).padStart(2, '0')}：${content.replace(/\n/g, '／')}`);
        });
        doc.moveDown();
      }

      const calendarEntries = Array.from(holidayByDay.entries()).filter(([, content]) => content);
      if (calendarEntries.length) {
        doc.fontSize(11).text('行事曆');
        calendarEntries.forEach(([day, content]) => {
          doc.fontSize(9).text(`${month}-${String(day).padStart(2, '0')}：${content.replace(/\n/g, '／')}`);
        });
        doc.moveDown();
      }

      const tableLeft = 42;
      const colWidths = { employee: 220, date: 105, shift: 145 };
      let y = doc.y;
      const drawPdfHeader = () => {
        doc.fontSize(9);
        doc.text('員工代號／姓名／單位／職稱', tableLeft, y, { width: colWidths.employee, underline: true });
        doc.text('日期', tableLeft + colWidths.employee, y, { width: colWidths.date, underline: true });
        doc.text('班別／假別', tableLeft + colWidths.employee + colWidths.date, y, { width: colWidths.shift, underline: true });
        y += 20;
      };
      drawPdfHeader();

      exportRows.forEach((row) => {
        row.days.forEach((value, index) => {
          if (!value) return;
          if (y > 730) {
            doc.addPage();
            y = 42;
            drawPdfHeader();
          }
          doc.fontSize(8);
          doc.text([row.employeeId, row.name, row.unit, row.title].filter(Boolean).join('／'), tableLeft, y, { width: colWidths.employee });
          doc.text(`${month}-${String(index + 1).padStart(2, '0')}`, tableLeft + colWidths.employee, y, { width: colWidths.date });
          doc.text(value, tableLeft + colWidths.employee + colWidths.date, y, { width: colWidths.shift });
          y += 17;
        });
      });
      doc.end();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
