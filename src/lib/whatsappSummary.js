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
  // Not-reported people are just a count, not individually named — with
  // nobody having reported yet (e.g. first thing in the morning), naming
  // every single one bloats the report for no real information.
  const unreportedCount = rows.filter((r) => r.unreported).length;
  const reported = rows.filter((r) => !r.unreported);

  // A whole line stood down together for the same reason (e.g. a platoon's
  // rostered day off) reads far better as one line than as every single
  // name repeating the identical "Off" reason — this is a deliberate,
  // planned stand-down, not an outfield absence, so say so explicitly.
  if (total > 0 && unreportedCount === 0 && reported.every((r) => r.status === 'off')) {
    const periods = new Set(reported.map((r) => formatOffPeriod(r.offPeriod, r.offTime, r.offTimeEnd)));
    if (periods.size === 1) {
      const [period] = periods;
      return `${label}: ${present}/${total} (All on Off${period ? ` - ${period}` : ''}, not outfield)`;
    }
  }

  const namedExceptions = reported
    .map((r) => {
      const text = exceptionText(r);
      return text ? `${personLabel(r.person)} - ${text}` : null;
    })
    .filter(Boolean);
  const parts = unreportedCount > 0 ? [`${unreportedCount} not reported`, ...namedExceptions] : namedExceptions;
  const suffix = parts.length > 0 ? ` (${parts.join(', ')})` : '';
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
