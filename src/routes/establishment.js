const express = require('express');
const multer = require('multer');
const db = require('../db');
const { requireLogin, requireEditor, blockSelfRole } = require('../auth');
const { GROUP_CODES } = require('../lib/rosterImport');
const { buildEstablishmentWorkbook } = require('../lib/exportXlsx');
const { importEstablishmentWorkbook } = require('../lib/establishmentImport');

const router = express.Router();
const TABS = [...GROUP_CODES, 'UNASSIGNED', 'ALL'];
const DRIVING_CATS = ['A', 'B', 'C', 'D'];
const uploadTemplate = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function rosterList() {
  return db.prepare('SELECT * FROM roster WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
}

router.get('/establishment', requireLogin, blockSelfRole, (req, res) => {
  const activeTab = TABS.includes(req.query.group) ? req.query.group : 'ALL';
  const roster = rosterList();

  const counts = { ALL: roster.length, UNASSIGNED: 0 };
  for (const code of GROUP_CODES) counts[code] = 0;
  for (const person of roster) {
    if (person.group_code && counts[person.group_code] !== undefined) counts[person.group_code]++;
    else counts.UNASSIGNED++;
  }

  let filtered = roster.filter((person) => {
    if (activeTab === 'ALL') return true;
    if (activeTab === 'UNASSIGNED') return !person.group_code;
    return person.group_code === activeTab;
  });

  // HQ sub-tabs by role_tag — extensible for more roles later without
  // touching this route, just another value flowing through role_tag.
  let hqRoleCounts = null;
  const activeRole = req.query.role || null;
  if (activeTab === 'HQ') {
    const hqPeople = roster.filter((p) => p.group_code === 'HQ');
    hqRoleCounts = {
      Signaller: hqPeople.filter((p) => p.role_tag === 'Signaller').length,
      Others: hqPeople.filter((p) => p.role_tag !== 'Signaller').length,
    };
    if (activeRole === 'Signaller' || activeRole === 'Others') {
      filtered = filtered.filter((p) => (activeRole === 'Signaller' ? p.role_tag === 'Signaller' : p.role_tag !== 'Signaller'));
    }
  }

  res.render('establishment', {
    tabs: TABS,
    activeTab,
    counts,
    roster: filtered,
    groupCodes: GROUP_CODES,
    canEdit: ['admin', 'editor'].includes(req.session.user.role),
    importError: req.query.importError || null,
    hqRoleCounts,
    activeRole,
  });
});

router.post('/establishment/:id/group', requireEditor, (req, res) => {
  const group = GROUP_CODES.includes(req.body.group) ? req.body.group : null;
  db.prepare("UPDATE roster SET group_code = ?, group_source = 'manual' WHERE id = ?").run(
    group,
    req.params.id
  );
  res.redirect(`/establishment?group=${encodeURIComponent(req.body.returnTab || 'ALL')}`);
});

// Driving cat is entered manually here (never derived from the NR sheet)
// and persists across roster re-uploads, unlike group_code — see
// rosterUpsert.js, which never touches this column. Drivers only.
router.post('/establishment/:id/driving-cat', requireEditor, (req, res) => {
  const value = DRIVING_CATS.includes(req.body.drivingCat) ? req.body.drivingCat : null;
  db.prepare("UPDATE roster SET driving_cat = ? WHERE id = ? AND group_code = 'DVR'").run(value, req.params.id);
  res.redirect(`/establishment?group=${encodeURIComponent(req.body.returnTab || 'ALL')}`);
});

// Manual override for role_tag — e.g. someone whose Vocation Descr wasn't
// caught by the auto-detection (or was uploaded before it existed). Marks
// role_source 'manual' so future roster re-uploads never overwrite it,
// same protection pattern as a manual group_code override. HQ only.
router.post('/establishment/:id/role-tag', requireEditor, (req, res) => {
  const isSignaller = req.body.value === '1';
  db.prepare(
    "UPDATE roster SET role_tag = ?, role_source = 'manual' WHERE id = ? AND group_code = 'HQ'"
  ).run(isSignaller ? 'Signaller' : null, req.params.id);
  res.redirect(`/establishment?group=${encodeURIComponent(req.body.returnTab || 'ALL')}${req.body.returnRole ? '&role=' + encodeURIComponent(req.body.returnRole) : ''}`);
});

router.get('/establishment/export', requireLogin, blockSelfRole, async (req, res) => {
  const workbook = await buildEstablishmentWorkbook(rosterList());
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader('Content-Disposition', 'attachment; filename="battery_establishment.xlsx"');
  await workbook.xlsx.write(res);
  res.end();
});

router.post('/establishment/import', requireEditor, uploadTemplate.single('file'), async (req, res) => {
  if (!req.file) {
    return res.redirect('/establishment?importError=' + encodeURIComponent('No file uploaded.'));
  }
  try {
    const results = await importEstablishmentWorkbook(req.file.buffer);
    res.render('establishment-import-result', { results });
  } catch (err) {
    res.redirect('/establishment?importError=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
