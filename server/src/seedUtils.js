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

function generateUniqueValue(prefix, usedSet) {
  let value;
  do {
    value = `${prefix}-${randomUUID().split('-')[0].toUpperCase()}`;
  } while (usedSet.has(value));
  usedSet.add(value);
  return value;
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
  const org = await Organization.findOne({});
  const dept = org ? await Department.findOne({ organization: org._id }) : null;
  const subDept = dept ? await SubDepartment.findOne({ department: dept._id }) : null;

  if (!org) throw new Error('Organization not found');
  if (!dept) throw new Error('Department not found');
  if (!subDept) throw new Error('SubDepartment not found');

  const users = [
    { username: 'user', password: 'password', role: 'employee' },
    { username: 'supervisor', password: 'password', role: 'supervisor' },
    { username: 'admin', password: 'password', role: 'admin' },
    { username: 'scheduler', password: 'password', role: 'supervisor', signTags: ['排班負責人'] },
    { username: 'supportHead', password: 'password', role: 'supervisor', signTags: ['支援單位主管'] },
    { username: 'salesHead', password: 'password', role: 'supervisor', signTags: ['業務主管'] },
    { username: 'salesManager', password: 'password', role: 'supervisor', signTags: ['業務負責人'] },
    { username: 'hr', password: 'password', role: 'admin', signTags: ['人資'] }
  ];
  let supervisorId = null;
  for (const data of users) {
    const existing = await Employee.findOne({ username: data.username });
    if (!existing) {
      const employee = await Employee.create({
        name: data.username,
        email: `${data.username}@example.com`,
        username: data.username,
        password: data.password,
        role: data.role,
        organization: org._id.toString(),
        department: dept._id,
        subDepartment: subDept._id,
        title: 'Staff',
        status: '正職員工',
        signTags: data.signTags ?? []
      });
      if (data.username === 'supervisor') supervisorId = employee._id;
      console.log(`Created test user ${data.username}`);
    }
  }
  if (supervisorId) {
    await Employee.updateMany({ role: 'employee' }, { supervisor: supervisorId });
  }
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
