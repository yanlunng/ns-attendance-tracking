const db = require('../db');
const { getSetting } = require('./settings');

const HQ_DVR_GROUPS = ['HQ', 'DVR'];

// RBS: Platoon 1 / Platoon 2, each with 3 Fire Units — numbered continuously
// across both platoons (Platoon 1: FU 1-3, Platoon 2: FU 4-6).
// FP: Platoon 1 / Platoon 2, each with its own FU 1-3 (numbering resets per
// platoon) plus a PSTAR sub-team drawn from PSTAR personnel cross-attached
// to FP — same 6-slot crew shape as an FU. Both groups also have one
// group-wide Standby pool that isn't tied to either platoon.
const PLATOON_STRUCTURE = {
  RBS: {
    coreSlots: ['FU Commander', '2IC', 'Gunner 1', 'Gunner 2', 'Loader', 'Driver'],
    spareSlots: ['Spare 1', 'Spare 2'],
    platoons: [
      { name: 'Platoon 1', sections: ['Fire Unit 1', 'Fire Unit 2', 'Fire Unit 3'] },
      { name: 'Platoon 2', sections: ['Fire Unit 4', 'Fire Unit 5', 'Fire Unit 6'] },
    ],
    standby: true,
  },
  FP: {
    coreSlots: ['Team Comd', '2IC', 'Member 1', 'Member 2', 'Member 3', 'Member 4'],
    spareSlots: [],
    platoons: [
      { name: 'Platoon 1', sections: ['FU 1', 'FU 2', 'FU 3', 'PSTAR'] },
      { name: 'Platoon 2', sections: ['FU 1', 'FU 2', 'FU 3', 'PSTAR'] },
    ],
    standby: true,
  },
};

/** group/platoon may legitimately be null — "IS" compares null-safely. */
function getOrCreateSection(groupCode, platoon, name, sortOrder, isStaging) {
  const existing = db
    .prepare('SELECT * FROM outfield_sections WHERE group_code IS ? AND platoon IS ? AND name = ?')
    .get(groupCode, platoon, name);
  if (existing) return existing;

  const result = db
    .prepare(
      'INSERT INTO outfield_sections (group_code, platoon, name, sort_order, is_staging) VALUES (?, ?, ?, ?, ?)'
    )
    .run(groupCode, platoon, name, sortOrder, isStaging ? 1 : 0);
  return db.prepare('SELECT * FROM outfield_sections WHERE id = ?').get(Number(result.lastInsertRowid));
}

function ensureGroupStructure(groupCode) {
  const structure = PLATOON_STRUCTURE[groupCode];
  if (!structure) return { platoons: [], standbySection: null };

  let sortOrder = 0;
  const platoons = structure.platoons.map((platoon) => ({
    name: platoon.name,
    sections: platoon.sections.map((sectionName) =>
      getOrCreateSection(groupCode, platoon.name, sectionName, sortOrder++, false)
    ),
  }));

  const standbySection = structure.standby
    ? getOrCreateSection(groupCode, null, 'Standby', 9999, true)
    : null;

  return { platoons, standbySection };
}

/**
 * Roster IDs confirmed absent for the whole outfield window: an *approved*
 * Off or MC (pending doesn't count — only approved is "definitely") landing
 * on any day within it. Returns an empty set if the window isn't configured.
 */
function getConfirmedAbsentIds() {
  const start = getSetting('outfield_start_date');
  const end = getSetting('outfield_end_date');
  if (!start || !end) return new Set();

  const rows = db
    .prepare(
      `SELECT DISTINCT roster_id FROM attendance_submissions
       WHERE status IN ('off', 'mc') AND approval_status = 'approved' AND date BETWEEN ? AND ?`
    )
    .all(start, end);
  return new Set(rows.map((r) => r.roster_id));
}

/** Pulls anyone now confirmed-absent out of whatever slot they're holding, so it visibly opens up. */
function vacateConfirmedAbsent() {
  const confirmedAbsent = getConfirmedAbsentIds();
  if (confirmedAbsent.size === 0) return;
  const ids = [...confirmedAbsent];
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE roster SET outfield_section_id = NULL, outfield_slot = NULL WHERE id IN (${placeholders})`
  ).run(...ids);
}

/**
 * Anyone sitting in a staging pool (Unassigned/HQ/DVR) whose group_code no
 * longer matches that pool's own group — e.g. their group was reclassified
 * to HQ/DVR after they were last auto-sorted into their old group's pool —
 * gets reset so the normal auto-assign step picks them up into the correct
 * pool. Deliberate Fire Unit slot placements (is_staging = 0) are never
 * touched here, regardless of group changes.
 */
function reconcileStaleStagingAssignments() {
  const stale = db
    .prepare(
      `SELECT r.id FROM roster r
       JOIN outfield_sections s ON s.id = r.outfield_section_id
       WHERE s.is_staging = 1 AND s.group_code IS NOT r.group_code`
    )
    .all();
  if (stale.length === 0) return;
  const ids = stale.map((r) => r.id);
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(
    `UPDATE roster SET outfield_section_id = NULL, outfield_slot = NULL WHERE id IN (${placeholders})`
  ).run(...ids);
}

/**
 * Eligible for outfield planning: active, not Deferred, not ICT Cancelled,
 * belongs to the given group, hasn't started an approved Outpro at any
 * point this cycle, and isn't confirmed absent for the whole outfield window.
 */
function eligibleRosterForGroups(groupCodes) {
  const placeholders = groupCodes.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT * FROM roster
       WHERE active = 1 AND is_deferred = 0 AND is_ict_cancelled = 0 AND group_code IN (${placeholders})
       AND id NOT IN (
         SELECT roster_id FROM attendance_submissions WHERE status = 'outpro' AND approval_status = 'approved'
       )
       ORDER BY name COLLATE NOCASE`
    )
    .all(...groupCodes);

  const confirmedAbsent = getConfirmedAbsentIds();
  return confirmedAbsent.size ? rows.filter((r) => !confirmedAbsent.has(r.id)) : rows;
}

function autoAssignUnplaced(people, section) {
  const autoAssign = db.prepare('UPDATE roster SET outfield_section_id = ?, outfield_slot = NULL WHERE id = ?');
  for (const person of people) {
    if (person.outfield_section_id != null) continue;
    autoAssign.run(section.id, person.id);
    person.outfield_section_id = section.id;
    person.outfield_slot = null;
  }
}

function groupPool(sectionId, allPeople) {
  return allPeople.filter((p) => p.outfield_section_id === sectionId);
}

/**
 * Builds the outfield board for a group. RBS (for now) gets its real
 * Platoon/Fire Unit target structure; every group also gets its own
 * "Unassigned" pool for members not yet placed. HQ and DVR are shown as a
 * shared pool underneath the Fire Unit grid on every group's board (not
 * just their own), since they're the natural source of spares/replacements
 * regardless of which group you're organizing — except on HQ/DVR's own
 * board, where that shared pool already covers everyone and a second
 * "own Unassigned" pool would just repeat it.
 */
function getBoard(groupCode) {
  vacateConfirmedAbsent();
  reconcileStaleStagingAssignments();

  const isHqOrDvr = HQ_DVR_GROUPS.includes(groupCode);
  const structure = PLATOON_STRUCTURE[groupCode];
  const { platoons, standbySection } = ensureGroupStructure(groupCode);
  const allSlots = structure ? [...structure.coreSlots, ...structure.spareSlots] : [];

  const hqSection = getOrCreateSection('HQ', null, 'Unassigned', 0, true);
  const dvrSection = getOrCreateSection('DVR', null, 'Unassigned', 1, true);
  const ownSection = isHqOrDvr ? null : getOrCreateSection(groupCode, null, 'Unassigned', 0, true);

  const hqDvrPeople = eligibleRosterForGroups(HQ_DVR_GROUPS);
  autoAssignUnplaced(
    hqDvrPeople.filter((p) => p.group_code === 'HQ'),
    hqSection
  );
  autoAssignUnplaced(
    hqDvrPeople.filter((p) => p.group_code === 'DVR'),
    dvrSection
  );

  let ownPeople = [];
  if (ownSection) {
    ownPeople = eligibleRosterForGroups([groupCode]);
    autoAssignUnplaced(ownPeople, ownSection);
  }

  const allPeople = [...hqDvrPeople, ...ownPeople];

  function sectionView(section) {
    const inSection = groupPool(section.id, allPeople);
    const slots = {};
    for (const slot of allSlots) slots[slot] = inSection.find((p) => p.outfield_slot === slot) || null;
    return { id: section.id, name: section.name, slots };
  }

  return {
    ownUnassigned: ownSection
      ? { id: ownSection.id, name: `${groupCode} Unassigned`, people: groupPool(ownSection.id, allPeople) }
      : null,
    standby: standbySection
      ? { id: standbySection.id, name: `${groupCode} Standby`, people: groupPool(standbySection.id, allPeople) }
      : null,
    hq: { id: hqSection.id, name: 'HQ', people: groupPool(hqSection.id, allPeople) },
    dvr: { id: dvrSection.id, name: 'DVR', people: groupPool(dvrSection.id, allPeople) },
    platoons: platoons.map((p) => ({ name: p.name, sections: p.sections.map(sectionView) })),
    coreSlots: structure ? structure.coreSlots : [],
    spareSlots: structure ? structure.spareSlots : [],
    hasStructure: !!structure,
  };
}

/**
 * Moves a person into a section/slot. If the slot is already taken, the
 * previous occupant bounces back to their own group's Unassigned pool (HQ's
 * for an HQ person, DVR's for a DVR person, etc.) rather than a hardcoded
 * destination.
 */
function assignPerson(personId, sectionId, slot) {
  const section = db.prepare('SELECT * FROM outfield_sections WHERE id = ?').get(sectionId);
  if (!section) throw new Error('Unknown section.');

  const structure = PLATOON_STRUCTURE[section.group_code];
  const allSlots = structure ? [...structure.coreSlots, ...structure.spareSlots] : [];
  const normalizedSlot = section.is_staging ? null : slot && allSlots.includes(slot) ? slot : null;

  const tx = db.transaction(() => {
    if (normalizedSlot) {
      const occupant = db
        .prepare('SELECT id, group_code FROM roster WHERE outfield_section_id = ? AND outfield_slot = ? AND id != ?')
        .get(sectionId, normalizedSlot, personId);
      if (occupant) {
        const bounceTo = getOrCreateSection(occupant.group_code || 'HQ', null, 'Unassigned', 0, true);
        db.prepare('UPDATE roster SET outfield_section_id = ?, outfield_slot = NULL WHERE id = ?').run(
          bounceTo.id,
          occupant.id
        );
      }
    }
    db.prepare('UPDATE roster SET outfield_section_id = ?, outfield_slot = ? WHERE id = ?').run(
      sectionId,
      normalizedSlot,
      personId
    );
  });
  tx();
}

module.exports = { getBoard, assignPerson, eligibleRosterForGroups };
