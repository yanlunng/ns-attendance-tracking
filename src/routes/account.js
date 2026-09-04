const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireLogin } = require('../auth');
const telegramApi = require('../lib/telegramApi');
const { generateLinkCode, getLinkStatus } = require('../lib/telegramBot');

const router = express.Router();

function telegramFieldsFor(user) {
  const status = getLinkStatus(user.id, user.username);
  return {
    telegramEnabled: telegramApi.enabled(),
    telegramLinkCode: user.telegram_link_code || null,
    telegramLinkCount: status.count,
    telegramLinkCap: status.cap,
    telegramIsKah: status.isKah,
  };
}

router.get('/account', requireLogin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const forced = req.query.forced === '1' || !!user.must_change_password;

  // On first login after an admin sets their password, offer a linking code
  // up front — a convenience, not a requirement; they can ignore it. Linking
  // additional Telegram accounts after that always requires clicking the button.
  let autoOffered = false;
  if (forced && telegramApi.enabled() && !user.telegram_link_code) {
    const status = getLinkStatus(user.id, user.username);
    if (status.count === 0) {
      user.telegram_link_code = generateLinkCode(user.id);
      autoOffered = true;
    }
  }

  res.render('account', {
    error: null,
    saved: req.query.saved === '1',
    forced,
    telegramAutoOffered: autoOffered,
    ...telegramFieldsFor(user),
  });
});

router.post('/account/telegram/link-code', requireLogin, (req, res) => {
  generateLinkCode(req.session.user.id);
  res.redirect('/account');
});

router.post('/account/telegram/unlink', requireLogin, (req, res) => {
  db.prepare('DELETE FROM telegram_links WHERE user_id = ?').run(req.session.user.id);
  db.prepare('UPDATE users SET telegram_link_code = NULL WHERE id = ?').run(req.session.user.id);
  res.redirect('/account');
});

router.post('/account/password', requireLogin, (req, res) => {
  const { current_password: currentPassword, new_password: newPassword } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  const telegramFields = telegramFieldsFor(user);

  if (!bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(400).render('account', { error: 'Current password is incorrect.', saved: false, forced: !!user.must_change_password, telegramAutoOffered: false, ...telegramFields });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).render('account', { error: 'New password must be at least 8 characters.', saved: false, forced: !!user.must_change_password, telegramAutoOffered: false, ...telegramFields });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hash, user.id);
  res.redirect('/account?saved=1');
});

module.exports = router;
