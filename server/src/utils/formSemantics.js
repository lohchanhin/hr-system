// 判斷一張簽核表單是不是「請假單」或「加班單」。
// 表單性質（semanticType）有設定時一律以它為準：管理員把「加班費申請」設成「一般」，它就是一般表單，
// 不會因為名稱含「加班」被套用加班檢核；只有完全沒有表單性質的舊表單才用名稱推論。

function normalizeText(value) {
  return String(value ?? '').trim().toLowerCase();
}

/**
 * 表單性質；沒有設定時回傳空字串。
 * 用 Mongoose 讀出的舊文件缺欄位時會被補上預設值 general，這種「只是預設值」的不算有設定。
 */
export function explicitSemanticType(form) {
  if (!form) return '';
  if (typeof form.$isDefault === 'function') {
    try {
      if (form.$isDefault('semanticType')) return '';
    } catch {
      // 不是完整的 Mongoose 文件時，照一般物件處理
    }
  }
  return normalizeText(form.semanticType);
}

export function isOvertimeFormTemplate(form) {
  const type = explicitSemanticType(form);
  if (type) return type === 'overtime';
  const name = normalizeText(form?.name);
  return name.includes('加班') || name.includes('overtime');
}

export function isLeaveFormTemplate(form) {
  const type = explicitSemanticType(form);
  if (type) return type === 'leave';
  const name = normalizeText(form?.name);
  return name.includes('請假') || name.includes('leave');
}
