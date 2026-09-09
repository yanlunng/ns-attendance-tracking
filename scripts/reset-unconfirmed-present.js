// One-off cleanup, run manually once after deploying the Mark Attendance fix
// that stopped auto-recording "present" for anyone not explicitly flagged.
// Every existing status='present' row was written by that old default-fill,
// so for today and any later date it's safe to clear out — anyone genuinely
// present gets re-recorded the moment their line is confirmed on the Summary
// page. Lines already confirmed are left untouched so their locked-in
// headcount doesn't change; only unconfirmed lines get reset.
//
// Usage: node scripts/reset-unconfirmed-present.js
const db = require('../src/db');
const { buildReportLineRows, REPORT_LINES } = require('../src/lib/reportLines');
const { getConfirmedLines } = require('../src/lib/reportConfirmations');

function todayStr() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

const today = todayStr();

const dates = db
  .prepare("SELECT DISTINCT date FROM attendance_submissions WHERE status = 'present' AND date >= ? ORDER BY date")
  .all(today)
  .map((r) => r.date);

if (dates.length === 0) {
  console.log(`No Present rows found for ${today} or later. Nothing to do.`);
  process.exit(0);
}

const del = db.prepare('DELETE FROM attendance_submissions WHERE id = ?');
let totalDeleted = 0;

const tx = db.transaction(() => {
  for (const date of dates) {
    const { lineRows } = buildReportLineRows(date);
    const confirmed = getConfirmedLines(date);

    const lineKeysByPersonId = new Map();
    for (const { key } of REPORT_LINES) {
      for (const row of lineRows[key] || []) {
        if (!lineKeysByPersonId.has(row.person.id)) lineKeysByPersonId.set(row.person.id, new Set());
        lineKeysByPersonId.get(row.person.id).add(key);
      }
    }

    const presentRows = db
      .prepare("SELECT id, roster_id FROM attendance_submissions WHERE date = ? AND status = 'present'")
      .all(date);

    let deletedForDate = 0;
    for (const row of presentRows) {
      const keys = lineKeysByPersonId.get(row.roster_id);
      const anyLineConfirmed = keys && [...keys].some((key) => confirmed.has(key));
      if (anyLineConfirmed) continue;
      del.run(row.id);
      deletedForDate++;
    }
    if (deletedForDate > 0) {
      console.log(`${date}: deleted ${deletedForDate} unconfirmed Present row(s)`);
      totalDeleted += deletedForDate;
    }
  }
});
tx();

console.log(`Done. ${totalDeleted} Present row(s) deleted across ${dates.length} date(s) from ${today} onward.`);
