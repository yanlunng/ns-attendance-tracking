const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { parseRosterWorkbook } = require('../lib/rosterImport');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/roster', requireAdmin, (req, res) => {
  const roster = db
    .prepare('SELECT * FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE')
    .all();
  res.render('roster', { roster, error: null, imported: req.query.imported || null });
});

router.post('/roster/upload', requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).render('roster', {
      roster: db.prepare('SELECT * FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE').all(),
      error: 'No file uploaded.',
      imported: null,
    });
  }

  const mode = req.body.mode === 'append' ? 'append' : 'replace';

  try {
    const people = await parseRosterWorkbook(req.file.buffer);

    const tx = db.transaction(() => {
      if (mode === 'replace') {
        db.prepare('UPDATE roster SET active = 0').run();
      }
      const insert = db.prepare(
        'INSERT INTO roster (name, ref_id, unit, extra) VALUES (?, ?, ?, ?)'
      );
      for (const p of people) {
        insert.run(p.name, p.ref_id, p.unit, p.extra);
      }
    });
    tx();

    res.redirect(`/roster?imported=${people.length}`);
  } catch (err) {
    res.status(400).render('roster', {
      roster: db.prepare('SELECT * FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE').all(),
      error: err.message,
      imported: null,
    });
  }
});

router.post('/roster/:id/remove', requireAdmin, (req, res) => {
  db.prepare('UPDATE roster SET active = 0 WHERE id = ?').run(req.params.id);
  res.redirect('/roster');
});

module.exports = router;
