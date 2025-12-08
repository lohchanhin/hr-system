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
  getLaborInsuranceRates,
  initializeLaborInsuranceRatesController,
  getMonthlyPayrollOverview
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

// Excel export
router.post('/export', exportPayrollExcel);

// Labor insurance rates
router.get('/insurance/rates', getLaborInsuranceRates);
router.post('/insurance/initialize', initializeLaborInsuranceRatesController);

// Monthly payroll overview
router.get('/overview/monthly', getMonthlyPayrollOverview);

export default router;
