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
    approval_status = CASE
      WHEN status IS excluded.status AND off_period IS excluded.off_period
        AND off_time IS excluded.off_time AND off_time_end IS excluded.off_time_end
      THEN approval_status ELSE excluded.approval_status
    END,
    approved_by = CASE
      WHEN status IS excluded.status AND off_period IS excluded.off_period
        AND off_time IS excluded.off_time AND off_time_end IS excluded.off_time_end
      THEN approved_by ELSE NULL
    END,
    approved_at = CASE
      WHEN status IS excluded.status AND off_period IS excluded.off_period
        AND off_time IS excluded.off_time AND off_time_end IS excluded.off_time_end
      THEN approved_at ELSE NULL
    END,
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

  // Resubmitting the exact same status/off-details preserves whatever
  // approval_status was already there instead of resetting it — read back
  // the actual stored value so callers (e.g. the Telegram confirmation
  // message) don't report "pending" for something that stayed approved.
  const stored = db
    .prepare('SELECT approval_status FROM attendance_submissions WHERE date = ? AND roster_id = ? AND user_id = ?')
    .get(date, rosterId, submitterId);
  return { ok: true, approvalStatus: stored.approval_status };
}

/**
 * Extends an already-attached MC certificate's coverage to additional
 * consecutive days for the same person + submitter, without re-uploading —
 * reuses whichever attachment_path is already on the anchor submission.
 * Fills in the attachment for days already marked MC without one of their
 * own, and — since a certificate covering a date range means the person
 * genuinely is on MC for every one of those days, not just "has a file for
 * whichever days someone happened to separately mark" — also creates a new
 * MC entry (with this same attachment) for any working day in the range
 * that has no submission from this submitter yet, or that only has the
 * default "present" (i.e. nobody had actually reported anything for that
 * day yet — a routine bulk-submit default, not a deliberate status). Never
 * touches a day that already has a deliberate status recorded (off, outpro,
 * or a differently-attached mc), working or not.
 */
function propagateMcAttachment({ attachmentPath, rosterId, userId, fromDate, throughDate }) {
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE attendance_submissions
       SET attachment_path = ?
       WHERE roster_id = ? AND user_id = ? AND status = 'mc' AND attachment_path IS NULL
         AND date > ? AND date <= ?`
    ).run(attachmentPath, rosterId, userId, fromDate, throughDate);

    const existingStmt = db.prepare('SELECT status FROM attendance_submissions WHERE date = ? AND roster_id = ? AND user_id = ?');
    const insert = db.prepare(
      `INSERT INTO attendance_submissions (date, roster_id, user_id, status, approval_status, attachment_path, submitted_at)
       VALUES (?, ?, ?, 'mc', 'approved', ?, datetime('now'))`
    );
    const upgradePresent = db.prepare(
      `UPDATE attendance_submissions
       SET status = 'mc', approval_status = 'approved', attachment_path = ?, submitted_at = datetime('now')
       WHERE date = ? AND roster_id = ? AND user_id = ? AND status = 'present'`
    );

    const cursor = new Date(`${fromDate}T00:00:00Z`);
    const end = new Date(`${throughDate}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    while (cursor <= end) {
      const date = cursor.toISOString().slice(0, 10);
      if (isWorkingDay(date) && activeRosterForDate(date).some((p) => p.id === rosterId)) {
        const existing = existingStmt.get(date, rosterId, userId);
        if (!existing) {
          insert.run(date, rosterId, userId, attachmentPath);
        } else if (existing.status === 'present') {
          upgradePresent.run(attachmentPath, date, rosterId, userId);
        }
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  });
  tx();
}

module.exports = { submitOne, propagateMcAttachment, STATUSES, OFF_PERIODS };
