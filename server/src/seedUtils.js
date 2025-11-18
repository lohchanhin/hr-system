import { randomUUID } from 'crypto';

import Employee from './models/Employee.js';
import Organization from './models/Organization.js';
import Department from './models/Department.js';
import SubDepartment from './models/SubDepartment.js';
import FormTemplate from './models/form_template.js';
import FormField from './models/form_field.js';
import ApprovalWorkflow from './models/approval_workflow.js';
import ApprovalRequest from './models/approval_request.js';
import AttendanceSetting from './models/AttendanceSetting.js';
import AttendanceRecord from './models/AttendanceRecord.js';
import ShiftSchedule from './models/ShiftSchedule.js';
import { getLeaveFieldIds, resetLeaveFieldCache } from './services/leaveFieldService.js';

export const SEED_TEST_PASSWORD = 'password';

const CITY_OPTIONS = ['台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市'];
const SIGN_ROLE_OPTIONS = [
  { value: 'R001', label: '填報' },
  { value: 'R002', label: '覆核' },
  { value: 'R003', label: '審核' },
  { value: 'R004', label: '核定' },
  { value: 'R005', label: '知會' },
  { value: 'R006', label: '財務覆核' },
  { value: 'R007', label: '人資覆核' },
];
const SIGN_LEVEL_OPTIONS = [
  { value: 'U001', label: 'L1' },
  { value: 'U002', label: 'L2' },
  { value: 'U003', label: 'L3' },
  { value: 'U004', label: 'L4' },
  { value: 'U005', label: 'L5' },
];
export const SEED_SIGN_CONFIG = {
  supervisor: {
    signRole: SIGN_ROLE_OPTIONS.find((option) => option.value === 'R003')?.value ?? 'R003',
    signLevel: SIGN_LEVEL_OPTIONS.find((option) => option.value === 'U003')?.value ?? 'U003',
    permissionGrade:
      SIGN_LEVEL_OPTIONS.find((option) => option.value === 'U003')?.label ?? 'L3',
  },
  employee: {
    signRole: SIGN_ROLE_OPTIONS.find((option) => option.value === 'R001')?.value ?? 'R001',
    signLevel: SIGN_LEVEL_OPTIONS.find((option) => option.value === 'U001')?.value ?? 'U001',
    permissionGrade:
      SIGN_LEVEL_OPTIONS.find((option) => option.value === 'U001')?.label ?? 'L1',
  },
  admin: {
    signRole: SIGN_ROLE_OPTIONS.find((option) => option.value === 'R004')?.value ?? 'R004',
    signLevel: SIGN_LEVEL_OPTIONS.find((option) => option.value === 'U005')?.value ?? 'U005',
    permissionGrade:
      SIGN_LEVEL_OPTIONS.find((option) => option.value === 'U005')?.label ?? 'L5',
  },
};
const PRINCIPAL_NAMES = ['林經理', '張主管', '王負責人', '李主任', '陳董事'];
const PHONE_PREFIXES = ['02', '03', '04', '05', '06', '07'];
const EMPLOYEE_TITLES = ['專員', '助理', '資深專員', '專案企劃', '業務代表'];
const EMPLOYEE_STATUSES = ['正職員工', '試用期員工', '留職停薪'];
const EMPLOYEE_NAMES = ['王小明', '李美玲', '陳俊宏', '黃淑芬', '吳建國', '張雅惠'];
const SUPERVISOR_CONFIGS = [
  { name: '人資主管', prefix: 'hr-supervisor', signTags: ['人資'] },
  { name: '支援服務主管', prefix: 'support-supervisor', signTags: ['支援單位主管'] },
  {
    name: '營運部主管',
    prefix: 'operations-supervisor',
    signTags: ['業務主管', '業務負責人', '排班負責人'],
  },
];
const SUPERVISOR_TITLE = '部門主管';

const ATTENDANCE_SETTING_TEMPLATE = {
  shifts: [
    {
      name: '早班',
      code: 'SHIFT-A',
      startTime: '08:30',
      endTime: '17:30',
      breakTime: '01:00',
      breakDuration: 60,
      breakWindows: [
        { start: '12:30', end: '13:30', label: '午休' },
      ],
      crossDay: false,
      remark: '行政支援時段',
      color: '#1e3a8a',
      bgColor: '#dbeafe',
    },
    {
      name: '中班',
      code: 'SHIFT-B',
      startTime: '12:00',
      endTime: '21:00',
      breakTime: '01:00',
      breakDuration: 60,
      breakWindows: [
        { start: '17:00', end: '18:00', label: '晚餐' },
      ],
      crossDay: false,
      remark: '客服及支援時段',
      color: '#065f46',
      bgColor: '#ccfbf1',
    },
    {
      name: '晚班',
      code: 'SHIFT-C',
      startTime: '14:00',
      endTime: '23:00',
      breakTime: '01:00',
      breakDuration: 60,
      breakWindows: [
        { start: '19:00', end: '20:00', label: '晚餐' },
      ],
      crossDay: false,
      remark: '傍晚支援與延長營運',
      color: '#4c1d95',
      bgColor: '#ede9fe',
    },
  ],
  abnormalRules: {
    lateGrace: 10,
    earlyLeaveGrace: 10,
    missingThreshold: 3,
    autoNotify: true,
  },
  breakOutRules: {
    enableBreakPunch: true,
    breakInterval: 30,
    outingNeedApprove: false,
  },
  actionBuffers: {
    clockIn: { earlyMinutes: 60, lateMinutes: 240 },
    clockOut: { earlyMinutes: 240, lateMinutes: 120 },
  },
  overtimeRules: {
    weekdayThreshold: 30,
    holidayRate: 1.33,
    toCompRate: 1.0,
  },
};

const WORKDAYS_PER_EMPLOYEE = 22;
const CLOCK_IN_VARIANCE_MINUTES = 15;
const CLOCK_OUT_VARIANCE_MINUTES = 25;
const APPROVAL_STATUSES = ['approved', 'pending', 'rejected', 'returned'];
const LEAVE_REASON_POOL = ['家庭因素', '身體不適', '旅行計畫', '進修課程', '陪同家人就醫'];
const SUPPORT_REASON_POOL = ['部門支援需求', '專案跨部協作', '臨時人力支援'];
const RETAIN_REASON_POOL = ['年度專案需求', '留任關鍵人才', '客戶專案延續'];
const CERTIFICATE_PURPOSE_POOL = ['銀行貸款', '學校申請', '簽證辦理'];
const RESIGNATION_PURPOSE_POOL = ['離職後保險', '移民資料', '外部審查'];
const LEAVE_TYPE_FALLBACK = ['特休', '事假', '病假'];

function buildAttendanceSettingPayload() {
  return {
    shifts: ATTENDANCE_SETTING_TEMPLATE.shifts.map((shift) => ({ ...shift })),
    abnormalRules: { ...ATTENDANCE_SETTING_TEMPLATE.abnormalRules },
    breakOutRules: { ...ATTENDANCE_SETTING_TEMPLATE.breakOutRules },
    actionBuffers: { ...ATTENDANCE_SETTING_TEMPLATE.actionBuffers },
    overtimeRules: { ...ATTENDANCE_SETTING_TEMPLATE.overtimeRules },
  };
}

function randomElement(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomDigits(length) {
  let digits = '';
  while (digits.length < length) {
    digits += Math.floor(Math.random() * 10).toString();
  }
  return digits.slice(0, length);
}

function randomPhone() {
  const prefix = randomElement(PHONE_PREFIXES);
  return `${prefix}-${randomDigits(8)}`;
}

function toStringId(value) {
  if (value == null) return value;
  return typeof value === 'string' ? value : value.toString();
}

function generateUniqueValue(prefix, usedSet) {
  let value;
  do {
    value = `${prefix}-${randomUUID().split('-')[0].toUpperCase()}`;
  } while (usedSet.has(value));
  usedSet.add(value);
  return value;
}

function buildHierarchy(organizations, departments, subDepartments) {
  const departmentsByOrg = new Map();
  departments.forEach((department) => {
    const orgId = toStringId(department.organization);
    if (!departmentsByOrg.has(orgId)) {
      departmentsByOrg.set(orgId, []);
    }
    departmentsByOrg.get(orgId).push(department);
  });

  const subDepartmentsByDept = new Map();
  subDepartments.forEach((subDept) => {
    const deptId = toStringId(subDept.department);
    if (!subDepartmentsByDept.has(deptId)) {
      subDepartmentsByDept.set(deptId, []);
    }
    subDepartmentsByDept.get(deptId).push(subDept);
  });

  return { organizations, departmentsByOrg, subDepartmentsByDept };
}

function buildAssignmentPool(hierarchy) {
  const combos = [];
  hierarchy.organizations.forEach((organization) => {
    const orgId = toStringId(organization._id);
    const deptList = hierarchy.departmentsByOrg.get(orgId) ?? [];
    deptList.forEach((department) => {
      const deptId = toStringId(department._id);
      const subDeptList = hierarchy.subDepartmentsByDept.get(deptId) ?? [];
      subDeptList.forEach((subDepartment) => {
        combos.push({ organization, department, subDepartment });
      });
    });
  });
  return combos;
}

function randomAssignmentFromHierarchy(hierarchy) {
  const organization = randomElement(hierarchy.organizations);
  const orgId = toStringId(organization._id);
  const departments = hierarchy.departmentsByOrg.get(orgId) ?? [];
  if (departments.length === 0) {
    throw new Error('Department not found');
  }
  const department = randomElement(departments);
  const deptId = toStringId(department?._id);
  const subDepartments = hierarchy.subDepartmentsByDept.get(deptId) ?? [];
  if (subDepartments.length === 0) {
    throw new Error('SubDepartment not found');
  }
  const subDepartment = randomElement(subDepartments);
  return { organization, department, subDepartment };
}

function takeAssignment(hierarchy, pool) {
  if (pool.length === 0) {
    return randomAssignmentFromHierarchy(hierarchy);
  }
  const index = Math.floor(Math.random() * pool.length);
  return pool.splice(index, 1)[0];
}

function snapshotAssignment(assignment) {
  if (!assignment) return null;
  return {
    organization: toStringId(assignment.organization?._id ?? assignment.organization),
    department: assignment.department?._id ?? assignment.department,
    subDepartment: assignment.subDepartment?._id ?? assignment.subDepartment,
  };
}

function startOfUtcDay(date) {
  const utcDate = new Date(date);
  utcDate.setUTCHours(0, 0, 0, 0);
  return utcDate;
}

function generateRecentWorkdays(count, referenceDate = new Date()) {
  const workdays = [];
  let cursor = startOfUtcDay(referenceDate);

  while (workdays.length < count) {
    const candidate = new Date(cursor);
    if (candidate.getUTCDay() !== 0 && candidate.getUTCDay() !== 6) {
      workdays.push(candidate);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return workdays.reverse();
}

function parseTimeString(time) {
  const [hours, minutes] = time.split(':').map((value) => parseInt(value, 10));
  return { hours, minutes };
}

function addUtcMinutes(date, minutes) {
  const result = new Date(date);
  result.setUTCMinutes(result.getUTCMinutes() + minutes);
  return result;
}

function buildShiftTimes(day, shift) {
  const start = startOfUtcDay(day);
  const { hours: startHours, minutes: startMinutes } = parseTimeString(shift.startTime);
  start.setUTCHours(startHours, startMinutes, 0, 0);

  const end = startOfUtcDay(day);
  const { hours: endHours, minutes: endMinutes } = parseTimeString(shift.endTime);
  end.setUTCHours(endHours, endMinutes, 0, 0);

  if (shift.crossDay || end <= start) {
    end.setUTCDate(end.getUTCDate() + 1);
  }

  return { start, end };
}

function randomOffset(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function buildDailyAttendanceRecords(employeeId, day, shift) {
  const { start, end } = buildShiftTimes(day, shift);
  const clockIn = addUtcMinutes(start, randomOffset(-CLOCK_IN_VARIANCE_MINUTES, 5));
  const clockOut = addUtcMinutes(end, randomOffset(-10, CLOCK_OUT_VARIANCE_MINUTES));

  const records = [
    { employee: employeeId, action: 'clockIn', timestamp: clockIn },
    { employee: employeeId, action: 'clockOut', timestamp: clockOut },
  ];

  if (Math.random() < 0.6) {
    const midpoint = new Date((clockIn.getTime() + clockOut.getTime()) / 2);
    const outing = addUtcMinutes(midpoint, randomOffset(-30, 30));
    records.push({ employee: employeeId, action: 'outing', timestamp: outing });

    if (Math.random() < 0.7) {
      const breakIn = addUtcMinutes(outing, Math.max(5, randomOffset(10, 45)));
      if (breakIn < clockOut) {
        records.push({ employee: employeeId, action: 'breakIn', timestamp: breakIn });
      }
    }
  }

  records.sort((a, b) => a.timestamp - b.timestamp);
  return records;
}

async function seedAttendanceData({
  supervisors,
  employeesBySupervisor,
  attendanceSetting,
  hierarchy,
}) {
  const workdays = generateRecentWorkdays(WORKDAYS_PER_EMPLOYEE);
  const assignmentCombos = buildAssignmentPool(hierarchy);
  const shiftOptions = attendanceSetting.shifts.map((shift) => ({
    shiftId: shift._id,
    data: {
      startTime: shift.startTime,
      endTime: shift.endTime,
      crossDay: Boolean(shift.crossDay),
    },
  }));

  const schedules = [];
  const records = [];

  supervisors.forEach((supervisor) => {
    const team = employeesBySupervisor.get(toStringId(supervisor._id)) ?? [];
    team.forEach(({ employee, assignment }) => {
      workdays.forEach((day) => {
        const shiftOption = randomElement(shiftOptions);
        const randomCombo = assignmentCombos.length
          ? randomElement(assignmentCombos)
          : assignment;
        const chosenAssignment =
          assignmentCombos.length && Math.random() < 0.5 ? randomCombo : assignment;

        const departmentId = chosenAssignment.department?._id ?? chosenAssignment.department;
        const subDepartmentId =
          chosenAssignment.subDepartment?._id ?? chosenAssignment.subDepartment;

        schedules.push({
          employee: employee._id,
          date: new Date(day),
          shiftId: shiftOption.shiftId,
          department: departmentId,
          subDepartment: subDepartmentId,
        });

        records.push(
          ...buildDailyAttendanceRecords(employee._id, day, shiftOption.data),
        );
      });
    });
  });

  const createdSchedules = schedules.length ? await ShiftSchedule.insertMany(schedules) : [];
  const createdRecords = records.length ? await AttendanceRecord.insertMany(records) : [];

  return { attendanceRecords: createdRecords, shiftSchedules: createdSchedules };
}

export async function seedSampleData() {
  await Promise.all([
    Organization.deleteMany({}),
    Department.deleteMany({}),
    SubDepartment.deleteMany({}),
  ]);

  const organizations = [];
  const departments = [];
  const subDepartments = [];

  const usedOrgNames = new Set();
  const usedOrgUnitNames = new Set();
  const usedOrgCodes = new Set();
  const usedSystemCodes = new Set();
  const usedDeptNames = new Set();
  const usedDeptUnitNames = new Set();
  const usedDeptCodes = new Set();
  const usedSubDeptNames = new Set();
  const usedSubDeptUnitNames = new Set();
  const usedSubDeptCodes = new Set();

  for (let i = 0; i < 2; i += 1) {
    const organization = await Organization.create({
      name: generateUniqueValue('機構', usedOrgNames),
      systemCode: generateUniqueValue('SYS', usedSystemCodes),
      unitName: generateUniqueValue('單位', usedOrgUnitNames),
      orgCode: generateUniqueValue('ORG', usedOrgCodes),
      taxIdNumber: randomDigits(8),
      phone: randomPhone(),
      address: `${randomElement(CITY_OPTIONS)}${randomDigits(3)}號`,
      principal: randomElement(PRINCIPAL_NAMES),
    });
    organizations.push(organization);

    for (let j = 0; j < 2; j += 1) {
      const department = await Department.create({
        name: generateUniqueValue('部門', usedDeptNames),
        code: generateUniqueValue('DEPT', usedDeptCodes),
        organization: organization._id,
        unitName: generateUniqueValue('部門單位', usedDeptUnitNames),
        location: randomElement(CITY_OPTIONS),
        phone: randomPhone(),
        manager: `主管-${randomDigits(3)}`,
      });
      departments.push(department);

      for (let k = 0; k < 3; k += 1) {
        const subDept = await SubDepartment.create({
          department: department._id,
          code: generateUniqueValue('SUB', usedSubDeptCodes),
          name: generateUniqueValue('小組', usedSubDeptNames),
          unitName: generateUniqueValue('小組單位', usedSubDeptUnitNames),
          location: randomElement(CITY_OPTIONS),
          phone: randomPhone(),
          manager: `組長-${randomDigits(3)}`,
        });
        subDepartments.push(subDept);
      }
    }
  }

  console.log(
    `Created ${organizations.length} organizations, ` +
      `${departments.length} departments, ` +
      `${subDepartments.length} sub-departments`,
  );

  return { organizations, departments, subDepartments };
}

export async function seedTestUsers() {
  const organizations = await Organization.find({});
  if (!organizations.length) throw new Error('Organization not found');

  const departments = await Department.find({});
  if (!departments.length) throw new Error('Department not found');

  const subDepartments = await SubDepartment.find({});
  if (!subDepartments.length) throw new Error('SubDepartment not found');

  const hierarchy = buildHierarchy(organizations, departments, subDepartments);
  const assignmentPool = buildAssignmentPool(hierarchy);
  if (!assignmentPool.length) throw new Error('SubDepartment not found');

  const usedUsernames = new Set();
  const usedEmails = new Set();

  const supervisors = [];
  const supervisorAssignments = new Map();
  for (const config of SUPERVISOR_CONFIGS) {
    const assignment = takeAssignment(hierarchy, assignmentPool);
    const usernameSeed = generateUniqueValue(config.prefix, usedUsernames).toLowerCase();
    const emailSeed = generateUniqueValue(`${config.prefix}-mail`, usedEmails).toLowerCase();
    const supervisorSignConfig = SEED_SIGN_CONFIG.supervisor;
    const supervisor = await Employee.create({
      name: config.name,
      email: `${emailSeed}@example.com`,
      username: usernameSeed,
      password: SEED_TEST_PASSWORD,
      role: 'supervisor',
      signRole: supervisorSignConfig.signRole,
      signLevel: supervisorSignConfig.signLevel,
      permissionGrade: supervisorSignConfig.permissionGrade,
      organization: toStringId(assignment.organization._id),
      department: assignment.department._id,
      subDepartment: assignment.subDepartment._id,
      title: SUPERVISOR_TITLE,
      status: '正職員工',
      signTags: config.signTags,
    });
    supervisors.push(supervisor);

    supervisorAssignments.set(toStringId(supervisor._id), snapshotAssignment(assignment));
  }

  const employees = [];
  const employeesBySupervisor = new Map();
  for (let i = 0; i < 6; i += 1) {
    const usernameSeed = generateUniqueValue('employee', usedUsernames).toLowerCase();
    const emailSeed = generateUniqueValue('employee-mail', usedEmails).toLowerCase();
    const supervisor = supervisors[i % supervisors.length];
    const supervisorKey = toStringId(supervisor._id);
    let assignment = supervisorAssignments.get(supervisorKey);

    if (!assignment) {
      const fallback = snapshotAssignment(takeAssignment(hierarchy, assignmentPool));
      assignment = fallback;
      supervisorAssignments.set(supervisorKey, fallback);
    }

    const employeeSignConfig = SEED_SIGN_CONFIG.employee;
    const employee = await Employee.create({
      name: EMPLOYEE_NAMES[i % EMPLOYEE_NAMES.length],
      email: `${emailSeed}@example.com`,
      username: usernameSeed,
      password: SEED_TEST_PASSWORD,
      role: 'employee',
      signRole: employeeSignConfig.signRole,
      signLevel: employeeSignConfig.signLevel,
      permissionGrade: employeeSignConfig.permissionGrade,
      organization: assignment.organization,
      department: assignment.department,
      subDepartment: assignment.subDepartment,
      supervisor: supervisor._id,
      title: randomElement(EMPLOYEE_TITLES),
      status: randomElement(EMPLOYEE_STATUSES),
      signTags: [],
    });
    employees.push(employee);

    if (!employeesBySupervisor.has(supervisorKey)) {
      employeesBySupervisor.set(supervisorKey, []);
    }
    employeesBySupervisor.get(supervisorKey).push({
      employee,
      assignment: { ...assignment },
    });
  }

  await AttendanceSetting.deleteMany({});
  const attendanceSetting = await AttendanceSetting.create(buildAttendanceSettingPayload());
  await AttendanceRecord.deleteMany({});
  await ShiftSchedule.deleteMany({});

  const { attendanceRecords, shiftSchedules } = await seedAttendanceData({
    supervisors,
    employeesBySupervisor,
    attendanceSetting,
    hierarchy,
  });

  return { supervisors, employees, attendanceSetting, attendanceRecords, shiftSchedules };
}

export async function seedApprovalTemplates() {
  const templates = [
    {
      name: '請假',
      category: '人事',
      fields: [
        { label: '假別', type_1: 'text', required: true, order: 1 },
        { label: '開始日期', type_1: 'date', required: true, order: 2 },
        { label: '結束日期', type_1: 'date', required: true, order: 3 },
        { label: '事由', type_1: 'textarea', order: 4 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      ],
    },
    {
      name: '支援申請',
      category: '人事',
      fields: [
        { label: '申請事由', type_1: 'textarea', required: true, order: 1 },
        { label: '開始日期', type_1: 'date', required: true, order: 2 },
        { label: '結束日期', type_1: 'date', required: true, order: 3 },
        { label: '附件', type_1: 'file', order: 4 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '支援單位主管' },
        { step_order: 3, approver_type: 'tag', approver_value: '人資' },
      ],
    },
    {
      name: '特休保留',
      category: '人事',
      fields: [
        { label: '年度', type_1: 'text', required: true, order: 1 },
        { label: '保留天數', type_1: 'number', required: true, order: 2 },
        { label: '理由', type_1: 'textarea', order: 3 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      ],
    },
    {
      name: '在職證明',
      category: '人事',
      fields: [
        { label: '用途', type_1: 'text', required: true, order: 1 },
        { label: '開立日期', type_1: 'date', required: true, order: 2 },
      ],
      steps: [
        { step_order: 1, approver_type: 'tag', approver_value: '人資' },
      ],
    },
    {
      name: '離職證明',
      category: '人事',
      fields: [
        { label: '用途', type_1: 'text', order: 1 },
        { label: '離職日期', type_1: 'date', required: true, order: 2 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      ],
    },
  ];

  const templateDetails = {};

  for (const t of templates) {
    let form = await FormTemplate.findOne({ name: t.name });
    if (!form) {
      form = await FormTemplate.create({ name: t.name, category: t.category, description: t.description });
      console.log(`Created form template ${t.name}`);
    }

    for (const field of t.fields) {
      const exists = await FormField.findOne({ form: form._id, label: field.label });
      if (!exists) {
        await FormField.create({ ...field, form: form._id });
      }
    }

    let workflow = await ApprovalWorkflow.findOne({ form: form._id });
    if (!workflow) {
      workflow = await ApprovalWorkflow.create({ form: form._id, steps: t.steps });
    } else if (!workflow.steps?.length && t.steps?.length) {
      workflow.steps = t.steps;
      await workflow.save();
    }

    const fields = await FormField.find({ form: form._id }).sort({ order: 1 }).lean();
    templateDetails[t.name] = {
      form,
      workflow,
      fields,
    };
  }

  resetLeaveFieldCache();
  const leaveFieldInfo = await getLeaveFieldIds();

  return { templates: templateDetails, leaveFieldInfo };
}

function buildFieldMap(fields) {
  return fields.reduce((acc, field) => {
    acc[field.label] = field._id?.toString();
    return acc;
  }, {});
}

function buildTagMap(employees) {
  const tagMap = new Map();
  employees.forEach((emp) => {
    const tags = emp?.signTags ?? [];
    tags.forEach((tag) => {
      if (!tag) return;
      const key = String(tag);
      if (!tagMap.has(key)) {
        tagMap.set(key, []);
      }
      const list = tagMap.get(key);
      const idStr = toStringId(emp._id);
      if (!list.some((value) => toStringId(value) === idStr)) {
        list.push(emp._id);
      }
    });
  });
  return tagMap;
}

async function ensureTagAssignments(tagMap, requiredTags, supervisors) {
  for (const tag of requiredTags) {
    const current = tagMap.get(tag);
    if (current && current.length) continue;
    const fallback = supervisors.find((item) => item);
    if (!fallback) {
      tagMap.set(tag, []);
      continue;
    }
    await Employee.updateOne({ _id: fallback._id }, { $addToSet: { signTags: tag } });
    const updatedTags = new Set([...(fallback.signTags ?? []), tag]);
    fallback.signTags = Array.from(updatedTags);
    tagMap.set(tag, [fallback._id]);
  }
  return tagMap;
}

function resolveApproverIds(step, applicant, tagMap) {
  const type = step?.approver_type;
  if (type === 'manager') {
    return applicant?.supervisor ? [applicant.supervisor] : [];
  }
  if (type === 'tag') {
    const tagName = String(step?.approver_value ?? '');
    if (!tagName) return [];
    return [...(tagMap.get(tagName) ?? [])];
  }
  if (type === 'user') {
    const value = step?.approver_value;
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  }
  return [];
}

function buildBaseSteps(workflow, applicant, tagMap) {
  const steps = workflow?.steps ?? [];
  return steps
    .slice()
    .sort((a, b) => (a.step_order ?? 0) - (b.step_order ?? 0))
    .map((step) => {
      const approverIds = resolveApproverIds(step, applicant, tagMap);
      return {
        step_order: step.step_order,
        approvers: approverIds.map((id) => ({ approver: id, decision: 'pending' })),
        all_must_approve: step.all_must_approve !== false,
        is_required: step.is_required !== false,
        can_return: step.can_return !== false,
        started_at: undefined,
        finished_at: undefined,
      };
    });
}

function addUtcDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function buildDateRange(index) {
  const base = startOfUtcDay(new Date());
  const start = addUtcDays(base, -((index % 5) * 3 + index + 1));
  const end = addUtcDays(start, (index % 3) + 1);
  return { start, end };
}

function applyStatusToSteps(baseSteps, status, baseDate) {
  const steps = baseSteps.map((step) => ({
    ...step,
    approvers: step.approvers.map((approver) => ({ ...approver })),
    started_at: undefined,
    finished_at: undefined,
  }));

  const logs = [];
  if (!steps.length) {
    return { steps, logs, currentStepIndex: 0, status };
  }

  const approvedMessage = (step) => `第 ${step.step_order} 關核准`;
  const moveNextMessage = (order) => `進入第 ${order} 關`;

  if (status === 'approved') {
    steps.forEach((step, idx) => {
      const start = addUtcMinutes(baseDate, idx * 90 + 30);
      const finish = addUtcMinutes(start, 60);
      step.started_at = start;
      step.finished_at = finish;
      step.approvers = step.approvers.map((approver) => ({
        ...approver,
        decision: 'approved',
        comment: '同意',
        decided_at: finish,
      }));
      step.approvers.forEach((approver) => {
        logs.push({ at: finish, action: 'approve', by_employee: approver.approver, message: approvedMessage(step) });
      });
      if (idx + 1 < steps.length) {
        logs.push({ at: finish, action: 'move_next', message: moveNextMessage(idx + 2) });
      }
    });
    logs.push({ at: addUtcMinutes(baseDate, steps.length * 120 + 30), action: 'finish', message: '全部完成' });
    return { steps, logs, currentStepIndex: Math.max(steps.length - 1, 0), status: 'approved' };
  }

  if (status === 'pending') {
    const currentIdx = steps.length > 1 ? 1 : 0;
    steps.forEach((step, idx) => {
      if (idx < currentIdx) {
        const start = addUtcMinutes(baseDate, idx * 80 + 20);
        const finish = addUtcMinutes(start, 50);
        step.started_at = start;
        step.finished_at = finish;
        step.approvers = step.approvers.map((approver) => ({
          ...approver,
          decision: 'approved',
          comment: '同意',
          decided_at: finish,
        }));
        step.approvers.forEach((approver) => {
          logs.push({ at: finish, action: 'approve', by_employee: approver.approver, message: approvedMessage(step) });
        });
        if (idx + 1 < steps.length) {
          logs.push({ at: finish, action: 'move_next', message: moveNextMessage(idx + 2) });
        }
      } else if (idx === currentIdx) {
        step.started_at = addUtcMinutes(baseDate, idx * 80 + 20);
        step.approvers = step.approvers.map((approver) => ({ ...approver, decision: 'pending' }));
      }
    });
    return { steps, logs, currentStepIndex: currentIdx, status: 'pending' };
  }

  if (status === 'rejected') {
    const targetIdx = steps.length > 1 ? 1 : 0;
    steps.forEach((step, idx) => {
      const start = addUtcMinutes(baseDate, idx * 70 + 15);
      step.started_at = start;
      if (idx < targetIdx) {
        const finish = addUtcMinutes(start, 40);
        step.finished_at = finish;
        step.approvers = step.approvers.map((approver) => ({
          ...approver,
          decision: 'approved',
          comment: '同意',
          decided_at: finish,
        }));
        step.approvers.forEach((approver) => {
          logs.push({ at: finish, action: 'approve', by_employee: approver.approver, message: approvedMessage(step) });
        });
        if (idx + 1 < steps.length) {
          logs.push({ at: finish, action: 'move_next', message: moveNextMessage(idx + 2) });
        }
      } else if (idx === targetIdx) {
        const finish = addUtcMinutes(start, 30);
        step.finished_at = finish;
        if (step.approvers.length) {
          const [first, ...rest] = step.approvers;
          step.approvers = [
            { ...first, decision: 'rejected', comment: '不同意', decided_at: finish },
            ...rest.map((approver) => ({ ...approver, decision: 'pending' })),
          ];
          logs.push({ at: finish, action: 'reject', by_employee: first.approver, message: '不同意' });
        }
      }
    });
    return { steps, logs, currentStepIndex: targetIdx, status: 'rejected' };
  }

  if (status === 'returned') {
    const step = steps[0];
    if (step) {
      const start = addUtcMinutes(baseDate, 30);
      const finish = addUtcMinutes(start, 25);
      step.started_at = start;
      step.finished_at = finish;
      if (step.approvers.length) {
        const [first, ...rest] = step.approvers;
        step.approvers = [
          { ...first, decision: 'returned', comment: '補件', decided_at: finish },
          ...rest.map((approver) => ({ ...approver, decision: 'pending' })),
        ];
        logs.push({ at: finish, action: 'return', by_employee: first.approver, message: '退回申請者' });
      }
    }
    return { steps, logs, currentStepIndex: 0, status: 'returned' };
  }

  return { steps, logs, currentStepIndex: 0, status };
}

function buildLeaveFormData(fieldMap, leaveFieldInfo, index) {
  const { start, end } = buildDateRange(index);
  const data = {};
  const leaveTypes = (leaveFieldInfo?.typeOptions ?? [])
    .map((item) => item?.value)
    .filter((value) => value !== undefined && value !== null);
  const typeList = leaveTypes.length ? leaveTypes : LEAVE_TYPE_FALLBACK;
  const typeValue = typeList[index % typeList.length];
  const startFieldId = leaveFieldInfo?.startId ?? fieldMap['開始日期'];
  const endFieldId = leaveFieldInfo?.endId ?? fieldMap['結束日期'];
  const typeFieldId = leaveFieldInfo?.typeId ?? fieldMap['假別'];
  const reasonFieldId = fieldMap['事由'];

  if (typeFieldId) data[typeFieldId] = typeValue;
  if (startFieldId) data[startFieldId] = start;
  if (endFieldId) data[endFieldId] = end;
  if (reasonFieldId) data[reasonFieldId] = LEAVE_REASON_POOL[index % LEAVE_REASON_POOL.length];

  return { data, rangeStart: start };
}

function buildSupportFormData(fieldMap, index) {
  const { start, end } = buildDateRange(index + 3);
  const data = {};
  if (fieldMap['開始日期']) data[fieldMap['開始日期']] = start;
  if (fieldMap['結束日期']) data[fieldMap['結束日期']] = end;
  if (fieldMap['申請事由']) data[fieldMap['申請事由']] = SUPPORT_REASON_POOL[index % SUPPORT_REASON_POOL.length];
  if (fieldMap['附件']) data[fieldMap['附件']] = [`support-${index + 1}.pdf`];
  return { data, rangeStart: start };
}

function buildRetentionFormData(fieldMap, index) {
  const { start } = buildDateRange(index + 5);
  const data = {};
  if (fieldMap['年度']) data[fieldMap['年度']] = String(start.getUTCFullYear());
  if (fieldMap['保留天數']) data[fieldMap['保留天數']] = (index % 5) + 1;
  if (fieldMap['理由']) data[fieldMap['理由']] = RETAIN_REASON_POOL[index % RETAIN_REASON_POOL.length];
  return { data, rangeStart: start };
}

function buildEmploymentCertificateData(fieldMap, index) {
  const { start } = buildDateRange(index + 7);
  const data = {};
  if (fieldMap['用途']) data[fieldMap['用途']] = CERTIFICATE_PURPOSE_POOL[index % CERTIFICATE_PURPOSE_POOL.length];
  if (fieldMap['開立日期']) data[fieldMap['開立日期']] = start;
  return { data, rangeStart: start };
}

function buildResignationCertificateData(fieldMap, index) {
  const { start } = buildDateRange(index + 9);
  const data = {};
  if (fieldMap['用途']) data[fieldMap['用途']] = RESIGNATION_PURPOSE_POOL[index % RESIGNATION_PURPOSE_POOL.length];
  if (fieldMap['離職日期']) data[fieldMap['離職日期']] = start;
  return { data, rangeStart: start };
}

function createApprovalPayload({
  applicant,
  form,
  workflow,
  formData,
  status,
  createdAt,
  baseSteps,
}) {
  const { steps, logs: statusLogs, currentStepIndex, status: finalStatus } = applyStatusToSteps(baseSteps, status, createdAt);
  const logs = [
    {
      at: createdAt,
      by_employee: applicant?._id,
      action: 'create',
      message: `建立【${form.name}】申請`,
    },
    ...statusLogs,
  ];

  return {
    form: form._id,
    workflow: workflow._id,
    form_data: formData,
    applicant_employee: applicant?._id,
    applicant_org: applicant?.organization,
    applicant_department: applicant?.department,
    status: finalStatus,
    current_step_index: Math.min(currentStepIndex, Math.max(steps.length - 1, 0)),
    steps,
    logs,
    createdAt,
    updatedAt: addUtcMinutes(createdAt, 10),
  };
}

async function loadFormConfig(name) {
  const form = await FormTemplate.findOne({ name });
  if (!form) return null;
  const workflow = await ApprovalWorkflow.findOne({ form: form._id });
  if (!workflow || !workflow.steps?.length) return null;
  const fields = await FormField.find({ form: form._id }).sort({ order: 1 }).lean();
  return { form, workflow, fields, fieldMap: buildFieldMap(fields) };
}

export async function seedApprovalRequests({ supervisors = [], employees = [] } = {}) {
  const formNames = ['請假', '支援申請', '特休保留', '在職證明', '離職證明'];
  const formConfigs = await Promise.all(formNames.map((name) => loadFormConfig(name)));
  const configMap = new Map();
  formConfigs.forEach((config, index) => {
    if (config) configMap.set(formNames[index], config);
  });

  const leaveConfig = configMap.get('請假');
  if (!leaveConfig) {
    throw new Error('請假表單尚未建立或流程未設定');
  }

  const leaveFieldInfo = await getLeaveFieldIds();

  const requiredTags = new Set();
  configMap.forEach((config) => {
    config.workflow.steps.forEach((step) => {
      if (step.approver_type === 'tag' && step.approver_value) {
        requiredTags.add(String(step.approver_value));
      }
    });
  });

  let applicants = employees;
  if (!applicants.length) {
    applicants = await Employee.find({ role: 'employee' });
  }

  let supervisorList = supervisors;
  if (!supervisorList.length) {
    supervisorList = await Employee.find({ role: 'supervisor' });
  }

  const allEmployees = [...new Map([...supervisorList, ...applicants].map((emp) => [toStringId(emp._id), emp])).values()];
  let tagMap = buildTagMap(allEmployees);
  tagMap = await ensureTagAssignments(tagMap, [...requiredTags], supervisorList);

  const leaveStatuses = APPROVAL_STATUSES;
  let requestIndex = 0;
  const requests = [];

  applicants.forEach((applicant, applicantIdx) => {
    const leaveStatus = leaveStatuses[requestIndex % leaveStatuses.length];
    const { data: leaveData, rangeStart: leaveStart } = buildLeaveFormData(
      leaveConfig.fieldMap,
      leaveFieldInfo,
      requestIndex,
    );
    const leaveSteps = buildBaseSteps(leaveConfig.workflow, applicant, tagMap);
    requests.push(
      createApprovalPayload({
        applicant,
        form: leaveConfig.form,
        workflow: leaveConfig.workflow,
        formData: leaveData,
        status: leaveStatus,
        createdAt: addUtcMinutes(leaveStart, 9 * 60),
        baseSteps: leaveSteps,
      }),
    );
    requestIndex += 1;

    const secondStatus = leaveStatuses[requestIndex % leaveStatuses.length];
    const { data: leaveDataSecond, rangeStart: leaveStartSecond } = buildLeaveFormData(
      leaveConfig.fieldMap,
      leaveFieldInfo,
      requestIndex,
    );
    const leaveStepsSecond = buildBaseSteps(leaveConfig.workflow, applicant, tagMap);
    requests.push(
      createApprovalPayload({
        applicant,
        form: leaveConfig.form,
        workflow: leaveConfig.workflow,
        formData: leaveDataSecond,
        status: secondStatus,
        createdAt: addUtcMinutes(leaveStartSecond, 9 * 60 + 30),
        baseSteps: leaveStepsSecond,
      }),
    );
    requestIndex += 1;

    const otherForms = ['支援申請', '特休保留', '在職證明', '離職證明'];
    const formName = otherForms[applicantIdx % otherForms.length];
    const config = configMap.get(formName);
    if (!config) return;

    let payloadBuilder;
    if (formName === '支援申請') payloadBuilder = buildSupportFormData;
    else if (formName === '特休保留') payloadBuilder = buildRetentionFormData;
    else if (formName === '在職證明') payloadBuilder = buildEmploymentCertificateData;
    else if (formName === '離職證明') payloadBuilder = buildResignationCertificateData;
    else payloadBuilder = buildSupportFormData;

    const { data: otherData, rangeStart: otherStart } = payloadBuilder(config.fieldMap, applicantIdx);
    const otherStatus = leaveStatuses[requestIndex % leaveStatuses.length];
    const otherSteps = buildBaseSteps(config.workflow, applicant, tagMap);
    requests.push(
      createApprovalPayload({
        applicant,
        form: config.form,
        workflow: config.workflow,
        formData: otherData,
        status: otherStatus,
        createdAt: addUtcMinutes(otherStart, 10 * 60),
        baseSteps: otherSteps,
      }),
    );
    requestIndex += 1;
  });

  await ApprovalRequest.deleteMany({});
  const inserted = requests.length ? await ApprovalRequest.insertMany(requests) : [];

  return { requests: inserted };
}
