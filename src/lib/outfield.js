const db = require('../db');

const CORE_SLOTS = ['FU Commander', '2IC', 'Gunner 1', 'Gunner 2', 'Loader', 'Driver'];
const SPARE_SLOTS = ['Spare 1', 'Spare 2'];
const ALL_SLOTS = [...CORE_SLOTS, ...SPARE_SLOTS];

const PLATOON_STRUCTURE = {
  RBS: { platoons: ['1 Platoon', '2 Platoon'], sectionsPerPlatoon: 3 },
};

/** DVR/AFV DVR go to the "DVR" staging pool; everyone else starts in "HQ". */
function deriveStagingBucket(positionDescr) {
  if (positionDescr && String(positionDescr).toUpperCase().includes('DVR')) return 'DVR';
  return 'HQ';
}

/** group and platoon may legitimately be null (shared HQ/DVR pools) — "IS" compares null-safely. */
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

/**
 * HQ and DVR are shared, battery-wide pools (group_code = NULL) — not scoped
 * to any one group. Platoon/section structure, where defined, is scoped to
 * its own group (RBS's sections are separate from PSTAR's, etc.).
 */
function ensureGlobalStaging() {
  return {
    hq: getOrCreateSection(null, null, 'HQ', 0, true),
    dvr: getOrCreateSection(null, null, 'DVR', 1, true),
  };
}

function ensureGroupStructure(groupCode) {
  const structure = PLATOON_STRUCTURE[groupCode];
  if (!structure) return [];

  let order = 10;
  return structure.platoons.map((platoonName) => ({
    name: platoonName,
    sections: Array.from({ length: structure.sectionsPerPlatoon }, (_, i) =>
      getOrCreateSection(groupCode, platoonName, `Section ${i + 1}`, order++, false)
    ),
  }));
}

/**
 * Everyone across the whole battery eligible for outfield planning: active,
 * not Deferred, not ICT Cancelled, belongs to one of the four groups, and
 * hasn't started an approved Outpro at any point this cycle.
 */
function eligibleRosterBatteryWide() {
  return db
    .prepare(
      `SELECT * FROM roster
       WHERE active = 1 AND is_deferred = 0 AND is_ict_cancelled = 0 AND group_code IS NOT NULL
       AND id NOT IN (
         SELECT roster_id FROM attendance_submissions WHERE status = 'outpro' AND approval_status = 'approved'
       )
       ORDER BY name COLLATE NOCASE`
    )
    .all();
}

/**
 * Builds the outfield board: the shared HQ/DVR pools (same across every
 * group's tab) plus the requested group's own platoon/section target
 * structure, where one is defined. Anyone eligible with no section assigned
 * yet is auto-dropped into the DVR or HQ pool (persisted) — everything past
 * that point is manual, via drag-and-drop, and is independent of which
 * group a person originally belongs to.
 */
function getBoard(groupCode) {
  const staging = ensureGlobalStaging();
  const platoons = ensureGroupStructure(groupCode);
  const people = eligibleRosterBatteryWide();

  const autoAssign = db.prepare('UPDATE roster SET outfield_section_id = ?, outfield_slot = NULL WHERE id = ?');
  for (const person of people) {
    if (person.outfield_section_id != null) continue;
    const bucket = deriveStagingBucket(person.position_descr) === 'DVR' ? staging.dvr : staging.hq;
    autoAssign.run(bucket.id, person.id);
    person.outfield_section_id = bucket.id;
    person.outfield_slot = null;
  }

  const peopleBySection = new Map();
  for (const person of people) {
    if (!peopleBySection.has(person.outfield_section_id)) peopleBySection.set(person.outfield_section_id, []);
    peopleBySection.get(person.outfield_section_id).push(person);
  }

  function sectionView(section) {
    const inSection = peopleBySection.get(section.id) || [];
    const slots = {};
    for (const slot of ALL_SLOTS) slots[slot] = inSection.find((p) => p.outfield_slot === slot) || null;
    return { id: section.id, name: section.name, slots };
  }

  return {
    hq: { id: staging.hq.id, name: 'HQ', people: peopleBySection.get(staging.hq.id) || [] },
    dvr: { id: staging.dvr.id, name: 'DVR', people: peopleBySection.get(staging.dvr.id) || [] },
    platoons: platoons.map((p) => ({ name: p.name, sections: p.sections.map(sectionView) })),
    coreSlots: CORE_SLOTS,
    spareSlots: SPARE_SLOTS,
    hasStructure: !!PLATOON_STRUCTURE[groupCode],
  };
}

/** Moves a person into a section/slot. If the slot is already taken, the previous occupant bounces to HQ. */
function assignPerson(personId, sectionId, slot) {
  const section = db.prepare('SELECT * FROM outfield_sections WHERE id = ?').get(sectionId);
  if (!section) throw new Error('Unknown section.');

  const normalizedSlot = section.is_staging ? null : slot && ALL_SLOTS.includes(slot) ? slot : null;

  const tx = db.transaction(() => {
    if (normalizedSlot) {
      const occupant = db
        .prepare('SELECT id FROM roster WHERE outfield_section_id = ? AND outfield_slot = ? AND id != ?')
        .get(sectionId, normalizedSlot, personId);
      if (occupant) {
        const hq = getOrCreateSection(null, null, 'HQ', 0, true);
        db.prepare('UPDATE roster SET outfield_section_id = ?, outfield_slot = NULL WHERE id = ?').run(
          hq.id,
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

module.exports = { getBoard, assignPerson, eligibleRosterBatteryWide, CORE_SLOTS, SPARE_SLOTS, ALL_SLOTS };
