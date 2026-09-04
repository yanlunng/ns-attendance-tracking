const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();

router.get('/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
  res.render('users', { users, error: null });
});

router.post('/users', requireAdmin, (req, res) => {
  const { username, password, role } = req.body;
  const users = () => db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();

  if (!username || !password) {
    return res.status(400).render('users', { users: users(), error: 'Username and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).render('users', { users: users(), error: 'Password must be at least 8 characters.' });
  }

  try {
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(
      username.trim(),
      hash,
      role === 'admin' ? 'admin' : 'user'
    );
    res.redirect('/users');
  } catch (err) {
    const message = /UNIQUE/.test(err.message) ? 'That username already exists.' : err.message;
    res.status(400).render('users', { users: users(), error: message });
  }
});

router.post('/users/:id/delete', requireAdmin, (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    const users = db.prepare('SELECT id, username, role, created_at FROM users ORDER BY username').all();
    return res.status(400).render('users', { users, error: "You can't delete your own account while logged in as it." });
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.redirect('/users');
});

module.exports = router;
