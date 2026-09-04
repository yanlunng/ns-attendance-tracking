const db = require('../db');

function normalizeName(name) {
  return String(name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Matches an incoming roster row to an existing one by identity, so the same
 * real person keeps the same roster_id (and attendance history) across
 * re-uploads. Prefers Full Name + DOB; falls back to name-only when DOB is
 * missing on either side, but only if the name is unambiguous among existing
 * rows (otherwise treat as a new person rather than risk merging two people).
 */
function buildMatcher(existingRows) {
  const byNameAndDob = new Map();
  const byNameOnly = new Map();

  for (const row of existingRows) {
    const normName = normalizeName(row.name);
    if (row.date_of_birth) byNameAndDob.set(`${normName}|${row.date_of_birth}`, row);
    if (!byNameOnly.has(normName)) byNameOnly.set(normName, []);
    byNameOnly.get(normName).push(row);
  }

  return (person) => {
    const normName = normalizeName(person.name);
    if (person.date_of_birth) {
      const exact = byNameAndDob.get(`${normName}|${person.date_of_birth}`);
      if (exact) return exact;
    }
    const candidates = byNameOnly.get(normName) || [];
    return candidates.length === 1 ? candidates[0] : null;
  };
}

/**
 * Upserts parsed roster people by identity (Full Name + DOB).
 *
 * mode 'replace': anyone from a prior upload not present in this one is
 * deleted outright (cascades to their attendance_submissions) so the roster
 * doesn't accumulate a growing backlog of people who've since left — the new
 * sheet becomes the complete roster.
 *
 * mode 'append': only inserts/updates; never deletes anyone.
 */
function upsertRoster(people, mode) {
  const existingRows = db.prepare('SELECT * FROM roster').all();
  const match = buildMatcher(existingRows);

  const update = db.prepare(`
    UPDATE roster SET
      name = ?, ref_id = ?, unit = ?, date_of_birth = ?, mobile = ?, subunit1_raw = ?, position_descr = ?, extra = ?, active = 1,
      is_deferred = ?, is_ict_cancelled = 0, is_commander_phase = ?,
      group_code = CASE WHEN group_source = 'manual' THEN group_code ELSE ? END,
      group_source = CASE WHEN group_source = 'manual' THEN group_source ELSE 'auto' END
    WHERE id = ?
  `);
  const insert = db.prepare(`
    INSERT INTO roster (name, ref_id, unit, date_of_birth, mobile, subunit1_raw, position_descr, extra, is_deferred, is_ict_cancelled, is_commander_phase, group_code, group_source, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'auto', 1)
  `);

  const tx = db.transaction(() => {
    const keptIds = new Set();

    for (const person of people) {
      const existing = match(person);
      if (existing) {
        update.run(
          person.name,
          person.ref_id,
          person.unit,
          person.date_of_birth,
          person.mobile,
          person.subunit1_raw,
          person.position_descr,
          person.extra,
          person.is_deferred ? 1 : 0,
          person.is_commander_phase ? 1 : 0,
          person.group_code,
          existing.id
        );
        keptIds.add(existing.id);
      } else {
        const result = insert.run(
          person.name,
          person.ref_id,
          person.unit,
          person.date_of_birth,
          person.mobile,
          person.subunit1_raw,
          person.position_descr,
          person.extra,
          person.is_deferred ? 1 : 0,
          person.is_commander_phase ? 1 : 0,
          person.group_code
        );
        keptIds.add(Number(result.lastInsertRowid));
      }
    }

    let removed = 0;
    if (mode === 'replace') {
      const toDelete = existingRows.filter((r) => !keptIds.has(r.id));
      const del = db.prepare('DELETE FROM roster WHERE id = ?');
      for (const row of toDelete) del.run(row.id);
      removed = toDelete.length;
    }

    return { imported: people.length, removed };
  });

  return tx();
}

module.exports = { upsertRoster };
