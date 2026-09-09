const { formatOffPeriod } = require('./offPeriod');
const { REPORT_LINES, buildReportLineRows } = require('./reportLines');

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

function formatLine(label, rows) {
  const total = rows.length;
  // A 1st Day Outpro person is still physically at the unit that day (they
  // only drop out of total strength starting the next day, per roster.js's
  // activeRosterForDate) — so they count as present here, not an exception.
  // Strength is reported as of the morning, so a PM-off person still counts
  // (they were around for the morning parade) — AM/full-day/custom-time off
  // don't, since those can't be guaranteed to exclude the morning.
  const present = rows.filter(
    (r) => r.status === 'present' || r.status === 'outpro' || (r.status === 'off' && r.offPeriod === 'PM')
  ).length;
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
    ...REPORT_LINES.filter((l) => !l.hideFromText).map(({ key, label }) => formatLine(label, lineRows[key])),
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
