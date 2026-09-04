const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

function usersList() {
  return db.prepare('SELECT id, username, role, needs_password, created_at FROM users ORDER BY username').all();
}

router.get('/users', requireAdmin, (req, res) => {
  res.render('users', { users: usersList(), error: null });
});

router.post('/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;

  if (!username || !password) {
    return res.status(400).render('users', { users: usersList(), error: 'Username and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).render('users', { users: usersList(), error: 'Password must be at least 8 characters.' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      username.trim(),
      hash,
      ['admin', 'editor'].includes(role) ? role : 'user'
    );
    res.redirect('/users');
  } catch (err) {
    const message = /UNIQUE/.test(err.message) ? 'That username already exists.' : err.message;
    res.status(400).render('users', { users: usersList(), error: message });
  }
});

router.post('/users/:id/set-password', requireAdmin, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 8) {
    return res.status(400).render('users', { users: usersList(), error: 'Password must be at least 8 characters.' });
  }
  const hash = bcrypt.hashSync(password, 10);
  db.prepare('UPDATE users SET password_hash = ?, needs_password = 0 WHERE id = ?').run(hash, req.params.id);
  res.redirect('/users');
});

router.post('/users/:id/delete', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.status(400).render('users', { users: usersList(), error: "You can't delete your own account while logged in as it." });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.redirect('/users');
});

module.exports = router;
