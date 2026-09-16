import ShiftSchedule from '../../models/ShiftSchedule.js';
import { assertScheduleRuleCompliance } from '../../services/laborRuleValidationService.js';
import {
  buildMonthRange,
  resolveScopedEmployeeIds,
  normalizeId,
  respondLaborRuleError,
  buildPublishQuery,
  summarizeEmployees,
  normalizeResponsePayload,
  sanitizeNote,
  createError,
  isTransactionNotSupportedError,
  applyEmployeeResponse,
} from './scheduleShared.js';

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

    const query = buildPublishQuery(range, { department, subDepartment });
    if (Array.isArray(scopedIds)) {
      if (!scopedIds.length) {
        return res.status(404).json({ error: 'no employees in scope' });
      }
      query.employee = { $in: scopedIds };
    }

    const docs = await ShiftSchedule.find(query).populate('employee').lean();
    if (!docs.length) {
      return res.status(404).json({ error: 'no schedules found' });
    }

    await assertScheduleRuleCompliance({
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

    res.json({
      updated: ids.length,
      employees,
      publishedAt: now.toISOString(),
      publishedMonth: month,
    });
  } catch (err) {
    if (respondLaborRuleError(res, err)) return;
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
      ...buildPublishQuery(range, { department, subDepartment }),
      state: { $in: ['pending_confirmation', 'changes_requested'] },
    };
    if (Array.isArray(scopedIds)) {
      if (!scopedIds.length) {
        return res.status(404).json({ error: 'no employees in scope' });
      }
      query.employee = { $in: scopedIds };
    }

    const docs = await ShiftSchedule.find(query).populate('employee').lean();
    if (!docs.length) {
      return res.status(404).json({ error: 'no schedules found' });
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
        error: 'unconfirmed employees',
        pendingEmployees: Array.from(pendingMap.values()),
        disputedEmployees: Array.from(disputedMap.values()),
      });
    }

    const pendingDocs = docs.filter((doc) => doc.state === 'pending_confirmation');
    if (!pendingDocs.length) {
      return res.status(400).json({ error: 'no pending schedules to finalize' });
    }

    await assertScheduleRuleCompliance({
      candidateSchedules: pendingDocs.map((doc) => ({
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

    const ids = pendingDocs.map((doc) => doc._id);
    await ShiftSchedule.updateMany({ _id: { $in: ids } }, {
      $set: { state: 'finalized', needsReconfirm: false },
    });

    res.json({ finalized: ids.length });
  } catch (err) {
    if (respondLaborRuleError(res, err)) return;
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
      return res.status(400).json({ error: 'scheduleIds required' });
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
      throw createError('scheduleIds required');
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
