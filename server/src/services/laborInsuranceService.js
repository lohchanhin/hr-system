import LaborInsuranceRate from '../models/LaborInsuranceRate.js';

export const DEFAULT_LABOR_INSURANCE_RATES = [
  { level: 1, insuredSalary: 11100, workerFee: 277, employerFee: 972 },
  { level: 2, insuredSalary: 12540, workerFee: 313, employerFee: 1097 },
  { level: 3, insuredSalary: 13500, workerFee: 338, employerFee: 1182 },
  { level: 4, insuredSalary: 15840, workerFee: 396, employerFee: 1386 },
  { level: 5, insuredSalary: 16500, workerFee: 413, employerFee: 1444 },
  { level: 6, insuredSalary: 17280, workerFee: 432, employerFee: 1512 },
  { level: 7, insuredSalary: 17880, workerFee: 447, employerFee: 1564 },
  { level: 8, insuredSalary: 19047, workerFee: 476, employerFee: 1666 },
  { level: 9, insuredSalary: 20008, workerFee: 500, employerFee: 1751 },
  { level: 10, insuredSalary: 21009, workerFee: 525, employerFee: 1838 },
  { level: 11, insuredSalary: 22000, workerFee: 550, employerFee: 1925 },
  { level: 12, insuredSalary: 23100, workerFee: 577, employerFee: 2022 },
  { level: 13, insuredSalary: 24000, workerFee: 600, employerFee: 2100 },
  { level: 14, insuredSalary: 25250, workerFee: 632, employerFee: 2210 },
  { level: 15, insuredSalary: 26400, workerFee: 660, employerFee: 2310 },
  { level: 16, insuredSalary: 27600, workerFee: 690, employerFee: 2415 },
  { level: 17, insuredSalary: 28590, workerFee: 715, employerFee: 2501 },
  { level: 18, insuredSalary: 28800, workerFee: 720, employerFee: 2520 },
  { level: 19, insuredSalary: 30300, workerFee: 758, employerFee: 2651 },
  { level: 20, insuredSalary: 31800, workerFee: 795, employerFee: 2783 },
  { level: 21, insuredSalary: 33300, workerFee: 833, employerFee: 2914 },
  { level: 22, insuredSalary: 34800, workerFee: 870, employerFee: 3045 },
  { level: 23, insuredSalary: 36300, workerFee: 908, employerFee: 3176 },
  { level: 24, insuredSalary: 38200, workerFee: 955, employerFee: 3342 },
  { level: 25, insuredSalary: 40100, workerFee: 1002, employerFee: 3509 },
  { level: 26, insuredSalary: 42000, workerFee: 1050, employerFee: 3675 },
  { level: 27, insuredSalary: 43900, workerFee: 1098, employerFee: 3841 },
  { level: 28, insuredSalary: 45800, workerFee: 1145, employerFee: 4008 }
];

function normalizeRate(rate) {
  return {
    ...rate,
    ordinaryRate: rate.ordinaryRate ?? 11.5,
    employmentInsuranceRate: rate.employmentInsuranceRate ?? 1.0
  };
}

async function upsertRate(rate) {
  const normalized = normalizeRate(rate);
  const existingDoc = await LaborInsuranceRate.findOne({ level: normalized.level });
  // Mongoose documents may not be plain objects; normalize for comparison
  const existing = existingDoc && typeof existingDoc.toObject === 'function' ? existingDoc.toObject() : existingDoc;
  const needsUpdate = !existing ||
    existing.insuredSalary !== normalized.insuredSalary ||
    existing.workerFee !== normalized.workerFee ||
    existing.employerFee !== normalized.employerFee ||
    existing.ordinaryRate !== normalized.ordinaryRate ||
    existing.employmentInsuranceRate !== normalized.employmentInsuranceRate;

  await LaborInsuranceRate.findOneAndUpdate(
    { level: normalized.level },
    normalized,
    { upsert: true, new: true }
  );

  return needsUpdate;
}

/**
 * 根據薪資金額查找對應的勞保等級
 * @param {Number} salary - 薪資金額
 * @returns {Object|null} - 勞保費率資料
 */
export async function findInsuranceLevelBySalary(salary) {
  if (!salary || salary <= 0) return null;
  
  // 查找最接近且大於等於薪資的投保薪資等級
  const rate = await LaborInsuranceRate.findOne({
    insuredSalary: { $gte: salary }
  }).sort({ insuredSalary: 1 }).limit(1);
  
  if (!rate) {
    // 如果薪資超過最高級，返回最高級
    return await LaborInsuranceRate.findOne().sort({ level: -1 }).limit(1);
  }
  
  return rate;
}

/**
 * 根據等級獲取勞保費率
 * @param {Number} level - 等級 (1-28)
 * @returns {Object|null} - 勞保費率資料
 */
export async function getInsuranceRateByLevel(level) {
  if (!level) return null;
  return await LaborInsuranceRate.findOne({ level });
}

/**
 * 初始化勞保費率表（28個等級）
 */
export async function initializeLaborInsuranceRates() {
  for (const rate of DEFAULT_LABOR_INSURANCE_RATES) {
    await upsertRate(rate);
  }
  return DEFAULT_LABOR_INSURANCE_RATES.length;
}

/**
 * 模擬從官方來源取得最新勞保級距
 */
export async function fetchLatestLaborInsuranceRates() {
  // TODO: Replace with HTTP fetch to the government endpoint (JSON table with level/insuredSalary/fees)
  return DEFAULT_LABOR_INSURANCE_RATES;
}

/**
 * 檢查並更新勞保級距，返回是否已為最新
 */
export async function refreshLaborInsuranceRates() {
  const latestRates = await fetchLatestLaborInsuranceRates();
  const updatedLevels = [];

  for (const rate of latestRates) {
    const updated = await upsertRate(rate);
    if (updated) {
      updatedLevels.push(rate.level);
    }
  }

  const existingCount = await LaborInsuranceRate.countDocuments();
  const isUpToDate = updatedLevels.length === 0 && existingCount === latestRates.length;

  return {
    updatedLevels,
    updatedCount: updatedLevels.length,
    totalLevels: latestRates.length,
    isUpToDate
  };
}

export default {
  findInsuranceLevelBySalary,
  getInsuranceRateByLevel,
  initializeLaborInsuranceRates,
  fetchLatestLaborInsuranceRates,
  refreshLaborInsuranceRates
};
