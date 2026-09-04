const db = require('../db');
const { getSetting } = require('./settings');

/**
 * The roster as it should appear for a given date: active people, minus
 * anyone Deferred or ICT Cancelled for this cycle, minus anyone who had an
 * approved "Outpro" (1st day out-processing) recorded on an earlier date —
 * their outpro day itself is still tracked, but every day after an approved
 * outpro they drop out of the total strength entirely. A still-pending
 * outpro doesn't exclude anyone until an admin approves it.
 *
 * Also staggers Main Body Phase personnel: before the cycle's Main Body
 * Phase start date, only Commander Phase people are in the active roster —
 * everyone else joins once that date arrives. If no Main Body start date is
 * set yet, nobody is staggered (everyone counts from day one).
 */
function activeRosterForDate(date) {
  const rows = db
    .prepare(
      `SELECT * FROM roster
       WHERE active = 1 AND is_deferred = 0 AND is_ict_cancelled = 0
       AND id NOT IN (
         SELECT roster_id FROM attendance_submissions
         WHERE status = 'outpro' AND approval_status = 'approved' AND date < ?
       )
       ORDER BY name COLLATE NOCASE`
    )
    .all(date);

  const mainBodyStart = getSetting('mainbody_phase_start_date');
  if (!mainBodyStart) return rows;
  return rows.filter((r) => r.is_commander_phase === 1 || date >= mainBodyStart);
}

/**
 * When viewing a date before the Main Body Phase has started, tells the
 * caller how many Main Body people are currently excluded so the UI can
 * explain the smaller headcount instead of leaving it a mystery. Returns
 * null once Main Body Phase has started (or was never configured).
 */
function getPhaseStagger(date) {
  const mainBodyStart = getSetting('mainbody_phase_start_date');
  if (!mainBodyStart || date >= mainBodyStart) return null;

  const excludedCount = db
    .prepare(
      `SELECT COUNT(*) AS c FROM roster
       WHERE active = 1 AND is_deferred = 0 AND is_ict_cancelled = 0 AND is_commander_phase = 0`
    )
    .get().c;
  if (excludedCount === 0) return null;

  return { mainBodyStart, excludedCount };
}

module.exports = { activeRosterForDate, getPhaseStagger };
