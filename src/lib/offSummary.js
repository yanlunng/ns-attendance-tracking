const db = require('../db');
const { getCycleRange } = require('./settings');

/**
 * Every Off entry (approved or pending) across the whole cycle, not just
 * one date — one row per submission, so the same person shows up once per
 * day they're off. Rejected submissions are excluded (never actually off).
 */
function getOffSummary() {
  const { start, end } = getCycleRange();

  return db
    .prepare(
      `SELECT s.date, s.off_period, s.off_time, s.off_time_end, s.approval_status,
              r.id AS person_id, r.name, r.ref_id, r.group_code
       FROM attendance_submissions s
       JOIN roster r ON r.id = s.roster_id
       WHERE s.status = 'off' AND s.approval_status != 'rejected'
         AND s.date >= ? AND s.date <= ?
       ORDER BY s.date, r.name COLLATE NOCASE`
    )
    .all(start || '0000-01-01', end || '9999-12-31');
}

module.exports = { getOffSummary };
