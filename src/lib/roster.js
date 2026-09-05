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

/**
 * Narrows a roster list down to what a given username is allowed to mark —
 * unrestricted accounts (the default) get the list back unchanged; scoped
 * KAH accounts (see db.editScopeFor) only get their permitted group(s).
 */
function filterRosterForEditor(roster, username) {
  const scope = db.editScopeFor(username);
  if (!scope) return roster;
  return roster.filter((p) => scope.includes(p.group_code));
}

/**
 * Everyone on the roster (active=1) who's excluded from that date's total
 * strength, with the reason(s) why — mirrors activeRosterForDate's filters
 * so the two can never drift apart. Used by the Summary page to explain a
 * headcount smaller than the full roster instead of leaving people guessing.
 */
function getExcludedFromStrength(date) {
  const roster = db.prepare('SELECT * FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE').all();

  const outproRosterIds = new Set(
    db
      .prepare(
        `SELECT roster_id FROM attendance_submissions
         WHERE status = 'outpro' AND approval_status = 'approved' AND date < ?`
      )
      .all(date)
      .map((r) => r.roster_id)
  );

  const mainBodyStart = getSetting('mainbody_phase_start_date');

  const excluded = [];
  for (const person of roster) {
    const reasons = [];
    if (person.is_deferred) reasons.push('Deferred');
    if (person.is_ict_cancelled) reasons.push('ICT Cancelled');
    if (outproRosterIds.has(person.id)) reasons.push('Started 1st Day Outpro on an earlier date');
    if (mainBodyStart && person.is_commander_phase === 0 && date < mainBodyStart) {
      reasons.push(`Main Body Phase personnel — joins ${mainBodyStart}`);
    }
    if (reasons.length > 0) excluded.push({ person, reasons });
  }
  return excluded;
}

module.exports = { activeRosterForDate, getPhaseStagger, filterRosterForEditor, getExcludedFromStrength };
