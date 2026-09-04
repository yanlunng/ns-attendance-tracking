const express = require('express');
const db = require('../db');
const { requireLogin } = require('../auth');

const router = express.Router();

router.get('/my-attendance', requireLogin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!user.roster_id) {
    return res.render('my-attendance', { person: null, rows: [] });
  }

  const person = db.prepare('SELECT * FROM roster WHERE id = ?').get(user.roster_id);
  const rows = db
    .prepare(
      `SELECT s.*, u.username AS submitter
       FROM attendance_submissions s
       JOIN users u ON u.id = s.user_id
       WHERE s.roster_id = ?
       ORDER BY s.date DESC`
    )
    .all(user.roster_id);

  res.render('my-attendance', { person, rows });
});

module.exports = router;
