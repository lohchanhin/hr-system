import PayrollRecord from '../models/PayrollRecord.js';
import LaborInsuranceRate from '../models/LaborInsuranceRate.js';
import Employee from '../models/Employee.js';
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

/**
 * 獲取月薪資總覽（支援篩選機構、部門、單位、員工）
 */
export async function getMonthlyPayrollOverview(req, res) {
  try {
    const { month, organization, department, subDepartment, employeeId } = req.query;
    
    if (!month) {
      return res.status(400).json({ error: 'month parameter is required' });
    }
    
    // Validate month format (should be YYYY-MM-DD)
    const monthDate = new Date(month);
    if (isNaN(monthDate.getTime())) {
      return res.status(400).json({ error: 'Invalid month format. Expected YYYY-MM-DD' });
    }
    
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
    
    // Find employees matching the criteria
    const employees = await Employee.find(employeeQuery)
      .populate('department')
      .populate('subDepartment')
      .select('employeeId name department subDepartment organization salaryAmount salaryType');
    
    if (employees.length === 0) {
      return res.json([]);
    }
    
    const employeeIds = employees.map(e => e._id.toString());
    
    // Find existing payroll records for this month
    const payrollRecords = await PayrollRecord.find({
      employee: { $in: employeeIds },
      month: monthDate
    }).populate('employee');
    
    // Create a map of employee ID to payroll record
    const payrollMap = {};
    payrollRecords.forEach(record => {
      payrollMap[record.employee._id.toString()] = record;
    });
    
    // Build the overview data
    const overview = employees.map(employee => {
      const payroll = payrollMap[employee._id.toString()];
      
      return {
        _id: employee._id,
        employeeId: employee.employeeId,
        name: employee.name,
        department: employee.department?.name || '',
        departmentId: employee.department?._id,
        subDepartment: employee.subDepartment?.name || '',
        subDepartmentId: employee.subDepartment?._id,
        organization: employee.organization || '',
        salaryType: employee.salaryType || '月薪',
        // Payroll data (if exists)
        baseSalary: payroll?.baseSalary || employee.salaryAmount || 0,
        laborInsuranceFee: payroll?.laborInsuranceFee || 0,
        healthInsuranceFee: payroll?.healthInsuranceFee || 0,
        laborPensionSelf: payroll?.laborPensionSelf || 0,
        employeeAdvance: payroll?.employeeAdvance || 0,
        debtGarnishment: payroll?.debtGarnishment || 0,
        otherDeductions: payroll?.otherDeductions || 0,
        netPay: payroll?.netPay || (employee.salaryAmount || 0),
        nightShiftAllowance: payroll?.nightShiftAllowance || 0,
        performanceBonus: payroll?.performanceBonus || 0,
        otherBonuses: payroll?.otherBonuses || 0,
        totalBonus: payroll?.totalBonus || 0,
        hasPayrollRecord: !!payroll,
        payrollRecordId: payroll?._id
      };
    });
    
    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
