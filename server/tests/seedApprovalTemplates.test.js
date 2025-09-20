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
    mockFieldFind.mockImplementation(() => {
      const query = {
        sort: jest.fn(),
        lean: jest.fn().mockResolvedValue([
          { _id: 'field1', label: '假別' },
          { _id: 'field2', label: '開始日期' },
          { _id: 'field3', label: '結束日期' },
        ]),
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
    expect(result.templates['請假'].fields).toHaveLength(3);
  });
});
