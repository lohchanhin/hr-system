import { jest } from '@jest/globals';

const mockTemplateFindOne = jest.fn();
const mockTemplateCreate = jest.fn(async data => ({ _id: `${data.name}_id`, ...data }));
const mockFieldFindOne = jest.fn();
const mockFieldCreate = jest.fn();
const mockFieldFind = jest.fn();
const mockWorkflowFindOne = jest.fn();
const mockWorkflowCreate = jest.fn();
const mockResetLeaveFieldCache = jest.fn();
const mockGetLeaveFieldIds = jest.fn();

let seedApprovalTemplates;

const fieldDocsByForm = {
  請假_id: [
    { _id: 'leave-type', label: '假別' },
    { _id: 'leave-start', label: '開始日期' },
    { _id: 'leave-end', label: '結束日期' },
    { _id: 'leave-reason', label: '事由' },
  ],
  支援申請_id: [
    { _id: 'support-reason', label: '申請事由' },
    { _id: 'support-start', label: '開始日期' },
    { _id: 'support-end', label: '結束日期' },
    { _id: 'support-file', label: '附件' },
  ],
  特休保留_id: [
    { _id: 'retain-year', label: '年度' },
    { _id: 'retain-days', label: '保留天數' },
    { _id: 'retain-reason', label: '理由' },
  ],
  在職證明_id: [
    { _id: 'employ-purpose', label: '用途' },
    { _id: 'employ-date', label: '開立日期' },
  ],
  離職證明_id: [
    { _id: 'resign-purpose', label: '用途' },
    { _id: 'resign-date', label: '離職日期' },
  ],
  加班申請_id: [
    { _id: 'ot-start', label: '開始時間' },
    { _id: 'ot-end', label: '結束時間' },
    { _id: 'ot-cross', label: '是否跨日' },
    { _id: 'ot-reason', label: '事由' },
  ],
  補簽申請_id: [
    { _id: 'makeup-start', label: '開始時間' },
    { _id: 'makeup-end', label: '結束時間' },
    { _id: 'makeup-cross', label: '是否跨日' },
    { _id: 'makeup-reason', label: '事由' },
  ],
  獎金申請_id: [
    { _id: 'bonus-type', label: '獎金類型' },
    { _id: 'bonus-amount', label: '金額' },
    { _id: 'bonus-reason', label: '事由' },
  ],
};

beforeAll(async () => {
  process.env.PORT = '3000';
  process.env.MONGODB_URI = 'mongodb://localhost/test';
  process.env.JWT_SECRET = 'secret';
  process.env.NODE_ENV = 'test';

  await jest.unstable_mockModule('../src/models/form_template.js', () => ({
    default: { findOne: mockTemplateFindOne, create: mockTemplateCreate },
  }));
  await jest.unstable_mockModule('../src/models/form_field.js', () => ({
    default: { findOne: mockFieldFindOne, create: mockFieldCreate, find: mockFieldFind },
  }));
  await jest.unstable_mockModule('../src/models/approval_workflow.js', () => ({
    default: { findOne: mockWorkflowFindOne, create: mockWorkflowCreate },
  }));
  await jest.unstable_mockModule('../src/services/leaveFieldService.js', () => ({
    resetLeaveFieldCache: mockResetLeaveFieldCache,
    getLeaveFieldIds: mockGetLeaveFieldIds,
  }));

  const mod = await import('../src/seedUtils.js');
  seedApprovalTemplates = mod.seedApprovalTemplates;
});

describe('seedApprovalTemplates', () => {
  it('creates templates, fields and workflows', async () => {
    mockTemplateFindOne.mockResolvedValue(null);
    mockFieldFindOne.mockResolvedValue(null);
    mockWorkflowFindOne.mockResolvedValue(null);
    mockWorkflowCreate.mockImplementation(async ({ form, steps }) => ({ _id: `${form}-wf`, steps }));
    mockFieldFind.mockImplementation(({ form }) => {
      const query = {
        sort: jest.fn(),
        lean: jest.fn().mockResolvedValue(fieldDocsByForm[form] ?? []),
      };
      query.sort.mockReturnValue(query);
      return query;
    });
    mockGetLeaveFieldIds.mockResolvedValue({
      formId: 'leaveForm',
      startId: 'field2',
      endId: 'field3',
      typeId: 'field1',
      typeOptions: [],
    });

    const result = await seedApprovalTemplates();
    expect(mockTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({ name: '支援申請' }));
    expect(mockTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({ name: '特休保留' }));
    expect(mockTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({ name: '請假' }));
    expect(mockTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({ name: '加班申請' }));
    expect(mockTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({ name: '補簽申請' }));
    expect(mockTemplateCreate).toHaveBeenCalledWith(expect.objectContaining({ name: '獎金申請' }));
    expect(mockFieldCreate).toHaveBeenCalledWith(expect.objectContaining({ label: '附件', type_1: 'file' }));
    expect(mockWorkflowCreate).toHaveBeenCalledWith(expect.objectContaining({
      steps: expect.arrayContaining([
        expect.objectContaining({ approver_type: 'manager' }),
        expect.objectContaining({ approver_type: 'tag', approver_value: '人資' }),
        expect.objectContaining({ approver_type: 'tag', approver_value: '支援單位主管' }),
      ]),
    }));
    expect(mockResetLeaveFieldCache).toHaveBeenCalled();
    expect(mockGetLeaveFieldIds).toHaveBeenCalled();
    expect(result.templates['加班申請'].fields).toHaveLength(4);
    expect(result.templates['獎金申請'].fields).toHaveLength(3);
  });
});
