const db = require('../db');
const { activeRosterForDate } = require('./roster');

/** Groups (status, off_period, off_time) into one comparable key for conflict detection. */
function statusKey(sub) {
  if (sub.status !== 'off') return sub.status;
  return sub.off_period === 'TIME' ? `off:TIME:${sub.off_time}` : `off:${sub.off_period}`;
}

/**
 * Builds the merged daily attendance view for a date: every roster member
 * still active for this cycle/date, every independent submission for them
 * that day, and whether those submissions agree. Rejected submissions are
 * treated as void — they still show in the details list, but don't count
 * toward agreement/conflict or the merged status.
 */
function getDailySummary(date) {
  const roster = activeRosterForDate(date);

  const submissions = db
    .prepare(
      `SELECT s.*, u.username
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
    const liveSubs = subs.filter((s) => s.approval_status !== 'rejected');
    const distinctKeys = [...new Set(liveSubs.map(statusKey))];

    const conflict = distinctKeys.length > 1;
    const mergedKey = distinctKeys.length === 1 ? distinctKeys[0] : null;
    const mergedStatus = mergedKey ? (mergedKey.startsWith('off') ? 'off' : mergedKey) : null;

    let approvalState = null;
    if (mergedStatus === 'off' || mergedStatus === 'outpro') {
      approvalState = liveSubs.some((s) => s.approval_status === 'pending') ? 'pending' : 'approved';
    }

    return {
      person,
      submissions: subs,
      submitterCount: subs.length,
      status: mergedStatus,
      offPeriod: mergedKey && mergedKey.startsWith('off:') ? mergedKey.split(':')[1] : null,
      offTime: mergedKey && mergedKey.startsWith('off:TIME:') ? mergedKey.split(':')[2] : null,
      approvalState,
      conflict,
      unreported: liveSubs.length === 0,
      missingAttachment: mergedStatus === 'mc' && liveSubs.every((s) => !s.attachment_path),
      mcSubmissionId: mergedStatus === 'mc' ? liveSubs.find((s) => s.status === 'mc').id : null,
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
      offApproved: rows.filter((r) => r.status === 'off' && r.approvalState === 'approved').length,
      offPending: rows.filter((r) => r.status === 'off' && r.approvalState === 'pending').length,
      mc: rows.filter((r) => r.status === 'mc').length,
      outproApproved: rows.filter((r) => r.status === 'outpro' && r.approvalState === 'approved').length,
      outproPending: rows.filter((r) => r.status === 'outpro' && r.approvalState === 'pending').length,
    },
  };
}

module.exports = { getDailySummary, statusKey };
