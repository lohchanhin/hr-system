import Report from '../models/Report.js';
import { exportTabularReport } from '../services/reportExportHelper.js';
import {
  getDepartmentReportData,
  ReportAccessError,
  getReportDisplayName,
} from '../services/reportMetricsService.js';

const NOTIFICATION_FREQUENCIES = new Set(['daily', 'weekly', 'monthly']);

function defaultExportSettings() {
  return { formats: [], includeLogo: false, footerNote: '' };
}

function defaultPermissionSettings() {
  return {
    supervisorDept: false,
    hrAllDept: false,
    employeeDownload: false,
    historyMonths: 6,
  };
}

function defaultNotificationSettings() {
  return { autoSend: false, sendFrequency: '', recipients: [] };
}

function normalizeFieldArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((field) => (typeof field === 'string' ? field.trim() : ''))
    .filter(Boolean);
}

function normalizeExportSettings(raw, { partial } = {}) {
  if (raw === undefined) {
    return { value: partial ? undefined : defaultExportSettings(), errors: [] };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { value: undefined, errors: ['匯出設定需為物件'] };
  }

  const errors = [];
  const formats =
    'formats' in raw
      ? Array.isArray(raw.formats)
        ? normalizeFieldArray(raw.formats)
        : (errors.push('匯出格式需為陣列'), [])
      : [];

  let includeLogo = false;
  if ('includeLogo' in raw) {
    includeLogo = Boolean(raw.includeLogo);
  }

  let footerNote = '';
  if ('footerNote' in raw) {
    if (raw.footerNote === undefined || raw.footerNote === null) {
      footerNote = '';
    } else if (typeof raw.footerNote !== 'string') {
      errors.push('頁尾備註需為文字');
    } else {
      footerNote = raw.footerNote.trim();
    }
  }

  return {
    value: { formats, includeLogo, footerNote },
    errors,
  };
}

function normalizePermissionSettings(raw, { partial } = {}) {
  if (raw === undefined) {
    return { value: partial ? undefined : defaultPermissionSettings(), errors: [] };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { value: undefined, errors: ['權限設定需為物件'] };
  }

  const errors = [];
  const settings = defaultPermissionSettings();

  if ('supervisorDept' in raw) settings.supervisorDept = Boolean(raw.supervisorDept);
  if ('hrAllDept' in raw) settings.hrAllDept = Boolean(raw.hrAllDept);
  if ('employeeDownload' in raw)
    settings.employeeDownload = Boolean(raw.employeeDownload);

  if ('historyMonths' in raw) {
    const months = Number(raw.historyMonths);
    if (!Number.isFinite(months) || months < 0) {
      errors.push('可查詢歷史月份需為非負整數');
    } else {
      settings.historyMonths = Math.floor(months);
    }
  }

  return { value: settings, errors };
}

function normalizeNotificationSettings(raw, { partial } = {}) {
  if (raw === undefined) {
    return { value: partial ? undefined : defaultNotificationSettings(), errors: [] };
  }

  if (typeof raw !== 'object' || raw === null) {
    return { value: undefined, errors: ['通知設定需為物件'] };
  }

  const errors = [];
  const settings = defaultNotificationSettings();

  if ('autoSend' in raw) settings.autoSend = Boolean(raw.autoSend);

  if ('sendFrequency' in raw && raw.sendFrequency !== '' && raw.sendFrequency !== undefined && raw.sendFrequency !== null) {
    const frequency = String(raw.sendFrequency).trim();
    if (!NOTIFICATION_FREQUENCIES.has(frequency)) {
      errors.push('寄送頻率必須為 daily、weekly 或 monthly');
    } else {
      settings.sendFrequency = frequency;
    }
  }

  if ('recipients' in raw) {
    if (!Array.isArray(raw.recipients)) {
      errors.push('寄送對象需為陣列');
    } else {
      settings.recipients = normalizeFieldArray(raw.recipients);
    }
  }

  if (!settings.autoSend) {
    settings.sendFrequency = '';
    settings.recipients = [];
  }

  return { value: settings, errors };
}

function normalizeReportType(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

async function isDepartmentReportAllowedForActor(type, actor) {
  const normalizedType = normalizeReportType(type);
  if (!normalizedType) return false;
  if (!actor || !actor.role) return false;

  if (actor.role === 'admin') return true;

  if (actor.role === 'supervisor') {
    const exists = await Report.exists({
      type: normalizedType,
      'permissionSettings.supervisorDept': true,
    });
    return Boolean(exists);
  }

  return false;
}

function normalizeReportPayload(body, { partial = false } = {}) {
  const errors = [];

  if (!body || typeof body !== 'object') {
    return { data: {}, errors: ['請提供有效的報表資料'] };
  }

  const data = {};

  if ('name' in body) {
    if (typeof body.name !== 'string') {
      errors.push('報表名稱需為文字');
    } else {
      const name = body.name.trim();
      if (!name) {
        errors.push('報表名稱為必填');
      } else {
        data.name = name;
      }
    }
  } else if (!partial) {
    errors.push('報表名稱為必填');
  }

  if ('type' in body) {
    if (typeof body.type !== 'string') {
      errors.push('報表類型需為文字');
    } else {
      const type = body.type.trim();
      data.type = type || 'custom';
    }
  } else if (!partial) {
    data.type = 'custom';
  }

  if ('fields' in body) {
    if (!Array.isArray(body.fields)) {
      errors.push('欄位設定需為陣列');
    } else {
      data.fields = normalizeFieldArray(body.fields);
    }
  } else if (!partial) {
    data.fields = [];
  }

  if ('data' in body) {
    data.data = body.data;
  } else if (!partial) {
    data.data = {};
  }

  const { value: exportSettings, errors: exportErrors } = normalizeExportSettings(
    body.exportSettings,
    { partial }
  );
  errors.push(...exportErrors);
  if (exportSettings !== undefined) data.exportSettings = exportSettings;

  const { value: permissionSettings, errors: permissionErrors } =
    normalizePermissionSettings(body.permissionSettings, { partial });
  errors.push(...permissionErrors);
  if (permissionSettings !== undefined) data.permissionSettings = permissionSettings;

  const { value: notificationSettings, errors: notificationErrors } =
    normalizeNotificationSettings(body.notificationSettings, { partial });
  errors.push(...notificationErrors);
  if (notificationSettings !== undefined)
    data.notificationSettings = notificationSettings;

  return { data, errors };
}

function buildReportResponse(report) {
  if (!report) return null;

  const source =
    typeof report.toObject === 'function'
      ? report.toObject({ depopulate: true })
      : report;

  const idValue = source._id ?? source.id;
  const id =
    idValue && typeof idValue.toString === 'function'
      ? idValue.toString()
      : idValue;

  const { value: exportSettings } = normalizeExportSettings(source.exportSettings, {
    partial: false,
  });
  const { value: permissionSettings } = normalizePermissionSettings(
    source.permissionSettings,
    { partial: false }
  );
  const { value: notificationSettings } = normalizeNotificationSettings(
    source.notificationSettings,
    { partial: false }
  );

  return {
    id: id ?? undefined,
    name: typeof source.name === 'string' ? source.name : '',
    type:
      typeof source.type === 'string' && source.type.trim()
        ? source.type.trim()
        : 'custom',
    fields: normalizeFieldArray(source.fields),
    exportSettings,
    permissionSettings,
    notificationSettings,
    createdAt: source.createdAt ?? undefined,
    updatedAt: source.updatedAt ?? undefined,
  };
}

export async function listSupervisorDepartmentReports(req, res) {
  try {
    const reports = await Report.find({ 'permissionSettings.supervisorDept': true });
    res.json(reports.map((report) => buildReportResponse(report)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function normalizeId(value) {
  if (value === undefined || value === null) return '';

  const visited = new Set();
  let current = value;
  let depth = 0;
  const MAX_DEPTH = 50;

  while (current !== undefined && current !== null && depth < MAX_DEPTH) {
    const type = typeof current;

    if (type === 'string' || type === 'number' || type === 'boolean' || type === 'bigint') {
      return String(current);
    }

    if (type === 'object') {
      if (visited.has(current)) break;
      visited.add(current);

      if (typeof current.toHexString === 'function') {
        const hex = current.toHexString();
        if (hex) return String(hex);
      }

      if (typeof current.toString === 'function' && current.toString !== Object.prototype.toString) {
        const str = current.toString();
        if (typeof str === 'string' && str && str !== '[object Object]') {
          return str;
        }
      }

      if ('_id' in current) {
        const next = current._id;
        if (next !== current && next !== undefined && next !== null) {
          current = next;
          depth += 1;
          continue;
        }
      }

      if (typeof current.valueOf === 'function') {
        const valueOf = current.valueOf();
        if (valueOf !== current) {
          current = valueOf;
          depth += 1;
          continue;
        }
      }

      break;
    }

    if (type === 'function') {
      if (visited.has(current)) break;
      visited.add(current);
      current = current();
      depth += 1;
      continue;
    }

    return String(current);
  }

  if (depth >= MAX_DEPTH) return '';

  if (current === undefined || current === null) return '';

  if (typeof current === 'string') return current;
  if (typeof current === 'number' || typeof current === 'boolean' || typeof current === 'bigint') {
    return String(current);
  }

  if (typeof current.toString === 'function') {
    const fallback = current.toString();
    if (typeof fallback === 'string' && fallback !== '[object Object]') {
      return fallback;
    }
  }

  return String(current);
}

const DEPARTMENT_EXPORT_CONFIG = {
  attendance: {
    columns: [
      { header: '員工姓名', key: 'name', width: 24 },
      { header: '排班天數', key: 'scheduled', width: 14 },
      { header: '出勤天數', key: 'attended', width: 14 },
      { header: '缺勤天數', key: 'absent', width: 14 },
    ],
    mapRow: (record) => ({
      name: record.name,
      scheduled: record.scheduled,
      attended: record.attended,
      absent: record.absent,
    }),
    buildSummaryRows: (summary = {}) => [
      { label: '排班總計', value: summary.scheduled ?? 0 },
      { label: '出勤總計', value: summary.attended ?? 0 },
      { label: '缺勤總計', value: summary.absent ?? 0 },
    ],
  },
  leave: {
    columns: [
      { header: '員工姓名', key: 'name', width: 24 },
      { header: '假別', key: 'leaveType', width: 18 },
      { header: '假別代碼', key: 'leaveCode', width: 16 },
      { header: '開始日期', key: 'startDate', width: 16 },
      { header: '結束日期', key: 'endDate', width: 16 },
      { header: '天數', key: 'days', width: 10 },
    ],
    mapRow: (record) => ({
      name: record.name,
      leaveType: record.leaveType,
      leaveCode: record.leaveCode,
      startDate: record.startDate,
      endDate: record.endDate,
      days: record.days,
    }),
    buildSummaryRows: (summary = {}) => {
      const rows = [
        { label: '總請假件數', value: summary.totalLeaves ?? 0 },
        { label: '總請假天數', value: summary.totalDays ?? 0 },
      ];
      (summary.byType ?? []).forEach((item) => {
        rows.push({
          label: `${item.leaveType || item.leaveCode || '其他'} 件數`,
          value: `${item.count ?? 0} 筆 / ${item.days ?? 0} 天`,
        });
      });
      return rows;
    },
  },
  tardiness: {
    columns: [
      { header: '員工姓名', key: 'name', width: 24 },
      { header: '日期', key: 'date', width: 16 },
      { header: '排定上班', key: 'scheduledStart', width: 14 },
      { header: '實際打卡', key: 'actualClockIn', width: 14 },
      { header: '遲到分鐘', key: 'minutesLate', width: 12 },
    ],
    mapRow: (record) => ({
      name: record.name,
      date: record.date,
      scheduledStart: record.scheduledStart,
      actualClockIn: record.actualClockIn,
      minutesLate: record.minutesLate,
    }),
    buildSummaryRows: (summary = {}) => [
      { label: '遲到件數', value: summary.totalLateCount ?? 0 },
      { label: '遲到總分鐘', value: summary.totalLateMinutes ?? 0 },
      { label: '平均遲到分鐘', value: summary.averageLateMinutes ?? 0 },
    ],
  },
  earlyLeave: {
    columns: [
      { header: '員工姓名', key: 'name', width: 24 },
      { header: '日期', key: 'date', width: 16 },
      { header: '排定下班', key: 'scheduledEnd', width: 14 },
      { header: '實際打卡', key: 'actualClockOut', width: 14 },
      { header: '早退分鐘', key: 'minutesEarly', width: 12 },
    ],
    mapRow: (record) => ({
      name: record.name,
      date: record.date,
      scheduledEnd: record.scheduledEnd,
      actualClockOut: record.actualClockOut,
      minutesEarly: record.minutesEarly,
    }),
    buildSummaryRows: (summary = {}) => [
      { label: '早退件數', value: summary.totalEarlyLeaveCount ?? 0 },
      { label: '早退總分鐘', value: summary.totalEarlyMinutes ?? 0 },
      { label: '平均早退分鐘', value: summary.averageEarlyMinutes ?? 0 },
    ],
  },
  workHours: {
    columns: [
      { header: '員工姓名', key: 'name', width: 24 },
      { header: '日期', key: 'date', width: 16 },
      { header: '排定工時(小時)', key: 'scheduledHours', width: 18 },
      { header: '實際工時(小時)', key: 'workedHours', width: 18 },
      { header: '差異(小時)', key: 'differenceHours', width: 14 },
    ],
    mapRow: (record) => ({
      name: record.name,
      date: record.date,
      scheduledHours: record.scheduledHours,
      workedHours: record.workedHours,
      differenceHours: record.differenceHours,
    }),
    buildSummaryRows: (summary = {}) => [
      { label: '排定總工時', value: summary.totalScheduledHours ?? 0 },
      { label: '實際總工時', value: summary.totalWorkedHours ?? 0 },
      { label: '工時差異', value: summary.differenceHours ?? 0 },
    ],
  },
  overtime: {
    columns: [
      { header: '員工姓名', key: 'name', width: 24 },
      { header: '日期', key: 'date', width: 16 },
      { header: '開始時間', key: 'startTime', width: 14 },
      { header: '結束時間', key: 'endTime', width: 14 },
      { header: '時數', key: 'hours', width: 10 },
      { header: '原因', key: 'reason', width: 24 },
    ],
    mapRow: (record) => ({
      name: record.name,
      date: record.date,
      startTime: record.startTime,
      endTime: record.endTime,
      hours: record.hours,
      reason: record.reason,
    }),
    buildSummaryRows: (summary = {}) => [
      { label: '加班申請數', value: summary.totalRequests ?? 0 },
      { label: '加班總時數', value: summary.totalHours ?? 0 },
    ],
  },
  compTime: {
    columns: [
      { header: '員工姓名', key: 'name', width: 24 },
      { header: '日期', key: 'date', width: 16 },
      { header: '補休時數', key: 'hours', width: 14 },
      { header: '來源加班單', key: 'overtimeReference', width: 24 },
    ],
    mapRow: (record) => ({
      name: record.name,
      date: record.date,
      hours: record.hours,
      overtimeReference: record.overtimeReference,
    }),
    buildSummaryRows: (summary = {}) => [
      { label: '補休申請數', value: summary.totalRequests ?? 0 },
      { label: '補休總時數', value: summary.totalHours ?? 0 },
    ],
  },
  makeUp: {
    columns: [
      { header: '員工姓名', key: 'name', width: 24 },
      { header: '日期', key: 'date', width: 16 },
      { header: '補卡類別', key: 'category', width: 18 },
      { header: '補卡說明', key: 'note', width: 28 },
    ],
    mapRow: (record) => ({
      name: record.name,
      date: record.date,
      category: record.category,
      note: record.note,
    }),
    buildSummaryRows: (summary = {}) => {
      const rows = [{ label: '補卡申請數', value: summary.totalRequests ?? 0 }];
      (summary.byCategory ?? []).forEach((item) => {
        rows.push({ label: `${item.label ?? '未分類'} 件數`, value: `${item.count ?? 0} 筆` });
      });
      return rows;
    },
  },
  specialLeave: {
    columns: [
      { header: '員工姓名', key: 'name', width: 24 },
      { header: '開始日期', key: 'startDate', width: 16 },
      { header: '結束日期', key: 'endDate', width: 16 },
      { header: '天數', key: 'days', width: 10 },
    ],
    mapRow: (record) => ({
      name: record.name,
      startDate: record.startDate,
      endDate: record.endDate,
      days: record.days,
    }),
    buildSummaryRows: (summary = {}) => [
      { label: '特休申請數', value: summary.totalRequests ?? 0 },
      { label: '特休總天數', value: summary.totalDays ?? 0 },
    ],
  },
};

function createDepartmentReportHandler(type) {
  return async function departmentReportHandler(req, res) {
    const { month, department, format: rawFormat } = req.query;
    if (!month || !department) {
      return res.status(400).json({ error: 'month and department required' });
    }

    const format = typeof rawFormat === 'string' ? rawFormat.toLowerCase() : 'json';
    const actor = { role: req.user?.role, id: req.user?.id };
    const normalizedType = normalizeReportType(type);

    try {
      const allowed = await isDepartmentReportAllowedForActor(normalizedType, actor);
      if (!allowed) {
        return res.status(403).json({ error: '報表類型未開放' });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    try {
      const data = await getDepartmentReportData({
        type: normalizedType,
        month,
        departmentId: department,
        actor,
      });

      if (format === 'excel' || format === 'pdf') {
        const config = DEPARTMENT_EXPORT_CONFIG[normalizedType] ?? {};
        const mapRow = config.mapRow || ((row) => row);
        const rows = (data.records ?? []).map(mapRow);
        const summaryRows = config.buildSummaryRows
          ? config.buildSummaryRows(data.summary ?? {})
          : [];
        await exportTabularReport(res, {
          format,
          fileName: `${normalizedType}-${department}-${month}`,
          sheetName: getReportDisplayName(normalizedType),
          title: `${month} ${getReportDisplayName(normalizedType)}`,
          columns: config.columns ?? [],
          rows,
          summaryRows,
        });
        return;
      }

      res.json({
        month,
        department,
        summary: data.summary ?? null,
        records: data.records ?? [],
      });
    } catch (err) {
      if (err instanceof ReportAccessError) {
        return res.status(err.status ?? 500).json({ error: err.message });
      }
      res.status(500).json({ error: err.message });
    }
  };
}

export const exportDepartmentAttendance = createDepartmentReportHandler('attendance');
export const exportDepartmentLeave = createDepartmentReportHandler('leave');
export const exportDepartmentTardiness = createDepartmentReportHandler('tardiness');
export const exportDepartmentEarlyLeave = createDepartmentReportHandler('earlyLeave');
export const exportDepartmentWorkHours = createDepartmentReportHandler('workHours');
export const exportDepartmentOvertime = createDepartmentReportHandler('overtime');
export const exportDepartmentCompTime = createDepartmentReportHandler('compTime');
export const exportDepartmentMakeUp = createDepartmentReportHandler('makeUp');
export const exportDepartmentSpecialLeave = createDepartmentReportHandler('specialLeave');
