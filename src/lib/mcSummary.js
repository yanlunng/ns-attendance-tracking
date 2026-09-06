const db = require('../db');
const { getCycleRange } = require('./settings');

/**
 * Roster members (not already ICT Cancelled) with a cumulative MC day count
 * at or above the threshold so far this cycle — not necessarily consecutive.
 * Scoped to the current cycle's date range so a continuing person's MC days
 * from a past cycle never bleed into this count. Surfaced on the Roster
 * page as a discretionary "cancel their ICT?" prompt for admins.
 */
function getMcThresholdList(threshold = 3) {
  const { start, end } = getCycleRange();

  return db
    .prepare(
      `SELECT r.id, r.name, r.ref_id, r.group_code, COUNT(*) AS mcDays
       FROM attendance_submissions s
       JOIN roster r ON r.id = s.roster_id
       WHERE s.status = 'mc' AND r.active = 1 AND r.is_deferred = 0 AND r.is_ict_cancelled = 0
         AND s.date >= ? AND s.date <= ?
       GROUP BY r.id
       HAVING mcDays >= ?
       ORDER BY mcDays DESC, r.name COLLATE NOCASE`
    )
    .all(start || '0000-01-01', end || '9999-12-31', threshold);
}

module.exports = { getMcThresholdList };
