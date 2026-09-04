const express = require('express');
const db = require('../db');
const { requireLogin, requireEditor, blockSelfRole } = require('../auth');
const { GROUP_CODES } = require('../lib/rosterImport');
const { buildEstablishmentWorkbook } = require('../lib/exportXlsx');

const router = express.Router();
const TABS = [...GROUP_CODES, 'UNASSIGNED', 'ALL'];

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

  const filtered = roster.filter((person) => {
    if (activeTab === 'ALL') return true;
    if (activeTab === 'UNASSIGNED') return !person.group_code;
    return person.group_code === activeTab;
  });

  res.render('establishment', {
    tabs: TABS,
    activeTab,
    counts,
    roster: filtered,
    groupCodes: GROUP_CODES,
    canEdit: ['admin', 'editor'].includes(req.session.user.role),
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

module.exports = router;
