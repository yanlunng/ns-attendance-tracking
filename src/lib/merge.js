const db = require('../db');

/**
 * Builds the merged daily attendance view for a date: every active roster
 * member, every independent submission for them that day, and whether those
 * submissions agree.
 */
function getDailySummary(date) {
  const roster = db
    .prepare('SELECT * FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE')
    .all();

  const submissions = db
    .prepare(
      `SELECT s.roster_id, s.status, s.remarks, s.submitted_at, u.username
       FROM attendance_submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.date = ?`
    )
    .all(date);

  const byRoster = new Map();
  for (const sub of submissions) {
    if (!byRoster.has(sub.roster_id)) byRoster.set(sub.roster_id, []);
    byRoster.get(sub.roster_id).push(sub);
  }

  const rows = roster.map((person) => {
    const subs = byRoster.get(person.id) || [];
    const distinctStatuses = [...new Set(subs.map((s) => s.status))];
    return {
      person,
      submissions: subs,
      submitterCount: subs.length,
      status: distinctStatuses.length === 1 ? distinctStatuses[0] : null,
      conflict: distinctStatuses.length > 1,
      unreported: subs.length === 0,
    };
  });

  return {
    date,
    rows,
    stats: {
      total: rows.length,
      reported: rows.filter((r) => !r.unreported).length,
      conflicts: rows.filter((r) => r.conflict).length,
      present: rows.filter((r) => r.status === 'present').length,
      off: rows.filter((r) => r.status === 'off').length,
      leave: rows.filter((r) => r.status === 'leave').length,
    },
  };
}

module.exports = { getDailySummary };
