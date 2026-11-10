import mongoose from 'mongoose';
import PayrollRecord from '../models/PayrollRecord.js';
import LaborInsuranceRate from '../models/LaborInsuranceRate.js';
import Employee from '../models/Employee.js';
import Organization from '../models/Organization.js';
import ApprovalRequest from '../models/approval_request.js';
import { WORK_HOURS_CONFIG } from '../config/salaryConfig.js';
import {
  calculateEmployeePayroll,
  calculateBatchPayroll,
  savePayrollRecord,
  getEmployeePayrollRecords,
  extractRecurringAllowance
} from '../services/payrollService.js';
import {
  calculateWorkHours,
  calculateLeaveImpact,
  calculateOvertimePay,
  calculateCompleteWorkData
} from '../services/workHoursCalculationService.js';
import {
  initializeLaborInsuranceRates,
  refreshLaborInsuranceRates,
  fetchInsuranceRatesByType,
  refreshInsuranceRatesByType,
  getInsuranceRateByLevel
} from '../services/laborInsuranceService.js';
import { generatePayrollExcel, generateIndividualPayrollExcel } from '../services/payrollExportService.js';
import { generateMonthlyPayrollOverviewPdf } from '../services/payrollPdfExportService.js';
import {
  PAYROLL_EMPLOYEE_FIELDS,
  computeEmployeePayroll,
  createCalculationContext,
  loadBonusApprovals,
  loadPayrollBatchData,
  mapWithConcurrency,
} from '../services/payrollBatchService.js';
import { normalizePayrollMonth } from '../utils/payrollMonth.js';
import { readAnnualLeaveHours } from '../utils/annualLeaveHours.js';
import {
  PayrollPolicyValidationError,
  describePayrollPolicy,
  loadPayrollPolicy,
  updatePayrollPolicy,
} from '../services/payrollPolicyService.js';

const INVALID_MONTH_MESSAGE = 'Invalid month format. Expected YYYY-MM or YYYY-MM-01';

/**
 * GET /api/payroll/policy（只有管理員）：目前生效的薪資政策、預設值、選項說明與在職員工的自動計算加班費人數
 */
export async function getPayrollPolicySettings(req, res) {
  try {
    res.json(await describePayrollPolicy());
  } catch (err) {
    console.error('Failed to read payroll policy', { error: err?.name ?? 'Error' });
    res.status(500).json({ error: '讀取薪資設定失敗，請稍後再試' });
  }
}

/**
 * PUT /api/payroll/policy（只有管理員）：部分更新，只改有送的欄位；送 null 或預設值代表回到預設值。
 * 回傳更新後的完整內容（與 GET 相同）。
 */
export async function updatePayrollPolicySettings(req, res) {
  try {
    res.json(await updatePayrollPolicy(req.body, { actorId: req.user?.id }));
  } catch (err) {
    if (err instanceof PayrollPolicyValidationError) return res.status(400).json({ error: err.message });
    console.error('Failed to update payroll policy', { error: err?.name ?? 'Error' });
    res.status(500).json({ error: '儲存薪資設定失敗，請稍後再試' });
  }
}

// 機構／部門／單位（與員工）的篩選條件：薪資總覽、月薪資總覽 PDF、銀行匯款 Excel 共用同一套檢查。
// 回傳 { error } 或 { filters }（只含有值的條件）
function parseEmployeeScopeFilters(query, { allowEmployeeId = true } = {}) {
  const { organization, department, subDepartment, employeeId } = query;
  const objectIdFilters = allowEmployeeId ? { department, subDepartment, employeeId } : { department, subDepartment };
  const invalid = Object.entries(objectIdFilters).find(([, value]) => value && (typeof value !== 'string' || !mongoose.isValidObjectId(value)));
  if (invalid) return { error: `Invalid ${invalid[0]} filter` };
  if (organization && (typeof organization !== 'string' || organization.length > 100)) {
    return { error: 'Invalid organization filter' };
  }
  const filters = {};
  if (organization) filters.organization = organization;
  if (department) filters.department = department;
  if (subDepartment) filters.subDepartment = subDepartment;
  if (allowEmployeeId && employeeId) filters.employeeId = employeeId;
  return { filters };
}

export async function listPayrolls(req, res) {
  try {
    const { month } = req.query;
    // 員工條件：employeeId，也接受 employee（以前不認得 employee，帶了等於沒帶，回所有人的薪資記錄）
    const employeeId = req.query.employeeId ?? req.query.employee;
    const query = {};
    
    if (month) {
      // 月份格式不對時回 400，不要讓資料庫丟出轉型錯誤變成 500
      const normalizedMonth = normalizePayrollMonth(month);
      if (!normalizedMonth) return res.status(400).json({ error: INVALID_MONTH_MESSAGE });
      query.month = new Date(normalizedMonth);
    }
    if (employeeId !== undefined && employeeId !== '') {
      // 只收 24 碼的員工編號字串：employee[$ne]=x 這種查詢條件物件也擋下
      if (typeof employeeId !== 'string' || !/^[0-9a-fA-F]{24}$/.test(employeeId)) {
        return res.status(400).json({ error: 'Invalid employeeId' });
      }
      query.employee = employeeId;
    }
    
    const records = await PayrollRecord.find(query).populate('employee').sort({ month: -1, 'employee.name': 1 });
    res.json(records);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createPayroll(req, res) {
  try {
    const record = new PayrollRecord(req.body);
    await record.save();
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getPayroll(req, res) {
  try {
    const record = await PayrollRecord.findById(req.params.id).populate('employee');
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updatePayroll(req, res) {
  try {
    const record = await PayrollRecord.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deletePayroll(req, res) {
  try {
    const record = await PayrollRecord.findByIdAndDelete(req.params.id);
    if (!record) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 計算單個員工的薪資
 */
export async function calculatePayroll(req, res) {
  try {
    const { employeeId } = req.body;
    const customData = req.body.customData || {};
    
    if (!employeeId || !req.body.month) {
      return res.status(400).json({ error: 'employeeId and month are required' });
    }
    const month = normalizePayrollMonth(req.body.month);
    if (!month) return res.status(400).json({ error: INVALID_MONTH_MESSAGE });
    
    const result = await calculateEmployeePayroll(employeeId, month, customData);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 批量計算薪資
 */
export async function calculateBatchPayrolls(req, res) {
  try {
    const { employees, customDataMap } = req.body;
    
    if (!employees || !Array.isArray(employees) || !req.body.month) {
      return res.status(400).json({ error: 'employees (array) and month are required' });
    }
    const month = normalizePayrollMonth(req.body.month);
    if (!month) return res.status(400).json({ error: INVALID_MONTH_MESSAGE });
    
    const results = await calculateBatchPayroll(employees, month, customDataMap || {});
    res.json(results);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 計算並保存薪資
 */
export async function calculateAndSavePayroll(req, res) {
  try {
    const { employeeId } = req.body;
    const customData = req.body.customData || {};
    
    if (!employeeId || !req.body.month) {
      return res.status(400).json({ error: 'employeeId and month are required' });
    }
    // 月中的日期（例如 2026-10-15）會算成 15 日到下個月 15 日，存下來的記錄在薪資總覽也查不到，所以只接受每月第一天
    const month = normalizePayrollMonth(req.body.month);
    if (!month) return res.status(400).json({ error: INVALID_MONTH_MESSAGE });
    
    const payrollData = await calculateEmployeePayroll(employeeId, month, customData);
    const record = await savePayrollRecord(payrollData);
    
    res.status(201).json(record);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取員工的薪資記錄
 */
export async function getEmployeePayrolls(req, res) {
  try {
    const { employeeId } = req.params;
    const { month } = req.query;
    
    const records = await getEmployeePayrollRecords(employeeId, month);
    res.json(records);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 導出個人薪資表 Excel
 */
export async function exportIndividualPayrollExcel(req, res) {
  try {
    const { employeeId, paymentDate, organizationName } = req.query;

    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId is required' });
    }

    if (!req.query.month) {
      return res.status(400).json({ error: 'month is required' });
    }
    const month = normalizePayrollMonth(req.query.month);
    if (!month) return res.status(400).json({ error: INVALID_MONTH_MESSAGE });
    if (!mongoose.isValidObjectId(employeeId)) {
      return res.status(400).json({ error: 'Invalid employeeId' });
    }

    // 查找員工
    const employee = await Employee.findById(employeeId)
      .populate('organization')
      .populate('department')
      .populate('subDepartment');
    
    if (!employee) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // 查找薪資記錄
    const monthDate = new Date(month);
    let payrollRecord = await PayrollRecord.findOne({
      employee: employeeId,
      month: monthDate
    });

    // 如果沒有薪資記錄，則計算一筆
    if (!payrollRecord) {
      try {
        const calculatedPayroll = await calculateEmployeePayroll(employeeId, month, {});
        
        // 構建類似 PayrollRecord 的物件
        payrollRecord = {
          employee: employee._id,
          month: monthDate,
          baseSalary: calculatedPayroll.baseSalary || 0,
          netPay: calculatedPayroll.netPay || 0,
          laborInsuranceFee: calculatedPayroll.laborInsuranceFee || 0,
          healthInsuranceFee: calculatedPayroll.healthInsuranceFee || 0,
          laborPensionSelf: calculatedPayroll.laborPensionSelf || 0,
          employeeAdvance: calculatedPayroll.employeeAdvance || 0,
          debtGarnishment: calculatedPayroll.debtGarnishment || 0,
          otherDeductions: calculatedPayroll.otherDeductions || 0,
          overtimePay: calculatedPayroll.overtimePay || 0,
          nightShiftAllowance: calculatedPayroll.nightShiftAllowance || 0,
          performanceBonus: calculatedPayroll.performanceBonus || 0,
          otherBonuses: calculatedPayroll.otherBonuses || 0,
          insuranceLevel: calculatedPayroll.insuranceLevel,
          insuredSalary: calculatedPayroll.insuredSalary || 0,
          leaveDeduction: calculatedPayroll.leaveDeduction || 0,
          hourlyRate: calculatedPayroll.hourlyRate || 0,
          personalLeaveHours: calculatedPayroll.personalLeaveHours || 0,
          sickLeaveHours: calculatedPayroll.sickLeaveHours || 0,
          annualLeave: employee.annualLeave || {}
        };
      } catch (calcError) {
        console.error('Failed to calculate payroll for export:', calcError);
        throw new Error(`無法計算員工薪資記錄: ${calcError.message}`);
      }
    } else if (!payrollRecord.insuredSalary && payrollRecord.insuranceLevel) {
      // 舊的薪資記錄只存了級距序號，沒有投保薪資：從級距表查出來，薪資表才印得出「職退健 45,800」
      const rate = await getInsuranceRateByLevel(payrollRecord.insuranceLevel);
      const stored = typeof payrollRecord.toObject === 'function' ? payrollRecord.toObject() : payrollRecord;
      payrollRecord = { ...stored, insuredSalary: rate?.insuredSalary || 0 };
    }

    // 獲取組織名稱（優先使用 query parameter，否則從員工資料取得）
    let orgName = organizationName || '';
    if (!orgName && employee.organization) {
      if (typeof employee.organization === 'string') {
        // 如果是字串 ID，需要查詢；舊資料存的不是 ID（例如機構代碼或名稱）時不查，不然整張薪資表會因為轉型錯誤匯不出來
        const org = mongoose.isValidObjectId(employee.organization)
          ? await Organization.findById(employee.organization)
          : null;
        orgName = org?.name || '';
      } else if (employee.organization.name) {
        orgName = employee.organization.name;
      }
    }

    // 設定選項
    const exportOptions = {
      organizationName: orgName,
      paymentDate: paymentDate ? new Date(paymentDate) : undefined
    };

    const buffer = await generateIndividualPayrollExcel(payrollRecord, employee, exportOptions);

    // Sanitize filename to prevent directory traversal and invalid characters
    const sanitizedName = employee.name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_');
    const filename = `個人薪資表_${sanitizedName}_${month}.xlsx`;
    const encodedFilename = encodeURIComponent(filename);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`);
    res.send(buffer);
  } catch (err) {
    console.error('Export individual payroll error:', err);
    res.status(400).json({ error: err.message });
  }
}

const EXPORT_QUERY_KEYS = new Set(['month', 'format', 'bankType', 'organization', 'department', 'subDepartment']);

/**
 * 導出薪資 Excel (台灣企銀或台中銀格式)
 * 查詢參數：month、format（或 bankType），可再加 organization / department / subDepartment（與薪資總覽相同的篩選）
 */
export async function exportPayrollExcel(req, res) {
  try {
    const format = req.query.format || req.query.bankType;
    const companyInfo = req.body;

    if (!req.query.month) {
      return res.status(400).json({ error: 'month is required' });
    }
    const month = normalizePayrollMonth(req.query.month);
    if (!month) return res.status(400).json({ error: INVALID_MONTH_MESSAGE });

    if (!format || !['taiwan', 'taichung', 'bonusSlip'].includes(format)) {
      return res.status(400).json({ error: 'format must be "taiwan", "taichung" or "bonusSlip"' });
    }
    // 與薪資總覽、PDF 相同的機構／部門／單位篩選；其他不認得的查詢參數直接擋下，
    // 免得打錯參數名稱時悄悄匯出全公司的匯款檔
    const unknownParams = Object.keys(req.query).filter((key) => !EXPORT_QUERY_KEYS.has(key));
    if (unknownParams.length) {
      return res.status(400).json({ error: `不支援的匯出條件：${unknownParams.join('、')}（只接受 organization、department、subDepartment）` });
    }
    const { error: filterError, filters } = parseEmployeeScopeFilters(req.query, { allowEmployeeId: false });
    if (filterError) return res.status(400).json({ error: filterError });

    const buffer = await generatePayrollExcel(month, format, companyInfo, filters);

    const filename = `payroll_${month}_${format}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 匯出月薪資總覽 PDF
 */
export async function exportMonthlyPayrollOverviewPdf(req, res) {
  try {
    if (!req.query.month) {
      return res.status(400).json({ error: 'month is required' });
    }
    const month = normalizePayrollMonth(req.query.month);
    if (!month) return res.status(400).json({ error: INVALID_MONTH_MESSAGE });
    // 與薪資總覽相同的篩選條件檢查：不合法的 ID 直接回 400，不要把資料庫的轉型錯誤訊息丟給使用者
    const { error: filterError, filters } = parseEmployeeScopeFilters(req.query);
    if (filterError) return res.status(400).json({ error: filterError });

    const buffer = await generateMonthlyPayrollOverviewPdf(month, filters);

    const filename = `monthly_payroll_overview_${month}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error exporting monthly payroll overview PDF:', err);
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取勞保費率表
 */
export async function getLaborInsuranceRates(req, res) {
  try {
    const type = req.query.type || 'laborInsurance';
    const rates = await fetchInsuranceRatesByType(type);
    res.json(rates);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * 初始化勞保費率表
 */
export async function initializeLaborInsuranceRatesController(req, res) {
  try {
    const count = await initializeLaborInsuranceRates();
    res.json({ success: true, count, message: 'Labor insurance rates initialized' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function refreshLaborInsuranceRatesController(req, res) {
  try {
    const type = req.query.type || req.body?.type || 'laborInsurance';
    const result = type === 'laborInsurance'
      ? await refreshLaborInsuranceRates()
      : await refreshInsuranceRatesByType(type);
    res.json({
      success: true,
      ...result,
      message: result.message || '級距資料已載入'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

const PAYROLL_OVERVIEW_DEFAULT_PAGE_SIZE = 20;
const PAYROLL_OVERVIEW_MAX_PAGE_SIZE = 100;
const PAYROLL_OVERVIEW_SEARCH_MAX_LENGTH = 100;

function parsePositiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 獲取月薪資總覽（支援篩選機構、部門、單位、員工）
 * 自動計算沒有薪資記錄的員工薪資
 */
export async function getMonthlyPayrollOverview(req, res) {
  try {
    const {
      month,
      organization,
      department,
      subDepartment,
      employeeId,
      q,
      page: pageRaw,
      pageSize: pageSizeRaw,
      summary: summaryRaw,
    } = req.query;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) {
      return res.status(400).json({ error: 'Invalid month format. Expected YYYY-MM-01' });
    }
    const monthDate = new Date(`${month}T00:00:00.000Z`);

    const objectIdFilters = { department, subDepartment, employeeId };
    const invalidObjectIdFilter = Object.entries(objectIdFilters)
      .find(([, value]) => value && !mongoose.isValidObjectId(value));
    if (invalidObjectIdFilter) {
      return res.status(400).json({ error: `Invalid ${invalidObjectIdFilter[0]} filter` });
    }
    if (organization && (typeof organization !== 'string' || organization.length > 100)) {
      return res.status(400).json({ error: 'Invalid organization filter' });
    }
    const search = typeof q === 'string' ? q.trim() : '';
    if ((q !== undefined && typeof q !== 'string') || search.length > PAYROLL_OVERVIEW_SEARCH_MAX_LENGTH) {
      return res.status(400).json({ error: 'Invalid employee search' });
    }

    const page = parsePositiveInteger(pageRaw, 1);
    const pageSize = parsePositiveInteger(
      pageSizeRaw,
      PAYROLL_OVERVIEW_DEFAULT_PAGE_SIZE,
      PAYROLL_OVERVIEW_MAX_PAGE_SIZE
    );
    
    // Build employee query based on filters
    const employeeQuery = {};
    if (organization) {
      employeeQuery.organization = organization;
    }
    if (department) {
      employeeQuery.department = department;
    }
    if (subDepartment) {
      employeeQuery.subDepartment = subDepartment;
    }
    if (employeeId) {
      employeeQuery._id = employeeId;
    }
    if (search) {
      const searchRegex = new RegExp(escapeRegex(search), 'i');
      employeeQuery.$or = [{ name: searchRegex }, { employeeId: searchRegex }];
    }
    
    const total = await Employee.countDocuments(employeeQuery);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    // summary（整個篩選結果的人數與金額合計）：結果只有一頁時一定有（這一頁就是全部）；超過一頁時要帶 summary=true 才會算
    // （要把其他頁的人也算一遍，500 人約 2～3 秒），前端在換月份、篩選、搜尋時帶，只換頁時不帶、沿用上一次的合計
    const wantSummary = ['true', '1'].includes(String(summaryRaw ?? '').trim().toLowerCase());
    // 薪資政策整個請求只讀一次，所有員工共用
    const payrollPolicy = await loadPayrollPolicy();

    // 要算整個結果的合計、而且不只一頁：所有符合條件的員工都要算（分批讀資料，與匯出相同），再從中取出這一頁
    const computeAll = wantSummary && totalPages > 1;
    let employeeFind = Employee.find(employeeQuery)
      .populate('department')
      .populate('subDepartment')
      .select(`photo ${PAYROLL_EMPLOYEE_FIELDS}`)
      .sort({ name: 1, employeeId: 1, _id: 1 });
    if (!computeAll) employeeFind = employeeFind.skip((safePage - 1) * pageSize).limit(pageSize);
    const employees = await employeeFind;

    if (employees.length === 0) {
      return res.json({
        items: [],
        pagination: { total, page: safePage, pageSize, totalPages },
        summary: summarizeOverviewRows([], total),
      });
    }

    const rows = [];
    for (let offset = 0; offset < employees.length; offset += OVERVIEW_CHUNK_SIZE) {
      const chunk = employees.slice(offset, offset + OVERVIEW_CHUNK_SIZE);
      rows.push(...await buildOverviewRows(chunk, { month, monthDate, payrollPolicy }));
    }
    const overview = computeAll ? rows.slice((safePage - 1) * pageSize, safePage * pageSize) : rows;
    // 只有一頁時這一頁就是全部；超過一頁而且沒有要 summary 時回傳 null
    const summary = computeAll || totalPages === 1 ? summarizeOverviewRows(rows, total) : null;

    return res.json({
      items: overview,
      pagination: { total, page: safePage, pageSize, totalPages },
      summary,
    });
  } catch (err) {
    console.error('Failed to build monthly payroll overview', { error: err?.name ?? 'Error' });
    res.status(500).json({ error: 'Failed to build monthly payroll overview' });
  }
}

// 薪資總覽一次處理多少位員工（每一批各讀一次班表、打卡、薪資記錄與獎金申請）
const OVERVIEW_CHUNK_SIZE = 200;
const OVERVIEW_CONCURRENCY = 5;
// 薪資總覽上方統計與合計列用的金額欄位（client 的 SalaryManagementSetting MONEY_PROPS 與 summary.totals 相同）
export const OVERVIEW_SUMMARY_MONEY_FIELDS = [
  'baseSalary', 'leaveDeduction',
  'laborInsuranceFee', 'healthInsuranceFee', 'laborPensionSelf', 'employeeAdvance', 'debtGarnishment', 'otherDeductions',
  'lateEarlyDeduction', 'deductionShortfall', 'netPay',
  'overtimePay', 'nightShiftAllowance', 'recurringAllowance', 'performanceBonus', 'otherBonuses', 'totalBonus',
  'totalPayment',
];
// 薪資記錄裡的工時、請假、加班時數：舊的記錄（種子資料、手動建立）只有金額，這些欄位全是 0
const RECORD_HOUR_FIELDS = ['workDays', 'scheduledHours', 'actualWorkHours', 'hourlyRate', 'leaveHours', 'paidLeaveHours', 'unpaidLeaveHours', 'overtimeHours'];

/** 整個篩選結果的合計：headCount 是符合條件的人數，totals 是各金額欄位（各列先四捨五入成整數再加） */
export function summarizeOverviewRows(rows, headCount = rows.length) {
  const totals = Object.fromEntries(OVERVIEW_SUMMARY_MONEY_FIELDS.map((field) => [field, 0]));
  for (const row of rows) {
    for (const field of OVERVIEW_SUMMARY_MONEY_FIELDS) totals[field] += Math.round(Number(row[field]) || 0);
  }
  return {
    headCount,
    withPayrollRecord: rows.filter((row) => row.hasPayrollRecord).length,
    totals,
  };
}

/** 一批員工的總覽列（同一批共用一次讀好的班表、打卡、薪資記錄、獎金申請與國定假日資料） */
async function buildOverviewRows(employees, { month, monthDate, payrollPolicy }) {
  const employeeIds = employees.map(e => e._id.toString());

  // Find existing payroll records for this month
  const payrollRecords = await PayrollRecord.find({
    employee: { $in: employeeIds },
    month: monthDate
  }).lean();

  // Create a map of employee ID to payroll record
  const payrollMap = {};
  payrollRecords.forEach(record => {
    const recordEmployeeId = record.employee?._id ?? record.employee;
    if (recordEmployeeId) payrollMap[recordEmployeeId.toString()] = record;
  });

  // 獎金申請依「核准完成」的時間歸屬月份（台灣時間），不看送簽時間；這一批的員工一次查完，欄位定義也只載入一次
  const { approvalsByEmployee, bonusFieldsByForm, bonusRange } = await loadBonusApprovals(employees, monthDate);
  // 這一批員工共用的資料（班別設定、班表、打卡、勞保級距表）各讀一次；國定假日判斷資料也只讀一次（payrollBatch）
  const batchData = await loadPayrollBatchData(employees, month);
  const payrollBatch = { employees, payrollPolicy };

  return mapWithConcurrency(employees, OVERVIEW_CONCURRENCY, async (employee) => {
    const employeeIdStr = employee._id.toString();
    const storedRecord = payrollMap[employeeIdStr];
    // 計算方式與月薪資總覽 PDF、銀行匯款 Excel 相同（services/payrollBatchService.js），同一位員工同一個月才會是同樣的數字
    const {
      payroll,
      workData,
      recurringAllowance,
      recurringAllowanceBreakdown,
      baseSalary: baseSalaryValue,
      netPay: netPayValue,
      totalBonus: totalBonusValue,
      totalPayment: totalPaymentValue,
    } = await computeEmployeePayroll({
      employee,
      month,
      storedRecord,
      approvals: approvalsByEmployee.get(employeeIdStr) ?? [],
      bonusFieldsByForm,
      bonusRange,
      calculationContext: createCalculationContext(batchData, employee, payrollBatch),
      insuranceRates: batchData.insuranceRates,
    });
    const annualLeaveHours = readAnnualLeaveHours(employee.annualLeave);
    // 工時、請假、加班時數：沒有薪資記錄是即時計算的值；有薪資記錄時用記錄存下的值（與金額一致），
    // 舊的記錄沒有存時數（全是 0）就用現在的出勤資料（與薪資明細 complete-data 相同），不再整列顯示 0
    const recordHasHours = Boolean(storedRecord) && RECORD_HOUR_FIELDS.some((field) => Number(storedRecord[field]) > 0);
    const hoursSource = !storedRecord ? 'calculated' : (recordHasHours || !workData ? 'record' : 'attendance');
    const hours = hoursSource === 'attendance' ? workData : payroll;

    return {
      _id: employee._id,
      employeeId: employee.employeeId,
      name: employee.name,
      // 儲存的照片路徑（沒有照片時是空字串），薪資明細視窗（單一員工）的頭像用 _id + photo 向 GET /api/employees/:id/photo 取圖；總覽表格本身不放頭像
      photo: employee.photo || '',
      department: employee.department?.name || '',
      departmentId: employee.department?._id,
      subDepartment: employee.subDepartment?.name || '',
      subDepartmentId: employee.subDepartment?._id,
      organization: employee.organization || '',
      salaryType: employee.salaryType || '月薪',
      // 工時、請假、加班時數的來源：calculated（即時計算）、record（薪資記錄）、attendance（舊記錄沒有時數，用現在的出勤資料）
      hoursSource,
      // Work hours data
      workDays: hours?.workDays || 0,
      scheduledHours: hours?.scheduledHours || 0,
      actualWorkHours: hours?.actualWorkHours || 0,
      hourlyRate: hours?.hourlyRate || 0,
      // Leave data
      leaveHours: hours?.leaveHours || 0,
      paidLeaveHours: hours?.paidLeaveHours || 0,
      unpaidLeaveHours: hours?.unpaidLeaveHours || 0,
      leaveDeduction: payroll?.leaveDeduction || 0,
      // Overtime data
      overtimeHours: hours?.overtimeHours || 0,
      overtimePay: payroll?.overtimePay || 0,
      overtimeIssues: payroll?.overtimeIssues || [],
      // Night shift data
      nightShiftDays: payroll?.nightShiftDays || 0,
      nightShiftHours: payroll?.nightShiftHours || 0,
      nightShiftCalculationMethod: payroll?.nightShiftCalculationMethod || 'not_calculated',
      nightShiftBreakdown: payroll?.nightShiftBreakdown || [],
      nightShiftConfigurationIssues: payroll?.nightShiftConfigurationIssues || [],
      // Payroll data (calculated or from existing record)
      baseSalary: baseSalaryValue,
      // 本月在職期間（月中到職、離職的月薪按比例；整月不在職沒有本薪；method 是套用的比例算法），算不出工時資料時為 null。
      // 有薪資記錄而且記錄存了當時的在職期間時用記錄的（金額是照那個規則算的）
      employment: (storedRecord && payroll?.employment) || workData?.employment || null,
      laborInsuranceFee: payroll?.laborInsuranceFee || 0,
      healthInsuranceFee: payroll?.healthInsuranceFee || 0,
      laborPensionSelf: payroll?.laborPensionSelf || 0,
      employeeAdvance: payroll?.employeeAdvance || 0,
      debtGarnishment: payroll?.debtGarnishment || 0,
      otherDeductions: payroll?.otherDeductions || 0,
      // 遲到早退自動扣款（已包含在 otherDeductions 裡）；扣款超過本薪而沒扣到的金額（實領為 0 時才會大於 0）
      lateEarlyDeduction: payroll?.lateEarlyDeduction || 0,
      deductionShortfall: payroll?.deductionShortfall || 0,
      netPay: netPayValue,
      nightShiftAllowance: payroll?.nightShiftAllowance || 0,
      performanceBonus: payroll?.performanceBonus || 0,
      otherBonuses: payroll?.otherBonuses || 0,
      recurringAllowance,
      recurringAllowanceBreakdown,
      totalBonus: totalBonusValue,
      totalPayment: totalPaymentValue,
      insuranceLevel: payroll?.insuranceLevel,
      insuranceRate: payroll?.insuranceRate,
      // Annual leave data
      // 特休以小時儲存（readAnnualLeaveHours 讀不到時數欄位的舊資料會從天數欄位換算）；天數是 時數 / 8 的換算
      annualLeave: {
        totalDays: annualLeaveHours.totalHours / WORK_HOURS_CONFIG.HOURS_PER_DAY,
        totalHours: annualLeaveHours.totalHours,
        usedDays: annualLeaveHours.usedHours / WORK_HOURS_CONFIG.HOURS_PER_DAY,
        usedHours: annualLeaveHours.usedHours,
        remainingHours: annualLeaveHours.remainingHours,
        expiryDate: employee.annualLeave?.expiryDate || null,
        accumulatedLeave: employee.annualLeave?.accumulatedLeave || 0,
        notes: employee.annualLeave?.notes || ''
      },
      hasPayrollRecord: !!storedRecord,
      payrollRecordId: storedRecord?._id
    };
  });
}

/**
 * 獲取員工的工作時數資料
 */
export async function getEmployeeWorkHours(req, res) {
  try {
    const { employeeId, month } = req.params;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    const workHours = await calculateWorkHours(employeeId, month);
    res.json(workHours);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取員工的請假影響資料
 */
export async function getEmployeeLeaveImpact(req, res) {
  try {
    const { employeeId, month } = req.params;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    const leaveImpact = await calculateLeaveImpact(employeeId, month);
    res.json(leaveImpact);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取員工的加班資料
 */
export async function getEmployeeOvertimePay(req, res) {
  try {
    const { employeeId, month } = req.params;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    const overtimePay = await calculateOvertimePay(employeeId, month);
    res.json(overtimePay);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取員工的完整工作資料
 */
export async function getEmployeeCompleteWorkData(req, res) {
  try {
    const { employeeId, month } = req.params;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    const completeData = await calculateCompleteWorkData(employeeId, month);
    res.json(completeData);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
