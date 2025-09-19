import { randomUUID } from 'crypto';

import Employee from './models/Employee.js';
import Organization from './models/Organization.js';
import Department from './models/Department.js';
import SubDepartment from './models/SubDepartment.js';
import FormTemplate from './models/form_template.js';
import FormField from './models/form_field.js';
import ApprovalWorkflow from './models/approval_workflow.js';
import AttendanceSetting from './models/AttendanceSetting.js';
import AttendanceRecord from './models/AttendanceRecord.js';
import ShiftSchedule from './models/ShiftSchedule.js';

const CITY_OPTIONS = ['台北市', '新北市', '桃園市', '台中市', '台南市', '高雄市'];
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
      crossDay: false,
      remark: '行政支援時段',
    },
    {
      name: '中班',
      code: 'SHIFT-B',
      startTime: '12:00',
      endTime: '21:00',
      breakTime: '01:00',
      crossDay: false,
      remark: '客服及支援時段',
    },
    {
      name: '晚班',
      code: 'SHIFT-C',
      startTime: '14:00',
      endTime: '23:00',
      breakTime: '01:00',
      crossDay: false,
      remark: '傍晚支援與延長營運',
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
  overtimeRules: {
    weekdayThreshold: 30,
    holidayRate: 1.33,
    toCompRate: 1.0,
  },
};

const WORKDAYS_PER_EMPLOYEE = 22;
const CLOCK_IN_VARIANCE_MINUTES = 15;
const CLOCK_OUT_VARIANCE_MINUTES = 25;

function buildAttendanceSettingPayload() {
  return {
    shifts: ATTENDANCE_SETTING_TEMPLATE.shifts.map((shift) => ({ ...shift })),
    abnormalRules: { ...ATTENDANCE_SETTING_TEMPLATE.abnormalRules },
    breakOutRules: { ...ATTENDANCE_SETTING_TEMPLATE.breakOutRules },
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
  for (const config of SUPERVISOR_CONFIGS) {
    const assignment = takeAssignment(hierarchy, assignmentPool);
    const usernameSeed = generateUniqueValue(config.prefix, usedUsernames).toLowerCase();
    const emailSeed = generateUniqueValue(`${config.prefix}-mail`, usedEmails).toLowerCase();
    const supervisor = await Employee.create({
      name: config.name,
      email: `${emailSeed}@example.com`,
      username: usernameSeed,
      password: 'password',
      role: 'supervisor',
      organization: toStringId(assignment.organization._id),
      department: assignment.department._id,
      subDepartment: assignment.subDepartment._id,
      title: SUPERVISOR_TITLE,
      status: '正職員工',
      signTags: config.signTags,
    });
    supervisors.push(supervisor);
  }

  const employees = [];
  const employeesBySupervisor = new Map();
  for (let i = 0; i < 6; i += 1) {
    const assignment = takeAssignment(hierarchy, assignmentPool);
    const usernameSeed = generateUniqueValue('employee', usedUsernames).toLowerCase();
    const emailSeed = generateUniqueValue('employee-mail', usedEmails).toLowerCase();
    const supervisor = supervisors[i % supervisors.length];
    const employee = await Employee.create({
      name: EMPLOYEE_NAMES[i % EMPLOYEE_NAMES.length],
      email: `${emailSeed}@example.com`,
      username: usernameSeed,
      password: 'password',
      role: 'employee',
      organization: toStringId(assignment.organization._id),
      department: assignment.department._id,
      subDepartment: assignment.subDepartment._id,
      supervisor: supervisor._id,
      title: randomElement(EMPLOYEE_TITLES),
      status: randomElement(EMPLOYEE_STATUSES),
      signTags: [],
    });
    employees.push(employee);

    const supervisorKey = toStringId(supervisor._id);
    if (!employeesBySupervisor.has(supervisorKey)) {
      employeesBySupervisor.set(supervisorKey, []);
    }
    employeesBySupervisor.get(supervisorKey).push({
      employee,
      assignment: {
        department: assignment.department,
        subDepartment: assignment.subDepartment,
      },
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
      await ApprovalWorkflow.create({ form: form._id, steps: t.steps });
    }
  }
}
