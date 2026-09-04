const db = require('../db');
const { isWorkingDay } = require('./workingDays');
const { activeRosterForDate } = require('./roster');

const OFF_PERIODS = ['AM', 'PM', 'TIME'];
const STATUSES = ['present', 'off', 'mc', 'outpro'];

const upsertStmt = db.prepare(`
  INSERT INTO attendance_submissions
    (date, roster_id, user_id, status, off_period, off_time, approval_status, remarks, submitted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(date, roster_id, user_id) DO UPDATE SET
    status = excluded.status,
    off_period = excluded.off_period,
    off_time = excluded.off_time,
    approval_status = excluded.approval_status,
    approved_by = NULL,
    approved_at = NULL,
    remarks = excluded.remarks,
    submitted_at = datetime('now')
`);

/**
 * Validates and saves one person's attendance status for a date, on behalf
 * of a submitter — the single source of truth for the rules, shared by the
 * web Mark Attendance form and the Telegram bot so both channels behave
 * identically. Returns { ok: true, approvalStatus } or { ok: false, error }.
 */
function submitOne({ date, rosterId, submitterId, submitterRole, status, offPeriod, offTime, remarks }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { ok: false, error: 'Invalid date.' };
  if (!isWorkingDay(date)) return { ok: false, error: 'Weekends do not require attendance and cannot be saved.' };
  if (!STATUSES.includes(status)) return { ok: false, error: 'Invalid status.' };
  if (status === 'outpro' && !['admin', 'editor'].includes(submitterRole)) {
    return { ok: false, error: 'Only admins and editors can mark 1st Day Outpro.' };
  }

  const eligible = activeRosterForDate(date).some((p) => p.id === rosterId);
  if (!eligible) return { ok: false, error: 'That person is not eligible to be marked for this date.' };

  let normOffPeriod = null;
  let normOffTime = null;
  if (status === 'off') {
    if (!OFF_PERIODS.includes(offPeriod)) return { ok: false, error: 'Off period (AM/PM/Time-off) is required.' };
    normOffPeriod = offPeriod;
    if (offPeriod === 'TIME') {
      normOffTime = (offTime || '').trim();
      if (!normOffTime) return { ok: false, error: 'A time is required for Time-off.' };
    }
  }

  const approvalStatus = status === 'off' || status === 'outpro' ? 'pending' : 'approved';
  const cleanRemarks = (remarks || '').trim() || null;

  upsertStmt.run(date, rosterId, submitterId, status, normOffPeriod, normOffTime, approvalStatus, cleanRemarks);
  return { ok: true, approvalStatus };
}

module.exports = { submitOne, STATUSES, OFF_PERIODS };
