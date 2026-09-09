const { formatOffPeriod } = require('./offPeriod');
const { buildReportLineRows, activeReportLines } = require('./reportLines');

// Adjust here if the reporting deadline ever changes.
const DEADLINE_TIME = '11am';

function formatDateDDMMYYYY(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}/${m}/${y}`;
}

function personLabel(person) {
  return person.ref_id ? `${person.ref_id} ${person.name}` : person.name;
}

function exceptionText(r) {
  if (r.unreported) return 'not reported';
  if (r.status === 'off') {
    const period = formatOffPeriod(r.offPeriod, r.offTime, r.offTimeEnd);
    return `Off (${period})${r.approvalState === 'pending' ? ', pending' : ''}`;
  }
  if (r.status === 'mc') return `MC${r.missingAttachment ? ' (no attachment yet)' : ''}`;
  return null; // present, or 1st Day Outpro — still counted in strength that day, no exception text
}

// Custom time-off starting strictly after this counts the same as PM off
// (still there for the morning) — starting at 9am or earlier means they're
// already gone before/at the morning muster, so they count the same as AM off.
const MORNING_CUTOFF = '09:00';

function countsTowardMorningStrength(r) {
  if (r.status === 'present' || r.status === 'outpro') return true;
  if (r.status !== 'off') return false;
  if (r.offPeriod === 'PM') return true;
  if (r.offPeriod === 'TIME') return !!r.offTime && r.offTime > MORNING_CUTOFF;
  return false; // AM, FULL
}

function formatLine(label, rows) {
  const total = rows.length;
  // A 1st Day Outpro person is still physically at the unit that day (they
  // only drop out of total strength starting the next day, per roster.js's
  // activeRosterForDate) — so they count as present here, not an exception.
  // Strength is reported as of the morning — see countsTowardMorningStrength.
  const present = rows.filter(countsTowardMorningStrength).length;
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
  const { lineRows, unclassified } = buildReportLineRows(date);

  const lines = [
    `*Parade status for ${formatDateDDMMYYYY(date)}*`,
    '',
    `To be completed by *${DEADLINE_TIME} today*.`,
    '',
    // Empty pool lines (Standby, Unassigned) are left out entirely, same as
    // the confirmation panels — see activeReportLines.
    ...activeReportLines(lineRows).filter((l) => !l.hideFromText).map(({ key, label }) => formatLine(label, lineRows[key])),
  ];

  if (unclassified.length > 0) {
    lines.push(
      '',
      `Unclassified (needs Sub Unit/Position set on Roster): ${unclassified.map((r) => personLabel(r.person)).join(', ')}`
    );
  }

  return lines.join('\n');
}

module.exports = { buildWhatsappSummary };
