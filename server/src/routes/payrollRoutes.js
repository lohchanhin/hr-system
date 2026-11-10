import { Router } from 'express';
import {
  listPayrolls,
  createPayroll,
  getPayroll,
  updatePayroll,
  deletePayroll,
  calculatePayroll,
  calculateBatchPayrolls,
  calculateAndSavePayroll,
  getEmployeePayrolls,
  exportPayrollExcel,
  exportIndividualPayrollExcel,
  exportMonthlyPayrollOverviewPdf,
  getLaborInsuranceRates,
  initializeLaborInsuranceRatesController,
  refreshLaborInsuranceRatesController,
  getMonthlyPayrollOverview,
  getEmployeeWorkHours,
  getEmployeeLeaveImpact,
  getEmployeeOvertimePay,
  getEmployeeCompleteWorkData,
  getPayrollPolicySettings,
  updatePayrollPolicySettings
} from '../controllers/payrollController.js';

const router = Router();

// 薪資政策（月中到職／離職的比例、加班費倍率、新進員工自動計算加班費）：固定路徑，必須在 '/:id' 之前
router.get('/policy', getPayrollPolicySettings);
router.put('/policy', updatePayrollPolicySettings);

// Basic CRUD
router.get('/', listPayrolls);
router.post('/', createPayroll);
router.get('/:id', getPayroll);
router.put('/:id', updatePayroll);
router.delete('/:id', deletePayroll);

// Payroll calculation
router.post('/calculate', calculatePayroll);
router.post('/calculate/batch', calculateBatchPayrolls);
router.post('/calculate/save', calculateAndSavePayroll);

// Employee payrolls
router.get('/employee/:employeeId', getEmployeePayrolls);

// Work hours and leave impact
router.get('/work-hours/:employeeId/:month', getEmployeeWorkHours);
router.get('/leave-impact/:employeeId/:month', getEmployeeLeaveImpact);
router.get('/overtime/:employeeId/:month', getEmployeeOvertimePay);
router.get('/complete-data/:employeeId/:month', getEmployeeCompleteWorkData);

// Excel export
router.post('/export', exportPayrollExcel);
router.get('/export/individual', exportIndividualPayrollExcel);

// PDF export
router.get('/export/pdf', exportMonthlyPayrollOverviewPdf);

// Labor insurance rates
router.get('/insurance/rates', getLaborInsuranceRates);
router.post('/insurance/initialize', initializeLaborInsuranceRatesController);
router.post('/insurance/refresh', refreshLaborInsuranceRatesController);

// Monthly payroll overview
router.get('/overview/monthly', getMonthlyPayrollOverview);

export default router;
