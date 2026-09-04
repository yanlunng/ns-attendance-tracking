const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../auth');

const router = express.Router();

router.get('/account', requireLogin, (req, res) => {
  res.render('account', { error: null, saved: req.query.saved === '1' });
});

router.post('/account/password', requireLogin, (req, res) => {
  const { current_password: currentPassword, new_password: newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);

  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(400).render('account', { error: 'Current password is incorrect.', saved: false });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).render('account', { error: 'New password must be at least 8 characters.', saved: false });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  res.redirect('/account?saved=1');
});

module.exports = router;
