const AMOUNT_FIELDS = ['amount', '金額', 'bonus', 'bonusAmount', '津貼', '補助', '獎金', 'nightShiftAllowance', 'performanceBonus', 'otherBonuses'];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function extractNumericAmount(formData = {}) {
  for (const field of AMOUNT_FIELDS) {
    if (formData[field] === undefined) continue;
    const amount = toNumber(formData[field]);
    if (amount) return amount;
  }
  // 嘗試搜尋第一個數值型欄位 (排除 Date 物件以避免誤將時間戳記當作金額)
  for (const value of Object.values(formData)) {
    // 跳過 Date 物件和其他非純數值類型
    if (value instanceof Date || typeof value === 'object') continue;
    const amount = toNumber(value);
    if (amount) return amount;
  }
  return 0;
}

export function aggregateBonusFromApprovals(approvals = []) {
  let nightShiftAllowance = 0;
  let performanceBonus = 0;
  let otherBonuses = 0;

  approvals.forEach((approval) => {
    const amount = extractNumericAmount(approval?.form_data || {});
    if (!amount) return;

    const formName = String(approval?.form?.name || '').toLowerCase();
    const bonusType = String(
      approval?.form_data?.bonusType ||
      approval?.form_data?.獎金類型 ||
      approval?.form_data?.type ||
      ''
    ).toLowerCase();

    const text = `${formName} ${bonusType}`;

    if (text.includes('夜班') || text.includes('night')) {
      nightShiftAllowance += amount;
      return;
    }

    if (text.includes('績效') || text.includes('performance')) {
      performanceBonus += amount;
      return;
    }

    otherBonuses += amount;
  });

  return { nightShiftAllowance, performanceBonus, otherBonuses };
}

export default { aggregateBonusFromApprovals, extractNumericAmount };
