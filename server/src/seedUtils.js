import Employee from './models/Employee.js';
import Organization from './models/Organization.js';
import Department from './models/Department.js';
import SubDepartment from './models/SubDepartment.js';
import FormTemplate from './models/form_template.js';
import FormField from './models/form_field.js';
import ApprovalWorkflow from './models/approval_workflow.js';

export async function seedSampleData() {
  let org = await Organization.findOne({ name: '示範機構' });
  if (!org) {
    org = await Organization.create({
      name: '示範機構',
      systemCode: 'ORG001',
      unitName: '總院',
      orgCode: '001',
      taxIdNumber: '12345678',
      phone: '02-12345678',
      address: '台北市信義路1號',
      principal: '示範負責人'
    });
    console.log('Created sample organization');
  }

  let dept = await Department.findOne({ code: 'HR' });
  if (!dept) {
    dept = await Department.create({
      name: '人力資源部',
      code: 'HR',
      organization: org._id,
      unitName: '人力資源',
      location: '台北',
      phone: '02-23456789',
      manager: 'supervisor'
    });
    console.log('Created sample department');
  }

  const subDeptExists = await SubDepartment.findOne({ code: 'HR1' });
  if (!subDeptExists) {
    await SubDepartment.create({
      department: dept._id,
      code: 'HR1',
      name: '招聘組',
      unitName: '招聘組',
      location: '台北',
      phone: '02-23456789',
      manager: 'supervisor'
    });
    console.log('Created sample sub-department');
  }
}

export async function seedTestUsers() {
  const org = await Organization.findOne({ name: '示範機構' });
  const dept = await Department.findOne({ code: 'HR' });
  const subDept = await SubDepartment.findOne({ code: 'HR1' });

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
