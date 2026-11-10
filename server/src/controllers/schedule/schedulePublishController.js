import ShiftSchedule from '../../models/ShiftSchedule.js';
import {
  assertScheduleRuleCompliance,
  isLaborRuleValidationError,
} from '../../services/laborRuleValidationService.js';
import {
  buildMonthRange,
  resolveScopedEmployeeIds,
  normalizeId,
  toEntityId,
  describePendingWeeks,
  buildPublishQuery,
  applyPublishUnitFilter,
  summarizeEmployees,
  normalizeResponsePayload,
  sanitizeNote,
  createError,
  isTransactionNotSupportedError,
  applyEmployeeResponse,
} from './scheduleShared.js';

// 發布、完成發布只用到員工的姓名、代號與照片路徑：整個月幾千筆班表不必每一筆都帶整份員工資料
const PUBLISH_EMPLOYEE_SELECT = 'name employeeId photo';

/**
 * 發布、完成發布的排班規範檢核：只提醒、不擋（客戶：「可以顯示規範，可是不要阻止發布」；匯入照舊檢核）。
 * 違規整理成與預檢（/api/schedules/rules/validate）同一種形狀，再附上員工代號與姓名
 * （取自已 populate 的班表員工；畫面只載入一頁員工，不在那一頁的員工也看得到是誰）。
 * 不是排班規範的錯誤（例如讀取資料失敗）照樣丟出，由呼叫端回 400、不改任何班表，和原本一樣。
 */
async function checkScheduleRulesWithoutBlocking(docs, range) {
  try {
    const result = await assertScheduleRuleCompliance({
      candidateSchedules: docs.map((doc) => ({
        _id: doc._id,
        employee: doc.employee?._id || doc.employee,
        date: doc.date,
        shiftId: doc.shiftId,
        department: doc.department,
        subDepartment: doc.subDepartment,
      })),
      range,
      strictWeeklyRest: true,
    });
    return { violations: [], pendingWeeks: await describePendingWeeks(result?.pendingWeeks) };
  } catch (err) {
    if (!isLaborRuleValidationError(err)) throw err;
    const employeesById = new Map();
    docs.forEach((doc) => {
      const id = toEntityId(doc.employee);
      if (id && (doc.employee?.employeeId || doc.employee?.name)) employeesById.set(id, doc.employee);
    });
    const violations = (err.violations || []).map((violation) => {
      const employee = toEntityId(violation.employee);
      const known = employeesById.get(employee);
      return {
        ...violation,
        rule: violation.rule || violation.code || 'SCHEDULE_RULE',
        employee,
        date: violation.date || violation.startDate || violation.weekStart || null,
        message: violation.message || err.message,
        ...(known ? { employeeCode: known.employeeId || '', employeeName: known.name || '' } : {}),
      };
    });
    return { violations, pendingWeeks: await describePendingWeeks(err.pendingWeeks) };
  }
}

// 這個範圍裡員工已經確認、還沒完成發布的班表筆數（重新發布時不動它們）；算不出來（單元測試的替身）當成 0
async function countConfirmedOpenRows(query) {
  if (typeof ShiftSchedule.countDocuments !== 'function') return 0;
  try {
    const count = await ShiftSchedule.countDocuments({ ...query, state: 'pending_confirmation', employeeResponse: 'confirmed' });
    return Number.isFinite(count) && count > 0 ? count : 0;
  } catch {
    return 0;
  }
}

// violations／pendingWeeks 只在有的時候才附上，沒有的時候回應內容維持原本的樣子
function withRuleFindings(body, { violations, pendingWeeks }) {
  return {
    ...body,
    ...(violations.length ? { violations } : {}),
    ...(pendingWeeks.length ? { pendingWeeks } : {}),
  };
}

export async function publishSchedules(req, res) {
  try {
    const { month, department, subDepartment, includeSelf } = req.body || {};
    let range;
    try {
      range = buildMonthRange(month);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let scopedIds;
    try {
      scopedIds = await resolveScopedEmployeeIds(req.user, { includeSelf });
    } catch (err) {
      return res.status(401).json({ error: err.message || 'unauthorized' });
    }

    const query = buildPublishQuery(range, {});
    if (Array.isArray(scopedIds)) {
      if (!scopedIds.length) {
        return res.status(404).json({ error: '您的排班範圍內沒有員工', code: 'NO_EMPLOYEES_IN_SCOPE' });
      }
      query.employee = { $in: scopedIds };
    }
    // 部門、小單位：班表上存的單位，加上現在屬於這個單位的員工（月中調單位的人，舊單位排的那幾天也一起發布）
    await applyPublishUnitFilter(query, { department, subDepartment });
    // 員工已經確認、之後沒有異動的班表不重送：只送新增或異動過的（草稿）、有異議的與還沒回覆的。
    // 以前整個範圍還沒完成發布的班表全部重設成待確認，改一天再發布，員工已確認的十幾天都要重新確認一次
    const confirmedQuery = { ...query };
    query.employeeResponse = { $ne: 'confirmed' };

    const docs = await ShiftSchedule.find(query).populate('employee', PUBLISH_EMPLOYEE_SELECT).lean();
    if (!docs.length) {
      if (await countConfirmedOpenRows(confirmedQuery)) {
        return res.status(409).json({
          error: '這個範圍的班表員工都已確認，沒有新增或異動的班表需要發送；可以直接完成發布',
          code: 'NOTHING_TO_PUBLISH',
        });
      }
      return res.status(404).json({ error: '這個範圍沒有可以發送的班表', code: 'NO_SCHEDULES' });
    }

    // 排班規範的違規不擋發布：照樣發送給員工確認，違規隨回應回報讓畫面提醒
    const ruleFindings = await checkScheduleRulesWithoutBlocking(docs, range);

    const now = new Date();
    const ids = docs.map((doc) => doc._id);
    await ShiftSchedule.updateMany({ _id: { $in: ids } }, {
      $set: {
        state: 'pending_confirmation',
        publishedAt: now,
        employeeResponse: 'pending',
        responseNote: '',
        responseAt: null,
      },
    });

    const employees = summarizeEmployees(docs).map((entry) => ({
      ...entry,
      response: 'pending',
      state: 'pending_confirmation',
    }));

    // keptConfirmed：員工已確認、這次沒有重送的筆數（有的時候才附上）
    const keptConfirmed = await countConfirmedOpenRows(confirmedQuery);
    // 排班規範違規、跨月週（鄰月還沒排）目前無法判斷的週別都不擋發布，只回報讓畫面提醒；沒有的時候回應內容不變
    res.json(withRuleFindings({
      updated: ids.length,
      employees,
      publishedAt: now.toISOString(),
      publishedMonth: month,
      ...(keptConfirmed ? { keptConfirmed } : {}),
    }, ruleFindings));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function finalizeSchedules(req, res) {
  try {
    const { month, department, subDepartment, includeSelf } = req.body || {};
    let range;
    try {
      range = buildMonthRange(month);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let scopedIds;
    try {
      scopedIds = await resolveScopedEmployeeIds(req.user, { includeSelf });
    } catch (err) {
      return res.status(401).json({ error: err.message || 'unauthorized' });
    }

    const query = {
      ...buildPublishQuery(range, {}),
      state: { $in: ['pending_confirmation', 'changes_requested'] },
    };
    if (Array.isArray(scopedIds)) {
      if (!scopedIds.length) {
        return res.status(404).json({ error: '您的排班範圍內沒有員工', code: 'NO_EMPLOYEES_IN_SCOPE' });
      }
      query.employee = { $in: scopedIds };
    }
    await applyPublishUnitFilter(query, { department, subDepartment });

    const docs = await ShiftSchedule.find(query).populate('employee', PUBLISH_EMPLOYEE_SELECT).lean();
    if (!docs.length) {
      return res.status(404).json({ error: '這個範圍沒有待完成發布的班表（請先發送給員工確認）', code: 'NO_SCHEDULES' });
    }

    const pendingMap = new Map();
    const disputedMap = new Map();
    const register = (collection, doc) => {
      const emp = doc.employee || {};
      const id = emp?._id?.toString?.() || doc.employee?.toString?.();
      if (!id) return;
      if (!collection.has(id)) {
        collection.set(id, {
          id,
          name: emp.name || '',
          photo: emp.photo || '',
          response: doc.employeeResponse,
          latestNote: doc.responseNote || '',
          schedules: [],
        });
      }
      const entry = collection.get(id);
      entry.schedules.push({
        scheduleId: doc._id?.toString?.() || String(doc._id),
        date: doc.date instanceof Date ? doc.date.toISOString() : new Date(doc.date).toISOString(),
        state: doc.state,
        response: doc.employeeResponse,
        note: doc.responseNote || '',
      });
    };

    docs.forEach((doc) => {
      if (doc.employeeResponse === 'confirmed') return;
      if (doc.employeeResponse === 'disputed' || doc.state === 'changes_requested') {
        register(disputedMap, doc);
      } else {
        register(pendingMap, doc);
      }
    });

    if (pendingMap.size || disputedMap.size) {
      return res.status(409).json({
        error: '仍有員工尚未確認或提出異議，無法完成發布',
        code: 'UNCONFIRMED_EMPLOYEES',
        pendingEmployees: Array.from(pendingMap.values()),
        disputedEmployees: Array.from(disputedMap.values()),
      });
    }

    const pendingDocs = docs.filter((doc) => doc.state === 'pending_confirmation');
    if (!pendingDocs.length) {
      return res.status(400).json({ error: '沒有待完成發布的班表', code: 'NOTHING_TO_FINALIZE' });
    }

    // 完成發布同樣不被排班規範的違規擋住（員工未確認、沒有待完成的班表等資料問題仍照上面擋下）
    const ruleFindings = await checkScheduleRulesWithoutBlocking(pendingDocs, range);

    const ids = pendingDocs.map((doc) => doc._id);
    await ShiftSchedule.updateMany({ _id: { $in: ids } }, {
      $set: { state: 'finalized', needsReconfirm: false },
    });

    res.json(withRuleFindings({ finalized: ids.length }, ruleFindings));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function respondToSchedule(req, res) {
  try {
    const { id } = req.params;
    const { response, note } = req.body || {};
    const schedule = await ShiftSchedule.findById(id).populate('employee');
    if (!schedule) return res.status(404).json({ error: 'Not found' });

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const employeeId = schedule.employee?._id?.toString?.() || schedule.employee?.toString?.();
    if (!employeeId || employeeId !== String(userId)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const normalized = normalizeResponsePayload(response);
    const noteValue = sanitizeNote(note);
    const now = new Date();

    try {
      applyEmployeeResponse(schedule, normalized, noteValue, now);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }

    const saved = await schedule.save();
    await saved.populate('employee');
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export async function respondToSchedulesBulk(req, res) {
  let session = null;
  let usingTransaction = false;

  const safelyAbortAndEnd = async () => {
    if (!session) return;
    if (usingTransaction && typeof session.abortTransaction === 'function') {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // ignore abort errors to avoid masking original error
      }
    }
    if (typeof session.endSession === 'function') {
      try {
        await session.endSession();
      } catch (endErr) {
        // swallow end session errors as fallback will continue without a session
      }
    }
    session = null;
    usingTransaction = false;
  };

  const loadAndSaveSchedules = async (ids, userId, normalized, noteValue, options = {}) => {
    const { session: activeSession = null, transactional = false } = options;
    const now = new Date();
    const updatedDocs = [];
    // 先把每一筆都讀出來、檢查過（是不是自己的、能不能回覆），全部沒問題才開始存。
    // 單機 MongoDB 沒有交易：以前邊檢查邊存，其中一筆不能回覆（例如已經完成發布）時回 400，
    // 排在它前面的幾筆卻已經存成「已確認」，畫面顯示失敗、實際上確認了一部分
    const prepared = [];

    for (const scheduleId of ids) {
      let query = ShiftSchedule.findById(scheduleId);
      if (!query) {
        throw createError('schedule not found', 404);
      }
      if (activeSession && typeof query.session === 'function') {
        query = query.session(activeSession);
      }

      let schedule;
      if (query && typeof query.populate === 'function') {
        const populated = query.populate('employee');
        if (populated && typeof populated.then === 'function') {
          schedule = await populated;
        } else if (typeof populated.exec === 'function') {
          schedule = await populated.exec();
        } else {
          schedule = await query;
        }
      } else if (query && typeof query.then === 'function') {
        schedule = await query;
      } else {
        schedule = query;
      }

      if (!schedule) {
        throw createError('schedule not found', 404);
      }

      if (transactional && activeSession && typeof schedule.$session === 'function') {
        schedule.$session(activeSession);
      }

      const employeeId = schedule.employee?._id?.toString?.() || schedule.employee?.toString?.();
      if (!employeeId || employeeId !== String(userId)) {
        throw createError('forbidden', 403);
      }

      applyEmployeeResponse(schedule, normalized, noteValue, now);
      prepared.push(schedule);
    }

    for (const schedule of prepared) {
      const saveOptions = transactional && activeSession ? { session: activeSession } : undefined;
      const saved = await schedule.save(saveOptions);
      if (typeof saved.populate === 'function') {
        await saved.populate('employee');
      }
      updatedDocs.push(saved);
    }

    return updatedDocs;
  };

  try {
    const { scheduleIds, response, note } = req.body || {};
    if (!Array.isArray(scheduleIds) || !scheduleIds.length) {
      return res.status(400).json({ error: '請選擇要回覆的班表', code: 'SCHEDULE_IDS_REQUIRED' });
    }
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'unauthorized' });

    const normalized = normalizeResponsePayload(response);
    const noteValue = sanitizeNote(note);

    if (typeof ShiftSchedule.startSession === 'function') {
      session = await ShiftSchedule.startSession();
    }
    if (session) {
      const supportsTransactions =
        typeof session.startTransaction === 'function' &&
        typeof session.commitTransaction === 'function' &&
        typeof session.abortTransaction === 'function';

      if (supportsTransactions) {
        try {
          await session.startTransaction();
          usingTransaction = true;
        } catch (startErr) {
          if (isTransactionNotSupportedError(startErr)) {
            await safelyAbortAndEnd();
          } else {
            throw startErr;
          }
        }
      } else {
        await safelyAbortAndEnd();
      }
    }

    const uniqueIds = Array.from(
      new Set(
        scheduleIds
          .map((value) => normalizeId(value))
          .filter((value) => !!value),
      ),
    );

    if (!uniqueIds.length) {
      throw createError('請選擇要回覆的班表');
    }

    let updated = [];
    const executeOnce = async (activeSession, transactional) =>
      loadAndSaveSchedules(uniqueIds, userId, normalized, noteValue, {
        session: activeSession,
        transactional,
      });

    try {
      updated = await executeOnce(session, usingTransaction);
    } catch (processErr) {
      if (usingTransaction && isTransactionNotSupportedError(processErr)) {
        await safelyAbortAndEnd();
        updated = await executeOnce(null, false);
      } else {
        throw processErr;
      }
    }

    if (usingTransaction && session && typeof session.commitTransaction === 'function') {
      try {
        await session.commitTransaction();
      } catch (commitErr) {
        if (isTransactionNotSupportedError(commitErr)) {
          await safelyAbortAndEnd();
          updated = await executeOnce(null, false);
        } else {
          throw commitErr;
        }
      }
    }

    const payload = updated.map((item) => (
      typeof item.toObject === 'function' ? item.toObject() : item
    ));
    return res.json({ success: true, count: payload.length, schedules: payload });
  } catch (err) {
    if (usingTransaction && session && typeof session.abortTransaction === 'function') {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // ignore abort errors to avoid masking original error
      }
    }
    return res.status(err.status || 400).json({ error: err.message });
  } finally {
    if (session && typeof session.endSession === 'function') await session.endSession();
  }
}
