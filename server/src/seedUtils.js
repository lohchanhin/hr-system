import { randomUUID } from 'crypto';

import Employee from './models/Employee.js';
import Organization from './models/Organization.js';
import Department from './models/Department.js';
import SubDepartment from './models/SubDepartment.js';
import FormTemplate from './models/form_template.js';
import FormField from './models/form_field.js';
import ApprovalWorkflow from './models/approval_workflow.js';

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
  }

  return { supervisors, employees };
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
