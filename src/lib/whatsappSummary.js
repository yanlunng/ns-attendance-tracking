const db = require('../db');
const { getDailySummary } = require('./merge');

// Adjust here if the reporting deadline ever changes.
const DEADLINE_TIME = '11am';

function formatDateDDMMYYYY(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function personLabel(person) {
  return person.ref_id ? `${person.ref_id} ${person.name}` : person.name;
}

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

function exceptionText(r) {
  if (r.unreported) return 'not reported';
  if (r.status === 'off') {
    const period = r.offPeriod === 'TIME' ? `${r.offTime}-${r.offTimeEnd}` : r.offPeriod;
    return `Off (${period})${r.approvalState === 'pending' ? ', pending' : ''}`;
  }
  if (r.status === 'mc') return `MC${r.missingAttachment ? ' (no attachment yet)' : ''}`;
  if (r.status === 'outpro') return `1st Day Outpro${r.approvalState === 'pending' ? ', pending' : ''}`;
  return null; // present — no exception text
}

function formatLine(label, rows) {
  const total = rows.length;
  const present = rows.filter((r) => r.status === 'present').length;
  const exceptions = rows
    .map((r) => {
      const text = exceptionText(r);
      return text ? `${personLabel(r.person)} - ${text}` : null;
    })
    .filter(Boolean);
  const suffix = exceptions.length > 0 ? ` (${exceptions.join(', ')})` : '';
  return `${label}: ${present}/${total}${suffix}`;
}

/**
 * Parade-state report formatted for pasting straight into WhatsApp — plain
 * text (no Telegram markup); the *bold* asterisks are WhatsApp's own markdown
 * and are kept literally since they only render once pasted there.
 */
function buildWhatsappSummary(date) {
  const { rows } = getDailySummary(date);

  const sections = db.prepare('SELECT id, group_code, platoon, name, is_staging FROM outfield_sections').all();
  const sectionsById = new Map(sections.map((s) => [s.id, s]));

  const bucket = new Map();
  for (const r of rows) {
    if (r.person.group_code === 'RBS' || r.person.group_code === 'FP') {
      bucket.set(r.person.id, classifyRbsFpBucket(r.person, sectionsById));
    }
  }

  const byGroup = (code) => rows.filter((r) => r.person.group_code === code);
  const byBucket = (code, key) => rows.filter((r) => r.person.group_code === code && bucket.get(r.person.id) === key);
  const byBucketEither = (key) =>
    rows.filter((r) => ['RBS', 'FP'].includes(r.person.group_code) && bucket.get(r.person.id) === key);
  const unclassified = rows.filter((r) => !r.person.group_code);

  const lines = [
    `*Parade status for ${formatDateDDMMYYYY(date)}*`,
    '',
    `To be completed by *${DEADLINE_TIME} today*.`,
    '',
    formatLine('Bty HQ', byGroup('HQ')),
    formatLine('PL1', byBucket('RBS', 'PL1')),
    formatLine('FP1', byBucket('FP', 'FP1')),
    formatLine('PL2', byBucket('RBS', 'PL2')),
    formatLine('FP2', byBucket('FP', 'FP2')),
    formatLine('PSTAR', byGroup('PSTAR')),
    formatLine('FP PSTAR', byBucket('FP', 'FP_PSTAR')),
    formatLine('TOs/Tech', byGroup('DVR')),
    formatLine('Standby', byBucketEither('STANDBY')),
    formatLine('Not yet assigned', byBucketEither('UNASSIGNED')),
  ];

  if (unclassified.length > 0) {
    lines.push(
      '',
      `Unclassified (needs Sub Unit/Position set on Roster): ${unclassified.map((r) => personLabel(r.person)).join(', ')}`
    );
  }

  let text = lines.join('\n');
  const LIMIT = 3900; // stay under Telegram's ~4096-char message cap
  if (text.length > LIMIT) {
    text = `${text.slice(0, LIMIT)}\n\n[truncated — see the Summary page on the web app for the full list]`;
  }
  return text;
}

module.exports = { buildWhatsappSummary };
