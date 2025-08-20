import { jest } from '@jest/globals';

const mockFormTemplate = { findById: jest.fn() };
const mockApprovalWorkflow = { findOne: jest.fn() };
const mockEmployee = { findById: jest.fn(), find: jest.fn() };
const mockUser = { findById: jest.fn() };
let requestsDB;
let reqCounter;
const mockApprovalRequest = {
  create: jest.fn(async data => {
    const doc = { ...data, _id: `req${++reqCounter}`, save: async function () { requestsDB[this._id] = this; return this; } };
    requestsDB[doc._id] = doc;
    return doc;
  }),
  findById: jest.fn(async id => requestsDB[id] || null),
};

let createApprovalRequest;
let actOnApproval;

beforeAll(async () => {
  await jest.unstable_mockModule('../src/models/form_template.js', () => ({ default: mockFormTemplate }));
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({ default: mockApprovalWorkflow }));
  await jest.unstable_mockModule('../src/models/approval_request.js', () => ({ default: mockApprovalRequest }));
  await jest.unstable_mockModule('../src/models/Employee.js', () => ({ default: mockEmployee }));
  await jest.unstable_mockModule('../src/models/User.js', () => ({ default: mockUser }));
  const mod = await import('../src/controllers/approvalRequestController.js');
  createApprovalRequest = mod.createApprovalRequest;
  actOnApproval = mod.actOnApproval;
});

beforeEach(() => {
  mockFormTemplate.findById.mockReset();
  mockApprovalWorkflow.findOne.mockReset();
  mockApprovalRequest.create.mockReset();
  mockApprovalRequest.findById.mockReset();
  mockEmployee.findById.mockReset();
  mockUser.findById.mockReset();
  reqCounter = 0;
  requestsDB = {};
});

function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() };
}

describe('Approval Workflow', () => {
  it('handles multi-step flow with all_must_approve and delegation', async () => {
    const workflow = {
      _id: 'wf1',
      form: 'form1',
      steps: [
        { step_order: 1, approver_type: 'user', approver_value: ['empA', 'empB'], all_must_approve: true, can_return: true },
        { step_order: 2, approver_type: 'user', approver_value: ['empC'], all_must_approve: false, can_return: true },
      ],
      policy: { allowDelegate: true },
    };
    const form = { _id: 'form1', name: 'Demo', is_active: true };
    mockFormTemplate.findById.mockResolvedValue(form);
    mockApprovalWorkflow.findOne.mockResolvedValue(workflow);
    mockEmployee.findById.mockResolvedValue({ _id: 'empApplicant' });

    const req1 = { body: { form_id: 'form1', applicant_employee_id: 'empApplicant', form_data: {} } };
    const res1 = makeRes();
    await createApprovalRequest(req1, res1);
    const created = res1.json.mock.calls[0][0];
    const id = created._id;

    await actOnApproval({ params: { id }, body: { decision: 'approve', employee_id: 'empA' } }, makeRes());
    const resAfterSecond = makeRes();
    await actOnApproval({ params: { id }, body: { decision: 'approve', employee_id: 'empB' } }, resAfterSecond);
    expect(resAfterSecond.json.mock.calls[0][0].current_step_index).toBe(1);

    const resFinal = makeRes();
    await actOnApproval({ params: { id }, body: { decision: 'approve', employee_id: 'empC' } }, resFinal);
    expect(resFinal.json.mock.calls[0][0].status).toBe('approved');
  });

  it('allows reject', async () => {
    const workflow = {
      _id: 'wf1',
      form: 'form1',
      steps: [
        { step_order: 1, approver_type: 'user', approver_value: ['empA'], all_must_approve: true, can_return: true },
      ],
    };
    const form = { _id: 'form1', name: 'Demo', is_active: true };
    mockFormTemplate.findById.mockResolvedValue(form);
    mockApprovalWorkflow.findOne.mockResolvedValue(workflow);
    mockEmployee.findById.mockResolvedValue({ _id: 'empApplicant' });

    const res1 = makeRes();
    await createApprovalRequest({ body: { form_id: 'form1', applicant_employee_id: 'empApplicant', form_data: {} } }, res1);
    const id = res1.json.mock.calls[0][0]._id;

    const res2 = makeRes();
    await actOnApproval({ params: { id }, body: { decision: 'reject', employee_id: 'empA' } }, res2);
    expect(res2.json.mock.calls[0][0].status).toBe('rejected');
  });

  it('returns to previous step', async () => {
    const workflow = {
      _id: 'wf1',
      form: 'form1',
      steps: [
        { step_order: 1, approver_type: 'user', approver_value: ['empA'], all_must_approve: true, can_return: true },
        { step_order: 2, approver_type: 'user', approver_value: ['empB'], all_must_approve: true, can_return: true },
      ],
    };
    const form = { _id: 'form1', name: 'Demo', is_active: true };
    mockFormTemplate.findById.mockResolvedValue(form);
    mockApprovalWorkflow.findOne.mockResolvedValue(workflow);
    mockEmployee.findById.mockResolvedValue({ _id: 'empApplicant' });

    const res1 = makeRes();
    await createApprovalRequest({ body: { form_id: 'form1', applicant_employee_id: 'empApplicant', form_data: {} } }, res1);
    const id = res1.json.mock.calls[0][0]._id;

    await actOnApproval({ params: { id }, body: { decision: 'approve', employee_id: 'empA' } }, makeRes());

    const resReturn = makeRes();
    await actOnApproval({ params: { id }, body: { decision: 'return', employee_id: 'empB' } }, resReturn);
    const returned = resReturn.json.mock.calls[0][0];
    expect(returned.current_step_index).toBe(0);
    expect(returned.steps[0].approvers[0].decision).toBe('pending');
  });
});
