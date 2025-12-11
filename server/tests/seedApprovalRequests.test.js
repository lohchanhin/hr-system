import { jest } from '@jest/globals';

const mockFormFindOne = jest.fn();
const mockFieldFind = jest.fn();
const mockWorkflowFindOne = jest.fn();
const mockApprovalDeleteMany = jest.fn();
const mockApprovalInsertMany = jest.fn();
const mockEmployeeUpdateOne = jest.fn();
const mockGetLeaveFieldIds = jest.fn();

let seedApprovalRequests;

const formDocs = {
  請假: { _id: 'form-leave', name: '請假' },
  支援申請: { _id: 'form-support', name: '支援申請' },
  特休保留: { _id: 'form-retain', name: '特休保留' },
  在職證明: { _id: 'form-employ', name: '在職證明' },
  離職證明: { _id: 'form-resign', name: '離職證明' },
  加班申請: { _id: 'form-ot', name: '加班申請' },
  補簽申請: { _id: 'form-makeup', name: '補簽申請' },
  獎金申請: { _id: 'form-bonus', name: '獎金申請' },
};

const fieldDocs = {
  'form-leave': [
    { _id: 'leave-type', label: '假別', options: [{ value: '特休' }, { value: '事假' }] },
    { _id: 'leave-start', label: '開始日期' },
    { _id: 'leave-end', label: '結束日期' },
    { _id: 'leave-reason', label: '事由' },
  ],
  'form-support': [
    { _id: 'support-reason', label: '申請事由' },
    { _id: 'support-start', label: '開始日期' },
    { _id: 'support-end', label: '結束日期' },
    { _id: 'support-file', label: '附件' },
  ],
  'form-retain': [
    { _id: 'retain-year', label: '年度' },
    { _id: 'retain-days', label: '保留天數' },
    { _id: 'retain-reason', label: '理由' },
  ],
  'form-employ': [
    { _id: 'employ-purpose', label: '用途' },
    { _id: 'employ-date', label: '開立日期' },
  ],
  'form-resign': [
    { _id: 'resign-purpose', label: '用途' },
    { _id: 'resign-date', label: '離職日期' },
  ],
  'form-ot': [
    { _id: 'ot-start', label: '開始時間' },
    { _id: 'ot-end', label: '結束時間' },
    { _id: 'ot-cross', label: '是否跨日' },
    { _id: 'ot-reason', label: '事由' },
  ],
  'form-makeup': [
    { _id: 'makeup-start', label: '開始時間' },
    { _id: 'makeup-end', label: '結束時間' },
    { _id: 'makeup-cross', label: '是否跨日' },
    { _id: 'makeup-reason', label: '事由' },
  ],
  'form-bonus': [
    { _id: 'bonus-type', label: '獎金類型' },
    { _id: 'bonus-amount', label: '金額' },
    { _id: 'bonus-reason', label: '事由' },
  ],
};

const workflowDocs = {
  'form-leave': {
    _id: 'wf-leave',
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  'form-support': {
    _id: 'wf-support',
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '支援單位主管' },
      { step_order: 3, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  'form-retain': {
    _id: 'wf-retain',
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  'form-employ': {
    _id: 'wf-employ',
    steps: [{ step_order: 1, approver_type: 'tag', approver_value: '人資' }],
  },
  'form-resign': {
    _id: 'wf-resign',
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  'form-ot': {
    _id: 'wf-ot',
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '排班負責人' },
      { step_order: 3, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  'form-makeup': {
    _id: 'wf-makeup',
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '人資' },
    ],
  },
  'form-bonus': {
    _id: 'wf-bonus',
    steps: [
      { step_order: 1, approver_type: 'manager' },
      { step_order: 2, approver_type: 'tag', approver_value: '財務覆核' },
      { step_order: 3, approver_type: 'tag', approver_value: '人資' },
    ],
  },
};

beforeAll(async () => {
  process.env.PORT = '3000';
  process.env.MONGODB_URI = 'mongodb://localhost/test';
  process.env.JWT_SECRET = 'secret';
  process.env.NODE_ENV = 'test';

  await jest.unstable_mockModule('../src/models/form_template.js', () => ({
    default: { findOne: mockFormFindOne },
  }));
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({
    default: { find: mockFieldFind },
  }));
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({
    default: { findOne: mockWorkflowFindOne },
  }));
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({
    default: { deleteMany: mockApprovalDeleteMany, insertMany: mockApprovalInsertMany },
  }));
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({
    default: {
      updateOne: mockEmployeeUpdateOne,
      find: jest.fn().mockResolvedValue([]),
    },
  }));
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
    getLeaveFieldIds: mockGetLeaveFieldIds,
    resetLeaveFieldCache: jest.fn(),
  }));

  const mod = await import('../src/seedUtils.js');
  seedApprovalRequests = mod.seedApprovalRequests;
});

beforeEach(() => {
  mockFormFindOne.mockReset();
  mockFieldFind.mockReset();
  mockWorkflowFindOne.mockReset();
  mockApprovalDeleteMany.mockReset();
  mockApprovalInsertMany.mockReset();
  mockEmployeeUpdateOne.mockReset();
  mockGetLeaveFieldIds.mockReset();

  mockFormFindOne.mockImplementation(async ({ name }) => formDocs[name] ?? null);
  mockFieldFind.mockImplementation(({ form }) => {
    const query = {
      sort: jest.fn(),
      lean: jest.fn().mockResolvedValue(fieldDocs[form] ?? []),
    };
    query.sort.mockReturnValue(query);
    return query;
  });
  mockWorkflowFindOne.mockImplementation(async ({ form }) => workflowDocs[form] ?? null);
  mockApprovalDeleteMany.mockResolvedValue({});
  mockApprovalInsertMany.mockImplementation(async (docs) => docs);
  mockEmployeeUpdateOne.mockResolvedValue({});
  mockGetLeaveFieldIds.mockResolvedValue({
    formId: 'form-leave',
    startId: 'leave-start',
    endId: 'leave-end',
    typeId: 'leave-type',
    typeOptions: [{ value: '特休' }, { value: '事假' }],
  });
});

describe('seedApprovalRequests', () => {
  it('creates approval requests with workflow steps and approvers', async () => {
    const supervisors = [
      { _id: 'sup-hr', organization: 'org1', department: 'dept1', signTags: ['人資'] },
      { _id: 'sup-support', organization: 'org2', department: 'dept2', signTags: ['支援單位主管'] },
      { _id: 'sup-schedule', organization: 'org3', department: 'dept3', signTags: ['排班負責人'] },
      { _id: 'sup-finance', organization: 'org4', department: 'dept4', signTags: ['財務覆核'] },
    ];
    const employees = [
      { _id: 'emp-1', organization: 'org1', department: 'dept1', supervisor: 'sup-hr', signTags: [] },
      { _id: 'emp-2', organization: 'org2', department: 'dept2', supervisor: 'sup-support', signTags: [] },
      { _id: 'emp-3', organization: 'org3', department: 'dept3', supervisor: 'sup-schedule', signTags: [] },
    ];

    const result = await seedApprovalRequests({ supervisors, employees });

    expect(mockApprovalDeleteMany).toHaveBeenCalledWith({});
    expect(mockApprovalInsertMany).toHaveBeenCalledTimes(1);

    const inserted = mockApprovalInsertMany.mock.calls[0][0];
    
    // 原有多樣化記錄: 8 forms × 4 statuses = 32
    // 每月必要記錄: 2 months × (supervisors + employees) × 3 types (leave, overtime, bonus)
    // 本測試: 2 months × (4 supervisors + 3 employees) × 3 types = 42
    // 總計: 32 + 42 = 74
    const expectedMinimumCount = Object.keys(workflowDocs).length * 4;
    expect(inserted.length).toBeGreaterThanOrEqual(expectedMinimumCount);

    const statuses = new Set(inserted.map((req) => req.status));
    expect(statuses).toContain('approved');
    expect(statuses).toContain('pending');
    expect(statuses).toContain('rejected');
    expect(statuses).toContain('returned');

    inserted.forEach((req) => {
      expect(req.steps.length).toBeGreaterThan(0);
      req.steps.forEach((step) => {
        expect(step.approvers.every((approver) => !!approver.approver)).toBe(true);
      });
      expect(req.logs[0].action).toBe('create');
    });

    const leaveRequests = inserted.filter((req) => req.form === 'form-leave');
    leaveRequests.forEach((req, index) => {
      const managerStep = req.steps.find((step) => step.step_order === 1);
      const tagStep = req.steps.find((step) => step.step_order === 2);
      const managerIds = managerStep.approvers.map((a) => a.approver);
      expect(managerIds.some((id) => supervisors.map((s) => s._id).includes(id))).toBe(true);
      expect(tagStep.approvers.map((a) => a.approver)).toContain('sup-hr');
      expect(Object.keys(req.form_data)).toEqual(
        expect.arrayContaining(['leave-type', 'leave-start', 'leave-end', 'leave-reason']),
      );
    });

    const supportRequest = inserted.find((req) => req.form === 'form-support');
    expect(Object.keys(supportRequest.form_data)).toEqual(
      expect.arrayContaining(['support-reason', 'support-start', 'support-end', 'support-file']),
    );

    const overtimeRequest = inserted.find((req) => req.form === 'form-ot');
    expect(overtimeRequest.form_data).toEqual(
      expect.objectContaining({ 'ot-start': expect.any(Date), 'ot-end': expect.any(Date) }),
    );

    const bonusRequest = inserted.find((req) => req.form === 'form-bonus');
    expect(Object.keys(bonusRequest.form_data)).toEqual(
      expect.arrayContaining(['bonus-type', 'bonus-amount', 'bonus-reason']),
    );

    expect(result.requests).toHaveLength(inserted.length);
  });
});
