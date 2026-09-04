const db = require('../db');
const { activeRosterForDate } = require('./roster');

function listOutfieldDates() {
  return db.prepare('SELECT * FROM outfield_dates ORDER BY date').all();
}

function otherPlatoon(platoon) {
  return platoon === 'Platoon 1' ? 'Platoon 2' : 'Platoon 1';
}

/**
 * Auto-fills an approved, whole-day Off for everyone currently placed into a
 * Fire Unit (RBS or FP — excluding FP's PSTAR sub-team, which deploys on its
 * own schedule) under the platoon NOT going out on this date. Never
 * overwrites an existing record for that person/date — whatever's already
 * there (a real Off/MC/Outpro, or an earlier auto-fill) always wins. Skips
 * anyone not otherwise eligible for this date (deferred, ICT cancelled,
 * already on approved outpro, etc.).
 */
function fillAutoOffForDate(date, goingPlatoon, submitterId) {
  const notGoing = otherPlatoon(goingPlatoon);
  const sections = db
    .prepare(
      `SELECT id FROM outfield_sections
       WHERE group_code IN ('RBS', 'FP') AND platoon = ? AND is_staging = 0 AND name != 'PSTAR'`
    )
    .all(notGoing);
  if (sections.length === 0) return;

  const sectionIds = sections.map((s) => s.id);
  const placeholders = sectionIds.map(() => '?').join(',');
  const candidateIds = new Set(
    db.prepare(`SELECT id FROM roster WHERE outfield_section_id IN (${placeholders})`).all(...sectionIds).map((r) => r.id)
  );
  if (candidateIds.size === 0) return;

  const eligibleIds = new Set(activeRosterForDate(date).map((p) => p.id));
  const existingStmt = db.prepare('SELECT 1 FROM attendance_submissions WHERE date = ? AND roster_id = ?');
  const insert = db.prepare(
    `INSERT INTO attendance_submissions
       (date, roster_id, user_id, status, off_period, approval_status, approved_by, approved_at, remarks, submitted_at)
     VALUES (?, ?, ?, 'off', 'FULL', 'approved', ?, datetime('now'), ?, datetime('now'))`
  );

  for (const id of candidateIds) {
    if (!eligibleIds.has(id)) continue;
    if (existingStmt.get(date, id)) continue;
    insert.run(date, id, submitterId, submitterId, `Outfield: ${notGoing} not deployed on ${date}`);
  }
}

function upsertOutfieldDate(date, goingPlatoon, submitterId) {
  db.prepare(
    `INSERT INTO outfield_dates (date, going_platoon) VALUES (?, ?)
     ON CONFLICT(date) DO UPDATE SET going_platoon = excluded.going_platoon`
  ).run(date, goingPlatoon);
  fillAutoOffForDate(date, goingPlatoon, submitterId);
}

function removeOutfieldDate(id) {
  db.prepare('DELETE FROM outfield_dates WHERE id = ?').run(id);
}

module.exports = { listOutfieldDates, upsertOutfieldDate, removeOutfieldDate };
