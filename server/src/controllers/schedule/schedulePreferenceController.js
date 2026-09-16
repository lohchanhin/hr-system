import Employee from '../../models/Employee.js';

export async function getIncludeSelfPreference(req, res) {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId || role !== 'supervisor') {
      return res.status(403).json({ error: 'forbidden' });
    }
    const profile = await Employee.findById(userId)
      .select('schedulePreferences.includeSelf')
      .lean();
    return res.json({
      includeSelf: Boolean(profile?.schedulePreferences?.includeSelf),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

export async function updateIncludeSelfPreference(req, res) {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId || role !== 'supervisor') {
      return res.status(403).json({ error: 'forbidden' });
    }

    const includeSelf = Boolean(req.body?.includeSelf);
    const updated = await Employee.findByIdAndUpdate(
      userId,
      { $set: { 'schedulePreferences.includeSelf': includeSelf } },
      {
        new: true,
        upsert: false,
        projection: { schedulePreferences: 1 }
      }
    ).lean();

    return res.json({
      includeSelf: Boolean(updated?.schedulePreferences?.includeSelf),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
