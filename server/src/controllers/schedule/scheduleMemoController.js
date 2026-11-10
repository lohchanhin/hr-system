import ScheduleDayMemo from '../../models/ScheduleDayMemo.js';
import { canManageScheduleScope, normalizeScheduleMemoDate } from './scheduleShared.js';

export async function listScheduleDayMemos(req, res) {
  try {
    const month = String(req.query?.month || '').trim();
    const department = String(req.query?.department || '').trim();
    const subDepartment = String(req.query?.subDepartment || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !department) {
      return res.status(400).json({ error: '請選擇月份與部門' });
    }
    if (!await canManageScheduleScope(req, department, subDepartment)) {
      return res.status(403).json({ error: '您沒有這個部門／小單位的排班權限', code: 'FORBIDDEN' });
    }
    const start = new Date(`${month}-01T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    const rows = await ScheduleDayMemo.find({
      date: { $gte: start, $lt: end },
      department,
      subDepartment: subDepartment || null,
    }).sort({ date: 1 }).lean();
    return res.json((rows || []).map((row) => ({
      _id: row._id,
      date: new Date(row.date).toISOString().slice(0, 10),
      content: row.content || '',
      updatedAt: row.updatedAt,
    })));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
export async function upsertScheduleDayMemo(req, res) {
  try {
    const date = normalizeScheduleMemoDate(req.params.date);
    const department = String(req.body?.department || '').trim();
    const subDepartment = String(req.body?.subDepartment || '').trim();
    const content = String(req.body?.content || '').trim();
    if (!date || !department) return res.status(400).json({ error: '請選擇日期與部門' });
    if (content.length > 1000) return res.status(400).json({ error: '備忘錄最多 1000 個字' });
    if (!await canManageScheduleScope(req, department, subDepartment)) {
      return res.status(403).json({ error: '您沒有這個部門／小單位的排班權限', code: 'FORBIDDEN' });
    }
    const filter = { date, department, subDepartment: subDepartment || null };
    if (!content) {
      await ScheduleDayMemo.findOneAndDelete(filter);
      return res.json({ date: req.params.date, content: '', deleted: true });
    }
    const row = await ScheduleDayMemo.findOneAndUpdate(
      filter,
      { $set: { content, updatedBy: req.user.id } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return res.json({
      _id: row?._id,
      date: req.params.date,
      content: row?.content || content,
      updatedAt: row?.updatedAt,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
