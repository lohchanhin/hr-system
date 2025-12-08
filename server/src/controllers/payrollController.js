import PayrollRecord from '../models/PayrollRecord.js';
import LaborInsuranceRate from '../models/LaborInsuranceRate.js';
import { 
  calculateEmployeePayroll, 
  calculateBatchPayroll, 
  savePayrollRecord,
  getEmployeePayrollRecords 
} from '../services/payrollService.js';
import { initializeLaborInsuranceRates } from '../services/laborInsuranceService.js';
import { generatePayrollExcel } from '../services/payrollExportService.js';

export async function listPayrolls(req, res) {
  try {
    const { month, employeeId } = req.query;
    const query = {};
    
    if (month) {
      query.month = new Date(month);
    }
    if (employeeId) {
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
    const { employeeId, month } = req.body;
    const customData = req.body.customData || {};
    
    if (!employeeId || !month) {
      return res.status(400).json({ error: 'employeeId and month are required' });
    }
    
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
    const { employees, month, customDataMap } = req.body;
    
    if (!employees || !Array.isArray(employees) || !month) {
      return res.status(400).json({ error: 'employees (array) and month are required' });
    }
    
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
    const { employeeId, month } = req.body;
    const customData = req.body.customData || {};
    
    if (!employeeId || !month) {
      return res.status(400).json({ error: 'employeeId and month are required' });
    }
    
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
 * 導出薪資 Excel (台灣企銀或台中銀格式)
 */
export async function exportPayrollExcel(req, res) {
  try {
    const { month, bankType } = req.query;
    const companyInfo = req.body;
    
    if (!month) {
      return res.status(400).json({ error: 'month is required' });
    }
    
    if (!bankType || !['taiwan', 'taichung'].includes(bankType)) {
      return res.status(400).json({ error: 'bankType must be "taiwan" or "taichung"' });
    }
    
    const buffer = await generatePayrollExcel(month, bankType, companyInfo);
    
    const filename = `payroll_${month}_${bankType}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

/**
 * 獲取勞保費率表
 */
export async function getLaborInsuranceRates(req, res) {
  try {
    const rates = await LaborInsuranceRate.find().sort({ level: 1 });
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
