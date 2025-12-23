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
import PayrollRecord from './models/PayrollRecord.js';
import { getLeaveFieldIds, resetLeaveFieldCache } from './services/leaveFieldService.js';
import { calculateNightShiftAllowance } from './services/nightShiftAllowanceService.js';
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

// 薪資相關配置
const SALARY_TYPES = ['月薪', '日薪', '時薪'];
const SALARY_ITEMS_POOL = [
  '本薪',
  '職務加給',
  '績效獎金',
  '交通津貼',
  '伙食津貼',
  '全勤獎金',
  '加班費',
  '專業加給',
  '主管加給',
  '年資加給',
];
const BANK_NAMES = [
  '台灣銀行',
  '土地銀行',
  '合作金庫',
  '第一銀行',
  '華南銀行',
  '彰化銀行',
  '台北富邦',
  '國泰世華',
  '中國信託',
  '玉山銀行',
];

// 主管薪資配置（月薪為主，較高薪資）
const SUPERVISOR_SALARY_CONFIGS = [
  {
    salaryType: '月薪',
    baseRange: [65000, 85000],
    laborPensionSelfRate: [0, 6],
    advanceRate: 0.1,
    itemCount: [4, 6],
  },
  {
    salaryType: '月薪',
    baseRange: [70000, 95000],
    laborPensionSelfRate: [0, 6],
    advanceRate: 0.05,
    itemCount: [5, 7],
  },
  {
    salaryType: '月薪',
    baseRange: [75000, 100000],
    laborPensionSelfRate: [0, 6],
    advanceRate: 0,
    itemCount: [4, 6],
  },
];

// 員工薪資配置（多樣化：月薪、日薪、時薪）
const EMPLOYEE_SALARY_CONFIGS = [
  {
    salaryType: '月薪',
    baseRange: [32000, 45000],
    laborPensionSelfRate: [0, 6],
    advanceRate: 0.15,
    itemCount: [3, 5],
  },
  {
    salaryType: '月薪',
    baseRange: [35000, 50000],
    laborPensionSelfRate: [0, 6],
    advanceRate: 0.1,
    itemCount: [3, 4],
  },
  {
    salaryType: '日薪',
    baseRange: [1500, 2200],
    laborPensionSelfRate: [0, 3],
    advanceRate: 0.2,
    itemCount: [2, 3],
  },
  {
    salaryType: '時薪',
    baseRange: [200, 350],
    laborPensionSelfRate: [0, 3],
    advanceRate: 0.05,
    itemCount: [1, 3],
  },
  {
    salaryType: '月薪',
    baseRange: [28000, 38000],
    laborPensionSelfRate: [0, 6],
    advanceRate: 0,
    itemCount: [2, 4],
  },
  {
    salaryType: '日薪',
    baseRange: [1300, 1800],
    laborPensionSelfRate: [0, 2],
    advanceRate: 0.1,
    itemCount: [2, 3],
  },
];

// 薪資生成概率配置
const SALARY_PROBABILITIES = {
  SELF_CONTRIBUTION_RATE: 0.6, // 60% 員工有勞退自提
  ADVANCE_SALARY_RATE: 0.4,    // 40% 員工有預支薪資
  DUAL_ACCOUNT_RATE: 1.0,      // 100% 員工有雙薪資帳戶 (A帳戶匯本薪, B帳戶匯獎金)
};

function randomInRange(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomSubset(array, minCount, maxCount) {
  const count = randomInRange(minCount, Math.min(maxCount, array.length));
  const shuffled = [...array].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

function generateBankAccount() {
  const bank = randomElement(BANK_NAMES);
  const acct = randomDigits(12);
  return { bank, acct };
}

function generateSalaryData(config, index) {
  const salaryAmount = randomInRange(config.baseRange[0], config.baseRange[1]);
  
  // 計算勞退自提（0% 或隨機1-6%）
  const selfRateMax = config.laborPensionSelfRate[1];
  const selfRate = selfRateMax > 0 && Math.random() < SALARY_PROBABILITIES.SELF_CONTRIBUTION_RATE
    ? randomInRange(config.laborPensionSelfRate[0] || 1, selfRateMax)
    : 0;
  const laborPensionSelf = selfRate > 0 ? Math.floor(salaryAmount * selfRate / 100) : 0;
  
  // 計算預支薪資（部分員工有預支）
  const hasAdvance = Math.random() < SALARY_PROBABILITIES.ADVANCE_SALARY_RATE;
  const employeeAdvance = hasAdvance && config.advanceRate > 0
    ? Math.floor(salaryAmount * config.advanceRate)
    : 0;
  
  // 生成薪資帳戶（主帳戶必有，部分員工有雙帳戶）
  const salaryAccountA = generateBankAccount();
  const hasDualAccount = Math.random() < SALARY_PROBABILITIES.DUAL_ACCOUNT_RATE;
  const salaryAccountB = hasDualAccount ? generateBankAccount() : { bank: '', acct: '' };
  
  // 選擇薪資項目
  const salaryItems = randomSubset(
    SALARY_ITEMS_POOL,
    config.itemCount[0],
    config.itemCount[1]
  );
  
  // 計算勞保等級（根據薪資金額）
  // 簡化版：根據薪資範圍分配等級 1-28
  let laborInsuranceLevel = 1;
  if (config.salaryType === '月薪') {
    if (salaryAmount >= 80000) laborInsuranceLevel = 28;
    else if (salaryAmount >= 70000) laborInsuranceLevel = 26;
    else if (salaryAmount >= 60000) laborInsuranceLevel = 24;
    else if (salaryAmount >= 50000) laborInsuranceLevel = 22;
    else if (salaryAmount >= 40000) laborInsuranceLevel = 18;
    else if (salaryAmount >= 30000) laborInsuranceLevel = 14;
    else laborInsuranceLevel = 10;
  } else if (config.salaryType === '日薪') {
    laborInsuranceLevel = randomInRange(8, 12);
  } else {
    laborInsuranceLevel = randomInRange(5, 10);
  }
  
  // 勞保設定（大部分啟用自動扣費，部分員工啟用加班計算和遲到扣款）
  const autoDeduction = Math.random() < 0.9; // 90%自動扣費
  const autoOvertimeCalc = Math.random() < 0.4; // 40%自動加班計算
  const lateDeductionEnabled = Math.random() < 0.3; // 30%啟用遲到扣款
  const lateDeductionAmount = lateDeductionEnabled ? randomInRange(50, 200) : 0;
  
  return {
    salaryType: config.salaryType,
    salaryAmount,
    laborPensionSelf,
    employeeAdvance,
    salaryAccountA,
    salaryAccountB,
    salaryItems,
    laborInsuranceLevel,
    autoDeduction,
    autoOvertimeCalc,
    lateDeductionEnabled,
    lateDeductionAmount,
  };
}

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
      isNightShift: false,
      hasAllowance: false,
      fixedAllowanceAmount: 0,
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
      isNightShift: false,
      hasAllowance: false,
      fixedAllowanceAmount: 0,
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
      isNightShift: false,
      hasAllowance: false,
      fixedAllowanceAmount: 0,
    },
    {
      name: '夜班',
      code: 'SHIFT-D',
      startTime: '22:00',
      endTime: '06:00',
      breakTime: '01:00',
      breakDuration: 60,
      breakWindows: [
        { start: '02:00', end: '03:00', label: '休息' },
      ],
      crossDay: true,
      remark: '夜間值班，含夜班津貼',
      color: '#ffffff',
      bgColor: '#1e293b',
      isNightShift: true,
      hasAllowance: true,
      fixedAllowanceAmount: 200,
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

const WORKDAYS_PER_EMPLOYEE = 60; // 至少前2個月的考勤資料
const CLOCK_IN_VARIANCE_MINUTES = 15;
const CLOCK_OUT_VARIANCE_MINUTES = 25;
const APPROVAL_STATUSES = ['approved', 'pending', 'rejected', 'returned'];
const LEAVE_REASON_POOL = ['家庭因素', '身體不適', '旅行計畫', '進修課程', '陪同家人就醫'];
const SUPPORT_REASON_POOL = ['部門支援需求', '專案跨部協作', '臨時人力支援'];
const RETAIN_REASON_POOL = ['年度專案需求', '留任關鍵人才', '客戶專案延續'];
const CERTIFICATE_PURPOSE_POOL = ['銀行貸款', '學校申請', '簽證辦理'];
const RESIGNATION_PURPOSE_POOL = ['離職後保險', '移民資料', '外部審查'];
const OVERTIME_REASON_POOL = ['專案緊急趕工', '客戶臨時需求', '系統維護'];
const MAKEUP_REASON_POOL = ['設備故障', '外勤未能刷卡', '臨時出差'];
const BONUS_REASON_POOL = ['季度績效達標', '專案獎金', '推薦獎金'];
const BONUS_TYPE_POOL = ['績效獎金', '專案獎金', '推薦獎金'];
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

function buildEmployeeIdGenerator(existingIds = []) {
  const usedIds = new Set();
  const prefixCounters = new Map();

  existingIds
    .filter(Boolean)
    .forEach((id) => {
      usedIds.add(id);
      const match = `${id}`.match(/^([A-Za-z]+)-(\d+)$/);
      if (!match) return;
      const [, prefix, number] = match;
      const upperPrefix = prefix.toUpperCase();
      const current = prefixCounters.get(upperPrefix) ?? 0;
      prefixCounters.set(upperPrefix, Math.max(current, Number(number)));
    });

  return (prefix = 'EMP') => {
    const upperPrefix = prefix.toUpperCase();
    let counter = prefixCounters.get(upperPrefix) ?? 0;
    let candidate = '';

    do {
      counter += 1;
      candidate = `${upperPrefix}-${String(counter).padStart(4, '0')}`;
    } while (usedIds.has(candidate));

    prefixCounters.set(upperPrefix, counter);
    usedIds.add(candidate);
    return candidate;
  };
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

function formatMonthStart(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
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
  
  // 分離夜班和其他班別
  const nightShift = attendanceSetting.shifts.find(shift => shift.isNightShift);
  const regularShifts = attendanceSetting.shifts.filter(shift => !shift.isNightShift);
  
  const shiftOptions = attendanceSetting.shifts.map((shift) => ({
    shiftId: shift._id,
    data: {
      startTime: shift.startTime,
      endTime: shift.endTime,
      crossDay: Boolean(shift.crossDay),
    },
    isNightShift: shift.isNightShift,
  }));
  
  const nightShiftOption = nightShift ? {
    shiftId: nightShift._id,
    data: {
      startTime: nightShift.startTime,
      endTime: nightShift.endTime,
      crossDay: Boolean(nightShift.crossDay),
    },
    isNightShift: true,
  } : null;
  
  const regularShiftOptions = regularShifts.map((shift) => ({
    shiftId: shift._id,
    data: {
      startTime: shift.startTime,
      endTime: shift.endTime,
      crossDay: Boolean(shift.crossDay),
    },
    isNightShift: false,
  }));

  const schedules = [];
  const records = [];

  supervisors.forEach((supervisor) => {
    const team = employeesBySupervisor.get(toStringId(supervisor._id)) ?? [];
    team.forEach(({ employee, assignment }, employeeIndex) => {
      // 判斷是否為夜班員工（偶數索引的員工）
      const isNightShiftEmployee = employeeIndex % 2 === 0;
      
      workdays.forEach((day) => {
        // 夜班員工主要分配夜班（80%），其他員工不分配夜班
        let shiftOption;
        if (isNightShiftEmployee && nightShiftOption && Math.random() < 0.8) {
          shiftOption = nightShiftOption;
        } else {
          shiftOption = regularShiftOptions.length > 0 
            ? randomElement(regularShiftOptions)
            : randomElement(shiftOptions);
        }
        
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

/**
 * 生成最近2個月的薪資記錄
 * @param {Array} supervisors - 主管列表
 * @param {Array} employees - 員工列表
 * @returns {Array} - 薪資記錄
 */
async function seedPayrollRecords({ supervisors = [], employees = [] } = {}) {
  const allEmployees = [...supervisors, ...employees];
  const payrollRecords = [];

  const currentDate = new Date();
  const months = [];

  // 當月
  const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  months.push(currentMonth);

  // 上個月
  const lastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  months.push(lastMonth);

  const formConfigs = await Promise.all([
    loadFormConfig('請假'),
    loadFormConfig('加班申請'),
    loadFormConfig('補簽申請'),
    loadFormConfig('獎金申請'),
  ]);

  const approvalForms = formConfigs.filter(Boolean);
  const approvalFormIds = approvalForms.map((config) => config.form._id);
  const approvalRequests = approvalFormIds.length
    ? await ApprovalRequest.find({
        applicant_employee: { $in: allEmployees.map((emp) => emp._id) },
        form: { $in: approvalFormIds },
        status: { $in: ['approved', 'rejected'] },
      }).lean()
    : [];

  const approvalMap = new Map();

  const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

  const monthKey = (date) => new Date(date.getFullYear(), date.getMonth(), 1).getTime();

  const getRate = (employee) => {
    const base = employee.salaryAmount || 0;
    if (employee.salaryType === '日薪') {
      return { hourly: base / 8, daily: base };
    }
    if (employee.salaryType === '時薪') {
      return { hourly: base, daily: base * 8 };
    }
    // 月薪
    const daily = base / 22;
    return { hourly: daily / 8, daily };
  };

  const getFieldValue = (formData, fieldMap, label) => {
    const fieldId = fieldMap?.[label];
    return fieldId ? formData[fieldId] : undefined;
  };

  const addAdjustment = (employeeId, date, payload) => {
    if (!employeeId || !isValidDate(date)) return;
    const key = `${employeeId}_${monthKey(date)}`;
    if (!approvalMap.has(key)) approvalMap.set(key, []);
    approvalMap.get(key).push(payload);
  };

  const leaveConfig = approvalForms.find((item) => item.form.name === '請假');
  const overtimeConfig = approvalForms.find((item) => item.form.name === '加班申請');
  const makeupConfig = approvalForms.find((item) => item.form.name === '補簽申請');
  const bonusConfig = approvalForms.find((item) => item.form.name === '獎金申請');

  approvalRequests.forEach((request) => {
    const { applicant_employee: employeeId, status, form_data: formData, form } = request;
    const basePayload = { request: request._id, status, reason: '' };

    if (leaveConfig && toStringId(form) === toStringId(leaveConfig.form._id)) {
      const { fieldMap } = leaveConfig;
      const start = new Date(getFieldValue(formData, fieldMap, '開始日期'));
      const end = new Date(getFieldValue(formData, fieldMap, '結束日期'));
      const leaveType = getFieldValue(formData, fieldMap, '假別');
      const hours = isValidDate(start) && isValidDate(end) ? ((end - start) / (1000 * 60 * 60)) + 24 : 0;
      const amount = status === 'approved' ? hours : 0;
      const refDate = isValidDate(start) ? start : request.createdAt;
      addAdjustment(employeeId, refDate, {
        ...basePayload,
        type: 'leave',
        hours,
        amount,
        reason: leaveType || '未指定假別',
        description: `請假申請(${status}) ${leaveType || ''}`.trim(),
      });
      return;
    }

    if (overtimeConfig && toStringId(form) === toStringId(overtimeConfig.form._id)) {
      const { fieldMap } = overtimeConfig;
      const start = new Date(getFieldValue(formData, fieldMap, '開始時間'));
      const end = new Date(getFieldValue(formData, fieldMap, '結束時間'));
      const reason = getFieldValue(formData, fieldMap, '事由');
      const hours = isValidDate(start) && isValidDate(end) ? (end - start) / (1000 * 60 * 60) : 0;
      const amount = status === 'approved' ? hours : 0;
      const refDate = isValidDate(start) ? start : request.createdAt;
      addAdjustment(employeeId, refDate, {
        ...basePayload,
        type: 'overtime',
        hours,
        amount,
        reason: reason || '未填寫事由',
        description: `加班申請(${status}) ${reason || ''}`.trim(),
      });
      return;
    }

    if (makeupConfig && toStringId(form) === toStringId(makeupConfig.form._id)) {
      const { fieldMap } = makeupConfig;
      const start = new Date(getFieldValue(formData, fieldMap, '開始時間'));
      const end = new Date(getFieldValue(formData, fieldMap, '結束時間'));
      const reason = getFieldValue(formData, fieldMap, '事由');
      const hours = isValidDate(start) && isValidDate(end) ? (end - start) / (1000 * 60 * 60) : 0;
      const amount = status === 'approved' ? hours : 0;
      const refDate = isValidDate(start) ? start : request.createdAt;
      addAdjustment(employeeId, refDate, {
        ...basePayload,
        type: 'makeup',
        hours,
        amount,
        reason: reason || '未填寫事由',
        description: `補簽申請(${status}) ${reason || ''}`.trim(),
      });
      return;
    }

    if (bonusConfig && toStringId(form) === toStringId(bonusConfig.form._id)) {
      const { fieldMap } = bonusConfig;
      const bonus = Number(getFieldValue(formData, fieldMap, '金額')) || 0;
      const bonusType = getFieldValue(formData, fieldMap, '獎金類型');
      addAdjustment(employeeId, request.createdAt, {
        ...basePayload,
        type: 'bonus',
        amount: status === 'approved' ? bonus : 0,
        reason: bonusType || '獎金申請',
        description: `獎金申請(${status}) ${bonusType || ''}`.trim(),
      });
    }
  });

  for (const month of months) {
    for (const employee of allEmployees) {
      // 基本薪資
      const baseSalary = employee.salaryAmount || 0;
      
      // 勞保費 (簡化計算: 約薪資的2%)
      const laborInsuranceFee = Math.round(baseSalary * 0.02);
      
      // 健保費 (簡化計算: 約薪資的1.5%)
      const healthInsuranceFee = Math.round(baseSalary * 0.015);
      
      // 勞退個人提繳
      const laborPensionSelf = employee.laborPensionSelf || 0;
      
      // 員工借支
      const employeeAdvance = employee.employeeAdvance || 0;
      
      // 其他扣款 (每月都有，確保資料多元性)
      const otherDeductions = randomInRange(100, 500);
      
      // 計算實領金額 (Stage A)
      const totalDeductions = laborInsuranceFee + healthInsuranceFee + laborPensionSelf +
        employeeAdvance + otherDeductions;
      const netPay = Math.max(0, baseSalary - totalDeductions);

      // 夜班津貼：依排班配置計算，確保測試資料與夜班設定一致
      let nightShiftAllowance = 0;
      let nightShiftDays = 0;
      let nightShiftHours = 0;
      let nightShiftCalculationMethod = 'not_calculated';
      let nightShiftBreakdown = [];
      let nightShiftConfigurationIssues = [];
      try {
        const monthStr = formatMonthStart(month);
        const nightShiftData = await calculateNightShiftAllowance(
          employee._id.toString(),
          monthStr,
          employee
        );
        nightShiftAllowance = Math.round(nightShiftData?.allowanceAmount ?? 0);
        nightShiftDays = nightShiftData?.nightShiftDays ?? 0;
        nightShiftHours = nightShiftData?.nightShiftHours ?? 0;
        nightShiftCalculationMethod = nightShiftData?.calculationMethod ?? 'not_calculated';
        nightShiftBreakdown = nightShiftData?.shiftBreakdown ?? [];
        nightShiftConfigurationIssues = nightShiftData?.configurationIssues ?? [];
      } catch (err) {
        console.warn(
          `Seed: failed to calculate night shift allowance for ${employee.employeeId}:`,
          err.message
        );
      }

      // 其餘獎金項目保持隨機性以涵蓋多元情境
      const performanceBonus = randomInRange(2000, 8000);
      const otherBonuses = randomInRange(1000, 5000);
      let totalBonus = nightShiftAllowance + performanceBonus + otherBonuses;

      const employeeMonthAdjustments = approvalMap.get(`${employee._id}_${month.getTime()}`) ?? [];
      const { hourly } = getRate(employee);

      const leaveAdjustments = employeeMonthAdjustments.filter((item) => item.type === 'leave');
      const overtimeAdjustments = employeeMonthAdjustments.filter((item) => item.type === 'overtime');
      const makeupAdjustments = employeeMonthAdjustments.filter((item) => item.type === 'makeup');
      const bonusAdjustments = employeeMonthAdjustments.filter((item) => item.type === 'bonus');

      const leaveDeduction = leaveAdjustments.reduce((sum, adj) => sum + adj.amount * hourly, 0);
      const overtimePay = overtimeAdjustments.reduce((sum, adj) => sum + adj.amount * hourly * 1.33, 0);
      const makeupAdjustment = makeupAdjustments.reduce((sum, adj) => sum + adj.amount * hourly, 0);
      const bonusAdjustment = bonusAdjustments.reduce((sum, adj) => sum + adj.amount, 0);

      totalBonus += bonusAdjustment;

      const finalNetPay = Math.max(
        0,
        baseSalary - totalDeductions - leaveDeduction + overtimePay + makeupAdjustment + totalBonus,
      );

      const adjustmentNotes = employeeMonthAdjustments
        .map((adj) => `${adj.description || adj.type}: ${adj.status} 金額:${Math.round(adj.amount * (adj.type === 'bonus' ? 1 : hourly)).toFixed(0)}`)
        .join(' | ');

      // 銀行帳戶資訊 (從員工資料複製)
      const bankAccountA = {
        bank: employee.salaryAccountA?.bank || '',
        accountNumber: employee.salaryAccountA?.acct || '',
        accountName: employee.name
      };
      
      const bankAccountB = {
        bank: employee.salaryAccountB?.bank || '',
        accountNumber: employee.salaryAccountB?.acct || '',
        accountName: employee.name
      };
      
      payrollRecords.push({
        employee: employee._id,
        month,
        baseSalary,
        laborInsuranceFee,
        healthInsuranceFee,
        laborPensionSelf,
        employeeAdvance,
        debtGarnishment: 0,
        otherDeductions,
        leaveDeduction,
        overtimePay,
        makeupAdjustment,
        bonusAdjustment,
        netPay: finalNetPay,
        nightShiftAllowance,
        nightShiftDays,
        nightShiftHours,
        nightShiftCalculationMethod,
        nightShiftBreakdown,
        nightShiftConfigurationIssues,
        performanceBonus,
        otherBonuses,
        totalBonus,
        bankAccountA,
        bankAccountB,
        insuranceLevel: employee.laborInsuranceLevel,
        amount: finalNetPay, // Legacy field for backward compatibility with existing code
        adjustments: employeeMonthAdjustments,
        notes: adjustmentNotes,
      });
    }
  }
  
  // 清除舊的薪資記錄並插入新的
  await PayrollRecord.deleteMany({});
  const createdRecords = payrollRecords.length ? await PayrollRecord.insertMany(payrollRecords) : [];
  
  console.log(`\n=== 薪資記錄生成完成 ===`);
  console.log(`生成 ${months.length} 個月份的薪資記錄`);
  console.log(`每月 ${allEmployees.length} 位員工`);
  console.log(`總計 ${createdRecords.length} 筆薪資記錄\n`);
  
  return createdRecords;
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
  const existingEmployees = await Employee.find({}, 'employeeId').lean();
  const generateEmployeeId = buildEmployeeIdGenerator(
    existingEmployees.map((item) => item?.employeeId),
  );

  const supervisors = [];
  const supervisorAssignments = new Map();
  for (let i = 0; i < SUPERVISOR_CONFIGS.length; i += 1) {
    const config = SUPERVISOR_CONFIGS[i];
    const assignment = takeAssignment(hierarchy, assignmentPool);
    const usernameSeed = generateUniqueValue(config.prefix, usedUsernames).toLowerCase();
    const emailSeed = generateUniqueValue(`${config.prefix}-mail`, usedEmails).toLowerCase();
    const supervisorSignConfig = SEED_SIGN_CONFIG.supervisor;
    
    // 生成主管薪資資料
    const salaryConfig = SUPERVISOR_SALARY_CONFIGS[i % SUPERVISOR_SALARY_CONFIGS.length];
    const salaryData = generateSalaryData(salaryConfig, i);

    const supervisor = await Employee.create({
      name: config.name,
      employeeId: generateEmployeeId('SUP'),
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
      ...salaryData,
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
    
    // 生成員工薪資資料
    const salaryConfig = EMPLOYEE_SALARY_CONFIGS[i % EMPLOYEE_SALARY_CONFIGS.length];
    const salaryData = generateSalaryData(salaryConfig, i);

    // 移除夜班津貼的員工設定（現在由班別設定自動計算）
    const isNightShiftEmployee = i % 2 === 0;
    const monthlySalaryAdjustments = isNightShiftEmployee ? {
      performanceBonus: 0,
      otherBonuses: 0,
      healthInsuranceFee: 0,
      debtGarnishment: 0,
      otherDeductions: 0,
      notes: '夜班員工，夜班津貼由班別設定自動計算',
    } : {
      performanceBonus: 0,
      otherBonuses: 0,
      healthInsuranceFee: 0,
      debtGarnishment: 0,
      otherDeductions: 0,
      notes: '',
    };

    const employee = await Employee.create({
      name: EMPLOYEE_NAMES[i % EMPLOYEE_NAMES.length],
      employeeId: generateEmployeeId('EMP'),
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
      monthlySalaryAdjustments,
      ...salaryData,
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

  // 生成薪資記錄
  const payrollRecords = await seedPayrollRecords({ supervisors, employees });

  // 輸出薪資資料摘要
  console.log('\n=== 薪資資料摘要 ===');
  console.log(`\n主管薪資 (${supervisors.length} 人):`);
  supervisors.forEach((sup) => {
    console.log(
      `  ${sup.name}: ${sup.salaryType} ${sup.salaryAmount}元` +
      (sup.laborPensionSelf > 0 ? `, 勞退自提: ${sup.laborPensionSelf}元` : '') +
      (sup.employeeAdvance > 0 ? `, 預支: ${sup.employeeAdvance}元` : '') +
      `\n    銀行A: ${sup.salaryAccountA?.bank || '未設定'} ${sup.salaryAccountA?.acct || ''}` +
      `\n    銀行B: ${sup.salaryAccountB?.bank || '未設定'} ${sup.salaryAccountB?.acct || ''}`
    );
  });
  
  console.log(`\n員工薪資 (${employees.length} 人):`);
  employees.forEach((emp) => {
    console.log(
      `  ${emp.name}: ${emp.salaryType} ${emp.salaryAmount}元` +
      (emp.laborPensionSelf > 0 ? `, 勞退自提: ${emp.laborPensionSelf}元` : '') +
      (emp.employeeAdvance > 0 ? `, 預支: ${emp.employeeAdvance}元` : '') +
      `\n    銀行A: ${emp.salaryAccountA?.bank || '未設定'} ${emp.salaryAccountA?.acct || ''}` +
      `\n    銀行B: ${emp.salaryAccountB?.bank || '未設定'} ${emp.salaryAccountB?.acct || ''}`
    );
  });
  console.log('\n');

  return { supervisors, employees, attendanceSetting, attendanceRecords, shiftSchedules, payrollRecords };
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
    {
      name: '加班申請',
      category: '人事',
      fields: [
        { label: '開始時間', type_1: 'datetime', required: true, order: 1 },
        { label: '結束時間', type_1: 'datetime', required: true, order: 2 },
        { label: '是否跨日', type_1: 'checkbox', required: true, order: 3 },
        { label: '事由', type_1: 'textarea', order: 4 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '排班負責人' },
        { step_order: 3, approver_type: 'tag', approver_value: '人資' },
      ],
    },
    {
      name: '補簽申請',
      category: '人事',
      fields: [
        { label: '開始時間', type_1: 'datetime', required: true, order: 1 },
        { label: '結束時間', type_1: 'datetime', required: true, order: 2 },
        { label: '是否跨日', type_1: 'checkbox', required: true, order: 3 },
        { label: '事由', type_1: 'textarea', order: 4 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '人資' },
      ],
    },
    {
      name: '獎金申請',
      category: '人事',
      fields: [
        { label: '獎金類型', type_1: 'text', required: true, order: 1 },
        { label: '金額', type_1: 'number', required: true, order: 2 },
        { label: '事由', type_1: 'textarea', order: 3 },
      ],
      steps: [
        { step_order: 1, approver_type: 'manager' },
        { step_order: 2, approver_type: 'tag', approver_value: '財務覆核' },
        { step_order: 3, approver_type: 'tag', approver_value: '人資' },
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

function buildOvertimeFormData(fieldMap, index) {
  const base = addUtcDays(startOfUtcDay(new Date()), -(index + 2));
  const start = addUtcMinutes(base, 18 * 60 + (index % 4) * 10);
  const isCrossDay = index % 2 === 0;
  const end = addUtcMinutes(start, isCrossDay ? 6 * 60 : 3 * 60);
  const data = {};
  if (fieldMap['開始時間']) data[fieldMap['開始時間']] = start;
  if (fieldMap['結束時間']) data[fieldMap['結束時間']] = end;
  if (fieldMap['是否跨日']) data[fieldMap['是否跨日']] = isCrossDay;
  if (fieldMap['事由']) data[fieldMap['事由']] = OVERTIME_REASON_POOL[index % OVERTIME_REASON_POOL.length];
  return { data, rangeStart: start };
}

function buildMakeupFormData(fieldMap, index) {
  const base = addUtcDays(startOfUtcDay(new Date()), -(index + 4));
  const start = addUtcMinutes(base, 7 * 60 + (index % 3) * 15);
  const isCrossDay = index % 3 === 0;
  const end = addUtcMinutes(start, isCrossDay ? 26 * 60 : 2 * 60);
  const data = {};
  if (fieldMap['開始時間']) data[fieldMap['開始時間']] = start;
  if (fieldMap['結束時間']) data[fieldMap['結束時間']] = end;
  if (fieldMap['是否跨日']) data[fieldMap['是否跨日']] = isCrossDay;
  if (fieldMap['事由']) data[fieldMap['事由']] = MAKEUP_REASON_POOL[index % MAKEUP_REASON_POOL.length];
  return { data, rangeStart: start };
}

function buildBonusFormData(fieldMap, index) {
  const base = addUtcDays(startOfUtcDay(new Date()), -(index + 6));
  const start = addUtcMinutes(base, 11 * 60 + (index % 2) * 20);
  const data = {};
  if (fieldMap['獎金類型']) data[fieldMap['獎金類型']] = BONUS_TYPE_POOL[index % BONUS_TYPE_POOL.length];
  if (fieldMap['金額']) data[fieldMap['金額']] = randomInRange(5000, 30000);
  if (fieldMap['事由']) data[fieldMap['事由']] = BONUS_REASON_POOL[index % BONUS_REASON_POOL.length];
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

  const latestLogAt = logs.map((log) => log.at).filter(Boolean).sort((a, b) => a - b).pop();
  const updatedAt = latestLogAt ? addUtcMinutes(latestLogAt, 5) : addUtcMinutes(createdAt, 10);

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
    updatedAt,
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
  const formNames = ['請假', '支援申請', '特休保留', '在職證明', '離職證明', '加班申請', '補簽申請', '獎金申請'];
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

  if (!applicants.length) return { requests: [] };

  const requests = [];
  let baseIndex = 0;

  const builders = [
    {
      name: '請假',
      config: leaveConfig,
      builder: (fieldMap, index) => buildLeaveFormData(fieldMap, leaveFieldInfo, index),
      offsetMinutes: 9 * 60,
    },
    { name: '支援申請', config: configMap.get('支援申請'), builder: buildSupportFormData, offsetMinutes: 10 * 60 },
    { name: '特休保留', config: configMap.get('特休保留'), builder: buildRetentionFormData, offsetMinutes: 8 * 60 },
    { name: '在職證明', config: configMap.get('在職證明'), builder: buildEmploymentCertificateData, offsetMinutes: 11 * 60 },
    { name: '離職證明', config: configMap.get('離職證明'), builder: buildResignationCertificateData, offsetMinutes: 9 * 60 },
    { name: '加班申請', config: configMap.get('加班申請'), builder: buildOvertimeFormData, offsetMinutes: 18 * 60 },
    { name: '補簽申請', config: configMap.get('補簽申請'), builder: buildMakeupFormData, offsetMinutes: 7 * 60 },
    { name: '獎金申請', config: configMap.get('獎金申請'), builder: buildBonusFormData, offsetMinutes: 15 * 60 },
  ];

  builders.forEach((item, builderIdx) => {
    if (!item.config) return;
    APPROVAL_STATUSES.forEach((status, statusIdx) => {
      const applicant = applicants[(builderIdx + statusIdx) % applicants.length];
      const { data, rangeStart } = item.builder(item.config.fieldMap, baseIndex + statusIdx);
      const baseSteps = buildBaseSteps(item.config.workflow, applicant, tagMap);
      requests.push(
        createApprovalPayload({
          applicant,
          form: item.config.form,
          workflow: item.config.workflow,
          formData: data,
          status,
          createdAt: addUtcMinutes(rangeStart, item.offsetMinutes + statusIdx * 10),
          baseSteps,
        }),
      );
    });
    baseIndex += APPROVAL_STATUSES.length;
  });

  // 為每位員工在當月和上月都生成已核准的請假、加班、獎金申請
  // 確保薪資記錄中每月都有這些項目
  const currentDate = new Date();
  const payrollMonths = [
    new Date(currentDate.getFullYear(), currentDate.getMonth(), 1), // 當月
    new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1), // 上個月
  ];

  const allApplicants = [...supervisorList, ...applicants];
  let monthlyRecordCount = 0; // 追蹤實際生成的每月必要記錄數
  
  payrollMonths.forEach((month, monthIdx) => {
    allApplicants.forEach((applicant, empIdx) => {
      // 為每位員工生成請假申請
      if (leaveConfig) {
        const leaveDate = new Date(month);
        leaveDate.setDate(5 + (empIdx % 8)); // 分散在月初不同日期 (5-12日)
        const leaveEnd = new Date(leaveDate);
        leaveEnd.setDate(leaveDate.getDate() + 1); // 請1天假
        
        const leaveData = {};
        const leaveTypes = (leaveFieldInfo?.typeOptions ?? [])
          .map((item) => item?.value)
          .filter((value) => value !== undefined && value !== null);
        const typeList = leaveTypes.length ? leaveTypes : LEAVE_TYPE_FALLBACK;
        const typeValue = typeList[empIdx % typeList.length];
        
        const startFieldId = leaveFieldInfo?.startId ?? leaveConfig.fieldMap['開始日期'];
        const endFieldId = leaveFieldInfo?.endId ?? leaveConfig.fieldMap['結束日期'];
        const typeFieldId = leaveFieldInfo?.typeId ?? leaveConfig.fieldMap['假別'];
        const reasonFieldId = leaveConfig.fieldMap['事由'];
        
        if (typeFieldId) leaveData[typeFieldId] = typeValue;
        if (startFieldId) leaveData[startFieldId] = leaveDate;
        if (endFieldId) leaveData[endFieldId] = leaveEnd;
        if (reasonFieldId) leaveData[reasonFieldId] = LEAVE_REASON_POOL[empIdx % LEAVE_REASON_POOL.length];
        
        const leaveSteps = buildBaseSteps(leaveConfig.workflow, applicant, tagMap);
        requests.push(
          createApprovalPayload({
            applicant,
            form: leaveConfig.form,
            workflow: leaveConfig.workflow,
            formData: leaveData,
            status: 'approved',
            createdAt: addUtcMinutes(leaveDate, -24 * 60), // 提前一天申請
            baseSteps: leaveSteps,
          }),
        );
        monthlyRecordCount++;
      }

      // 為每位員工生成加班申請
      const overtimeConfig = configMap.get('加班申請');
      if (overtimeConfig) {
        const overtimeDate = new Date(month);
        overtimeDate.setDate(10 + (empIdx % 15)); // 分散在月中不同日期 (10-24日)
        overtimeDate.setHours(18, 0, 0, 0); // 18:00開始加班
        const overtimeEnd = new Date(overtimeDate);
        overtimeEnd.setHours(21, 0, 0, 0); // 21:00結束，加班3小時
        
        const overtimeData = {};
        if (overtimeConfig.fieldMap['開始時間']) overtimeData[overtimeConfig.fieldMap['開始時間']] = overtimeDate;
        if (overtimeConfig.fieldMap['結束時間']) overtimeData[overtimeConfig.fieldMap['結束時間']] = overtimeEnd;
        if (overtimeConfig.fieldMap['是否跨日']) overtimeData[overtimeConfig.fieldMap['是否跨日']] = false;
        if (overtimeConfig.fieldMap['事由']) overtimeData[overtimeConfig.fieldMap['事由']] = OVERTIME_REASON_POOL[empIdx % OVERTIME_REASON_POOL.length];
        
        const overtimeSteps = buildBaseSteps(overtimeConfig.workflow, applicant, tagMap);
        requests.push(
          createApprovalPayload({
            applicant,
            form: overtimeConfig.form,
            workflow: overtimeConfig.workflow,
            formData: overtimeData,
            status: 'approved',
            createdAt: addUtcMinutes(overtimeDate, -12 * 60), // 提前半天申請
            baseSteps: overtimeSteps,
          }),
        );
        monthlyRecordCount++;
      }

      // 為每位員工生成獎金申請
      const bonusConfig = configMap.get('獎金申請');
      if (bonusConfig) {
        const bonusDate = new Date(month);
        bonusDate.setDate(20 + (empIdx % 8)); // 分散在月底不同日期 (20-27日)
        
        const bonusData = {};
        if (bonusConfig.fieldMap['獎金類型']) bonusData[bonusConfig.fieldMap['獎金類型']] = BONUS_TYPE_POOL[empIdx % BONUS_TYPE_POOL.length];
        if (bonusConfig.fieldMap['金額']) bonusData[bonusConfig.fieldMap['金額']] = randomInRange(5000, 20000);
        if (bonusConfig.fieldMap['事由']) bonusData[bonusConfig.fieldMap['事由']] = BONUS_REASON_POOL[empIdx % BONUS_REASON_POOL.length];
        
        const bonusSteps = buildBaseSteps(bonusConfig.workflow, applicant, tagMap);
        requests.push(
          createApprovalPayload({
            applicant,
            form: bonusConfig.form,
            workflow: bonusConfig.workflow,
            formData: bonusData,
            status: 'approved',
            createdAt: addUtcMinutes(bonusDate, 10 * 60), // 當天上午申請
            baseSteps: bonusSteps,
          }),
        );
        monthlyRecordCount++;
      }
    });
  });

  await ApprovalRequest.deleteMany({});
  const inserted = requests.length ? await ApprovalRequest.insertMany(requests) : [];

  console.log(`\n=== 審批記錄生成完成 ===`);
  console.log(`總人數: ${allApplicants.length} 人 (主管 ${supervisorList.length} + 員工 ${applicants.length})`);
  console.log(`月份數: ${payrollMonths.length} 個月 (上月 + 當月)`);
  console.log(`每人每月: 請假 1 筆 + 加班 1 筆 + 獎金 1 筆 = 3 筆`);
  console.log(`預期必要記錄: ${allApplicants.length} 人 × ${payrollMonths.length} 月 × 3 類 = ${allApplicants.length * payrollMonths.length * 3} 筆`);
  console.log(`實際必要記錄: ${monthlyRecordCount} 筆`);
  console.log(`其他多樣化記錄: ${requests.length - monthlyRecordCount} 筆`);
  console.log(`總計: ${inserted.length} 筆審批記錄`);
  console.log(`\n✓ 已確保每個人在2個月內都有請假、加班、獎金申請記錄\n`);

  return { requests: inserted };
}
