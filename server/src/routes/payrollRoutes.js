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
  getLaborInsuranceRates,
  initializeLaborInsuranceRatesController,
  refreshLaborInsuranceRatesController,
  getMonthlyPayrollOverview,
  getEmployeeWorkHours,
  getEmployeeLeaveImpact,
  getEmployeeOvertimePay,
  getEmployeeCompleteWorkData
} from '../controllers/payrollController.js';

const router = Router();

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

// Labor insurance rates
router.get('/insurance/rates', getLaborInsuranceRates);
router.post('/insurance/initialize', initializeLaborInsuranceRatesController);
router.post('/insurance/refresh', refreshLaborInsuranceRatesController);

// Monthly payroll overview
router.get('/overview/monthly', getMonthlyPayrollOverview);

export default router;
