const db = require('../db');
const { getDailySummary } = require('./merge');

// The lines of the parade-state report, in display order.
const REPORT_LINES = [
  { key: 'BTY_HQ', label: 'Bty HQ' },
  { key: 'PL1', label: 'PL1' },
  { key: 'FP1', label: 'FP1' },
  { key: 'PL2', label: 'PL2' },
  { key: 'FP2', label: 'FP2' },
  { key: 'PSTAR', label: 'PSTAR' },
  { key: 'FP_PSTAR', label: 'FP PSTAR' },
  { key: 'TOS_TECH', label: 'TOs/Tech' },
  { key: 'STANDBY', label: 'Standby' },
  { key: 'RBS_UNASSIGNED', label: 'RBS Unassigned' },
  { key: 'FP_UNASSIGNED', label: 'FP Unassigned' },
  { key: 'PSTAR_UNASSIGNED', label: 'PSTAR Unassigned' },
];

// The roster group_code(s) each line is drawn from — used to derive who's
// allowed to confirm it directly from the existing KAH edit-scope mapping
// (db.editScopeFor), rather than a separate hardcoded permission table.
// KAH counts toward Bty HQ — both are battery/battalion-level appointments
// rather than Fire Unit crew, and KAH has no board/slot structure of its own.
const LINE_GROUPS = {
  BTY_HQ: ['HQ', 'KAH'],
  PL1: ['RBS'],
  FP1: ['FP'],
  PL2: ['RBS'],
  FP2: ['FP'],
  PSTAR: ['PSTAR'],
  FP_PSTAR: ['FP'],
  TOS_TECH: ['DVR'],
  STANDBY: ['RBS', 'FP'],
  RBS_UNASSIGNED: ['RBS'],
  FP_UNASSIGNED: ['FP'],
  PSTAR_UNASSIGNED: ['PSTAR'],
};

/**
 * Classifies an RBS/FP person's current Outfield Designation placement into
 * a parade-state bucket: PL1/PL2 (RBS platoons), FP1/FP2 (FP platoons,
 * excluding their PSTAR sub-team), FP_PSTAR (either platoon's PSTAR
 * sub-team), STANDBY, or RBS_UNASSIGNED/FP_UNASSIGNED (still in the group's
 * own general pool) — mutually exclusive, together covering every RBS/FP
 * person exactly once.
 */
function classifyRbsFpBucket(person, sectionsById) {
  const unassignedKey = person.group_code === 'RBS' ? 'RBS_UNASSIGNED' : 'FP_UNASSIGNED';
  const section = sectionsById.get(person.outfield_section_id);
  if (!section) return unassignedKey;
  if (section.is_staging) return section.name === 'Standby' ? 'STANDBY' : unassignedKey;
  if (section.name === 'PSTAR') return 'FP_PSTAR';
  if (person.group_code === 'RBS') return section.platoon === 'Platoon 1' ? 'PL1' : 'PL2';
  return section.platoon === 'Platoon 1' ? 'FP1' : 'FP2';
}

/**
 * Groups every roster row from getDailySummary(date) into the report-line
 * buckets. Shared by the WhatsApp report text and the line-confirmation
 * feature so both always agree on exactly who belongs to which line.
 * PSTAR is different from RBS/FP: every PSTAR person always counts toward
 * the flat "PSTAR" line (a plain headcount, not placement-based), and
 * additionally toward "PSTAR Unassigned" if they haven't yet been placed
 * into one of PSTAR's own Team slots — the two aren't mutually exclusive.
 * KAH counts toward "Bty HQ" — it has no board/slot structure of its own.
 */
function buildReportLineRows(date) {
  const { rows } = getDailySummary(date);
  const sections = db.prepare('SELECT id, group_code, platoon, name, is_staging FROM outfield_sections').all();
  const sectionsById = new Map(sections.map((s) => [s.id, s]));

  const bucket = new Map();
  for (const r of rows) {
    if (r.person.group_code === 'RBS' || r.person.group_code === 'FP') {
      bucket.set(r.person.id, classifyRbsFpBucket(r.person, sectionsById));
    }
  }

  const lineRows = {};
  for (const { key } of REPORT_LINES) lineRows[key] = [];
  for (const r of rows) {
    const g = r.person.group_code;
    if (g === 'HQ' || g === 'KAH') lineRows.BTY_HQ.push(r);
    else if (g === 'PSTAR') {
      lineRows.PSTAR.push(r);
      const section = sectionsById.get(r.person.outfield_section_id);
      const placedInTeamSlot = !!section && section.group_code === 'PSTAR' && section.is_staging === 0;
      if (!placedInTeamSlot) lineRows.PSTAR_UNASSIGNED.push(r);
    } else if (g === 'DVR') lineRows.TOS_TECH.push(r);
    else if (g === 'RBS' || g === 'FP') {
      const b = bucket.get(r.person.id);
      if (lineRows[b]) lineRows[b].push(r);
    }
  }

  return { lineRows, unclassified: rows.filter((r) => !r.person.group_code) };
}

/** null editScope (bc/bsm/b2ic, plain admin, etc.) can confirm any line. */
function canConfirmLine(username, lineKey) {
  const scope = db.editScopeFor(username);
  if (!scope) return true;
  const groups = LINE_GROUPS[lineKey] || [];
  return groups.some((g) => scope.includes(g));
}

/** True for accounts whose scope is unrestricted — the "confirm everything at once" override. */
function canConfirmAll(username) {
  return db.editScopeFor(username) === null;
}

module.exports = { REPORT_LINES, LINE_GROUPS, buildReportLineRows, canConfirmLine, canConfirmAll };
