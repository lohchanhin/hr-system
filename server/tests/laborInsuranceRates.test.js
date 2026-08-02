import { jest } from '@jest/globals'

const mockLaborInsuranceRate = {
  find: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
}

jest.unstable_mockModule('../src/models/LaborInsuranceRate.js', () => ({
  default: mockLaborInsuranceRate,
}))

let service

beforeAll(async () => {
  service = await import('../src/services/laborInsuranceService.js')
})

beforeEach(() => {
  Object.values(mockLaborInsuranceRate).forEach((fn) => fn.mockReset())
})

describe('2026 Taiwan insurance rate baselines', () => {
  it('contains the official 2026 labor insurance minimum salary row', () => {
    expect(service.DEFAULT_LABOR_INSURANCE_RATES).toHaveLength(28)
    expect(service.DEFAULT_LABOR_INSURANCE_RATES[17]).toEqual({
      level: 18,
      insuredSalary: 29500,
      workerFee: 738,
      employerFee: 2582,
    })
  })

  it('contains all 58 health insurance levels and official endpoint values', () => {
    expect(service.DEFAULT_HEALTH_INSURANCE_RATES).toHaveLength(58)
    expect(service.DEFAULT_HEALTH_INSURANCE_RATES[0]).toEqual({
      level: 1,
      insuredSalary: 29500,
      workerFee: 458,
      employerFee: 1428,
    })
    expect(service.DEFAULT_HEALTH_INSURANCE_RATES[57]).toEqual({
      level: 58,
      insuredSalary: 313000,
      workerFee: 4855,
      employerFee: 15146,
    })
  })

  it('contains all 62 labor pension levels through the statutory ceiling', () => {
    expect(service.DEFAULT_LABOR_PENSION_RATES).toHaveLength(62)
    expect(service.DEFAULT_LABOR_PENSION_RATES[24]).toEqual({
      level: 25,
      insuredSalary: 29500,
      workerFee: 0,
      employerFee: 1770,
    })
    expect(service.DEFAULT_LABOR_PENSION_RATES[61]).toEqual({
      level: 62,
      insuredSalary: 150000,
      workerFee: 0,
      employerFee: 9000,
    })
  })

  it('reports embedded official baseline metadata without claiming a live fetch', async () => {
    const result = await service.refreshInsuranceRatesByType('healthInsurance')

    expect(result.source).toBe('embedded-official-baseline')
    expect(result.effectiveFrom).toBe('2026-01-01')
    expect(result.totalLevels).toBe(58)
    expect(result.updatedCount).toBe(0)
    expect(result.message).toContain('非即時連線')
  })

  it('upserts the labor baseline and reports changed levels', async () => {
    mockLaborInsuranceRate.findOne.mockResolvedValue(null)
    mockLaborInsuranceRate.findOneAndUpdate.mockResolvedValue({})
    mockLaborInsuranceRate.countDocuments.mockResolvedValue(28)

    const result = await service.refreshLaborInsuranceRates()

    expect(mockLaborInsuranceRate.findOneAndUpdate).toHaveBeenCalledTimes(28)
    expect(result.updatedCount).toBe(28)
    expect(result.source).toBe('embedded-official-baseline')
    expect(result.effectiveFrom).toBe('2026-01-01')
    expect(result.message).toContain('官方基準')
  })
})
