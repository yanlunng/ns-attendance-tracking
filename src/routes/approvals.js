const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

function groupKey(row) {
  return [row.date, row.roster_id, row.status, row.off_period || '', row.off_time || ''].join('|');
}

function pendingGroups(status) {
  const pendingRows = db
    .prepare(
      `SELECT s.*, r.name AS person_name, r.ref_id AS person_rank, u.username AS submitter
       FROM attendance_submissions s
       JOIN roster r ON r.id = s.roster_id
       JOIN users u ON u.id = s.user_id
       WHERE s.status = ? AND s.approval_status = 'pending'
       ORDER BY s.date, r.name COLLATE NOCASE`
    )
    .all(status);

  const groups = new Map();
  for (const row of pendingRows) {
    const key = groupKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        status: row.status,
        date: row.date,
        personName: row.person_name,
        personRank: row.person_rank,
        offPeriod: row.off_period,
        offTime: row.off_time,
        submissionIds: [],
        submitters: [],
        remarksList: [],
      });
    }
    const g = groups.get(key);
    g.submissionIds.push(row.id);
    g.submitters.push(row.submitter);
    if (row.remarks) g.remarksList.push(`${row.submitter}: ${row.remarks}`);
  }
  return [...groups.values()];
}

router.get('/approvals', requireAdmin, (req, res) => {
  res.render('approvals', {
    pendingOff: pendingGroups('off'),
    pendingOutpro: pendingGroups('outpro'),
  });
});

function applyDecision(status) {
  return (req, res) => {
    const ids = (req.body.ids || '')
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n > 0);

    const stmt = db.prepare(
      "UPDATE attendance_submissions SET approval_status = ?, approved_by = ?, approved_at = datetime('now') WHERE id = ? AND status IN ('off', 'outpro')"
    );
    const tx = db.transaction(() => {
      for (const id of ids) stmt.run(status, req.session.user.id, id);
    });
    tx();
    res.redirect('/approvals');
  };
}

router.post('/approvals/group/approve', requireAdmin, applyDecision('approved'));
router.post('/approvals/group/reject', requireAdmin, applyDecision('rejected'));

module.exports = router;
