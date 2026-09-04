const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');

const router = express.Router();

function todayStr() {
  const d = new Date();
  const tzOffset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tzOffset).toISOString().slice(0, 10);
}

router.get('/attendance', requireLogin, (req, res) => {
  const date = req.query.date || todayStr();
  const roster = db
    .prepare('SELECT * FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE')
    .all();

  const mySubs = db
    .prepare('SELECT * FROM attendance_submissions WHERE date = ? AND user_id = ?')
    .all(date, req.session.user.id);
  const mySubsByRoster = new Map(mySubs.map((s) => [s.roster_id, s]));

  const rows = roster.map((person) => ({
    person,
    existing: mySubsByRoster.get(person.id) || null,
  }));

  res.render('attendance', { date, rows, todayStr: todayStr(), saved: req.query.saved === '1' });
});

router.post('/attendance', requireLogin, (req, res) => {
  const date = req.body.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).render('error', { message: 'Invalid date.' });
  }

  const roster = db.prepare('SELECT id FROM roster WHERE active = 1').all();
  const upsert = db.prepare(`
    INSERT INTO attendance_submissions (date, roster_id, user_id, status, remarks, submitted_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(date, roster_id, user_id)
    DO UPDATE SET status = excluded.status, remarks = excluded.remarks, submitted_at = datetime('now')
  `);

  const tx = db.transaction(() => {
    for (const person of roster) {
      const status = req.body[`status_${person.id}`];
      if (!status) continue; // person left unmarked this submission
      if (!['present', 'off', 'leave'].includes(status)) continue;
      const remarks = (req.body[`remarks_${person.id}`] || '').trim() || null;
      upsert.run(date, person.id, req.session.user.id, status, remarks);
    }
  });
  tx();

  res.redirect(`/attendance?date=${encodeURIComponent(date)}&saved=1`);
});

router.get('/summary', requireLogin, (req, res) => {
  const { getDailySummary } = require('../lib/merge');
  const date = req.query.date || todayStr();
  const summary = getDailySummary(date);
  res.render('summary', { summary, todayStr: todayStr() });
});

module.exports = router;
