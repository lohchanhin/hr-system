import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { connectDB } from './config/db.js';
import employeeRoutes from './routes/employeeRoutes.js';
import attendanceRoutes from './routes/attendanceRoutes.js';
import leaveRoutes from './routes/leaveRoutes.js';
import scheduleRoutes from './routes/scheduleRoutes.js';

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

app.use('/api/employees', employeeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/leaves', leaveRoutes);
app.use('/api/schedules', scheduleRoutes);

connectDB(process.env.MONGODB_URI);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
