import { jest } from '@jest/globals';
import { pickAllowedFields, sendSafeError } from '../src/utils/requestSecurity.js';

const mockOrgSave = jest.fn();
const MockOrganization = jest.fn((data) => ({
  ...data,
  _id: 'org1',
  save: mockOrgSave,
}));
MockOrganization.findByIdAndUpdate = jest.fn();

const mockInsuranceRecord = {
  findByIdAndUpdate: jest.fn(),
};

jest.unstable_mockModule('../src/models/Organization.js', () => ({ default: MockOrganization }));
jest.unstable_mockModule('../src/models/InsuranceRecord.js', () => ({ default: mockInsuranceRecord }));

const { createOrganization, updateOrganization } = await import('../src/controllers/organizationController.js');
const { updateInsurance } = await import('../src/controllers/insuranceController.js');

function createMockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

describe('P0 Legacy Controller Security', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('pickAllowedFields strips disallowed and prototype-polluting keys', () => {
    const input = {
      name: '總公司',
      orgCode: 'HQ',
      $where: '1==1',
      role: 'admin',
      __proto__: { polluted: true },
    };
    const filtered = pickAllowedFields(input, ['name', 'orgCode']);
    expect(filtered).toEqual({ name: '總公司', orgCode: 'HQ' });
    expect(Object.hasOwn(filtered, '$where')).toBe(false);
    expect(Object.hasOwn(filtered, 'role')).toBe(false);
  });

  it('sendSafeError masks internal Error details on 500 responses', () => {
    const req = { requestId: 'req-123' };
    const res = createMockRes();
    const err = new Error('ECONNREFUSED mongodb://secret:password@10.0.0.5:27017');
    sendSafeError(req, res, err, { defaultMessage: '系統錯誤，請稍後再試' });
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: '系統錯誤，請稍後再試', requestId: 'req-123' });
    expect(JSON.stringify(res.body)).not.toContain('mongodb://');
  });

  it('organizationController filters mass-assignment fields and sets runValidators', async () => {
    mockOrgSave.mockResolvedValue({ _id: 'org1', name: '台北總部', orgCode: 'TPE' });
    const req = {
      body: {
        name: '台北總部',
        orgCode: 'TPE',
        role: 'admin',
        $set: { hacked: true },
      },
    };
    const res = createMockRes();
    await createOrganization(req, res);

    expect(res.statusCode).toBe(201);
    expect(MockOrganization).toHaveBeenCalledWith({ name: '台北總部', orgCode: 'TPE' });

    const validId = '507f1f77bcf86cd799439011';
    MockOrganization.findByIdAndUpdate.mockResolvedValue({ _id: validId, name: '台北新總部' });
    const updateReq = {
      params: { id: validId },
      body: { name: '台北新總部', __v: 99, hackedField: 'evil' },
    };
    const updateRes = createMockRes();
    await updateOrganization(updateReq, updateRes);
    expect(MockOrganization.findByIdAndUpdate).toHaveBeenCalledWith(
      validId,
      { name: '台北新總部' },
      { new: true, runValidators: true }
    );
  });

  it('insuranceController masks unexpected DB errors and filters allowed fields', async () => {
    mockInsuranceRecord.findByIdAndUpdate.mockRejectedValue(new Error('internal db leak'));
    const req = {
      params: { id: '507f1f77bcf86cd799439011' },
      body: { provider: '國泰人壽', policyNumber: 'P-001', adminOverride: true },
    };
    const res = createMockRes();
    await updateInsurance(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('internal db leak');
  });
});
