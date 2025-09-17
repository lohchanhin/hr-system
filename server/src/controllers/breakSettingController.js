import BreakSetting from '../models/BreakSetting.js';

function readScope(req, sources = ['query']) {
  const scope = {};

  for (const source of sources) {
    const data =
      source === 'query'
        ? req.query
        : source === 'params'
          ? req.params
          : req.body || {};

    if (!scope.department) {
      scope.department =
        data.department || data.departmentId || data.deptId || data.dept || null;
    }

    if (!scope.subDepartment) {
      scope.subDepartment =
        data.subDepartment ||
        data.subDepartmentId ||
        data.subDeptId ||
        data.subDept ||
        null;
    }
  }

  const filter = {};
  if (scope.department) filter.department = scope.department;
  if (scope.subDepartment) filter.subDepartment = scope.subDepartment;
  return filter;
}

function ensureScope(filter, { required = true } = {}) {
  const hasDepartment = Boolean(filter.department);
  const hasSubDepartment = Boolean(filter.subDepartment);

  if (hasDepartment && hasSubDepartment) {
    throw new Error('僅能指定部門或小單位其中之一');
  }

  if (required && !hasDepartment && !hasSubDepartment) {
    throw new Error('必須提供部門或小單位識別碼');
  }

  return filter;
}

export async function listSettings(req, res) {
  try {
    const scope = ensureScope(readScope(req));
    const settings = await BreakSetting.find(scope);
    res.json(settings);
  } catch (err) {
    const status = err.message.includes('識別碼') || err.message.includes('之一') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
}

export async function getSettingForDepartment(req, res) {
  try {
    const scope = ensureScope(readScope(req, ['params']));
    const setting = await BreakSetting.findOne(scope);
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getSettingForSubDepartment(req, res) {
  try {
    const scope = ensureScope(readScope(req, ['params']));
    const setting = await BreakSetting.findOne(scope);
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function createSetting(req, res) {
  try {
    const scope = ensureScope(readScope(req, ['body']));
    const existing = await BreakSetting.findOne(scope);
    if (existing) {
      return res.status(409).json({ error: '該單位已存在休息設定' });
    }

    const { _id, ...rest } = req.body || {};
    const setting = new BreakSetting({ ...rest, ...scope });
    await setting.save();
    res.status(201).json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function getSetting(req, res) {
  try {
    const scope = ensureScope(readScope(req), { required: false });
    const setting = await BreakSetting.findOne({ _id: req.params.id, ...scope });
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function updateSetting(req, res) {
  try {
    const scope = ensureScope(readScope(req, ['body', 'query']));
    const { _id, ...rest } = req.body || {};
    const setting = await BreakSetting.findOneAndUpdate(
      { _id: req.params.id, ...scope },
      { ...rest, ...scope },
      { new: true, runValidators: true }
    );
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json(setting);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function deleteSetting(req, res) {
  try {
    const scope = ensureScope(readScope(req, ['query', 'body']));
    const setting = await BreakSetting.findOneAndDelete({ _id: req.params.id, ...scope });
    if (!setting) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}
