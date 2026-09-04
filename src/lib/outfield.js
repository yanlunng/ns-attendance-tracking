const db = require('../db');
const { getSetting } = require('./settings');

const CORE_SLOTS = ['FU Commander', '2IC', 'Gunner 1', 'Gunner 2', 'Loader', 'Driver'];
const SPARE_SLOTS = ['Spare 1', 'Spare 2'];
const ALL_SLOTS = [...CORE_SLOTS, ...SPARE_SLOTS];
const HQ_DVR_GROUPS = ['HQ', 'DVR'];

// Platoon 1 / Platoon 2, each with 3 Fire Units — numbered continuously
// across both platoons (Platoon 1: FU 1-3, Platoon 2: FU 4-6), not reset
// per platoon.
const PLATOON_STRUCTURE = {
  RBS: { platoons: ['Platoon 1', 'Platoon 2'], sectionsPerPlatoon: 3, sectionLabel: 'Fire Unit' },
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
  if (!structure) return [];

  let fuNumber = 1;
  return structure.platoons.map((platoonName) => ({
    name: platoonName,
    sections: Array.from({ length: structure.sectionsPerPlatoon }, () =>
      getOrCreateSection(groupCode, platoonName, `${structure.sectionLabel} ${fuNumber}`, fuNumber++, false)
    ),
  }));
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

  const isHqOrDvr = HQ_DVR_GROUPS.includes(groupCode);
  const platoons = ensureGroupStructure(groupCode);

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
    for (const slot of ALL_SLOTS) slots[slot] = inSection.find((p) => p.outfield_slot === slot) || null;
    return { id: section.id, name: section.name, slots };
  }

  return {
    ownUnassigned: ownSection
      ? { id: ownSection.id, name: `${groupCode} Unassigned`, people: groupPool(ownSection.id, allPeople) }
      : null,
    hq: { id: hqSection.id, name: 'HQ', people: groupPool(hqSection.id, allPeople) },
    dvr: { id: dvrSection.id, name: 'DVR', people: groupPool(dvrSection.id, allPeople) },
    platoons: platoons.map((p) => ({ name: p.name, sections: p.sections.map(sectionView) })),
    coreSlots: CORE_SLOTS,
    spareSlots: SPARE_SLOTS,
    hasStructure: !!PLATOON_STRUCTURE[groupCode],
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

  const normalizedSlot = section.is_staging ? null : slot && ALL_SLOTS.includes(slot) ? slot : null;

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

module.exports = { getBoard, assignPerson, eligibleRosterForGroups, CORE_SLOTS, SPARE_SLOTS, ALL_SLOTS };
