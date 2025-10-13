import Report from '../models/Report.js';

export const SUPERVISOR_REPORT_TEMPLATES = [
  {
    type: 'attendance',
    name: '部門出勤統計',
    exportSettings: { formats: ['excel'], includeLogo: false, footerNote: '' },
    permissionSettings: { supervisorDept: true, hrAllDept: false, employeeDownload: false, historyMonths: 6 },
  },
  {
    type: 'leave',
    name: '部門請假統計',
    exportSettings: { formats: ['excel', 'pdf'], includeLogo: false, footerNote: '' },
    permissionSettings: { supervisorDept: true, hrAllDept: false, employeeDownload: false, historyMonths: 6 },
  },
  {
    type: 'tardiness',
    name: '部門遲到統計',
    exportSettings: { formats: ['excel'], includeLogo: false, footerNote: '' },
    permissionSettings: { supervisorDept: true, hrAllDept: false, employeeDownload: false, historyMonths: 6 },
  },
  {
    type: 'earlyLeave',
    name: '部門早退統計',
    exportSettings: { formats: ['excel'], includeLogo: false, footerNote: '' },
    permissionSettings: { supervisorDept: true, hrAllDept: false, employeeDownload: false, historyMonths: 6 },
  },
  {
    type: 'workHours',
    name: '部門工時統計',
    exportSettings: { formats: ['excel'], includeLogo: false, footerNote: '' },
    permissionSettings: { supervisorDept: true, hrAllDept: false, employeeDownload: false, historyMonths: 6 },
  },
  {
    type: 'overtime',
    name: '部門加班申請統計',
    exportSettings: { formats: ['pdf'], includeLogo: false, footerNote: '' },
    permissionSettings: { supervisorDept: true, hrAllDept: false, employeeDownload: false, historyMonths: 6 },
  },
  {
    type: 'compTime',
    name: '部門補休申請統計',
    exportSettings: { formats: ['pdf'], includeLogo: false, footerNote: '' },
    permissionSettings: { supervisorDept: true, hrAllDept: false, employeeDownload: false, historyMonths: 6 },
  },
  {
    type: 'makeUp',
    name: '部門補打卡申請統計',
    exportSettings: { formats: ['excel'], includeLogo: false, footerNote: '' },
    permissionSettings: { supervisorDept: true, hrAllDept: false, employeeDownload: false, historyMonths: 6 },
  },
  {
    type: 'specialLeave',
    name: '部門特休統計',
    exportSettings: { formats: ['excel'], includeLogo: false, footerNote: '' },
    permissionSettings: { supervisorDept: true, hrAllDept: false, employeeDownload: false, historyMonths: 6 },
  },
];

function buildUpsertPayload(template) {
  const exportSettings = template.exportSettings || {};
  const permissionSettings = template.permissionSettings || {};

  const payload = {
    name: template.name,
    type: template.type,
    fields: template.fields ?? [],
    data: template.data ?? {},
    exportSettings: {
      formats: Array.isArray(exportSettings.formats) ? exportSettings.formats : [],
      includeLogo: Boolean(exportSettings.includeLogo),
      footerNote: exportSettings.footerNote ?? '',
    },
    permissionSettings: {
      supervisorDept: true,
      hrAllDept: Boolean(permissionSettings.hrAllDept),
      employeeDownload: Boolean(permissionSettings.employeeDownload),
      historyMonths: Number.isFinite(permissionSettings.historyMonths)
        ? Math.max(0, Math.floor(permissionSettings.historyMonths))
        : 6,
    },
  };

  if (template.notificationSettings) {
    payload.notificationSettings = template.notificationSettings;
  }

  return payload;
}

export async function ensureDefaultSupervisorReports() {
  const operations = SUPERVISOR_REPORT_TEMPLATES.map((template) =>
    Report.updateOne(
      { type: template.type },
      { $setOnInsert: buildUpsertPayload(template) },
      { upsert: true }
    )
  );

  await Promise.all(operations);
}

export default ensureDefaultSupervisorReports;
