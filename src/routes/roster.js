const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireAdmin } = require('../auth');
const { parseRosterWorkbook } = require('../lib/rosterImport');
const { upsertRoster } = require('../lib/rosterUpsert');
const { provisionSelfAccounts } = require('../lib/selfAccounts');
const { getSetting, setSetting, getCountWeekends } = require('../lib/settings');
const { nextMonday } = require('../lib/workingDays');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function rosterList() {
  return db.prepare('SELECT * FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
}

function cyclePageData() {
  return {
    cycleStart: getSetting('cycle_start_date') || '',
    cycleEnd: getSetting('cycle_end_date') || '',
    mainBodyStart: getSetting('mainbody_phase_start_date') || '',
    countWeekends: getCountWeekends(),
  };
}

router.get('/roster', requireAdmin, (req, res) => {
  const freshCredentials = req.session.freshCredentials || null;
  const skippedAccounts = req.session.skippedAccounts || null;
  delete req.session.freshCredentials;
  delete req.session.skippedAccounts;
  res.render('roster', {
    roster: rosterList(),
    error: null,
    imported: req.query.imported || null,
    removed: req.query.removed || null,
    freshCredentials,
    skippedAccounts,
    ...cyclePageData(),
  });
});

router.post('/roster/upload', requireAdmin, upload.single('file'), async (req, res) => {
  const fail = (message) =>
    res.status(400).render('roster', {
      roster: rosterList(),
      error: message,
      imported: null,
      removed: null,
      freshCredentials: null,
      skippedAccounts: null,
      ...cyclePageData(),
    });

  if (!req.file) return fail('No file uploaded.');

  const { start_date: startDate, end_date: endDate } = req.body;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) {
    return fail('Cycle start and end dates are required.');
  }
  if (startDate > endDate) {
    return fail('Cycle start date must be on or before the end date.');
  }

  let mainBodyStart = req.body.mainbody_start_date;
  if (mainBodyStart && !/^\d{4}-\d{2}-\d{2}$/.test(mainBodyStart)) {
    return fail('Main Body Phase start date is not a valid date.');
  }
  if (!mainBodyStart) mainBodyStart = nextMonday(startDate);

  const mode = req.body.mode === 'append' ? 'append' : 'replace';

  try {
    const people = await parseRosterWorkbook(req.file.buffer);
    const { imported, removed } = upsertRoster(people, mode);
    setSetting('cycle_start_date', startDate);
    setSetting('cycle_end_date', endDate);
    setSetting('mainbody_phase_start_date', mainBodyStart);

    const { created, skipped } = provisionSelfAccounts(rosterList());
    if (created.length > 0) req.session.freshCredentials = created;
    if (skipped.length > 0) req.session.skippedAccounts = skipped;

    const suffix = mode === 'replace' && removed > 0 ? `&removed=${removed}` : '';
    res.redirect(`/roster?imported=${imported}${suffix}`);
  } catch (err) {
    fail(err.message);
  }
});

router.post('/roster/settings/weekends', requireAdmin, (req, res) => {
  setSetting('count_weekends', req.body.count_weekends === '1' ? '1' : '0');
  res.redirect('/roster');
});

router.post('/roster/:id/remove', requireAdmin, (req, res) => {
  db.prepare('UPDATE roster SET active = 0 WHERE id = ?').run(req.params.id);
  res.redirect('/roster');
});

router.post('/roster/:id/deferred', requireAdmin, (req, res) => {
  db.prepare('UPDATE roster SET is_deferred = ? WHERE id = ?').run(req.body.value === '1' ? 1 : 0, req.params.id);
  res.redirect('/roster');
});

router.post('/roster/:id/ict-cancelled', requireAdmin, (req, res) => {
  db.prepare('UPDATE roster SET is_ict_cancelled = ? WHERE id = ?').run(
    req.body.value === '1' ? 1 : 0,
    req.params.id
  );
  res.redirect('/roster');
});

module.exports = router;
