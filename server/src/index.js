import express from 'express';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import employeeRoutes from './routes/employeeRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import authRoutes from './routes/authRoutes.js';
import { authenticate, authorizeRoles } from './middleware/auth.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.use('/api', authRoutes);
app.use('/api/employees', authenticate, authorizeRoles('admin', 'hr'), employeeRoutes);
app.use('/api/attendance', authenticate, authorizeRoles('employee', 'supervisor', 'hr', 'admin'), attendanceRoutes);

connectDB(process.env.MONGODB_URI || 'mongodb://localhost/hr');

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
