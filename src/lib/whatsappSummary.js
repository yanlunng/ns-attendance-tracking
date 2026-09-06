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
  const present = rows.filter((r) => r.status === 'present' || r.status === 'outpro').length;
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
    ...REPORT_LINES.map(({ key, label }) => formatLine(label, lineRows[key])),
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
