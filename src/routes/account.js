const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../auth');

const router = express.Router();

router.get('/account', requireLogin, (req, res) => {
  const user = db.prepare('SELECT must_change_password FROM users WHERE id = ?').get(req.session.user.id);
  res.render('account', {
    error: null,
    saved: req.query.saved === '1',
    forced: req.query.forced === '1' || !!user.must_change_password,
  });
});

router.post('/account/password', requireLogin, (req, res) => {
  const { current_password: currentPassword, new_password: newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(400).render('account', { error: 'Current password is incorrect.', saved: false, forced: !!user.must_change_password });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).render('account', { error: 'New password must be at least 8 characters.', saved: false, forced: !!user.must_change_password });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
  res.redirect('/account?saved=1');
});

module.exports = router;
