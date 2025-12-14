import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectDB } from '../src/config/db.js';
import Employee from '../src/models/Employee.js';
import ApprovalRequest from '../src/models/approval_request.js';
import FormTemplate from '../src/models/form_template.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI is not defined in the environment');
  process.exit(1);
}

async function verifyTestData() {
  await connectDB(process.env.MONGODB_URI);

  console.log('\n=== 驗證測試資料 ===\n');

  // 獲取所有員工和主管
  const allEmployees = await Employee.find({}).select('name role employeeId');
  console.log(`總人數: ${allEmployees.length} 人`);
  console.log(`  - 主管: ${allEmployees.filter(e => e.role === 'supervisor').length} 人`);
  console.log(`  - 員工: ${allEmployees.filter(e => e.role === 'employee').length} 人`);

  // 獲取請假和加班表單
  const leaveForm = await FormTemplate.findOne({ name: '請假' });
  const overtimeForm = await FormTemplate.findOne({ name: '加班申請' });
  const bonusForm = await FormTemplate.findOne({ name: '獎金申請' });

  if (!leaveForm || !overtimeForm) {
    console.error('\n錯誤: 請假或加班申請表單不存在');
    process.exit(1);
  }

  console.log(`\n表單ID:`);
  console.log(`  - 請假: ${leaveForm._id}`);
  console.log(`  - 加班申請: ${overtimeForm._id}`);
  if (bonusForm) {
    console.log(`  - 獎金申請: ${bonusForm._id}`);
  } else {
    console.log(`  - 獎金申請: 未設定（可選）`);
  }

  // 計算當月和上月的日期範圍
  const currentDate = new Date();
  const currentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
  const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  const lastMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);

  console.log(`\n檢查月份範圍:`);
  console.log(`  - 上月: ${lastMonth.toISOString().split('T')[0]}`);
  console.log(`  - 當月: ${currentMonth.toISOString().split('T')[0]}`);
  console.log(`  - 下月: ${nextMonth.toISOString().split('T')[0]}`);

  // 統計每個人的申請記錄
  const employeeStats = new Map();

  for (const employee of allEmployees) {
    const stats = {
      name: employee.name,
      role: employee.role,
      employeeId: employee.employeeId,
      currentMonth: { leave: 0, overtime: 0, bonus: 0 },
      lastMonth: { leave: 0, overtime: 0, bonus: 0 },
    };

    // 當月請假
    const currentLeave = await ApprovalRequest.countDocuments({
      applicant_employee: employee._id,
      form: leaveForm._id,
      status: 'approved',
      createdAt: { $gte: currentMonth, $lt: nextMonth },
    });
    stats.currentMonth.leave = currentLeave;

    // 上月請假
    const lastLeave = await ApprovalRequest.countDocuments({
      applicant_employee: employee._id,
      form: leaveForm._id,
      status: 'approved',
      createdAt: { $gte: lastMonth, $lt: currentMonth },
    });
    stats.lastMonth.leave = lastLeave;

    // 當月加班
    const currentOvertime = await ApprovalRequest.countDocuments({
      applicant_employee: employee._id,
      form: overtimeForm._id,
      status: 'approved',
      createdAt: { $gte: currentMonth, $lt: nextMonth },
    });
    stats.currentMonth.overtime = currentOvertime;

    // 上月加班
    const lastOvertime = await ApprovalRequest.countDocuments({
      applicant_employee: employee._id,
      form: overtimeForm._id,
      status: 'approved',
      createdAt: { $gte: lastMonth, $lt: currentMonth },
    });
    stats.lastMonth.overtime = lastOvertime;

    // 當月獎金
    if (bonusForm) {
      const currentBonus = await ApprovalRequest.countDocuments({
        applicant_employee: employee._id,
        form: bonusForm._id,
        status: 'approved',
        createdAt: { $gte: currentMonth, $lt: nextMonth },
      });
      stats.currentMonth.bonus = currentBonus;

      // 上月獎金
      const lastBonus = await ApprovalRequest.countDocuments({
        applicant_employee: employee._id,
        form: bonusForm._id,
        status: 'approved',
        createdAt: { $gte: lastMonth, $lt: currentMonth },
      });
      stats.lastMonth.bonus = lastBonus;
    }

    employeeStats.set(employee._id.toString(), stats);
  }

  // 輸出統計結果
  console.log('\n=== 每人申請記錄統計 ===\n');
  
  let allHaveRequired = true;
  let issueCount = 0;

  employeeStats.forEach((stats) => {
    const hasLastMonthLeave = stats.lastMonth.leave > 0;
    const hasLastMonthOvertime = stats.lastMonth.overtime > 0;
    const hasCurrentMonthLeave = stats.currentMonth.leave > 0;
    const hasCurrentMonthOvertime = stats.currentMonth.overtime > 0;

    const meetRequirement = hasLastMonthLeave && hasLastMonthOvertime && 
                           hasCurrentMonthLeave && hasCurrentMonthOvertime;

    const status = meetRequirement ? '✓' : '✗';
    
    console.log(`${status} ${stats.name} (${stats.role}, ${stats.employeeId})`);
    console.log(`  上月: 請假 ${stats.lastMonth.leave}, 加班 ${stats.lastMonth.overtime}, 獎金 ${stats.lastMonth.bonus} (可選)`);
    console.log(`  當月: 請假 ${stats.currentMonth.leave}, 加班 ${stats.currentMonth.overtime}, 獎金 ${stats.currentMonth.bonus} (可選)`);

    if (!meetRequirement) {
      allHaveRequired = false;
      issueCount++;
      console.log(`  ⚠️ 缺少必要的申請記錄（請假或加班）`);
    }
    console.log('');
  });

  // 總結
  console.log('=== 驗證結果 ===\n');
  if (allHaveRequired) {
    console.log('✅ 所有人都有2個月的請假和加班申請記錄（必要）');
    if (bonusForm) {
      console.log('✅ 所有人也有獎金申請記錄（額外）');
    }
  } else {
    console.log(`❌ 有 ${issueCount} 人缺少必要的申請記錄（請假或加班）`);
  }

  process.exit(allHaveRequired ? 0 : 1);
}

verifyTestData().catch((err) => {
  console.error('驗證過程發生錯誤:', err);
  process.exit(1);
});
