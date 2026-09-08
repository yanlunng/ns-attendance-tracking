const db = require('../db');
const { getCycleRange } = require('./settings');

/**
 * Every upcoming Off entry (approved or pending) from `fromDate` through the
 * end of the cycle — one row per submission, so the same person shows up
 * once per day they're off. Rejected submissions are excluded (never
 * actually off). Deliberately excludes anything before `fromDate`: once
 * you've moved on to viewing a later date's summary, an Off that already
 * happened isn't useful to keep surfacing here.
 */
function getOffSummary(fromDate) {
  const { end } = getCycleRange();

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
    .all(fromDate, end || '9999-12-31');
}

module.exports = { getOffSummary };
