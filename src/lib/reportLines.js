const db = require('../db');
const { getDailySummary } = require('./merge');

// The 10 lines of the parade-state report, in display order.
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
  { key: 'UNASSIGNED', label: 'Not yet assigned' },
];

// The roster group_code(s) each line is drawn from — used to derive who's
// allowed to confirm it directly from the existing KAH edit-scope mapping
// (db.editScopeFor), rather than a separate hardcoded permission table.
const LINE_GROUPS = {
  BTY_HQ: ['HQ'],
  PL1: ['RBS'],
  FP1: ['FP'],
  PL2: ['RBS'],
  FP2: ['FP'],
  PSTAR: ['PSTAR'],
  FP_PSTAR: ['FP'],
  TOS_TECH: ['DVR'],
  STANDBY: ['RBS', 'FP'],
  UNASSIGNED: ['RBS', 'FP'],
};

/**
 * Classifies an RBS/FP person's current Outfield Designation placement into
 * a parade-state bucket: PL1/PL2 (RBS platoons), FP1/FP2 (FP platoons,
 * excluding their PSTAR sub-team), FP_PSTAR (either platoon's PSTAR
 * sub-team), STANDBY, or UNASSIGNED (still in the group's general pool).
 */
function classifyRbsFpBucket(person, sectionsById) {
  const section = sectionsById.get(person.outfield_section_id);
  if (!section) return 'UNASSIGNED';
  if (section.is_staging) return section.name === 'Standby' ? 'STANDBY' : 'UNASSIGNED';
  if (section.name === 'PSTAR') return 'FP_PSTAR';
  if (person.group_code === 'RBS') return section.platoon === 'Platoon 1' ? 'PL1' : 'PL2';
  return section.platoon === 'Platoon 1' ? 'FP1' : 'FP2';
}

/**
 * Groups every roster row from getDailySummary(date) into the 10 report-line
 * buckets. Shared by the WhatsApp report text and the line-confirmation
 * feature so both always agree on exactly who belongs to which line.
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
    if (g === 'HQ') lineRows.BTY_HQ.push(r);
    else if (g === 'PSTAR') lineRows.PSTAR.push(r);
    else if (g === 'DVR') lineRows.TOS_TECH.push(r);
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
