const db = require('../db');
const { REPORT_LINES, buildReportLineRows } = require('./reportLines');

function getConfirmedLines(date) {
  return new Set(
    db.prepare('SELECT line FROM report_confirmations WHERE date = ?').all(date).map((r) => r.line)
  );
}

function isDayFullyConfirmed(date) {
  const confirmed = getConfirmedLines(date);
  return REPORT_LINES.every(({ key }) => confirmed.has(key));
}

/**
 * Confirms one report line for a date: marks it confirmed, and fills an
 * approved Present for anyone in that line with nothing recorded yet for
 * that date. Never touches anyone who already has a real status recorded.
 */
function confirmLine(date, lineKey, userId) {
  const { lineRows } = buildReportLineRows(date);
  const rows = lineRows[lineKey] || [];

  const insert = db.prepare(
    `INSERT INTO attendance_submissions (date, roster_id, user_id, status, approval_status, submitted_at)
     VALUES (?, ?, ?, 'present', 'approved', datetime('now'))`
  );
  for (const r of rows) {
    if (r.unreported) insert.run(date, r.person.id, userId);
  }

  db.prepare(
    `INSERT INTO report_confirmations (date, line, confirmed_by, confirmed_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(date, line) DO UPDATE SET confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at`
  ).run(date, lineKey, userId);
}

/** BC/BSM/B2IC (or any unrestricted account) override: confirms every line for a date at once. */
function confirmAllLines(date, userId) {
  for (const { key } of REPORT_LINES) confirmLine(date, key, userId);
}

module.exports = { getConfirmedLines, isDayFullyConfirmed, confirmLine, confirmAllLines };
