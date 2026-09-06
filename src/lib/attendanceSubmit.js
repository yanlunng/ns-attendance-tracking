const db = require('../db');
const { isWorkingDay } = require('./workingDays');
const { activeRosterForDate } = require('./roster');

const OFF_PERIODS = ['AM', 'PM', 'TIME', 'FULL'];
const STATUSES = ['present', 'off', 'mc', 'outpro'];

const upsertStmt = db.prepare(`
  INSERT INTO attendance_submissions
    (date, roster_id, user_id, status, off_period, off_time, off_time_end, approval_status, remarks, submitted_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(date, roster_id, user_id) DO UPDATE SET
    status = excluded.status,
    off_period = excluded.off_period,
    off_time = excluded.off_time,
    off_time_end = excluded.off_time_end,
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
function submitOne({ date, rosterId, submitterId, submitterRole, submitterUsername, status, offPeriod, offTime, offTimeEnd, remarks }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return { ok: false, error: 'Invalid date.' };
  if (!isWorkingDay(date)) return { ok: false, error: 'Weekends do not require attendance and cannot be saved.' };
  if (!STATUSES.includes(status)) return { ok: false, error: 'Invalid status.' };
  if (status === 'outpro' && !['admin', 'editor'].includes(submitterRole)) {
    return { ok: false, error: 'Only admins and editors can mark 1st Day Outpro.' };
  }

  const person = activeRosterForDate(date).find((p) => p.id === rosterId);
  if (!person) return { ok: false, error: 'That person is not eligible to be marked for this date.' };

  const editScope = db.editScopeFor(submitterUsername);
  if (editScope && !editScope.includes(person.group_code)) {
    return { ok: false, error: 'You are not permitted to mark attendance for this person.' };
  }

  let normOffPeriod = null;
  let normOffTime = null;
  let normOffTimeEnd = null;
  if (status === 'off') {
    if (!OFF_PERIODS.includes(offPeriod)) return { ok: false, error: 'Off period (AM/PM/Time-off) is required.' };
    normOffPeriod = offPeriod;
    if (offPeriod === 'TIME') {
      normOffTime = (offTime || '').trim();
      normOffTimeEnd = (offTimeEnd || '').trim();
      if (!normOffTime || !normOffTimeEnd) return { ok: false, error: 'A start and end time are required for a custom time-off.' };
      if (normOffTimeEnd <= normOffTime) return { ok: false, error: 'The end time must be after the start time.' };
    }
  }

  const approvalStatus = status === 'off' || status === 'outpro' ? 'pending' : 'approved';
  const cleanRemarks = (remarks || '').trim() || null;

  upsertStmt.run(date, rosterId, submitterId, status, normOffPeriod, normOffTime, normOffTimeEnd, approvalStatus, cleanRemarks);
  return { ok: true, approvalStatus };
}

/**
 * Extends an already-attached MC certificate's coverage to additional
 * consecutive days for the same person + submitter, without re-uploading —
 * reuses whichever attachment_path is already on the anchor submission.
 * Only fills in days that don't already have their own attachment.
 */
function propagateMcAttachment({ attachmentPath, rosterId, userId, fromDate, throughDate }) {
  db.prepare(
    `UPDATE attendance_submissions
     SET attachment_path = ?
     WHERE roster_id = ? AND user_id = ? AND status = 'mc' AND attachment_path IS NULL
       AND date > ? AND date <= ?`
  ).run(attachmentPath, rosterId, userId, fromDate, throughDate);
}

module.exports = { submitOne, propagateMcAttachment, STATUSES, OFF_PERIODS };
