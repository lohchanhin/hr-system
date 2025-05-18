import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { connectDB } from './config/db.js';
import employeeRoutes from './routes/employeeRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { authenticate, authorizeRoles } from './middleware/auth.js';
import leaveRoutes from './routes/leaveRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';
import payrollRoutes from './routes/payrollRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import insuranceRoutes from './routes/insuranceRoutes.js';

dotenv.config();

const requiredEnv = ['PORT', 'MONGODB_URI'];
const missing = requiredEnv.filter((name) => !process.env[name]);
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const app = express();
const PORT = process.env.PORT;

app.use(express.json());
app.use(cors());

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});


app.use('/api', authRoutes);
app.use('/api/employees', authenticate, authorizeRoles('admin', 'hr'), employeeRoutes);
app.use('/api/attendance', authenticate, authorizeRoles('employee', 'supervisor', 'hr', 'admin'), attendanceRoutes);


app.use('/api/leaves', authenticate, authorizeRoles('employee', 'supervisor', 'hr', 'admin'), leaveRoutes);
app.use('/api/schedules', authenticate, authorizeRoles('supervisor', 'hr', 'admin'), scheduleRoutes);
app.use('/api/payroll', authenticate, authorizeRoles('hr', 'admin'), payrollRoutes);
app.use('/api/reports', authenticate, authorizeRoles('hr', 'admin'), reportRoutes);
app.use('/api/insurance', authenticate, authorizeRoles('hr', 'admin'), insuranceRoutes);


connectDB(process.env.MONGODB_URI);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
