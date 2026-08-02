import LaborInsuranceRate from '../models/LaborInsuranceRate.js';
import {
  DEFAULT_HEALTH_INSURANCE_RATES,
  DEFAULT_LABOR_INSURANCE_RATES,
  DEFAULT_LABOR_PENSION_RATES,
  TAIWAN_INSURANCE_BASELINE_EFFECTIVE_FROM,
  TAIWAN_INSURANCE_SOURCES,
} from '../data/taiwanInsuranceRates2026.js';

export {
  DEFAULT_HEALTH_INSURANCE_RATES,
  DEFAULT_LABOR_INSURANCE_RATES,
  DEFAULT_LABOR_PENSION_RATES,
};

const fetchFn = typeof fetch === 'function' ? fetch : null;

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
  const { rates } = await fetchRefreshSource('laborInsurance');
  return rates;
}

/**
 * 檢查並更新勞保級距，返回是否已為最新
 */
export async function refreshLaborInsuranceRates() {
  const sourceResult = await fetchRefreshSource('laborInsurance');
  const latestRates = sourceResult.rates;
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
    isUpToDate,
    ...buildSourceMetadata('laborInsurance', sourceResult.source),
    message: buildRefreshMessage('laborInsurance', sourceResult.source),
  };
}

const OFFICIAL_SOURCE_CONFIG = {
  laborInsurance: {
    url: process.env.LABOR_INSURANCE_SOURCE_URL,
    fallback: DEFAULT_LABOR_INSURANCE_RATES.map((rate) => ({ ...rate })),
  },
  healthInsurance: {
    url: process.env.HEALTH_INSURANCE_SOURCE_URL,
    fallback: DEFAULT_HEALTH_INSURANCE_RATES.map((rate) => ({ ...rate })),
  },
  laborPension: {
    url: process.env.LABOR_PENSION_SOURCE_URL,
    fallback: DEFAULT_LABOR_PENSION_RATES.map((rate) => ({ ...rate })),
  },
};

const TYPE_ALIASES = {
  retirement: 'laborPension'
};

const TYPE_LABELS = {
  laborInsurance: '勞保',
  healthInsurance: '健保',
  laborPension: '勞退',
};

function normalizeInsuranceType(type) {
  if (OFFICIAL_SOURCE_CONFIG[type]) return type;
  return TYPE_ALIASES[type] || 'laborInsurance';
}

function buildSourceMetadata(type, source) {
  const normalizedType = normalizeInsuranceType(type);
  return {
    source,
    effectiveFrom: TAIWAN_INSURANCE_BASELINE_EFFECTIVE_FROM,
    sourceUrl: TAIWAN_INSURANCE_SOURCES[normalizedType],
  };
}

function buildRefreshMessage(type, source) {
  const normalizedType = normalizeInsuranceType(type);
  const label = TYPE_LABELS[normalizedType];
  if (source === 'configured-endpoint') {
    return `已從設定的資料來源載入${label}級距；結薪前仍應核對官方公告`;
  }
  return `已載入 ${TAIWAN_INSURANCE_BASELINE_EFFECTIVE_FROM} 生效的${label}官方基準（非即時連線）；結薪前仍應核對最新公告`;
}

function pickFirstNumber(source, keys, fallbackValue) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return fallbackValue;
}

function mapOfficialRates(rawRates, fallback) {
  if (!Array.isArray(rawRates)) return fallback;

  const mapped = rawRates.map((item, idx) => {
    const level = pickFirstNumber(item, ['level', 'Level', '等級'], idx + 1);
    const insuredSalary = pickFirstNumber(item, ['insuredSalary', 'InsuredSalary', 'salary', '投保薪資', '月提繳級距'], 0);
    const workerFee = pickFirstNumber(item, ['workerFee', 'worker_fee', '被保險人金額', 'employeeFee'], 0);
    const employerFee = pickFirstNumber(item, ['employerFee', 'employer_fee', '投保單位金額', 'employerContribution'], 0);
    return {
      level,
      insuredSalary,
      workerFee,
      employerFee,
      ordinaryRate: item?.ordinaryRate ?? item?.['ordinary_rate'],
      employmentInsuranceRate: item?.employmentInsuranceRate ?? item?.['employment_insurance_rate']
    };
  }).filter(rate => Number.isFinite(rate.insuredSalary) && rate.insuredSalary > 0);

  return mapped.length ? mapped : fallback;
}

async function fetchRefreshSource(type) {
  const normalizedType = normalizeInsuranceType(type);
  const source = OFFICIAL_SOURCE_CONFIG[normalizedType];
  if (source.url && fetchFn) {
    try {
      const response = await fetchFn(source.url);
      if (response.ok) {
        const data = await response.json();
        return {
          rates: mapOfficialRates(data, source.fallback),
          source: 'configured-endpoint',
        };
      }
    } catch (error) {
      console.error(`Failed to fetch configured ${normalizedType} rates`, error);
    }
  }

  return {
    rates: source.fallback.map((rate) => ({ ...rate })),
    source: 'embedded-official-baseline',
  };
}

async function fetchRatesWithMeta(type = 'laborInsurance') {
  const configKey = normalizeInsuranceType(type);

  if (configKey === 'laborInsurance') {
    const rates = await LaborInsuranceRate.find().sort({ level: 1 });
    if (rates.length) {
      return {
        rates,
        source: 'database',
        ...buildSourceMetadata(configKey, 'database'),
      };
    }
    return {
      rates: DEFAULT_LABOR_INSURANCE_RATES.map(normalizeRate),
      source: 'embedded-official-baseline',
      ...buildSourceMetadata(configKey, 'embedded-official-baseline'),
    };
  }

  const result = await fetchRefreshSource(configKey);
  return {
    ...result,
    ...buildSourceMetadata(configKey, result.source),
  };
}

export async function fetchInsuranceRatesByType(type = 'laborInsurance') {
  const { rates } = await fetchRatesWithMeta(type);
  return rates;
}

export async function refreshInsuranceRatesByType(type = 'laborInsurance') {
  const normalizedType = normalizeInsuranceType(type);
  if (normalizedType === 'laborInsurance') {
    return refreshLaborInsuranceRates();
  }

  const result = await fetchRefreshSource(normalizedType);
  const { rates, source } = result;
  return {
    updatedLevels: [],
    updatedCount: 0,
    totalLevels: rates.length,
    isUpToDate: rates.length > 0,
    rates,
    ...buildSourceMetadata(normalizedType, source),
    message: buildRefreshMessage(normalizedType, source),
  };
}

export default {
  findInsuranceLevelBySalary,
  getInsuranceRateByLevel,
  initializeLaborInsuranceRates,
  fetchLatestLaborInsuranceRates,
  refreshLaborInsuranceRates,
  fetchInsuranceRatesByType,
  refreshInsuranceRatesByType
};
